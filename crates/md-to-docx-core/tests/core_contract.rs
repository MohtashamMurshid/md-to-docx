use md_to_docx_core::model::{DocxBlockNode, DocxCalloutType, DocxInlineNode};
use md_to_docx_core::ParseOptions;
use md_to_docx_core::{convert_json_request, convert_markdown};
use serde_json::json;

#[test]
fn parses_common_blocks_to_docx_model() {
    let markdown = r#"# Title

Paragraph with **bold**, *italic*, ++under++, ~~strike~~, `code`, [link](https://example.com), and $x+1$.

- One
- Two

1. First
2. Second

> [!NOTE]
> Quoted text

| Name | Count |
| :--- | ---: |
| A | 1 |

```rust
fn main() {}
```

![alt](image.png)

[TOC]
"#;

    let model = convert_markdown(markdown, &ParseOptions::default());

    assert!(matches!(
        model.children[0],
        DocxBlockNode::Heading { level: 1, .. }
    ));
    assert!(matches!(model.children[1], DocxBlockNode::Paragraph { .. }));
    assert!(matches!(
        model.children[2],
        DocxBlockNode::List { ordered: false, .. }
    ));
    assert!(matches!(
        model.children[3],
        DocxBlockNode::List {
            ordered: true,
            sequence_id: Some(1),
            ..
        }
    ));
    assert!(matches!(
        model.children[4],
        DocxBlockNode::Blockquote {
            callout_type: Some(DocxCalloutType::Note),
            ..
        }
    ));
    assert!(matches!(model.children[5], DocxBlockNode::Table { .. }));
    assert!(matches!(
        model.children[6],
        DocxBlockNode::CodeBlock {
            language: Some(_),
            ..
        }
    ));
    assert!(matches!(model.children[7], DocxBlockNode::Image { .. }));
    assert!(matches!(model.children[8], DocxBlockNode::TocPlaceholder));

    let DocxBlockNode::Paragraph { children } = &model.children[1] else {
        panic!("expected paragraph");
    };
    assert!(children.iter().any(|node| matches!(
        node,
        DocxInlineNode::Text {
            value,
            bold: true,
            ..
        } if value == "bold"
    )));
    assert!(children.iter().any(|node| matches!(
        node,
        DocxInlineNode::Text {
            value,
            link: Some(link),
            ..
        } if value == "link" && link == "https://example.com"
    )));
    assert!(children.iter().any(|node| matches!(
        node,
        DocxInlineNode::MathInline { value } if value == "x+1"
    )));
}

#[test]
fn exposes_stable_json_cli_contract() {
    let request = json!({
        "markdown": "## JSON\n\nBody",
        "options": { "mathEnabled": true }
    });

    let response = convert_json_request(&request.to_string()).expect("valid response");
    let parsed: serde_json::Value = serde_json::from_str(&response).expect("json");

    assert_eq!(parsed["model"]["children"][0]["type"], "heading");
    assert_eq!(parsed["model"]["children"][0]["level"], 2);
    assert_eq!(parsed["model"]["children"][1]["type"], "paragraph");
}

#[test]
fn can_disable_math_inline_parsing() {
    let model = convert_markdown(
        "Paragraph with $literal$ text.",
        &ParseOptions {
            math: false,
            ..ParseOptions::default()
        },
    );

    let DocxBlockNode::Paragraph { children } = &model.children[0] else {
        panic!("expected paragraph");
    };
    assert!(children
        .iter()
        .all(|node| !matches!(node, DocxInlineNode::MathInline { .. })));
}
