import { throwIfAborted } from "../processingLimits.js";

export async function readLocalAsset(
  _source: string,
  _directory: string,
  _maxBytes: number,
  _signal?: AbortSignal,
): Promise<Uint8Array> {
  throw new Error(
    "baseDirectory is available only in Node.js; use imageHandling.resolve in browsers",
  );
}

export async function rasterizeAsset(
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const type = new TextDecoder().decode(data.slice(0, 256)).includes("<")
    ? "image/svg+xml"
    : "image/webp";
  const blob = new Blob([new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    throwIfAborted(signal);
    if (image.naturalWidth * image.naturalHeight > 16_000_000)
      throw new Error("Image exceeds pixel limit");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas image conversion is unavailable");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("Image conversion failed")),
        "image/png",
      ),
    );
    throwIfAborted(signal);
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
