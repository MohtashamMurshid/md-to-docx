import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import {
  MarkdownConversionError,
  patchMarkdownInDocx,
  patchMarkdownInDocxToBuffer,
} from "../src/index";

const fixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reference-template.docx"
);

async function createTemplateWithPlaceholders(
  placeholders: string[]
): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: placeholders.map(
            (placeholder) => new Paragraph(`{{${placeholder}}}`)
          ),
        },
      ],
    })
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
      (match) => match[1]
    );

    expect(bookmarkNames).toContain("_Toc_Repeat_1");
    expect(bookmarkNames).toContain("_Toc_Repeat_2");
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
      { tableWidthTwips: 4321 }
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
        { maxElements: 1 }
      )
    ).rejects.toThrow("Markdown element count exceeds maxElements");
  });

  it("fails clearly for markdown that requires unsupported package merges", async () => {
    const template = fs.readFileSync(fixturePath);

    await expect(
      patchMarkdownInDocxToBuffer(template, {
        body: "1. first\n2. second",
      })
    ).rejects.toThrow(MarkdownConversionError);

    await expect(
      patchMarkdownInDocxToBuffer(template, {
        body: "1. first\n2. second",
      })
    ).rejects.toThrow("ordered lists");
  });
});
