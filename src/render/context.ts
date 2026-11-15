import type { InternalHyperlink, Paragraph, ParagraphChild, Table } from "docx";
import type { DocxBlockNode, DocxCalloutType } from "../docxModel.js";
import type { Options, Style } from "../types.js";
import type { PluginRuntime } from "../pluginRuntime.js";
import type { HeadingAnchorRegistry } from "../utils/bookmarkUtils.js";
import { resolveImageHandlingOptions } from "../renderers/imageRenderer.js";
import type { ResolvedImageHandlingOptions } from "../utils/imageHandling.js";

/** One rendered body element. */
export type Block = Paragraph | Table;

/** Options `parseToDocxOptions` passes so several sections share one document's state. */
export interface ModelToDocxRenderOptions {
  sequenceIdOffset?: number;
  numberingStarts?: Map<number, number>;
  headingAnchors?: HeadingAnchorRegistry;
  /** When set by `parseToDocxOptions`, ties `maxImages` to the whole document across sections. */
  processedImageCounter?: { count: number };
  /** Document-wide budget for failed remote image fetch attempts. */
  failedRemoteImageCounter?: { count: number };
  headingBookmarkCounter?: { count: number };
  /** Records emitted TOC placeholder paragraphs so the caller can splice in TOC content. */
  tocPlaceholders?: WeakSet<object>;
  /**
   * Usable content width of the section in twips. Tables are sized with this
   * value (as `WidthType.DXA`) so they emit a plain integer width,
   * avoiding the percentage form that Word 2007 treats as corrupt.
   */
  tableWidthTwips?: number;
  /** Offset applied so footnote IDs remain unique across sections. */
  footnoteIdOffset?: number;
  pluginRuntime?: PluginRuntime;
  pluginElementCounter?: { count: number };
  maxElements?: number;
  pluginSection?: {
    index: number;
    count: number;
    kind: "section" | "patch";
    placeholder?: string;
    contentWidthTwips: number;
  };
}

export interface RenderedHeading {
  text: string;
  level: number;
  bookmarkId: string;
}

/** Rendering overrides shared across inline-node renderers. */
export interface InlineOverrides {
  forceBold?: boolean;
  forceItalic?: boolean;
  color?: string;
  size?: number;
}

/** Where a block sits: inside a blockquote, a footnote, a list, or a callout. */
export interface RenderContext {
  quoteLevel?: number;
  inFootnote?: boolean;
  inList?: boolean;
  calloutType?: DocxCalloutType | undefined;
}

/** The bullet or number a list item's first block carries. */
export interface ListMarkerContext {
  isOrdered: boolean;
  level: number;
  sequenceId: number | undefined;
  taskChecked?: boolean | undefined;
}

/** A block's position: its list level, its context, and the list marker it must carry, if any. */
export interface Placement {
  readonly listLevel: number;
  readonly context: RenderContext;
  readonly marker?: ListMarkerContext | undefined;
}

export const ROOT_PLACEMENT: Placement = { listLevel: 0, context: {} };

/**
 * The block dispatchers. Tables, lists, plugins and footnotes render nested
 * blocks through these, so those modules need not import the dispatcher
 * module that imports them.
 */
export interface BlockRenderers {
  /** Renders a block where it stands. */
  render(env: RenderEnv, node: DocxBlockNode, at?: Placement): Promise<Block[]>;
  /** Renders a block inside a list item or plugin output, carrying `at.marker` when set. */
  renderWithMarker(
    env: RenderEnv,
    node: DocxBlockNode,
    at: Placement,
  ): Promise<Block[]>;
}

/** State one `modelToDocx` call shares across every renderer. */
export interface RenderEnv {
  readonly style: Style;
  readonly options: Options;
  readonly renderOptions: ModelToDocxRenderOptions;
  readonly blocks: BlockRenderers;
  readonly documentType: NonNullable<Options["documentType"]>;
  readonly sequenceIdOffset: number;
  readonly footnoteIdOffset: number;
  readonly imageHandling: ResolvedImageHandlingOptions;
  readonly processedImageCounter: { count: number };
  readonly failedRemoteImageCounter: { count: number };
  readonly headingBookmarkCounter: { count: number };
  readonly headingAnchors: HeadingAnchorRegistry;
  readonly tableWidthTwips: number;
  readonly headings: RenderedHeading[];
  /** Highest numbering sequence ID used, so the caller can offset the next section. */
  maxSequenceId: number;
  /** Inline images, fetched before the paragraph that holds them renders. */
  readonly inlineImages: WeakMap<object, ParagraphChild>;
  /** Fragment links, resolved once every section's headings are known. */
  readonly pendingLinks: {
    link: InternalHyperlink;
    fragment: string;
    source: string;
  }[];
  /** Code paragraphs from Mermaid fallbacks and plugin results, for code-block spacing. */
  readonly mermaidFallbackCodeParagraphs: WeakSet<object>;
  readonly pluginCodeParagraphs: WeakSet<object>;
}

export function createRenderEnv(
  style: Style,
  options: Options,
  renderOptions: ModelToDocxRenderOptions,
  blocks: BlockRenderers,
): RenderEnv {
  return {
    style,
    options,
    renderOptions,
    blocks,
    documentType: options.documentType || "document",
    sequenceIdOffset: renderOptions.sequenceIdOffset || 0,
    footnoteIdOffset: renderOptions.footnoteIdOffset || 0,
    imageHandling: resolveImageHandlingOptions(options.imageHandling),
    processedImageCounter: renderOptions.processedImageCounter ?? { count: 0 },
    failedRemoteImageCounter: renderOptions.failedRemoteImageCounter ?? {
      count: 0,
    },
    headingBookmarkCounter: renderOptions.headingBookmarkCounter ?? {
      count: 0,
    },
    headingAnchors: renderOptions.headingAnchors ?? {
      anchors: new Map(),
      counts: new Map(),
    },
    // Full-width tables are sized in twips so docx emits a plain integer width.
    // Defaults to A4 portrait content width (page 11906 - default 1080 margins).
    tableWidthTwips: renderOptions.tableWidthTwips ?? 9746,
    headings: [],
    maxSequenceId: 0,
    inlineImages: new WeakMap(),
    pendingLinks: [],
    mermaidFallbackCodeParagraphs: new WeakSet(),
    pluginCodeParagraphs: new WeakSet(),
  };
}
