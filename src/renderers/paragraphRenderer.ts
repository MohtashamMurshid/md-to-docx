import { Paragraph, AlignmentType } from "docx";
import { Style } from "../types.js";
import { processFormattedText } from "./textRenderer.js";

/**
 * Processes a paragraph and returns appropriate paragraph formatting
 * @param text - The paragraph text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processParagraph(text: string, style: Style): Paragraph {
  const textRuns = processFormattedText(text, style);

  const alignment = style.paragraphAlignment
    ? style.paragraphAlignment === "CENTER"
      ? AlignmentType.CENTER
      : style.paragraphAlignment === "RIGHT"
      ? AlignmentType.RIGHT
      : style.paragraphAlignment === "JUSTIFIED"
      ? AlignmentType.JUSTIFIED
      : AlignmentType.LEFT
    : AlignmentType.LEFT;

  const indent =
    style.paragraphAlignment === "JUSTIFIED"
      ? { left: 0, right: 0 }
      : undefined;

  return new Paragraph({
    children: textRuns,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
      line: style.lineSpacing * 240,
    },
    alignment,
    indent,
    bidirectional: style.direction === "RTL",
  });
}
