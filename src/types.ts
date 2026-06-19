import type { InputDataType } from "docx";
import type { PhrasingContent } from "mdast";

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
}

export type AlignmentOption = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

export type CalloutType =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution";

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
  type?:
    | "NEXT_PAGE"
    | "NEXT_COLUMN"
    | "CONTINUOUS"
    | "EVEN_PAGE"
    | "ODD_PAGE";
}

export type SectionTemplate = SectionConfig;

export interface DocumentSection extends SectionConfig {
  /**
   * Markdown content that belongs to this section.
   */
  markdown: string;
}

export interface Options {
  documentType?: "document" | "report";
  style?: Partial<Style>;
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
  documentType?: "document" | "report";
  style?: Partial<Style>;
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
   * Controls Markdown math parsing and native Word equation rendering in patch
   * markdown. Defaults to enabled, matching normal conversion.
   */
  mathRendering?: MathRenderingOptions;
  /**
   * Controls opt-in Mermaid fenced-block rendering in patch markdown.
   */
  mermaidRendering?: MermaidRenderingOptions;
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
   * Preserve the run styles around placeholder text when the underlying docx
   * patcher can apply them. Defaults to true.
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

export interface TocOptions {
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
   * Allow fetching remote images. Defaults to false.
   */
  enabled?: boolean;
  /**
   * Optional exact host allowlist. Host names are compared case-insensitively.
   * When provided, the list fails closed: an empty array denies every host.
   * Omit the option to allow any (public) host.
   */
  allowedHosts?: string[];
}

export interface DataUrlImageHandlingOptions {
  /**
   * Allow embedded data URL images. Defaults to true.
   */
  enabled?: boolean;
}

export interface ImageHandlingOptions {
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
    input: MermaidRenderInput
  ) => Promise<MermaidRenderResult | null | undefined> | MermaidRenderResult | null | undefined;
  /**
   * Behavior when rendering is enabled but unavailable or failed. Defaults to
   * "codeBlock" so document content is preserved.
   */
  failureMode?: "codeBlock" | "placeholder" | "throw";
}

export interface TableData {
  headers: string[];
  rows: string[][];
  align?: (string | null)[];
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
