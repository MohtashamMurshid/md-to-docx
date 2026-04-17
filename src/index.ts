import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  PageOrientation,
  Packer,
  Table,
  InternalHyperlink,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  PageNumberSeparator,
  SectionType,
  LevelFormat,
  IPropertiesOptions,
  ISectionOptions,
} from "docx";
import saveAs from "file-saver";
import {
  AlignmentOption,
  DocumentSection,
  HeaderFooterGroup,
  HeaderFooterSlot,
  Options,
  SectionConfig,
  SectionPageNumberDisplay,
  SectionTemplate,
  Style,
} from "./types.js";
import { parseMarkdownToAst, applyTextReplacements } from "./markdownAst.js";
import { mdastToDocxModel } from "./mdastToDocxModel.js";
import { modelToDocx } from "./modelToDocx.js";
import { resolveFontFamily } from "./utils/styleUtils.js";

const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  paragraphAlignment: "LEFT",
  direction: "LTR",
};

const defaultOptions: Options = {
  documentType: "document",
  style: defaultStyle,
};

export {
  DocumentSection,
  HeaderFooterContent,
  HeaderFooterGroup,
  Options,
  SectionConfig,
  SectionTemplate,
  Style,
  TableData,
} from "./types.js";

/**
 * Custom error class for markdown conversion errors
 * @extends Error
 * @param message - The error message
 * @param context - The context of the error
 */
export class MarkdownConversionError extends Error {
  constructor(message: string, public context?: unknown) {
    super(message);
    this.name = "MarkdownConversionError";
  }
}

function normalizeStyleInput(style?: Partial<Style>): Partial<Style> | undefined {
  if (!style) {
    return style;
  }

  const fontFamily = style.fontFamily || style.fontFamilly;
  if (!fontFamily) {
    return style;
  }

  return {
    ...style,
    fontFamily,
  };
}

const defaultSectionMargins = {
  top: 1440,
  right: 1080,
  bottom: 1440,
  left: 1080,
};

type TocHeadingEntry = { text: string; level: number; bookmarkId: string };
type ResolvedPageNumbering = NonNullable<SectionConfig["pageNumbering"]>;
const validAlignments: AlignmentOption[] = [
  "LEFT",
  "CENTER",
  "RIGHT",
  "JUSTIFIED",
];
const validPageNumberDisplays: SectionPageNumberDisplay[] = [
  "none",
  "current",
  "currentAndTotal",
  "currentAndSectionTotal",
];
const validPageNumberFormats = [
  "decimal",
  "upperRoman",
  "lowerRoman",
  "upperLetter",
  "lowerLetter",
] as const;
const validPageNumberSeparators = [
  "hyphen",
  "period",
  "colon",
  "emDash",
  "endash",
] as const;
const validSectionTypes = [
  "NEXT_PAGE",
  "NEXT_COLUMN",
  "CONTINUOUS",
  "EVEN_PAGE",
  "ODD_PAGE",
] as const;
const validPageOrientations = ["PORTRAIT", "LANDSCAPE"] as const;

interface ResolvedSectionInput {
  markdown: string;
  style: Style;
  config: SectionConfig;
}

function normalizeSectionConfig<T extends SectionConfig>(
  section?: T
): T | undefined {
  if (!section) {
    return section;
  }

  return {
    ...section,
    style: normalizeStyleInput(section.style),
  };
}

function mergeHeaderFooterSlot(
  templateSlot: HeaderFooterSlot | undefined,
  sectionSlot: HeaderFooterSlot | undefined
): HeaderFooterSlot | undefined {
  if (sectionSlot === null) {
    return null;
  }
  if (sectionSlot === undefined) {
    return templateSlot;
  }
  if (templateSlot && typeof templateSlot === "object") {
    return {
      ...templateSlot,
      ...sectionSlot,
    };
  }
  return sectionSlot;
}

function mergeHeaderFooterGroup(
  templateGroup?: HeaderFooterGroup,
  sectionGroup?: HeaderFooterGroup
): HeaderFooterGroup | undefined {
  if (!templateGroup && !sectionGroup) {
    return undefined;
  }

  const mergedGroup: HeaderFooterGroup = {
    default: mergeHeaderFooterSlot(templateGroup?.default, sectionGroup?.default),
    first: mergeHeaderFooterSlot(templateGroup?.first, sectionGroup?.first),
    even: mergeHeaderFooterSlot(templateGroup?.even, sectionGroup?.even),
  };

  if (
    mergedGroup.default === undefined &&
    mergedGroup.first === undefined &&
    mergedGroup.even === undefined
  ) {
    return undefined;
  }

  return mergedGroup;
}

function mergeSectionConfig(
  template?: SectionTemplate,
  section?: SectionConfig
): SectionConfig {
  const mergedStyle = {
    ...(template?.style || {}),
    ...(section?.style || {}),
  };
  const mergedPageMargins = {
    ...(template?.page?.margin || {}),
    ...(section?.page?.margin || {}),
  };
  const mergedPageSize = {
    ...(template?.page?.size || {}),
    ...(section?.page?.size || {}),
  };
  const mergedPage = {
    ...(template?.page || {}),
    ...(section?.page || {}),
    ...(Object.keys(mergedPageMargins).length > 0
      ? { margin: mergedPageMargins }
      : {}),
    ...(Object.keys(mergedPageSize).length > 0 ? { size: mergedPageSize } : {}),
  };
  const mergedPageNumbering = {
    ...(template?.pageNumbering || {}),
    ...(section?.pageNumbering || {}),
  };
  const mergedHeaders = mergeHeaderFooterGroup(template?.headers, section?.headers);
  const mergedFooters = mergeHeaderFooterGroup(template?.footers, section?.footers);

  return {
    ...(template || {}),
    ...(section || {}),
    ...(Object.keys(mergedStyle).length > 0 ? { style: mergedStyle } : {}),
    ...(Object.keys(mergedPage).length > 0 ? { page: mergedPage } : {}),
    ...(Object.keys(mergedPageNumbering).length > 0
      ? { pageNumbering: mergedPageNumbering }
      : {}),
    ...(mergedHeaders ? { headers: mergedHeaders } : {}),
    ...(mergedFooters ? { footers: mergedFooters } : {}),
  };
}

function resolveSections(
  markdown: string,
  options: Options,
  baseStyle: Style
): ResolvedSectionInput[] {
  const normalizedTemplate = normalizeSectionConfig(options.template);
  const sections: DocumentSection[] =
    options.sections && options.sections.length > 0
      ? options.sections
      : [{ markdown }];

  return sections.map((section) => {
    const normalizedSection = normalizeSectionConfig(section) as DocumentSection;
    const mergedSectionConfig = mergeSectionConfig(
      normalizedTemplate,
      normalizedSection
    );
    const sectionStyle: Style = {
      ...baseStyle,
      ...(normalizedTemplate?.style || {}),
      ...(normalizedSection.style || {}),
    };

    return {
      markdown: normalizedSection.markdown,
      style: sectionStyle,
      config: mergedSectionConfig,
    };
  });
}

function validateStyleInput(
  style: Partial<Style> | undefined,
  styleContext: string
): void {
  if (!style) {
    return;
  }

  const { titleSize, headingSpacing, paragraphSpacing, lineSpacing } = style;
  if (titleSize !== undefined && (titleSize < 8 || titleSize > 72)) {
    throw new MarkdownConversionError(
      "Invalid title size: Must be between 8 and 72 points",
      { styleContext, titleSize }
    );
  }
  if (
    headingSpacing !== undefined &&
    (headingSpacing < 0 || headingSpacing > 720)
  ) {
    throw new MarkdownConversionError(
      "Invalid heading spacing: Must be between 0 and 720 twips",
      { styleContext, headingSpacing }
    );
  }
  if (
    paragraphSpacing !== undefined &&
    (paragraphSpacing < 0 || paragraphSpacing > 720)
  ) {
    throw new MarkdownConversionError(
      "Invalid paragraph spacing: Must be between 0 and 720 twips",
      { styleContext, paragraphSpacing }
    );
  }
  if (lineSpacing !== undefined && (lineSpacing < 1 || lineSpacing > 3)) {
    throw new MarkdownConversionError(
      "Invalid line spacing: Must be between 1 and 3",
      { styleContext, lineSpacing }
    );
  }

  if (
    style.fontFamily !== undefined &&
    (typeof style.fontFamily !== "string" ||
      style.fontFamily.trim().length === 0)
  ) {
    throw new MarkdownConversionError(
      "Invalid fontFamily: Must be a non-empty string",
      { styleContext, fontFamily: style.fontFamily }
    );
  }
}

function validatePageNumberingInput(
  pageNumbering: SectionConfig["pageNumbering"] | undefined,
  context: string
): void {
  if (!pageNumbering) {
    return;
  }

  if (
    pageNumbering.start !== undefined &&
    (!Number.isInteger(pageNumbering.start) || pageNumbering.start < 1)
  ) {
    throw new MarkdownConversionError(
      "Invalid page number start: Must be an integer >= 1",
      { context, pageNumberStart: pageNumbering.start }
    );
  }

  if (
    pageNumbering.display !== undefined &&
    !validPageNumberDisplays.includes(pageNumbering.display)
  ) {
    throw new MarkdownConversionError(
      "Invalid page number display: Must be one of none, current, currentAndTotal, currentAndSectionTotal",
      { context, pageNumberDisplay: pageNumbering.display }
    );
  }

  if (
    pageNumbering.alignment !== undefined &&
    !validAlignments.includes(pageNumbering.alignment)
  ) {
    throw new MarkdownConversionError(
      "Invalid page number alignment: Must be one of LEFT, CENTER, RIGHT, JUSTIFIED",
      { context, pageNumberAlignment: pageNumbering.alignment }
    );
  }

  if (
    pageNumbering.formatType !== undefined &&
    !validPageNumberFormats.includes(pageNumbering.formatType)
  ) {
    throw new MarkdownConversionError(
      "Invalid page number formatType: Must be one of decimal, upperRoman, lowerRoman, upperLetter, lowerLetter",
      { context, pageNumberFormatType: pageNumbering.formatType }
    );
  }

  if (
    pageNumbering.separator !== undefined &&
    !validPageNumberSeparators.includes(pageNumbering.separator)
  ) {
    throw new MarkdownConversionError(
      "Invalid page number separator: Must be one of hyphen, period, colon, emDash, endash",
      { context, pageNumberSeparator: pageNumbering.separator }
    );
  }
}

function validateHeaderFooterSlotInput(
  slot: HeaderFooterSlot | undefined,
  context: string
): void {
  if (slot === undefined || slot === null) {
    return;
  }

  if (typeof slot !== "object") {
    throw new MarkdownConversionError(
      "Invalid header/footer slot: Must be an object or null",
      { context, slot }
    );
  }

  if (slot.text !== undefined && typeof slot.text !== "string") {
    throw new MarkdownConversionError(
      "Invalid header/footer text: Must be a string",
      { context, text: slot.text }
    );
  }

  if (
    slot.alignment !== undefined &&
    !validAlignments.includes(slot.alignment)
  ) {
    throw new MarkdownConversionError(
      "Invalid header/footer alignment: Must be one of LEFT, CENTER, RIGHT, JUSTIFIED",
      { context, alignment: slot.alignment }
    );
  }

  if (
    slot.pageNumberDisplay !== undefined &&
    !validPageNumberDisplays.includes(slot.pageNumberDisplay)
  ) {
    throw new MarkdownConversionError(
      "Invalid header/footer page number display: Must be one of none, current, currentAndTotal, currentAndSectionTotal",
      { context, pageNumberDisplay: slot.pageNumberDisplay }
    );
  }
}

function validateHeaderFooterGroupInput(
  group: HeaderFooterGroup | undefined,
  context: string
): void {
  if (!group) {
    return;
  }

  validateHeaderFooterSlotInput(group.default, `${context}.default`);
  validateHeaderFooterSlotInput(group.first, `${context}.first`);
  validateHeaderFooterSlotInput(group.even, `${context}.even`);
}

function validateSectionConfigInput(
  config: SectionConfig | undefined,
  context: string
): void {
  if (!config) {
    return;
  }

  validateStyleInput(normalizeStyleInput(config.style), `${context}.style`);
  validatePageNumberingInput(config.pageNumbering, `${context}.pageNumbering`);
  validateHeaderFooterGroupInput(config.headers, `${context}.headers`);
  validateHeaderFooterGroupInput(config.footers, `${context}.footers`);

  if (
    config.titlePage !== undefined &&
    typeof config.titlePage !== "boolean"
  ) {
    throw new MarkdownConversionError(
      "Invalid titlePage: Must be a boolean value",
      { context, titlePage: config.titlePage }
    );
  }

  if (config.type !== undefined && !validSectionTypes.includes(config.type)) {
    throw new MarkdownConversionError(
      "Invalid section type: Must be one of NEXT_PAGE, NEXT_COLUMN, CONTINUOUS, EVEN_PAGE, ODD_PAGE",
      { context, sectionType: config.type }
    );
  }

  const margins = config.page?.margin;
  if (margins) {
    const marginEntries = Object.entries(margins);
    marginEntries.forEach(([name, value]) => {
      if (value === undefined) {
        return;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new MarkdownConversionError(
          `Invalid page margin '${name}': Must be a finite number >= 0`,
          { context, margin: name, value }
        );
      }
    });
  }

  const pageSize = config.page?.size;
  if (pageSize) {
    if (
      pageSize.width !== undefined &&
      (typeof pageSize.width !== "number" ||
        !Number.isFinite(pageSize.width) ||
        pageSize.width <= 0)
    ) {
      throw new MarkdownConversionError(
        "Invalid page width: Must be a finite number > 0",
        { context, width: pageSize.width }
      );
    }

    if (
      pageSize.height !== undefined &&
      (typeof pageSize.height !== "number" ||
        !Number.isFinite(pageSize.height) ||
        pageSize.height <= 0)
    ) {
      throw new MarkdownConversionError(
        "Invalid page height: Must be a finite number > 0",
        { context, height: pageSize.height }
      );
    }

    if (
      pageSize.orientation !== undefined &&
      !validPageOrientations.includes(pageSize.orientation)
    ) {
      throw new MarkdownConversionError(
        "Invalid page orientation: Must be PORTRAIT or LANDSCAPE",
        { context, orientation: pageSize.orientation }
      );
    }
  }
}

/**
 * Validates markdown input and options
 * @throws {MarkdownConversionError} If input is invalid
 */
function validateInput(markdown: string, options: Options): void {
  if (typeof markdown !== "string") {
    throw new MarkdownConversionError(
      "Invalid markdown input: Markdown must be a string"
    );
  }

  if (!options.sections && markdown.trim().length === 0) {
    throw new MarkdownConversionError(
      "Invalid markdown input: Markdown must be a non-empty string"
    );
  }

  validateStyleInput(normalizeStyleInput(options.style), "options.style");

  const normalizedTemplate = normalizeSectionConfig(options.template);
  if (normalizedTemplate) {
    validateSectionConfigInput(normalizedTemplate, "options.template");
  }

  if (options.sections) {
    if (!Array.isArray(options.sections) || options.sections.length === 0) {
      throw new MarkdownConversionError(
        "Invalid sections input: options.sections must contain at least one section"
      );
    }

    options.sections.forEach((section, index) => {
      if (!section || typeof section.markdown !== "string") {
        throw new MarkdownConversionError(
          "Invalid section markdown: each section must provide a markdown string",
          { sectionIndex: index }
        );
      }

      const normalizedSection = normalizeSectionConfig(section) as DocumentSection;
      validateSectionConfigInput(normalizedSection, `options.sections[${index}]`);
    });
  }
}

function resolveAlignment(
  alignment: AlignmentOption | undefined,
  fallback: AlignmentOption = "LEFT"
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  const resolved = alignment || fallback;
  return AlignmentType[resolved];
}

function resolveSectionType(
  sectionType: SectionConfig["type"] | undefined
): (typeof SectionType)[keyof typeof SectionType] | undefined {
  switch (sectionType) {
    case "NEXT_PAGE":
      return SectionType.NEXT_PAGE;
    case "NEXT_COLUMN":
      return SectionType.NEXT_COLUMN;
    case "CONTINUOUS":
      return SectionType.CONTINUOUS;
    case "EVEN_PAGE":
      return SectionType.EVEN_PAGE;
    case "ODD_PAGE":
      return SectionType.ODD_PAGE;
    default:
      return undefined;
  }
}

function resolvePageOrientation(
  orientation: "PORTRAIT" | "LANDSCAPE" | undefined
): (typeof PageOrientation)[keyof typeof PageOrientation] {
  return orientation === "LANDSCAPE"
    ? PageOrientation.LANDSCAPE
    : PageOrientation.PORTRAIT;
}

function resolvePageNumberFormat(
  formatType: ResolvedPageNumbering["formatType"] | undefined
): (typeof NumberFormat)[keyof typeof NumberFormat] | undefined {
  switch (formatType) {
    case "decimal":
      return NumberFormat.DECIMAL;
    case "upperRoman":
      return NumberFormat.UPPER_ROMAN;
    case "lowerRoman":
      return NumberFormat.LOWER_ROMAN;
    case "upperLetter":
      return NumberFormat.UPPER_LETTER;
    case "lowerLetter":
      return NumberFormat.LOWER_LETTER;
    default:
      return undefined;
  }
}

function resolvePageNumberSeparator(
  separator: ResolvedPageNumbering["separator"] | undefined
): (typeof PageNumberSeparator)[keyof typeof PageNumberSeparator] | undefined {
  switch (separator) {
    case "hyphen":
      return PageNumberSeparator.HYPHEN;
    case "period":
      return PageNumberSeparator.PERIOD;
    case "colon":
      return PageNumberSeparator.COLON;
    case "emDash":
      return PageNumberSeparator.EM_DASH;
    case "endash":
      return PageNumberSeparator.EN_DASH;
    default:
      return undefined;
  }
}

function buildPageNumberChildren(
  display: SectionPageNumberDisplay
): (string | (typeof PageNumber)[keyof typeof PageNumber])[] {
  switch (display) {
    case "current":
      return [PageNumber.CURRENT];
    case "currentAndTotal":
      return [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES];
    case "currentAndSectionTotal":
      return [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES_IN_SECTION];
    case "none":
    default:
      return [];
  }
}

function createHeaderFooterParagraph(
  slot: NonNullable<HeaderFooterSlot>,
  style: Style,
  fallbackDisplay: SectionPageNumberDisplay,
  fallbackAlignment: AlignmentOption
): Paragraph {
  const display = slot.pageNumberDisplay ?? fallbackDisplay;
  const alignment = resolveAlignment(slot.alignment, fallbackAlignment);
  const runChildren: (string | (typeof PageNumber)[keyof typeof PageNumber])[] =
    [];
  const text = slot.text || "";

  if (text.length > 0) {
    runChildren.push(text);
    if (display !== "none") {
      runChildren.push(" ");
    }
  }

  runChildren.push(...buildPageNumberChildren(display));

  if (runChildren.length === 0) {
    runChildren.push("");
  }

  return new Paragraph({
    alignment,
    bidirectional: style.direction === "RTL",
    children: [
      new TextRun({
        children: runChildren,
        size: style.paragraphSize || 24,
        font: resolveFontFamily(style),
        rightToLeft: style.direction === "RTL",
      }),
    ],
  });
}

function createHeaderFromSlot(
  slot: HeaderFooterSlot | undefined,
  style: Style
): Header | undefined {
  if (slot === undefined || slot === null) {
    return undefined;
  }

  return new Header({
    children: [createHeaderFooterParagraph(slot, style, "none", "LEFT")],
  });
}

function createFooterFromSlot(
  slot: HeaderFooterSlot | undefined,
  style: Style,
  defaultDisplay: SectionPageNumberDisplay,
  defaultAlignment: AlignmentOption
): Footer | undefined {
  if (slot === undefined || slot === null) {
    return undefined;
  }

  return new Footer({
    children: [
      createHeaderFooterParagraph(slot, style, defaultDisplay, defaultAlignment),
    ],
  });
}

function buildHeaders(
  group: HeaderFooterGroup | undefined,
  style: Style
): ISectionOptions["headers"] | undefined {
  if (!group) {
    return undefined;
  }

  const headers: { default?: Header; first?: Header; even?: Header } = {};

  if (group.default !== undefined) {
    const header = createHeaderFromSlot(group.default, style);
    if (header) {
      headers.default = header;
    }
  }
  if (group.first !== undefined) {
    const header = createHeaderFromSlot(group.first, style);
    if (header) {
      headers.first = header;
    }
  }
  if (group.even !== undefined) {
    const header = createHeaderFromSlot(group.even, style);
    if (header) {
      headers.even = header;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function buildFooters(
  sectionConfig: SectionConfig,
  style: Style
): ISectionOptions["footers"] | undefined {
  const defaultDisplay = sectionConfig.pageNumbering?.display || "current";
  const defaultAlignment = sectionConfig.pageNumbering?.alignment || "CENTER";
  const group = sectionConfig.footers;

  if (!group) {
    if (defaultDisplay === "none") {
      return undefined;
    }
    const autoFooter = createFooterFromSlot(
      {
        pageNumberDisplay: defaultDisplay,
        alignment: defaultAlignment,
      },
      style,
      defaultDisplay,
      defaultAlignment
    );
    return autoFooter ? { default: autoFooter } : undefined;
  }

  const footers: { default?: Footer; first?: Footer; even?: Footer } = {};

  if (group.default !== undefined) {
    const footer = createFooterFromSlot(
      group.default,
      style,
      defaultDisplay,
      defaultAlignment
    );
    if (footer) {
      footers.default = footer;
    }
  }
  if (group.first !== undefined) {
    const footer = createFooterFromSlot(
      group.first,
      style,
      defaultDisplay,
      defaultAlignment
    );
    if (footer) {
      footers.first = footer;
    }
  }
  if (group.even !== undefined) {
    const footer = createFooterFromSlot(
      group.even,
      style,
      defaultDisplay,
      defaultAlignment
    );
    if (footer) {
      footers.even = footer;
    }
  }

  return Object.keys(footers).length > 0 ? footers : undefined;
}

function buildSectionProperties(
  sectionConfig: SectionConfig
): NonNullable<ISectionOptions["properties"]> {
  const pageSize = {
    ...(sectionConfig.page?.size?.width !== undefined
      ? { width: sectionConfig.page.size.width }
      : {}),
    ...(sectionConfig.page?.size?.height !== undefined
      ? { height: sectionConfig.page.size.height }
      : {}),
    orientation: resolvePageOrientation(sectionConfig.page?.size?.orientation),
  };

  const resolvedFormatType = resolvePageNumberFormat(
    sectionConfig.pageNumbering?.formatType
  );
  const resolvedSeparator = resolvePageNumberSeparator(
    sectionConfig.pageNumbering?.separator
  );
  const pageNumberOptions = {
    ...(sectionConfig.pageNumbering?.start !== undefined
      ? { start: sectionConfig.pageNumbering.start }
      : {}),
    ...(resolvedFormatType ? { formatType: resolvedFormatType } : {}),
    ...(resolvedSeparator ? { separator: resolvedSeparator } : {}),
  };
  const hasPageNumberOptions = Object.keys(pageNumberOptions).length > 0;
  const resolvedSectionType = resolveSectionType(sectionConfig.type);

  return {
    page: {
      margin: {
        ...defaultSectionMargins,
        ...(sectionConfig.page?.margin || {}),
      },
      size: pageSize,
      ...(hasPageNumberOptions ? { pageNumbers: pageNumberOptions } : {}),
    },
    ...(sectionConfig.titlePage !== undefined
      ? { titlePage: sectionConfig.titlePage }
      : {}),
    ...(resolvedSectionType ? { type: resolvedSectionType } : {}),
  };
}

function buildTocContent(headings: TocHeadingEntry[], style: Style): Paragraph[] {
  const tocContent: Paragraph[] = [];

  if (headings.length === 0) {
    return tocContent;
  }

  tocContent.push(
    new Paragraph({
      text: "Table of Contents",
      heading: "Heading1",
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      bidirectional: style.direction === "RTL",
    })
  );

  headings.forEach((heading) => {
    let fontSize;
    let isBold = false;
    let isItalic = false;

    switch (heading.level) {
      case 1:
        fontSize = style.tocHeading1FontSize || style.tocFontSize;
        isBold = style.tocHeading1Bold !== undefined ? style.tocHeading1Bold : true;
        isItalic = style.tocHeading1Italic || false;
        break;
      case 2:
        fontSize = style.tocHeading2FontSize || style.tocFontSize;
        isBold =
          style.tocHeading2Bold !== undefined ? style.tocHeading2Bold : false;
        isItalic = style.tocHeading2Italic || false;
        break;
      case 3:
        fontSize = style.tocHeading3FontSize || style.tocFontSize;
        isBold = style.tocHeading3Bold || false;
        isItalic = style.tocHeading3Italic || false;
        break;
      case 4:
        fontSize = style.tocHeading4FontSize || style.tocFontSize;
        isBold = style.tocHeading4Bold || false;
        isItalic = style.tocHeading4Italic || false;
        break;
      case 5:
        fontSize = style.tocHeading5FontSize || style.tocFontSize;
        isBold = style.tocHeading5Bold || false;
        isItalic = style.tocHeading5Italic || false;
        break;
      default:
        fontSize = style.tocFontSize;
    }

    if (!fontSize) {
      fontSize = style.paragraphSize
        ? style.paragraphSize - (heading.level - 1) * 2
        : 24 - (heading.level - 1) * 2;
    }

    tocContent.push(
      new Paragraph({
        children: [
          new InternalHyperlink({
            anchor: heading.bookmarkId,
            children: [
              new TextRun({
                text: heading.text,
                size: fontSize,
                bold: isBold,
                italics: isItalic,
                font: resolveFontFamily(style),
              }),
            ],
          }),
        ],
        indent: { left: (heading.level - 1) * 400 },
        spacing: { after: 120 },
        bidirectional: style.direction === "RTL",
      })
    );
  });

  return tocContent;
}

function replaceTocPlaceholders(
  children: (Paragraph | Table)[],
  tocContent: Paragraph[],
  tocInserted: boolean
): { children: (Paragraph | Table)[]; tocInserted: boolean } {
  const nextChildren: (Paragraph | Table)[] = [];
  let inserted = tocInserted;

  children.forEach((child) => {
    if ((child as unknown as { __isTocPlaceholder?: boolean }).__isTocPlaceholder === true) {
      if (tocContent.length > 0 && !inserted) {
        nextChildren.push(...tocContent);
        inserted = true;
      } else {
        console.warn(
          "TOC placeholder found, but no headings collected or TOC already inserted."
        );
      }
      return;
    }

    nextChildren.push(child);
  });

  return { children: nextChildren, tocInserted: inserted };
}

/**
 * Convert Markdown to Docx file
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to a Blob containing the Docx file
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function convertMarkdownToDocx( markdown: string, options: Options = defaultOptions): Promise<Blob>  {
  try {
    
    const docxOptions = await parseToDocxOptions(markdown, options);
    // Create the document with appropriate settings
    const doc = new Document(docxOptions);

    return await Packer.toBlob(doc);

  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}
/**
 * Convert Markdown to Docx options
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to Docx options
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function parseToDocxOptions (
  markdown: string,
  options: Options = defaultOptions
): Promise<IPropertiesOptions> {
  try {
    // Validate inputs early
    validateInput(markdown, options);

    const normalizedStyle = normalizeStyleInput(options.style);
    // Merge user-provided style with defaults
    const style: Style = { ...defaultStyle, ...normalizedStyle };

    const resolvedSections = resolveSections(markdown, options, style);
    const renderedSections: {
      children: (Paragraph | Table)[];
      style: Style;
      config: SectionConfig;
    }[] = [];
    const headings: TocHeadingEntry[] = [];
    let maxSequenceId = 0;

    for (const section of resolvedSections) {
      const ast = await parseMarkdownToAst(section.markdown);

      if (options.textReplacements && options.textReplacements.length > 0) {
        applyTextReplacements(ast, options.textReplacements);
      }

      const model = mdastToDocxModel(ast, section.style, options);
      const renderedModel = await modelToDocx(model, section.style, options, {
        sequenceIdOffset: maxSequenceId,
      });

      maxSequenceId = Math.max(maxSequenceId, renderedModel.maxSequenceId);
      headings.push(...renderedModel.headings);

      renderedSections.push({
        children:
          renderedModel.children.length > 0
            ? renderedModel.children
            : [new Paragraph({})],
        style: section.style,
        config: section.config,
      });
    }

    const tocContent = buildTocContent(headings, style);
    let tocInserted = false;
    const docSections: ISectionOptions[] = renderedSections.map((section) => {
      const replacedTocChildren = replaceTocPlaceholders(
        section.children,
        tocContent,
        tocInserted
      );
      tocInserted = replacedTocChildren.tocInserted;

      const headers = buildHeaders(section.config.headers, section.style);
      const footers = buildFooters(section.config, section.style);

      return {
        properties: buildSectionProperties(section.config),
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {}),
        children: replacedTocChildren.children,
      };
    });

    // Create numbering configurations for all numbered list sequences
    const numberingConfigs = [];
    for (let i = 1; i <= maxSequenceId; i++) {
      numberingConfigs.push({
        reference: `numbered-list-${i}`,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 260 },
              },
            },
          },
        ],
      });
    }

    // Create the document with appropriate settings
    const docxOptions: IPropertiesOptions = {
      numbering: {
        config: numberingConfigs,
      },
      sections: docSections,
      styles: {
        paragraphStyles: [
          {
            id: "Title",
            name: "Title",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                after: 240,
                line: style.lineSpacing * 240,
              },
              alignment: AlignmentType.CENTER,
            },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                before: 360,
                after: 240,
              },
              outlineLevel: 1,
            },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 4,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                before: 320,
                after: 160,
              },
              outlineLevel: 2,
            },
          },
          {
            id: "Heading3",
            name: "Heading 3",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 8,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                before: 280,
                after: 120,
              },
              outlineLevel: 3,
            },
          },
          {
            id: "Heading4",
            name: "Heading 4",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 12,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                before: 240,
                after: 120,
              },
              outlineLevel: 4,
            },
          },
          {
            id: "Heading5",
            name: "Heading 5",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 16,
              bold: true,
              color: "000000",
              font: resolveFontFamily(style),
            },
            paragraph: {
              spacing: {
                before: 220,
                after: 100,
              },
              outlineLevel: 5,
            },
          },
          {
            id: "Strong",
            name: "Strong",
            run: {
              bold: true,
              font: resolveFontFamily(style),
            },
          },
        ],
      },
    };

    return docxOptions;
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}

/**
 * Downloads a DOCX file in the browser environment
 * @param blob - The Blob containing the DOCX file data
 * @param filename - The name to save the file as (defaults to "document.docx")
 * @throws {Error} If the function is called outside browser environment
 * @throws {Error} If invalid blob or filename is provided
 * @throws {Error} If file save fails
 */
export function downloadDocx(
  blob: Blob,
  filename: string = "document.docx"
): void {
  if (typeof window === "undefined") {
    throw new Error("This function can only be used in browser environments");
  }
  if (!(blob instanceof Blob)) {
    throw new Error("Invalid blob provided");
  }
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }
  try {
    saveAs(blob, filename);
  } catch (error) {
    console.error("Failed to save file:", error);
    throw new Error(
      `Failed to save file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
