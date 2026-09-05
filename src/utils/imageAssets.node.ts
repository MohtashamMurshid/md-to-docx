import fs from "node:fs/promises";
import path from "node:path";
import { throwIfAborted } from "../processingLimits.js";

export async function readLocalAsset(
  source: string,
  directory: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (
    /^[a-z][a-z\d+.-]*:/i.test(source) ||
    source.startsWith("//") ||
    source.includes("\\")
  ) {
    throw new Error("Local images must use relative file paths");
  }
  const root = await fs.realpath(directory);
  const file = await fs.realpath(
    path.resolve(root, decodeURIComponent(source)),
  );
  const relative = path.relative(root, file);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Local image escapes baseDirectory");
  }
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error(
        "Local image exceeds maximum size or is not a regular file",
      );
    // Bounded read also handles a file growing after stat.
    const data = new Uint8Array(maxBytes + 1);
    let offset = 0;
    while (offset < data.length) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        data,
        offset,
        data.length - offset,
        null,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error("Local image exceeds maximum size");
    return data.slice(0, offset);
  } finally {
    await handle.close();
  }
}

export async function rasterizeAsset(
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const { default: sharp } = await import("sharp");
  const result = await sharp(data, {
    limitInputPixels: 16_000_000,
    animated: false,
  })
    .png()
    .toBuffer();
  throwIfAborted(signal);
  return result;
}
