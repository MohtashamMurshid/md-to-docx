import { describe, expect, it } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../src/index";
import type { Options } from "../src/types";
import { getDocumentXml, getZip, saveBlobForDebug } from "./helpers";

// 1x1 transparent PNG used in image tests so the suite doesn't hit the network.
const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  return getDocumentXml(blob);
}

describe("Rendering: headings and alignment", () => {
  it("applies level-specific heading alignments and falls back to headingAlignment", async () => {
    const markdown = `# H1 centered
## H2 right
### H3 default-from-fallback
#### H4 default-from-fallback
##### H5 default-from-fallback`;

    const xml = await render(markdown, {
      documentType: "document",
      style: {
        headingAlignment: "JUSTIFIED",
        heading1Alignment: "CENTER",
        heading2Alignment: "RIGHT",
      },
    });

    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('w:val="right"');
    expect(xml).toContain('w:val="both"');
    expect(xml).toContain("H1 centered");
    expect(xml).toContain("H5 default-from-fallback");
  });

  it("applies paragraph and blockquote alignments", async () => {
    const markdown = `Left paragraph here.

> A blockquote that should be centered.

Another paragraph with justified alignment.`;

    const xml = await render(markdown, {
      style: {
        paragraphAlignment: "JUSTIFIED",
        blockquoteAlignment: "CENTER",
      },
    });

    expect(xml).toContain('w:val="both"');
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain("blockquote");
  });
});

describe("Rendering: inline formatting", () => {
  it("emits bold, italic, underline, strikethrough, and inline code runs", async () => {
    const markdown = `This paragraph has **bold**, *italic*, ++underline++, ~~strikethrough~~, ***bold italic***, and \`inline code\`.`;

    const blob = await convertMarkdownToDocx(markdown);
    await saveBlobForDebug(blob, "inline-formatting.docx");
    const xml = await getDocumentXml(blob);

    expect(xml).toMatch(/<w:b\s*\/>|<w:b\s+/);
    expect(xml).toMatch(/<w:i\s*\/>|<w:i\s+/);
    expect(xml).toMatch(/<w:u\s/);
    expect(xml).toMatch(/<w:strike\s*\/>|<w:strike\s+/);
    expect(xml).toContain("bold");
    expect(xml).toContain("italic");
    expect(xml).toContain("underline");
    expect(xml).toContain("strikethrough");
    expect(xml).toContain("inline code");
  });
});

describe("Rendering: lists", () => {
  it("renders bullet and numbered lists with numbering references", async () => {
    const markdown = `## Bullets
- First bullet
- Second bullet with **bold**

## Numbers
1. First numbered
2. Second numbered

Interrupting paragraph.

1. Should restart
2. Second item of new list`;

    const blob = await convertMarkdownToDocx(markdown);
    await saveBlobForDebug(blob, "lists.docx");
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const numberingXml = await zip
      .file("word/numbering.xml")
      ?.async("string");

    expect(documentXml).toContain("<w:numPr>");
    expect(documentXml).toMatch(/<w:numId\s+w:val="\d+"\s*\/>/);
    expect(numberingXml).toBeDefined();
    expect(documentXml).toContain("First bullet");
    expect(documentXml).toContain("Should restart");
  });
});

describe("Rendering: code blocks", () => {
  it("renders fenced code block content with code formatting", async () => {
    const markdown = `Intro paragraph.

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

Outro paragraph.`;

    const xml = await render(markdown, {
      style: { codeBlockSize: 20 },
    });

    expect(xml).toContain("function greet");
    expect(xml).toContain("Hello, ");
    expect(xml).toContain("Intro paragraph");
    expect(xml).toContain("Outro paragraph");
  });
});

describe("Rendering: tables", () => {
  it("renders headers, data rows, and column alignment markers", async () => {
    const markdown = `| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| d    | e      | f     |`;

    const xml = await render(markdown);

    expect(xml).toContain("<w:tbl");
    expect(xml).toContain("<w:tr");
    expect(xml).toContain("<w:tc");
    expect(xml).toContain("Left");
    expect(xml).toContain("Center");
    expect(xml).toContain("Right");
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('w:val="right"');
  });

  it("preserves inline formatting in cells and headers (issue #35)", async () => {
    const markdown = `| **Bold Header** | *Italic Header* | \`Code Header\` |
|-----------------|-----------------|-----------------|
| **Bold text**   | *Italic text*   | ~~Deprecated~~  |
| \`inline code\` | [link](https://example.com) | ***bold italic*** |
| ++underline++   | normal          | text            |`;

    const xml = await render(markdown);

    expect(xml).toContain("Bold Header");
    expect(xml).toContain("Italic Header");
    expect(xml).toContain("Code Header");
    expect(xml).toContain("Bold text");
    expect(xml).toContain("Italic text");
    expect(xml).toContain("Deprecated");
    expect(xml).toContain("inline code");
    expect(xml).toContain("link");
    expect(xml).toContain("bold italic");
    expect(xml).toContain("underline");
    expect(xml).toMatch(/<w:b\s*\/>|<w:b\s+/);
    expect(xml).toMatch(/<w:i\s*\/>|<w:i\s+/);
    expect(xml).toMatch(/<w:strike\s*\/>|<w:strike\s+/);
  });

  it("honors configurable tableLayout option", async () => {
    const markdown = `| A | B |
|---|---|
| 1 | 2 |`;

    const xmlFixed = await render(markdown, {
      style: { tableLayout: "fixed" },
    });
    const xmlAuto = await render(markdown, {
      style: { tableLayout: "autofit" },
    });

    expect(xmlFixed).toContain("<w:tbl");
    expect(xmlAuto).toContain("<w:tbl");
    // fixed layout should include tblLayout type="fixed"
    expect(xmlFixed).toMatch(/<w:tblLayout[^>]*w:type="fixed"/);
  });
});

describe("Rendering: images", () => {
  it("embeds a data-URL image with explicit width and height", async () => {
    const markdown = `![one px](${ONE_PX_PNG}#w=50&h=50)`;

    const blob = await convertMarkdownToDocx(markdown);
    await saveBlobForDebug(blob, "image-dataurl.docx");
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toMatch(/<pic:pic\b/);

    // docx should create a media entry for the embedded image
    const mediaFiles = Object.keys(zip.files).filter((p) =>
      p.startsWith("word/media/")
    );
    expect(mediaFiles.length).toBeGreaterThan(0);
  });
});

describe("Rendering: TOC and page break markers", () => {
  it("emits a TOC field and an explicit page break", async () => {
    const markdown = `[TOC]

# Section 1

Content.

\\pagebreak

# Section 2

More content.`;

    const xml = await render(markdown);

    expect(xml).toMatch(/TOC/i);
    expect(xml).toContain('<w:br w:type="page"');
    expect(xml).toContain("Section 1");
    expect(xml).toContain("Section 2");
  });
});

describe("Rendering: font family", () => {
  it("applies fontFamily to run properties", async () => {
    const markdown = `Paragraph with custom font.`;

    const xml = await render(markdown, {
      style: { fontFamily: "Trebuchet MS" },
    });

    expect(xml).toContain("Trebuchet MS");
  });

  it("supports the deprecated fontFamilly alias", async () => {
    const markdown = `Paragraph with alias font.`;

    const xml = await render(markdown, {
      style: { fontFamilly: "Arial" },
    });

    expect(xml).toContain("Arial");
  });
});

describe("Rendering: error cases", () => {
  it("throws MarkdownConversionError for whitespace-only fontFamily", async () => {
    await expect(
      convertMarkdownToDocx("Hello", {
        style: { fontFamily: "   " },
      })
    ).rejects.toThrow("Invalid fontFamily");
  });

  it("throws MarkdownConversionError for non-string markdown input", async () => {
    await expect(
      convertMarkdownToDocx(undefined as unknown as string)
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });
});
