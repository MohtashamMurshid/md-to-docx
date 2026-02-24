import { describe, expect, it } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import type { Options } from "../src/types";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "..", "test-output");

function saveBlob(blob: Blob, filename: string) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  return blob.arrayBuffer().then((buf) => {
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(buf));
  });
}

describe("Style system v2", () => {
  it("supports fontFamily together with underline and strikethrough markers", async () => {
    const markdown = `# ++Styled++ Title

This paragraph uses ++underline++, ~~strikethrough~~, and **bold**.

- List with ++underline++
- List with ~~strikethrough~~`;

    const options: Options = {
      documentType: "document",
      style: {
        fontFamily: "Trebuchet MS",
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
      },
    };

    const blob = await convertMarkdownToDocx(markdown, options);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    await saveBlob(blob, "style-system-v2-font-family.docx");
  });

  it("supports deprecated fontFamilly alias for backwards compatibility", async () => {
    const markdown = "Paragraph with ++underline++ marker.";

    const options: Options = {
      style: {
        fontFamilly: "Arial",
      },
    };

    const blob = await convertMarkdownToDocx(markdown, options);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    await saveBlob(blob, "style-system-v2-deprecated-alias.docx");
  });

  it("throws for empty fontFamily values", async () => {
    await expect(
      convertMarkdownToDocx("Hello", {
        style: {
          fontFamily: "   ",
        },
      })
    ).rejects.toThrow("Invalid fontFamily");
  });
});
