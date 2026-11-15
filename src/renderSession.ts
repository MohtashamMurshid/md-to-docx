import { AlignmentType, LevelFormat, Paragraph, Table } from "docx";
import type { Root } from "mdast";
import type { Options, Style } from "./types.js";
import type { DocxDocumentModel } from "./docxModel.js";
import {
  parseMarkdownToAst,
  applyTextReplacements,
  resolveMarkdownReferences,
} from "./markdownAst.js";
import { mdastToDocxModel } from "./mdastToDocxModel.js";
import { modelToDocx } from "./modelToDocx.js";
import { expandRichTables } from "./richTables.js";
import type { TocHeadingEntry } from "./tocBuilder.js";
import {
  enforceElementLimit,
  throwIfAborted,
  yieldToAbortSignal,
} from "./processingLimits.js";
import type { CrossReferenceRegistry } from "./crossReferences.js";
import type { PluginRuntime } from "./pluginRuntime.js";
import type { PluginSectionContext } from "./pluginTypes.js";
import type { HeadingAnchorRegistry } from "./utils/bookmarkUtils.js";

export type RenderedMarkdownContent = {
  children: (Paragraph | Table)[];
  headings: TocHeadingEntry[];
  maxSequenceId: number;
  footnotes: Record<string, { children: Paragraph[] }>;
};

/** Footnotes, TOC headings and id maxima accumulated across rendered chunks. */
export interface RenderedContentTotals {
  footnotes: Record<string, { children: Paragraph[] }>;
  headings: TocHeadingEntry[];
  maxSequenceId: number;
  maxFootnoteId: number;
}

/**
 * State shared by every Markdown chunk rendered into one document: body
 * sections, header/footer slots or patch entries. Chunks share counters and
 * registries so ids, bookmarks and resource limits stay document-wide.
 */
export interface RenderSession {
  readonly totals: RenderedContentTotals;
  readonly numberingStarts: Map<number, number>;
  readonly headingAnchors: HeadingAnchorRegistry;
  readonly processedImageCounter: { count: number };
  readonly failedRemoteImageCounter: { count: number };
  readonly headingBookmarkCounter: { count: number };
  readonly tocPlaceholders: WeakSet<object>;
  elementCount: number;
}

export function createRenderSession(): RenderSession {
  return {
    totals: { footnotes: {}, headings: [], maxSequenceId: 0, maxFootnoteId: 0 },
    numberingStarts: new Map<number, number>(),
    headingAnchors: {
      anchors: new Map<string, string>(),
      counts: new Map<string, number>(),
    },
    processedImageCounter: { count: 0 },
    failedRemoteImageCounter: { count: 0 },
    headingBookmarkCounter: { count: 0 },
    tocPlaceholders: new WeakSet(),
    elementCount: 0,
  };
}

export function mergeRenderedContent(
  totals: RenderedContentTotals,
  content: RenderedMarkdownContent,
): void {
  totals.maxSequenceId = Math.max(totals.maxSequenceId, content.maxSequenceId);
  for (const [id, footnote] of Object.entries(content.footnotes)) {
    totals.footnotes[id] = footnote;
    totals.maxFootnoteId = Math.max(totals.maxFootnoteId, Number(id));
  }
  totals.headings.push(...content.headings);
}

export interface RenderChunkOptions {
  currentElementCount?: number;
  sequenceIdOffset?: number;
  numberingStarts?: Map<number, number>;
  headingAnchors?: HeadingAnchorRegistry;
  processedImageCounter?: { count: number };
  failedRemoteImageCounter?: { count: number };
  headingBookmarkCounter?: { count: number };
  tocPlaceholders?: WeakSet<object>;
  tableWidthTwips?: number | undefined;
  footnoteIdOffset?: number;
  pluginRuntime?: PluginRuntime | undefined;
  pluginSection?: PluginSectionContext;
  validateModel?: (model: DocxDocumentModel) => void;
  validateAst?: (ast: Root) => void;
  crossReferences?: CrossReferenceRegistry;
  preparedAst?: Root;
}

/**
 * Render options every chunk takes from the session: the running element
 * count, the numbering offset, and the shared registries and counters.
 */
export function sessionRenderOptions(session: RenderSession): RenderChunkOptions {
  return {
    currentElementCount: session.elementCount,
    sequenceIdOffset: session.totals.maxSequenceId,
    numberingStarts: session.numberingStarts,
    headingAnchors: session.headingAnchors,
    processedImageCounter: session.processedImageCounter,
    failedRemoteImageCounter: session.failedRemoteImageCounter,
    headingBookmarkCounter: session.headingBookmarkCounter,
  };
}

/** The numbering definition behind `numbered-list-<id>`, nine levels deep. */
export function numberedListConfig(id: number, start: number) {
  return {
    reference: `numbered-list-${id}`,
    levels: Array.from({ length: 9 }, (_, level) => ({
      level,
      start,
      format: LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 720 * (level + 1), hanging: 260 } },
      },
    })),
  };
}

export async function renderMarkdownContent(
  markdown: string,
  style: Style,
  options: Options,
  renderOptions: RenderChunkOptions = {},
): Promise<{ content: RenderedMarkdownContent; elementCount: number }> {
  const ast =
    renderOptions.preparedAst ??
    (await prepareMarkdownAst(markdown, style, options, renderOptions));

  renderOptions.validateAst?.(ast);

  throwIfAborted(options.signal);
  const elementCount = enforceElementLimit(
    ast,
    options.maxElements,
    renderOptions.currentElementCount ?? 0,
    options.signal,
  );
  const pluginElementCounter = { count: elementCount };

  const model = mdastToDocxModel(ast, options, {
    crossReferences: renderOptions.crossReferences,
    pluginRuntime: renderOptions.pluginRuntime,
  });
  renderOptions.validateModel?.(model);
  throwIfAborted(options.signal);

  // modelToDocx only reads these fields, so an omitted field and an
  // undefined one behave the same.
  const {
    sequenceIdOffset,
    numberingStarts,
    headingAnchors,
    processedImageCounter,
    failedRemoteImageCounter,
    headingBookmarkCounter,
    tocPlaceholders,
    tableWidthTwips,
    footnoteIdOffset,
    pluginRuntime,
    pluginSection,
  } = renderOptions;
  const content = await modelToDocx(model, style, options, {
    ...(sequenceIdOffset !== undefined ? { sequenceIdOffset } : {}),
    ...(numberingStarts !== undefined ? { numberingStarts } : {}),
    ...(headingAnchors !== undefined ? { headingAnchors } : {}),
    ...(processedImageCounter !== undefined ? { processedImageCounter } : {}),
    ...(failedRemoteImageCounter !== undefined
      ? { failedRemoteImageCounter }
      : {}),
    ...(headingBookmarkCounter !== undefined ? { headingBookmarkCounter } : {}),
    ...(tocPlaceholders !== undefined ? { tocPlaceholders } : {}),
    ...(tableWidthTwips !== undefined ? { tableWidthTwips } : {}),
    ...(footnoteIdOffset !== undefined ? { footnoteIdOffset } : {}),
    ...(pluginRuntime !== undefined ? { pluginRuntime } : {}),
    ...(pluginSection !== undefined ? { pluginSection } : {}),
    pluginElementCounter,
    ...(options.maxElements !== undefined
      ? { maxElements: options.maxElements }
      : {}),
  });

  return { content, elementCount: pluginElementCounter.count };
}

export async function prepareMarkdownAst(
  markdown: string,
  style: Style,
  options: Options,
  renderOptions: {
    pluginRuntime?: PluginRuntime | undefined;
    pluginSection?: PluginSectionContext;
  } = {},
): Promise<Root> {
  throwIfAborted(options.signal);
  let ast = await parseMarkdownToAst(
    markdown,
    options.mathRendering?.enabled !== false,
  );
  await expandRichTables(
    ast,
    options.mathRendering?.enabled !== false,
    options.signal,
  );
  await yieldToAbortSignal(options.signal);
  if (options.textReplacements && options.textReplacements.length > 0) {
    applyTextReplacements(
      ast,
      options.textReplacements,
      options.textReplacementMode,
    );
  }
  if (renderOptions.pluginRuntime && renderOptions.pluginSection) {
    ast = await renderOptions.pluginRuntime.transformAst(
      ast,
      style,
      renderOptions.pluginSection,
      options.signal,
    );
  }
  resolveMarkdownReferences(ast);
  return ast;
}
