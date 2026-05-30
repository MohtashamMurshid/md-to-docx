import {
  Paragraph,
  TextRun,
  ExternalHyperlink,
  AlignmentType,
  BorderStyle,
} from "docx";
import { Style } from "../types.js";
import type { DocxBlockNode, DocxTextNode } from "../docxModel.js";

const BLOCKQUOTE_ALIGNMENTS: Record<
  NonNullable<Style["blockquoteAlignment"]>,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  LEFT: AlignmentType.LEFT,
  CENTER: AlignmentType.CENTER,
  RIGHT: AlignmentType.RIGHT,
  JUSTIFIED: AlignmentType.JUSTIFIED,
};

/**
 * Builds a blockquote paragraph from its structured children, preserving
 * inline formatting, links, and code via the caller-supplied renderer
 * (which also applies the blockquote's italic + size styling). Multiple
 * child paragraphs are separated by a line break.
 *
 * @param children - The blockquote's block children (paragraphs)
 * @param style - The style configuration
 * @param renderInline - Renders inline nodes with blockquote run styling
 * @returns The processed paragraph
 */
export function processBlockquote(
  children: DocxBlockNode[],
  style: Style,
  renderInline: (nodes: DocxTextNode[]) => (TextRun | ExternalHyperlink)[]
): Paragraph {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const paragraphs = children.filter(
    (child): child is Extract<DocxBlockNode, { type: "paragraph" }> =>
      child.type === "paragraph"
  );

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      runs.push(new TextRun({ break: 1, rightToLeft: style.direction === "RTL" }));
    }
    runs.push(...renderInline(paragraph.children));
  });

  if (runs.length === 0) {
    runs.push(new TextRun({ text: "", italics: true }));
  }

  const alignment = style.blockquoteAlignment
    ? BLOCKQUOTE_ALIGNMENTS[style.blockquoteAlignment]
    : undefined;

  return new Paragraph({
    children: runs,
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
    alignment,
    bidirectional: style.direction === "RTL",
  });
}
