use std::io::{Seek, Write};

use thiserror::Error;
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::model::{BlockNode, DocumentModel, InlineNode};

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("failed to write zip package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("failed to write zip bytes: {0}")]
    Io(#[from] std::io::Error),
}

pub fn render_document_xml(model: &DocumentModel) -> String {
    let mut xml = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    xml.push_str(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
    );
    for block in &model.children {
        render_block(block, &mut xml);
    }
    xml.push_str(r#"<w:sectPr/></w:body></w:document>"#);
    xml
}

pub fn write_docx<W: Write + Seek>(model: &DocumentModel, writer: W) -> Result<(), RenderError> {
    let mut zip = ZipWriter::new(writer);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", options)?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
    )?;

    zip.add_directory("_rels/", options)?;
    zip.start_file("_rels/.rels", options)?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
    )?;

    zip.add_directory("word/", options)?;
    zip.start_file("word/document.xml", options)?;
    zip.write_all(render_document_xml(model).as_bytes())?;
    zip.finish()?;
    Ok(())
}

fn render_block(block: &BlockNode, xml: &mut String) {
    match block {
        BlockNode::Paragraph { children } => render_paragraph(children, None, xml),
        BlockNode::Heading { level, children } => {
            render_paragraph(children, Some(&format!("Heading{}", level)), xml)
        }
        BlockNode::List { children, .. } => {
            for item in children {
                for child in &item.children {
                    render_block(child, xml);
                }
            }
        }
        BlockNode::CodeBlock { value, .. }
        | BlockNode::ChartBlock { value, .. }
        | BlockNode::MermaidBlock { value, .. }
        | BlockNode::MathBlock { value } => {
            render_paragraph(&[InlineNode::text(value.as_str())], Some("Code"), xml);
        }
        BlockNode::Blockquote { children, .. } => {
            for child in children {
                render_block(child, xml);
            }
        }
        BlockNode::Image { alt, url } => {
            let text = if alt.is_empty() {
                format!("[image: {}]", url)
            } else {
                format!("[image: {}] {}", alt, url)
            };
            render_paragraph(&[InlineNode::text(text)], None, xml);
        }
        BlockNode::Table { headers, rows, .. } => render_table(headers, rows, xml),
        BlockNode::Comment { .. } => {}
        BlockNode::PageBreak => {
            xml.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#);
        }
        BlockNode::TocPlaceholder => {
            render_paragraph(&[InlineNode::text("[TOC]")], None, xml);
        }
    }
}

fn render_paragraph(children: &[InlineNode], style: Option<&str>, xml: &mut String) {
    xml.push_str("<w:p>");
    if let Some(style) = style {
        xml.push_str(r#"<w:pPr><w:pStyle w:val=""#);
        xml.push_str(&escape_xml(style));
        xml.push_str(r#""/></w:pPr>"#);
    }
    for child in children {
        render_inline(child, xml);
    }
    xml.push_str("</w:p>");
}

fn render_inline(node: &InlineNode, xml: &mut String) {
    match node {
        InlineNode::Text {
            value,
            bold,
            italic,
            underline,
            strikethrough,
            code,
            ..
        } => {
            xml.push_str("<w:r>");
            if *bold || *italic || *underline || *strikethrough || *code {
                xml.push_str("<w:rPr>");
                if *bold {
                    xml.push_str("<w:b/>");
                }
                if *italic {
                    xml.push_str("<w:i/>");
                }
                if *underline {
                    xml.push_str(r#"<w:u w:val="single"/>"#);
                }
                if *strikethrough {
                    xml.push_str("<w:strike/>");
                }
                if *code {
                    xml.push_str(r#"<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>"#);
                }
                xml.push_str("</w:rPr>");
            }
            xml.push_str(r#"<w:t xml:space="preserve">"#);
            xml.push_str(&escape_xml(value));
            xml.push_str("</w:t></w:r>");
        }
        InlineNode::MathInline { value } => {
            xml.push_str(r#"<w:r><w:t xml:space="preserve">"#);
            xml.push_str(&escape_xml(value));
            xml.push_str("</w:t></w:r>");
        }
        InlineNode::FootnoteReference { id, .. } => {
            xml.push_str("<w:r><w:t>[");
            xml.push_str(&id.to_string());
            xml.push_str("]</w:t></w:r>");
        }
    }
}

fn render_table(headers: &[Vec<InlineNode>], rows: &[Vec<Vec<InlineNode>>], xml: &mut String) {
    xml.push_str("<w:tbl>");
    render_table_row(headers, xml);
    for row in rows {
        render_table_row(row, xml);
    }
    xml.push_str("</w:tbl>");
}

fn render_table_row(cells: &[Vec<InlineNode>], xml: &mut String) {
    xml.push_str("<w:tr>");
    for cell in cells {
        xml.push_str("<w:tc>");
        render_paragraph(cell, None, xml);
        xml.push_str("</w:tc>");
    }
    xml.push_str("</w:tr>");
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
