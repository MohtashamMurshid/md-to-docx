export interface Style {
  titleSize: number;
  headingSpacing: number;
  paragraphSpacing: number;
  lineSpacing: number;
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
  footnoteSize?: number;
  mathEquationSize?: number;
  superscriptSize?: number;
  subscriptSize?: number;
  definitionListTermSize?: number;
  definitionListDescSize?: number;
  citationSize?: number;
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
  // Task list styling
  taskListCheckboxSize?: number;
  taskListTextSize?: number;
  // Horizontal rule styling
  horizontalRuleColor?: string;
  horizontalRuleThickness?: number;
  // Math equation styling
  mathEquationAlignment?: "LEFT" | "CENTER" | "RIGHT";
  // Definition list styling
  definitionListTermBold?: boolean;
  definitionListIndent?: number;
  // Citation styling
  citationFormat?: "APA" | "MLA" | "CHICAGO" | "CUSTOM";
}

export interface Options {
  documentType?: "document" | "report";
  style?: Style;
  footnotes?: FootnoteConfig;
  citations?: CitationConfig;
}

export interface TableData {
  headers: string[];
  rows: string[][];
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
  level?: number;
  isTask?: boolean;
  isCompleted?: boolean;
  isDefinition?: boolean;
  definitionTerm?: string;
}

export interface NestedListItem {
  text: string;
  level: number;
  isNumbered: boolean;
  isTask?: boolean;
  isCompleted?: boolean;
  children?: NestedListItem[];
}

export interface TaskListItem {
  text: string;
  isCompleted: boolean;
  level?: number;
}

export interface DefinitionListItem {
  term: string;
  definition: string;
}

export interface FootnoteConfig {
  enabled?: boolean;
  position?: "bottom" | "end";
  numberingStyle?: "arabic" | "roman" | "alpha";
}

export interface Footnote {
  id: string;
  text: string;
  reference: number;
}

export interface CitationConfig {
  enabled?: boolean;
  style?: "APA" | "MLA" | "CHICAGO" | "CUSTOM";
  bibliography?: boolean;
}

export interface Citation {
  id: string;
  text: string;
  reference: string;
  type?: "book" | "article" | "website" | "other";
}

export interface MathEquation {
  latex: string;
  displayMode: boolean;
}

export const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
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
  footnoteSize: 20,
  mathEquationSize: 24,
  superscriptSize: 18,
  subscriptSize: 18,
  definitionListTermSize: 24,
  definitionListDescSize: 22,
  citationSize: 20,
  // Default alignments
  paragraphAlignment: "LEFT",
  heading1Alignment: "LEFT",
  heading2Alignment: "LEFT",
  heading3Alignment: "LEFT",
  heading4Alignment: "LEFT",
  heading5Alignment: "LEFT",
  blockquoteAlignment: "LEFT",
  headingAlignment: "LEFT",
  // Task list styling
  taskListCheckboxSize: 24,
  taskListTextSize: 24,
  // Horizontal rule styling
  horizontalRuleColor: "000000",
  horizontalRuleThickness: 1,
  // Math equation styling
  mathEquationAlignment: "CENTER",
  // Definition list styling
  definitionListTermBold: true,
  definitionListIndent: 360,
  // Citation styling
  citationFormat: "APA",
};

export const headingConfigs: Record<number, HeadingConfig> = {
  1: { level: 1, size: 0, style: "Title" },
  2: { level: 2, size: 0, style: "Heading2" },
  3: { level: 3, size: 0 },
  4: { level: 4, size: 0 },
  5: { level: 5, size: 0 },
};
