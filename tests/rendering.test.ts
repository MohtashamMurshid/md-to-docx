import { describe, expect, it } from "@jest/globals";
import { inflateSync } from "node:zlib";
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

function documentParagraphCount(xml: string): number {
  return xml.match(/<w:p>/g)?.length || 0;
}

function numberingLevels(xml: string): string[] {
  return Array.from(
    xml.matchAll(
      /<w:numPr>[\s\S]*?<w:ilvl w:val="(\d+)"\/>[\s\S]*?<\/w:numPr>/g,
    ),
    (match) => match[1],
  );
}

function numberingMarkerCount(xml: string): number {
  return xml.match(/<w:numPr>/g)?.length || 0;
}

function mediaFilesFromZip(zip: Awaited<ReturnType<typeof getZip>>): string[] {
  return Object.entries(zip.files)
    .filter(([p, file]) => p.startsWith("word/media/") && !file.dir)
    .map(([p]) => p);
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function countNonWhitePixelsInPng(bytes: Uint8Array): number {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = readPngUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === "IHDR") {
      width = readPngUint32(bytes, dataStart);
      height = readPngUint32(bytes, dataStart + 4);
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    }

    offset = dataEnd + 4;
  }

  const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
  const raw = inflateSync(compressed);
  let nonWhite = 0;
  let rawIndex = 0;

  for (let y = 0; y < height; y++) {
    rawIndex++;
    for (let x = 0; x < width; x++) {
      const r = raw[rawIndex++];
      const g = raw[rawIndex++];
      const b = raw[rawIndex++];
      rawIndex++;
      if (r !== 255 || g !== 255 || b !== 255) {
        nonWhite++;
      }
    }
  }

  return nonWhite;
}

function mathObjectCount(xml: string): number {
  return xml.match(/<m:oMath>/g)?.length || 0;
}

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
      "# Head **bold** and [lnk](https://example.com/h) and `code`",
    );
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    // The **bold** span renders as a bold run wrapping "bold" (not merely the
    // heading style's inherited boldness elsewhere in the paragraph).
    expect(xml).toMatch(/<w:b\/>(?:(?!<\/w:r>)[\s\S])*?>bold<\/w:t>/);
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
      sections: [{ markdown: "# Repeat" }, { markdown: "# Repeat" }],
    });
    const xml = await getDocumentXml(blob);
    const bookmarkNames = Array.from(
      xml.matchAll(/<w:bookmarkStart[^>]+w:name="([^"]+)"/g),
      (match) => match[1],
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
      "> Quote with **bold**, [lnk](https://example.com/q) and `code`.",
    );
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    expect(xml).toMatch(/<w:b\/>(?:(?!<\/w:r>)[\s\S])*?>bold<\/w:t>/);
    expect(xml).toContain("<w:hyperlink");
    expect(rels).toContain("https://example.com/q");
    expect(xml).toContain('w:ascii="Courier New"');
    expect(xml).not.toContain("**bold**");
    expect(xml).not.toContain("[lnk]");
    expect(xml).not.toContain("`code`");
  });

  it("renders multi-paragraph blockquotes as separate quoted paragraphs", async () => {
    const blob = await convertMarkdownToDocx(
      "> First quoted paragraph.\n>\n> Second quoted paragraph.",
    );
    const xml = await getDocumentXml(blob);

    expect(xml).toContain("First quoted paragraph.");
    expect(xml).toContain("Second quoted paragraph.");
    expect(documentParagraphCount(xml)).toBeGreaterThanOrEqual(2);
    expect(xml).not.toContain("<w:br/>");
  });

  it("renders lists inside blockquotes instead of dropping them", async () => {
    const xml = await render(`> Quoted intro
>
> - list item 1
> - list item 2`);

    expect(xml).toContain("Quoted intro");
    expect(xml).toContain("list item 1");
    expect(xml).toContain("list item 2");
    expect(xml).toContain("<w:numPr>");
  });

  it("renders nested blockquotes with all nested text preserved", async () => {
    const xml = await render(`> Outer quote
>
> > Inner quote`);

    expect(xml).toContain("Outer quote");
    expect(xml).toContain("Inner quote");
    expect(documentParagraphCount(xml)).toBeGreaterThanOrEqual(2);
  });

  it("starts quoted lists at quote-local list depth", async () => {
    const xml = await render(`- outer
  - > - quoted item`);

    expect(xml).toContain("outer");
    expect(xml).toContain("quoted item");
    expect(numberingLevels(xml)).toEqual(["0", "1", "0"]);
  });

  const calloutCases = [
    ["note", "NOTE", "Note", "0969DA", "EFF6FF"],
    ["tip", "TIP", "Tip", "1A7F37", "F0FFF4"],
    ["important", "IMPORTANT", "Important", "8250DF", "F6F0FF"],
    ["warning", "WARNING", "Warning", "BF8700", "FFF8C5"],
    ["caution", "CAUTION", "Caution", "CF222E", "FFF1F1"],
  ] as const;

  for (const [name, marker, label, borderColor, backgroundColor] of calloutCases) {
    it(`renders GitHub-style ${name} callouts with variant styling`, async () => {
      const xml = await render(`> [!${marker}]
> ${label} body.`);

      expect(xml).toContain(label);
      expect(xml).toContain(`${label} body.`);
      expect(xml).not.toContain(`[!${marker}]`);
      expect(xml).toContain(`w:color="${borderColor}"`);
      expect(xml).toContain(`w:fill="${backgroundColor}"`);
    });
  }

  it("preserves inline formatting and nested paragraphs inside callouts", async () => {
    const blob = await convertMarkdownToDocx(`> [!NOTE]
> First **bold** paragraph with [lnk](https://example.com/callout) and \`code\`.
>
> Second paragraph.`);
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    expect(xml).toContain("Note");
    expect(xml).toContain("First ");
    expect(xml).toContain("Second paragraph.");
    expect(xml).toMatch(/<w:b\/>(?:(?!<\/w:r>)[\s\S])*?>bold<\/w:t>/);
    expect(xml).toContain("<w:hyperlink");
    expect(rels).toContain("https://example.com/callout");
    expect(xml).toContain('w:ascii="Courier New"');
    expect(xml).not.toContain("[!NOTE]");
  });

  it("applies configured GitHub-style callout colors", async () => {
    const xml = await render(`> [!WARNING]
> Custom warning.`, {
      style: {
        calloutStyles: {
          warning: {
            borderColor: "112233",
            backgroundColor: "FFEEDD",
            titleColor: "445566",
          },
        },
      },
    });

    expect(xml).toContain("Warning");
    expect(xml).toContain("Custom warning.");
    expect(xml).toContain('w:color="112233"');
    expect(xml).toContain('w:fill="FFEEDD"');
    expect(xml).toContain('w:val="445566"');
  });

  it("keeps unsupported GitHub-style callout markers as normal blockquotes", async () => {
    const xml = await render(`> [!INFO]
> Unsupported info callout.`);

    expect(xml).toContain("[!INFO]");
    expect(xml).toContain("Unsupported info callout.");
    expect(xml).toContain('w:color="AAAAAA"');
    expect(xml).not.toContain('w:fill="EFF6FF"');
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

describe("Rendering: math", () => {
  it("renders inline and block math as native Word math objects", async () => {
    const xml = await render(`Inline $x^2$ appears here.

$$
\\frac{1}{2}
$$`);

    expect(mathObjectCount(xml)).toBe(2);
    expect(xml).toContain("<m:sSup>");
    expect(xml).toContain("<m:f>");
    expect(xml).not.toContain("$x^2$");
    expect(xml).not.toContain("\\frac");
  });

  it("keeps escaped dollar math syntax as literal text", async () => {
    const xml = await render("Only escaped \\$x^2$ remains text.");

    expect(mathObjectCount(xml)).toBe(0);
    expect(xml).toContain("$x^2$ remains text.");
  });

  it("falls back to literal text for unsupported TeX by default", async () => {
    const xml = await render("Unsupported $\\overline{x}$ stays literal.");

    expect(mathObjectCount(xml)).toBe(0);
    expect(xml).toContain("$\\overline{x}$");
  });

  it("throws for unsupported TeX when configured", async () => {
    await expect(
      convertMarkdownToDocx("Unsupported $\\overline{x}$", {
        mathRendering: { unsupported: "throw" },
      }),
    ).rejects.toThrow(MarkdownConversionError);
  });

  it("can disable math parsing", async () => {
    const xml = await render("Inline $x^2$ remains literal.", {
      mathRendering: { enabled: false },
    });

    expect(mathObjectCount(xml)).toBe(0);
    expect(xml).toContain("$x^2$ remains literal.");
  });
});

describe("Rendering: footnotes", () => {
  it("renders a basic Markdown footnote as native DOCX footnote markup", async () => {
    const blob = await convertMarkdownToDocx(
      "Text with a footnote[^1].\n\n[^1]: Footnote body.",
    );
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const footnotesXml = await zip.file("word/footnotes.xml")?.async("string");

    expect(documentXml).toContain("<w:footnoteReference");
    expect(documentXml).toContain('w:id="1"');
    expect(documentXml).not.toContain("Footnote body.");
    expect(footnotesXml).toBeDefined();
    expect(footnotesXml).toContain('<w:footnote w:id="1"');
    expect(footnotesXml).toContain("Footnote body.");
  });

  it("preserves inline formatting, links, and code inside footnote content", async () => {
    const blob = await convertMarkdownToDocx(
      "Formatted note[^fmt].\n\n[^fmt]: **bold**, *italic*, [link](https://example.com/fn), and `code`.",
    );
    const zip = await getZip(blob);
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");
    const footnoteRels = await zip
      .file("word/_rels/footnotes.xml.rels")
      ?.async("string");

    expect(footnotesXml).toContain("bold");
    expect(footnotesXml).toContain("italic");
    expect(footnotesXml).toContain("code");
    expect(footnotesXml).toMatch(/<w:b\/>(?:(?!<\/w:r>)[\s\S])*?>bold<\/w:t>/);
    expect(footnotesXml).toMatch(/<w:i\/>(?:(?!<\/w:r>)[\s\S])*?>italic<\/w:t>/);
    expect(footnotesXml).toContain("<w:hyperlink");
    expect(footnotesXml).toContain('w:ascii="Courier New"');
    expect(footnoteRels).toContain("https://example.com/fn");
  });

  it("handles multiple footnotes and repeated references deterministically", async () => {
    const blob = await convertMarkdownToDocx(
      "First[^alpha], second[^beta], first again[^alpha].\n\n[^beta]: Beta body.\n[^alpha]: Alpha body.",
    );
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");

    expect(
      Array.from(
        documentXml.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g),
        (match) => match[1],
      ),
    ).toEqual(["1", "2", "1"]);
    expect(footnotesXml.indexOf('w:id="1"')).toBeLessThan(
      footnotesXml.indexOf('w:id="2"'),
    );
    expect(footnotesXml.indexOf("Alpha body.")).toBeLessThan(
      footnotesXml.indexOf("Beta body."),
    );
  });

  it("keeps unresolved footnote references as literal text", async () => {
    const xml = await render("Missing note[^missing] stays visible.");

    expect(xml).toContain("[^missing]");
    expect(xml).not.toContain("<w:footnoteReference");
  });

  it("keeps nested footnote references inside footnote content as literal text", async () => {
    const blob = await convertMarkdownToDocx(
      "Outer note[^outer].\n\n[^outer]: Nested reference [^inner] stays visible.\n[^inner]: Inner body.",
    );
    const zip = await getZip(blob);
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");

    expect(footnotesXml).toContain("Nested reference ");
    expect(footnotesXml).toContain("[^inner]");
    expect(footnotesXml).not.toContain("Inner body.");
  });

  it("keeps footnote IDs unique across sections", async () => {
    const blob = await convertMarkdownToDocx("", {
      sections: [
        {
          markdown: "Section one[^one].\n\n[^one]: First section footnote.",
        },
        {
          markdown: "Section two[^two].\n\n[^two]: Second section footnote.",
        },
      ],
    });
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");

    expect(
      Array.from(
        documentXml.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g),
        (match) => match[1],
      ),
    ).toEqual(["1", "2"]);
    expect(footnotesXml).toContain('<w:footnote w:id="1"');
    expect(footnotesXml).toContain('<w:footnote w:id="2"');
    expect(footnotesXml).toContain("First section footnote.");
    expect(footnotesXml).toContain("Second section footnote.");
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
    const numberingXml = await zip.file("word/numbering.xml")?.async("string");

    expect(documentXml).toContain("<w:numPr>");
    expect(documentXml).toMatch(/<w:numId\s+w:val="\d+"\s*\/>/);
    expect(numberingXml).toBeDefined();
    expect(documentXml).toContain("First bullet");
    expect(documentXml).toContain("Should restart");
  });

  it("preserves a marker when the first list item child is a block", async () => {
    const xml = await render(`- > quoted block`);

    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("quoted block");
  });

  it("does not duplicate markers for split list item content", async () => {
    const xml = await render(`- Before ![mixed image](${ONE_PX_PNG}) after`);

    expect(xml).toContain("Before ");
    expect(xml).toContain(" after");
    expect(xml).toContain("<w:drawing>");
    expect(numberingMarkerCount(xml)).toBe(1);
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

describe("Rendering: chart blocks", () => {
  const chartJson = JSON.stringify({
    type: "bar",
    data: {
      labels: ["Q1", "Q2", "Q3"],
      datasets: [{ label: "Revenue", data: [12, 18, 9] }],
    },
    width: 160,
    height: 90,
    alt: "Revenue chart",
  });

  it("embeds enabled chart fences as DOCX images", async () => {
    const blob = await convertMarkdownToDocx(`\`\`\`chart\n${chartJson}\n\`\`\``, {
      chartRendering: { enabled: true },
    });
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const mediaFiles = mediaFilesFromZip(zip);

    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).not.toContain("Revenue chart");
    expect(mediaFiles).toHaveLength(1);
    expect(mediaFiles[0]).toMatch(/\.png$/);
  });

  it("keeps chart fences as ordinary code blocks when disabled", async () => {
    const blob = await convertMarkdownToDocx(`\`\`\`chart\n${chartJson}\n\`\`\``);
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(documentXml).not.toContain("<w:drawing>");
    expect(documentXml).toContain("chart");
    expect(documentXml).toContain("&quot;bar&quot;");
    expect(mediaFilesFromZip(zip)).toHaveLength(0);
  });

  it("renders invalid chart definitions as clear placeholders by default", async () => {
    const xml = await render(
      "```chart\n{\"type\":\"bar\",\"data\":{\"datasets\":[{\"data\":[\"bad\"]}]}}\n```",
      { chartRendering: { enabled: true } },
    );

    expect(xml).toContain("Chart could not be rendered");
    expect(xml).toContain("finite numbers");
  });

  it("can throw on invalid chart definitions", async () => {
    await expect(
      convertMarkdownToDocx("```chart\n{\"type\":\"scatter\"}\n```", {
        chartRendering: {
          enabled: true,
          invalidDefinitionBehavior: "throw",
        },
      }),
    ).rejects.toThrow(MarkdownConversionError);
  });

  it("uses chart block dimensions for DOCX image sizing", async () => {
    const width = 321;
    const height = 123;
    const sizedChart = JSON.stringify({
      type: "line",
      data: {
        labels: ["A", "B", "C"],
        datasets: [{ data: [1, 3, 2] }],
      },
      width,
      height,
    });

    const blob = await convertMarkdownToDocx(`\`\`\`chartjs\n${sizedChart}\n\`\`\``, {
      chartRendering: { enabled: true },
    });
    const xml = await getDocumentXml(blob);
    const extentMatch = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);

    expect(extentMatch?.[1]).toBe(String(width * 9525));
    expect(extentMatch?.[2]).toBe(String(height * 9525));
  });

  it.each(["pie", "doughnut"] as const)(
    "fills a single-slice %s chart instead of rendering a blank image",
    async (type) => {
      const chart = JSON.stringify({
        type,
        data: {
          labels: ["Only"],
          datasets: [{ data: [1], backgroundColor: ["#E15759"] }],
        },
        width: 96,
        height: 96,
      });

      const blob = await convertMarkdownToDocx(`\`\`\`chart\n${chart}\n\`\`\``, {
        chartRendering: { enabled: true },
      });
      const zip = await getZip(blob);
      const mediaFile = mediaFilesFromZip(zip)[0];
      const pngBytes = await zip.file(mediaFile)!.async("uint8array");

      expect(countNonWhitePixelsInPng(pngBytes)).toBeGreaterThan(100);
    },
  );

  it("fills a full-total doughnut slice in a multi-value chart", async () => {
    const chart = JSON.stringify({
      type: "doughnut",
      data: {
        labels: ["All", "None"],
        datasets: [{ data: [5, 0], backgroundColor: ["#E15759", "#4E79A7"] }],
      },
      width: 96,
      height: 96,
    });

    const blob = await convertMarkdownToDocx(`\`\`\`chart\n${chart}\n\`\`\``, {
      chartRendering: { enabled: true },
    });
    const zip = await getZip(blob);
    const mediaFile = mediaFilesFromZip(zip)[0];
    const pngBytes = await zip.file(mediaFile)!.async("uint8array");

    expect(countNonWhitePixelsInPng(pngBytes)).toBeGreaterThan(100);
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

  it("emits an integer table width that Word 2007 accepts (no percentage form)", async () => {
    const markdown = `| A | B |
|---|---|
| 1 | 2 |`;

    const xml = await render(markdown);

    const match = xml.match(/<w:tblW\b[^>]*\/>/);
    expect(match).not.toBeNull();
    const tblW = match![0];

    // Word 2007 rejects the percentage form (e.g. w:w="100%") as corrupt; the
    // width must be a plain integer. See issue #64.
    expect(tblW).not.toContain("%");
    const wValue = tblW.match(/w:w="([^"]+)"/)?.[1];
    expect(wValue).toBeDefined();
    expect(wValue).toMatch(/^\d+$/);
  });

  it("scales table width to the configured page size and margins", async () => {
    const markdown = `| A | B |
|---|---|
| 1 | 2 |`;

    const xml = await render(markdown, {
      sections: [
        {
          markdown,
          page: {
            size: { width: 12240, height: 15840 },
            margin: { left: 1440, right: 1440 },
          },
        },
      ],
    });

    const wValue = xml.match(/<w:tblW\b[^>]*w:w="([^"]+)"/)?.[1];
    // 12240 (US Letter) - 1440 - 1440 = 9360 twips of usable width.
    expect(wValue).toBe("9360");
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
      p.startsWith("word/media/"),
    );
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it("embeds images inside list items", async () => {
    const markdown = `- ![list image](${ONE_PX_PNG})`;

    const blob = await convertMarkdownToDocx(markdown);
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const mediaFiles = Object.keys(zip.files).filter((p) =>
      p.startsWith("word/media/"),
    );

    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain("<w:numPr>");
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it("embeds images inside blockquotes", async () => {
    const markdown = `> ![quoted image](${ONE_PX_PNG})`;

    const blob = await convertMarkdownToDocx(markdown);
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const mediaFiles = Object.keys(zip.files).filter((p) =>
      p.startsWith("word/media/"),
    );

    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain("<w:pBdr>");
    expect(documentXml).toContain("<w:ind");
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it("preserves images mixed with paragraph text", async () => {
    const markdown = `Before ![mixed image](${ONE_PX_PNG}) after`;

    const blob = await convertMarkdownToDocx(markdown);
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const mediaFiles = Object.keys(zip.files).filter((p) =>
      p.startsWith("word/media/"),
    );

    expect(documentXml).toContain("Before ");
    expect(documentXml).toContain(" after");
    expect(documentXml).toContain("<w:drawing>");
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it("applies maximum image count across top-level and nested images", async () => {
    const markdown = `![one](${ONE_PX_PNG})

- ![two](${ONE_PX_PNG})

> ![three](${ONE_PX_PNG})`;

    const blob = await convertMarkdownToDocx(markdown, {
      imageHandling: { maxImages: 2 },
    });
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const mediaFiles = Object.keys(zip.files).filter((p) =>
      p.startsWith("word/media/"),
    );

    expect(documentXml.match(/<w:drawing>/g)).toHaveLength(2);
    expect(mediaFiles).toHaveLength(2);
    expect(documentXml).toContain("Image could not be loaded");
  });

  it("renders a fallback for invalid nested images", async () => {
    const xml = await render(`> ![broken](not-a-url)`);

    expect(xml).toContain("Image could not be displayed");
    expect(xml).toContain("broken");
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
      xml.lastIndexOf(">Included H2<"),
    );
    expect(xml.indexOf(">Included H3<")).toBeLessThan(
      xml.lastIndexOf(">Included H3<"),
    );
    expect(xml.indexOf(">Hidden H1<")).toBe(xml.lastIndexOf(">Hidden H1<"));
    expect(xml.indexOf(">Hidden H4<")).toBe(xml.lastIndexOf(">Hidden H4<"));
  });
});

describe("Rendering: Node output helpers", () => {
  it("returns valid DOCX bytes as Buffer and ArrayBuffer", async () => {
    const buffer = await convertMarkdownToBuffer("# Buffer helper");
    const arrayBuffer = await convertMarkdownToArrayBuffer(
      "# ArrayBuffer helper",
    );

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

describe("Rendering: HTML comments", () => {
  it("renders the full comment text, not just the first character", async () => {
    const xml = await render(
      "# Title\n\n<!-- COMMENT: hello world this is a note -->\n\nBody."
    );

    expect(xml).toContain("Comment: hello world this is a note");
  });

  it("renders multi-word comments inside blockquotes", async () => {
    const xml = await render(
      "> quoted\n>\n> <!-- COMMENT: reviewer feedback here -->"
    );

    expect(xml).toContain("Comment: reviewer feedback here");
  });

  it("does not treat non-comment HTML containing COMMENT: as a comment", async () => {
    const xml = await render(
      "Before.\n\n<div>COMMENT: just markup text</div>\n\nAfter."
    );

    expect(xml).not.toContain("Comment:");
  });
});

describe("Rendering: image dimension clamping", () => {
  it("clamps oversized dimension hints from URL fragments", async () => {
    const xml = await render(
      `![huge](${ONE_PX_PNG}#99999999999x99999999999)`
    );

    // 10,000 px cap * 9525 EMU/px = 95,250,000.
    const extents = Array.from(
      xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)
    );
    expect(extents.length).toBeGreaterThan(0);
    for (const [, cx, cy] of extents) {
      expect(Number(cx)).toBeLessThanOrEqual(10_000 * 9525);
      expect(Number(cy)).toBeLessThanOrEqual(10_000 * 9525);
    }
  });

  it("keeps reasonable dimension hints intact", async () => {
    const xml = await render(`![sized](${ONE_PX_PNG}#300x150)`);

    expect(xml).toContain(`cx="${300 * 9525}"`);
    expect(xml).toContain(`cy="${150 * 9525}"`);
  });
});

describe("Rendering: error cases", () => {
  it("throws MarkdownConversionError for whitespace-only fontFamily", async () => {
    await expect(
      convertMarkdownToDocx("Hello", {
        style: { fontFamily: "   " },
      }),
    ).rejects.toThrow("Invalid fontFamily");
  });

  it("throws MarkdownConversionError for non-string markdown input", async () => {
    await expect(
      convertMarkdownToDocx(undefined as unknown as string),
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });
});
