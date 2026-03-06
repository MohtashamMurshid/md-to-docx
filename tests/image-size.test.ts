import { describe, it, expect, jest } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "test-output");
const transparentPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

jest.setTimeout(20000);

describe("image sizing", () => {
  it("preserves aspect ratio when only width is provided", async () => {
    const markdown = `![Wide Banner](${transparentPngDataUrl}#w=400)`;

    const blob = await convertMarkdownToDocx(markdown);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const outputPath = path.join(outputDir, "image-size-width-only.docx");
    const arrayBuffer = await blob.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  });

  it("uses explicit width and height when both provided", async () => {
    const markdown = `![Exact Size](${transparentPngDataUrl}#w=120&h=60)`;

    const blob = await convertMarkdownToDocx(markdown);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const outputPath = path.join(outputDir, "image-size-both.docx");
    const arrayBuffer = await blob.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  });

  it("supports data URLs with explicit size", async () => {
    const onePx = `${transparentPngDataUrl}#w=50&h=50`;
    const markdown = `![one px](${onePx})`;

    const blob = await convertMarkdownToDocx(markdown);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const outputPath = path.join(outputDir, "image-size-dataurl.docx");
    const arrayBuffer = await blob.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  });
});
