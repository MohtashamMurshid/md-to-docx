import type { Html, Node, PhrasingContent } from "mdast";
import type { DocxBlockNode } from "../docxModel.js";
import type { Options } from "../types.js";
import { MAX_HTML_DEPTH, VOID_ELEMENTS } from "../utils/htmlTags.js";

const HTML_COMMENT = /^\s*<!--\s*COMMENT:\s*([\s\S]*?)\s*(?:-->\s*|$)/;
const START_TAG = /^<([a-z][a-z\d-]*)/i;
const END_TAG = /^<\/[a-z]/i;
const SELF_CLOSING = /\/\s*>$/;

export function htmlRenderingEnabled(options: Options): boolean {
  return options.htmlRendering?.enabled === true;
}

/**
 * Classifies a raw HTML node value into a comment or page-break block, or
 * null when it carries no recognized marker. Shared by the top-level scan
 * and the nested (blockquote/list) block walker.
 *
 * Without `htmlRendering`, any HTML mentioning `pagebreak` is a page break,
 * as it always was. With it, HTML renders as HTML, and only a node that is
 * nothing but a `<!-- pagebreak -->` comment still breaks the page.
 */
/** A whole HTML node that is only a `<!-- pagebreak -->` comment. */
const PAGE_BREAK_COMMENT = /^\s*<!--\s*pagebreak\s*-->\s*$/i;

/**
 * With `htmlRendering` on, only a node that is nothing but a
 * `<!-- pagebreak -->` comment breaks the page, so no HTML content is lost.
 */
function isPageBreakHtml(value: string, htmlRendering: boolean): boolean {
  return htmlRendering
    ? PAGE_BREAK_COMMENT.test(value)
    : value.includes("pagebreak");
}

function classifyHtmlNode(
  value: string,
  htmlRendering: boolean,
): DocxBlockNode | null {
  const commentMatch = value.match(HTML_COMMENT);
  if (commentMatch) {
    // Group 1 is mandatory in the pattern, so it is always present on a match.
    return { type: "comment", value: commentMatch[1]!.trim() };
  }
  return isPageBreakHtml(value, htmlRendering) ? { type: "pageBreak" } : null;
}

/** HTML nodes may come from plugins without a `value`. */
export function htmlNodeValue(node: Node): string {
  return (node as { value?: string }).value || "";
}

/**
 * A raw HTML block: a comment marker, or with `htmlRendering` off a
 * page-break marker, as before; otherwise an HTML block when `htmlRendering`
 * is on, and nothing when it is off.
 */
export function convertHtmlBlock(
  options: Options,
  value: string,
): DocxBlockNode | null {
  const htmlRendering = htmlRenderingEnabled(options);
  const marker = classifyHtmlNode(value, htmlRendering);
  if (marker || !htmlRendering) {
    return marker;
  }
  return { type: "htmlBlock", value };
}

/** Raw inline HTML and the Markdown it wraps, as one piece of HTML. */
export interface InlineHtmlSpan {
  readonly nodes: readonly PhrasingContent[];
  readonly value: string;
  readonly text: string;
}

/** How one inline HTML node, which CommonMark makes a single tag, changes the open-element depth. */
function depthChange(value: string): number {
  if (END_TAG.test(value)) {
    return -1;
  }
  const name = START_TAG.exec(value)?.[1];
  if (
    name === undefined ||
    VOID_ELEMENTS.has(name.toLowerCase()) ||
    SELF_CLOSING.test(value)
  ) {
    return 0;
  }
  return 1;
}

/**
 * The index of the node that closes what the tag at `start` opens, or
 * `start` when it opens nothing or never closes. Past `MAX_HTML_DEPTH` the
 * span runs to the last node, so the HTML renderer falls back for it once,
 * instead of each unclosed tag rescanning everything after it.
 */
function spanEnd(nodes: readonly PhrasingContent[], start: number): number {
  let depth = 0;
  for (let index = start; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type === "html") {
      depth += depthChange(node.value);
    }
    if (depth <= 0) {
      return index;
    }
    if (depth > MAX_HTML_DEPTH) {
      return nodes.length - 1;
    }
  }
  return start;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapped(
  tag: string,
  children: readonly PhrasingContent[],
  attributes = "",
): string | undefined {
  const inner = serializePhrasing(children);
  return inner === undefined ? undefined : `<${tag}${attributes}>${inner}</${tag}>`;
}

/** HTML for one Markdown inline node, or undefined for one HTML cannot carry, such as a footnote reference. */
function serializeNode(node: PhrasingContent): string | undefined {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "html":
      return node.value;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "break":
      return "<br>";
    case "emphasis":
      return wrapped("em", node.children);
    case "strong":
      return wrapped("strong", node.children);
    case "delete":
      return wrapped("s", node.children);
    case "link":
      return wrapped("a", node.children, ` href="${escapeHtml(node.url)}"`);
    default:
      return undefined;
  }
}

function serializePhrasing(
  nodes: readonly PhrasingContent[],
): string | undefined {
  let html = "";
  for (const node of nodes) {
    const part = serializeNode(node);
    if (part === undefined) {
      return undefined;
    }
    html += part;
  }
  return html;
}

function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "html") return "";
      if ("value" in node) return node.value;
      return "children" in node ? plainText(node.children) : "";
    })
    .join("");
}

/**
 * The inline HTML that starts with the tag at `start`: the tag, the Markdown
 * it wraps and its end tag, when that Markdown has an HTML form. Otherwise,
 * or when the tag is never closed, the tag on its own.
 */
export function inlineHtmlSpan(
  nodes: readonly PhrasingContent[],
  start: number,
  tag: Html,
): InlineHtmlSpan {
  const span = nodes.slice(start, spanEnd(nodes, start) + 1);
  const value = serializePhrasing(span);
  return value === undefined
    ? { nodes: [tag], value: tag.value, text: "" }
    : { nodes: span, value, text: plainText(span) };
}
