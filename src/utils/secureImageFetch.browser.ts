import { throwIfAborted } from "../processingLimits.js";
import type { ResolvedImageHandlingOptions } from "./imageHandling.js";

export {
  DEFAULT_IMAGE_HANDLING,
  resolveImageHandlingOptions,
} from "./imageHandling.js";
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
export async function fetchRemoteImage(
  _initialUrl: string,
  _options: ResolvedImageHandlingOptions,
  signal?: AbortSignal
): Promise<RemoteImage> {
  throwIfAborted(signal);
  throw new Error(
    "Remote image fetching is unavailable in browsers; use a data URL, a trusted renderer/plugin, or perform conversion on the server"
  );
}
