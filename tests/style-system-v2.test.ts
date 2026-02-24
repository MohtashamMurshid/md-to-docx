import { describe, expect, it } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import type { Options } from "../src/types";

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
