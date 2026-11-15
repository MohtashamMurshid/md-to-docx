import { Paragraph } from "docx";
import type { DocxBlockNode, DocxInlineNode } from "../docxModel.js";
import type { PluginBlockResult, PluginInlineContent } from "../pluginTypes.js";
import { assertImageAltPolicy, validateImageText } from "../accessibility.js";
import type { Block, Placement, RenderEnv } from "./context.js";
import { imageBudgetReached } from "./imageBudget.js";
import {
  embedImageData,
  imageNotice,
  imageParagraphOptions,
} from "./images.js";
import {
  listItemParagraph,
  taskMarkerChildren,
  withoutTaskBox,
} from "./lists.js";
import { tableFootnoteFallbackParagraphs } from "./tables.js";

export type PluginNode = Extract<DocxBlockNode, { type: "pluginBlock" }>;
type ResultOf<K extends PluginBlockResult["type"]> = Extract<
  PluginBlockResult,
  { type: K }
>;
type ResultRenderer<T extends PluginBlockResult> = (
  env: RenderEnv,
  result: T,
  node: PluginNode,
  at: Placement,
) => Promise<Block[]>;

/**
 * Checks the discriminant of a block result from third-party plugin code.
 * Other fields are read as the plugin contract declares them; a malformed
 * result throws inside the plugin render try-block and follows failureMode.
 */
function assertPluginBlockResult(
  value: unknown,
): asserts value is PluginBlockResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    throw new Error("Plugin returned an invalid block result");
  }
}

function isPluginTextDescriptor(
  value: unknown,
): value is { type: "text"; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "value" in value &&
    typeof value.value === "string"
  );
}

/** Plugin inline content as text nodes. Plugin results come from third-party code, so each value is checked. */
function pluginInlineNodes(
  content: PluginInlineContent | readonly PluginInlineContent[],
): DocxInlineNode[] {
  const candidate: unknown = content;
  const values: readonly unknown[] = Array.isArray(candidate)
    ? candidate
    : [candidate];
  return values.map((value) => {
    if (typeof value === "string") {
      return { type: "text", value };
    }
    if (!isPluginTextDescriptor(value)) {
      throw new Error(
        "Plugin inline content must be text or a text descriptor",
      );
    }
    return { ...value, type: "text", value: value.value };
  });
}

function inlineElementCount(
  content: PluginInlineContent | readonly PluginInlineContent[],
): number {
  return pluginInlineNodes(content).length;
}

function tableElementCount(result: ResultOf<"table">): number {
  const cellCount = (
    cell: PluginInlineContent | readonly PluginInlineContent[],
  ): number => 1 + inlineElementCount(cell);
  let count = 2;
  for (const cell of result.headers) count += cellCount(cell);
  for (const row of result.rows) {
    count++;
    for (const cell of row) count += cellCount(cell);
  }
  return count;
}

/**
 * How many document elements a plugin result adds, for the `maxElements`
 * budget. Validates every result before any of them renders.
 */
export function pluginResultElementCount(result: unknown): number {
  assertPluginBlockResult(result);
  switch (result.type) {
    case "skip":
    case "children":
      return 0;
    case "image":
    case "codeBlock":
      return 1;
    case "paragraph":
    case "heading":
      return 1 + inlineElementCount(result.children);
    case "table":
      return tableElementCount(result);
    default:
      throw new Error(
        `Unsupported plugin result type: ${(result as { type: string }).type}`,
      );
  }
}

/**
 * Renders items in order. The list marker goes to the first item that
 * renders anything; later items render without it.
 */
export async function renderSequence<T>(
  items: readonly T[],
  at: Placement,
  renderItem: (item: T, at: Placement) => Promise<Block[]>,
): Promise<Block[]> {
  const rendered: Block[] = [];
  let marker = at.marker;
  for (const item of items) {
    const output = await renderItem(item, { ...at, marker });
    rendered.push(...output);
    if (output.length > 0) {
      marker = undefined;
    }
  }
  return rendered;
}

function renderPluginChild(
  env: RenderEnv,
  child: DocxBlockNode,
  at: Placement,
): Promise<Block[]> {
  if (at.context.inList && child.type === "paragraph") {
    return Promise.resolve([
      listItemParagraph(env, child.children, withoutTaskBox(at)),
    ]);
  }
  if (at.context.inFootnote && child.type === "table") {
    return Promise.resolve(tableFootnoteFallbackParagraphs(env, child));
  }
  return env.blocks.renderWithMarker(env, child, at);
}

/** The block's own Markdown children, rendered as if no plugin had claimed it. */
function renderPluginChildren(
  env: RenderEnv,
  node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  return renderSequence(node.children, at, (child, childAt) =>
    renderPluginChild(env, child, childAt),
  );
}

function renderPluginImage(
  env: RenderEnv,
  result: ResultOf<"image">,
  node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  const { pluginName } = node.handler;
  const altText = result.alt ?? "";
  validateImageText(altText, undefined, "Plugin image");
  assertImageAltPolicy(
    altText,
    env.options.accessibility,
    `plugin "${pluginName}" image`,
  );
  const paragraphOptions = imageParagraphOptions(env, at.context, at.marker);
  if (imageBudgetReached(env)) {
    return Promise.resolve([
      imageNotice(
        env,
        result.alt || "plugin image limit reached",
        paragraphOptions,
        taskMarkerChildren(env, at.marker),
      ),
    ]);
  }
  const paragraphs = embedImageData(env, {
    altText: result.alt || "Plugin image",
    data: result.data,
    ...(result.contentType !== undefined
      ? { contentType: result.contentType }
      : {}),
    source: result.source || `${pluginName} plugin image`,
    ...(result.width !== undefined ? { widthHint: result.width } : {}),
    ...(result.height !== undefined ? { heightHint: result.height } : {}),
    paragraphOptions,
    prefixChildren: taskMarkerChildren(env, at.marker),
  });
  return Promise.resolve(paragraphs);
}

/** Renders a result the plugin described as an ordinary Markdown block. */
function renderAsBlock(
  env: RenderEnv,
  block: DocxBlockNode,
  at: Placement,
): Promise<Block[]> {
  return env.blocks.renderWithMarker(env, block, at);
}

function renderPluginParagraph(
  env: RenderEnv,
  result: ResultOf<"paragraph">,
  _node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  const children = pluginInlineNodes(result.children);
  if (at.context.inList) {
    return Promise.resolve([listItemParagraph(env, children, at)]);
  }
  return renderAsBlock(env, { type: "paragraph", children }, at);
}

async function renderPluginCodeBlock(
  env: RenderEnv,
  result: ResultOf<"codeBlock">,
  _node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  const rendered = await renderAsBlock(
    env,
    {
      type: "codeBlock",
      value: result.value,
      ...(result.language !== undefined ? { language: result.language } : {}),
    },
    at,
  );
  // Recorded so back-to-back code blocks get a spacer between them.
  const codeParagraph = rendered[rendered.length - 1];
  if (codeParagraph instanceof Paragraph) {
    env.pluginCodeParagraphs.add(codeParagraph);
  }
  return rendered;
}

function renderPluginTable(
  env: RenderEnv,
  result: ResultOf<"table">,
  _node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  if (at.context.inList) {
    throw new Error("Plugin table results are not supported inside lists");
  }
  const table: Extract<DocxBlockNode, { type: "table" }> = {
    type: "table",
    headers: result.headers.map(pluginInlineNodes),
    rows: result.rows.map((row) => row.map(pluginInlineNodes)),
    ...(result.align ? { align: [...result.align] } : {}),
  };
  if (at.context.inFootnote) {
    return Promise.resolve(tableFootnoteFallbackParagraphs(env, table));
  }
  return renderAsBlock(env, table, at);
}

const RESULT_RENDERERS: {
  [K in PluginBlockResult["type"]]: ResultRenderer<ResultOf<K>>;
} = {
  skip: () => Promise.resolve([]),
  children: (env, _result, node, at) => renderPluginChildren(env, node, at),
  image: renderPluginImage,
  paragraph: renderPluginParagraph,
  heading: (env, result, _node, at) =>
    renderAsBlock(
      env,
      {
        type: "heading",
        level: result.level,
        children: pluginInlineNodes(result.children),
      },
      at,
    ),
  codeBlock: renderPluginCodeBlock,
  table: renderPluginTable,
};

/**
 * Renders one block a plugin returned. `pluginResultElementCount` has already
 * rejected malformed and unsupported results before any block renders.
 */
export function renderPluginBlockResult(
  env: RenderEnv,
  result: unknown,
  node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  assertPluginBlockResult(result);
  const render = RESULT_RENDERERS[result.type] as ResultRenderer<
    typeof result
  >;
  return render(env, result, node, at);
}
