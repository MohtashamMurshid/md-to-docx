import { Paragraph, TextRun, AlignmentType, BorderStyle } from "docx";
import { CodeHighlightOptions, Style } from "../types.js";
import { resolveTheme, tokenizeToRuns } from "../utils/codeHighlight.js";

/**
 * Processes a code block and returns appropriate paragraph formatting
 * @param code - The code block text
 * @param language - The programming language (optional)
 * @param style - The style configuration
 * @param codeHighlighting - Optional highlighting configuration
 * @returns The processed paragraph
 */
export function processCodeBlock(
  code: string,
  language: string | undefined,
  style: Style,
  codeHighlighting?: CodeHighlightOptions
): Paragraph {
  const highlightingEnabled = codeHighlighting?.enabled === true;
  const resolvedTheme = highlightingEnabled
    ? resolveTheme(codeHighlighting?.theme)
    : undefined;

  const codeRuns: TextRun[] = [];
  const showLanguageLabel =
    codeHighlighting?.showLanguageLabel !== false;

  if (language && showLanguageLabel) {
    codeRuns.push(
      new TextRun({
        text: language,
        font: "Courier New",
        size: style.codeBlockSize || 18,
        color: resolvedTheme?.languageLabel || "666666",
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

  let highlightedRuns: TextRun[] | null = null;
  if (highlightingEnabled && language) {
    highlightedRuns = tokenizeToRuns(
      code,
      language,
      style,
      codeHighlighting!
    );
  }

  if (highlightedRuns && highlightedRuns.length > 0) {
    codeRuns.push(...highlightedRuns);
  } else {
    const lines = code.split("\n");
    lines.forEach((line, index) => {
      const leadingSpaces = line.match(/^\s*/)?.[0].length || 0;
      const leadingNbsp = "\u00A0".repeat(leadingSpaces);
      const processedLine = leadingNbsp + line.slice(leadingSpaces);

      codeRuns.push(
        new TextRun({
          text: processedLine,
          font: "Courier New",
          size: style.codeBlockSize || 20,
          color: resolvedTheme?.default || "444444",
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
  }

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

  const backgroundFill = resolvedTheme?.background || "F5F5F5";
  const borderColor = resolvedTheme?.border || "DDDDDD";

  return new Paragraph({
    children: codeRuns,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
      line: 360,
      lineRule: "exact",
    },
    shading: {
      fill: backgroundFill,
    },
    border: {
      top: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
      left: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
      right: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
    },
    indent: {
      left: 360,
    },
    alignment,
  });
}
