import { describe, expect, it } from "@jest/globals";
import {
  convertMarkdownToArrayBuffer,
  convertMarkdownToBuffer,
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

  it("renders H6 headings with level-specific styling", async () => {
    const xml = await render("###### H6 custom", {
      style: {
        heading6Alignment: "RIGHT",
        heading6Size: 18,
      },
    });

    expect(xml).toContain("H6 custom");
    expect(xml).toContain("Heading6");
    expect(xml).toContain('w:val="right"');
    expect(xml).toContain('w:val="18"');
  });

  it("renders heading inline formatting, links, and code from the model", async () => {
    const blob = await convertMarkdownToDocx(
      "# Head **bold** and [lnk](https://example.com/h) and `code`"
    );
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    // Bold marker inside the heading still renders bold.
    expect(xml).toMatch(/<w:b\s*\/>/);
    // Links inside headings become real hyperlinks, not literal text.
    expect(xml).toContain("<w:hyperlink");
    expect(rels).toContain("https://example.com/h");
    expect(xml).not.toContain("[lnk]");
    // Inline code inside headings renders as a monospace run, not backticks.
    expect(xml).toContain('w:ascii="Courier New"');
    expect(xml).not.toContain("`code`");
  });

  it("generates deterministic unique bookmark names across sections", async () => {
    const blob = await convertMarkdownToDocx("", {
      sections: [
        { markdown: "# Repeat" },
        { markdown: "# Repeat" },
      ],
    });
    const xml = await getDocumentXml(blob);
    const bookmarkNames = Array.from(
      xml.matchAll(/<w:bookmarkStart[^>]+w:name="([^"]+)"/g),
      (match) => match[1]
    );

    expect(bookmarkNames).toContain("_Toc_Repeat_1");
    expect(bookmarkNames).toContain("_Toc_Repeat_2");
    expect(new Set(bookmarkNames).size).toBe(bookmarkNames.length);
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

  it("preserves inline formatting, links, and code inside blockquotes", async () => {
    const blob = await convertMarkdownToDocx(
      "> Quote with **bold**, [lnk](https://example.com/q) and `code`."
    );
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    expect(xml).toMatch(/<w:b\s*\/>/);
    expect(xml).toContain("<w:hyperlink");
    expect(rels).toContain("https://example.com/q");
    expect(xml).toContain('w:ascii="Courier New"');
    expect(xml).not.toContain("**bold**");
    expect(xml).not.toContain("[lnk]");
    expect(xml).not.toContain("`code`");
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

  it("applies configurable inline code styling", async () => {
    const xml = await render("Use `customCode` here.", {
      style: {
        inlineCodeSize: 28,
        inlineCodeColor: "AA00CC",
        inlineCodeBackground: "EEFFAA",
      },
    });

    expect(xml).toContain("customCode");
    expect(xml).toContain('w:val="28"');
    expect(xml).toContain('w:val="AA00CC"');
    expect(xml).toContain('w:fill="EEFFAA"');
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

  it("supports custom TOC title and depth filtering", async () => {
    const markdown = `[TOC]

# Hidden H1

## Included H2

### Included H3

#### Hidden H4`;

    const xml = await render(markdown, {
      toc: {
        title: "Contents",
        minDepth: 2,
        maxDepth: 3,
      },
    });

    expect(xml).toContain("Contents");
    expect(xml).toContain("Included H2");
    expect(xml).toContain("Included H3");
    expect(xml).toContain("Hidden H1");
    expect(xml).toContain("Hidden H4");
    expect(xml.indexOf(">Included H2<")).toBeLessThan(
      xml.lastIndexOf(">Included H2<")
    );
    expect(xml.indexOf(">Included H3<")).toBeLessThan(
      xml.lastIndexOf(">Included H3<")
    );
    expect(xml.indexOf(">Hidden H1<")).toBe(xml.lastIndexOf(">Hidden H1<"));
    expect(xml.indexOf(">Hidden H4<")).toBe(xml.lastIndexOf(">Hidden H4<"));
  });
});

describe("Rendering: Node output helpers", () => {
  it("returns valid DOCX bytes as Buffer and ArrayBuffer", async () => {
    const buffer = await convertMarkdownToBuffer("# Buffer helper");
    const arrayBuffer = await convertMarkdownToArrayBuffer("# ArrayBuffer helper");

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(Buffer.from(arrayBuffer).subarray(0, 2).toString()).toBe("PK");
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
