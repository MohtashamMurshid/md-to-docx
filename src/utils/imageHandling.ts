import type { ImageHandlingOptions } from "../types.js";

export interface ResolvedImageHandlingOptions {
  resolve?: ImageHandlingOptions["resolve"];
  baseDirectory?: string;
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
    resolve: options?.resolve,
    baseDirectory: options?.baseDirectory,
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
