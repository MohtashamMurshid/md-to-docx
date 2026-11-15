import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import type { Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { MAX_HTML_DEPTH, VOID_ELEMENTS } from "../utils/htmlTags.js";


/** Formatting and structure docx/html renders, beyond GitHub's list. */
const EXTRA_TAG_NAMES = [
  "abbr",
  "address",
  "article",
  "aside",
  "big",
  "caption",
  "center",
  "cite",
  "col",
  "colgroup",
  "dfn",
  "figcaption",
  "figure",
  "font",
  "footer",
  "header",
  "main",
  "mark",
  "nav",
  "small",
  "time",
  "u",
  "wbr",
];

/**
 * GitHub's sanitizing schema, plus the formatting docx/html renders. Links
 * keep to the schemes Markdown links allow; image sources are checked again
 * by the image pipeline. Scripts and style sheets are dropped with their
 * content: CSS selectors cost time per element and rule.
 */
const HTML_SCHEMA: Schema = {
  ...defaultSchema,
  strip: ["script", "style", "template", "noscript", "title", "textarea"],
  tagNames: [...(defaultSchema.tagNames ?? []), ...EXTRA_TAG_NAMES],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "style",
      "bgColor",
    ],
    font: ["face"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "tel"],
    src: ["http", "https", "data"],
  },
};

/** Parsed HTML, and how many nodes it has, for `maxElements`. */
interface ParsedHtml {
  readonly tree: Nodes;
  readonly nodeCount: number;
}

function measure(tree: Nodes): { nodeCount: number; depth: number } {
  const stack: [Nodes, number][] = [[tree, 0]];
  // Starts below zero so the root itself is not counted.
  let nodeCount = -1;
  let depth = 0;
  while (stack.length > 0) {
    const [node, level] = stack.pop()!;
    nodeCount++;
    depth = Math.max(depth, level);
    if ("children" in node) {
      for (const child of node.children) stack.push([child, level + 1]);
    }
  }
  return { nodeCount, depth };
}

/** A start or end tag, or the start of a comment. `[^<>]` keeps every match, and so the scan, linear. */
const TAG_OR_COMMENT = /<!--|<(\/?)([a-z][a-z\d-]*)[^<>]*>/gi;

/**
 * Elements whose end tag HTML may leave out. A start tag of one closes the
 * last, so they never nest in themselves; counting them would make a list
 * or table written without its end tags look deep.
 */
const OPTIONAL_END_TAG: ReadonlySet<string> = new Set([
  "caption",
  "colgroup",
  "dd",
  "dt",
  "li",
  "optgroup",
  "option",
  "p",
  "rb",
  "rp",
  "rt",
  "rtc",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
]);

/** How a tag changes the nesting depth, given how many of each element are open. */
function tagDepthChange(match: RegExpExecArray, open: Map<string, number>): number {
  const name = match[2]!.toLowerCase();
  if (
    OPTIONAL_END_TAG.has(name) ||
    VOID_ELEMENTS.has(name) ||
    match[0].endsWith("/>")
  ) {
    return 0;
  }
  const count = open.get(name) ?? 0;
  if (match[1] === "") {
    open.set(name, count + 1);
    return 1;
  }
  // An end tag with nothing to close closes nothing.
  if (count === 0) return 0;
  open.set(name, count - 1);
  return -1;
}

/**
 * Whether the tags in `value` nest deeper than `MAX_HTML_DEPTH`, in one
 * linear pass. The parser's cost grows with depth on every tag, so HTML this
 * deep is quadratic to parse and is rejected before it is.
 */
function nestsTooDeeply(value: string): boolean {
  const pattern = new RegExp(TAG_OR_COMMENT);
  const open = new Map<string, number>();
  let depth = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match[0] === "<!--") {
      const end = value.indexOf("-->", pattern.lastIndex);
      if (end < 0) return false;
      pattern.lastIndex = end + 3;
      continue;
    }
    depth += tagDepthChange(match, open);
    if (depth > MAX_HTML_DEPTH) return true;
  }
  return false;
}

/** Parses an HTML fragment, or undefined when it is malformed or nested too deeply. */
export function parseHtml(value: string): ParsedHtml | undefined {
  if (nestsTooDeeply(value)) return undefined;
  const errors: unknown[] = [];
  let tree: Nodes;
  try {
    tree = fromHtml(value, {
      fragment: true,
      onerror: (error) => {
        errors.push(error);
      },
    });
  } catch (error) {
    // The parser's tree builder recurses, so deep nesting overflows the stack.
    if (error instanceof RangeError) return undefined;
    throw error;
  }
  const { nodeCount, depth } = measure(tree);
  return errors.length > 0 || depth > MAX_HTML_DEPTH
    ? undefined
    : { tree, nodeCount };
}

export function sanitizeHtml(tree: Nodes): Nodes {
  return sanitize(tree, HTML_SCHEMA);
}

/** The elements with a tag name, such as `img`, in a tree, in document order. */
export function elementsNamed(tree: Nodes, tagName: string): Element[] {
  const elements: Element[] = [];
  const stack: Nodes[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "element" && node.tagName === tagName) elements.push(node);
    const children = "children" in node ? node.children : [];
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push(children[index]!);
    }
  }
  return elements;
}

export function serializeHtml(tree: Nodes): string {
  return toHtml(tree);
}
