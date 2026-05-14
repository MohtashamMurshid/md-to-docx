import { describe, expect, it } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../src/index";
import { canonicalLanguageName } from "../src/utils/codeHighlight";
import { processFormattedText } from "../src/renderers/textRenderer";
import { getDocumentXml, getZip } from "./helpers";

async function documentRelationshipsXml(blob: Blob): Promise<string> {
  const zip = await getZip(blob);
  return zip.file("word/_rels/document.xml.rels")?.async("string") ?? "";
}

describe("Security regressions", () => {
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

  it("rejects nested-quantifier text replacement regexes before replacement", async () => {
    await expect(
      convertMarkdownToDocx("a".repeat(2000), {
        textReplacements: [{ find: /(a+)+$/, replace: "safe" }],
      })
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });

  it("bounds link scanning for bracket-heavy fallback rendering", () => {
    const runs = processFormattedText("[".repeat(20_000));
    expect(runs.length).toBeGreaterThan(0);
  });

  it("caches and bounds unknown code highlighting language resolution", () => {
    for (let i = 0; i < 1_000; i++) {
      expect(canonicalLanguageName(`unknown-language-${i}`)).toBeNull();
    }
    expect(canonicalLanguageName("javascript")).toBe("javascript");
    expect(canonicalLanguageName("js")).toBe("javascript");
  });
});
