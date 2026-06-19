use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{
    BlockNode, CalloutType, DocumentModel, FootnoteDefinitionNode, InlineNode, ListItemNode,
    TextStyle,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOptions {
    #[serde(default = "default_true", alias = "mathEnabled")]
    pub math: bool,
    #[serde(default, alias = "mermaidEnabled")]
    pub mermaid: bool,
    #[serde(default, alias = "chartEnabled")]
    pub charts: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            math: true,
            mermaid: false,
            charts: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone)]
struct Line<'a> {
    raw: &'a str,
    trimmed: &'a str,
    indent: usize,
}

#[derive(Debug, Default)]
struct ParseState {
    next_ordered_sequence_id: u32,
    footnote_definitions: BTreeMap<String, Vec<BlockNode>>,
    referenced_footnotes: Vec<String>,
}

pub fn parse_markdown(markdown: &str, options: ParseOptions) -> DocumentModel {
    let lines = markdown
        .lines()
        .map(|raw| Line {
            raw,
            trimmed: raw.trim(),
            indent: raw.chars().take_while(|c| *c == ' ').count(),
        })
        .collect::<Vec<_>>();
    let mut state = ParseState::default();
    let mut index = 0;
    let children = parse_blocks(&lines, &mut index, 0, &options, &mut state);
    let footnotes = build_footnotes(&state);

    DocumentModel {
        children,
        footnotes,
    }
}

fn parse_blocks(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
    state: &mut ParseState,
) -> Vec<BlockNode> {
    let mut blocks = Vec::new();

    while *index < lines.len() {
        let line = &lines[*index];
        if line.trimmed.is_empty() {
            *index += 1;
            continue;
        }
        if line.indent < min_indent {
            break;
        }

        let text = strip_indent(line.raw, min_indent).trim_end();
        if let Some((identifier, rest)) = parse_footnote_definition(text) {
            *index += 1;
            let mut definition_markdown = rest.to_string();
            while *index < lines.len() {
                let next = &lines[*index];
                if next.trimmed.is_empty() {
                    definition_markdown.push('\n');
                    *index += 1;
                    continue;
                }
                if next.indent < min_indent + 2 {
                    break;
                }
                definition_markdown.push('\n');
                definition_markdown.push_str(strip_indent(next.raw, min_indent + 2));
                *index += 1;
            }

            let mut nested_index = 0;
            let nested_lines = definition_markdown
                .lines()
                .map(|raw| Line {
                    raw,
                    trimmed: raw.trim(),
                    indent: raw.chars().take_while(|c| *c == ' ').count(),
                })
                .collect::<Vec<_>>();
            let children = parse_blocks(&nested_lines, &mut nested_index, 0, options, state);
            state
                .footnote_definitions
                .insert(normalize_footnote_identifier(identifier), children);
            continue;
        }

        if text == "[TOC]" {
            blocks.push(BlockNode::TocPlaceholder);
            *index += 1;
            continue;
        }
        if text == "\\pagebreak" {
            blocks.push(BlockNode::PageBreak);
            *index += 1;
            continue;
        }
        if let Some(value) = parse_comment(text) {
            blocks.push(BlockNode::Comment { value });
            *index += 1;
            continue;
        }
        if text.contains("pagebreak") && text.trim_start().starts_with('<') {
            blocks.push(BlockNode::PageBreak);
            *index += 1;
            continue;
        }
        if let Some((level, content)) = parse_heading(text) {
            blocks.push(BlockNode::Heading {
                level,
                children: parse_inlines(content.trim(), options, state),
            });
            *index += 1;
            continue;
        }
        if starts_fence(text) {
            blocks.push(parse_fenced_block(lines, index, min_indent, options));
            continue;
        }
        if options.math && text.trim() == "$$" {
            blocks.push(parse_math_block(lines, index, min_indent));
            continue;
        }
        if text.starts_with('>') {
            blocks.push(parse_blockquote(lines, index, min_indent, options, state));
            continue;
        }
        if parse_list_marker(text).is_some() {
            blocks.push(parse_list(lines, index, min_indent, options, state));
            continue;
        }
        if is_table_start(lines, *index, min_indent) {
            blocks.push(parse_table(lines, index, min_indent, options, state));
            continue;
        }
        if let Some((alt, url)) = parse_image(text) {
            blocks.push(BlockNode::Image { alt, url });
            *index += 1;
            continue;
        }

        blocks.push(parse_paragraph(lines, index, min_indent, options, state));
    }

    blocks
}

fn parse_paragraph(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
    state: &mut ParseState,
) -> BlockNode {
    let mut text = String::new();
    while *index < lines.len() {
        let line = &lines[*index];
        if line.trimmed.is_empty() || line.indent < min_indent {
            break;
        }
        let candidate = strip_indent(line.raw, min_indent).trim_end();
        if !text.is_empty()
            && (parse_heading(candidate).is_some()
                || starts_fence(candidate)
                || candidate.starts_with('>')
                || parse_list_marker(candidate).is_some()
                || is_table_start(lines, *index, min_indent))
        {
            break;
        }
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(candidate.trim());
        *index += 1;
    }

    BlockNode::Paragraph {
        children: parse_inlines(&text, options, state),
    }
}

fn parse_fenced_block(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
) -> BlockNode {
    let opening = strip_indent(lines[*index].raw, min_indent).trim();
    let marker = opening.chars().next().unwrap_or('`');
    let fence_len = opening.chars().take_while(|c| *c == marker).count();
    let info = opening[fence_len..].trim();
    let (language, meta) = parse_fence_info(info);
    *index += 1;

    let mut value = String::new();
    while *index < lines.len() {
        let candidate = strip_indent(lines[*index].raw, min_indent);
        let trimmed = candidate.trim();
        let marker_count = trimmed.chars().take_while(|c| *c == marker).count();
        if marker_count >= fence_len && trimmed[marker_count..].trim().is_empty() {
            *index += 1;
            break;
        }
        if !value.is_empty() {
            value.push('\n');
        }
        value.push_str(candidate);
        *index += 1;
    }

    match language.as_deref().map(str::to_ascii_lowercase).as_deref() {
        Some("mermaid") if options.mermaid => BlockNode::MermaidBlock { value, meta },
        Some("chart" | "chartjs") if options.charts => BlockNode::ChartBlock { language, value },
        _ => BlockNode::CodeBlock { language, value },
    }
}

fn parse_math_block(lines: &[Line<'_>], index: &mut usize, min_indent: usize) -> BlockNode {
    *index += 1;
    let mut value = String::new();
    while *index < lines.len() {
        let candidate = strip_indent(lines[*index].raw, min_indent).trim_end();
        if candidate.trim() == "$$" {
            *index += 1;
            break;
        }
        if !value.is_empty() {
            value.push('\n');
        }
        value.push_str(candidate);
        *index += 1;
    }
    BlockNode::MathBlock { value }
}

fn parse_blockquote(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
    state: &mut ParseState,
) -> BlockNode {
    let mut quoted = String::new();
    while *index < lines.len() {
        let text = strip_indent(lines[*index].raw, min_indent).trim_start();
        if !text.starts_with('>') {
            break;
        }
        let stripped = text
            .strip_prefix('>')
            .unwrap_or(text)
            .strip_prefix(' ')
            .unwrap_or_else(|| text.strip_prefix('>').unwrap_or(text));
        if !quoted.is_empty() {
            quoted.push('\n');
        }
        quoted.push_str(stripped);
        *index += 1;
    }

    let (callout_type, body) = strip_callout_marker(&quoted);
    let nested_lines = body
        .lines()
        .map(|raw| Line {
            raw,
            trimmed: raw.trim(),
            indent: raw.chars().take_while(|c| *c == ' ').count(),
        })
        .collect::<Vec<_>>();
    let mut nested_index = 0;
    let children = parse_blocks(&nested_lines, &mut nested_index, 0, options, state);

    BlockNode::Blockquote {
        children,
        callout_type,
    }
}

fn parse_list(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
    state: &mut ParseState,
) -> BlockNode {
    let Some(first_marker) = parse_list_marker(strip_indent(lines[*index].raw, min_indent).trim())
    else {
        return BlockNode::Paragraph {
            children: Vec::new(),
        };
    };
    let ordered = first_marker.ordered;
    let sequence_id = if ordered {
        state.next_ordered_sequence_id += 1;
        Some(state.next_ordered_sequence_id)
    } else {
        None
    };
    let mut children = Vec::new();

    while *index < lines.len() {
        let text = strip_indent(lines[*index].raw, min_indent).trim();
        let Some(marker) = parse_list_marker(text) else {
            break;
        };
        if marker.ordered != ordered {
            break;
        }

        let item_indent = lines[*index].indent;
        let mut item_markdown = marker.rest.trim().to_string();
        *index += 1;
        while *index < lines.len() {
            let next = &lines[*index];
            if next.trimmed.is_empty() {
                item_markdown.push('\n');
                *index += 1;
                continue;
            }
            if next.indent <= item_indent {
                break;
            }
            item_markdown.push('\n');
            item_markdown.push_str(strip_indent(next.raw, item_indent + 2));
            *index += 1;
        }

        let nested_lines = item_markdown
            .lines()
            .map(|raw| Line {
                raw,
                trimmed: raw.trim(),
                indent: raw.chars().take_while(|c| *c == ' ').count(),
            })
            .collect::<Vec<_>>();
        let mut nested_index = 0;
        let mut item_children = parse_blocks(&nested_lines, &mut nested_index, 0, options, state);
        if item_children.is_empty() {
            item_children.push(BlockNode::Paragraph {
                children: Vec::new(),
            });
        }
        children.push(ListItemNode::new(item_children));
    }

    BlockNode::List {
        ordered,
        children,
        sequence_id,
    }
}

fn parse_table(
    lines: &[Line<'_>],
    index: &mut usize,
    min_indent: usize,
    options: &ParseOptions,
    state: &mut ParseState,
) -> BlockNode {
    let header = split_table_row(strip_indent(lines[*index].raw, min_indent));
    let align = parse_table_alignment(strip_indent(lines[*index + 1].raw, min_indent));
    *index += 2;

    let mut rows = Vec::new();
    while *index < lines.len() {
        let text = strip_indent(lines[*index].raw, min_indent);
        if lines[*index].trimmed.is_empty() || !text.trim_start().starts_with('|') {
            break;
        }
        rows.push(
            split_table_row(text)
                .into_iter()
                .map(|cell| parse_inlines(cell.trim(), options, state))
                .collect::<Vec<_>>(),
        );
        *index += 1;
    }

    BlockNode::Table {
        headers: header
            .into_iter()
            .map(|cell| parse_inlines(cell.trim(), options, state))
            .collect(),
        rows,
        align: Some(align),
    }
}

fn parse_inlines(input: &str, options: &ParseOptions, state: &mut ParseState) -> Vec<InlineNode> {
    parse_inlines_with_style(input, TextStyle::default(), options, state)
}

fn parse_inlines_with_style(
    input: &str,
    style: TextStyle,
    options: &ParseOptions,
    state: &mut ParseState,
) -> Vec<InlineNode> {
    let mut nodes = Vec::new();
    let mut cursor = 0;

    while cursor < input.len() {
        let rest = &input[cursor..];
        if let Some(end) = rest.strip_prefix("`").and_then(|s| s.find('`')) {
            let value = &rest[1..end + 1];
            nodes.push(InlineNode::styled_text(value, style.clone().with_code()));
            cursor += end + 2;
        } else if let Some(end) = rest.strip_prefix("**").and_then(|s| s.find("**")) {
            let value = &rest[2..end + 2];
            nodes.extend(parse_inlines_with_style(
                value,
                style.clone().with_bold(),
                options,
                state,
            ));
            cursor += end + 4;
        } else if let Some(end) = rest.strip_prefix("~~").and_then(|s| s.find("~~")) {
            let value = &rest[2..end + 2];
            nodes.extend(parse_inlines_with_style(
                value,
                style.clone().with_strikethrough(),
                options,
                state,
            ));
            cursor += end + 4;
        } else if let Some(end) = rest.strip_prefix("++").and_then(|s| s.find("++")) {
            let value = &rest[2..end + 2];
            nodes.extend(parse_inlines_with_style(
                value,
                style.clone().with_underline(),
                options,
                state,
            ));
            cursor += end + 4;
        } else if let Some(end) = rest.strip_prefix('*').and_then(|s| s.find('*')) {
            let value = &rest[1..end + 1];
            nodes.extend(parse_inlines_with_style(
                value,
                style.clone().with_italic(),
                options,
                state,
            ));
            cursor += end + 2;
        } else if let Some((label, url, consumed)) = parse_link_at_start(rest) {
            nodes.extend(parse_inlines_with_style(
                &label,
                style.clone().with_link(url),
                options,
                state,
            ));
            cursor += consumed;
        } else if options.math {
            if let Some(end) = rest.strip_prefix('$').and_then(|s| s.find('$')) {
                nodes.push(InlineNode::MathInline {
                    value: rest[1..end + 1].to_string(),
                });
                cursor += end + 2;
            } else if let Some((identifier, consumed)) = parse_footnote_reference_at_start(rest) {
                let (normalized, id) = register_footnote_reference(state, &identifier);
                nodes.push(InlineNode::FootnoteReference {
                    identifier: normalized,
                    id,
                });
                cursor += consumed;
            } else {
                push_plain_char(input, &mut cursor, &mut nodes, &style);
            }
        } else if let Some((identifier, consumed)) = parse_footnote_reference_at_start(rest) {
            let (normalized, id) = register_footnote_reference(state, &identifier);
            nodes.push(InlineNode::FootnoteReference {
                identifier: normalized,
                id,
            });
            cursor += consumed;
        } else {
            push_plain_char(input, &mut cursor, &mut nodes, &style);
        }
    }

    coalesce_text(nodes)
}

fn push_plain_char(
    input: &str,
    cursor: &mut usize,
    nodes: &mut Vec<InlineNode>,
    style: &TextStyle,
) {
    let ch = input[*cursor..]
        .chars()
        .next()
        .expect("cursor is in bounds");
    nodes.push(InlineNode::styled_text(ch.to_string(), style.clone()));
    *cursor += ch.len_utf8();
}

fn coalesce_text(nodes: Vec<InlineNode>) -> Vec<InlineNode> {
    let mut out: Vec<InlineNode> = Vec::new();
    for node in nodes {
        match (out.last_mut(), node) {
            (
                Some(InlineNode::Text {
                    value,
                    bold,
                    italic,
                    underline,
                    strikethrough,
                    code,
                    link,
                }),
                InlineNode::Text {
                    value: next_value,
                    bold: next_bold,
                    italic: next_italic,
                    underline: next_underline,
                    strikethrough: next_strikethrough,
                    code: next_code,
                    link: next_link,
                },
            ) if *bold == next_bold
                && *italic == next_italic
                && *underline == next_underline
                && *strikethrough == next_strikethrough
                && *code == next_code
                && *link == next_link =>
            {
                value.push_str(&next_value);
            }
            (_, node) => out.push(node),
        }
    }
    out
}

fn build_footnotes(state: &ParseState) -> Option<Vec<FootnoteDefinitionNode>> {
    let footnotes = state
        .referenced_footnotes
        .iter()
        .enumerate()
        .filter_map(|(index, identifier)| {
            state
                .footnote_definitions
                .get(identifier)
                .map(|children| FootnoteDefinitionNode {
                    identifier: identifier.clone(),
                    id: (index + 1) as u32,
                    children: children.clone(),
                })
        })
        .collect::<Vec<_>>();

    (!footnotes.is_empty()).then_some(footnotes)
}

fn register_footnote_reference(state: &mut ParseState, identifier: &str) -> (String, u32) {
    let normalized = normalize_footnote_identifier(identifier);
    if let Some(index) = state
        .referenced_footnotes
        .iter()
        .position(|existing| existing == &normalized)
    {
        return (normalized, index as u32 + 1);
    }
    state.referenced_footnotes.push(normalized.clone());
    (normalized, state.referenced_footnotes.len() as u32)
}

fn parse_heading(input: &str) -> Option<(u8, &str)> {
    let hashes = input.chars().take_while(|c| *c == '#').count();
    if (1..=6).contains(&hashes) && input.chars().nth(hashes) == Some(' ') {
        Some((hashes as u8, &input[hashes + 1..]))
    } else {
        None
    }
}

fn starts_fence(input: &str) -> bool {
    input.starts_with("```") || input.starts_with("~~~")
}

fn parse_fence_info(info: &str) -> (Option<String>, Option<String>) {
    if info.is_empty() {
        return (None, None);
    }
    let mut parts = info.splitn(2, char::is_whitespace);
    let language = parts
        .next()
        .filter(|part| !part.is_empty())
        .map(str::to_string);
    let meta = parts
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string);
    (language, meta)
}

fn parse_comment(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let body = trimmed.strip_prefix("<!--")?.strip_suffix("-->")?.trim();
    body.strip_prefix("COMMENT:")
        .map(str::trim)
        .map(str::to_string)
}

fn parse_footnote_definition(input: &str) -> Option<(&str, &str)> {
    let rest = input.strip_prefix("[^")?;
    let end = rest.find("]:")?;
    Some((&rest[..end], rest[end + 2..].trim_start()))
}

fn parse_footnote_reference_at_start(input: &str) -> Option<(String, usize)> {
    let rest = input.strip_prefix("[^")?;
    let end = rest.find(']')?;
    Some((rest[..end].to_string(), end + 3))
}

#[derive(Debug)]
struct ListMarker<'a> {
    ordered: bool,
    rest: &'a str,
}

fn parse_list_marker(input: &str) -> Option<ListMarker<'_>> {
    let mut chars = input.char_indices();
    let (_, first) = chars.next()?;
    if matches!(first, '-' | '*' | '+') && input.as_bytes().get(first.len_utf8()) == Some(&b' ') {
        return Some(ListMarker {
            ordered: false,
            rest: &input[first.len_utf8() + 1..],
        });
    }

    let digit_len = input.chars().take_while(|c| c.is_ascii_digit()).count();
    if digit_len > 0 {
        let marker = input.as_bytes().get(digit_len).copied();
        let space = input.as_bytes().get(digit_len + 1).copied();
        if matches!(marker, Some(b'.' | b')')) && space == Some(b' ') {
            return Some(ListMarker {
                ordered: true,
                rest: &input[digit_len + 2..],
            });
        }
    }

    None
}

fn parse_image(input: &str) -> Option<(String, String)> {
    let rest = input.strip_prefix("![")?;
    let alt_end = rest.find("](")?;
    let url_rest = &rest[alt_end + 2..];
    let url_end = url_rest.find(')')?;
    if url_end + 1 == url_rest.len() {
        Some((rest[..alt_end].to_string(), url_rest[..url_end].to_string()))
    } else {
        None
    }
}

fn parse_link_at_start(input: &str) -> Option<(String, String, usize)> {
    let rest = input.strip_prefix('[')?;
    let label_end = rest.find("](")?;
    let url_rest = &rest[label_end + 2..];
    let url_end = url_rest.find(')')?;
    Some((
        rest[..label_end].to_string(),
        url_rest[..url_end].to_string(),
        label_end + url_end + 4,
    ))
}

fn strip_callout_marker(input: &str) -> (Option<CalloutType>, String) {
    let trimmed = input.trim_start();
    let Some(rest) = trimmed.strip_prefix("[!") else {
        return (None, input.to_string());
    };
    let Some(end) = rest.find(']') else {
        return (None, input.to_string());
    };
    let marker = rest[..end].to_ascii_lowercase();
    let callout = match marker.as_str() {
        "note" => CalloutType::Note,
        "tip" => CalloutType::Tip,
        "important" => CalloutType::Important,
        "warning" => CalloutType::Warning,
        "caution" => CalloutType::Caution,
        _ => return (None, input.to_string()),
    };
    let body = rest[end + 1..]
        .trim_start_matches([' ', '\t', '\n', '\r'])
        .to_string();
    (Some(callout), body)
}

fn is_table_start(lines: &[Line<'_>], index: usize, min_indent: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    let header = strip_indent(lines[index].raw, min_indent).trim();
    let delimiter = strip_indent(lines[index + 1].raw, min_indent).trim();
    header.starts_with('|')
        && delimiter.starts_with('|')
        && !parse_table_alignment(delimiter).is_empty()
}

fn split_table_row(input: &str) -> Vec<String> {
    input
        .trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect()
}

fn parse_table_alignment(input: &str) -> Vec<Option<String>> {
    let cells = split_table_row(input);
    if cells.is_empty() {
        return Vec::new();
    }
    let mut align = Vec::new();
    for cell in cells {
        let trimmed = cell.trim();
        if !trimmed.chars().all(|c| matches!(c, '-' | ':' | ' ')) || !trimmed.contains('-') {
            return Vec::new();
        }
        align.push(match (trimmed.starts_with(':'), trimmed.ends_with(':')) {
            (true, true) => Some("center".to_string()),
            (false, true) => Some("right".to_string()),
            (true, false) => Some("left".to_string()),
            (false, false) => None,
        });
    }
    align
}

fn strip_indent(input: &str, count: usize) -> &str {
    let mut removed = 0;
    let mut byte_index = 0;
    for (idx, ch) in input.char_indices() {
        if removed >= count || ch != ' ' {
            byte_index = idx;
            break;
        }
        removed += 1;
        byte_index = idx + ch.len_utf8();
    }
    if removed < count && input.chars().all(|c| c == ' ') {
        ""
    } else {
        &input[byte_index..]
    }
}

fn normalize_footnote_identifier(identifier: &str) -> String {
    identifier.trim().to_ascii_lowercase()
}
