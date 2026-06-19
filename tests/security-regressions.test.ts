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

  it("rejects function text replacements in untrusted mode before execution", async () => {
    const replacement = jest.fn((match: string) => `Number: ${match}`);

    await expect(
      convertMarkdownToDocx("Invoice 42", {
        textReplacementMode: "untrusted",
        textReplacements: [{ find: /(\d+)/g, replace: replacement }],
      })
    ).rejects.toThrow("Function textReplacements are not allowed");

    expect(replacement).not.toHaveBeenCalled();
  });

  it("allows literal text replacements in untrusted mode", async () => {
    const blob = await convertMarkdownToDocx("Company Name", {
      textReplacementMode: "untrusted",
      textReplacements: [{ find: "Company Name", replace: "Acme Corp" }],
    });

    const documentXml = await getDocumentXml(blob);
    expect(documentXml).toContain("Acme Corp");
    expect(documentXml).not.toContain("Company Name");
  });

  it("preserves trusted function text replacement behavior", async () => {
    const replacement = jest.fn((match: string) => `Number: ${match}`);
    const blob = await convertMarkdownToDocx("Invoice 42", {
      textReplacementMode: "trusted",
      textReplacements: [{ find: /(\d+)/g, replace: replacement }],
    });

    const documentXml = await getDocumentXml(blob);
    expect(documentXml).toContain("Number: 42");
    expect(replacement).toHaveBeenCalledWith(
      "42",
      "42",
      expect.objectContaining({ index: 8 })
    );
  });

  it("rejects invalid textReplacementMode values", async () => {
    await expect(
      convertMarkdownToDocx("Hello", {
        textReplacementMode: "invalid" as unknown as "trusted",
      })
    ).rejects.toThrow("Invalid textReplacementMode");
  });

  it("rejects null textReplacementMode values", async () => {
    await expect(
      convertMarkdownToDocx("Hello", {
        textReplacementMode: null as unknown as "trusted",
        textReplacements: [{ find: "Hello", replace: "Hi" }],
      })
    ).rejects.toThrow("Invalid textReplacementMode");
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

  it("renders file:// UNC links as plain text instead of hyperlinks", async () => {
    const blob = await convertMarkdownToDocx(
      "Open [report](file://attacker.example/share/doc.docx) now."
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("report");
    expect(documentXml).not.toContain("<w:hyperlink");
    expect(relationshipsXml).not.toContain("file://");
  });

  it("renders javascript: links as plain text instead of hyperlinks", async () => {
    const blob = await convertMarkdownToDocx(
      "Click [here](javascript:alert(1))."
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("here");
    expect(documentXml).not.toContain("<w:hyperlink");
    expect(relationshipsXml).not.toContain("javascript:");
  });

  it("renders whitespace-obfuscated unsafe schemes as plain text", async () => {
    // The WHATWG URL parser strips tabs/newlines, so "java\tscript:" would
    // otherwise normalize to javascript: after the allowlist check.
    const blob = await convertMarkdownToDocx(
      "Click [here](java\tscript:alert(1))."
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("here");
    expect(documentXml).not.toContain("<w:hyperlink");
    expect(relationshipsXml).not.toContain("script:");
  });

  it("fails closed on malformed link targets the URL parser rejects", async () => {
    const blob = await convertMarkdownToDocx("Broken [target](https://).");

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml).toContain("target");
    expect(documentXml).not.toContain("<w:hyperlink");
    expect(relationshipsXml).not.toContain('Target="https://"');
  });

  it("keeps https, mailto, and relative links as hyperlinks", async () => {
    const blob = await convertMarkdownToDocx(
      [
        "[secure](https://example.com/ok)",
        "[mail](mailto:user@example.com)",
        "[relative](./other-doc.md)",
      ].join(" and ")
    );

    const documentXml = await getDocumentXml(blob);
    const relationshipsXml = await documentRelationshipsXml(blob);

    expect(documentXml.match(/<w:hyperlink/g)).toHaveLength(3);
    expect(relationshipsXml).toContain("https://example.com/ok");
    expect(relationshipsXml).toContain("mailto:user@example.com");
  });
});
