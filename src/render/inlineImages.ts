import { TextRun } from "docx";
import type {
  DocxHtmlInlineNode,
  DocxInlineImageNode,
  DocxInlineNode,
} from "../docxModel.js";
import { processImage } from "../renderers/imageRenderer.js";
import { assertImageAltPolicy, validateImageText } from "../accessibility.js";
import type { RenderEnv } from "./context.js";
import { prepareInlineHtml } from "./html.js";
import {
  countImageAttempt,
  imageBudgetReached,
  isRemoteImageUrl,
  remoteFailureBudgetReached,
} from "./imageBudget.js";

async function prepareInlineImage(
  env: RenderEnv,
  node: DocxInlineImageNode,
): Promise<void> {
  const { options } = env;
  validateImageText(node.alt, node.title, "Markdown image");
  assertImageAltPolicy(node.alt, options.accessibility, "Markdown image");

  if (imageBudgetReached(env)) {
    env.inlineImages.set(
      node,
      new TextRun(`[Image limit reached: ${node.alt}]`),
    );
    options.onWarning?.({
      code: "IMAGE_FALLBACK",
      message: "Image limit reached",
      source: node.url,
    });
    return;
  }

  const remote = isRemoteImageUrl(node.url);
  const notDisplayed = (): TextRun =>
    new TextRun(`[Image could not be displayed: ${node.alt}]`);
  if (remoteFailureBudgetReached(env, remote)) {
    env.inlineImages.set(node, notDisplayed());
    return;
  }

  const result = await processImage(
    {
      altText: node.alt,
      url: node.url,
      imageHandling: env.imageHandling,
      signal: options.signal,
      title: node.title,
    },
    env.style,
  );
  env.inlineImages.set(node, result.run ?? notDisplayed());
  countImageAttempt(env, result.embedded, remote);
  if (!result.embedded) {
    options.onWarning?.({
      code: "IMAGE_FALLBACK",
      message: result.reason ?? "Image could not be embedded",
      source: node.url,
    });
  }
}

/** Prepares the HTML, or, when it renders as its Markdown fallback, that fallback's images. */
async function prepareHtmlInline(
  env: RenderEnv,
  node: DocxHtmlInlineNode,
): Promise<void> {
  const prepared = await prepareInlineHtml(env, node);
  env.inlineHtml.set(node, prepared);
  if (prepared === undefined) await prepareInlineImages(env, node.fallback);
}

/**
 * Fetches the images among inline nodes, and prepares their inline HTML with
 * its images, before their paragraph renders, so the synchronous inline
 * renderer can look each one up. Each is prepared once, however often its
 * paragraph is rendered.
 */
export async function prepareInlineImages(
  env: RenderEnv,
  nodes: DocxInlineNode[],
): Promise<void> {
  for (const node of nodes) {
    if (node.type === "inlineImage" && !env.inlineImages.has(node)) {
      await prepareInlineImage(env, node);
    } else if (node.type === "htmlInline" && !env.inlineHtml.has(node)) {
      await prepareHtmlInline(env, node);
    }
  }
}
