import { Paragraph, TextRun } from "docx";
import { Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import { runLanguage } from "../accessibility.js";

/**
 * Processes a comment and returns appropriate paragraph formatting
 * @param text - The comment text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processComment(text: string, style: Style): Paragraph {
  const fontFamily = resolveFontFamily(style);
  return new Paragraph({
    children: [
      new TextRun({
        text: "Comment: " + text,
        italics: true,
        color: "666666",
        font: fontFamily,
        language: runLanguage(style),
        rightToLeft: style.direction === "RTL",
      }),
    ],
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
    },
    bidirectional: style.direction === "RTL",
  });
}
