import { AlignmentType, BorderStyle } from "docx";
import { CalloutType, Style } from "../types.js";

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
  shading?: {
    fill: string;
  };
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  bidirectional: boolean;
}

interface ResolvedCalloutStyle {
  label: string;
  borderColor: string;
  backgroundColor: string;
  titleColor: string;
}

const DEFAULT_CALLOUT_STYLES: Record<CalloutType, ResolvedCalloutStyle> = {
  note: {
    label: "Note",
    borderColor: "0969DA",
    backgroundColor: "EFF6FF",
    titleColor: "0969DA",
  },
  tip: {
    label: "Tip",
    borderColor: "1A7F37",
    backgroundColor: "F0FFF4",
    titleColor: "1A7F37",
  },
  important: {
    label: "Important",
    borderColor: "8250DF",
    backgroundColor: "F6F0FF",
    titleColor: "8250DF",
  },
  warning: {
    label: "Warning",
    borderColor: "BF8700",
    backgroundColor: "FFF8C5",
    titleColor: "9A6700",
  },
  caution: {
    label: "Caution",
    borderColor: "CF222E",
    backgroundColor: "FFF1F1",
    titleColor: "CF222E",
  },
};

export function resolveCalloutStyle(
  style: Style,
  calloutType: CalloutType,
): ResolvedCalloutStyle {
  return {
    ...DEFAULT_CALLOUT_STYLES[calloutType],
    ...style.calloutStyles?.[calloutType],
  };
}

/**
 * Returns paragraph options shared by each rendered blockquote paragraph.
 * Nested quotes increase the left indent while preserving the same border.
 */
export function blockquoteParagraphStyle(
  style: Style,
  quoteLevel: number,
  calloutType?: CalloutType,
): BlockquoteParagraphStyle {
  const alignment = style.blockquoteAlignment
    ? BLOCKQUOTE_ALIGNMENTS[style.blockquoteAlignment]
    : undefined;
  const calloutStyle = calloutType
    ? resolveCalloutStyle(style, calloutType)
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
        color: calloutStyle?.borderColor || "AAAAAA",
      },
    },
    shading: calloutStyle
      ? {
          fill: calloutStyle.backgroundColor,
        }
      : undefined,
    alignment,
    bidirectional: style.direction === "RTL",
  };
}
