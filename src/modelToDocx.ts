import { Paragraph } from "docx";
import type { Table } from "docx";
import type { DocxBlockNode, DocxDocumentModel } from "./docxModel.js";
import type { Style, Options } from "./types.js";
import { throwIfAborted } from "./processingLimits.js";
import { BLOCK_RENDERER } from "./render/blocks.js";
import { createRenderEnv } from "./render/context.js";
import type {
  Block,
  ModelToDocxRenderOptions,
  RenderEnv,
  RenderedHeading,
} from "./render/context.js";
import { renderFootnotes } from "./render/footnotes.js";
import { finalizeLinks } from "./render/links.js";

/** Whether a top-level block rendered as a bordered code block. */
function renderedAsCode(
  env: RenderEnv,
  node: DocxBlockNode,
  rendered: Block[],
): boolean {
  switch (node.type) {
    case "codeBlock":
      return true;
    case "mermaidBlock":
      return rendered.some((child) =>
        env.mermaidFallbackCodeParagraphs.has(child),
      );
    case "pluginBlock":
      return rendered.some((child) => env.pluginCodeParagraphs.has(child));
    default:
      return false;
  }
}

async function renderBody(
  env: RenderEnv,
  model: DocxDocumentModel,
): Promise<Block[]> {
  const children: Block[] = [];
  let previousRenderedAsCode = false;
  for (const node of model.children) {
    throwIfAborted(env.options.signal);

    const rendered = await env.blocks.render(env, node);
    const currentRenderedAsCode = renderedAsCode(env, node, rendered);

    // Insert a blank spacer paragraph between back-to-back code blocks so
    // Word doesn't collapse the shared borders into a single visual block.
    if (currentRenderedAsCode && previousRenderedAsCode) {
      children.push(
        new Paragraph({ children: [], spacing: { before: 0, after: 0 } }),
      );
    }

    children.push(...rendered);
    previousRenderedAsCode = currentRenderedAsCode;
  }
  return children;
}

/**
 * Converts internal docx model to docx Paragraph/Table objects
 * Handles nested lists with proper level tracking
 */
export async function modelToDocx(
  model: DocxDocumentModel,
  style: Style,
  options: Options,
  renderOptions: ModelToDocxRenderOptions = {},
): Promise<{
  children: (Paragraph | Table)[];
  headings: RenderedHeading[];
  maxSequenceId: number;
  footnotes: Record<string, { children: Paragraph[] }>;
}> {
  const env = createRenderEnv(style, options, renderOptions, BLOCK_RENDERER);
  throwIfAborted(options.signal);

  const children = await renderBody(env, model);
  const footnotes = await renderFootnotes(env, model);
  finalizeLinks(env);
  return {
    children,
    headings: env.headings,
    maxSequenceId: env.maxSequenceId,
    footnotes,
  };
}
