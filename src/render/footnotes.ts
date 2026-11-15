import { Paragraph } from "docx";
import type { DocxBlockNode, DocxDocumentModel } from "../docxModel.js";
import type { RenderEnv } from "./context.js";
import { paragraphFromInlineNodes } from "./paragraphs.js";
import { tableFootnoteFallbackParagraphs } from "./tables.js";

type Footnotes = Record<string, { children: Paragraph[] }>;

/** A footnote block as paragraphs; footnotes cannot hold tables. */
async function renderFootnoteBlock(
  env: RenderEnv,
  node: DocxBlockNode,
): Promise<Paragraph[]> {
  if (node.type === "table") {
    return tableFootnoteFallbackParagraphs(env, node);
  }

  const rendered = await env.blocks.render(env, node, {
    listLevel: 0,
    context: { inFootnote: true },
  });
  return rendered.map((child) =>
    child instanceof Paragraph
      ? child
      : paragraphFromInlineNodes(env, [
          {
            type: "text",
            value: "[Unsupported footnote content omitted]",
            italic: true,
          },
        ]),
  );
}

/** The model's footnotes, keyed by their document-wide ID. */
export async function renderFootnotes(
  env: RenderEnv,
  model: DocxDocumentModel,
): Promise<Footnotes> {
  const footnotes: Footnotes = {};
  for (const footnote of model.footnotes ?? []) {
    const children: Paragraph[] = [];
    for (const child of footnote.children) {
      children.push(...(await renderFootnoteBlock(env, child)));
    }
    footnotes[String(footnote.id + env.footnoteIdOffset)] = {
      children:
        children.length > 0 ? children : [paragraphFromInlineNodes(env, [])],
    };
  }
  return footnotes;
}
