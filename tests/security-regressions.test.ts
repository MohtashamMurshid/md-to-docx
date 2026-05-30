import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../src/index";
import { canonicalLanguageName } from "../src/utils/codeHighlight";
import { getDocumentXml, getZip } from "./helpers";

async function documentRelationshipsXml(blob: Blob): Promise<string> {
  const zip = await getZip(blob);
  return zip.file("word/_rels/document.xml.rels")?.async("string") ?? "";
}

describe("Security regressions", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not write diagnostics to console during library conversion", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await convertMarkdownToDocx("# Title\n\n[[toc]]");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not turn escaped link syntax into a DOCX hyperlink", async () => {
    const blob = await convertMarkdownToDocx(
      String.raw`Escaped \[not a link](https://example.com/phish).`
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("not a link");
    expect(documentXml).not.toContain("<w:hyperlink");
    expect(relationshipsXml).not.toContain("https://example.com/phish");
  });

  it("still renders intentional markdown links as DOCX hyperlinks", async () => {
    const blob = await convertMarkdownToDocx(
      "Real [link](https://example.com/docs)."
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("<w:hyperlink");
    expect(relationshipsXml).toContain("https://example.com/docs");
  });

  it("keeps GFM autolinks after text ending in bracket-paren syntax", async () => {
    const blob = await convertMarkdownToDocx(
      "See result](https://example.com/autolink) for details."
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("<w:hyperlink");
    expect(relationshipsXml).toContain("https://example.com/autolink");
  });

  it("rejects nested-quantifier text replacement regexes before replacement", async () => {
    await expect(
      convertMarkdownToDocx("a".repeat(2000), {
        textReplacements: [{ find: /(a+)+$/, replace: "safe" }],
      })
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });

  it("rejects nested optional-quantifier text replacement regexes", async () => {
    await expect(
      convertMarkdownToDocx("a".repeat(2000), {
        textReplacements: [{ find: /(a?)+$/, replace: "safe" }],
      })
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });

  it("bounds bracket-heavy input without catastrophic scanning", async () => {
    const blob = await convertMarkdownToDocx("[".repeat(20_000));
    const documentXml = await getDocumentXml(blob);
    // The bracket payload must actually be rendered (not silently dropped):
    // every literal "[" should survive into the document body.
    const bracketCount = (documentXml.match(/\[/g) || []).length;
    expect(bracketCount).toBe(20_000);
  });

  it("caches and bounds unknown code highlighting language resolution", () => {
    for (let i = 0; i < 1_000; i++) {
      expect(canonicalLanguageName(`unknown-language-${i}`)).toBeNull();
    }
    expect(canonicalLanguageName("javascript")).toBe("javascript");
    expect(canonicalLanguageName("js")).toBe("javascript");
  });
});
