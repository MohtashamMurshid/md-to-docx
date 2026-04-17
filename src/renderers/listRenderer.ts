import { Paragraph, TextRun } from "docx";
import { Style, ListItemConfig } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import { processFormattedText } from "./textRenderer.js";

/**
 * Processes a list item and returns appropriate paragraph formatting
 * @param config - The list item configuration
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processListItem(
  config: ListItemConfig,
  style: Style
): Paragraph {
  const textContent = config.text;
  const fontFamily = resolveFontFamily(style);

  const listLevel = config.level ?? 0;

  const children = processFormattedText(textContent, style);

  if (config.boldText) {
    children.push(
      new TextRun({
        text: "\n",
        size: style.listItemSize || 24,
        font: fontFamily,
      }),
      new TextRun({
        text: config.boldText,
        bold: true,
        color: "000000",
        size: style.listItemSize || 24,
        font: fontFamily,
      })
    );
  }

  if (config.isNumbered) {
    const numberingReference = `numbered-list-${config.sequenceId || 1}`;
    return new Paragraph({
      children,
      numbering: {
        reference: numberingReference,
        level: listLevel,
      },
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    });
  }

  return new Paragraph({
    children,
    bullet: {
      level: listLevel,
    },
    spacing: {
      before: style.paragraphSpacing / 2,
      after: style.paragraphSpacing / 2,
    },
    bidirectional: style.direction === "RTL",
  });
}
