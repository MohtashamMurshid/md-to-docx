import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ReadableStream, ReadableStreamDefaultReader } from "node:stream/web";
// undici's own `fetch`, never the global one: an Agent only works with the
// fetch from the same undici release, and Node's bundled undici differs
// across Node versions (Node 26's rejects undici 6's Agent).
import { Agent, buildConnector, fetch, type Response } from "undici";
import { throwIfAborted } from "../processingLimits.js";
import { isBlockedIpAddress } from "./blockedAddresses.js";
import type { ResolvedImageHandlingOptions } from "./imageHandling.js";

export { resolveImageHandlingOptions } from "./imageHandling.js";
export type { ResolvedImageHandlingOptions } from "./imageHandling.js";

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

  // An explicitly provided allowlist fails closed: an empty array denies
  // every host rather than silently allowing all of them. Omit the option
  // entirely to permit any (public) host.
  const allowedHosts = options.remote.allowedHosts;
  if (allowedHosts) {
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

/**
 * `tlsServerName` is undefined for IP-literal hosts: SNI may not carry an IP
 * address (RFC 6066), and the certificate is then checked against the IP.
 */
function buildPinnedHttpsAgent(
  tlsServerName: string | undefined,
  connectAddress: string,
  port: number
): Agent {
  const connector = buildConnector({});
  return new Agent({
    connect(opts, callback) {
      connector(
        {
          ...opts,
          // The socket connects to `hostname`. undici derives the TLS server
          // name from `host` and recognizes an IPv6 address only in brackets.
          hostname: connectAddress,
          host:
            isIP(connectAddress) === 6 ? `[${connectAddress}]` : connectAddress,
          port: String(port),
          protocol: "https:",
          ...(tlsServerName === undefined ? {} : { servername: tlsServerName }),
        },
        callback
      );
    },
  });
}

/**
 * Validates policy + DNS/IP rules and returns an Undici Agent that pins TLS to
 * the resolved address so fetch cannot reconnect via a second DNS lookup
 * (rebinding).
 */
async function preparePinnedAgent(
  url: URL,
  options: ResolvedImageHandlingOptions,
  dnsTimeoutMs: number
): Promise<Agent> {
  enforceRemoteHttpsPolicy(url, options);

  // `URL` keeps the brackets around an IPv6 literal (`[::1]`), which `isIP`
  // and the connector do not accept.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  const port = Number(url.port) || 443;

  if (literalFamily !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new Error("Remote image host resolves to a blocked network address");
    }
    return buildPinnedHttpsAgent(undefined, host, port);
  }

  const tlsServerName = url.hostname;

  const addresses = await resolveVerifiedAddresses(url.hostname, dnsTimeoutMs);
  const [pick] = addresses;
  if (!pick) {
    throw new Error("Remote image host did not resolve");
  }
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
    onAbort = () => { reject(abortErrorFromSignal(signal)); };
    signal.addEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function abortableCallerPromise<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);

  let onAbort!: () => void;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => { reject(abortErrorFromSignal(signal)); };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } catch (error) {
    if (signal.aborted) {
      throwIfAborted(signal);
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function linkCallerSignal(
  controller: AbortController,
  signal?: AbortSignal
): () => void {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }

  const onAbort = (): void => {
    controller.abort(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  return () => { signal.removeEventListener("abort", onAbort); };
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException("The operation was aborted", "AbortError");
}

async function cancelReadableBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}

/** undici types body chunks as `any`; each one is narrowed to bytes as it arrives. */
type BodyReader = ReadableStreamDefaultReader<unknown>;

function assertWithinImageBudget(byteLength: number, maxImageBytes: number): void {
  if (byteLength > maxImageBytes) {
    throw new Error("Remote image exceeds maximum size");
  }
}

async function readUnstreamedBody(
  response: Response,
  maxImageBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const arrayBuffer = await abortablePromise(response.arrayBuffer(), signal);
  assertWithinImageBudget(arrayBuffer.byteLength, maxImageBytes);
  return new Uint8Array(arrayBuffer);
}

/** Reads every chunk, failing as soon as the running total exceeds the budget. */
async function readBodyChunks(
  reader: BodyReader,
  maxImageBytes: number,
  signal?: AbortSignal
): Promise<{ chunks: Uint8Array[]; total: number }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await abortablePromise(reader.read(), signal);
    if (done) {
      return { chunks, total };
    }
    if (!(value instanceof Uint8Array)) {
      throw new Error("Remote image body is not binary");
    }
    total += value.byteLength;
    assertWithinImageBudget(total, maxImageBytes);
    chunks.push(value);
  }
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelReader(reader: BodyReader): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
}

async function readStreamedBody(
  body: ReadableStream<unknown>,
  maxImageBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const reader: BodyReader = body.getReader();
  try {
    const { chunks, total } = await readBodyChunks(reader, maxImageBytes, signal);
    return joinChunks(chunks, total);
  } catch (error) {
    await cancelReader(reader);
    throw error;
  }
}

async function readResponseBytes(
  response: Response,
  maxImageBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined) {
    assertWithinImageBudget(contentLength, maxImageBytes);
  }

  if (!response.body) {
    return readUnstreamedBody(response, maxImageBytes, signal);
  }
  return readStreamedBody(response.body, maxImageBytes, signal);
}

export interface RemoteImage {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

type HopResult = { redirect: URL } | { image: RemoteImage };

/**
 * Performs one pinned request hop. Returns the redirect target for a 3xx with
 * a `Location` header, or the image bytes for a successful response.
 */
async function fetchHop(
  currentUrl: URL,
  dispatcher: Agent,
  options: ResolvedImageHandlingOptions,
  hop: { remainMs: number; redirects: number; signal: AbortSignal | undefined }
): Promise<HopResult> {
  const { signal } = hop;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => { controller.abort(new Error("Remote image fetch timed out")); },
    hop.remainMs
  );
  const unlinkCallerSignal = linkCallerSignal(controller, signal);

  try {
    throwIfAborted(signal);
    const response = await fetch(currentUrl.href, {
      redirect: "manual",
      signal: controller.signal,
      dispatcher,
    });
    throwIfAborted(signal);

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      clearTimeout(timeout);
      await cancelReadableBody(response);

      if (hop.redirects >= options.maxRedirects) {
        throw new Error("Remote image exceeded redirect limit");
      }
      const location = response.headers.get("location");
      return { redirect: new URL(location!, currentUrl) };
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
    throwIfAborted(signal);

    clearTimeout(timeout);

    return {
      image: {
        bytes,
        contentType: response.headers.get("content-type") || "",
        finalUrl: currentUrl.href,
      },
    };
  } catch (error) {
    if (signal?.aborted) {
      throwIfAborted(signal);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    unlinkCallerSignal();
  }
}

/**
 * Fetches a remote image over HTTPS with SSRF protections: host allowlisting,
 * private-network IP blocking, DNS-pinned TLS connections (to prevent DNS
 * rebinding), a redirect budget, and a total time budget that also bounds the
 * response body read.
 */
export async function fetchRemoteImage(
  initialUrl: string,
  options: ResolvedImageHandlingOptions,
  signal?: AbortSignal
): Promise<RemoteImage> {
  throwIfAborted(signal);

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
    for (;;) {
      throwIfAborted(signal);

      const remainMs = deadline - Date.now();
      if (remainMs <= 0) {
        throw new Error("Remote image fetch timed out");
      }

      const dnsBudgetMs = Math.min(
        remainMs,
        Math.max(50, Math.floor(remainMs / 4))
      );

      await closePinned();
      pinnedAgent = await abortableCallerPromise(
        preparePinnedAgent(currentUrl, options, dnsBudgetMs),
        signal
      );

      const hopRemainMs = deadline - Date.now();
      if (hopRemainMs <= 0) {
        throw new Error("Remote image fetch timed out");
      }

      const result = await fetchHop(currentUrl, pinnedAgent, options, {
        remainMs: hopRemainMs,
        redirects,
        signal,
      });
      if ("image" in result) {
        return result.image;
      }
      currentUrl = result.redirect;
      redirects++;
    }
  } finally {
    await closePinned();
  }
}
