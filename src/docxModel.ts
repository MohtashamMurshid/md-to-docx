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

export type DocxInlineNode = DocxTextNode | DocxMathInlineNode;

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

export interface DocxMathBlockNode {
  type: "mathBlock";
  value: string;
}

export interface DocxBlockquoteNode {
  type: "blockquote";
  children: DocxBlockNode[];
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

export type DocxBlockNode =
  | DocxParagraphNode
  | DocxHeadingNode
  | DocxListNode
  | DocxCodeBlockNode
  | DocxMathBlockNode
  | DocxBlockquoteNode
  | DocxImageNode
  | DocxTableNode
  | DocxCommentNode
  | DocxPageBreakNode
  | DocxTocPlaceholderNode;

export interface DocxDocumentModel {
  children: DocxBlockNode[];
}
