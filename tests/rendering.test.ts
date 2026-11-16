import { describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
import {
  convertMarkdownToArrayBuffer,
  convertMarkdownToBuffer,
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../src/index.js";
import type { ConversionWarning, Options } from "../src/types.js";
import type JSZip from "jszip";
import { at, getDocumentXml, getZip, saveBlobForDebug } from "./helpers.js";

// 1x1 transparent PNG used in image tests so the suite doesn't hit the network.
const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";
// Distinct 1x1 PNGs (red, blue): docx stores identical image bytes once, so
// counting media parts needs different images.
const RED_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const BLUE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==";

function documentParagraphCount(xml: string): number {
  return xml.match(/<w:p>/g)?.length || 0;
}

function numberingLevels(xml: string): string[] {
  return Array.from(
    xml.matchAll(
      /<w:numPr>[\s\S]*?<w:ilvl w:val="(\d+)"\/>[\s\S]*?<\/w:numPr>/g,
    ),
    (match) => at(match, 1),
  );
}

function numberingMarkerCount(xml: string): number {
  return xml.match(/<w:numPr>/g)?.length || 0;
}

function horizontalRuleCount(xml: string): number {
  return xml.match(/<w:bottom\b/g)?.length || 0;
}

function mediaFilesFromZip(zip: Awaited<ReturnType<typeof getZip>>): string[] {
  return Object.entries(zip.files)
    .filter(([p, file]) => p.startsWith("word/media/") && !file.dir)
    .map(([p]) => p);
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((at(bytes, offset) << 24) |
      (at(bytes, offset + 1) << 16) |
      (at(bytes, offset + 2) << 8) |
      at(bytes, offset + 3)) >>>
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
      at(bytes, offset + 4),
      at(bytes, offset + 5),
      at(bytes, offset + 6),
      at(bytes, offset + 7),
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

  it.each([
    {
      name: "a matrix",
      markdown:
        "$$\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n$$",
      expected: [
        '<m:begChr m:val="("/>',
        "<m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e><m:e><m:r><m:t>2</m:t></m:r></m:e></m:mr>",
        "<m:mr><m:e><m:r><m:t>3</m:t></m:r></m:e><m:e><m:r><m:t>4</m:t></m:r></m:e></m:mr>",
      ],
    },
    {
      name: "a cases environment",
      markdown:
        "$$\n|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}\n$$",
      expected: [
        '<m:begChr m:val="{"/><m:endChr m:val=""/>',
        "<m:mr><m:e><m:r><m:t>x</m:t></m:r></m:e><m:e><m:r><m:t>x≥0</m:t></m:r></m:e></m:mr>",
      ],
    },
    {
      name: "a fraction without braces",
      markdown: "$$\n\\frac12\n$$",
      expected: [
        "<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>",
      ],
    },
    {
      name: "an inline root with a degree",
      markdown: "The cube root $\\sqrt[3]{x}$ is inline.",
      expected: [
        "<m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e>",
        "The cube root ",
        " is inline.",
      ],
    },
    {
      // latexToMath rejects \*, so the TeX subset renders it.
      name: "an escaped character only the subset parser reads",
      markdown: "Product $a\\*b$ here.",
      expected: ["<m:t>a</m:t>", "<m:t>*</m:t>", "<m:t>b</m:t>"],
    },
  ])("renders $name as native Word math", async ({ markdown, expected }) => {
    const warnings: ConversionWarning[] = [];
    const xml = await render(markdown, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(warnings).toEqual([]);
    expect(mathObjectCount(xml)).toBe(1);
    expect(xml).not.toContain("$");
    for (const fragment of expected) {
      expect(xml).toContain(fragment);
    }
  });

  it("falls back to literal text and warns when no engine reads the TeX", async () => {
    const warnings: ConversionWarning[] = [];
    const xml = await render("Unsupported $\\unknowncmd{x}$ stays literal.", {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(mathObjectCount(xml)).toBe(0);
    expect(xml).toContain("$\\unknowncmd{x}$");
    expect(warnings).toEqual([
      {
        code: "UNSUPPORTED_MATH",
        message: "Unsupported command \\unknowncmd",
        source: "\\unknowncmd{x}",
      },
    ]);
  });

  it("throws for TeX no engine reads when configured", async () => {
    await expect(
      convertMarkdownToDocx("Unsupported $\\unknowncmd{x}$", {
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

  it("links an image inside a footnote to its media part", async () => {
    const zip = await getZip(
      await convertMarkdownToDocx(`Note[^img].\n\n[^img]: Pixel ![p](${ONE_PX_PNG})`),
    );
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");
    const footnoteRels =
      (await zip.file("word/_rels/footnotes.xml.rels")?.async("string")) ?? "";

    const embed = /r:embed="([^"]+)"/.exec(footnotesXml)?.[1];
    expect(embed).toBeDefined();
    const target = new RegExp(`Id="${String(embed)}"[^>]*Target="([^"]+)"`).exec(
      footnoteRels,
    )?.[1];
    expect(target).toMatch(/^media\//);
    expect(zip.file(`word/${String(target)}`)).not.toBeNull();
  });

  it("renders repeated footnote references as valid NOTEREF fields", async () => {
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
    ).toEqual(["1", "2"]);
    expect(documentXml).toContain('w:name="mdfootnote_1"');
    expect(documentXml).toContain(
      'w:instr=" NOTEREF mdfootnote_1 \\h \\f "',
    );
    expect(footnotesXml.indexOf('w:id="1"')).toBeLessThan(
      footnotesXml.indexOf('w:id="2"'),
    );
    expect(footnotesXml.indexOf("Alpha body.")).toBeLessThan(
      footnotesXml.indexOf("Beta body."),
    );
  });

  it("renders footnotes as decimal endnotes, keeping NOTEREF repeats, links, images and lists", async () => {
    const zip = await getZip(
      await convertMarkdownToDocx(
        `First[^alpha], second[^beta], first again[^alpha].\n\n[^beta]: Beta body.\n[^alpha]: Alpha [link](https://example.com/en) ![p](${ONE_PX_PNG})\n\n    1. Listed`,
        { footnotes: { placement: "endnotes" } },
      ),
    );
    const part = async (name: string) =>
      (await zip.file(name)?.async("string")) ?? "";
    const documentXml = await part("word/document.xml");
    const endnotesXml = await part("word/endnotes.xml");
    const endnoteRels = await part("word/_rels/endnotes.xml.rels");

    expect(documentXml).not.toContain("<w:footnoteReference");
    expect(
      Array.from(
        documentXml.matchAll(/<w:endnoteReference w:id="(\d+)"\/>/g),
        (match) => match[1],
      ),
    ).toEqual(["1", "2"]);
    expect(documentXml).toContain('w:name="mdfootnote_1"');
    expect(documentXml).toContain(
      'w:instr=" NOTEREF mdfootnote_1 \\h \\f "',
    );
    expect(documentXml).toContain(
      '<w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr>',
    );
    expect(await part("word/footnotes.xml")).not.toContain("Alpha");
    expect(endnotesXml.indexOf("Alpha ")).toBeLessThan(
      endnotesXml.indexOf("Beta body."),
    );
    expect(endnoteRels).toContain("https://example.com/en");
    const embed = /r:embed="([^"]+)"/.exec(endnotesXml)?.[1];
    const target = new RegExp(`Id="${String(embed)}"[^>]*Target="([^"]+)"`).exec(
      endnoteRels,
    )?.[1];
    expect(zip.file(`word/${String(target)}`)).not.toBeNull();
    expect(endnotesXml).toMatch(/<w:numId w:val="\d+"\/>/);
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

  it("renders checked, unchecked, and nested GFM task items", async () => {
    const xml = await render(`- [ ] Pending **bold** work
- [x] Done *today*
- [X] Uppercase checked
  - [ ] Nested \`code\` task`);

    expect(xml.match(/☐/g)).toHaveLength(2);
    expect(xml.match(/☒/g)).toHaveLength(2);
    expect(xml).toContain("Pending ");
    expect(xml).toContain("Nested ");
    expect(xml).toContain(" task");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain('<w:shd w:fill="F5F5F5" w:val="clear"/>');
    expect(numberingLevels(xml)).toEqual(["0", "0", "0", "1"]);
  });

  it("keeps a task marker and standalone image in the same list paragraph", async () => {
    const xml = await render(`- [ ] ![task image](${ONE_PX_PNG})`);
    const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
    const taskImageParagraph = paragraphs.find(
      (paragraph) => paragraph.includes("☐") && paragraph.includes("<w:drawing>"),
    );

    expect(taskImageParagraph).toBeDefined();
    expect(taskImageParagraph).toContain("<w:numPr>");
    expect(taskImageParagraph).toContain('<w:jc w:val="left"/>');
    expect(numberingMarkerCount(xml)).toBe(1);
  });

  it("renders task boxes as Word checkbox content controls that keep their state", async () => {
    const markdown = `- [ ] Open\n- [x] Done\n  - [ ] ![task image](${ONE_PX_PNG})`;
    const xml = await render(markdown, {
      taskLists: { checkboxes: "content-control" },
    });
    const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

    expect(
      Array.from(xml.matchAll(/<w14:checked w14:val="([01])"\/>/g), (m) => m[1]),
    ).toEqual(["0", "1", "0"]);
    expect(
      Array.from(xml.matchAll(/<w:sym w:char="(\w+)"/g), (m) => m[1]),
    ).toEqual(["2610", "2612", "2610"]);
    expect(xml).not.toMatch(/[☐☒]/);
    expect(
      paragraphs.find((paragraph) => paragraph.includes("<w:drawing>")),
    ).toContain("<w14:checkbox>");
    expect(numberingMarkerCount(xml)).toBe(3);
    expect(
      await render(markdown, { taskLists: { checkboxes: "text" } }),
    ).toBe(await render(markdown));
  });

  it("keeps ordinary ordered and unordered list rendering unchanged", async () => {
    const xml = await render(`- ordinary bullet
- **formatted** bullet

1. ordinary number
2. second number`);

    expect(xml).not.toContain("☐");
    expect(xml).not.toContain("☒");
    expect(xml).toContain("ordinary bullet");
    expect(xml).toContain("ordinary number");
    expect(xml).toContain("<w:b/>");
    expect(numberingMarkerCount(xml)).toBe(4);
  });
});

describe("Rendering: thematic breaks", () => {
  it.each(["---", "***", "___"])(
    "renders %s as a native Word horizontal rule",
    async (marker) => {
      const xml = await render(`Before\n\n${marker}\n\nAfter`);

      expect(horizontalRuleCount(xml)).toBe(1);
      expect(xml).toMatch(
        /<w:bottom w:val="single" w:color="A6A6A6" w:sz="6" w:space="1"\/>/,
      );
      expect(xml).toContain("Before");
      expect(xml).toContain("After");
    },
  );

  it("renders thematic breaks inside blockquotes and list items", async () => {
    const xml = await render(`> Quoted before
>
> ***
>
> Quoted after

- List item

  ___`);

    expect(horizontalRuleCount(xml)).toBe(2);
    expect(xml).toMatch(
      /<w:pBdr><w:left\b[^>]*\/><w:bottom\b[^>]*\/><\/w:pBdr>/,
    );
    expect(xml).toContain('<w:ind w:left="720"/>');
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
    expect(documentXml).toContain('descr="Revenue chart"');
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

  it.each(["image", "native"] as const)(
    "renders invalid chart definitions as clear placeholders by default (%s)",
    async (output) => {
      const zip = await getZip(
        await convertMarkdownToDocx(
          "```chart\n{\"type\":\"bar\",\"data\":{\"datasets\":[{\"data\":[\"bad\"]}]}}\n```\n\n" +
            "```chart\n{\"type\":\"pie\",\"data\":{\"datasets\":[{\"data\":[0,-2]}]}}\n```",
          { chartRendering: { enabled: true, output } },
        ),
      );
      const xml = await zip.file("word/document.xml")!.async("string");

      expect(xml).toContain("Chart could not be rendered");
      expect(xml).toContain("finite numbers");
      expect(xml).toContain("positive total");
      expect(Object.keys(zip.files).filter((name) => /^word\/(media|charts)\//.test(name))).toEqual([]);
    },
  );

  it.each(["image", "native"] as const)(
    "can throw on invalid chart definitions (%s)",
    async (output) => {
      await expect(
        convertMarkdownToDocx("```chart\n{\"type\":\"scatter\"}\n```", {
          chartRendering: {
            enabled: true,
            output,
            invalidDefinitionBehavior: "throw",
          },
        }),
      ).rejects.toThrow(MarkdownConversionError);
    },
  );

  it("rejects an unknown chartRendering.output", async () => {
    await expect(
      convertMarkdownToDocx("```chart\n{}\n```", {
        chartRendering: { enabled: true, output: "svg" as unknown as "image" },
      }),
    ).rejects.toThrow("Invalid chartRendering.output: must be image or native");
  });

  it.each([
    {
      type: "bar",
      element: "c:barChart",
      datasets: [
        { label: "Revenue", data: [12, 18, 9], backgroundColor: ["#4E79A7", "#F28E2B", "#E15759"] },
        { label: "Cost", data: [5, 7, 4], backgroundColor: "#76B7B2" },
      ],
      values: ["12", "18", "9", "5", "7", "4"],
      colors: ["4E79A7", "F28E2B", "E15759", "76B7B2"],
    },
    {
      type: "line",
      element: "c:lineChart",
      datasets: [{ label: "Visitors", data: [3, 1.5, 4], borderColor: "#59A14F" }],
      values: ["3", "1.5", "4"],
      colors: ["59A14F"],
    },
    {
      type: "pie",
      element: "c:pieChart",
      datasets: [{ label: "Share", data: [50, 30, 20], backgroundColor: ["#EDC948", "#B07AA1", "#FF9DA7"] }],
      values: ["50", "30", "20"],
      colors: ["EDC948", "B07AA1", "FF9DA7"],
    },
    {
      type: "doughnut",
      element: "c:doughnutChart",
      datasets: [{ label: "Share", data: [2, 6, 2], backgroundColor: "#9C755F" }],
      values: ["2", "6", "2"],
      colors: ["9C755F"],
    },
  ])("renders a $type chart as a native Word chart", async ({ type, element, datasets, values, colors }) => {
    const definition = JSON.stringify({
      type,
      data: { labels: ["Q1", "Q2", "Q3"], datasets },
      width: 480,
      height: 270,
      alt: `${type} chart`,
    });
    const blob = await convertMarkdownToDocx(`\`\`\`chart\n${definition}\n\`\`\``, {
      chartRendering: { enabled: true, output: "native" },
    });
    await saveBlobForDebug(blob, `native-${type}-chart.docx`);
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    const chartXml = await zip.file("word/charts/chart1.xml")!.async("string");
    const chartRelationships = await zip.file("word/charts/_rels/chart1.xml.rels")!.async("string");

    expect(mediaFilesFromZip(zip)).toEqual([]);
    expect(documentXml).toContain('uri="http://schemas.openxmlformats.org/drawingml/2006/chart"');
    expect(documentXml).toContain(`<wp:extent cx="${480 * 9525}" cy="${270 * 9525}"/>`);
    const chartRelId = /<c:chart [^>]*r:id="([^"]+)"/.exec(documentXml)?.[1];
    expect(relationships).toContain(
      `<Relationship Id="${String(chartRelId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>`,
    );
    expect(contentTypes).toContain(
      '<Override ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml" PartName="/word/charts/chart1.xml"/>',
    );
    expect(contentTypes).toContain('PartName="/word/embeddings/Microsoft_Excel_Worksheet1.xlsx"');
    expect(chartRelationships).toContain('Target="../embeddings/Microsoft_Excel_Worksheet1.xlsx"');
    expect(zip.file("word/embeddings/Microsoft_Excel_Worksheet1.xlsx")).not.toBeNull();
    expect(chartXml).toContain(`<${element}>`);
    for (const label of ["Q1", "Q2", "Q3", datasets[0]!.label]) {
      expect(chartXml).toContain(`<c:v>${label}</c:v>`);
    }
    for (const value of values) expect(chartXml).toContain(`<c:v>${value}</c:v>`);
    for (const color of colors) expect(chartXml).toContain(`<a:srgbClr val="${color}"/>`);
  });

  it("writes byte-identical native chart parts for the same input", async () => {
    const markdown = `\`\`\`chart\n${chartJson}\n\`\`\`\n\n\`\`\`chart\n${chartJson}\n\`\`\``;
    const options: Options = { chartRendering: { enabled: true, output: "native" } };
    const first = await getZip(await convertMarkdownToDocx(markdown, options));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const second = await getZip(await convertMarkdownToDocx(markdown, options));
    const wordParts = (zip: JSZip) =>
      Object.values(zip.files)
        .filter((file) => !file.dir && file.name.startsWith("word/"))
        .map((file) => file.name)
        .sort();
    const parts = wordParts(first);

    expect(parts).toContain("word/charts/chart2.xml");
    expect(wordParts(second)).toEqual(parts);
    for (const part of parts) {
      expect(await second.file(part)!.async("base64"), part).toBe(await first.file(part)!.async("base64"));
    }
  });

  it("lets a custom renderer win over native output", async () => {
    const renderer = vi.fn(() => ONE_PX_PNG);
    const zip = await getZip(
      await convertMarkdownToDocx(`\`\`\`chart\n${chartJson}\n\`\`\``, {
        chartRendering: { enabled: true, output: "native", renderer },
      }),
    );

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(mediaFilesFromZip(zip)).toHaveLength(1);
    expect(Object.keys(zip.files).filter((name) => name.startsWith("word/charts/"))).toEqual([]);
  });

  it("charges native charts to the maxImages budget", async () => {
    const zip = await getZip(
      await convertMarkdownToDocx(
        `![First](${ONE_PX_PNG})\n\n\`\`\`chart\n${chartJson}\n\`\`\``,
        {
          chartRendering: { enabled: true, output: "native" },
          imageHandling: { maxImages: 1 },
        },
      ),
    );
    const xml = await zip.file("word/document.xml")!.async("string");

    expect(xml).toContain("Chart could not be loaded: image limit reached");
    expect(zip.file("word/charts/chart1.xml")).toBeNull();
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
      const mediaFile = at(mediaFilesFromZip(zip), 0);
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
    const mediaFile = at(mediaFilesFromZip(zip), 0);
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

- ![two](${RED_PX_PNG})

> ![three](${BLUE_PX_PNG})`;

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

  it.each([
    {
      label: "an unknown footnote placement",
      options: { footnotes: { placement: "sidenotes" } },
      expected: "Invalid footnotes.placement: Must be footnotes or endnotes",
    },
    {
      label: "footnotes that are not an object",
      options: { footnotes: "endnotes" },
      expected: "Invalid footnotes: Must be an object",
    },
    {
      label: "an unknown task checkbox style",
      options: { taskLists: { checkboxes: "box" } },
      expected:
        "Invalid taskLists.checkboxes: Must be text or content-control",
    },
    {
      label: "taskLists that are not an object",
      options: { taskLists: ["content-control"] },
      expected: "Invalid taskLists: Must be an object",
    },
    {
      label: "a watermark that is not an object",
      options: { watermark: "DRAFT" },
      expected: "Invalid watermark: Must be an object",
    },
    {
      label: "a watermark without text",
      options: { watermark: { color: "FF0000" } },
      expected: "watermark.text must be a string",
    },
    {
      label: "blank watermark text",
      options: { watermark: { text: "  " } },
      expected: "watermark.text must not be blank",
    },
    {
      label: "watermark text over 100 characters",
      options: { watermark: { text: "x".repeat(101) } },
      expected: "watermark.text exceeds the maximum length of 100 characters",
    },
    {
      label: "a named watermark colour",
      options: { watermark: { text: "DRAFT", color: "red" } },
      expected: "Invalid watermark.color: Must be a 6-character hex color",
    },
    {
      label: "a watermark opacity above 1",
      options: { watermark: { text: "DRAFT", opacity: 2 } },
      expected: "Invalid watermark.opacity: Must be a number from 0 to 1",
    },
    {
      label: "an unknown watermark layout",
      options: { watermark: { text: "DRAFT", layout: "vertical" } },
      expected: "Invalid watermark.layout: Must be diagonal or horizontal",
    },

  ])("rejects $label", async ({ options, expected }) => {
    // Plain-JS and JSON callers can pass any shape.
    const untyped: object = options;
    await expect(convertMarkdownToDocx("Hello", untyped)).rejects.toThrow(
      expected,
    );
  });

  it("throws MarkdownConversionError for non-string markdown input", async () => {
    await expect(
      convertMarkdownToDocx(undefined as unknown as string),
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });
});

describe("Rendering: stable IDs", () => {
  it("numbers bookmarks and drawings the same way on every conversion", async () => {
    const markdown = `# One

![a](${ONE_PX_PNG}) text[^n]

## Two

![b](${RED_PX_PNG})

[^n]: Note with ![c](${BLUE_PX_PNG})`;
    const parts = async () => {
      const zip = await getZip(await convertMarkdownToDocx(markdown));
      return Promise.all(
        ["word/document.xml", "word/footnotes.xml"].map((part) =>
          zip.file(part)!.async("string"),
        ),
      );
    };

    const first = await parts();
    expect(await parts()).toEqual(first);

    const xml = first.join("");
    const ids = (pattern: RegExp) =>
      Array.from(xml.matchAll(pattern), (match) => match[1]);
    const starts = ids(/<w:bookmarkStart\b[^>]*\bw:id="(\d+)"/g);
    const ends = ids(/<w:bookmarkEnd\b[^>]*\bw:id="(\d+)"/g);
    expect(starts.length).toBeGreaterThan(2);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...ends].sort()).toEqual([...starts].sort());
    expect(ids(/<wp:docPr\b[^>]*\bid="(\d+)"/g)).toEqual(["1", "2", "3"]);
  });

  it("gives hyperlink relationships the same IDs on every conversion", async () => {
    const markdown =
      "See [one](https://example.com/1) and [two](https://example.com/2)[^n].\n\n[^n]: Also [three](https://example.com/3).";
    const parts = async () => {
      const zip = await getZip(await convertMarkdownToDocx(markdown));
      return Promise.all(
        [
          "word/document.xml",
          "word/_rels/document.xml.rels",
          "word/footnotes.xml",
          "word/_rels/footnotes.xml.rels",
        ].map((part) => zip.file(part)!.async("string")),
      );
    };

    const first = await parts();
    expect(await parts()).toEqual(first);
    const [documentXml = "", documentRels = ""] = first;
    for (const match of documentXml.matchAll(/<w:hyperlink\b[^>]*\br:id="([^"]+)"/g)) {
      expect(documentRels).toContain(`Id="${String(match[1])}"`);
    }
  });
});
