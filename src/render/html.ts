import type * as DocxHtml from "docx/html";
import type { HtmlOptions } from "docx/html";
import { InternalHyperlink, TextRun } from "docx";
import type { ParagraphChild } from "docx";
import type { Element } from "hast";
import type {
  DocxHtmlBlockNode,
  DocxHtmlInlineNode,
  DocxInlineDecoration,
} from "../docxModel.js";
import { MarkdownConversionError } from "../errors.js";
import { throwIfAborted } from "../processingLimits.js";
import { assertImageAltPolicy, validateImageText } from "../accessibility.js";
import { detectImageType } from "../renderers/imageFormat.js";
import { loadNormalizedImage } from "../renderers/imageRenderer.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import type { Block, InlineOverrides, RenderEnv } from "./context.js";
import {
  countImageAttempt,
  imageBudgetReached,
  isRemoteImageUrl,
  remoteFailureBudgetReached,
} from "./imageBudget.js";
import type * as HtmlSource from "./htmlSource.js";
import { isSafeLinkUrl, linkHtmlFragments, linkKind, linkRuns } from "./links.js";
import type { LinkKind } from "./links.js";
import { runSize } from "./runs.js";

/** A `<br>`, with any attributes, with or without a slash. */
const LINE_BREAK_TAG = /^<br(?:\s[^<>]*)?\/?>$/i;

interface HtmlTools {
  readonly docxHtml: typeof DocxHtml;
  readonly htmlSource: typeof HtmlSource;
}

let htmlTools: Promise<HtmlTools> | undefined;

/**
 * docx/html and the HTML parser load on first use, so conversions without
 * raw HTML, and browser bundles, do not load them up front.
 */
function loadHtmlTools(): Promise<HtmlTools> {
  htmlTools ??= Promise.all([
    import("docx/html"),
    import("./htmlSource.js"),
  ]).then(([docxHtml, htmlSource]) => ({ docxHtml, htmlSource }));
  return htmlTools;
}

/** Sanitized HTML, with each image's source replaced by a key into `images`. */
export interface PreparedHtml {
  readonly source: string;
  readonly html: string;
  readonly images: ReadonlyMap<string, Uint8Array>;
  /** Placeholder anchors of links out of the HTML, and the fragments they stand for. */
  readonly fragments: ReadonlyMap<string, string>;
  readonly docxHtml: typeof DocxHtml;
}

function chargeElements(env: RenderEnv, nodeCount: number): void {
  const { pluginElementCounter: counter, maxElements } = env.renderOptions;
  if (!counter) return;
  counter.count += nodeCount;
  if (maxElements !== undefined && counter.count > maxElements) {
    throw new MarkdownConversionError(
      "Markdown element count exceeds maxElements",
      { elementCount: counter.count, maxElements },
    );
  }
}

function stringProperty(element: Element, name: string): string | undefined {
  const value = element.properties[name];
  return typeof value === "string" ? value : undefined;
}

/** An image's bytes under the image policy and budget, or undefined, with a warning, when it is left out. */
async function loadHtmlImage(
  env: RenderEnv,
  source: string,
): Promise<Uint8Array | undefined> {
  const { onWarning, signal } = env.options;
  if (source === "") {
    // The sanitizer removes sources with schemes other than http, https and data.
    onWarning?.({ code: "IMAGE_FALLBACK", message: "HTML image has no allowed source" });
    return undefined;
  }
  const remote = isRemoteImageUrl(source);
  if (imageBudgetReached(env) || remoteFailureBudgetReached(env, remote)) {
    onWarning?.({ code: "IMAGE_FALLBACK", message: "Image limit reached", source });
    return undefined;
  }
  try {
    const { image, data } = await loadNormalizedImage(source, env.imageHandling, signal);
    // Only the rasters a Markdown image may embed. Anything else, such as an
    // SVG the normalizer did not recognize and so never validated, is refused.
    detectImageType(data, image.contentType, source);
    countImageAttempt(env, true, remote);
    return data;
  } catch (error) {
    if (error instanceof MarkdownConversionError) throw error;
    countImageAttempt(env, false, remote);
    const message = error instanceof Error ? error.message : String(error);
    onWarning?.({ code: "IMAGE_FALLBACK", message, source });
    return undefined;
  }
}

/** Points an `<img>` at its loaded bytes, or turns it into an empty `<span>` when it is left out. */
async function embedHtmlImage(
  env: RenderEnv,
  element: Element,
  images: Map<string, Uint8Array>,
): Promise<void> {
  const alt = stringProperty(element, "alt") ?? "";
  validateImageText(alt, stringProperty(element, "title"), "HTML image");
  assertImageAltPolicy(alt, env.options.accessibility, "HTML image");
  const data = await loadHtmlImage(env, stringProperty(element, "src") ?? "");
  if (data === undefined) {
    element.tagName = "span";
    element.properties = {};
    return;
  }
  const key = `md-to-docx-image-${images.size}`;
  images.set(key, data);
  element.properties.src = key;
}

/** Keeps a link's text but drops its target when a Markdown link to it would be refused. */
function dropUnsafeHref(element: Element): void {
  const href = stringProperty(element, "href");
  if (href !== undefined && !href.startsWith("#") && !isSafeLinkUrl(href)) {
    delete element.properties.href;
  }
}

function warnHtmlFallback(env: RenderEnv, source: string): void {
  env.options.onWarning?.({
    code: "HTML_FALLBACK",
    message: "Raw HTML is malformed or nested too deeply; rendered as without htmlRendering",
    source,
    sectionIndex: env.renderOptions.pluginSection?.index,
  });
}

/**
 * Parses, counts and sanitizes raw HTML and loads its images. Undefined, with
 * an `HTML_FALLBACK` warning, when the HTML is malformed or nested too deeply.
 */
async function prepareHtml(
  env: RenderEnv,
  source: string,
): Promise<PreparedHtml | undefined> {
  throwIfAborted(env.options.signal);
  const { docxHtml, htmlSource } = await loadHtmlTools();
  const parsed = htmlSource.parseHtml(source);
  if (!parsed) {
    warnHtmlFallback(env, source);
    return undefined;
  }
  chargeElements(env, parsed.nodeCount);
  const tree = htmlSource.sanitizeHtml(parsed.tree);
  for (const link of htmlSource.elementsNamed(tree, "a")) dropUnsafeHref(link);
  const fragments = htmlSource.pointFragmentLinks(tree);
  const images = new Map<string, Uint8Array>();
  for (const element of htmlSource.elementsNamed(tree, "img")) {
    throwIfAborted(env.options.signal);
    await embedHtmlImage(env, element, images);
  }
  return {
    source,
    html: htmlSource.serializeHtml(tree),
    images,
    fragments,
    docxHtml,
  };
}

/** Inline HTML, prepared; undefined, with a warning, when it renders as its fallback. */
export async function prepareInlineHtml(
  env: RenderEnv,
  node: DocxHtmlInlineNode,
): Promise<PreparedHtml | undefined> {
  if (node.nestedTooDeeply) {
    warnHtmlFallback(env, node.value);
    return undefined;
  }
  return prepareHtml(env, node.value);
}

function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, " ")}"`;
}

/** The text colour of a run, as a Markdown text run with the same link has. */
function textColor(
  kind: LinkKind | undefined,
  overrides: InlineOverrides,
): string | undefined {
  if (kind === "external") return "0000FF";
  if (kind === "internal") return overrides.color || "0000FF";
  return overrides.color;
}

/** The lines a Markdown text run with the same decoration has: an external link's underline, and strikethrough. */
function decorationLines(
  kind: LinkKind | undefined,
  decoration: DocxInlineDecoration,
): string[] {
  return [
    ...(kind === "external" ? ["underline"] : []),
    ...(decoration.strikethrough ? ["line-through"] : []),
  ];
}

/**
 * The body text style docx/html gives the HTML, so it matches the Markdown
 * around it, including the formatting and link of Markdown around inline HTML.
 */
function bodyStylesheet(
  env: RenderEnv,
  overrides: InlineOverrides,
  decoration: DocxInlineDecoration,
): string {
  const font = resolveFontFamily(env.style);
  const kind = decoration.link === undefined ? undefined : linkKind(decoration.link);
  const color = textColor(kind, overrides);
  const lines = decorationLines(kind, decoration);
  const declarations = [
    `font-size: ${runSize(env.style, overrides) / 2}pt`,
    ...(font !== undefined ? [`font-family: ${cssString(font)}`] : []),
    ...(overrides.forceBold || decoration.bold ? ["font-weight: bold"] : []),
    ...(overrides.forceItalic || decoration.italic ? ["font-style: italic"] : []),
    ...(color ? [`color: #${color}`] : []),
    ...(lines.length > 0 ? [`text-decoration-line: ${lines.join(" ")}`] : []),
  ];
  return `body { ${declarations.join("; ")} }`;
}

function htmlOptions(
  env: RenderEnv,
  prepared: PreparedHtml,
  overrides: InlineOverrides,
  decoration: DocxInlineDecoration,
): HtmlOptions {
  return {
    stylesheet: bodyStylesheet(env, overrides, decoration),
    images: (key) => prepared.images.get(key),
    onWarning: (warning) => {
      env.options.onWarning?.({
        code: "UNSUPPORTED_CONTENT",
        message: warning.message,
        source: prepared.source,
      });
    },
  };
}

/** Runs for prepared inline HTML, with the formatting and link of the Markdown around it. */
export function htmlRuns(
  env: RenderEnv,
  prepared: PreparedHtml,
  decoration: DocxInlineDecoration,
  overrides: InlineOverrides,
): readonly ParagraphChild[] {
  // docx/html, like a browser, drops a break that ends its HTML, as a lone <br> does.
  const runs = LINE_BREAK_TAG.test(prepared.source)
    ? [new TextRun({ break: 1 })]
    : prepared.docxHtml.htmlToRuns(
        prepared.html,
        htmlOptions(env, prepared, overrides, decoration),
      );
  linkHtmlFragments(
    env,
    runs.filter((run) => run instanceof InternalHyperlink),
    prepared.fragments,
  );
  return decoration.link === undefined ? runs : linkRuns(env, decoration.link, runs);
}

/** Paragraphs and tables for an HTML block; nothing when it is malformed, as without htmlRendering. */
export async function renderHtmlBlock(
  env: RenderEnv,
  node: DocxHtmlBlockNode,
): Promise<Block[]> {
  const prepared = await prepareHtml(env, node.value);
  if (!prepared) {
    return [];
  }
  const content = prepared.docxHtml.htmlToContent(
    prepared.html,
    htmlOptions(env, prepared, {}, {}),
  );
  linkHtmlFragments(env, content, prepared.fragments);
  return [...content];
}
