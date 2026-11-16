import type { Link, Node, PhrasingContent } from "mdast";
import type {
  DocxInlineDecoration,
  DocxInlineNode,
  DocxTextNode,
} from "../docxModel.js";
import {
  resolveCrossReference,
  throwOnUnresolvedCrossReference,
} from "../crossReferences.js";
import type { ConversionContext, ProcessOptions } from "./context.js";
import { footnoteReferenceNode } from "./footnotes.js";
import { htmlRenderingEnabled, inlineHtmlSpan } from "./html.js";
import type { InlineHtmlSpan } from "./html.js";

/** One `processInlineNodes` call: its output list and the switches it inherits. */
interface InlineRun {
  readonly context: ConversionContext;
  readonly options: ProcessOptions;
  readonly allowFootnoteReferences: boolean;
  readonly result: DocxInlineNode[];
}

type PhrasingByType = {
  [K in PhrasingContent["type"]]: Extract<PhrasingContent, { type: K }>;
};

type InlineHandlers = {
  [K in keyof PhrasingByType]?: (run: InlineRun, node: PhrasingByType[K]) => void;
};

const UNDERLINE_SPLIT = /(\+\+[^+\n][\s\S]*?\+\+)/g;
const CROSS_REFERENCE = /\[@((?:fig|tbl):[^\]\s]+)\]/g;
/** Text ending in `[label](`, left behind when GFM autolinks a link target. */
const DANGLING_LINK_OPENER = /\[[^\]]+\]\($/;

function pushTextWithUnderline(run: InlineRun, value: string): void {
  for (const part of value.split(UNDERLINE_SPLIT)) {
    if (part.startsWith("++") && part.endsWith("++") && part.length > 4) {
      run.result.push({ type: "text", value: part.slice(2, -2), underline: true });
    } else if (part.length > 0) {
      run.result.push({ type: "text", value: part });
    }
  }
}

function pushCrossReference(run: InlineRun, match: RegExpMatchArray): void {
  // Group 1 is mandatory in the pattern, so it is always present.
  const identifier = match[1]!;
  const { crossReferences } = run.context;
  const definition = resolveCrossReference(crossReferences, identifier);
  if (definition) {
    run.result.push({ type: "crossReference", ...definition });
    return;
  }
  throwOnUnresolvedCrossReference(crossReferences, identifier);
  pushTextWithUnderline(run, match[0]);
}

function pushTextAndCrossReferences(run: InlineRun, value: string): void {
  let cursor = 0;
  for (const match of value.matchAll(CROSS_REFERENCE)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      pushTextWithUnderline(run, value.slice(cursor, matchIndex));
    }
    pushCrossReference(run, match);
    cursor = matchIndex + match[0].length;
  }

  if (cursor < value.length) {
    pushTextWithUnderline(run, value.slice(cursor));
  }
}

/** A text run or inline HTML, and what it falls back to, with `decoration` on top of its own. */
function decorated(
  node: DocxInlineNode,
  decoration: DocxInlineDecoration,
): DocxInlineNode {
  if (node.type === "text") {
    return { ...node, ...decoration };
  }
  if (node.type === "htmlInline") {
    return {
      ...node,
      ...decoration,
      fallback: node.fallback.map((child) => decorated(child, decoration)),
    };
  }
  return node;
}

/** Converts `children` and applies `decoration` to each resulting text run and inline HTML. */
function pushDecorated(
  run: InlineRun,
  children: readonly PhrasingContent[],
  decoration: DocxInlineDecoration,
): void {
  for (const child of processInlineNodes(run.context, children, run.options)) {
    run.result.push(decorated(child, decoration));
  }
}

/**
 * GFM autolinks the URL in `[label](https://…)` when the link is otherwise
 * unparsable; glue the URL back onto the preceding literal text instead of
 * emitting a hyperlink.
 */
function isAutolinkedLinkTarget(
  previous: DocxInlineNode | undefined,
  link: Link,
): previous is DocxTextNode {
  const [linkText] = link.children;
  return (
    previous?.type === "text" &&
    DANGLING_LINK_OPENER.test(previous.value) &&
    link.children.length === 1 &&
    linkText?.type === "text" &&
    linkText.value === link.url
  );
}

function pushLink(run: InlineRun, link: Link): void {
  const previous = run.result[run.result.length - 1];
  if (isAutolinkedLinkTarget(previous, link)) {
    previous.value += link.url;
    return;
  }
  pushDecorated(run, link.children, { link: link.url });
}

/** Plugin-provided inline nodes may carry a non-string `value`. */
function stringifyNodeValue(value: unknown): string {
  return String(value);
}

/** Unknown inline node: keep its `value` as text, if it has one. */
function pushUnknownInline(run: InlineRun, node: Node): void {
  const value = "value" in node ? node.value : undefined;
  if (value) {
    run.result.push({ type: "text", value: stringifyNodeValue(value) });
  }
}

const INLINE_HANDLERS: InlineHandlers = {
  text: (run, node) => {
    pushTextAndCrossReferences(run, node.value);
  },
  emphasis: (run, node) => {
    pushDecorated(run, node.children, { italic: true });
  },
  strong: (run, node) => {
    pushDecorated(run, node.children, { bold: true });
  },
  delete: (run, node) => {
    pushDecorated(run, node.children, { strikethrough: true });
  },
  image: (run, node) => {
    const title = node.title ?? undefined;
    run.result.push({
      type: "inlineImage",
      url: node.url,
      alt: node.alt ?? "",
      ...(title !== undefined ? { title } : {}),
    });
  },
  inlineCode: (run, node) => {
    run.result.push({ type: "text", value: node.value, code: true });
  },
  link: pushLink,
  footnoteReference: (run, node) => {
    run.result.push(
      footnoteReferenceNode(
        run.context.footnotes,
        node,
        run.allowFootnoteReferences,
      ),
    );
  },
  inlineMath: (run, node) => {
    run.result.push({ type: "mathInline", value: node.value || "" });
  },
  break: (run) => {
    run.result.push({ type: "text", value: "\n" });
  },
};

function convertInline<K extends keyof PhrasingByType>(
  run: InlineRun,
  type: K,
  node: PhrasingByType[K],
): void {
  // Plugin nodes can carry any `type`; only the table's own keys dispatch.
  const handler = Object.prototype.hasOwnProperty.call(INLINE_HANDLERS, type)
    ? INLINE_HANDLERS[type]
    : undefined;
  if (handler) {
    handler(run, node);
  } else {
    pushUnknownInline(run, node);
  }
}

function convertEach(run: InlineRun, nodes: readonly PhrasingContent[]): void {
  for (const node of nodes) {
    convertInline(run, node.type, node);
  }
}

/** An HTML span, with what it renders as when the HTML turns out malformed. */
function pushHtmlSpan(run: InlineRun, span: InlineHtmlSpan): void {
  const fallback: InlineRun = { ...run, result: [] };
  convertEach(fallback, span.nodes);
  run.result.push({
    type: "htmlInline",
    value: span.value,
    text: span.text,
    fallback: fallback.result,
    ...(span.nestedTooDeeply ? { nestedTooDeeply: true } : {}),
  });
}

/** Converts nodes, gathering each inline HTML tag and what it wraps into one HTML span. */
function convertWithHtml(
  run: InlineRun,
  nodes: readonly PhrasingContent[],
): void {
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index]!;
    if (node.type === "html") {
      const span = inlineHtmlSpan(nodes, index, node);
      pushHtmlSpan(run, span);
      index += span.nodes.length;
    } else {
      convertInline(run, node.type, node);
      index++;
    }
  }
}

export function processInlineNodes(
  context: ConversionContext,
  nodes: readonly PhrasingContent[],
  options: ProcessOptions = {},
): DocxInlineNode[] {
  const run: InlineRun = {
    context,
    options,
    allowFootnoteReferences: options.allowFootnoteReferences ?? true,
    result: [],
  };
  if (htmlRenderingEnabled(context.options)) {
    convertWithHtml(run, nodes);
  } else {
    convertEach(run, nodes);
  }
  return run.result;
}
