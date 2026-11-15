import { readLocalAsset } from "#image-assets";
import { fetchRemoteImage } from "#secure-image-fetch";
import { MarkdownConversionError } from "../errors.js";
import { throwIfAborted } from "../processingLimits.js";
import type { ResolvedImageHandlingOptions } from "../utils/imageHandling.js";

/**
 * Where an image's bytes come from, tried in order: the caller's `resolve`
 * callback, a local file under `baseDirectory`, a data URL, then a remote
 * fetch under the SSRF policy.
 */

export interface ImageReference {
  /** The image URL with any `#` size fragment removed. */
  url: string;
  widthHint: number | undefined;
  heightHint: number | undefined;
}

export interface LoadedImage {
  data: Uint8Array | Buffer;
  contentType: string;
  /** Set for remote images: the URL after redirects. */
  finalUrl?: string;
}

function digitsParam(
  params: URLSearchParams,
  shortName: string,
  longName: string,
): number | undefined {
  const value = params.get(shortName) || params.get(longName);
  return value && /^\d+$/.test(value) ? parseInt(value, 10) : undefined;
}

/** Size hints come as `#WxH` or as `#w=W&h=H` / `#width=W&height=H`. */
function parseSizeFragment(
  fragment: string,
): Pick<ImageReference, "widthHint" | "heightHint"> {
  const wxh = fragment.match(/^(\d+)x(\d+)$/);
  if (wxh) {
    // Both groups are mandatory in the pattern.
    return { widthHint: parseInt(wxh[1]!, 10), heightHint: parseInt(wxh[2]!, 10) };
  }
  const params = new URLSearchParams(fragment.replace(/&amp;/g, "&"));
  return {
    widthHint: digitsParam(params, "w", "width"),
    heightHint: digitsParam(params, "h", "height"),
  };
}

export function parseImageReference(imageUrl: string): ImageReference {
  const hashIndex = imageUrl.indexOf("#");
  if (hashIndex < 0) {
    return { url: imageUrl, widthHint: undefined, heightHint: undefined };
  }
  return {
    url: imageUrl.substring(0, hashIndex),
    ...parseSizeFragment(imageUrl.substring(hashIndex + 1)),
  };
}

function decodeDataUrlBytes(dataPart: string, isBase64: boolean): Uint8Array {
  if (isBase64) {
    return typeof Buffer !== "undefined"
      ? Buffer.from(dataPart, "base64")
      : Uint8Array.from(atob(dataPart), (c) => c.charCodeAt(0));
  }
  return typeof Buffer !== "undefined"
    ? Buffer.from(decodeURIComponent(dataPart))
    : new TextEncoder().encode(decodeURIComponent(dataPart));
}

function decodeDataUrlPayload(
  dataPart: string,
  isBase64: boolean,
  maxImageBytes: number,
  signal: AbortSignal | undefined,
): Uint8Array {
  try {
    const data = decodeDataUrlBytes(dataPart, isBase64);
    if (data.length === 0) {
      throw new Error("Data URL produced empty image data");
    }
    if (data.length > maxImageBytes) {
      throw new Error("Data URL image exceeds maximum size");
    }
    throwIfAborted(signal);
    return data;
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new Error(
      `Failed to decode data URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function loadDataUrlImage(
  url: string,
  handling: ResolvedImageHandlingOptions,
  signal: AbortSignal | undefined,
): LoadedImage {
  throwIfAborted(signal);
  if (!handling.dataUrls.enabled) {
    throw new Error("Data URL images are disabled");
  }
  const match = url.match(/^data:([^;,]*)(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error(
      `Invalid data URL for image: ${url.substring(0, 100)}...`,
    );
  }
  const contentType = match[1] || "";
  const isBase64 = !!match[2];
  // Group 3 is mandatory in the pattern.
  const dataPart = match[3]!;
  const estimatedBytes = isBase64
    ? Math.floor((dataPart.replace(/\s/g, "").length * 3) / 4)
    : decodeURIComponent(dataPart).length;
  if (estimatedBytes > handling.maxImageBytes) {
    throw new Error("Data URL image exceeds maximum size");
  }
  return {
    data: decodeDataUrlPayload(dataPart, isBase64, handling.maxImageBytes, signal),
    contentType,
  };
}

async function loadRemoteImage(
  url: string,
  handling: ResolvedImageHandlingOptions,
  signal: AbortSignal | undefined,
): Promise<LoadedImage> {
  const remoteImage = await fetchRemoteImage(url, handling, signal);
  return {
    data:
      typeof Buffer !== "undefined"
        ? Buffer.from(remoteImage.bytes)
        : remoteImage.bytes,
    contentType: remoteImage.contentType,
    finalUrl: remoteImage.finalUrl,
  };
}

export async function loadImage(
  url: string,
  handling: ResolvedImageHandlingOptions,
  signal: AbortSignal | undefined,
): Promise<LoadedImage> {
  const resolved = await handling.resolve?.(url, { ...(signal !== undefined ? { signal } : {}), maxBytes: handling.maxImageBytes });
  if (resolved) {
    return {
      data: resolved.data instanceof Uint8Array ? resolved.data : new Uint8Array(resolved.data),
      contentType: resolved.contentType ?? "",
    };
  }
  if (handling.baseDirectory && !/^[a-z][a-z\d+.-]*:/i.test(url)) {
    return {
      data: await readLocalAsset(url, handling.baseDirectory, handling.maxImageBytes, signal),
      contentType: "",
    };
  }
  if (/^data:/i.test(url)) {
    return loadDataUrlImage(url, handling, signal);
  }
  return loadRemoteImage(url, handling, signal);
}
