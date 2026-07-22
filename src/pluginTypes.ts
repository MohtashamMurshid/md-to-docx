import type { Node, Root } from "mdast";
import type { Style } from "./types.js";

/** Public contract version implemented by this release. */
export type MarkdownDocxPluginApiVersion = 1;

export type PluginFailureMode = "fallback" | "skip" | "throw";
export type PluginConflictPolicy = "error" | "use-priority";

export interface PluginSectionContext {
  /** Zero-based section or patch index. */
  index: number;
  /** Total number of sections or patches in this conversion. */
  count: number;
  /** Distinguishes a new document section from reference-DOCX patch content. */
  kind: "section" | "patch";
  /** Placeholder name when `kind` is `patch`. */
  placeholder?: string;
  /** Usable section width in twips. */
  contentWidthTwips: number;
}

export interface PluginResolvedImageOptions {
  remote: {
    enabled: boolean;
    allowedHosts?: readonly string[];
  };
  dataUrls: {
    enabled: boolean;
  };
  maxImages: number;
  maxImageBytes: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
  maxUrlLength: number;
}

export interface PluginResolvedOptions {
  documentType: "document" | "report";
  maxInputLength?: number;
  maxElements?: number;
  imageHandling: Readonly<PluginResolvedImageOptions>;
}

export interface PluginResourceContext {
  /** Successful raster images already embedded by core and plugins. */
  readonly imagesUsed: number;
  /** Document-wide image limit applied to plugin image results. */
  readonly maxImages: number;
}

export interface PluginAstTransformContext<TState = unknown> {
  readonly pluginName: string;
  readonly signal?: AbortSignal;
  readonly style: Readonly<Style>;
  readonly options: Readonly<PluginResolvedOptions>;
  readonly section: Readonly<PluginSectionContext>;
  readonly state: TState;
}

export interface PluginSetupContext {
  readonly pluginName: string;
  readonly signal?: AbortSignal;
  readonly options: Readonly<PluginResolvedOptions>;
}

export interface PluginInlineText {
  type: "text";
  value: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  /** Unsafe hyperlink protocols are rendered as plain text by core. */
  link?: string;
}

export type PluginInlineContent = string | PluginInlineText;

export interface PluginParagraphResult {
  type: "paragraph";
  children: PluginInlineContent | readonly PluginInlineContent[];
}

export interface PluginHeadingResult {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: PluginInlineContent | readonly PluginInlineContent[];
}

export interface PluginCodeBlockResult {
  type: "codeBlock";
  value: string;
  language?: string;
}

export interface PluginImageResult {
  type: "image";
  data: Uint8Array | ArrayBuffer;
  contentType?: string;
  alt?: string;
  source?: string;
  width?: number;
  height?: number;
}

export interface PluginTableResult {
  type: "table";
  /** The first row is rendered as the header row. */
  headers: readonly (PluginInlineContent | readonly PluginInlineContent[])[];
  rows: readonly (readonly (PluginInlineContent | readonly PluginInlineContent[])[])[];
  align?: readonly ("left" | "center" | "right" | null)[];
}

/**
 * Inserts the current custom node's already-processed block children. Obtain
 * this value through `context.renderChildren()`.
 */
export interface PluginChildrenResult {
  type: "children";
}

export interface PluginSkipResult {
  type: "skip";
}

/**
 * Semantic output accepted from plugins. Raw `docx` objects are deliberately
 * excluded so relationship, numbering, bookmark, footnote, and table state
 * remains owned by the converter.
 */
export type PluginBlockResult =
  | PluginParagraphResult
  | PluginHeadingResult
  | PluginCodeBlockResult
  | PluginImageResult
  | PluginTableResult
  | PluginChildrenResult
  | PluginSkipResult;

export type PluginRenderResult =
  | PluginBlockResult
  | readonly PluginBlockResult[]
  | null
  | undefined;

export interface PluginRenderContext<TState = unknown>
  extends PluginAstTransformContext<TState> {
  readonly resources: Readonly<PluginResourceContext>;
  readonly parent: "root" | "list" | "blockquote" | "footnote";
  readonly listDepth: number;
  readonly blockquoteDepth: number;
  /** Returns a stable marker that delegates rendering of this node's children to core. */
  renderChildren(): PluginChildrenResult;
}

export interface PluginFenceInput {
  readonly language: string;
  readonly value: string;
  readonly meta?: string;
}

export interface PluginBlockNodeInput {
  /** Read-only by contract. Mutate nodes only in `transformAst`. */
  readonly node: Readonly<Node>;
  readonly nodeType: string;
}

export interface PluginFenceHandler<TState = unknown> {
  /** Case-insensitive fence info strings. */
  languages: readonly string[];
  failureMode?: PluginFailureMode;
  render(
    input: PluginFenceInput,
    context: PluginRenderContext<TState>,
  ): PluginRenderResult | Promise<PluginRenderResult>;
}

export interface PluginBlockNodeHandler<TState = unknown> {
  /** Exact, case-sensitive mdast node type names. */
  nodeTypes: readonly string[];
  failureMode?: PluginFailureMode;
  render(
    input: PluginBlockNodeInput,
    context: PluginRenderContext<TState>,
  ): PluginRenderResult | Promise<PluginRenderResult>;
}

export interface MarkdownDocxPlugin<TState = unknown> {
  /** Must be `1`; future incompatible contracts will use a new version. */
  apiVersion: MarkdownDocxPluginApiVersion;
  /** Stable lowercase identifier, for example `acme.admonitions`. */
  name: string;
  /** Higher values run first. Equal priorities preserve registration order. */
  priority?: number;
  /** Called once per conversion; its result is shared across sections for this plugin only. */
  setup?: (
    context: PluginSetupContext,
  ) => TState | Promise<TState>;
  /** Runs after core text replacements and before `maxElements` is enforced. */
  transformAst?: (
    root: Root,
    context: PluginAstTransformContext<TState>,
  ) => Root | void | Promise<Root | void>;
  fencedBlocks?: readonly PluginFenceHandler<TState>[];
  blockNodes?: readonly PluginBlockNodeHandler<TState>[];
}

export interface PluginOptions {
  /** Default `error`; `use-priority` selects priority then registration order. */
  conflictPolicy?: PluginConflictPolicy;
}
