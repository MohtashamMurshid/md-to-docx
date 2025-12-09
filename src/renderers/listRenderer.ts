import { Paragraph, TextRun } from "docx";
import { Style, ListItemConfig } from "../types.js";
import { processFormattedText } from "../parsers/textParser.js";

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
  let textContent = config.text;

  // Process the main text with formatting
  const children = processFormattedText(textContent, style);

  // If there's bold text on the next line, add it with a line break
  if (config.boldText) {
    children.push(
      new TextRun({
        text: "\n",
        size: style.listItemSize || 24,
      }),
      new TextRun({
        text: config.boldText,
        bold: true,
        color: "000000",
        size: style.listItemSize || 24,
      })
    );
  }

  // Use different formatting for numbered vs bullet lists
  if (config.isNumbered) {
    // Use numbering for numbered lists with unique reference per sequence
    const numberingReference = `numbered-list-${config.sequenceId || 1}`;
    return new Paragraph({
      children,
      numbering: {
        reference: numberingReference,
        level: config.level ?? 0,
      },
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    });
  } else {
    // Use bullet formatting for bullet lists
    return new Paragraph({
      children,
      bullet: {
        level: config.level ?? 0,
      },
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    });
  }
}