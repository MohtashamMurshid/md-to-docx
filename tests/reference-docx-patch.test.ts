import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
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
