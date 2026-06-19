pub mod contract;
pub mod model;
pub mod parser;
pub mod renderer;

use thiserror::Error;

pub use contract::{CoreRequest, CoreResponse, EmitKind};
pub use model::{
    BlockNode, CalloutType, DocumentModel, DocxBlockNode, DocxCalloutType, DocxDocumentModel,
    DocxFootnoteDefinitionNode, DocxInlineNode, DocxListItemNode, FootnoteDefinitionNode,
    InlineNode, ListItemNode, TextStyle,
};
pub use parser::{parse_markdown, ParseOptions};
pub use renderer::{render_document_xml, write_docx, RenderError};

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid request JSON: {0}")]
    InvalidRequest(#[from] serde_json::Error),
}

pub fn convert_markdown(markdown: &str, options: &ParseOptions) -> DocumentModel {
    parse_markdown(markdown, options.clone())
}

pub fn convert_request(request: CoreRequest) -> CoreResponse {
    request.execute()
}

pub fn convert_json_request(input: &str) -> Result<String, CoreError> {
    let request: CoreRequest = serde_json::from_str(input)?;
    let response = convert_request(request);
    Ok(serde_json::to_string(&response)?)
}
