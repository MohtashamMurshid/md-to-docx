import { AlignmentType, Paragraph, TextRun } from "docx";
import type { IParagraphOptions, IRunOptions, ParagraphChild } from "docx";
import type { DocxBlockNode } from "../docxModel.js";
import {
  processImage,
  processImageData,
} from "../renderers/imageRenderer.js";
import type { ProcessImageDataInput } from "../renderers/imageRenderer.js";
import {
  processChartBlock,
  validateChartAccessibility,
} from "../renderers/chartRenderer.js";
import { throwIfAborted } from "../processingLimits.js";
import { MarkdownConversionError } from "../errors.js";
import { assertImageAltPolicy, validateImageText } from "../accessibility.js";
import type { ListMarkerContext, RenderContext, RenderEnv } from "./context.js";
import {
  countImageAttempt,
  imageBudgetReached,
  isRemoteImageUrl,
  remoteFailureBudgetReached,
} from "./imageBudget.js";
import { markerNumbering, taskMarkerChildren } from "./lists.js";
import { quoteParagraphOptions, quoteStyleFor } from "./paragraphs.js";
import { fontOption, languageOption } from "./runs.js";

type ImageNode = Extract<DocxBlockNode, { type: "image" }>;
type ChartNode = Extract<DocxBlockNode, { type: "chartBlock" }>;

/**
 * Paragraph options for an image, chart or diagram: the blockquote's, plus
 * the list marker when it stands first in a list item.
 */
export function imageParagraphOptions(
  env: RenderEnv,
  context: RenderContext = {},
  marker?: ListMarkerContext,
): Partial<IParagraphOptions> {
  const quoteOptions = quoteParagraphOptions(quoteStyleFor(env.style, context));
  if (!marker) {
    return quoteOptions;
  }
  return {
    ...quoteOptions,
    alignment:
      env.style.direction === "RTL" ? AlignmentType.RIGHT : AlignmentType.LEFT,
    ...markerNumbering(marker),
  };
}

export interface Notice {
  text: string;
  paragraphOptions: Partial<IParagraphOptions>;
  prefixChildren?: readonly ParagraphChild[];
  /** Whether the notice run uses the style's font. */
  withFont?: boolean;
}

/** A centred italic red notice where an image, chart or diagram could not be shown. */
export function noticeParagraph(env: RenderEnv, notice: Notice): Paragraph {
  const { style } = env;
  return new Paragraph({
    ...notice.paragraphOptions,
    children: [
      ...(notice.prefixChildren ?? []),
      new TextRun({
        text: notice.text,
        italics: true,
        color: "FF0000",
        ...(notice.withFont ? fontOption(style) : {}),
        rightToLeft: style.direction === "RTL",
        ...languageOption(style),
      } satisfies IRunOptions),
    ],
    alignment: AlignmentType.CENTER,
    bidirectional: style.direction === "RTL",
  });
}

/** The "could not be loaded" notice for an image. */
export function imageNotice(
  env: RenderEnv,
  alt: string,
  paragraphOptions: Partial<IParagraphOptions>,
  prefixChildren: readonly ParagraphChild[] = [],
): Paragraph {
  return noticeParagraph(env, {
    text: `[Image could not be loaded: ${alt}]`,
    paragraphOptions,
    prefixChildren,
  });
}

/** Embeds already-rendered image bytes, charging the image budget when it succeeds. */
export function embedImageData(
  env: RenderEnv,
  input: ProcessImageDataInput,
): Paragraph[] {
  const { embedded, paragraphs } = processImageData(
    {
      ...input,
      maxImageBytes: env.imageHandling.maxImageBytes,
      signal: env.options.signal,
    },
    env.style,
  );
  if (embedded) {
    env.processedImageCounter.count++;
  }
  return paragraphs;
}

function imageBudgetFallback(
  env: RenderEnv,
  node: ImageNode,
  paragraphOptions: Partial<IParagraphOptions>,
): Paragraph[] {
  env.options.onWarning?.({
    code: "IMAGE_FALLBACK",
    message: "Image budget reached",
    source: node.url,
  });
  return [imageNotice(env, node.alt, paragraphOptions)];
}

async function embedImageNode(
  env: RenderEnv,
  node: ImageNode,
  paragraphOptions: Partial<IParagraphOptions>,
  marker: ListMarkerContext | undefined,
): Promise<Paragraph[]> {
  const { options } = env;
  const { embedded, paragraphs, reason } = await processImage(
    node.alt,
    node.url,
    env.style,
    env.imageHandling,
    paragraphOptions,
    options.signal,
    true,
    node.title,
    taskMarkerChildren(env, marker),
  );
  countImageAttempt(env, embedded, isRemoteImageUrl(node.url));
  if (!embedded) {
    options.onWarning?.({
      code: "IMAGE_FALLBACK",
      message: reason ?? "Image could not be embedded",
      source: node.url,
      sectionIndex: env.renderOptions.pluginSection?.index,
    });
  }
  return paragraphs;
}

export async function renderImageNode(
  env: RenderEnv,
  node: ImageNode,
  context: RenderContext = {},
  marker?: ListMarkerContext,
): Promise<Paragraph[]> {
  const { options } = env;
  throwIfAborted(options.signal);
  validateImageText(node.alt, node.title, "Markdown image");
  assertImageAltPolicy(node.alt, options.accessibility, "Markdown image");

  const paragraphOptions = imageParagraphOptions(env, context, marker);
  if (
    imageBudgetReached(env) ||
    remoteFailureBudgetReached(env, isRemoteImageUrl(node.url))
  ) {
    return imageBudgetFallback(env, node, paragraphOptions);
  }

  try {
    return await embedImageNode(env, node, paragraphOptions, marker);
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    return imageBudgetFallback(env, node, paragraphOptions);
  }
}

export async function renderChartNode(
  env: RenderEnv,
  node: ChartNode,
  context: RenderContext = {},
  marker?: ListMarkerContext,
): Promise<Paragraph[]> {
  const { options } = env;
  throwIfAborted(options.signal);
  validateChartAccessibility(node.value, options.accessibility);

  const paragraphOptions = imageParagraphOptions(env, context, marker);
  if (imageBudgetReached(env)) {
    return [
      noticeParagraph(env, {
        text: "[Chart could not be loaded: image limit reached]",
        paragraphOptions,
      }),
    ];
  }

  const { embedded, paragraphs } = await processChartBlock(
    node.value,
    env.style,
    options.chartRendering,
    options.imageHandling,
    paragraphOptions,
    options.signal,
    options.accessibility,
    taskMarkerChildren(env, marker),
  );
  if (embedded) {
    env.processedImageCounter.count++;
  } else {
    options.onWarning?.({
      code: "DIAGRAM_FALLBACK",
      message: "Chart could not be embedded",
      source: node.value,
    });
  }
  return paragraphs;
}
