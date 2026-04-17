import { Paragraph, TextRun, AlignmentType, BorderStyle } from "docx";
import { Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";

/**
 * Processes a blockquote and returns appropriate paragraph formatting
 * @param text - The blockquote text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processBlockquote(text: string, style: Style): Paragraph {
  const fontFamily = resolveFontFamily(style);

  let alignment = undefined;
  if (style.blockquoteAlignment) {
    switch (style.blockquoteAlignment) {
      case "LEFT":
        alignment = AlignmentType.LEFT;
        break;
      case "CENTER":
        alignment = AlignmentType.CENTER;
        break;
      case "RIGHT":
        alignment = AlignmentType.RIGHT;
        break;
      case "JUSTIFIED":
        alignment = AlignmentType.JUSTIFIED;
        break;
      default:
        alignment = undefined;
    }
  }

  return new Paragraph({
    children: [
      new TextRun({
        text: text,
        italics: true,
        color: "000000",
        size: style.blockquoteSize || 24,
        font: fontFamily,
        rightToLeft: style.direction === "RTL",
      }),
    ],
    indent: {
      left: 720,
    },
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
    },
    border: {
      left: {
        style: BorderStyle.SINGLE,
        size: 3,
        color: "AAAAAA",
      },
    },
    alignment: alignment,
    bidirectional: style.direction === "RTL",
  });
}
