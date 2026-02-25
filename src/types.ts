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
   * Deprecated typo alias kept for backwards compatibility.
   * Prefer `fontFamily`.
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
  paragraphSize?: number;
  listItemSize?: number;
  codeBlockSize?: number;
  blockquoteSize?: number;
  tocFontSize?: number;
  // TOC level-specific styling
  tocHeading1FontSize?: number;
  tocHeading2FontSize?: number;
  tocHeading3FontSize?: number;
  tocHeading4FontSize?: number;
  tocHeading5FontSize?: number;
  tocHeading1Bold?: boolean;
  tocHeading2Bold?: boolean;
  tocHeading3Bold?: boolean;
  tocHeading4Bold?: boolean;
  tocHeading5Bold?: boolean;
  tocHeading1Italic?: boolean;
  tocHeading2Italic?: boolean;
  tocHeading3Italic?: boolean;
  tocHeading4Italic?: boolean;
  tocHeading5Italic?: boolean;
  // Alignment options
  paragraphAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  headingAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading1Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading2Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading3Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading4Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  heading5Alignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  blockquoteAlignment?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  // Table options
  tableLayout?: "autofit" | "fixed";
}

export type AlignmentOption = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

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

export interface SectionTemplate extends SectionConfig {}

export interface DocumentSection extends SectionConfig {
  /**
   * Markdown content that belongs to this section.
   */
  markdown: string;
}

export interface Options {
  documentType?: "document" | "report";
  style?: Partial<Style>;
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
   */
  textReplacements?: TextReplacement[];
}

export interface TableData {
  headers: string[];
  rows: string[][];
  align?: (string | null)[];
}

export interface ProcessedContent {
  children: any[];
  skipLines: number;
}

export interface HeadingConfig {
  level: number;
  size: number;
  style?: string;
  alignment?: any;
}

export interface ListItemConfig {
  text: string;
  boldText?: string;
  isNumbered?: boolean;
  listNumber?: number;
  sequenceId?: number;
  level?: number;
}

/**
 * Configuration for text find-and-replace operations
 * @property find - The pattern to find (string or RegExp)
 * @property replace - The replacement (string or function that returns string or array of nodes)
 */
export interface TextReplacement {
  find: string | RegExp;
  replace: string | ((match: string, ...args: any[]) => string | any);
}

export const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  direction: "LTR",
  // Default font sizes
  heading1Size: 32,
  heading2Size: 28,
  heading3Size: 24,
  heading4Size: 20,
  heading5Size: 18,
  paragraphSize: 24,
  listItemSize: 24,
  codeBlockSize: 20,
  blockquoteSize: 24,
  // Default alignments
  paragraphAlignment: "LEFT",
  heading1Alignment: "LEFT",
  heading2Alignment: "LEFT",
  heading3Alignment: "LEFT",
  heading4Alignment: "LEFT",
  heading5Alignment: "LEFT",
  blockquoteAlignment: "LEFT",
  headingAlignment: "LEFT",
  // Table options
  tableLayout: "autofit",
};

export const headingConfigs: Record<number, HeadingConfig> = {
  1: { level: 1, size: 0, style: "Title" },
  2: { level: 2, size: 0, style: "Heading2" },
  3: { level: 3, size: 0 },
  4: { level: 4, size: 0 },
  5: { level: 5, size: 0 },
};
