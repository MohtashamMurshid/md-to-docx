/**
 * Raster format detection and size rules for embedded images: which formats
 * Word receives, the intrinsic size read from each format's header, and the
 * rendered size derived from it and any caller hints.
 */

export type RasterImageType = "png" | "jpg" | "gif";

interface ImageSize {
  width?: number;
  height?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Magic bytes at offset 0, checked in order. */
const IMAGE_SIGNATURES: readonly {
  type: RasterImageType;
  bytes: readonly number[];
}[] = [
  { type: "png", bytes: PNG_SIGNATURE },
  { type: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { type: "gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
];

/** JPEG start-of-frame markers that carry the frame size: baseline and progressive. */
const JPEG_SIZE_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc2]);

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.length >= prefix.length &&
    prefix.every((byte, index) => bytes[index] === byte)
  );
}

export function detectImageType(
  bytes: Uint8Array,
  contentType: string,
  imageUrl: string,
): RasterImageType {
  const signature = IMAGE_SIGNATURES.find((candidate) =>
    startsWithBytes(bytes, candidate.bytes),
  );
  if (signature) return signature.type;

  throw new Error(
    `Unsupported or invalid image data (${contentType || imageUrl})`,
  );
}

// Callers bound-check the buffer before reading, so these indexes are in range.
function readUint16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset]! << 8) | buf[offset + 1]!;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

/** `\x89PNG`, the part of the signature re-checked before reading IHDR. */
const PNG_MAGIC = PNG_SIGNATURE.slice(0, 4);

/** Width and height follow the IHDR chunk header. */
function readPngSize(bytes: Uint8Array): ImageSize {
  if (bytes.length < 24 || !startsWithBytes(bytes, PNG_MAGIC)) return {};
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

/** Walks the marker segments up to the first start-of-frame segment. */
function readJpegSize(bytes: Uint8Array): ImageSize {
  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    if (JPEG_SIZE_MARKERS.has(bytes[offset + 1]!)) {
      return {
        height: readUint16BE(bytes, offset + 5),
        width: readUint16BE(bytes, offset + 7),
      };
    }
    offset += 2 + readUint16BE(bytes, offset + 2);
  }
  return {};
}

/** Little-endian logical screen size after the six-byte signature. */
function readGifSize(bytes: Uint8Array): ImageSize {
  if (bytes.length < 10) return {};
  return {
    width: bytes[6]! | (bytes[7]! << 8),
    height: bytes[8]! | (bytes[9]! << 8),
  };
}

const SIZE_READERS: Record<RasterImageType, (bytes: Uint8Array) => ImageSize> =
  {
    png: readPngSize,
    jpg: readJpegSize,
    gif: readGifSize,
  };

export function readIntrinsicDimensions(
  imageType: RasterImageType,
  bytes: Uint8Array,
): ImageSize {
  return SIZE_READERS[imageType](bytes);
}

/**
 * Upper bound for rendered image dimensions in pixels. Hints come from
 * attacker-controllable URL fragments (e.g. `img.png#99999999999x9`) and
 * intrinsic sizes from untrusted image headers; unbounded values produce
 * EMU numbers that Word rejects as a corrupt document.
 */
const MAX_IMAGE_DIMENSION = 10_000;

function clampImageDimension(value: number): number {
  return Math.min(Math.max(1, Math.round(value)), MAX_IMAGE_DIMENSION);
}

/**
 * Computes output image dimensions preserving aspect ratio.
 * - If both hints provided, uses them directly.
 * - If one hint provided and intrinsic aspect known, computes the other.
 * - Falls back to intrinsic width capped to 400, or default width 200.
 * Results are clamped to [1, MAX_IMAGE_DIMENSION].
 */
export function computeImageDimensions(
  widthHint: number | undefined,
  heightHint: number | undefined,
  intrinsicWidth: number | undefined,
  intrinsicHeight: number | undefined,
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

  return {
    width: clampImageDimension(outWidth),
    ...(outHeight === undefined
      ? {}
      : { height: clampImageDimension(outHeight) }),
  };
}
