import { throwIfAborted } from "../processingLimits.js";
import type { ResolvedImageHandlingOptions } from "./imageHandling.js";

export { resolveImageHandlingOptions } from "./imageHandling.js";
export type { ResolvedImageHandlingOptions } from "./imageHandling.js";

export interface RemoteImage {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

/**
 * Browsers cannot perform the DNS and connection pinning required by the
 * server-side SSRF policy. Remote Markdown images therefore fail closed in the
 * browser build, even when `remote.enabled` is true. Data URLs and caller-
 * supplied image bytes remain supported.
 */
export function fetchRemoteImage(
  _initialUrl: string,
  _options: ResolvedImageHandlingOptions,
  signal?: AbortSignal
): Promise<RemoteImage> {
  // The executor runs synchronously and its throw becomes the rejection,
  // matching the previous async-function behavior.
  return new Promise<RemoteImage>(() => {
    throwIfAborted(signal);
    throw new Error(
      "Remote image fetching is unavailable in browsers; use a data URL, a trusted renderer/plugin, or perform conversion on the server"
    );
  });
}
