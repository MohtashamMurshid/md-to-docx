import type {
  Blockquote,
  Code,
  Heading,
  Image,
  List,
  Node,
  Paragraph,
  Table,
} from "mdast";
import type { DocxBlockNode, DocxCalloutType } from "../docxModel.js";
import type { RichTableAst } from "../richTables.js";
import type { BlockResult, ConversionContext, ProcessOptions } from "./context.js";
import { convertBlocks } from "./context.js";
import { processCodeBlock } from "./codeBlocks.js";
import { processInlineNodes } from "./inline.js";
import { processList } from "./lists.js";
import { processRichTable, processTable } from "./tables.js";

type BlockHandler = (
  context: ConversionContext,
  node: Node,
  options: ProcessOptions,
) => BlockResult;

const GITHUB_CALLOUT_MARKER =
  /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n[ \t]*)?/i;
const HTML_COMMENT = /^\s*<!--\s*COMMENT:\s*([\s\S]*?)\s*(?:-->\s*|$)/;

/**
 * Classifies a raw HTML node value into a comment or page-break block, or
 * null when it carries no recognized marker. Shared by the top-level scan
 * and the nested (blockquote/list) block walker.
 */
export function classifyHtmlNode(value: string): DocxBlockNode | null {
  const commentMatch = value.match(HTML_COMMENT);
  if (commentMatch) {
    // Group 1 is mandatory in the pattern, so it is always present on a match.
    return { type: "comment", value: commentMatch[1]!.trim() };
  }
  if (value.includes("pagebreak")) {
    return { type: "pageBreak" };
  }
  return null;
}

/** HTML nodes may come from plugins without a `value`. */
export function htmlNodeValue(node: Node): string {
  return (node as { value?: string }).value || "";
}

function imageBlock(image: Image): DocxBlockNode {
  return {
    type: "image",
    alt: image.alt || "",
    ...(image.title ? { title: image.title } : {}),
    url: image.url || "",
  };
}

function processHeading(
  context: ConversionContext,
  heading: Heading,
  options: ProcessOptions,
): DocxBlockNode {
  return {
    type: "heading",
    level: heading.depth,
    children: processInlineNodes(context, heading.children, options),
  };
}

/** A paragraph holding a single image is a block image. */
function processParagraph(
  context: ConversionContext,
  paragraph: Paragraph,
  options: ProcessOptions,
): DocxBlockNode {
  const [img] = paragraph.children;
  if (paragraph.children.length === 1 && img?.type === "image") {
    return imageBlock(img);
  }
  return {
    type: "paragraph",
    children: processInlineNodes(context, paragraph.children, options),
  };
}

function stripGithubCalloutMarker(
  paragraph: Paragraph,
): { calloutType: DocxCalloutType; paragraph: Paragraph | null } | null {
  const firstChild = paragraph.children[0];
  if (firstChild?.type !== "text") {
    return null;
  }

  const markerMatch = firstChild.value.match(GITHUB_CALLOUT_MARKER);
  if (!markerMatch) {
    return null;
  }

  // Group 1 is mandatory in the pattern, so it is always present on a match.
  const calloutType = markerMatch[1]!.toLowerCase() as DocxCalloutType;
  const remainingValue = firstChild.value.slice(markerMatch[0].length);
  const children = [
    ...(remainingValue.length > 0
      ? [{ ...firstChild, value: remainingValue }]
      : []),
    ...paragraph.children.slice(1),
  ] as Paragraph["children"];

  return {
    calloutType,
    paragraph: children.length > 0 ? { ...paragraph, children } : null,
  };
}

function processBlockquote(
  context: ConversionContext,
  blockquote: Blockquote,
  options: ProcessOptions,
): DocxBlockNode {
  const firstChild = blockquote.children[0];
  const callout =
    firstChild?.type === "paragraph"
      ? stripGithubCalloutMarker(firstChild)
      : null;
  const blockquoteChildren = callout
    ? [
        ...(callout.paragraph ? [callout.paragraph] : []),
        ...blockquote.children.slice(1),
      ]
    : blockquote.children;

  return {
    type: "blockquote",
    children: convertBlocks(context, blockquoteChildren, options),
    ...(callout ? { calloutType: callout.calloutType } : {}),
  };
}

function extractNodeText(node: Node): string {
  const value = (node as Node & { value?: unknown }).value;
  if (typeof value === "string") {
    return value;
  }
  const nodeChildren = (node as Node & { children?: unknown }).children;
  if (Array.isArray(nodeChildren)) {
    return nodeChildren
      .map((child) => extractNodeText(child as Node))
      .filter(Boolean)
      .join("\n");
  }
  return `[Unsupported Markdown node: ${node.type}]`;
}

/** Any other node type renders only if a plugin registered a handler for it. */
function processPluginBlockNode(
  context: ConversionContext,
  node: Node,
  options: ProcessOptions,
): DocxBlockNode | null {
  const handler = context.pluginRuntime?.blockNode(node.type);
  if (!handler) {
    return null;
  }

  const nodeChildren = (node as Node & { children?: unknown }).children;
  return {
    type: "pluginBlock",
    handler,
    source: { kind: "blockNode", node, nodeType: node.type },
    children: Array.isArray(nodeChildren)
      ? convertBlocks(context, nodeChildren as Node[], options)
      : [],
    fallbackText: extractNodeText(node),
  };
}

// The casts mirror the dispatch: each handler is looked up by its node's type.
const BLOCK_HANDLERS: Record<string, BlockHandler> = {
  heading: (context, node, options) =>
    processHeading(context, node as Heading, options),
  paragraph: (context, node, options) =>
    processParagraph(context, node as Paragraph, options),
  list: (context, node, options) => processList(context, node as List, options),
  code: (context, node) => processCodeBlock(context, node as Code),
  math: (_context, node) => ({
    type: "mathBlock",
    value: (node as { value?: string }).value || "",
  }),
  blockquote: (context, node, options) =>
    processBlockquote(context, node as Blockquote, options),
  image: (_context, node) => imageBlock(node as Image),
  richTable: (context, node, options) =>
    processRichTable(context, node as RichTableAst, options),
  table: (context, node, options) =>
    processTable(context, node as Table, options),
  html: (_context, node) => classifyHtmlNode(htmlNodeValue(node)),
  thematicBreak: () => ({ type: "horizontalRule" }),
};

export function convertBlockNode(
  context: ConversionContext,
  node: Node,
  options: ProcessOptions,
): BlockResult {
  // Plugin nodes can carry any `type`; only the table's own keys dispatch.
  const handler = Object.prototype.hasOwnProperty.call(BLOCK_HANDLERS, node.type)
    ? BLOCK_HANDLERS[node.type]
    : undefined;
  return (handler ?? processPluginBlockNode)(context, node, options);
}
