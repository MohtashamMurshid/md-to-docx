import { TextRun } from "docx";
import type { IRunOptions } from "docx";
import type { DocxTextNode } from "../docxModel.js";
import type { Style } from "../types.js";
import { processInlineCode } from "../renderers/textRenderer.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import { runLanguage } from "../accessibility.js";
import type { InlineOverrides, RenderEnv } from "./context.js";

/** The style's run font, omitted when the style sets none. */
export function fontOption(style: Style): Pick<IRunOptions, "font"> {
  const font = resolveFontFamily(style);
  return font !== undefined ? { font } : {};
}

/** The style's run language, omitted when the style sets none. */
export function languageOption(style: Style): Pick<IRunOptions, "language"> {
  const language = runLanguage(style);
  return language ? { language } : {};
}

/** Bold, italic, and strike run options for a text node, omitting unset ones. */
export function emphasisOptions(
  node: DocxTextNode,
  overrides: InlineOverrides,
): Pick<IRunOptions, "bold" | "italics" | "strike"> {
  const bold = overrides.forceBold || node.bold;
  const italics = overrides.forceItalic || node.italic;
  return {
    ...(bold !== undefined ? { bold } : {}),
    ...(italics !== undefined ? { italics } : {}),
    ...(node.strikethrough !== undefined ? { strike: node.strikethrough } : {}),
  };
}

/** Body text size in half-points: the override, else the style's paragraph size. */
export function runSize(style: Style, overrides: InlineOverrides): number {
  return overrides.size || style.paragraphSize || 24;
}

export function textRunFromNode(
  env: RenderEnv,
  node: DocxTextNode,
  overrides: InlineOverrides = {},
): TextRun {
  const { style } = env;
  if (node.code) {
    return processInlineCode(
      node.value,
      style,
      overrides.size !== undefined ? { size: overrides.size } : {},
    );
  }

  return new TextRun({
    text: node.value,
    ...emphasisOptions(node, overrides),
    ...(node.underline ? { underline: { type: "single" } } : {}),
    color: overrides.color || (node.link ? "0000FF" : "000000"),
    size: runSize(style, overrides),
    ...fontOption(style),
    rightToLeft: style.direction === "RTL",
    ...languageOption(style),
  });
}
