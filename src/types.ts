import type { InputDataType } from "docx";
import type { PhrasingContent } from "mdast";
import type { MarkdownDocxPlugin, PluginOptions } from "./pluginTypes.js";

export interface Style {
  titleSize: number;
  headingSpacing: number;
  paragraphSpacing: number;
  lineSpacing: number;
  /**
   * Base font family for regular text runs.
   * Code spans/blocks continue to use a monospace font.
   */
  fontFamily?: string;
  /**
   * @deprecated Typo alias kept for backwards compatibility. Prefer `fontFamily`.
   */
  fontFamilly?: string;
  // Text direction
  direction?: "LTR" | "RTL";
  /**
   * Word proofing language for content rendered with this style. A section
   * style overrides the document metadata language for that section.
   */
  language?: string;
  // Font size options
  heading1Size?: number;
  heading2Size?: number;
  heading3Size?: number;
  heading4Size?: number;
  heading5Size?: number;
  heading6Size?: number;
  paragraphSize?: number;
  listItemSize?: number;
  codeBlockSize?: number;
  blockquoteSize?: number;
  inlineCodeSize?: number;
  inlineCodeColor?: string;
  inlineCodeBackground?: string;
  calloutStyles?: Partial<Record<CalloutType, CalloutStyle>>;
  tocFontSize?: number;
  // TOC level-specific styling
  tocHeading1FontSize?: number;
  tocHeading2FontSize?: number;
  tocHeading3FontSize?: number;
  tocHeading4FontSize?: number;
  tocHeading5FontSize?: number;
  tocHeading6FontSize?: number;
  tocHeading1Bold?: boolean;
  tocHeading2Bold?: boolean;
  tocHeading3Bold?: boolean;
  tocHeading4Bold?: boolean;
  tocHeading5Bold?: boolean;
  tocHeading6Bold?: boolean;
  tocHeading1Italic?: boolean;
  tocHeading2Italic?: boolean;
  tocHeading3Italic?: boolean;
  tocHeading4Italic?: boolean;
  tocHeading5Italic?: boolean;
  tocHeading6Italic?: boolean;
  // Alignment options
  paragraphAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  headingAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading1Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading2Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading3Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading4Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading5Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading6Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  blockquoteAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  codeBlockAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  // Table options
  tableLayout?: "autofit" | "fixed";
  /** Column widths in twips. Must match the table's logical column count. */
  tableColumnWidths?: number[];
  tableAllowRowSplit?: boolean;
  tableHeaderBackground?: string;
  tableCellMargins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}

export type AlignmentOption = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

export type CalloutType = "note" | "tip" | "important" | "warning" | "caution";

export interface CalloutStyle {
  /**
   * Left border color for GitHub-style callouts, as RRGGBB.
   */
  borderColor?: string;
  /**
   * Paragraph shading fill for GitHub-style callouts, as RRGGBB.
   */
  backgroundColor?: string;
  /**
   * Label text color for GitHub-style callouts, as RRGGBB.
   */
  titleColor?: string;
}

export type SectionPageNumberDisplay =
  | "none"
  | "current"
  | "currentAndTotal"
  | "currentAndSectionTotal";

export type SectionPageNumberFormat =
  | "decimal"
  | "upperRoman"
  | "lowerRoman"
  | "upperLetter"
  | "lowerLetter";

export type SectionPageNumberSeparator =
  | "hyphen"
  | "period"
  | "colon"
  | "emDash"
  | "endash";

export interface HeaderFooterContent {
  /** Markdown blocks rendered before text/page fields, including images and tables. */
  markdown?: string;
  /**
   * Optional plain text rendered before page number fields.
   */
  text?: string;
  /**
   * Paragraph alignment inside the header/footer slot.
   */
  alignment?: AlignmentOption;
  /**
   * Page number field rendering strategy for this slot.
   */
  pageNumberDisplay?: SectionPageNumberDisplay;
}

export type HeaderFooterSlot = HeaderFooterContent | null;

export interface HeaderFooterGroup {
  default?: HeaderFooterSlot;
  first?: HeaderFooterSlot;
  even?: HeaderFooterSlot;
}

export interface SectionPageMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  header?: number;
  footer?: number;
  gutter?: number;
}

export interface SectionPageSize {
  width?: number;
  height?: number;
  orientation?: "PORTRAIT" | "LANDSCAPE";
}

export interface SectionPageConfig {
  margin?: SectionPageMargins;
  size?: SectionPageSize;
}

export interface SectionPageNumbering {
  /**
   * Page number to start from in this section.
   */
  start?: number;
  /**
   * Number formatting for the section page numbers.
   */
  formatType?: SectionPageNumberFormat;
  /**
   * Number separator when chapter/page separators are used.
   */
  separator?: SectionPageNumberSeparator;
  /**
   * Footer rendering style for page numbers.
   */
  display?: SectionPageNumberDisplay;
  /**
   * Alignment for the auto-generated page number footer paragraph.
   */
  alignment?: AlignmentOption;
}

export interface SectionConfig {
  /**
   * Style override applied to content rendered inside this section.
   */
  style?: Partial<Style>;
  /**
   * Section-level page properties (size, margins, orientation).
   */
  page?: SectionPageConfig;
  /**
   * Section-level header configuration.
   */
  headers?: HeaderFooterGroup;
  /**
   * Section-level footer configuration.
   */
  footers?: HeaderFooterGroup;
  /**
   * Section-level page numbering configuration.
   */
  pageNumbering?: SectionPageNumbering;
  /**
   * Enables different first-page header/footer handling in Word.
   */
  titlePage?: boolean;
  /**
   * Word section break behavior.
   */
  type?: "NEXT_PAGE" | "NEXT_COLUMN" | "CONTINUOUS" | "EVEN_PAGE" | "ODD_PAGE";
}

export type SectionTemplate = SectionConfig;

export interface DocumentSection extends SectionConfig {
  /**
   * Markdown content that belongs to this section.
   */
  markdown: string;
}

export interface Options {
  /** Called for recoverable conversion losses. Never logs by default. */
  onWarning?: (warning: ConversionWarning) => void;
  documentType?: "document" | "report";
  style?: Partial<Style>;
  /** Typed Word package metadata. Omitted metadata keeps legacy output. */
  metadata?: DocumentMetadata;
  /** Focused accessibility checks for generated media. */
  accessibility?: AccessibilityOptions;
  toc?: TocOptions;
  /**
   * Controls Markdown math parsing and native Word equation rendering.
   * Enabled by default. Unsupported TeX falls back to literal source text
   * unless `unsupported` is set to "throw".
   */
  mathRendering?: MathRenderingOptions;
  /**
   * Optional maximum markdown input length, measured with JavaScript string
   * length. When `sections` is provided, all section markdown lengths are
   * summed. Omitted by default, preserving unlimited input behavior.
   */
  maxInputLength?: number;
  /**
   * Optional maximum number of parsed markdown AST elements across the whole
   * document. Omitted by default, preserving unlimited structure size.
   */
  maxElements?: number;
  /**
   * Optional cancellation signal for programmatic conversions. CLI JSON
   * options cannot provide this value.
   */
  signal?: AbortSignal;
  /**
   * Shared defaults applied to each section before per-section overrides.
   */
  template?: SectionTemplate;
  /**
   * Explicit section list. If omitted, the whole markdown input is treated
   * as a single section using global options.
   */
  sections?: DocumentSection[];
  /**
   * Array of text replacements to apply to the markdown AST before conversion
   * Uses mdast-util-find-and-replace for pattern matching and replacement
   * Function replacements are for trusted programmatic callers only. Set
   * textReplacementMode to "untrusted" when replacement options come from
   * external input.
   */
  textReplacements?: TextReplacement[];
  /**
   * Controls whether function text replacements are accepted. Defaults to
   * "trusted" for backward compatibility. Use "untrusted" for API, webhook,
   * upload, or CLI JSON options sourced from external users.
   */
  textReplacementMode?: TextReplacementMode;
  /**
   * Optional syntax highlighting configuration for fenced code blocks.
   * When `enabled` is true, lowlight is used to tokenize the code and
   * emit colored runs in the DOCX output. Disabled by default.
   */
  codeHighlighting?: CodeHighlightOptions;
  /**
   * Controls image loading and embedding. Remote images are disabled by
   * default so server-side conversion of untrusted markdown cannot be used
   * to fetch internal network resources.
   */
  imageHandling?: ImageHandlingOptions;
  /**
   * Optional Mermaid fenced-block rendering. Disabled by default; when enabled,
   * callers must provide a renderer that converts Mermaid fences into raster
   * image bytes.
   */
  mermaidRendering?: MermaidRenderingOptions;
  /**
   * Optional rendering for fenced `chart` and `chartjs` blocks. Disabled by
   * default; when disabled, those fences render as ordinary code blocks.
   */
  chartRendering?: ChartRenderingOptions;
  /**
   * Labels, placement, styling, and validation behavior for figure/table
   * captions and cross-references.
   */
  captions?: CaptionOptions;
  /** Trusted programmatic renderer plugins. Functions cannot be loaded from CLI JSON. */
  plugins?: readonly MarkdownDocxPlugin<any>[];
  /** Deterministic conflict handling for overlapping plugin handlers. */
  pluginOptions?: PluginOptions;
}

export type CaptionPlacement = "above" | "below";
export type CaptionFailureMode = "preserve" | "throw";

export interface CaptionOptions {
  /** Human-readable label before figure numbers. Defaults to "Figure". */
  figureLabel?: string;
  /** Human-readable label before table numbers. Defaults to "Table". */
  tableLabel?: string;
  /** Figure caption position relative to the image. Defaults to "below". */
  figurePlacement?: CaptionPlacement;
  /** Table caption position relative to the table. Defaults to "below". */
  tablePlacement?: CaptionPlacement;
  /** Caption paragraph alignment. Defaults to CENTER. */
  alignment?: AlignmentOption;
  /** Whether caption text is italic. Defaults to false. */
  italic?: boolean;
  /** Caption font size in half-points. Defaults to the paragraph size. */
  size?: number;
  /**
   * Preserve malformed/duplicate syntax and unresolved references as literal
   * text, or throw a MarkdownConversionError. Defaults to "preserve".
   */
  failureMode?: CaptionFailureMode;
  /**
   * Ask Word to refresh document fields when the file opens. Defaults to true.
   * Set false to avoid Word's field-update security prompt and update fields
   * manually with Ctrl+A, F9 when needed.
   */
  updateFieldsOnOpen?: boolean;
}

export interface MathRenderingOptions {
  /**
   * Parse `$...$` and `$$...$$` math syntax. Defaults to true.
   */
  enabled?: boolean;
  /**
   * Behavior when the native renderer does not support an expression.
   * Defaults to "text".
   */
  unsupported?: "text" | "throw";
}

export type ReferenceDocxInput = InputDataType;

/** In-memory bytes accepted by the reference-style generation workflow. */
export type ReferenceDocxBytes = Uint8Array | ArrayBuffer | Blob;

/** Semantic Markdown roles that can adopt a named style from a reference DOCX. */
export type ReferenceDocxStyleRole =
  | "normal"
  | "title"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "blockquote"
  | "codeBlock"
  | "caption"
  | "listParagraph"
  | "table"
  | "strong"
  | "emphasis"
  | "inlineCode"
  | "hyperlink";

/** Selects a reference style deterministically by its Word ID or display name. */
export type ReferenceDocxStyleSelector =
  | { id: string; name?: never }
  | { name: string; id?: never };

export type ReferenceDocxStyleMap = Partial<
  Record<ReferenceDocxStyleRole, ReferenceDocxStyleSelector | null>
>;

export interface ReferenceDocxPackageLimits {
  /** Maximum uploaded/reference ZIP size. Defaults to 16 MiB. */
  maxCompressedBytes?: number;
  /** Maximum sum of central-directory uncompressed sizes. Defaults to 64 MiB. */
  maxUncompressedBytes?: number;
  /** Maximum uncompressed size of one ZIP entry. Defaults to 16 MiB. */
  maxEntryUncompressedBytes?: number;
  /** Maximum ZIP entry count. Defaults to 512. */
  maxEntries?: number;
}

export interface ReferenceDocxModeOptions {
  /**
   * Typed overrides for Markdown-role to Word-style mapping. Omit a role to
   * use conventional Word IDs/names; set it to null to keep generated styling.
   */
  styles?: ReferenceDocxStyleMap;
  /**
   * Behavior when an explicit style selector cannot be resolved. Defaults to
   * "fallback", which keeps the converter's generated style/direct formatting.
   */
  missingStyleBehavior?: "fallback" | "throw";
  /**
   * Behavior when a name selector matches multiple styles. Defaults to
   * "throw"; "first" selects the first definition in styles.xml.
   */
  duplicateStyleNameBehavior?: "first" | "throw";
  /** Copy page size, margins, orientation, and relevant final-section settings. */
  preservePageLayout?: boolean;
  /** Import final-section headers and footers without copying reference body text. */
  preserveHeadersAndFooters?: boolean;
  /** Bounded ZIP/package processing limits for the untrusted reference input. */
  limits?: ReferenceDocxPackageLimits;
}

/**
 * Options for generating a new DOCX whose presentation is adopted from a
 * reference package. This is separate from placeholder patching.
 */
export interface ReferenceDocxGenerationOptions extends Options {
  reference?: ReferenceDocxModeOptions;
}

export type ReferenceDocxErrorCode =
  | "ABORTED"
  | "INVALID_INPUT"
  | "INVALID_ZIP"
  | "INVALID_PACKAGE"
  | "UNSAFE_ENTRY_PATH"
  | "PACKAGE_LIMIT_EXCEEDED"
  | "MISSING_PACKAGE_PART"
  | "MALFORMED_XML"
  | "MISSING_STYLE"
  | "DUPLICATE_STYLE_NAME"
  | "STYLE_TYPE_MISMATCH"
  | "UNSUPPORTED_RELATIONSHIP";

/** Actionable context exposed by reference-mode MarkdownConversionError values. */
export interface ReferenceDocxErrorContext {
  phase: "reference-docx";
  code: ReferenceDocxErrorCode;
  entry?: string;
  role?: ReferenceDocxStyleRole;
  selector?: ReferenceDocxStyleSelector;
  relationshipType?: string;
  limit?: number;
  actual?: number;
  originalError?: unknown;
}

export type MarkdownDocxPatch =
  | string
  | {
      /**
       * Markdown content inserted at the matching DOCX placeholder.
       */
      markdown: string;
      /**
       * Optional style overrides for this placeholder's generated content.
       */
      style?: Partial<Style>;
    };

export interface PatchMarkdownOptions {
  onWarning?: (warning: ConversionWarning) => void;
  captions?: CaptionOptions;
  toc?: TocOptions;
  documentType?: "document" | "report";
  style?: Partial<Style>;
  /**
   * Metadata fields to override in the reference DOCX. Unspecified fields are
   * preserved, and custom properties are merged by name.
   */
  metadata?: DocumentMetadata;
  /** Focused accessibility checks for generated patch media. */
  accessibility?: AccessibilityOptions;
  /**
   * Array of text replacements to apply to each patch's markdown AST before
   * rendering.
   */
  textReplacements?: TextReplacement[];
  /**
   * Controls whether function text replacements are accepted while rendering
   * patch markdown. Defaults to "trusted" for backward compatibility.
   */
  textReplacementMode?: TextReplacementMode;
  /**
   * Controls Markdown math parsing and native Word equation rendering for patch
   * content. Enabled by default.
   */
  mathRendering?: MathRenderingOptions;
  /**
   * Optional syntax highlighting configuration for fenced code blocks.
   */
  codeHighlighting?: CodeHighlightOptions;
  /**
   * Controls image loading and embedding for markdown inserted into the
   * reference DOCX.
   */
  imageHandling?: ImageHandlingOptions;
  /**
   * Optional Mermaid fenced-block rendering for patch content. Disabled by
   * default; when enabled, callers must provide a renderer callback.
   */
  mermaidRendering?: MermaidRenderingOptions;
  /**
   * Optional chart fenced-block rendering for patch content. Disabled by
   * default; when disabled, chart fences render as code blocks.
   */
  chartRendering?: ChartRenderingOptions;
  /** Trusted programmatic renderer plugins used for every placeholder patch. */
  plugins?: readonly MarkdownDocxPlugin<any>[];
  pluginOptions?: PluginOptions;
  /**
   * Optional maximum markdown input length per patch.
   */
  maxInputLength?: number;
  /**
   * Optional maximum parsed markdown AST element count per patch.
   */
  maxElements?: number;
  /**
   * Optional cancellation signal for programmatic patching.
   */
  signal?: AbortSignal;
  /**
   * Compatibility flag. Template named styles are preserved and explicit
   * Markdown formatting is applied to generated blocks.
   */
  keepOriginalStyles?: boolean;
  /**
   * Placeholder delimiters used in the reference DOCX. Defaults to {{ and }}.
   */
  placeholderDelimiters?: {
    start: string;
    end: string;
  };
  /**
   * Whether repeated placeholders should all be replaced. Defaults to true.
   */
  recursive?: boolean;
  /**
   * Table width, in twips, for markdown tables inserted into the reference
   * DOCX. Defaults to the converter's A4 portrait content width because the
   * patcher does not infer section geometry from the reference package.
   */
  tableWidthTwips?: number;
}

export interface ConversionWarning {
  code:
    | "IMAGE_FALLBACK"
    | "UNSUPPORTED_MATH"
    | "UNRESOLVED_LINK"
    | "DIAGRAM_FALLBACK"
    | "PLUGIN_FALLBACK"
    | "UNSUPPORTED_CONTENT";
  message: string;
  source?: string;
  sectionIndex?: number;
}

export interface TocOptions {
  /** Native Word field with cached clickable entries. Set links for legacy output. */
  mode?: "native" | "links";
  pageNumbers?: boolean;
  dotLeaders?: boolean;
  updateFieldsOnOpen?: boolean;
  /**
   * Title paragraph inserted before generated TOC entries. Defaults to
   * "Table of Contents". Set to "" to omit the title.
   */
  title?: string;
  /**
   * Minimum heading level to include. Defaults to 1.
   */
  minDepth?: number;
  /**
   * Maximum heading level to include. Defaults to 6.
   */
  maxDepth?: number;
}

export interface RemoteImageHandlingOptions {
  /**
   * Allow fetching remote images in Node.js. Defaults to false. Browser builds
   * always reject remote image fetching because they cannot enforce the DNS/IP
   * validation and connection pinning required by the server-side SSRF policy.
   */
  enabled?: boolean;
  /**
   * Node.js-only exact host allowlist. Host names are compared
   * case-insensitively. When provided, the list fails closed: an empty array
   * denies every host. Omit the option to allow any public host.
   */
  allowedHosts?: string[];
}

export interface DataUrlImageHandlingOptions {
  /**
   * Allow embedded data URL images. Defaults to true.
   */
  enabled?: boolean;
}

export interface ImageAsset {
  data: Uint8Array | ArrayBuffer;
  contentType?: string;
}

export interface ImageHandlingOptions {
  /** Trusted resolver for local, browser, authenticated, or virtual assets. */
  resolve?: (
    source: string,
    context: { signal?: AbortSignal; maxBytes: number },
  ) => ImageAsset | null | undefined | Promise<ImageAsset | null | undefined>;
  /** Node only. Local paths must remain inside this directory after symlink resolution. */
  baseDirectory?: string;
  remote?: RemoteImageHandlingOptions;
  dataUrls?: DataUrlImageHandlingOptions;
  /**
   * Maximum raster images successfully embedded per document. Failed images do
   * not consume this budget; once the limit is reached, further images render
   * as placeholders without fetching or decoding. Defaults to 50.
   */
  maxImages?: number;
  /**
   * Maximum decoded/fetched image size in bytes. Defaults to 5 MiB.
   */
  maxImageBytes?: number;
  /**
   * Timeout for each remote image request, including reading the response body.
   * Defaults to 10000.
   */
  fetchTimeoutMs?: number;
  /**
   * Maximum number of remote redirects to follow. Defaults to 3.
   */
  maxRedirects?: number;
  /**
   * Maximum remote image URL length. Defaults to 2048.
   */
  maxUrlLength?: number;
}

/**
 * Map of highlight.js token class names (without the `hljs-` prefix) to
 * hex colors (without the leading `#`), used to color runs in the
 * rendered code block. Supports a few reserved keys for base colors.
 */
export interface CodeHighlightTheme {
  /**
   * Fallback text color for unclassified tokens. Hex without `#`.
   */
  default?: string;
  /**
   * Overrides the code block background shading fill. Hex without `#`.
   */
  background?: string;
  /**
   * Overrides the code block border color. Hex without `#`.
   */
  border?: string;
  /**
   * Overrides the language label color. Hex without `#`.
   */
  languageLabel?: string;
  /**
   * Map of token classes (e.g. `keyword`, `string`, `title.function`) to
   * hex colors. Dotted classes fall back to their first segment if an
   * exact match is not present.
   */
  [tokenClass: string]: string | undefined;
}

/**
 * Configuration for syntax highlighting in fenced code blocks.
 */
export interface CodeHighlightOptions {
  /**
   * Turn highlighting on. Defaults to false, preserving existing output.
   */
  enabled?: boolean;
  /**
   * User-supplied partial theme, merged over the built-in default theme.
   */
  theme?: CodeHighlightTheme;
  /**
   * Optional whitelist of language names to load. When provided, only
   * those languages (plus aliases) are highlighted; others fall back to
   * the plain rendering path. Defaults to the lowlight `common` set.
   */
  languages?: string[];
  /**
   * Controls rendering of the language label above highlighted code.
   * Defaults to true.
   */
  showLanguageLabel?: boolean;
}

export interface MermaidRenderInput {
  /**
   * Raw fenced code block body.
   */
  code: string;
  /**
   * Optional mdast code fence metadata.
   */
  meta?: string;
  /**
   * Abort signal from the conversion options, when provided.
   */
  signal?: AbortSignal;
}

export interface MermaidRenderResult {
  /**
   * Raster image bytes. Supported output formats match normal embedded images:
   * PNG, JPEG, or GIF.
   */
  data: Uint8Array | ArrayBuffer | Buffer;
  /**
   * Optional content type used as a hint when detecting the image format.
   */
  contentType?: string;
  /**
   * Optional output width hint in pixels. If omitted, intrinsic image metadata
   * and normal image sizing defaults are used.
   */
  width?: number;
  /**
   * Optional output height hint in pixels. If omitted, intrinsic image metadata
   * and normal image sizing defaults are used.
   */
  height?: number;
  /**
   * Optional source label for diagnostics. This is not fetched.
   */
  source?: string;
  /** Accessible description written to the Word drawing properties. */
  altText?: string;
  /** Optional Word drawing title. */
  title?: string;
}

export interface MermaidRenderingOptions {
  /**
   * Turn Mermaid rendering on. Defaults to false, preserving Mermaid fences
   * as ordinary code blocks.
   */
  enabled?: boolean;
  /**
   * Converts a Mermaid fence into raster image bytes. The package does not
   * bundle Mermaid, Graphviz, browser automation, or a subprocess runner.
   */
  render?: (
    input: MermaidRenderInput,
  ) =>
    | Promise<MermaidRenderResult | null | undefined>
    | MermaidRenderResult
    | null
    | undefined;
  /**
   * Behavior when rendering is enabled but unavailable or failed. Defaults to
   * "codeBlock" so document content is preserved.
   */
  failureMode?: "codeBlock" | "placeholder" | "throw";
}

export type ChartBlockType = "bar" | "line" | "pie" | "doughnut";

export interface ChartDataset {
  label?: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
}

export interface ChartBlockDefinition {
  type: ChartBlockType;
  data: {
    labels?: string[];
    datasets: ChartDataset[];
  };
  options?: {
    plugins?: {
      title?: {
        display?: boolean;
        text?: string;
      };
    };
  };
  /**
   * Optional DOCX output width in pixels. Falls back to chartRendering.width
   * and then the built-in default.
   */
  width?: number;
  /**
   * Optional DOCX output height in pixels. Falls back to chartRendering.height
   * and then the built-in default.
   */
  height?: number;
  /**
   * Accessible fallback text used in error placeholders.
   */
  alt?: string;
}

export interface ChartRendererInput {
  definition: ChartBlockDefinition;
  width: number;
  height: number;
  signal?: AbortSignal;
}

export type ChartRenderer = (
  input: ChartRendererInput,
) => string | Uint8Array | Promise<string | Uint8Array>;

export interface ChartRenderingOptions {
  /**
   * Turn fenced chart rendering on. Defaults to false.
   */
  enabled?: boolean;
  /**
   * Default DOCX output width in pixels when a chart block does not specify
   * `width`. Defaults to 640.
   */
  width?: number;
  /**
   * Default DOCX output height in pixels when a chart block does not specify
   * `height`. Defaults to 360.
   */
  height?: number;
  /**
   * Maximum accepted chart width in pixels. Defaults to 2000.
   */
  maxWidth?: number;
  /**
   * Maximum accepted chart height in pixels. Defaults to 2000.
   */
  maxHeight?: number;
  /**
   * Behavior for invalid JSON/schema or renderer failures. Defaults to
   * "placeholder", which keeps conversion running and inserts a visible
   * message in the document.
   */
  invalidDefinitionBehavior?: "placeholder" | "throw";
  /**
   * Optional custom renderer. When omitted, a built-in offline PNG renderer
   * handles the documented bar, line, pie, and doughnut subset.
   */
  renderer?: ChartRenderer;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  align?: (string | null)[];
}

export type MissingImageAltTextBehavior = "permissive" | "throw";

export interface AccessibilityOptions {
  /**
   * Missing or empty image alt text is allowed by default for backwards
   * compatibility. Use "throw" to make conversion fail before image loading.
   */
  missingImageAltText?: MissingImageAltTextBehavior;
}

export interface DocumentMetadata {
  title?: string;
  subject?: string;
  description?: string;
  /** Preferred name for the Dublin Core creator/Word Author property. */
  creator?: string;
  /** Alias for creator. `creator` wins when both are provided. */
  author?: string;
  /** A Word keyword string or a list joined with `; `. */
  keywords?: string | readonly string[];
  category?: string;
  company?: string;
  /** BCP 47-style language tag used in package metadata and Word run styles. */
  language?: string;
  /** Explicit creation timestamp. Omitted timestamps are not synthesized. */
  created?: Date | string;
  /** Explicit modification timestamp. Omitted timestamps are not synthesized. */
  modified?: Date | string;
  /** String-valued Word custom document properties, merged by name in patches. */
  custom?: Readonly<Record<string, string>>;
}

/**
 * Configuration for text find-and-replace operations
 * @property find - The pattern to find (string or RegExp)
 * @property replace - The replacement (string or trusted function)
 */
export type TextReplacementMode = "trusted" | "untrusted";

export type TextReplacementFunctionResult =
  | string
  | PhrasingContent
  | PhrasingContent[]
  | false
  | null
  | undefined;

export type TextReplacementFunction = (
  match: string,
  ...args: unknown[]
) => TextReplacementFunctionResult;

export interface TextReplacement {
  find: string | RegExp;
  replace: string | TextReplacementFunction;
}
