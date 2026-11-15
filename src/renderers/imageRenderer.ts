import { normalizeImage } from "../utils/normalizeImage.js";
import { Paragraph, TextRun, AlignmentType, ImageRun } from "docx";
import type { IRunOptions } from "docx";
import type { IParagraphOptions, ParagraphChild } from "docx";
import { ImageHandlingOptions, Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import { resolveImageHandlingOptions } from "#secure-image-fetch";
import { MarkdownConversionError } from "../errors.js";
import { throwIfAborted } from "../processingLimits.js";
import {
  drawingAltText,
  runLanguage,
  validateImageText,
} from "../accessibility.js";
import {
  computeImageDimensions,
  detectImageType,
  readIntrinsicDimensions,
} from "./imageFormat.js";
import { loadImage, parseImageReference } from "./imageSource.js";

export { resolveImageHandlingOptions } from "#secure-image-fetch";

/**
 * Build the centered red italic placeholder paragraph shown when an image or
 * chart cannot be rendered and the caller chose not to throw.
 */
export function createRenderFailureParagraph(
  text: string,
  style: Style,
  paragraphOptions: Partial<IParagraphOptions>,
): Paragraph {
  const fontFamily = resolveFontFamily(style);
  const language = runLanguage(style);
  return new Paragraph({
    ...paragraphOptions,
    children: [
      new TextRun({
        text,
        italics: true,
        color: "FF0000",
        ...(fontFamily !== undefined ? { font: fontFamily } : {}),
        ...(language ? { language } : {}),
        rightToLeft: style.direction === "RTL",
      } satisfies IRunOptions),
    ],
    alignment: AlignmentType.CENTER,
    bidirectional: style.direction === "RTL",
  });
}

export interface ProcessImageResult {
  run?: ImageRun;
  reason?: string;
  /** True when an image run was embedded in the document output. */
  embedded: boolean;
  paragraphs: Paragraph[];
}

export interface ProcessImageDataInput {
  altText: string;
  title?: string | undefined;
  data: Uint8Array | ArrayBuffer | Buffer;
  contentType?: string | undefined;
  source?: string | undefined;
  widthHint?: number | undefined;
  heightHint?: number | undefined;
  maxImageBytes?: number | undefined;
  paragraphOptions?: Partial<IParagraphOptions> | undefined;
  signal?: AbortSignal | undefined;
  /** Preserve image alt text in Word drawing properties. Defaults to true. */
  preserveAltText?: boolean | undefined;
  /** Runs placed before the image, used for task markers in list items. */
  prefixChildren?: readonly ParagraphChild[] | undefined;
}

function imageDataBytes(input: ProcessImageDataInput): Uint8Array {
  const bytes =
    input.data instanceof Uint8Array
      ? input.data
      : new Uint8Array(input.data);

  if (bytes.length === 0) {
    throw new Error("Invalid image data: data length is 0");
  }
  if (
    input.maxImageBytes !== undefined &&
    bytes.length > input.maxImageBytes
  ) {
    throw new Error("Image exceeds maximum size");
  }
  return bytes;
}

/** docx expects Buffer in Node.js, Uint8Array in browsers. */
function docxImageData(
  data: ProcessImageDataInput["data"],
  bytes: Uint8Array,
): Uint8Array | Buffer {
  return typeof Buffer !== "undefined" && !(data instanceof Buffer)
    ? Buffer.from(bytes)
    : data instanceof Uint8Array
      ? data
      : Buffer.from(bytes);
}

function createImageRun(
  input: ProcessImageDataInput,
  bytes: Uint8Array,
): ImageRun {
  const imageType = detectImageType(
    bytes,
    input.contentType || "",
    input.source || input.altText,
  );
  const { width: intrinsicWidth, height: intrinsicHeight } =
    readIntrinsicDimensions(imageType, bytes);

  const { width: outWidth, height: outHeight } = computeImageDimensions(
    input.widthHint,
    input.heightHint,
    intrinsicWidth,
    intrinsicHeight,
  );

  const finalHeight =
    outHeight || (outWidth ? Math.round(outWidth * 0.75) : 200);

  return new ImageRun({
    data: docxImageData(input.data, bytes),
    transformation: {
      width: outWidth,
      height: finalHeight,
    },
    type: imageType,
    ...(input.preserveAltText !== false
      ? {
          altText: drawingAltText(input.altText, input.title, "Image"),
        }
      : {}),
  });
}

/**
 * Embeds already-rendered raster bytes, applying the same type detection and
 * dimension rules used by Markdown image URLs/data URLs.
 */
export function processImageData(
  input: ProcessImageDataInput,
  style: Style,
): ProcessImageResult {
  throwIfAborted(input.signal);
  validateImageText(input.altText, input.title, "embedded image");

  const run = createImageRun(input, imageDataBytes(input));
  return {
    embedded: true,
    run,
    paragraphs: [drawingParagraph(run, input, style)],
  };
}

/** The paragraph an embedded image or chart stands in, centred unless the options align it. */
export function drawingParagraph(
  run: ParagraphChild,
  placement: Pick<ProcessImageDataInput, "paragraphOptions" | "prefixChildren">,
  style: Style,
): Paragraph {
  return new Paragraph({
    ...(placement.paragraphOptions || {}),
    children: [...(placement.prefixChildren ?? []), run],
    alignment: placement.paragraphOptions?.alignment ?? AlignmentType.CENTER,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
    },
    bidirectional: style.direction === "RTL",
  });
}

export interface ProcessImageInput {
  altText: string;
  /** Image URL, data URL or local path, optionally with a `#WxH` size fragment. */
  url: string;
  imageHandling?: ImageHandlingOptions | undefined;
  /** Defaults to `{}`. */
  paragraphOptions?: Partial<IParagraphOptions> | undefined;
  signal?: AbortSignal | undefined;
  /** Preserve image alt text in Word drawing properties. Defaults to true. */
  preserveAltText?: boolean | undefined;
  title?: string | undefined;
  /** Runs placed before the image, used for task markers in list items. */
  prefixChildren?: readonly ParagraphChild[] | undefined;
}

/**
 * Processes an image and returns paragraphs plus whether a raster was embedded.
 */
export async function processImage(
  input: ProcessImageInput,
  style: Style,
): Promise<ProcessImageResult> {
  const { altText, signal } = input;
  const paragraphOptions = input.paragraphOptions ?? {};
  try {
    throwIfAborted(signal);
    const handling = resolveImageHandlingOptions(input.imageHandling);
    const { url, widthHint, heightHint } = parseImageReference(input.url);
    const image = await loadImage(url, handling, signal);
    const data = await normalizeImage(image.data, handling.maxImageBytes, signal);
    return processImageData(
      {
        altText,
        title: input.title,
        data,
        contentType: image.contentType,
        source: image.finalUrl ?? input.url,
        widthHint,
        heightHint,
        maxImageBytes: handling.maxImageBytes,
        paragraphOptions,
        signal,
        preserveAltText: input.preserveAltText ?? true,
        prefixChildren: input.prefixChildren,
      },
      style,
    );
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }

    return {
      embedded: false,
      reason: error instanceof Error ? error.message : String(error),
      paragraphs: [
        createRenderFailureParagraph(
          `[Image could not be displayed: ${altText}]`,
          style,
          paragraphOptions,
        ),
      ],
    };
  }
}
