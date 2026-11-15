import type { ImageHandlingOptions } from "../types.js";

export interface ResolvedImageHandlingOptions {
  resolve?: NonNullable<ImageHandlingOptions["resolve"]>;
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

const DEFAULT_IMAGE_HANDLING: ResolvedImageHandlingOptions = {
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
  const resolve = options?.resolve;
  const baseDirectory = options?.baseDirectory;
  const allowedHosts = options?.remote?.allowedHosts?.map((host) =>
    host.trim().toLowerCase()
  );
  return {
    ...(resolve !== undefined ? { resolve } : {}),
    ...(baseDirectory !== undefined ? { baseDirectory } : {}),
    remote: {
      enabled: options?.remote?.enabled === true,
      ...(allowedHosts !== undefined ? { allowedHosts } : {}),
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
