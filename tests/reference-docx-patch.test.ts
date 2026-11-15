import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { Document, Packer, Paragraph } from "docx";
import { patchMarkdownInDocx, patchMarkdownInDocxToBuffer } from "../src/index.js";
import { at } from "./helpers.js";

const fixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reference-template.docx",
);

async function createTemplateWithPlaceholders(
  placeholders: string[],
): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: placeholders.map(
            (placeholder) => new Paragraph(`{{${placeholder}}}`),
          ),
        },
      ],
    }),
  );
}

async function loadPatchedZip(markdown: string): Promise<JSZip> {
  const template = fs.readFileSync(fixturePath);
  const output = await patchMarkdownInDocxToBuffer(template, {
    body: markdown,
  });

  return JSZip.loadAsync(output);
}

describe("reference DOCX patch workflow", () => {
  it("patches markdown into a placeholder while preserving template package parts", async () => {
    const zip = await loadPatchedZip(`# Inserted Report

Hello **team**.

| Metric | Value |
| --- | --- |
| Score | 42 |`);

    const documentXml = await zip.file("word/document.xml")?.async("string");
    const headerXml = await zip.file("word/header1.xml")?.async("string");
    const footerXml = await zip.file("word/footer1.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");

    expect(documentXml).toBeDefined();
    expect(documentXml).toContain("Corporate Cover Page");
    expect(documentXml).toContain("Inserted Report");
    expect(documentXml).toContain("Hello");
    expect(documentXml).toContain("team");
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("Static closing paragraph");
    expect(documentXml).not.toContain("{{body}}");
    expect(documentXml).toContain('w:top="2000"');
    expect(documentXml).toContain('w:left="1400"');

    expect(headerXml).toContain("Template Header");
    expect(footerXml).toContain("Template Footer");
    expect(stylesXml).toContain('w:styleId="CorpTitle"');
  });

  it("keeps the Blob-returning helper aligned with existing conversion helpers", async () => {
    const template = fs.readFileSync(fixturePath);
    const output = await patchMarkdownInDocx(template, {
      body: "Patched as a Blob.",
    });

    expect(output).toBeInstanceOf(Blob);
    expect(output.size).toBeGreaterThan(0);
  });

  it("shares heading bookmark counters across patched placeholders", async () => {
    const template = await createTemplateWithPlaceholders(["first", "second"]);
    const output = await patchMarkdownInDocxToBuffer(template, {
      first: "# Repeat",
      second: "# Repeat",
    });
    const zip = await JSZip.loadAsync(output);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const bookmarkNames = Array.from(
      documentXml?.matchAll(/<w:bookmarkStart[^>]+w:name="([^"]+)"/g) || [],
      (match) => at(match, 1),
    );

    expect(bookmarkNames.some((name) => name.includes("_Toc_Repeat_1"))).toBe(
      true,
    );
    expect(bookmarkNames.some((name) => name.includes("_Toc_Repeat_2"))).toBe(
      true,
    );
    expect(new Set(bookmarkNames).size).toBe(bookmarkNames.length);
  });

  it("uses the configured patch table width for inserted markdown tables", async () => {
    const template = fs.readFileSync(fixturePath);
    const output = await patchMarkdownInDocxToBuffer(
      template,
      {
        body: `| Metric | Value |
| --- | --- |
| Score | 42 |`,
      },
      { tableWidthTwips: 4321 },
    );
    const zip = await JSZip.loadAsync(output);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toMatch(/<w:tblW[^>]+w:type="dxa"[^>]+w:w="4321"/);
  });

  it("enforces maxElements across all patched placeholders", async () => {
    const template = await createTemplateWithPlaceholders(["first", "second"]);

    await expect(
      patchMarkdownInDocxToBuffer(
        template,
        {
          first: "First paragraph.",
          second: "Second paragraph.",
        },
        { maxElements: 1 },
      ),
    ).rejects.toThrow("Markdown element count exceeds maxElements");
  });

  it("merges numbering for ordered lists", async () => {
    const output = await patchMarkdownInDocxToBuffer(
      fs.readFileSync(fixturePath),
      { body: "5. first\n6. second" },
    );
    const zip = await JSZip.loadAsync(output);
    const document = await zip.file("word/document.xml")!.async("string");
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(document).toContain("<w:numPr>");
    expect(numbering).toContain('w:start w:val="5"');
  });

  it("merges caption fields and bookmarks", async () => {
    const output = await patchMarkdownInDocxToBuffer(
      fs.readFileSync(fixturePath),
      {
        body: "See [@tbl:patched].\n\n| A |\n| --- |\n| B |\n\n: Patched table {#tbl:patched}",
      },
    );
    const zip = await JSZip.loadAsync(output);
    const document = await zip.file("word/document.xml")!.async("string");
    expect(document).toContain(" SEQ MdToDocxTable");
    expect(document).toContain(" REF mdp");
    expect(document).not.toContain("[@tbl:patched]");
  });
});

describe("patch bookmark IDs", () => {
  it.each([
    ["w", ""],
    ["x", ' xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'],
  ])("keeps a template bookmark that spans the placeholder paired with its own end (%s: prefix)", async (prefix, declaration) => {
    const templateZip = await JSZip.loadAsync(
      await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph("Before"),
                new Paragraph("{{body}}"),
                new Paragraph("After"),
              ],
            },
          ],
        }),
      ),
    );
    const templateXml = await templateZip.file("word/document.xml")!.async("string");
    templateZip.file(
      "word/document.xml",
      templateXml
        .replace(
          /(<w:p\b(?:(?!<w:p\b)[\s\S])*?Before)/,
          `<${prefix}:bookmarkStart${declaration} ${prefix}:id="2" ${prefix}:name="span"/>$1`,
        )
        .replace(
          /(<w:p\b(?:(?!<w:p\b)[\s\S])*?After)/,
          `<${prefix}:bookmarkEnd${declaration} ${prefix}:id="2"/>$1`,
        ),
    );
    const template = await templateZip.generateAsync({ type: "nodebuffer" });

    const output = await patchMarkdownInDocxToBuffer(template, {
      body: "# Inserted heading\n\nText.",
    });

    const xml = await (await JSZip.loadAsync(output))
      .file("word/document.xml")!
      .async("string");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    // Walk the body in document order by namespace, so any prefix is found.
    const tags = Array.from(
      new DOMParser()
        .parseFromString(xml, "application/xml")
        .getElementsByTagNameNS(W, "*"),
    )
      .filter((element) => /^bookmark(Start|End)$/.test(element.localName ?? ""))
      .map((element) => ({
        kind: element.localName === "bookmarkStart" ? "Start" : "End",
        id: element.getAttributeNS(W, "id"),
        name: element.getAttributeNS(W, "name"),
      }));
    const spanStart = tags.findIndex((tag) => tag.name === "span");
    expect(spanStart).toBeGreaterThanOrEqual(0);
    const spanId = tags[spanStart]!.id;
    const spanEnd = tags.findIndex(
      (tag, index) => index > spanStart && tag.kind === "End" && tag.id === spanId,
    );
    const inner = tags.findIndex(
      (tag, index) => index > spanStart && tag.kind === "Start" && tag.name !== "span",
    );
    expect(inner).toBeGreaterThan(spanStart);
    const innerEnd = tags.findIndex(
      (tag, index) => index > inner && tag.kind === "End" && tag.id === tags[inner]!.id,
    );
    expect(innerEnd).toBeGreaterThan(inner);
    expect(spanEnd).toBeGreaterThan(innerEnd);
    expect(spanEnd).toBe(tags.length - 1);
  });
});
