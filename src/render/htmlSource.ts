import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import type { Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { MAX_HTML_DEPTH, VOID_ELEMENTS } from "../utils/htmlTags.js";
import { decodeFragment } from "./links.js";

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

/**
 * A start or end tag, or the start of a comment. The attributes start with a
 * character the name cannot hold, so the two parts never compete for the
 * same characters, and `[^<>]` keeps every match, and so the scan, linear.
 */
const TAG_OR_COMMENT = /<!--|<(\/?)([a-z][a-z\d-]*)(?:[^<>a-z\d-][^<>]*)?>/gi;

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

/**
 * How a tag changes the nesting depth, given how many of each element are
 * open. HTML ignores the slash in `<div/>`, so every start tag of a non-void
 * element opens one. In SVG and MathML a slash does close the element, but
 * telling where that content ends takes the parser's own rules; counting it
 * as open only falls back sooner, and the sanitizer unwraps both anyway.
 */
function tagDepthChange(match: RegExpExecArray, open: Map<string, number>): number {
  const name = match[2]!.toLowerCase();
  if (OPTIONAL_END_TAG.has(name) || VOID_ELEMENTS.has(name)) {
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

/** The elements with a tag name, such as `img`, or all of them, in a tree, in document order. */
export function elementsNamed(tree: Nodes, tagName?: string): Element[] {
  const elements: Element[] = [];
  const stack: Nodes[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "element" && (tagName === undefined || node.tagName === tagName)) {
      elements.push(node);
    }
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

/** The ids a link in the tree can go to: each element's `id`, and each `<a>`'s `name`. */
function targetIds(tree: Nodes): Set<string> {
  const ids = new Set<string>();
  for (const element of elementsNamed(tree)) {
    const names = element.tagName === "a" ? ["id", "name"] : ["id"];
    for (const value of names.map((name) => element.properties[name])) {
      if (typeof value === "string") ids.add(value);
    }
  }
  return ids;
}

/**
 * Points each fragment link in sanitized HTML at its target. The sanitizer
 * prefixes `id` and `name`, so a link to an element in the same HTML gets the
 * prefix too. Any other fragment, such as a Markdown heading's, gets a
 * placeholder docx/html keeps as the anchor; the result maps each placeholder
 * to its fragment, for the renderer to resolve against the headings.
 */
export function pointFragmentLinks(tree: Nodes): Map<string, string> {
  const ids = targetIds(tree);
  const prefix = HTML_SCHEMA.clobberPrefix ?? "";
  const outside = new Map<string, string>();
  for (const link of elementsNamed(tree, "a")) {
    const href = link.properties.href;
    if (typeof href !== "string" || !href.startsWith("#") || href === "#") continue;
    const fragment = decodeFragment(href.slice(1));
    const target = `${prefix}${fragment}`;
    if (ids.has(target)) {
      // docx/html decodes the fragment, so a literal `%` is escaped.
      link.properties.href = `#${target.replace(/%/g, "%25")}`;
      continue;
    }
    // A letter, then letters and digits: docx/html keeps such a short name as it is.
    const placeholder = `mdToDocxLink${outside.size}`;
    outside.set(placeholder, fragment);
    link.properties.href = `#${placeholder}`;
  }
  return outside;
}
