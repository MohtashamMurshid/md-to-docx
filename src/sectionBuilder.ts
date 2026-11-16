import {
  Paragraph,
  Table,
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
import { TextWatermark } from "docx/watermarks";
import {
  AlignmentOption,
  DocumentSection,
  HeaderFooterGroup,
  HeaderFooterSlot,
  Options,
  SectionConfig,
  SectionPageMargins,
  SectionPageNumberDisplay,
  SectionTemplate,
  Style,
  WatermarkOptions,
} from "./types.js";
import type { IPageMarginAttributes } from "docx";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { runLanguage } from "./accessibility.js";

type ResolvedPageNumbering = NonNullable<SectionConfig["pageNumbering"]>;
type HeaderFooterChannel = "default" | "first" | "even";
const HEADER_FOOTER_CHANNELS: HeaderFooterChannel[] = [
  "default",
  "first",
  "even",
];

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

  // Typed as optional: reference DOCX layouts and JS callers can carry
  // explicitly undefined margins that override the defaults.
  const margins: SectionPageMargins = {
    ...defaultSectionMargins,
    ...(config.page?.margin || {}),
  };
  const left = margins.left ?? defaultSectionMargins.left;
  const right = margins.right ?? defaultSectionMargins.right;

  return Math.max(1, Math.floor(displayedWidth - left - right));
}

/**
 * docx leaves out a margin attribute whose value is undefined, and reference
 * DOCX layouts carry explicitly undefined margins that override the defaults.
 * docx's type has no `| undefined`, so the merged margins are typed here, at
 * the one place they cross into docx.
 */
function docxPageMargins(
  margin: SectionPageMargins | undefined,
): IPageMarginAttributes {
  return {
    ...defaultSectionMargins,
    ...(margin || {}),
  } as IPageMarginAttributes;
}

export interface ResolvedSectionInput {
  markdown: string;
  style: Style;
  config: SectionConfig;
}

export function normalizeStyleInput(
  style?: Partial<Style>,
): Partial<Style> | undefined {
  if (!style) {
    return style;
  }

  const fontFamily = resolveFontFamily(style);
  if (!fontFamily) {
    return style;
  }

  return {
    ...style,
    fontFamily,
  };
}

export function normalizeSectionConfig<T extends SectionConfig>(
  section?: T,
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
  sectionSlot: HeaderFooterSlot | undefined,
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
  sectionGroup?: HeaderFooterGroup,
): HeaderFooterGroup | undefined {
  if (!templateGroup && !sectionGroup) {
    return undefined;
  }

  const mergedGroup: HeaderFooterGroup = {};
  for (const channel of HEADER_FOOTER_CHANNELS) {
    const slot = mergeHeaderFooterSlot(
      templateGroup?.[channel],
      sectionGroup?.[channel],
    );
    if (slot !== undefined) {
      mergedGroup[channel] = slot;
    }
  }

  if (Object.keys(mergedGroup).length === 0) {
    return undefined;
  }

  return mergedGroup;
}

/** Shallow-merges two config layers; the section layer wins per key. */
function layered<T extends object>(
  template: T | undefined,
  section: T | undefined,
): Partial<T> {
  return { ...(template || {}), ...(section || {}) };
}

/** The value, or undefined when it has no keys of its own. */
function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

function mergeSectionPage(
  template: SectionTemplate,
  section: SectionConfig,
): NonNullable<SectionConfig["page"]> {
  const margin = nonEmpty(layered(template.page?.margin, section.page?.margin));
  const size = nonEmpty(layered(template.page?.size, section.page?.size));
  return {
    ...layered(template.page, section.page),
    ...(margin ? { margin } : {}),
    ...(size ? { size } : {}),
  };
}

function mergeSectionConfig(
  templateInput?: SectionTemplate,
  sectionInput?: SectionConfig,
): SectionConfig {
  // `??`, not a default parameter: an untyped caller can pass a null template.
  const template = templateInput ?? {};
  const section = sectionInput ?? {};
  const style = nonEmpty(layered(template.style, section.style));
  const page = nonEmpty(mergeSectionPage(template, section));
  const pageNumbering = nonEmpty(
    layered(template.pageNumbering, section.pageNumbering),
  );
  const headers = mergeHeaderFooterGroup(template.headers, section.headers);
  const footers = mergeHeaderFooterGroup(template.footers, section.footers);

  return {
    ...template,
    ...section,
    ...(style ? { style } : {}),
    ...(page ? { page } : {}),
    ...(pageNumbering ? { pageNumbering } : {}),
    ...(headers ? { headers } : {}),
    ...(footers ? { footers } : {}),
  };
}

export function resolveSections(
  markdown: string,
  options: Options,
  baseStyle: Style,
): ResolvedSectionInput[] {
  const normalizedTemplate = normalizeSectionConfig(options.template);
  const sections: DocumentSection[] =
    options.sections && options.sections.length > 0
      ? options.sections
      : [{ markdown }];

  return sections.map((section) => {
    const normalizedSection = normalizeSectionConfig(
      section,
    ) as DocumentSection;
    const mergedSectionConfig = mergeSectionConfig(
      normalizedTemplate,
      normalizedSection,
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
  fallback: AlignmentOption = "LEFT",
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  const resolved = alignment || fallback;
  return AlignmentType[resolved];
}

type SectionTypeValue = (typeof SectionType)[keyof typeof SectionType];
type NumberFormatValue = (typeof NumberFormat)[keyof typeof NumberFormat];
type PageNumberSeparatorValue =
  (typeof PageNumberSeparator)[keyof typeof PageNumberSeparator];

// Lookup tables use Map (not object indexing) so inherited keys such as
// "toString" passed by untyped JS callers resolve to undefined.
const SECTION_TYPES: ReadonlyMap<string, SectionTypeValue> = new Map([
  ["NEXT_PAGE", SectionType.NEXT_PAGE],
  ["NEXT_COLUMN", SectionType.NEXT_COLUMN],
  ["CONTINUOUS", SectionType.CONTINUOUS],
  ["EVEN_PAGE", SectionType.EVEN_PAGE],
  ["ODD_PAGE", SectionType.ODD_PAGE],
]);

const PAGE_NUMBER_FORMATS: ReadonlyMap<string, NumberFormatValue> = new Map([
  ["decimal", NumberFormat.DECIMAL],
  ["upperRoman", NumberFormat.UPPER_ROMAN],
  ["lowerRoman", NumberFormat.LOWER_ROMAN],
  ["upperLetter", NumberFormat.UPPER_LETTER],
  ["lowerLetter", NumberFormat.LOWER_LETTER],
]);

const PAGE_NUMBER_SEPARATORS: ReadonlyMap<string, PageNumberSeparatorValue> =
  new Map([
    ["hyphen", PageNumberSeparator.HYPHEN],
    ["period", PageNumberSeparator.PERIOD],
    ["colon", PageNumberSeparator.COLON],
    ["emDash", PageNumberSeparator.EM_DASH],
    ["endash", PageNumberSeparator.EN_DASH],
  ]);

function lookupOption<V>(
  table: ReadonlyMap<string, V>,
  key: string | undefined,
): V | undefined {
  return key === undefined ? undefined : table.get(key);
}

function resolveSectionType(
  sectionType: SectionConfig["type"] | undefined,
): SectionTypeValue | undefined {
  return lookupOption(SECTION_TYPES, sectionType);
}

function resolvePageOrientation(
  orientation: "PORTRAIT" | "LANDSCAPE" | undefined,
): (typeof PageOrientation)[keyof typeof PageOrientation] {
  return orientation === "LANDSCAPE"
    ? PageOrientation.LANDSCAPE
    : PageOrientation.PORTRAIT;
}

function resolvePageNumberFormat(
  formatType: ResolvedPageNumbering["formatType"] | undefined,
): NumberFormatValue | undefined {
  return lookupOption(PAGE_NUMBER_FORMATS, formatType);
}

function resolvePageNumberSeparator(
  separator: ResolvedPageNumbering["separator"] | undefined,
): PageNumberSeparatorValue | undefined {
  return lookupOption(PAGE_NUMBER_SEPARATORS, separator);
}

function buildPageNumberChildren(
  display: SectionPageNumberDisplay,
): string[] {
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
  fallbackAlignment: AlignmentOption,
): Paragraph {
  const display = slot.pageNumberDisplay ?? fallbackDisplay;
  const alignment = resolveAlignment(slot.alignment, fallbackAlignment);
  const runChildren: string[] = [];
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

  const font = resolveFontFamily(style);
  const language = runLanguage(style);

  return new Paragraph({
    alignment,
    bidirectional: style.direction === "RTL",
    children: [
      new TextRun({
        children: runChildren,
        size: style.paragraphSize || 24,
        ...(font !== undefined ? { font } : {}),
        rightToLeft: style.direction === "RTL",
        ...(language !== undefined ? { language } : {}),
      }),
    ],
  });
}

/**
 * A paragraph holding only the watermark. Its shape is positioned on the
 * page, so the paragraph takes no spacing of its own in the header.
 */
function watermarkParagraph(watermark: WatermarkOptions): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [
      new TextWatermark({
        text: watermark.text,
        ...(watermark.color !== undefined ? { color: watermark.color } : {}),
        ...(watermark.opacity !== undefined
          ? { opacity: watermark.opacity }
          : {}),
        ...(watermark.layout !== undefined ? { layout: watermark.layout } : {}),
      }),
    ],
  });
}

function createHeaderFromSlot(
  slot: NonNullable<HeaderFooterSlot>,
  style: Style,
  rich: (Paragraph | Table)[] = [],
  watermark?: WatermarkOptions,
): Header {
  return new Header({
    children: [
      ...rich,
      ...(!rich.length ||
      slot.text ||
      (slot.pageNumberDisplay && slot.pageNumberDisplay !== "none")
        ? [createHeaderFooterParagraph(slot, style, "none", "LEFT")]
        : []),
      ...(watermark ? [watermarkParagraph(watermark)] : []),
    ],
  });
}

function createFooterFromSlot(
  slot: HeaderFooterSlot | undefined,
  style: Style,
  defaults: { display: SectionPageNumberDisplay; alignment: AlignmentOption },
  rich: (Paragraph | Table)[] = [],
): Footer | undefined {
  const { display: defaultDisplay, alignment: defaultAlignment } = defaults;
  if (slot === undefined || slot === null) {
    return undefined;
  }

  return new Footer({
    children: [
      ...rich,
      ...(!rich.length ||
      slot.text ||
      (slot.pageNumberDisplay ?? defaultDisplay) !== "none"
        ? [
            createHeaderFooterParagraph(
              slot,
              style,
              defaultDisplay,
              defaultAlignment,
            ),
          ]
        : []),
    ],
  });
}

/**
 * Whether a watermarked section needs a header on `channel` even with no
 * header content there: the default header covers every page, and a
 * first-page or even-page header the section names, or a title page, would
 * otherwise show those pages without the watermark.
 */
function watermarkNeedsHeader(
  config: SectionConfig,
  channel: HeaderFooterChannel,
): boolean {
  return (
    channel === "default" ||
    config.headers?.[channel] !== undefined ||
    (channel === "first" && config.titlePage === true)
  );
}

export function buildHeaders(
  config: SectionConfig,
  style: Style,
  rich = new Map<HeaderFooterSlot, (Paragraph | Table)[]>(),
  watermark?: WatermarkOptions,
): ISectionOptions["headers"] | undefined {
  const headers: { default?: Header; first?: Header; even?: Header } = {};
  for (const channel of HEADER_FOOTER_CHANNELS) {
    const slot = config.headers?.[channel];
    if (slot) {
      headers[channel] = createHeaderFromSlot(
        slot,
        style,
        rich.get(slot),
        watermark,
      );
    } else if (watermark && watermarkNeedsHeader(config, channel)) {
      headers[channel] = new Header({
        children: [watermarkParagraph(watermark)],
      });
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function buildFooters(
  sectionConfig: SectionConfig,
  style: Style,
  rich = new Map<HeaderFooterSlot, (Paragraph | Table)[]>(),
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
      { display: defaultDisplay, alignment: defaultAlignment },
    );
    return autoFooter ? { default: autoFooter } : undefined;
  }

  const footers: { default?: Footer; first?: Footer; even?: Footer } = {};
  for (const channel of HEADER_FOOTER_CHANNELS) {
    const footer = createFooterFromSlot(
      group[channel],
      style,
      { display: defaultDisplay, alignment: defaultAlignment },
      rich.get(group[channel] ?? null),
    );
    if (footer) {
      footers[channel] = footer;
    }
  }

  return Object.keys(footers).length > 0 ? footers : undefined;
}

export function buildSectionProperties(
  sectionConfig: SectionConfig,
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
    sectionConfig.pageNumbering?.formatType,
  );
  const resolvedSeparator = resolvePageNumberSeparator(
    sectionConfig.pageNumbering?.separator,
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
      margin: docxPageMargins(sectionConfig.page?.margin),
      size: pageSize,
      ...(hasPageNumberOptions ? { pageNumbers: pageNumberOptions } : {}),
    },
    ...(sectionConfig.titlePage !== undefined
      ? { titlePage: sectionConfig.titlePage }
      : {}),
    ...(resolvedSectionType ? { type: resolvedSectionType } : {}),
  };
}
