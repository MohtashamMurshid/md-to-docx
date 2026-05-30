import { TextRun } from "docx";
import { Style } from "../types.js";

/**
 * Processes inline code and returns a TextRun object
 * @param code - The inline code text
 * @param style - The style configuration
 * @returns A TextRun object
 */
export function processInlineCode(code: string, style?: Style): TextRun {
  return new TextRun({
    text: code,
    font: "Courier New",
    size: style?.inlineCodeSize || (style?.paragraphSize ? style.paragraphSize - 2 : 20),
    color: style?.inlineCodeColor || "444444",
    shading: {
      fill: style?.inlineCodeBackground || "F5F5F5",
    },
    rightToLeft: style?.direction === "RTL",
  });
}
