import { Paragraph, TextRun, AlignmentType, ImageRun } from "docx";
import { ImageHandlingOptions, Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import {
  fetchRemoteImage,
  resolveImageHandlingOptions,
} from "../utils/secureImageFetch.js";

export {
  DEFAULT_IMAGE_HANDLING,
  resolveImageHandlingOptions,
} from "../utils/secureImageFetch.js";
export type { ResolvedImageHandlingOptions } from "../utils/secureImageFetch.js";

/**
 * Computes output image dimensions preserving aspect ratio.
 * - If both hints provided, uses them directly.
 * - If one hint provided and intrinsic aspect known, computes the other.
 * - Falls back to intrinsic width capped to 400, or default width 200.
 */
export function computeImageDimensions(
  widthHint: number | undefined,
  heightHint: number | undefined,
  intrinsicWidth: number | undefined,
  intrinsicHeight: number | undefined
): { width: number; height?: number } {
  let outWidth: number;
  let outHeight: number | undefined;
  const aspect =
    intrinsicWidth && intrinsicHeight
      ? intrinsicWidth / intrinsicHeight
      : undefined;

  if (widthHint && heightHint) {
    outWidth = widthHint;
    outHeight = heightHint;
  } else if (widthHint && aspect) {
    outWidth = widthHint;
    outHeight = Math.max(1, Math.round(widthHint / aspect));
  } else if (heightHint && aspect) {
    outHeight = heightHint;
    outWidth = Math.max(1, Math.round(heightHint * aspect));
  } else if (intrinsicWidth) {
    outWidth = Math.min(intrinsicWidth, 400);
    if (aspect) outHeight = Math.max(1, Math.round(outWidth / aspect));
  } else {
    outWidth = 200;
  }

  return { width: outWidth, height: outHeight };
}

function readUint16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readIntrinsicDimensions(
  imageType: "png" | "jpg" | "gif",
  bytes: Uint8Array
): { width?: number; height?: number } {
  let width: number | undefined;
  let height: number | undefined;

  if (imageType === "png" && bytes.length >= 24) {
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    if (isPng) {
      width = readUint32BE(bytes, 16);
      height = readUint32BE(bytes, 20);
    }
  } else if (imageType === "jpg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = readUint16BE(bytes, offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        height = readUint16BE(bytes, offset + 5);
        width = readUint16BE(bytes, offset + 7);
        break;
      }
      offset += 2 + length;
    }
  } else if (imageType === "gif" && bytes.length >= 10) {
    width = bytes[6] | (bytes[7] << 8);
    height = bytes[8] | (bytes[9] << 8);
  }

  return { width, height };
}

function detectImageType(
  bytes: Uint8Array,
  contentType: string,
  imageUrl: string
): "png" | "jpg" | "gif" {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isGif =
    bytes.length >= 6 &&
    ((bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      bytes[4] === 0x37 &&
      bytes[5] === 0x61) ||
      (bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        bytes[4] === 0x39 &&
        bytes[5] === 0x61));

  if (isPng) return "png";
  if (isJpg) return "jpg";
  if (isGif) return "gif";

  throw new Error(
    `Unsupported or invalid image data (${contentType || imageUrl})`
  );
}

export interface ProcessImageResult {
  /** True when an image run was embedded in the document output. */
  embedded: boolean;
  paragraphs: Paragraph[];
}

/**
 * Processes an image and returns paragraphs plus whether a raster was embedded.
 */
export async function processImage(
  altText: string,
  imageUrl: string,
  style: Style,
  imageHandling?: ImageHandlingOptions
): Promise<ProcessImageResult> {
  try {
    const resolvedImageHandling = resolveImageHandlingOptions(imageHandling);
    let widthHint: number | undefined;
    let heightHint: number | undefined;
    let urlWithoutFragment = imageUrl;

    const hashIndex = imageUrl.indexOf("#");
    if (hashIndex >= 0) {
      const fragment = imageUrl.substring(hashIndex + 1);
      urlWithoutFragment = imageUrl.substring(0, hashIndex);

      const wxh = fragment.match(/^(\d+)x(\d+)$/);
      if (wxh) {
        widthHint = parseInt(wxh[1], 10);
        heightHint = parseInt(wxh[2], 10);
      } else {
        const params = new URLSearchParams(fragment.replace(/&amp;/g, "&"));
        const w = params.get("w") || params.get("width");
        const h = params.get("h") || params.get("height");
        if (w && /^\d+$/.test(w)) widthHint = parseInt(w, 10);
        if (h && /^\d+$/.test(h)) heightHint = parseInt(h, 10);
      }
    }

    let data: Uint8Array | Buffer;
    let contentType = "";
    let urlForTypeDetection = imageUrl;

    if (/^data:/i.test(urlWithoutFragment)) {
      if (!resolvedImageHandling.dataUrls.enabled) {
        throw new Error("Data URL images are disabled");
      }
      const match = urlWithoutFragment.match(/^data:([^;,]*)(;base64)?,(.*)$/i);
      if (!match) {
        throw new Error(`Invalid data URL for image: ${urlWithoutFragment.substring(0, 100)}...`);
      }
      contentType = match[1] || "";
      const isBase64 = !!match[2];
      const dataPart = match[3];
      const estimatedBytes = isBase64
        ? Math.floor((dataPart.replace(/\s/g, "").length * 3) / 4)
        : decodeURIComponent(dataPart).length;
      if (estimatedBytes > resolvedImageHandling.maxImageBytes) {
        throw new Error("Data URL image exceeds maximum size");
      }

      try {
        const binary = isBase64
          ? typeof Buffer !== "undefined"
            ? Buffer.from(dataPart, "base64")
            : Uint8Array.from(atob(dataPart), (c) => c.charCodeAt(0))
          : typeof Buffer !== "undefined"
          ? Buffer.from(decodeURIComponent(dataPart))
          : new TextEncoder().encode(decodeURIComponent(dataPart));
        data = binary as Uint8Array | Buffer;

        if (!data || data.length === 0) {
          throw new Error("Data URL produced empty image data");
        }
        if (data.length > resolvedImageHandling.maxImageBytes) {
          throw new Error("Data URL image exceeds maximum size");
        }
      } catch (error) {
        throw new Error(`Failed to decode data URL: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      const remoteImage = await fetchRemoteImage(
        urlWithoutFragment,
        resolvedImageHandling
      );
      data =
        typeof Buffer !== "undefined"
          ? Buffer.from(remoteImage.bytes)
          : remoteImage.bytes;
      contentType = remoteImage.contentType;
      urlForTypeDetection = remoteImage.finalUrl;
    }

    if (!data || data.length === 0) {
      throw new Error(`Invalid image data: data length is ${data ? (data instanceof Uint8Array ? data.length : (data as Buffer).length) : 0}`);
    }

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const imageType = detectImageType(bytes, contentType, urlForTypeDetection);
    const { width: intrinsicWidth, height: intrinsicHeight } = readIntrinsicDimensions(
      imageType,
      bytes
    );

    const { width: outWidth, height: outHeight } = computeImageDimensions(
      widthHint,
      heightHint,
      intrinsicWidth,
      intrinsicHeight
    );

    // docx expects Buffer in Node.js, Uint8Array in browsers
    const imageData = typeof Buffer !== "undefined" && !(data instanceof Buffer)
      ? Buffer.from(data)
      : data instanceof Uint8Array
      ? data
      : Buffer.from(data as Uint8Array);

    // Fallback height if neither hints nor intrinsic dimensions provided one
    const finalHeight = outHeight || (outWidth ? Math.round(outWidth * 0.75) : 200);

    return {
      embedded: true,
      paragraphs: [
        new Paragraph({
          children: [
            new ImageRun({
              data: imageData,
              transformation: {
                width: outWidth,
                height: finalHeight,
              },
              type: imageType,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: {
            before: style.paragraphSpacing,
            after: style.paragraphSpacing,
          },
        }),
      ],
    };
  } catch {
    return {
      embedded: false,
      paragraphs: [
        new Paragraph({
          children: [
            new TextRun({
              text: `[Image could not be displayed: ${altText}]`,
              italics: true,
              color: "FF0000",
              font: resolveFontFamily(style),
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      ],
    };
  }
}
