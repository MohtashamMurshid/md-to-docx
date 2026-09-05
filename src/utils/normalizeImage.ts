import { DOMParser } from "@xmldom/xmldom";
import { rasterizeAsset } from "#image-assets";

/** SVGs are rasterized as inert graphics. Reject references before any decoder runs. */
function validateSvg(data: Uint8Array): void {
  const text = new TextDecoder().decode(data);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))
    throw new Error(
      "SVG declarations and external stylesheets are not supported",
    );
  const document = new DOMParser({
    onError: () => {
      throw new Error("Invalid SVG");
    },
  }).parseFromString(text, "image/svg+xml");
  if (document.documentElement?.localName !== "svg")
    throw new Error("Invalid SVG root");
  const elements = document.getElementsByTagName("*");
  for (let i = 0; i < elements.length; i++) {
    const element = elements.item(i)!;
    if (
      /^(script|foreignObject|style|animate|animateTransform|animateMotion|set)$/i.test(
        element.localName ?? "",
      )
    )
      throw new Error("Active SVG content is not supported");
    for (let j = 0; j < element.attributes.length; j++) {
      const attr = element.attributes.item(j)!;
      if (
        attr.name === "xml:base" ||
        /[\\]|@import/i.test(attr.value) ||
        /^on/i.test(attr.name) ||
        /url\s*\(/i.test(attr.value) ||
        (/(?:^|:)href$/i.test(attr.name) && !attr.value.startsWith("#"))
      ) {
        throw new Error("External or active SVG references are not supported");
      }
    }
  }
}

export async function normalizeImage(
  data: Uint8Array,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (data.length > maxBytes) throw new Error("Image exceeds maximum size");
  const prefix = new TextDecoder().decode(data.slice(0, 512));
  const svg = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
    prefix,
  );
  const webp = prefix.slice(0, 4) === "RIFF" && prefix.slice(8, 12) === "WEBP";
  if (!svg && !webp) return data;
  if (svg) validateSvg(data);
  const png = await rasterizeAsset(data, signal);
  if (png.length > maxBytes)
    throw new Error("Converted image exceeds maximum size");
  return png;
}
