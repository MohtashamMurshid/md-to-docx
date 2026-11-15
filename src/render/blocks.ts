import { PageBreak, Paragraph, TextRun } from "docx";
import type { IRunOptions } from "docx";
import type { DocxBlockNode } from "../docxModel.js";
import { processHeading } from "../renderers/headingRenderer.js";
import { processCodeBlock } from "../renderers/codeRenderer.js";
import { resolveCalloutStyle } from "../renderers/blockquoteRenderer.js";
import { processComment } from "../renderers/commentRenderer.js";
import { processHorizontalRule } from "../renderers/horizontalRuleRenderer.js";
import {
  registerHeading,
  sanitizeForBookmarkId,
} from "../utils/bookmarkUtils.js";
import { throwIfAborted } from "../processingLimits.js";
import { ROOT_PLACEMENT } from "./context.js";
import type {
  Block,
  BlockRenderers,
  InlineOverrides,
  Placement,
  RenderContext,
  RenderEnv,
} from "./context.js";
import { withCaption } from "./captions.js";
import { renderChartNode, renderImageNode } from "./images.js";
import {
  renderInlineNodes,
  renderMathNode,
  textFromInlineNodes,
} from "./inline.js";
import { prepareInlineImages } from "./inlineImages.js";
import { listParagraph, renderList } from "./lists.js";
import { renderMermaidNode } from "./mermaid.js";
import {
  bodyAlignment,
  bodySpacing,
  paragraphFromInlineNodes,
  quoteParagraphOptions,
  quoteStyleFor,
} from "./paragraphs.js";
import { renderPluginNode } from "./plugins.js";
import { fontOption, languageOption } from "./runs.js";
import { tableFromNode } from "./tables.js";

type NodeOf<K extends DocxBlockNode["type"]> = Extract<
  DocxBlockNode,
  { type: K }
>;
type BlockRenderer<T extends DocxBlockNode> = (
  env: RenderEnv,
  node: T,
  at: Placement,
) => Block[] | Promise<Block[]>;
type BlockRendererTable<K extends DocxBlockNode["type"]> = {
  [P in K]: BlockRenderer<NodeOf<P>>;
};

/** A heading with a unique TOC bookmark; inside a footnote, a plain paragraph. */
function renderHeading(
  env: RenderEnv,
  node: NodeOf<"heading">,
  { context }: Placement,
): Block[] {
  if (context.inFootnote) {
    return [paragraphFromInlineNodes(env, node.children, context)];
  }

  const headingText = textFromInlineNodes(env, node.children);
  const counter = env.headingBookmarkCounter;
  counter.count++;
  // Keeps the name within Word's 40-character bookmark limit, suffix included.
  const suffix = String(counter.count);
  const bookmarkId = `_Toc_${sanitizeForBookmarkId(headingText).slice(0, 33 - suffix.length)}_${suffix}`;
  const { paragraph } = processHeading(
    node.children,
    { level: node.level, bookmarkId },
    env.style,
    (nodes, size) => renderInlineNodes(env, nodes, { size }),
  );
  registerHeading(env.headingAnchors, headingText, bookmarkId);
  env.headings.push({ text: headingText, level: node.level, bookmarkId });
  return [paragraph];
}

function renderMathBlock(env: RenderEnv, node: NodeOf<"mathBlock">): Block[] {
  const { style } = env;
  return [
    new Paragraph({
      children: [renderMathNode(env, node.value, true)],
      spacing: bodySpacing(style),
      alignment: bodyAlignment(style),
      bidirectional: style.direction === "RTL",
    }),
  ];
}

/** A comment; inside a blockquote, an italic grey paragraph in the quote's style. */
function renderComment(
  env: RenderEnv,
  node: NodeOf<"comment">,
  { context }: Placement,
): Block[] {
  const { style } = env;
  if (!context.quoteLevel) {
    return [processComment(node.value, style)];
  }
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `Comment: ${node.value}`,
          italics: true,
          color: "666666",
          ...fontOption(style),
          ...languageOption(style),
          rightToLeft: style.direction === "RTL",
        } satisfies IRunOptions),
      ],
      ...quoteParagraphOptions(quoteStyleFor(style, context)),
    }),
  ];
}

function renderTocPlaceholder(env: RenderEnv): Block[] {
  const placeholder = new Paragraph({});
  env.renderOptions.tocPlaceholders?.add(placeholder);
  return [placeholder];
}

function blockquoteSize(env: RenderEnv): number {
  return env.style.blockquoteSize || 24;
}

/** A child of a blockquote; its paragraphs take the quote's text style. */
async function renderQuotedBlock(
  env: RenderEnv,
  child: DocxBlockNode,
  quoteContext: RenderContext,
  textOverrides: InlineOverrides,
): Promise<Block[]> {
  throwIfAborted(env.options.signal);
  if (child.type !== "paragraph") {
    return renderBlockNode(env, child, { listLevel: 0, context: quoteContext });
  }
  await prepareInlineImages(env, child.children);
  return [
    paragraphFromInlineNodes(env, child.children, quoteContext, textOverrides),
  ];
}

/** A blockquote or callout. A callout opens with its bold title; plain quotes are italic. */
async function renderBlockquote(
  env: RenderEnv,
  node: NodeOf<"blockquote">,
  { context }: Placement,
): Promise<Block[]> {
  throwIfAborted(env.options.signal);

  const { calloutType } = node;
  const size = blockquoteSize(env);
  const quoteContext: RenderContext = {
    ...context,
    quoteLevel: (context.quoteLevel || 0) + 1,
    calloutType: calloutType || context.calloutType,
  };
  const out: Block[] = [];
  if (calloutType) {
    const callout = resolveCalloutStyle(env.style, calloutType);
    out.push(
      paragraphFromInlineNodes(
        env,
        [{ type: "text", value: callout.label }],
        quoteContext,
        { size, forceBold: true, color: callout.titleColor },
      ),
    );
  }

  const textOverrides: InlineOverrides = calloutType
    ? { size }
    : { size, forceItalic: true };
  if (node.children.length === 0 && !calloutType) {
    out.push(paragraphFromInlineNodes(env, [], quoteContext, textOverrides));
  }
  for (const child of node.children) {
    out.push(
      ...(await renderQuotedBlock(env, child, quoteContext, textOverrides)),
    );
  }
  return out;
}

const BLOCK_RENDERERS: BlockRendererTable<DocxBlockNode["type"]> = {
  heading: renderHeading,
  paragraph: (env, node, { context }) => [
    paragraphFromInlineNodes(env, node.children, context),
  ],
  list: (env, node, { listLevel, context }) =>
    renderList(env, node, listLevel || 0, context),
  codeBlock: (env, node) => [
    processCodeBlock(
      node.value,
      node.language,
      env.style,
      env.options.codeHighlighting,
    ),
  ],
  mathBlock: renderMathBlock,
  blockquote: renderBlockquote,
  image: async (env, node, { context }) =>
    withCaption(env, node, await renderImageNode(env, node, context)),
  mermaidBlock: (env, node, { context }) =>
    renderMermaidNode(env, node, context),
  chartBlock: (env, node, { context }) => renderChartNode(env, node, context),
  pluginBlock: (env, node, { listLevel, context }) =>
    renderPluginNode(env, node, { listLevel, context }),
  table: async (env, node) =>
    withCaption(env, node, [await tableFromNode(env, node)]),
  comment: renderComment,
  pageBreak: () => [new Paragraph({ children: [new PageBreak()] })],
  horizontalRule: (env, _node, { context }) => [
    processHorizontalRule(
      env.style,
      quoteParagraphOptions(quoteStyleFor(env.style, context)),
    ),
  ],
  tocPlaceholder: renderTocPlaceholder,
};

function dispatch<K extends DocxBlockNode["type"]>(
  table: BlockRendererTable<K>,
  env: RenderEnv,
  node: NodeOf<K>,
  at: Placement,
): Block[] | Promise<Block[]> {
  const render = table[node.type] as BlockRenderer<NodeOf<K>>;
  return render(env, node, at);
}

/** Fetches the inline images a block's text or caption holds. */
async function prepareBlockImages(
  env: RenderEnv,
  node: DocxBlockNode,
): Promise<void> {
  if (node.type === "paragraph" || node.type === "heading")
    await prepareInlineImages(env, node.children);
  if ((node.type === "table" || node.type === "image") && node.caption)
    await prepareInlineImages(env, node.caption.children);
}

async function renderBlockNode(
  env: RenderEnv,
  node: DocxBlockNode,
  at: Placement = ROOT_PLACEMENT,
): Promise<Block[]> {
  throwIfAborted(env.options.signal);
  await prepareBlockImages(env, node);
  return dispatch(BLOCK_RENDERERS, env, node, at);
}

/** An empty paragraph that only shows the list marker, ahead of a block that cannot carry one. */
function markerOnlyParagraphs(env: RenderEnv, at: Placement): Paragraph[] {
  return at.marker ? [listParagraph(env, [], at.marker, at.context)] : [];
}

/**
 * Blocks that render differently inside a list item: images, charts and
 * diagrams carry the marker themselves, and rules indent under the item.
 */
const LIST_ITEM_RENDERERS: BlockRendererTable<
  "horizontalRule" | "image" | "chartBlock" | "mermaidBlock" | "pluginBlock"
> = {
  horizontalRule: (env, _node, at) => {
    const quoteStyle = quoteStyleFor(env.style, at.context);
    const quoteIndent = quoteStyle?.indent.left ?? 0;
    return [
      ...markerOnlyParagraphs(env, at),
      processHorizontalRule(env.style, {
        ...quoteParagraphOptions(quoteStyle),
        indent: { left: quoteIndent + 720 * (at.listLevel + 1) },
      }),
    ];
  },
  image: (env, node, at) => renderImageNode(env, node, at.context, at.marker),
  chartBlock: (env, node, at) =>
    renderChartNode(env, node, at.context, at.marker),
  mermaidBlock: (env, node, at) =>
    renderMermaidNode(env, node, at.context, at.marker),
  pluginBlock: renderPluginNode,
};

function hasListItemRenderer(
  node: DocxBlockNode,
): node is NodeOf<keyof typeof LIST_ITEM_RENDERERS> {
  return node.type in LIST_ITEM_RENDERERS;
}

async function renderBlockNodeWithListMarker(
  env: RenderEnv,
  node: DocxBlockNode,
  at: Placement,
): Promise<Block[]> {
  if (hasListItemRenderer(node)) {
    return dispatch(LIST_ITEM_RENDERERS, env, node, at);
  }
  const markers = markerOnlyParagraphs(env, at);
  return [...markers, ...(await renderBlockNode(env, node, at))];
}

export const BLOCK_RENDERER: BlockRenderers = {
  render: renderBlockNode,
  renderWithMarker: renderBlockNodeWithListMarker,
};
