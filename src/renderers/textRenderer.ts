import { TextRun } from "docx";
import { Style } from "../types.js";

/**
 * Processes inline code and returns a TextRun object.
 *
 * Size precedence: an explicit `inlineCodeSize` wins; otherwise the run
 * tracks the surrounding context size (`overrides.size`, e.g. the heading,
 * blockquote, or list-item size) so code does not render jarringly small
 * inside larger text; otherwise it falls back to a paragraph-relative default.
 * Bold/italic are intentionally never forced on code so it stays upright and
 * visually distinct as monospace.
 *
 * @param code - The inline code text
 * @param style - The style configuration
 * @param overrides - Contextual run overrides (only `size` is honored)
 * @returns A TextRun object
 */
export function processInlineCode(
  code: string,
  style?: Style,
  overrides?: { size?: number }
): TextRun {
  return new TextRun({
    text: code,
    font: "Courier New",
    size:
      style?.inlineCodeSize ||
      overrides?.size ||
      (style?.paragraphSize ? style.paragraphSize - 2 : 20),
    color: style?.inlineCodeColor || "444444",
    shading: {
      fill: style?.inlineCodeBackground || "F5F5F5",
    },
    rightToLeft: style?.direction === "RTL",
  });
}
