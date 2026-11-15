import type { IParagraphOptions, Paragraph } from "docx";
import type { DocxBlockNode } from "../docxModel.js";
import type { MermaidRenderResult } from "../types.js";
import { processCodeBlock } from "../renderers/codeRenderer.js";
import { throwIfAborted } from "../processingLimits.js";
import { MarkdownConversionError } from "../errors.js";
import { assertImageAltPolicy, validateImageText } from "../accessibility.js";
import type { ListMarkerContext, RenderContext, RenderEnv } from "./context.js";
import { imageBudgetReached } from "./imageBudget.js";
import {
  embedImageData,
  imageParagraphOptions,
  noticeParagraph,
} from "./images.js";
import { listParagraph, taskMarkerChildren } from "./lists.js";

/** A Mermaid block and where its image or fallback goes. */
interface MermaidTarget {
  node: Extract<DocxBlockNode, { type: "mermaidBlock" }>;
  context: RenderContext;
  marker: ListMarkerContext | undefined;
  paragraphOptions: Partial<IParagraphOptions>;
}

/** Follows `mermaidRendering.failureMode`: throw, a placeholder, or the source as a code block. */
function mermaidFallback(
  env: RenderEnv,
  target: MermaidTarget,
  reason?: unknown,
): Paragraph[] {
  const { options, style } = env;
  const failureMode = options.mermaidRendering?.failureMode ?? "codeBlock";
  if (failureMode === "throw") {
    throw new MarkdownConversionError(
      `Failed to render Mermaid diagram${
        reason instanceof Error ? `: ${reason.message}` : ""
      }`,
      { language: "mermaid", originalError: reason },
    );
  }

  options.onWarning?.({
    code: "DIAGRAM_FALLBACK",
    message: "Mermaid rendering failed or is unavailable",
    source: target.node.value,
  });

  if (failureMode === "placeholder") {
    return [
      noticeParagraph(env, {
        text: "[Mermaid diagram could not be rendered]",
        paragraphOptions: target.paragraphOptions,
        withFont: true,
      }),
    ];
  }

  const codeBlock = processCodeBlock(
    target.node.value,
    "mermaid",
    style,
    options.codeHighlighting,
  );
  env.mermaidFallbackCodeParagraphs.add(codeBlock);
  if (!target.marker) {
    return [codeBlock];
  }
  const bareMarker = { ...target.marker, taskChecked: undefined };
  return [listParagraph(env, [], bareMarker, target.context), codeBlock];
}

function embedMermaidImage(
  env: RenderEnv,
  target: MermaidTarget,
  result: MermaidRenderResult,
): Paragraph[] {
  const altText = result.altText ?? "";
  validateImageText(altText, result.title, "Mermaid image");
  assertImageAltPolicy(
    altText,
    env.options.accessibility,
    "Mermaid renderer result",
  );
  return embedImageData(env, {
    altText: altText || "Mermaid diagram",
    title: result.title,
    data: result.data,
    contentType: result.contentType,
    source: result.source || "Mermaid diagram",
    widthHint: result.width,
    heightHint: result.height,
    paragraphOptions: target.paragraphOptions,
    prefixChildren: taskMarkerChildren(env, target.marker),
  });
}

export async function renderMermaidNode(
  env: RenderEnv,
  node: MermaidTarget["node"],
  context: RenderContext = {},
  marker?: ListMarkerContext,
): Promise<Paragraph[]> {
  const { signal } = env.options;
  throwIfAborted(signal);

  const target: MermaidTarget = {
    node,
    context,
    marker,
    paragraphOptions: imageParagraphOptions(env, context, marker),
  };
  const render = env.options.mermaidRendering?.render;
  if (!render) {
    return mermaidFallback(env, target);
  }
  if (imageBudgetReached(env)) {
    return mermaidFallback(
      env,
      target,
      new Error("Maximum embedded image count reached"),
    );
  }

  try {
    const result = await render({ code: node.value, meta: node.meta, signal });
    throwIfAborted(signal);
    if (!result) {
      return mermaidFallback(
        env,
        target,
        new Error("Mermaid renderer returned no image"),
      );
    }
    return embedMermaidImage(env, target, result);
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    return mermaidFallback(env, target, error);
  }
}
