import {
  Paragraph,
  HeadingLevel,
  AlignmentType,
  Bookmark,
} from "docx";
import type { ParagraphChild } from "docx";
import { Style, AlignmentOption } from "../types.js";
import type { DocxInlineNode } from "../docxModel.js";

/**
 * Resolves the font size (in half-points) for a heading level, honouring
 * per-level overrides and falling back to a size that shrinks with depth.
 */
function resolveHeadingSize(level: number, style: Style): number {
  const override = style[`heading${level}Size` as keyof Style] as
    | number
    | undefined;
  if (override) {
    return override;
  }
  if (level > 1) {
    return Math.max(1, style.titleSize - (level - 1) * 4);
  }
  return style.titleSize;
}

/**
 * Resolves the paragraph alignment for a heading level, preferring a
 * level-specific alignment and falling back to the shared headingAlignment.
 */
function resolveHeadingAlignment(
  level: number,
  style: Style
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const levelAlignment = style[`heading${level}Alignment` as keyof Style] as
    | AlignmentOption
    | undefined;
  const alignment = levelAlignment || style.headingAlignment;
  return alignment ? AlignmentType[alignment] : undefined;
}

/**
 * Builds a heading paragraph directly from the structured inline nodes.
 * Inline runs are produced by the caller-supplied `renderInline` callback
 * (the shared model renderer) so headings reuse the exact same inline
 * formatting, link, and code handling as body paragraphs.
 *
 * @param children - The heading's inline nodes
 * @param config - Heading level and the pre-computed bookmark id
 * @param style - The style configuration
 * @param renderInline - Renders inline nodes at the given font size
 * @returns The heading paragraph and its bookmark id
 */
export function processHeading(
  children: DocxInlineNode[],
  config: { level: number; bookmarkId: string },
  style: Style,
  renderInline: (
    nodes: DocxInlineNode[],
    size: number
  ) => ParagraphChild[]
): { paragraph: Paragraph; bookmarkId: string } {
  const headingLevel = config.level;
  const headingSize = resolveHeadingSize(headingLevel, style);
  const alignment = resolveHeadingAlignment(headingLevel, style);
  const runs = renderInline(children, headingSize);

  const paragraph = new Paragraph({
    children: [
      new Bookmark({
        id: config.bookmarkId,
        children: runs,
      }),
    ],
    heading:
      headingLevel as unknown as (typeof HeadingLevel)[keyof typeof HeadingLevel],
    spacing: {
      before:
        headingLevel === 1 ? style.headingSpacing * 2 : style.headingSpacing,
      after: style.headingSpacing / 2,
    },
    alignment,
    style: `Heading${headingLevel}`,
    bidirectional: style.direction === "RTL",
  });

  return { paragraph, bookmarkId: config.bookmarkId };
}
