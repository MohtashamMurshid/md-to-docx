use md_to_docx_core::{
    parse_markdown, render_document_xml, write_docx, BlockNode, CoreRequest, EmitKind, InlineNode,
    ParseOptions,
};

#[test]
fn parses_common_blocks_to_typescript_compatible_model() {
    let markdown = r#"# Title

Hello **bold** and [site](https://example.com).

- One
- Two

```rust
fn main() {}
```

| A | B |
| :- | -: |
| left | right |

![Alt](https://example.com/a.png)
"#;

    let model = parse_markdown(markdown, ParseOptions::default());

    assert!(matches!(
        model.children[0],
        BlockNode::Heading { level: 1, .. }
    ));
    assert!(matches!(model.children[2], BlockNode::List { .. }));
    assert!(matches!(model.children[3], BlockNode::CodeBlock { .. }));
    assert!(matches!(model.children[4], BlockNode::Table { .. }));
    assert!(matches!(model.children[5], BlockNode::Image { .. }));

    let json = serde_json::to_value(&model).expect("model serializes");
    assert_eq!(json["children"][0]["type"], "heading");
    assert_eq!(json["children"][2]["children"][0]["type"], "listItem");
    assert_eq!(json["children"][4]["align"][0], "left");
    assert_eq!(json["children"][4]["align"][1], "right");
}

#[test]
fn preserves_inline_styles_and_links() {
    let model = parse_markdown(
        "A **bold** *em* ++under++ ~~gone~~ `code` [link](https://example.com)",
        ParseOptions::default(),
    );
    let BlockNode::Paragraph { children } = &model.children[0] else {
        panic!("expected paragraph");
    };

    assert!(children.iter().any(|node| matches!(
        node,
        InlineNode::Text {
            value,
            bold: true,
            ..
        } if value == "bold"
    )));
    assert!(children.iter().any(|node| matches!(
        node,
        InlineNode::Text {
            value,
            link: Some(url),
            ..
        } if value == "link" && url == "https://example.com"
    )));
}

#[test]
fn detects_callouts_page_breaks_toc_and_footnotes() {
    let markdown = r#"[TOC]

> [!WARNING]
> Check this.

\pagebreak

Text with note.[^a]

[^a]: Footnote body
"#;
    let model = parse_markdown(markdown, ParseOptions::default());

    assert!(matches!(model.children[0], BlockNode::TocPlaceholder));
    assert!(matches!(
        model.children[1],
        BlockNode::Blockquote {
            callout_type: Some(_),
            ..
        }
    ));
    assert!(matches!(model.children[2], BlockNode::PageBreak));
    assert_eq!(model.footnotes.as_ref().map(Vec::len), Some(1));
}

#[test]
fn contract_can_emit_model_or_document_xml() {
    let model_response = CoreRequest {
        markdown: "# Contract".to_string(),
        options: ParseOptions::default(),
        emit: EmitKind::ModelJson,
    }
    .execute();
    assert!(model_response.ok);
    assert!(model_response.model.is_some());
    assert!(model_response.document_xml.is_none());

    let xml_response = CoreRequest {
        markdown: "# Contract".to_string(),
        options: ParseOptions::default(),
        emit: EmitKind::DocumentXml,
    }
    .execute();
    assert!(xml_response.ok);
    assert!(xml_response
        .document_xml
        .as_deref()
        .unwrap()
        .contains("<w:document"));
}

#[test]
fn renderer_escapes_xml_and_writes_docx_package() {
    let model = parse_markdown("# A & B\n\nUse <tags>.", ParseOptions::default());
    let xml = render_document_xml(&model);
    assert!(xml.contains("A &amp; B"));
    assert!(xml.contains("Use &lt;tags&gt;."));

    let mut cursor = std::io::Cursor::new(Vec::new());
    write_docx(&model, &mut cursor).expect("writes minimal docx package");
    let bytes = cursor.into_inner();
    assert!(bytes.starts_with(b"PK"));
}
