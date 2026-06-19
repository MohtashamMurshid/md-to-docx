use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentModel {
    pub children: Vec<BlockNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footnotes: Option<Vec<FootnoteDefinitionNode>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BlockNode {
    Paragraph {
        children: Vec<InlineNode>,
    },
    Heading {
        level: u8,
        children: Vec<InlineNode>,
    },
    List {
        ordered: bool,
        children: Vec<ListItemNode>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sequence_id: Option<u32>,
    },
    CodeBlock {
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        value: String,
    },
    ChartBlock {
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        value: String,
    },
    MermaidBlock {
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        meta: Option<String>,
    },
    MathBlock {
        value: String,
    },
    Blockquote {
        children: Vec<BlockNode>,
        #[serde(skip_serializing_if = "Option::is_none")]
        callout_type: Option<CalloutType>,
    },
    Image {
        alt: String,
        url: String,
    },
    Table {
        headers: Vec<Vec<InlineNode>>,
        rows: Vec<Vec<Vec<InlineNode>>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        align: Option<Vec<Option<String>>>,
    },
    Comment {
        value: String,
    },
    PageBreak,
    TocPlaceholder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemNode {
    pub r#type: String,
    pub children: Vec<BlockNode>,
}

impl ListItemNode {
    pub fn new(children: Vec<BlockNode>) -> Self {
        Self {
            r#type: "listItem".to_string(),
            children,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalloutType {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InlineNode {
    Text {
        value: String,
        #[serde(default, skip_serializing_if = "is_false")]
        bold: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        italic: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        underline: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        strikethrough: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        code: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        link: Option<String>,
    },
    MathInline {
        value: String,
    },
    FootnoteReference {
        identifier: String,
        id: u32,
    },
}

impl InlineNode {
    pub fn text(value: impl Into<String>) -> Self {
        Self::styled_text(value, TextStyle::default())
    }

    pub fn styled_text(value: impl Into<String>, style: TextStyle) -> Self {
        Self::Text {
            value: value.into(),
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
            strikethrough: style.strikethrough,
            code: style.code,
            link: style.link,
        }
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootnoteDefinitionNode {
    pub identifier: String,
    pub id: u32,
    pub children: Vec<BlockNode>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub code: bool,
    pub link: Option<String>,
}

impl TextStyle {
    pub fn with_bold(mut self) -> Self {
        self.bold = true;
        self
    }

    pub fn with_italic(mut self) -> Self {
        self.italic = true;
        self
    }

    pub fn with_underline(mut self) -> Self {
        self.underline = true;
        self
    }

    pub fn with_strikethrough(mut self) -> Self {
        self.strikethrough = true;
        self
    }

    pub fn with_code(mut self) -> Self {
        self.code = true;
        self
    }

    pub fn with_link(mut self, link: String) -> Self {
        self.link = Some(link);
        self
    }
}

pub type DocxDocumentModel = DocumentModel;
pub type DocxBlockNode = BlockNode;
pub type DocxInlineNode = InlineNode;
pub type DocxListItemNode = ListItemNode;
pub type DocxCalloutType = CalloutType;
pub type DocxFootnoteDefinitionNode = FootnoteDefinitionNode;
