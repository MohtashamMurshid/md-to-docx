import {
  AlignmentOption,
  CaptionOptions,
  DocumentSection,
  HeaderFooterContent,
  HeaderFooterGroup,
  HeaderFooterSlot,
  Options,
  SectionConfig,
  SectionPageNumberDisplay,
  SectionPageNumbering,
  SectionPageSize,
  TocOptions,
  TocTabLeader,
} from "./types.js";
import { MarkdownConversionError } from "./errors.js";
import { validateAccessibilityOptions } from "./accessibility.js";
import { validateDocumentMetadata } from "./metadata.js";
import {
  normalizeSectionConfig,
  normalizeStyleInput,
} from "./sectionBuilder.js";
import { validatePluginConfiguration } from "./pluginRuntime.js";
import { validateStyleInput } from "./styleValidation.js";
import {
  AnyFieldRule,
  FieldRule,
  checkFields,
  isBlankOrNotString,
  isNotBoolean,
  isNotOneOf,
  isNotString,
  scopedContext,
  valueContext,
} from "./validationRules.js";

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
const validTextReplacementModes = ["trusted", "untrusted"] as const;
const validTocTabLeaders: readonly TocTabLeader[] = [
  "dot",
  "hyphen",
  "underscore",
  "middleDot",
  "none",
];

function booleanRule<T, K extends keyof T>(
  key: K,
  message: string,
): FieldRule<T, K> {
  return { key, message, invalid: isNotBoolean };
}

function isNotPositiveFinite(value: unknown): boolean {
  return typeof value !== "number" || !Number.isFinite(value) || value <= 0;
}

function isNotTocDepth(value: number): boolean {
  return !Number.isInteger(value) || value < 1 || value > 6;
}

/** TOC checks in the order they run; the first failure is reported. */
const TOC_RULES: readonly AnyFieldRule<TocOptions>[] = [
  {
    key: "mode",
    message: "Invalid toc.mode",
    invalid: isNotOneOf(["native", "links"]),
  },
  booleanRule("pageNumbers", "Invalid toc.pageNumbers"),
  booleanRule("dotLeaders", "Invalid toc.dotLeaders"),
  {
    key: "tabLeader",
    message: "Invalid toc.tabLeader",
    invalid: isNotOneOf(validTocTabLeaders),
  },
  booleanRule("prefillPageNumbers", "Invalid toc.prefillPageNumbers"),
  booleanRule("updateFieldsOnOpen", "Invalid toc.updateFieldsOnOpen"),
  {
    key: "title",
    message: "Invalid TOC title: Must be a string",
    invalid: isNotString,
    context: valueContext("title"),
  },
  {
    key: "minDepth",
    message: "Invalid TOC minDepth: Must be an integer between 1 and 6",
    invalid: isNotTocDepth,
    context: valueContext("minDepth"),
  },
  {
    key: "maxDepth",
    message: "Invalid TOC maxDepth: Must be an integer between 1 and 6",
    invalid: isNotTocDepth,
    context: valueContext("maxDepth"),
  },
];

function validateTocOptionsInput(toc: TocOptions | undefined): void {
  if (!toc) {
    return;
  }

  checkFields(toc, TOC_RULES);

  const { minDepth, maxDepth } = toc;
  if (minDepth !== undefined && maxDepth !== undefined && minDepth > maxDepth) {
    throw new MarkdownConversionError(
      "Invalid TOC depth range: minDepth cannot be greater than maxDepth",
      { minDepth, maxDepth },
    );
  }
}

/** Caption checks in the order they run; none carries a context. */
const CAPTION_RULES: readonly AnyFieldRule<CaptionOptions>[] = [
  {
    key: "figureLabel",
    message: "Invalid captions.figureLabel: Must be a non-empty string",
    invalid: isBlankOrNotString,
  },
  {
    key: "tableLabel",
    message: "Invalid captions.tableLabel: Must be a non-empty string",
    invalid: isBlankOrNotString,
  },
  {
    key: "figurePlacement",
    message: "Invalid captions.figurePlacement: Must be above or below",
    invalid: isNotOneOf(["above", "below"]),
  },
  {
    key: "tablePlacement",
    message: "Invalid captions.tablePlacement: Must be above or below",
    invalid: isNotOneOf(["above", "below"]),
  },
  {
    key: "alignment",
    message:
      "Invalid captions.alignment: Must be LEFT, CENTER, RIGHT, or JUSTIFIED",
    invalid: isNotOneOf(validAlignments),
  },
  booleanRule("italic", "Invalid captions.italic: Must be a boolean"),
  booleanRule(
    "updateFieldsOnOpen",
    "Invalid captions.updateFieldsOnOpen: Must be a boolean",
  ),
  {
    key: "size",
    message: "Invalid captions.size: Must be between 8 and 144 half-points",
    invalid: (size) => !Number.isFinite(size) || size < 8 || size > 144,
  },
  {
    key: "failureMode",
    message: "Invalid captions.failureMode: Must be preserve or throw",
    invalid: isNotOneOf(["preserve", "throw"]),
  },
];

function validateCaptionOptionsInput(
  captions: CaptionOptions | undefined,
): void {
  if (captions) {
    checkFields(captions, CAPTION_RULES);
  }
}

/** Page numbering checks; contexts name the field `pageNumber<Field>`. */
const PAGE_NUMBERING_RULES: readonly AnyFieldRule<SectionPageNumbering>[] = [
  {
    key: "start",
    message: "Invalid page number start: Must be an integer >= 1",
    invalid: (start) => !Number.isInteger(start) || start < 1,
    context: scopedContext("pageNumberStart"),
  },
  {
    key: "display",
    message:
      "Invalid page number display: Must be one of none, current, currentAndTotal, currentAndSectionTotal",
    invalid: isNotOneOf(validPageNumberDisplays),
    context: scopedContext("pageNumberDisplay"),
  },
  {
    key: "alignment",
    message:
      "Invalid page number alignment: Must be one of LEFT, CENTER, RIGHT, JUSTIFIED",
    invalid: isNotOneOf(validAlignments),
    context: scopedContext("pageNumberAlignment"),
  },
  {
    key: "formatType",
    message:
      "Invalid page number formatType: Must be one of decimal, upperRoman, lowerRoman, upperLetter, lowerLetter",
    invalid: isNotOneOf(validPageNumberFormats),
    context: scopedContext("pageNumberFormatType"),
  },
  {
    key: "separator",
    message:
      "Invalid page number separator: Must be one of hyphen, period, colon, emDash, endash",
    invalid: isNotOneOf(validPageNumberSeparators),
    context: scopedContext("pageNumberSeparator"),
  },
];

/** Header/footer slot checks, run once the slot is known to be an object. */
const HEADER_FOOTER_SLOT_RULES: readonly AnyFieldRule<HeaderFooterContent>[] = [
  {
    key: "markdown",
    message: "Invalid header/footer markdown: Must be a string",
    invalid: isNotString,
  },
  {
    key: "text",
    message: "Invalid header/footer text: Must be a string",
    invalid: isNotString,
    context: scopedContext("text"),
  },
  {
    key: "alignment",
    message:
      "Invalid header/footer alignment: Must be one of LEFT, CENTER, RIGHT, JUSTIFIED",
    invalid: isNotOneOf(validAlignments),
    context: scopedContext("alignment"),
  },
  {
    key: "pageNumberDisplay",
    message:
      "Invalid header/footer page number display: Must be one of none, current, currentAndTotal, currentAndSectionTotal",
    invalid: isNotOneOf(validPageNumberDisplays),
    context: scopedContext("pageNumberDisplay"),
  },
];

function validateHeaderFooterSlotInput(
  slot: HeaderFooterSlot | undefined,
  context: string,
): void {
  if (slot === undefined || slot === null) {
    return;
  }

  if (typeof slot !== "object") {
    throw new MarkdownConversionError(
      "Invalid header/footer slot: Must be an object or null",
      { context, slot },
    );
  }

  checkFields(slot, HEADER_FOOTER_SLOT_RULES, context);
}

function validateHeaderFooterGroupInput(
  group: HeaderFooterGroup | undefined,
  context: string,
): void {
  if (!group) {
    return;
  }

  validateHeaderFooterSlotInput(group.default, `${context}.default`);
  validateHeaderFooterSlotInput(group.first, `${context}.first`);
  validateHeaderFooterSlotInput(group.even, `${context}.even`);
}

/** Section fields checked after style, page numbering, headers and footers. */
const SECTION_RULES: readonly AnyFieldRule<SectionConfig>[] = [
  {
    key: "titlePage",
    message: "Invalid titlePage: Must be a boolean value",
    invalid: isNotBoolean,
    context: scopedContext("titlePage"),
  },
  {
    key: "type",
    message:
      "Invalid section type: Must be one of NEXT_PAGE, NEXT_COLUMN, CONTINUOUS, EVEN_PAGE, ODD_PAGE",
    invalid: isNotOneOf(validSectionTypes),
    context: scopedContext("sectionType"),
  },
];

const PAGE_SIZE_RULES: readonly AnyFieldRule<SectionPageSize>[] = [
  {
    key: "width",
    message: "Invalid page width: Must be a finite number > 0",
    invalid: isNotPositiveFinite,
    context: scopedContext("width"),
  },
  {
    key: "height",
    message: "Invalid page height: Must be a finite number > 0",
    invalid: isNotPositiveFinite,
    context: scopedContext("height"),
  },
  {
    key: "orientation",
    message: "Invalid page orientation: Must be PORTRAIT or LANDSCAPE",
    invalid: isNotOneOf(validPageOrientations),
    context: scopedContext("orientation"),
  },
];

function isNotNonNegativeFinite(value: unknown): boolean {
  return typeof value !== "number" || !Number.isFinite(value) || value < 0;
}

function validatePageMarginsInput(
  margins: NonNullable<SectionConfig["page"]>["margin"],
  context: string,
): void {
  if (!margins) {
    return;
  }
  const marginEntries: [string, unknown][] = Object.entries(margins);
  for (const [name, value] of marginEntries) {
    if (value !== undefined && isNotNonNegativeFinite(value)) {
      throw new MarkdownConversionError(
        `Invalid page margin '${name}': Must be a finite number >= 0`,
        { context, margin: name, value },
      );
    }
  }
}

function validateSectionConfigInput(
  config: SectionConfig | undefined,
  context: string,
): void {
  if (!config) {
    return;
  }

  validateStyleInput(normalizeStyleInput(config.style), `${context}.style`);
  if (config.pageNumbering) {
    checkFields(
      config.pageNumbering,
      PAGE_NUMBERING_RULES,
      `${context}.pageNumbering`,
    );
  }
  validateHeaderFooterGroupInput(config.headers, `${context}.headers`);
  validateHeaderFooterGroupInput(config.footers, `${context}.footers`);
  checkFields(config, SECTION_RULES, context);
  validatePageMarginsInput(config.page?.margin, context);
  if (config.page?.size) {
    checkFields(config.page.size, PAGE_SIZE_RULES, context);
  }
}

function validateMathRenderingInput(
  mathRendering: Options["mathRendering"],
): void {
  if (!mathRendering) {
    return;
  }

  if (
    mathRendering.enabled !== undefined &&
    typeof mathRendering.enabled !== "boolean"
  ) {
    throw new MarkdownConversionError(
      "Invalid mathRendering.enabled: Must be a boolean",
    );
  }

  const unsupported: unknown = mathRendering.unsupported;
  if (
    unsupported !== undefined &&
    unsupported !== "text" &&
    unsupported !== "throw"
  ) {
    throw new MarkdownConversionError(
      'Invalid mathRendering.unsupported: Must be "text" or "throw"',
      { unsupported },
    );
  }
}

function validatePositiveIntegerOption(
  value: number | undefined,
  name: string,
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
  name: string,
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || !Number.isFinite(value) || value < 0)
  ) {
    throw new MarkdownConversionError(
      `${name} must be a non-negative integer`,
      {
        value,
      },
    );
  }
}

function validateImageHandlingInput(
  imageHandling: Options["imageHandling"],
): void {
  if (!imageHandling) {
    return;
  }

  if (
    imageHandling.resolve !== undefined &&
    typeof imageHandling.resolve !== "function"
  )
    throw new MarkdownConversionError(
      "imageHandling.resolve must be a function",
    );
  if (
    imageHandling.baseDirectory !== undefined &&
    (typeof imageHandling.baseDirectory !== "string" ||
      !imageHandling.baseDirectory.trim())
  )
    throw new MarkdownConversionError(
      "imageHandling.baseDirectory must be a non-empty string",
    );
  validatePositiveIntegerOption(imageHandling.maxImages, "maxImages");
  validatePositiveIntegerOption(imageHandling.maxImageBytes, "maxImageBytes");
  validatePositiveIntegerOption(imageHandling.fetchTimeoutMs, "fetchTimeoutMs");
  validateNonNegativeIntegerOption(imageHandling.maxRedirects, "maxRedirects");
  validatePositiveIntegerOption(imageHandling.maxUrlLength, "maxUrlLength");

  if (
    imageHandling.remote?.allowedHosts !== undefined &&
    (!Array.isArray(imageHandling.remote.allowedHosts) ||
      imageHandling.remote.allowedHosts.some(
        (host) => typeof host !== "string" || host.trim().length === 0,
      ))
  ) {
    throw new MarkdownConversionError(
      "Invalid imageHandling.remote.allowedHosts: must be non-empty strings",
    );
  }
}

const CHART_RENDERING_RULES: readonly AnyFieldRule<
  NonNullable<Options["chartRendering"]>
>[] = [
  {
    key: "output",
    message: "Invalid chartRendering.output: must be image or native",
    invalid: isNotOneOf(["image", "native"]),
    context: valueContext("output"),
  },
];

function validateChartRenderingInput(
  chartRendering: Options["chartRendering"],
): void {
  if (!chartRendering) {
    return;
  }

  validatePositiveIntegerOption(chartRendering.width, "chartRendering.width");
  validatePositiveIntegerOption(chartRendering.height, "chartRendering.height");
  validatePositiveIntegerOption(
    chartRendering.maxWidth,
    "chartRendering.maxWidth",
  );
  validatePositiveIntegerOption(
    chartRendering.maxHeight,
    "chartRendering.maxHeight",
  );

  const invalidDefinitionBehavior: unknown =
    chartRendering.invalidDefinitionBehavior;
  if (
    invalidDefinitionBehavior !== undefined &&
    invalidDefinitionBehavior !== "placeholder" &&
    invalidDefinitionBehavior !== "throw"
  ) {
    throw new MarkdownConversionError(
      "Invalid chartRendering.invalidDefinitionBehavior: must be placeholder or throw",
    );
  }

  if (
    chartRendering.renderer !== undefined &&
    typeof chartRendering.renderer !== "function"
  ) {
    throw new MarkdownConversionError(
      "Invalid chartRendering.renderer: must be a function",
    );
  }

  checkFields(chartRendering, CHART_RENDERING_RULES);
}

function validateMermaidRenderingInput(
  mermaidRendering: Options["mermaidRendering"],
): void {
  if (!mermaidRendering) {
    return;
  }

  if (
    mermaidRendering.render !== undefined &&
    typeof mermaidRendering.render !== "function"
  ) {
    throw new MarkdownConversionError(
      "Invalid mermaidRendering.render: must be a function",
    );
  }

  if (
    mermaidRendering.failureMode !== undefined &&
    !["codeBlock", "placeholder", "throw"].includes(
      mermaidRendering.failureMode,
    )
  ) {
    throw new MarkdownConversionError(
      "Invalid mermaidRendering.failureMode: must be codeBlock, placeholder, or throw",
    );
  }
}

function validateProcessingLimitsInput(options: Options): void {
  validatePositiveIntegerOption(options.maxInputLength, "maxInputLength");
  validatePositiveIntegerOption(options.maxElements, "maxElements");

  // Read as unknown: options may come from untyped JS callers.
  const signal: unknown = options.signal;
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal !== "object" ||
      !("aborted" in signal) ||
      typeof signal.aborted !== "boolean" ||
      !("addEventListener" in signal) ||
      typeof signal.addEventListener !== "function" ||
      !("removeEventListener" in signal) ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new MarkdownConversionError("Invalid signal: Must be an AbortSignal");
  }
}

function validateTextReplacementInput(options: Options): void {
  const mode = options.textReplacementMode;

  if (mode !== undefined && !validTextReplacementModes.includes(mode)) {
    throw new MarkdownConversionError(
      "Invalid textReplacementMode: Must be trusted or untrusted",
      { textReplacementMode: options.textReplacementMode },
    );
  }

  if (!options.textReplacements || (mode ?? "trusted") !== "untrusted") {
    return;
  }

  if (
    options.textReplacements.some(
      (replacement) => typeof replacement.replace === "function",
    )
  ) {
    throw new MarkdownConversionError(
      'Function textReplacements are not allowed when textReplacementMode is "untrusted"',
    );
  }
}

/**
 * Validates markdown input and options
 * @throws {MarkdownConversionError} If input is invalid
 */
export function validateInput(markdown: string, options: Options): void {
  if (typeof markdown !== "string") {
    throw new MarkdownConversionError(
      "Invalid markdown input: Markdown must be a string",
    );
  }

  if (!options.sections && markdown.trim().length === 0) {
    throw new MarkdownConversionError(
      "Invalid markdown input: Markdown must be a non-empty string",
    );
  }

  if (
    options.onWarning !== undefined &&
    typeof options.onWarning !== "function"
  )
    throw new MarkdownConversionError("onWarning must be a function");
  validateStyleInput(normalizeStyleInput(options.style), "options.style");
  validateDocumentMetadata(options.metadata);
  validateAccessibilityOptions(options.accessibility);
  validateTocOptionsInput(options.toc);
  validateMathRenderingInput(options.mathRendering);
  validateCaptionOptionsInput(options.captions);
  validateImageHandlingInput(options.imageHandling);
  validateChartRenderingInput(options.chartRendering);
  validateMermaidRenderingInput(options.mermaidRendering);
  validateProcessingLimitsInput(options);
  validateTextReplacementInput(options);
  validatePluginConfiguration(options);

  const normalizedTemplate = normalizeSectionConfig(options.template);
  if (normalizedTemplate) {
    validateSectionConfigInput(normalizedTemplate, "options.template");
  }

  if (options.sections) {
    if (!Array.isArray(options.sections) || options.sections.length === 0) {
      throw new MarkdownConversionError(
        "Invalid sections input: options.sections must contain at least one section",
      );
    }

    // Entries may be null or undefined when sections come from untyped JS.
    options.sections.forEach(
      (section: DocumentSection | null | undefined, index) => {
        if (!section || typeof section.markdown !== "string") {
          throw new MarkdownConversionError(
            "Invalid section markdown: each section must provide a markdown string",
            { sectionIndex: index },
          );
        }

        const normalizedSection = normalizeSectionConfig(
          section,
        ) as DocumentSection;
        validateSectionConfigInput(
          normalizedSection,
          `options.sections[${index}]`,
        );
      },
    );
  }
}
