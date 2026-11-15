import type { CalloutStyle, CalloutType, Style } from "./types.js";
import { MarkdownConversionError } from "./errors.js";
import { validateOoxmlText } from "./accessibility.js";
import { MAX_METADATA_LANGUAGE_LENGTH } from "./metadata.js";
import {
  AnyFieldRule,
  FieldRule,
  checkFields,
  isBlankOrNotString,
  isNotBoolean,
  scopedContext,
} from "./validationRules.js";

type StyleInput = Partial<Style>;

const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const MAX_TABLE_TWIPS = 31680;
const CALLOUT_TYPES: readonly string[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] satisfies CalloutType[];
const CALLOUT_COLOR_FIELDS = [
  "borderColor",
  "backgroundColor",
  "titleColor",
] as const;

function validateHexColor(
  value: string | undefined,
  name: string,
  context: string,
): void {
  if (value !== undefined && !HEX_COLOR.test(value)) {
    throw new MarkdownConversionError(`${name} must be a 6-character hex color`, {
      context,
      value,
    });
  }
}

function hexColorRule<K extends "tableHeaderBackground" | "inlineCodeColor" | "inlineCodeBackground">(
  key: K,
): FieldRule<StyleInput, K> {
  return {
    key,
    message: `${key} must be a 6-character hex color`,
    invalid: (value) => !HEX_COLOR.test(value),
    context: (value, scope) => ({ context: scope, value }),
  };
}

function rangeRule<K extends "titleSize" | "headingSpacing" | "paragraphSpacing" | "lineSpacing">(
  key: K,
  [min, max]: readonly [number, number],
  message: string,
): FieldRule<StyleInput, K> {
  return {
    key,
    message,
    invalid: (value) => value < min || value > max,
    context: scopedContext(key, "styleContext"),
  };
}

function isTableTwips(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TABLE_TWIPS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Style checks in the order they run; the first failure is reported. */
const STYLE_RULES: readonly AnyFieldRule<StyleInput>[] = [
  rangeRule("titleSize", [8, 72], "Invalid title size: Must be between 8 and 72 points"),
  rangeRule("headingSpacing", [0, 720], "Invalid heading spacing: Must be between 0 and 720 twips"),
  rangeRule("paragraphSpacing", [0, 720], "Invalid paragraph spacing: Must be between 0 and 720 twips"),
  rangeRule("lineSpacing", [1, 3], "Invalid line spacing: Must be between 1 and 3"),
  {
    key: "fontFamily",
    message: "Invalid fontFamily: Must be a non-empty string",
    invalid: isBlankOrNotString,
    context: scopedContext("fontFamily", "styleContext"),
  },
  {
    key: "language",
    message: "Invalid style language: Must be a BCP 47-style language tag",
    // The OOXML text check throws its own, more specific errors first.
    invalid: (value, scope) => {
      validateOoxmlText(value, `${scope}.language`, MAX_METADATA_LANGUAGE_LENGTH);
      return !LANGUAGE_TAG.test(value);
    },
    context: scopedContext("language", "styleContext"),
  },
  {
    key: "tableColumnWidths",
    message: "Invalid tableColumnWidths",
    invalid: (value) =>
      !Array.isArray(value) ||
      !value.length ||
      value.some((width) => !Number.isInteger(width) || width < 1 || width > MAX_TABLE_TWIPS),
  },
  {
    key: "tableAllowRowSplit",
    message: "Invalid tableAllowRowSplit",
    invalid: isNotBoolean,
  },
  hexColorRule("tableHeaderBackground"),
  {
    key: "tableCellMargins",
    message: "Invalid tableCellMargins",
    // Read as unknown: JSON can pass null, which has no margins to check.
    invalid: (value: unknown) => !Object.values(value ?? {}).every(isTableTwips),
  },
  hexColorRule("inlineCodeColor"),
  hexColorRule("inlineCodeBackground"),
  {
    key: "calloutStyles",
    message: "Invalid calloutStyles: Must be an object",
    // Read as unknown: styles may come from untyped JS or CLI JSON.
    invalid: (value: unknown) => !isRecord(value),
    context: scopedContext("calloutStyles", "styleContext"),
  },
];

function validateCalloutStyle(
  calloutType: string,
  calloutStyle: CalloutStyle,
  styleContext: string,
): void {
  if (!CALLOUT_TYPES.includes(calloutType)) {
    throw new MarkdownConversionError(`Invalid calloutStyles key: ${calloutType}`, {
      styleContext,
      calloutType,
    });
  }
  // Read as unknown: the entry may be anything in untyped input.
  const calloutStyleValue: unknown = calloutStyle;
  if (!isRecord(calloutStyleValue)) {
    throw new MarkdownConversionError(`Invalid calloutStyles.${calloutType}: Must be an object`, {
      styleContext,
      calloutStyle,
    });
  }
  for (const field of CALLOUT_COLOR_FIELDS) {
    validateHexColor(
      calloutStyle[field],
      `calloutStyles.${calloutType}.${field}`,
      styleContext,
    );
  }
}

/**
 * Validates a style object, or a section's style override.
 * @param styleContext - Where the style came from, such as `options.style`.
 */
export function validateStyleInput(
  style: StyleInput | undefined,
  styleContext: string,
): void {
  if (!style) {
    return;
  }

  checkFields(style, STYLE_RULES, styleContext);

  // The last rule proved calloutStyles is an object when present.
  if (style.calloutStyles === undefined) {
    return;
  }
  for (const [calloutType, calloutStyle] of Object.entries(style.calloutStyles)) {
    validateCalloutStyle(calloutType, calloutStyle, styleContext);
  }
}
