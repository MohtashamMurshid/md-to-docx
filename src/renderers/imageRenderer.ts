import { Paragraph, TextRun, AlignmentType, ImageRun } from "docx";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";
import { ImageHandlingOptions, Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";

export interface ResolvedImageHandlingOptions {
  remote: {
    enabled: boolean;
    allowedHosts?: string[];
  };
  dataUrls: {
    enabled: boolean;
  };
  maxImages: number;
  maxImageBytes: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
  maxUrlLength: number;
}

export const DEFAULT_IMAGE_HANDLING: ResolvedImageHandlingOptions = {
  remote: {
    enabled: false,
  },
  dataUrls: {
    enabled: true,
  },
  maxImages: 50,
  maxImageBytes: 5 * 1024 * 1024,
  fetchTimeoutMs: 10_000,
  maxRedirects: 3,
  maxUrlLength: 2048,
};

export function resolveImageHandlingOptions(
  options?: ImageHandlingOptions
): ResolvedImageHandlingOptions {
  return {
    remote: {
      enabled: options?.remote?.enabled === true,
      allowedHosts: options?.remote?.allowedHosts?.map((host) =>
        host.trim().toLowerCase()
      ),
    },
    dataUrls: {
      enabled: options?.dataUrls?.enabled !== false,
    },
    maxImages: options?.maxImages ?? DEFAULT_IMAGE_HANDLING.maxImages,
    maxImageBytes:
      options?.maxImageBytes ?? DEFAULT_IMAGE_HANDLING.maxImageBytes,
    fetchTimeoutMs:
      options?.fetchTimeoutMs ?? DEFAULT_IMAGE_HANDLING.fetchTimeoutMs,
    maxRedirects: options?.maxRedirects ?? DEFAULT_IMAGE_HANDLING.maxRedirects,
    maxUrlLength: options?.maxUrlLength ?? DEFAULT_IMAGE_HANDLING.maxUrlLength,
  };
}

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

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6HextetsToIpv4(hiHex: string, loHex: string): string | undefined {
  const hi = parseInt(hiHex, 16);
  const lo = parseInt(loHex, 16);
  if (
    Number.isNaN(hi) ||
    Number.isNaN(lo) ||
    hi < 0 ||
    hi > 65535 ||
    lo < 0 ||
    lo > 65535
  ) {
    return undefined;
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * True when `address` is IPv4-in-IPv6 (RFC 4291 §2.5.5.2): 80 zero bits + 16
 * bits 0xffff + 32-bit IPv4 encoded as dotted decimal or final two hextets.
 */
function ipv4EmbeddedInIpv4MappedAddress(address: string): string | undefined {
  const n = address.toLowerCase().split("%")[0];

  const dotted = n.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];

  const hexTail = n.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexTail) return ipv6HextetsToIpv4(hexTail[1], hexTail[2]);

  const hexLong = n.match(
    /^(?:0:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
  );
  if (hexLong) return ipv6HextetsToIpv4(hexLong[1], hexLong[2]);

  return undefined;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const mappedV4 = ipv4EmbeddedInIpv4MappedAddress(normalized);
  if (mappedV4) {
    return isPrivateIPv4(mappedV4);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  );
}

function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIPv4(address);
  }
  if (family === 6) {
    return isPrivateIPv6(address);
  }
  return true;
}

function usePinnedHttpsConnections(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}

function enforceRemoteHttpsPolicy(url: URL, options: ResolvedImageHandlingOptions): void {
  if (!options.remote.enabled) {
    throw new Error("Remote image fetching is disabled");
  }
  if (url.protocol !== "https:") {
    throw new Error("Remote image URLs must use https");
  }
  if (url.href.length > options.maxUrlLength) {
    throw new Error("Remote image URL exceeds maximum length");
  }

  const allowedHosts = options.remote.allowedHosts;
  if (allowedHosts && allowedHosts.length > 0) {
    const hostname = url.hostname.toLowerCase();
    if (!allowedHosts.includes(hostname)) {
      throw new Error("Remote image host is not allowed");
    }
  }
}

async function lookupWithTimeout(
  hostname: string,
  timeoutMs: number
): Promise<{ address: string; family: number }[]> {
  const ms = Math.max(1, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("DNS lookup timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function resolveVerifiedAddresses(
  hostname: string,
  dnsTimeoutMs: number
): Promise<{ address: string; family: number }[]> {
  const addresses = await lookupWithTimeout(hostname, dnsTimeoutMs);
  if (addresses.length === 0) {
    throw new Error("Remote image host did not resolve");
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("Remote image host resolves to a blocked network address");
  }
  return addresses;
}

function buildPinnedHttpsAgent(
  tlsServerName: string,
  connectAddress: string,
  port: number
): Agent {
  const connector = buildConnector({});
  return new Agent({
    connect(opts, callback) {
      connector(
        {
          ...opts,
          hostname: connectAddress,
          host: connectAddress,
          port: String(port),
          protocol: "https:",
          servername: tlsServerName,
        },
        callback
      );
    },
  });
}

/**
 * Validates policy + DNS/IP rules. On Node, returns an Undici Agent that pins TLS
 * to the resolved address so fetch cannot reconnect via a second DNS lookup (rebinding).
 * In browser-like runtimes without process.versions.node, returns undefined and callers use plain fetch after validation.
 */
async function preparePinnedAgentIfNeeded(
  url: URL,
  options: ResolvedImageHandlingOptions,
  dnsTimeoutMs: number
): Promise<Agent | undefined> {
  enforceRemoteHttpsPolicy(url, options);

  const literalFamily = isIP(url.hostname);
  const port = Number(url.port) || 443;
  const tlsServerName = url.hostname;

  if (!usePinnedHttpsConnections()) {
    if (literalFamily !== 0) {
      if (isBlockedIpAddress(url.hostname)) {
        throw new Error("Remote image host resolves to a blocked network address");
      }
      return undefined;
    }
    await resolveVerifiedAddresses(url.hostname, dnsTimeoutMs);
    return undefined;
  }

  if (literalFamily !== 0) {
    if (isBlockedIpAddress(url.hostname)) {
      throw new Error("Remote image host resolves to a blocked network address");
    }
    return buildPinnedHttpsAgent(tlsServerName, url.hostname, port);
  }

  const addresses = await resolveVerifiedAddresses(url.hostname, dnsTimeoutMs);
  const pick = addresses[0];
  return buildPinnedHttpsAgent(tlsServerName, pick.address, port);
}

function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

/** Races `promise` with `signal`'s abort so slow body reads honour the fetch timeout. */
async function abortablePromise<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw abortErrorFromSignal(signal);
  }

  let onAbort!: () => void;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortErrorFromSignal(signal));
    signal.addEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException("The operation was aborted", "AbortError");
}

async function cancelReadableBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel?.();
  } catch {
    /* ignore */
  }
}

async function readResponseBytes(
  response: Response,
  maxImageBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > maxImageBytes) {
    throw new Error("Remote image exceeds maximum size");
  }

  if (!response.body) {
    const arrayBuffer = await abortablePromise(response.arrayBuffer(), signal);
    if (arrayBuffer.byteLength > maxImageBytes) {
      throw new Error("Remote image exceeds maximum size");
    }
    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await abortablePromise(reader.read(), signal);
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxImageBytes) {
        throw new Error("Remote image exceeds maximum size");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw error;
  }
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

async function fetchRemoteImage(
  initialUrl: string,
  options: ResolvedImageHandlingOptions
): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
  const totalBudgetMs = Math.max(1, options.fetchTimeoutMs);
  const deadline = Date.now() + totalBudgetMs;
  let currentUrl = new URL(initialUrl);
  let redirects = 0;
  let pinnedAgent: Agent | undefined;

  const closePinned = async (): Promise<void> => {
    if (!pinnedAgent) {
      return;
    }
    try {
      await pinnedAgent.close();
    } catch {
      /* ignore */
    }
    pinnedAgent = undefined;
  };

  try {
    while (true) {
      const remainMs = deadline - Date.now();
      if (remainMs <= 0) {
        throw new Error("Remote image fetch timed out");
      }

      const dnsBudgetMs = Math.min(
        remainMs,
        Math.max(50, Math.floor(remainMs / 4))
      );

      await closePinned();
      pinnedAgent = await preparePinnedAgentIfNeeded(
        currentUrl,
        options,
        dnsBudgetMs
      );

      const hopRemainMs = deadline - Date.now();
      if (hopRemainMs <= 0) {
        throw new Error("Remote image fetch timed out");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), hopRemainMs);

      try {
        const fetchInit: RequestInit & { dispatcher?: Agent } = {
          redirect: "manual",
          signal: controller.signal,
          ...(pinnedAgent ? { dispatcher: pinnedAgent } : {}),
        };

        const response = await fetch(currentUrl.href, fetchInit);

        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.has("location")
        ) {
          clearTimeout(timeout);
          await cancelReadableBody(response);

          if (redirects >= options.maxRedirects) {
            throw new Error("Remote image exceeded redirect limit");
          }
          const location = response.headers.get("location");
          currentUrl = new URL(location!, currentUrl);
          redirects++;
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch image: ${response.status} ${response.statusText}`
          );
        }

        const bytes = await readResponseBytes(
          response,
          options.maxImageBytes,
          controller.signal
        );

        clearTimeout(timeout);

        return {
          bytes,
          contentType: response.headers.get("content-type") || "",
          finalUrl: currentUrl.href,
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  } finally {
    await closePinned();
  }
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
