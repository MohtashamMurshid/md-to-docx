import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";
import { ImageHandlingOptions } from "../types.js";

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

function enforceRemoteHttpsPolicy(
  url: URL,
  options: ResolvedImageHandlingOptions
): void {
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

export interface RemoteImage {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

/**
 * Fetches a remote image over HTTPS with SSRF protections: host allowlisting,
 * private-network IP blocking, DNS-pinned TLS connections (to prevent DNS
 * rebinding), a redirect budget, and a total time budget that also bounds the
 * response body read.
 */
export async function fetchRemoteImage(
  initialUrl: string,
  options: ResolvedImageHandlingOptions
): Promise<RemoteImage> {
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
