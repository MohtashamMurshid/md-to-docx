import {
  Bookmark,
  EndnoteReferenceRun,
  FootnoteReferenceRun,
  SimpleField,
  TextRun,
} from "docx";
import type { ParagraphChild } from "docx";
import type {
  DocxCaption,
  DocxCrossReferenceNode,
  DocxFootnoteReferenceNode,
  DocxInlineNode,
} from "../docxModel.js";
import { parseTexMath, renderNativeMath } from "../renderers/mathRenderer.js";
import { MarkdownConversionError } from "../errors.js";
import type { InlineOverrides, RenderEnv } from "./context.js";
import { htmlRuns } from "./html.js";
import { renderTextNode } from "./links.js";
import { textRunFromNode } from "./runs.js";

type InlineRenderer<T extends DocxInlineNode> = (
  env: RenderEnv,
  node: T,
  overrides: InlineOverrides,
) => ParagraphChild | readonly ParagraphChild[];

/** "Figure" or "Table", or the label the caption options set. */
export function captionLabel(
  env: RenderEnv,
  kind: DocxCaption["kind"],
): string {
  return kind === "figure"
    ? (env.options.captions?.figureLabel ?? "Figure")
    : (env.options.captions?.tableLabel ?? "Table");
}

/** Native Word math, or the TeX source as text when the parser cannot handle it. */
export function renderMathNode(
  env: RenderEnv,
  value: string,
  block: boolean,
): ParagraphChild {
  const parsed = parseTexMath(value);
  if (parsed.supported) {
    return renderNativeMath(parsed.children);
  }

  if (env.options.mathRendering?.unsupported === "throw") {
    throw new MarkdownConversionError("Unsupported math expression", {
      expression: value,
      reason: parsed.reason,
    });
  }

  env.options.onWarning?.({
    code: "UNSUPPORTED_MATH",
    message: parsed.reason,
    source: value,
  });
  return textRunFromNode(env, {
    type: "text",
    value: block ? `$$\n${value}\n$$` : `$${value}$`,
  });
}

function crossReferenceField(
  env: RenderEnv,
  node: DocxCrossReferenceNode,
): SimpleField {
  return new SimpleField(
    ` REF ${node.bookmarkId} \\h `,
    `${captionLabel(env, node.kind)} ${node.number}`,
  );
}

/**
 * A native footnote or endnote reference, as `footnotes.placement` says;
 * repeats point back at the first with a NOTEREF field, which cites either.
 */
function footnoteReference(
  env: RenderEnv,
  node: DocxFootnoteReferenceNode,
): ParagraphChild {
  const adjustedId = node.id + env.footnoteIdOffset;
  const bookmarkId = `mdfootnote_${adjustedId}`;
  if (node.isRepeatedReference) {
    return new SimpleField(
      ` NOTEREF ${bookmarkId} \\h \\f `,
      String(adjustedId),
    );
  }
  return new Bookmark({
    id: bookmarkId,
    children: [
      env.options.footnotes?.placement === "endnotes"
        ? new EndnoteReferenceRun(adjustedId)
        : new FootnoteReferenceRun(adjustedId),
    ],
  });
}

const INLINE_RENDERERS: {
  [K in DocxInlineNode["type"]]: InlineRenderer<
    Extract<DocxInlineNode, { type: K }>
  >;
} = {
  text: renderTextNode,
  // Images were fetched by prepareInlineImages before the paragraph rendered.
  inlineImage: (env, node) =>
    env.inlineImages.get(node) ?? new TextRun(`[Image: ${node.alt}]`),
  crossReference: crossReferenceField,
  footnoteReference,
  mathInline: (env, node) => renderMathNode(env, node.value, false),
  // Inline HTML was prepared by prepareInlineImages; malformed HTML renders as before.
  htmlInline: (env, node, overrides) => {
    const prepared = env.inlineHtml.get(node);
    return prepared
      ? htmlRuns(env, prepared, node, overrides)
      : node.fallback.flatMap((child) =>
          renderInlineNode(env, child, overrides),
        );
  },
};

function renderInlineNode(
  env: RenderEnv,
  node: DocxInlineNode,
  overrides: InlineOverrides,
): ParagraphChild | readonly ParagraphChild[] {
  // The table is keyed by node type, so each entry receives its own kind of node.
  const render = INLINE_RENDERERS[node.type] as InlineRenderer<DocxInlineNode>;
  return render(env, node, overrides);
}

/** Paragraph children for inline nodes; an empty list yields one empty run. */
export function renderInlineNodes(
  env: RenderEnv,
  nodes: DocxInlineNode[],
  overrides: InlineOverrides = {},
): ParagraphChild[] {
  const out = nodes.flatMap((node) => renderInlineNode(env, node, overrides));
  if (out.length === 0) {
    out.push(textRunFromNode(env, { type: "text", value: "" }, overrides));
  }
  return out;
}

/** The visible text of inline nodes, for heading bookmarks and table fallbacks. */
export function textFromInlineNodes(
  env: RenderEnv,
  nodes: DocxInlineNode[],
): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }
      if (node.type === "crossReference") {
        return `${captionLabel(env, node.kind)} ${node.number}`;
      }
      if (node.type === "htmlInline") {
        return node.text;
      }
      return "";
    })
    .join("");
}
