/**
 * Internal model representing docx-friendly document structure
 * This is an intermediate representation between mdast and docx objects
 */

export interface DocxTextNode {
  type: "text";
  value: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
}

export interface DocxMathInlineNode {
  type: "mathInline";
  value: string;
}

export interface DocxFootnoteReferenceNode {
  type: "footnoteReference";
  identifier: string;
  id: number;
}

export type DocxInlineNode =
  | DocxTextNode
  | DocxMathInlineNode
  | DocxFootnoteReferenceNode;

export interface DocxParagraphNode {
  type: "paragraph";
  children: DocxInlineNode[];
}

export interface DocxHeadingNode {
  type: "heading";
  level: number;
  children: DocxInlineNode[];
}

export interface DocxListItemNode {
  type: "listItem";
  children: DocxBlockNode[];
}

export interface DocxListNode {
  type: "list";
  ordered: boolean;
  children: DocxListItemNode[];
  sequenceId?: number; // For numbered lists, tracks sequence across document
}

export interface DocxCodeBlockNode {
  type: "codeBlock";
  language?: string;
  value: string;
}

export interface DocxMermaidBlockNode {
  type: "mermaidBlock";
  value: string;
  meta?: string;
}

export interface DocxMathBlockNode {
  type: "mathBlock";
  value: string;
}

export type DocxCalloutType =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution";

export interface DocxBlockquoteNode {
  type: "blockquote";
  children: DocxBlockNode[];
  calloutType?: DocxCalloutType;
}

export interface DocxImageNode {
  type: "image";
  alt: string;
  url: string;
}

export interface DocxTableNode {
  type: "table";
  headers: DocxInlineNode[][];
  rows: DocxInlineNode[][][];
  align?: (string | null)[];
}

export interface DocxCommentNode {
  type: "comment";
  value: string;
}

export interface DocxPageBreakNode {
  type: "pageBreak";
}

export interface DocxTocPlaceholderNode {
  type: "tocPlaceholder";
}

export interface DocxFootnoteDefinitionNode {
  identifier: string;
  id: number;
  children: DocxBlockNode[];
}

export type DocxBlockNode =
  | DocxParagraphNode
  | DocxHeadingNode
  | DocxListNode
  | DocxCodeBlockNode
  | DocxMermaidBlockNode
  | DocxMathBlockNode
  | DocxBlockquoteNode
  | DocxImageNode
  | DocxTableNode
  | DocxCommentNode
  | DocxPageBreakNode
  | DocxTocPlaceholderNode;

export interface DocxDocumentModel {
  children: DocxBlockNode[];
  footnotes?: DocxFootnoteDefinitionNode[];
}
