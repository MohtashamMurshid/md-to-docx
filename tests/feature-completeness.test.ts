import { describe, expect, it, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Bookmark,
  FootnoteReferenceRun,
} from "docx";
import { DOMParser } from "@xmldom/xmldom";
import {
  convertMarkdownToBuffer,
  parseToDocxOptions,
  patchMarkdownInDocxToBuffer,
  type ConversionWarning,
} from "../src/index.js";
import { runCli } from "../src/cli.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
async function unpack(bytes: Buffer): Promise<{ zip: JSZip; text: string }> {
  const zip = await JSZip.loadAsync(bytes);
  return { zip, text: await zip.file("word/document.xml")!.async("string") };
}
const dirs: string[] = [];
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "md-features-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});

describe("Markdown fidelity", () => {
  it("preserves full, collapsed and shortcut reference links and images", async () => {
    const { zip, text } = await unpack(
      await convertMarkdownToBuffer(
        `A [Full][ref], [ref][], [ref].\n\n![Pixel][pic]\n\n[ref]: https://example.com\n[pic]: ${PNG}`,
      ),
    );
    expect(text).toContain("Full");
    expect(text.match(/<w:hyperlink /g)).toHaveLength(3);
    expect(text).toContain("<w:drawing>");
    expect(
      await zip.file("word/_rels/document.xml.rels")!.async("string"),
    ).toContain('Target="https://example.com"');
  });
  it("preserves zero and non-one starts at nested levels", async () => {
    const options = await parseToDocxOptions(
      "5. outer\n\n   3. inner\n\nEnd.\n\n0. zero",
    );
    expect(
      options.numbering!.config.map((item) => item.levels[0].start),
    ).toEqual([5, 3, 0]);
    expect(options.numbering!.config[1].levels[1]).toMatchObject({
      level: 1,
      start: 3,
      text: "%2.",
    });
  });
  it("resolves forward, duplicate, Unicode and cross-section heading links", async () => {
    const { text } = await unpack(
      await convertMarkdownToBuffer("", {
        sections: [
          { markdown: "[Next](#重复)\n\n[Duplicate](#alpha-1)\n\n# Alpha" },
          { markdown: "# 重复\n\n# Alpha" },
        ],
      }),
    );
    const parsed = new DOMParser().parseFromString(text, "application/xml");
    const names = new Set(
      Array.from(parsed.getElementsByTagNameNS(W, "bookmarkStart"), (el) =>
        el.getAttributeNS(W, "name"),
      ),
    );
    for (const link of Array.from(
      parsed.getElementsByTagNameNS(W, "hyperlink"),
    ))
      expect(names.has(link.getAttributeNS(W, "anchor"))).toBe(true);
    expect(names.size).toBe(3);
  });
  it("resolves header and footer links to body headings across sections", async () => {
    const warnings: ConversionWarning[] = [];
    const { zip, text } = await unpack(
      await convertMarkdownToBuffer("", {
        sections: [
          { markdown: "# Body" },
          { markdown: "# Body\n\n# 重复" },
        ],
        template: {
          headers: { default: { markdown: "[Next](#body-1)" } },
          footers: {
            default: { markdown: "[Unicode](#%E9%87%8D%E5%A4%8D)" },
          },
        },
        onWarning: (warning) => warnings.push(warning),
      }),
    );
    const parser = new DOMParser();
    const document = parser.parseFromString(text, "application/xml");
    const bookmarks = Array.from(
      document.getElementsByTagNameNS(W, "bookmarkStart"),
      (node) => node.getAttributeNS(W, "name"),
    );
    const slots = Object.keys(zip.files).filter((name) =>
      /^word\/(header|footer)\d+\.xml$/.test(name),
    );
    expect(slots).toHaveLength(4);
    for (const part of slots) {
      const slot = parser.parseFromString(
        await zip.file(part)!.async("string"),
        "application/xml",
      );
      const links = Array.from(slot.getElementsByTagNameNS(W, "hyperlink"));
      expect(links).toHaveLength(1);
      expect(links[0].getAttributeNS(W, "anchor")).toBe(
        bookmarks[part.includes("header") ? 1 : 2],
      );
    }
    expect(warnings).toHaveLength(0);
  });
  it("emits native TOC fields, cached links, page references and leader tabs", async () => {
    const { zip, text } = await unpack(
      await convertMarkdownToBuffer("[TOC]\n\n# One\n\n## Two"),
    );
    expect(text).toContain('w:fldCharType="begin"');
    expect(text).toContain('w:fldCharType="separate"');
    expect(text).toContain('w:fldCharType="end"');
    expect(text).toContain(" TOC ");
    expect(text).toContain(" PAGEREF ");
    expect(text).toContain('w:leader="dot"');
    expect(text).toContain("<w:tab/>");
    expect(await zip.file("word/settings.xml")!.async("string")).toContain(
      "updateFields",
    );
    const legacy = await unpack(
      await convertMarkdownToBuffer("[TOC]\n\n# One", {
        toc: { mode: "links" },
      }),
    );
    expect(legacy.text).not.toContain(" PAGEREF ");
  });
});

describe("Images and diagnostics", () => {
  it("renders local files and reports path escapes, including symlinks", async () => {
    const dir = await temp();
    const outside = await temp();
    await fs.writeFile(
      path.join(dir, "pixel.png"),
      Buffer.from(PNG.split(",")[1], "base64"),
    );
    await fs.writeFile(
      path.join(outside, "secret.png"),
      Buffer.from(PNG.split(",")[1], "base64"),
    );
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(dir, "escape.png"),
    );
    const warnings: ConversionWarning[] = [];
    const { text } = await unpack(
      await convertMarkdownToBuffer(
        "![Pixel](pixel.png)\n\n![Escape](escape.png)",
        {
          imageHandling: { baseDirectory: dir },
          onWarning: (w) => warnings.push(w),
        },
      ),
    );
    expect(text.match(/<w:drawing>/g)).toHaveLength(1);
    expect(warnings).toEqual([
      expect.objectContaining({ code: "IMAGE_FALLBACK", source: "escape.png" }),
    ]);
    expect(warnings[0].message).toContain("escapes");
  });
  it("resolves trusted browser/virtual assets and preserves inline placement", async () => {
    const warnings: ConversionWarning[] = [];
    const { text } = await unpack(
      await convertMarkdownToBuffer("Before ![Pixel](asset:pixel) after.", {
        imageHandling: {
          resolve: (source) =>
            source === "asset:pixel"
              ? { data: Buffer.from(PNG.split(",")[1], "base64") }
              : null,
        },
        onWarning: (warning) => warnings.push(warning),
      }),
    );
    const parsed = new DOMParser().parseFromString(text, "application/xml");
    const paragraphs = Array.from(parsed.getElementsByTagNameNS(W, "p"));
    expect(
      paragraphs.some(
        (p) =>
          p.textContent?.includes("Before ") &&
          p.textContent?.includes(" after.") &&
          p.getElementsByTagNameNS(W, "drawing").length === 1,
      ),
    ).toBe(true);
    expect(warnings).toHaveLength(0);
  });
  it("converts SVG and WebP to Word-compatible PNGs", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>',
    );
    const webp = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "blue" },
    })
      .webp()
      .toBuffer();
    const { zip, text } = await unpack(
      await convertMarkdownToBuffer("![Vector](svg)\n\n![Web](webp)", {
        imageHandling: {
          resolve: (source) => ({ data: source === "svg" ? svg : webp }),
        },
      }),
    );
    expect(text.match(/<w:drawing>/g)).toHaveLength(2);
    const media = Object.keys(zip.files).filter((name) =>
      /^word\/media\/.+\.png$/.test(name),
    );
    expect(media).toHaveLength(2);
    for (const file of media)
      expect(
        (await sharp(await zip.file(file)!.async("nodebuffer")).metadata())
          .format,
      ).toBe("png");
  });
  it("rejects active SVG and keeps an actionable warning", async () => {
    const warnings: ConversionWarning[] = [];
    const { text } = await unpack(
      await convertMarkdownToBuffer("![Bad](bad.svg)", {
        imageHandling: {
          resolve: () => ({
            data: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
            ),
          }),
        },
        onWarning: (warning) => warnings.push(warning),
      }),
    );
    expect(text).not.toContain("<w:drawing>");
    expect(warnings[0].message).toContain("SVG");
  });
  it("shares image limits across inline content and rich headers", async () => {
    const warnings: ConversionWarning[] = [];
    const { zip, text } = await unpack(
      await convertMarkdownToBuffer(`A ![Body](${PNG}) B`, {
        imageHandling: { maxImages: 1 },
        template: { headers: { default: { markdown: `![Header](${PNG})` } } },
        onWarning: (w) => warnings.push(w),
      }),
    );
    expect(text).toContain("<w:drawing>");
    expect(await zip.file("word/header1.xml")!.async("string")).not.toContain(
      "<w:drawing>",
    );
    expect(warnings.some((w) => w.code === "IMAGE_FALLBACK")).toBe(true);
  });
  it("reports unsupported math and missing anchors", async () => {
    const warnings: ConversionWarning[] = [];
    await convertMarkdownToBuffer("$\\unsupported{x}$ [Missing](#missing)", {
      onWarning: (w) => warnings.push(w),
    });
    expect(new Set(warnings.map((w) => w.code))).toEqual(
      new Set(["UNSUPPORTED_MATH", "UNRESOLVED_LINK"]),
    );
  });
});

describe("Rich document layout", () => {
  it("renders merged cells, lists and images with explicit widths and row controls", async () => {
    const definition = {
      columnWidths: [2000, 4000],
      headers: ["Name", "Content"],
      rows: [
        [
          { markdown: "Merged **row**", rowSpan: 2 },
          { markdown: `1. First\n2. Second\n\n![Cell](${PNG})` },
        ],
        ["Second row"],
        [{ markdown: "Spans both", columnSpan: 2 }],
      ],
    };
    const { text } = await unpack(
      await convertMarkdownToBuffer(
        "```table\n" + JSON.stringify(definition) + "\n```",
        {
          style: {
            tableAllowRowSplit: false,
            tableHeaderBackground: "ABCDEF",
            tableCellMargins: { left: 160 },
          },
        },
      ),
    );
    expect(text).toContain('w:gridSpan w:val="2"');
    expect(text).toContain('w:vMerge w:val="restart"');
    expect(text).toContain('w:vMerge w:val="continue"');
    expect(text).toContain('w:gridCol w:w="2000"');
    expect(text).toContain('w:fill="ABCDEF"');
    expect(text).toContain("<w:cantSplit/>");
    expect(text).toContain("<w:drawing>");
    expect(text).toContain("<w:numPr>");
  });
  it("supports GFM cells containing inline images and missing trailing cells", async () => {
    const { text } = await unpack(
      await convertMarkdownToBuffer(
        `| A | B |\n|---|---|\n| ![Pixel](${PNG}) |\n`,
        { style: { tableColumnWidths: [1000, 3000] } },
      ),
    );
    expect(text).toContain("<w:drawing>");
    expect(text).toContain('w:gridCol w:w="3000"');
  });
  it("counts expanded rich cell content against the AST budget", async () => {
    await expect(
      convertMarkdownToBuffer(
        "```table\n" +
          JSON.stringify({ rows: [["# One\n\nTwo\n\nThree"]] }) +
          "\n```",
        { maxElements: 5 },
      ),
    ).rejects.toThrow("maxElements");
  });
  it("rejects invalid/overlapping spans and mismatched widths", async () => {
    await expect(
      convertMarkdownToBuffer(
        '```table\n{"rows":[[{"markdown":"A","rowSpan":3}]]}\n```',
      ),
    ).rejects.toThrow("bounds");
    await expect(
      convertMarkdownToBuffer("| A | B |\n|---|---|\n| a | b |", {
        style: { tableColumnWidths: [1000] },
      }),
    ).rejects.toThrow("column count");
  });
  it("renders header Markdown tables and logos alongside footer fields", async () => {
    const { zip } = await unpack(
      await convertMarkdownToBuffer("# Body", {
        template: {
          headers: {
            default: {
              markdown: `**Company**\n\n![Logo](${PNG})\n\n| A | B |\n|---|---|\n| a | b |`,
            },
          },
          footers: {
            default: {
              markdown: "*Confidential*",
              pageNumberDisplay: "currentAndTotal",
            },
          },
        },
      }),
    );
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(header).toContain("<w:b/>");
    expect(header).toContain("<w:drawing>");
    expect(header).toContain("<w:tbl>");
    expect(footer).toContain("Confidential");
    expect(footer).toContain("NUMPAGES");
  });
});

describe("CLI workflows", () => {
  it("pipes input and binary output without mixing status messages", async () => {
    const logs: string[] = [];
    const bytes: Buffer[] = [];
    const code = await runCli(["-", "-"], {
      log: (m) => logs.push(m),
      error: () => {},
      readStdin: async () => "# Piped",
      writeStdout: async (buffer) => {
        bytes.push(buffer);
      },
    });
    expect(code).toBe(0);
    expect(logs).toHaveLength(0);
    expect((await unpack(bytes[0])).text).toContain("Piped");
  });
  it("converts nested batches and resolves images relative to each input", async () => {
    const dir = await temp();
    await fs.mkdir(path.join(dir, "input", "nested"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "input", "nested", "pixel.png"),
      Buffer.from(PNG.split(",")[1], "base64"),
    );
    await fs.writeFile(
      path.join(dir, "input", "nested", "one.md"),
      "![Pixel](pixel.png)",
    );
    await fs.writeFile(path.join(dir, "input", "two.md"), "# Two");
    expect(
      await runCli(
        ["--batch", path.join(dir, "input"), path.join(dir, "output")],
        { log: () => {}, error: () => {} },
      ),
    ).toBe(0);
    expect(
      (
        await unpack(
          await fs.readFile(path.join(dir, "output", "nested", "one.docx")),
        )
      ).text,
    ).toContain("<w:drawing>");
    expect(
      (await unpack(await fs.readFile(path.join(dir, "output", "two.docx"))))
        .text,
    ).toContain("Two");
  });
  it("exposes both reference APIs through flags", async () => {
    const dir = await temp();
    const reference = path.resolve("tests/fixtures/reference-template.docx");
    const md = path.join(dir, "input.md");
    const out = path.join(dir, "out.docx");
    const patches = path.join(dir, "patches.json");
    await fs.writeFile(md, "# Styled");
    await fs.writeFile(patches, JSON.stringify({ body: "# Inserted" }));
    const errors: string[] = [];
    const output = { log: () => {}, error: (m: string) => errors.push(m) };
    expect(await runCli([md, out, "--reference", reference], output)).toBe(0);
    expect((await unpack(await fs.readFile(out))).text).toContain("Styled");
    expect(await runCli([reference, out, "--patches", patches], output)).toBe(
      0,
    );
    expect((await unpack(await fs.readFile(out))).text).toContain("Inserted");
    expect(errors).toHaveLength(0);
  });
  it("rebuilds on edits and releases watchers when aborted", async () => {
    const dir = await temp();
    const md = path.join(dir, "input.md");
    const out = path.join(dir, "output.docx");
    await fs.writeFile(md, "# Before");
    const controller = new AbortController();
    let watched!: () => void;
    const ready = new Promise<void>((resolve) => {
      watched = resolve;
    });
    let rebuilt!: () => void;
    const changed = new Promise<void>((resolve) => {
      rebuilt = resolve;
    });
    let writes = 0;
    const running = runCli(
      [md, out, "--watch"],
      {
        log: (message) => {
          if (message.includes("Watching")) watched();
          if (message.includes("created") && ++writes === 2) rebuilt();
        },
        error: () => {},
      },
      controller.signal,
    );
    try {
      await ready;
      await fs.writeFile(md, "# After");
      await changed;
      expect((await unpack(await fs.readFile(out))).text).toContain("After");
    } finally {
      controller.abort();
      await running;
    }
  });
});

describe("Patch package integration", () => {
  it("preserves existing footnotes and imports new footnotes, media, numbering and cross-references", async () => {
    const reference = await Packer.toBuffer(
      new Document({
        footnotes: { 1: { children: [new Paragraph("Existing note")] } },
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new Bookmark({
                    id: "existing",
                    children: [new TextRun("Existing")],
                  }),
                  new FootnoteReferenceRun(1),
                ],
              }),
              new Paragraph("{{body}}"),
              new Paragraph("{{second}}"),
            ],
          },
        ],
      }),
    );
    const { zip, text } = await unpack(
      await patchMarkdownInDocxToBuffer(reference, {
        body: `[TOC]\n\n# New\n\n5. Item\n\nNew note[^n]. See [@tbl:results].\n\n[^n]: Note with ![Pixel](${PNG}) and [link](https://example.com).`,
        second: "| A |\n|---|\n| B |\n\n: Results {#tbl:results}",
      }),
    );
    const footnotes = await zip.file("word/footnotes.xml")!.async("string");
    const ids = [...text.matchAll(/<w:footnoteReference w:id="(\d+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(ids).size).toBe(2);
    for (const id of ids)
      expect(footnotes).toContain(`<w:footnote w:id="${id}"`);
    expect(footnotes).toContain("Existing note");
    expect(footnotes).toContain("<w:drawing>");
    expect(
      await zip.file("word/_rels/footnotes.xml.rels")!.async("string"),
    ).toContain("https://example.com");
    expect(text).toContain(" REF mdp");
    expect(text).toContain(" TOC ");
    expect(await zip.file("word/numbering.xml")!.async("string")).toContain(
      'w:start w:val="5"',
    );
    expect(text).not.toContain("{{body}}");
    expect(text).toContain('w:name="existing"');
  });
  it("does not interpret placeholder-shaped inserted text as another patch", async () => {
    const reference = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [new Paragraph("{{body}}"), new Paragraph("{{second}}")],
          },
        ],
      }),
    );
    const { text } = await unpack(
      await patchMarkdownInDocxToBuffer(reference, {
        body: "Literal {{second}}",
        second: "Replaced",
      }),
    );
    expect(text).toContain("Literal {{second}}");
    expect(text).toContain("Replaced");
  });
});

describe("Repeated patches and package integrity", () => {
  it("restarts each list in repeated patches, including nested and footnote lists", async () => {
    const template = await convertMarkdownToBuffer(
      "9. Existing\n\nExisting note[^existing].\n\n{{body}}\n\n{{body}}\n\n{{body}}\n\n[^existing]: 11. Existing footnote",
    );
    const { zip, text } = await unpack(
      await patchMarkdownInDocxToBuffer(template, {
        body: "5. First\n\n   3. Nested\n   4. Nested again\n\n6. Second\n\nSeparate.\n\n0. Zero\n\nNote[^n].\n\n[^n]: 7. Footnote item\n    8. Another item",
      }),
    );
    const parser = new DOMParser();
    const parse = (xml: string) =>
      parser.parseFromString(xml, "application/xml");
    const numbering = parse(
      await zip.file("word/numbering.xml")!.async("string"),
    );
    const definitions = Array.from(
      numbering.getElementsByTagNameNS(W, "num"),
    );
    const ids = definitions.map((node) => node.getAttributeNS(W, "numId"));
    expect(new Set(ids).size).toBe(ids.length);
    const byText = new Map<string, string[]>();
    for (const document of [
      parse(text),
      parse(await zip.file("word/footnotes.xml")!.async("string")),
    ]) {
      for (const paragraph of Array.from(
        document.getElementsByTagNameNS(W, "p"),
      )) {
        const id = paragraph
          .getElementsByTagNameNS(W, "numId")[0]
          ?.getAttributeNS(W, "val");
        if (!id) continue;
        const label = Array.from(
          paragraph.getElementsByTagNameNS(W, "t"),
          (node) => node.textContent,
        ).join("");
        byText.set(label, [...(byText.get(label) ?? []), id]);
        expect(ids).toContain(id);
      }
    }
    for (const [label, start] of [
      ["First", 5],
      ["Nested", 3],
      ["Zero", 0],
      ["Footnote item", 7],
    ] as const) {
      const listIds = byText.get(label)!;
      expect(listIds).toHaveLength(3);
      expect(new Set(listIds).size).toBe(3);
      for (const id of listIds) {
        const definition = definitions.find(
          (node) => node.getAttributeNS(W, "numId") === id,
        )!;
        const abstractId = definition
          .getElementsByTagNameNS(W, "abstractNumId")[0]
          .getAttributeNS(W, "val");
        const abstract = Array.from(
          numbering.getElementsByTagNameNS(W, "abstractNum"),
        ).find(
          (node) => node.getAttributeNS(W, "abstractNumId") === abstractId,
        )!;
        expect(
          abstract
            .getElementsByTagNameNS(W, "start")[0]
            .getAttributeNS(W, "val"),
        ).toBe(String(start));
      }
    }
    expect(byText.get("Second")).toEqual(byText.get("First"));
    expect(byText.get("Nested again")).toEqual(byText.get("Nested"));
    expect(byText.get("Another item")).toEqual(byText.get("Footnote item"));
    expect(byText.get("Existing")).toHaveLength(1);
    expect(byText.get("Existing footnote")).toHaveLength(1);
    expect(byText.get("First")).not.toContain(byText.get("Existing")![0]);
    expect(byText.get("Footnote item")).not.toContain(
      byText.get("Existing footnote")![0],
    );
  });
  it("gives repeated copies unique footnotes and updates cached caption references", async () => {
    const reference = await Packer.toBuffer(
      new Document({
        sections: [
          { children: [new Paragraph("{{body}}"), new Paragraph("{{body}}")] },
        ],
      }),
    );
    const markdown =
      "See [@tbl:data]. Note[^n] and again[^n].\n\n[^n]: Repeated note\n\n| A |\n|---|\n| B |\n\n: Data {#tbl:data}";
    const { zip, text } = await unpack(
      await patchMarkdownInDocxToBuffer(reference, { body: markdown }),
    );
    const ids = [...text.matchAll(/<w:footnoteReference w:id="(\d+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const footnotes = await zip.file("word/footnotes.xml")!.async("string");
    for (const id of ids)
      expect(footnotes).toContain(`<w:footnote w:id="${id}"`);
    expect(text).toContain("Table 1");
    expect(text).toContain("Table 2");
    const names = [
      ...text.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    const once = await unpack(
      await patchMarkdownInDocxToBuffer(
        reference,
        { body: markdown },
        { recursive: false },
      ),
    );
    expect(once.text).toContain("{{body}}");
  });
  it("resolves every imported relationship and numbering reference after a second patch", async () => {
    const reference = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [new Paragraph("{{first}}"), new Paragraph("{{second}}")],
          },
        ],
      }),
    );
    const first = await patchMarkdownInDocxToBuffer(reference, {
      first: `# First\n\n5. Five\n\n![Pixel](${PNG})\n\nNote[^n].\n\n[^n]: [Link](https://example.com) with ![Pixel](${PNG})`,
    });
    const { zip, text } = await unpack(
      await patchMarkdownInDocxToBuffer(first, {
        second: `# Second\n\n3. Three\n\nNote[^n].\n\n[^n]: Second note with ![Pixel](${PNG})`,
      }),
    );
    const parser = new DOMParser();
    const relNamespace =
      "http://schemas.openxmlformats.org/package/2006/relationships";
    const relAttrNamespace =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    for (const file of Object.keys(zip.files).filter((name) =>
      /^word\/[^/]+\.xml$/.test(name),
    )) {
      const document = parser.parseFromString(
        await zip.file(file)!.async("string"),
        "application/xml",
      );
      const relFile = zip.file(`word/_rels/${path.basename(file)}.rels`);
      const rels = relFile
        ? parser.parseFromString(
            await relFile.async("string"),
            "application/xml",
          )
        : undefined;
      const entries = rels
        ? Array.from(rels.getElementsByTagNameNS(relNamespace, "Relationship"))
        : [];
      const ids = new Set(entries.map((el) => el.getAttribute("Id")));
      expect(ids.size).toBe(entries.length);
      for (const element of Array.from(document.getElementsByTagName("*")))
        for (const attr of ["id", "embed", "link"])
          if (element.hasAttributeNS(relAttrNamespace, attr))
            expect(
              ids.has(element.getAttributeNS(relAttrNamespace, attr)),
            ).toBe(true);
      for (const entry of entries)
        if (entry.getAttribute("TargetMode") !== "External")
          expect(
            zip.file(
              path.posix.normalize(`word/${entry.getAttribute("Target")}`),
            ),
          ).not.toBeNull();
    }
    const numbering = parser.parseFromString(
      await zip.file("word/numbering.xml")!.async("string"),
      "application/xml",
    );
    const numberingIds = new Set(
      Array.from(numbering.getElementsByTagNameNS(W, "num"), (el) =>
        el.getAttributeNS(W, "numId"),
      ),
    );
    const document = parser.parseFromString(text, "application/xml");
    for (const id of Array.from(document.getElementsByTagNameNS(W, "numId")))
      expect(numberingIds.has(id.getAttributeNS(W, "val"))).toBe(true);
    const footnotes = parser.parseFromString(
      await zip.file("word/footnotes.xml")!.async("string"),
      "application/xml",
    );
    const noteIds = new Set(
      Array.from(footnotes.getElementsByTagNameNS(W, "footnote"), (el) =>
        el.getAttributeNS(W, "id"),
      ),
    );
    for (const reference of Array.from(
      document.getElementsByTagNameNS(W, "footnoteReference"),
    ))
      expect(noteIds.has(reference.getAttributeNS(W, "id"))).toBe(true);
  });
});
