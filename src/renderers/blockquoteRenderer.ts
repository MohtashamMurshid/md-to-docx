import { AlignmentType, BorderStyle } from "docx";
import { Style } from "../types.js";

const BLOCKQUOTE_ALIGNMENTS: Record<
  NonNullable<Style["blockquoteAlignment"]>,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  LEFT: AlignmentType.LEFT,
  CENTER: AlignmentType.CENTER,
  RIGHT: AlignmentType.RIGHT,
  JUSTIFIED: AlignmentType.JUSTIFIED,
};

export interface BlockquoteParagraphStyle {
  indent: {
    left: number;
  };
  spacing: {
    before: number;
    after: number;
  };
  border: {
    left: {
      style: typeof BorderStyle.SINGLE;
      size: number;
      color: string;
    };
  };
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  bidirectional: boolean;
}

/**
 * Returns paragraph options shared by each rendered blockquote paragraph.
 * Nested quotes increase the left indent while preserving the same border.
 */
export function blockquoteParagraphStyle(
  style: Style,
  quoteLevel: number,
): BlockquoteParagraphStyle {
  const alignment = style.blockquoteAlignment
    ? BLOCKQUOTE_ALIGNMENTS[style.blockquoteAlignment]
    : undefined;

  return {
    indent: {
      left: 720 * Math.max(1, quoteLevel),
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
  };
}
