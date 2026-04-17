import { Style } from "../types.js";

/**
 * Resolve the font family for a given style, falling back to the
 * deprecated `fontFamilly` typo alias for backwards compatibility.
 */
export function resolveFontFamily(style?: Style): string | undefined {
  return style?.fontFamily || style?.fontFamilly;
}
