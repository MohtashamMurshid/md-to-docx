import { AlignmentType, Bookmark, Paragraph, SimpleField } from "docx";
import type { DocxBlockNode, DocxCaption } from "../docxModel.js";
import type { Block, InlineOverrides, RenderEnv } from "./context.js";
import { captionLabel, renderInlineNodes } from "./inline.js";
import { textRunFromNode } from "./runs.js";

/** "Figure 2: …", with a SEQ field for the number and a bookmark cross-references point at. */
function captionParagraph(env: RenderEnv, caption: DocxCaption): Paragraph {
  const { style, options } = env;
  const label = captionLabel(env, caption.kind);
  const sequenceName =
    caption.kind === "figure" ? "MdToDocxFigure" : "MdToDocxTable";
  const runOverrides: InlineOverrides = {
    forceItalic: options.captions?.italic ?? false,
    size: options.captions?.size ?? style.paragraphSize ?? 24,
  };
  const alignment = options.captions?.alignment
    ? AlignmentType[options.captions.alignment]
    : AlignmentType.CENTER;
  const bookmark = new Bookmark({
    id: caption.bookmarkId,
    children: [
      textRunFromNode(env, { type: "text", value: `${label} ` }, runOverrides),
      new SimpleField(
        ` SEQ ${sequenceName} \\* ARABIC `,
        String(caption.number),
      ),
    ],
  });

  return new Paragraph({
    style: "Caption",
    children: [
      bookmark,
      textRunFromNode(env, { type: "text", value: ": " }, runOverrides),
      ...renderInlineNodes(env, caption.children, runOverrides),
    ],
    alignment,
    spacing: {
      before: style.paragraphSpacing / 2,
      after: style.paragraphSpacing,
      line: style.lineSpacing * 240,
    },
    bidirectional: style.direction === "RTL",
  });
}

/** Places the node's caption above or below its rendered blocks, as the caption options say. */
export function withCaption(
  env: RenderEnv,
  node: Extract<DocxBlockNode, { type: "image" | "table" }>,
  rendered: Block[],
): Block[] {
  if (!node.caption) {
    return rendered;
  }

  const captions = env.options.captions;
  const placement =
    node.type === "image"
      ? (captions?.figurePlacement ?? "below")
      : (captions?.tablePlacement ?? "below");
  const caption = captionParagraph(env, node.caption);
  return placement === "above"
    ? [caption, ...rendered]
    : [...rendered, caption];
}
