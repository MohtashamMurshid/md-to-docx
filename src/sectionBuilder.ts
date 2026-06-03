import {
  Paragraph,
  TextRun,
  AlignmentType,
  PageOrientation,
  PageNumber,
  NumberFormat,
  PageNumberSeparator,
  SectionType,
  Header,
  Footer,
  ISectionOptions,
} from "docx";
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
import { resolveFontFamily } from "./utils/styleUtils.js";

type ResolvedPageNumbering = NonNullable<SectionConfig["pageNumbering"]>;
type HeaderFooterChannel = "default" | "first" | "even";
const HEADER_FOOTER_CHANNELS: HeaderFooterChannel[] = ["default", "first", "even"];

const defaultSectionMargins = {
  top: 1440,
  right: 1080,
  bottom: 1440,
  left: 1080,
};

// docx page-size defaults (A4 portrait), expressed in twips.
const DEFAULT_PAGE_WIDTH_TWIPS = 11906;
const DEFAULT_PAGE_HEIGHT_TWIPS = 16838;

/**
 * Computes the usable content width of a section in twips (page width minus
 * left/right margins), mirroring how docx resolves the displayed page width
 * (the longer edge is used as the width in landscape orientation).
 *
 * Tables are sized with this value using {@link WidthType.DXA} so they emit a
 * plain integer width. The percentage form produced by docx
 * (`<w:tblW w:type="pct" w:w="100%"/>`) is rejected as corrupt by Word 2007,
 * which expects fiftieths of a percent rather than a literal percentage.
 */
export function getSectionContentWidthTwips(config: SectionConfig): number {
  const size = config.page?.size;
  const width = size?.width ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const height = size?.height ?? DEFAULT_PAGE_HEIGHT_TWIPS;
  const orientation = resolvePageOrientation(size?.orientation);
  const displayedWidth =
    orientation === PageOrientation.LANDSCAPE ? height : width;

  const margins = { ...defaultSectionMargins, ...(config.page?.margin || {}) };
  const left = margins.left ?? defaultSectionMargins.left;
  const right = margins.right ?? defaultSectionMargins.right;

  return Math.max(1, Math.floor(displayedWidth - left - right));
}

export interface ResolvedSectionInput {
  markdown: string;
  style: Style;
  config: SectionConfig;
}

export function normalizeStyleInput(
  style?: Partial<Style>
): Partial<Style> | undefined {
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

export function normalizeSectionConfig<T extends SectionConfig>(
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

export function resolveSections(
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

export function buildHeaders(
  group: HeaderFooterGroup | undefined,
  style: Style
): ISectionOptions["headers"] | undefined {
  if (!group) {
    return undefined;
  }

  const headers: { default?: Header; first?: Header; even?: Header } = {};
  for (const channel of HEADER_FOOTER_CHANNELS) {
    const header = createHeaderFromSlot(group[channel], style);
    if (header) {
      headers[channel] = header;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function buildFooters(
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
  for (const channel of HEADER_FOOTER_CHANNELS) {
    const footer = createFooterFromSlot(
      group[channel],
      style,
      defaultDisplay,
      defaultAlignment
    );
    if (footer) {
      footers[channel] = footer;
    }
  }

  return Object.keys(footers).length > 0 ? footers : undefined;
}

export function buildSectionProperties(
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
