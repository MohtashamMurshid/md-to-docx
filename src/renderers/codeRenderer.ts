import { Paragraph, TextRun, AlignmentType, BorderStyle } from "docx";
import { Style } from "../types.js";

/**
 * Processes a code block and returns appropriate paragraph formatting
 * @param code - The code block text
 * @param language - The programming language (optional)
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processCodeBlock(
  code: string,
  language: string | undefined,
  style: Style
): Paragraph {
  const lines = code.split("\n");
  const codeRuns: TextRun[] = [];

  if (language) {
    codeRuns.push(
      new TextRun({
        text: language,
        font: "Courier New",
        size: style.codeBlockSize || 18,
        color: "666666",
        bold: true,
        rightToLeft: style.direction === "RTL",
      }),
      new TextRun({
        text: "\n",
        font: "Courier New",
        size: style.codeBlockSize || 18,
        break: 1,
        rightToLeft: style.direction === "RTL",
      })
    );
  }

  lines.forEach((line, index) => {
    const leadingSpaces = line.match(/^\s*/)?.[0].length || 0;
    const leadingNbsp = "\u00A0".repeat(leadingSpaces);
    const processedLine = leadingNbsp + line.slice(leadingSpaces);

    codeRuns.push(
      new TextRun({
        text: processedLine,
        font: "Courier New",
        size: style.codeBlockSize || 20,
        color: "444444",
        rightToLeft: style.direction === "RTL",
      })
    );

    if (index < lines.length - 1) {
      codeRuns.push(
        new TextRun({
          text: "\n",
          font: "Courier New",
          size: style.codeBlockSize || 20,
          break: 1,
          rightToLeft: style.direction === "RTL",
        })
      );
    }
  });

  const alignment = (() => {
    switch (style.codeBlockAlignment) {
      case "CENTER":
        return AlignmentType.CENTER;
      case "RIGHT":
        return AlignmentType.RIGHT;
      case "JUSTIFIED":
        return AlignmentType.JUSTIFIED;
      case "LEFT":
      default:
        return AlignmentType.LEFT;
    }
  })();

  return new Paragraph({
    children: codeRuns,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
      line: 360,
      lineRule: "exact",
    },
    shading: {
      fill: "F5F5F5",
    },
    border: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
    },
    indent: {
      left: 360,
    },
    alignment,
  });
}
