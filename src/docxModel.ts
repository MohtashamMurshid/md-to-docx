/**
 * Internal model representing docx-friendly document structure
 * This is an intermediate representation between mdast and docx objects
 */
import type { Node } from "mdast";
import type { PluginHandlerReference } from "./pluginRuntime.js";

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

export interface DocxCrossReferenceNode {
  type: "crossReference";
  id: string;
  kind: "figure" | "table";
  number: number;
  bookmarkId: string;
}

export type DocxInlineNode =
  | DocxTextNode
  | DocxMathInlineNode
  | DocxFootnoteReferenceNode
  | DocxCrossReferenceNode;

export interface DocxCaption {
  id: string;
  kind: "figure" | "table";
  number: number;
  bookmarkId: string;
  children: DocxInlineNode[];
}

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
  /** GFM task state; undefined means this is an ordinary list item. */
  checked?: boolean;
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

export interface DocxChartBlockNode {
  type: "chartBlock";
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
  caption?: DocxCaption;
}

export interface DocxTableNode {
  type: "table";
  headers: DocxInlineNode[][];
  rows: DocxInlineNode[][][];
  align?: (string | null)[];
  caption?: DocxCaption;
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

export interface DocxHorizontalRuleNode {
  type: "horizontalRule";
}

export interface DocxPluginBlockNode {
  type: "pluginBlock";
  handler: PluginHandlerReference;
  source:
    | { kind: "fence"; language: string; value: string; meta?: string }
    | { kind: "blockNode"; node: Readonly<Node>; nodeType: string };
  children: DocxBlockNode[];
  /** Visible text used by the default `fallback` policy for block nodes. */
  fallbackText: string;
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
  | DocxChartBlockNode
  | DocxMermaidBlockNode
  | DocxMathBlockNode
  | DocxBlockquoteNode
  | DocxImageNode
  | DocxTableNode
  | DocxCommentNode
  | DocxPageBreakNode
  | DocxHorizontalRuleNode
  | DocxTocPlaceholderNode
  | DocxPluginBlockNode;

export interface DocxDocumentModel {
  children: DocxBlockNode[];
  footnotes?: DocxFootnoteDefinitionNode[];
}
