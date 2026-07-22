import { BorderStyle, Paragraph } from "docx";
import type { IParagraphOptions } from "docx";
import type { Style } from "../types.js";

/**
 * Renders a Markdown thematic break as a paragraph bottom border. Paragraph
 * borders are native Word markup, resize with the page, and require no fonts
 * or drawing relationships.
 */
export function processHorizontalRule(
  style: Style,
  paragraphOptions: Partial<IParagraphOptions> = {},
): Paragraph {
  const { border, spacing, ...rest } = paragraphOptions;

  return new Paragraph({
    ...rest,
    children: [],
    spacing: spacing ?? {
      before: style.paragraphSpacing / 2,
      after: style.paragraphSpacing / 2,
    },
    border: {
      ...border,
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: "A6A6A6",
        space: 1,
      },
    },
  });
}
