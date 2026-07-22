import { MarkdownConversionError } from "./errors.js";
import type { AccessibilityOptions, Style } from "./types.js";

export const MAX_IMAGE_ALT_TEXT_LENGTH = 2_048;
export const MAX_IMAGE_TITLE_LENGTH = 512;

const INVALID_XML_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function validateOoxmlText(
  value: unknown,
  context: string,
  maxLength: number,
  options: { allowEmpty?: boolean } = {},
): asserts value is string {
  if (typeof value !== "string") {
    throw new MarkdownConversionError(`${context} must be a string`, {
      context,
      valueType: typeof value,
    });
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new MarkdownConversionError(`${context} must not be empty`, { context });
  }
  if (value.length > maxLength) {
    throw new MarkdownConversionError(
      `${context} exceeds the maximum length of ${maxLength} characters`,
      { context, length: value.length, maxLength },
    );
  }
  if (INVALID_XML_CONTROL.test(value) || hasUnpairedSurrogate(value)) {
    throw new MarkdownConversionError(
      `${context} contains characters that are not valid in OOXML`,
      { context },
    );
  }
}

export function validateImageText(
  altText: unknown,
  title: unknown,
  context: string,
): void {
  validateOoxmlText(altText, `${context} alt text`, MAX_IMAGE_ALT_TEXT_LENGTH, {
    allowEmpty: true,
  });
  if (title !== undefined && title !== null) {
    validateOoxmlText(title, `${context} title`, MAX_IMAGE_TITLE_LENGTH, {
      allowEmpty: true,
    });
  }
}

export function assertImageAltPolicy(
  altText: string,
  accessibility: AccessibilityOptions | undefined,
  context: string,
): void {
  if (
    accessibility?.missingImageAltText === "throw" &&
    altText.trim().length === 0
  ) {
    throw new MarkdownConversionError(
      `Missing image alt text in ${context}; strict accessibility mode requires a non-empty description`,
      { context, missingImageAltText: "throw" },
    );
  }
}

export function validateAccessibilityOptions(
  accessibility: AccessibilityOptions | undefined,
): void {
  if (!accessibility) return;
  if (
    accessibility.missingImageAltText !== undefined &&
    accessibility.missingImageAltText !== "permissive" &&
    accessibility.missingImageAltText !== "throw"
  ) {
    throw new MarkdownConversionError(
      "Invalid accessibility.missingImageAltText: must be permissive or throw",
      { missingImageAltText: accessibility.missingImageAltText },
    );
  }
}

export function drawingAltText(
  altText: string,
  title: string | undefined,
  fallbackName: string,
): { name: string; description?: string; title?: string } {
  return {
    name: title || altText || fallbackName,
    ...(altText ? { description: altText } : {}),
    ...(title ? { title } : {}),
  };
}

export function runLanguage(style: Style):
  | { value: string; eastAsia?: string; bidirectional?: string }
  | undefined {
  const language = style.language;
  if (!language) return undefined;
  const primary = language.split("-")[0].toLowerCase();
  return {
    value: language,
    ...(primary === "zh" || primary === "ja" || primary === "ko"
      ? { eastAsia: language }
      : {}),
    ...(style.direction === "RTL" ? { bidirectional: language } : {}),
  };
}
