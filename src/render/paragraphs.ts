import { AlignmentType, Paragraph } from "docx";
import type { IParagraphOptions, ISpacingProperties } from "docx";
import type { DocxInlineNode } from "../docxModel.js";
import type { Style } from "../types.js";
import { blockquoteParagraphStyle } from "../renderers/blockquoteRenderer.js";
import type { BlockquoteParagraphStyle } from "../renderers/blockquoteRenderer.js";
import type { InlineOverrides, RenderContext, RenderEnv } from "./context.js";
import { renderInlineNodes } from "./inline.js";

/** The blockquote style for this context, or undefined outside a blockquote. */
export function quoteStyleFor(
  style: Style,
  context: RenderContext,
): BlockquoteParagraphStyle | undefined {
  return context.quoteLevel
    ? blockquoteParagraphStyle(style, context.quoteLevel, context.calloutType)
    : undefined;
}

/**
 * Blockquote paragraph options without the unset `shading` and `alignment`
 * values, which docx's option types do not accept as `undefined`.
 */
export function quoteParagraphOptions(
  quoteStyle: BlockquoteParagraphStyle | undefined,
): Partial<IParagraphOptions> {
  if (!quoteStyle) {
    return {};
  }
  const { shading, alignment, ...rest } = quoteStyle;
  return {
    ...rest,
    ...(shading !== undefined ? { shading } : {}),
    ...(alignment !== undefined ? { alignment } : {}),
  };
}

/** The style's body paragraph alignment, left by default. */
export function bodyAlignment(
  style: Style,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return style.paragraphAlignment
    ? AlignmentType[style.paragraphAlignment]
    : AlignmentType.LEFT;
}

/** Spacing for a body paragraph. */
export function bodySpacing(style: Style): ISpacingProperties {
  return {
    before: style.paragraphSpacing,
    after: style.paragraphSpacing,
    line: style.lineSpacing * 240,
  };
}

export function paragraphFromInlineNodes(
  env: RenderEnv,
  nodes: DocxInlineNode[],
  context: RenderContext = {},
  overrides: InlineOverrides = {},
): Paragraph {
  const { style } = env;
  const quoteStyle = quoteStyleFor(style, context);
  return new Paragraph({
    children: renderInlineNodes(env, nodes, overrides),
    spacing: bodySpacing(style),
    // A blockquote's alignment replaces this one, even when it is unset.
    ...(quoteStyle ? {} : { alignment: bodyAlignment(style) }),
    ...(style.paragraphAlignment === "JUSTIFIED"
      ? { indent: { left: 0, right: 0 } }
      : {}),
    bidirectional: style.direction === "RTL",
    ...quoteParagraphOptions(quoteStyle),
  });
}
