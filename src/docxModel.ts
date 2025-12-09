import { Style } from "./types.js";

/**
 * Internal model representing docx-friendly document structure
 * This is an intermediate representation between mdast and docx objects
 */

export interface DocxTextNode {
  type: "text";
  value: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

export interface DocxParagraphNode {
  type: "paragraph";
  children: DocxTextNode[];
}

export interface DocxHeadingNode {
  type: "heading";
  level: number;
  children: DocxTextNode[];
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
  headers: string[];
  rows: string[][];
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
  | DocxBlockquoteNode
  | DocxImageNode
  | DocxTableNode
  | DocxCommentNode
  | DocxPageBreakNode
  | DocxTocPlaceholderNode;

export interface DocxDocumentModel {
  children: DocxBlockNode[];
}

