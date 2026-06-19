use serde::{Deserialize, Serialize};

use crate::{parser::ParseOptions, render_document_xml, DocumentModel};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreRequest {
    pub markdown: String,
    #[serde(default)]
    pub options: ParseOptions,
    #[serde(default)]
    pub emit: EmitKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum EmitKind {
    #[default]
    ModelJson,
    DocumentXml,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<DocumentModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_xml: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub diagnostics: Vec<String>,
}

impl CoreRequest {
    pub fn execute(self) -> CoreResponse {
        let model = crate::parse_markdown(&self.markdown, self.options);
        match self.emit {
            EmitKind::ModelJson => CoreResponse {
                ok: true,
                model: Some(model),
                document_xml: None,
                diagnostics: Vec::new(),
            },
            EmitKind::DocumentXml => CoreResponse {
                ok: true,
                document_xml: Some(render_document_xml(&model)),
                model: Some(model),
                diagnostics: Vec::new(),
            },
        }
    }
}
