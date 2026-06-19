import {
  AlignmentOption,
  CalloutType,
  DocumentSection,
  HeaderFooterGroup,
  HeaderFooterSlot,
  Options,
  SectionConfig,
  SectionPageNumberDisplay,
  Style,
  TocOptions,
} from "./types.js";
import { MarkdownConversionError } from "./errors.js";
import {
  normalizeSectionConfig,
  normalizeStyleInput,
} from "./sectionBuilder.js";

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
const validCalloutTypes: CalloutType[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
];

function validateHexColorOption(
  value: string | undefined,
  name: string,
  context: string
): void {
  if (value !== undefined && !/^[0-9A-Fa-f]{6}$/.test(value)) {
    throw new MarkdownConversionError(`${name} must be a 6-character hex color`, {
      context,
      value,
    });
  }
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

  validateHexColorOption(style.inlineCodeColor, "inlineCodeColor", styleContext);
  validateHexColorOption(
    style.inlineCodeBackground,
    "inlineCodeBackground",
    styleContext
  );

  if (style.calloutStyles !== undefined) {
    if (
      typeof style.calloutStyles !== "object" ||
      style.calloutStyles === null ||
      Array.isArray(style.calloutStyles)
    ) {
      throw new MarkdownConversionError("Invalid calloutStyles: Must be an object", {
        styleContext,
        calloutStyles: style.calloutStyles,
      });
    }

    for (const [calloutType, calloutStyle] of Object.entries(
      style.calloutStyles
    )) {
      if (!validCalloutTypes.includes(calloutType as CalloutType)) {
        throw new MarkdownConversionError(
          `Invalid calloutStyles key: ${calloutType}`,
          { styleContext, calloutType }
        );
      }
      if (
        typeof calloutStyle !== "object" ||
        calloutStyle === null ||
        Array.isArray(calloutStyle)
      ) {
        throw new MarkdownConversionError(
          `Invalid calloutStyles.${calloutType}: Must be an object`,
          { styleContext, calloutStyle }
        );
      }

      validateHexColorOption(
        calloutStyle.borderColor,
        `calloutStyles.${calloutType}.borderColor`,
        styleContext
      );
      validateHexColorOption(
        calloutStyle.backgroundColor,
        `calloutStyles.${calloutType}.backgroundColor`,
        styleContext
      );
      validateHexColorOption(
        calloutStyle.titleColor,
        `calloutStyles.${calloutType}.titleColor`,
        styleContext
      );
    }
  }
}

function validateTocOptionsInput(toc: TocOptions | undefined): void {
  if (!toc) {
    return;
  }

  if (toc.title !== undefined && typeof toc.title !== "string") {
    throw new MarkdownConversionError("Invalid TOC title: Must be a string", {
      title: toc.title,
    });
  }

  for (const [name, value] of [
    ["minDepth", toc.minDepth],
    ["maxDepth", toc.maxDepth],
  ] as const) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 1 || value > 6)
    ) {
      throw new MarkdownConversionError(
        `Invalid TOC ${name}: Must be an integer between 1 and 6`,
        { [name]: value }
      );
    }
  }

  if (
    toc.minDepth !== undefined &&
    toc.maxDepth !== undefined &&
    toc.minDepth > toc.maxDepth
  ) {
    throw new MarkdownConversionError(
      "Invalid TOC depth range: minDepth cannot be greater than maxDepth",
      { minDepth: toc.minDepth, maxDepth: toc.maxDepth }
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

function validatePositiveIntegerOption(
  value: number | undefined,
  name: string
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0)
  ) {
    throw new MarkdownConversionError(`${name} must be a positive integer`, {
      value,
    });
  }
}

function validateNonNegativeIntegerOption(
  value: number | undefined,
  name: string
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || !Number.isFinite(value) || value < 0)
  ) {
    throw new MarkdownConversionError(
      `${name} must be a non-negative integer`,
      {
        value,
      }
    );
  }
}

function validateImageHandlingInput(
  imageHandling: Options["imageHandling"]
): void {
  if (!imageHandling) {
    return;
  }

  validatePositiveIntegerOption(imageHandling.maxImages, "maxImages");
  validatePositiveIntegerOption(imageHandling.maxImageBytes, "maxImageBytes");
  validatePositiveIntegerOption(imageHandling.fetchTimeoutMs, "fetchTimeoutMs");
  validateNonNegativeIntegerOption(imageHandling.maxRedirects, "maxRedirects");
  validatePositiveIntegerOption(imageHandling.maxUrlLength, "maxUrlLength");

  if (
    imageHandling.remote?.allowedHosts !== undefined &&
    (!Array.isArray(imageHandling.remote.allowedHosts) ||
      imageHandling.remote.allowedHosts.some(
        (host) => typeof host !== "string" || host.trim().length === 0
      ))
  ) {
    throw new MarkdownConversionError(
      "Invalid imageHandling.remote.allowedHosts: must be non-empty strings"
    );
  }
}

function validateProcessingLimitsInput(options: Options): void {
  validatePositiveIntegerOption(options.maxInputLength, "maxInputLength");
  validatePositiveIntegerOption(options.maxElements, "maxElements");

  if (
    options.signal !== undefined &&
    (options.signal === null ||
      typeof options.signal !== "object" ||
      typeof options.signal.aborted !== "boolean" ||
      typeof options.signal.addEventListener !== "function" ||
      typeof options.signal.removeEventListener !== "function")
  ) {
    throw new MarkdownConversionError("Invalid signal: Must be an AbortSignal");
  }
}

/**
 * Validates markdown input and options
 * @throws {MarkdownConversionError} If input is invalid
 */
export function validateInput(markdown: string, options: Options): void {
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
  validateTocOptionsInput(options.toc);
  validateImageHandlingInput(options.imageHandling);
  validateProcessingLimitsInput(options);

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
