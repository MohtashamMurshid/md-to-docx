import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  convertMarkdownToBuffer,
  convertMarkdownWithReferenceDocx,
  convertMarkdownWithReferenceDocxToArrayBuffer,
  convertMarkdownWithReferenceDocxToBuffer,
  MarkdownConversionError,
  type ReferenceDocxErrorContext,
} from "../src/index";
import {
  applyReferenceDocxPresentation,
  loadReferenceDocx,
} from "../src/referenceDocx";

const fixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reference-template.docx",
);

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Corporate Theme">
  <a:themeElements><a:clrScheme name="Corporate"><a:dk1><a:srgbClr val="112233"/></a:dk1></a:clrScheme>
  <a:fontScheme name="Corporate Fonts"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
  <a:fmtScheme name="Corporate Format"/></a:themeElements>
</a:theme>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="CorpBody"><w:name w:val="Normal"/><w:rPr><w:color w:val="334455"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CorpTitle"><w:name w:val="Corporate Title"/><w:basedOn w:val="CorpBody"/></w:style>
  <w:style w:type="paragraph" w:styleId="CorpH1"><w:name w:val="Executive Heading"/><w:basedOn w:val="CorpBody"/><w:rPr><w:color w:val="AA2200"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CorpH2"><w:name w:val="Division Heading"/><w:basedOn w:val="CorpBody"/></w:style>
  <w:style w:type="paragraph" w:styleId="CorpQuote"><w:name w:val="Quote"/><w:basedOn w:val="CorpBody"/></w:style>
  <w:style w:type="paragraph" w:styleId="CorpCode"><w:name w:val="Code Block"/><w:basedOn w:val="CorpBody"/></w:style>
  <w:style w:type="paragraph" w:styleId="CorpCaption"><w:name w:val="Caption"/><w:basedOn w:val="CorpBody"/></w:style>
  <w:style w:type="paragraph" w:styleId="CorpList"><w:name w:val="List Paragraph"/><w:basedOn w:val="CorpBody"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="table" w:styleId="CorpTable"><w:name w:val="Normal Table"/></w:style>
  <w:style w:type="character" w:styleId="CorpStrong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="CorpEmphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="CorpInline"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="CorpLink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="008844"/></w:rPr></w:style>
</w:styles>`;

function addRelationship(
  xml: string,
  id: string,
  type: string,
  target: string,
): string {
  const relationship = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  if (xml.includes("</Relationships>")) {
    return xml.replace(
      "</Relationships>",
      `${relationship}</Relationships>`,
    );
  }
  return xml.replace(/<Relationships\b([^>]*)\/>/, `<Relationships$1>${relationship}</Relationships>`);
}

async function createReferenceFixture(
  mutate?: (zip: JSZip) => void | Promise<void>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fs.readFileSync(fixturePath));
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/theme/theme1.xml", THEME_XML);
  zip.file(
    "word/fontTable.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Aptos"><w:family w:val="swiss"/></w:font></w:fonts>`,
  );

  const relsPath = "word/_rels/document.xml.rels";
  let rels = await zip.file(relsPath)!.async("string");
  if (!rels.includes("/theme\"")) {
    rels = addRelationship(rels, "rIdTheme", "theme", "theme/theme1.xml");
  }
  zip.file(relsPath, rels);

  const typesPath = "[Content_Types].xml";
  let types = await zip.file(typesPath)!.async("string");
  if (!types.includes("/word/theme/theme1.xml")) {
    types = types.replace(
      "</Types>",
      `<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    );
  }
  zip.file(typesPath, types);

  await mutate?.(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function xml(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`${name} not found`);
  return file.async("string");
}

function errorContext(error: unknown): ReferenceDocxErrorContext | undefined {
  return error instanceof MarkdownConversionError
    ? (error.context as ReferenceDocxErrorContext)
    : undefined;
}

describe("reference DOCX style generation", () => {
  it("adopts named styles by name and ID without copying static body content", async () => {
    const reference = await createReferenceFixture();
    const output = await convertMarkdownWithReferenceDocxToBuffer(
      `# Fresh report

## Details

Body with **strong**, *emphasis*, \`inline code\`, and [a link](https://example.com).

> Quoted guidance.

\`\`\`text
const answer = 42;
\`\`\`

| Metric | Value |
| --- | --- |
| Score | 42 |

1. First
2. Second

- Bullet`,
      reference,
      {
        reference: {
          styles: {
            heading1: { name: "Executive Heading" },
            heading2: { id: "CorpH2" },
          },
        },
      },
    );
    const zip = await JSZip.loadAsync(output);
    const documentXml = await xml(zip, "word/document.xml");
    const stylesXml = await xml(zip, "word/styles.xml");

    expect(documentXml).toContain("Fresh report");
    expect(documentXml).not.toContain("Corporate Cover Page");
    expect(documentXml).not.toContain("Static closing paragraph");
    expect(documentXml).toContain('w:pStyle w:val="CorpH1"');
    expect(documentXml).toContain('w:pStyle w:val="CorpH2"');
    expect(documentXml).toContain('w:pStyle w:val="CorpBody"');
    expect(documentXml).toContain('w:pStyle w:val="CorpQuote"');
    expect(documentXml).toContain('w:pStyle w:val="CorpCode"');
    expect(documentXml).toContain('w:pStyle w:val="CorpList"');
    expect(documentXml).toContain('w:tblStyle w:val="CorpTable"');
    expect(documentXml).toContain('w:rStyle w:val="CorpStrong"');
    expect(documentXml).toContain('w:rStyle w:val="CorpEmphasis"');
    expect(documentXml).toContain('w:rStyle w:val="CorpInline"');
    expect(documentXml).toContain('w:rStyle w:val="CorpLink"');
    expect(stylesXml).toContain('w:styleId="CorpH1"');
    expect(stylesXml).toContain('w:styleId="FootnoteText"');
  });

  it("preserves theme, fonts, page geometry, headers, footers, and usable table width", async () => {
    const output = await convertMarkdownWithReferenceDocxToBuffer(
      `# New body

| A | B |
| --- | --- |
| 1 | 2 |`,
      await createReferenceFixture(),
    );
    const zip = await JSZip.loadAsync(output);
    const documentXml = await xml(zip, "word/document.xml");
    const relationshipsXml = await xml(zip, "word/_rels/document.xml.rels");
    const contentTypesXml = await xml(zip, "[Content_Types].xml");
    const themePath = Object.keys(zip.files).find((name) =>
      name.endsWith("reference-package/word/theme/theme1.xml"),
    );
    const fontPath = Object.keys(zip.files).find((name) =>
      name.endsWith("reference-package/word/fontTable.xml"),
    );
    const headerPath = Object.keys(zip.files).find((name) =>
      name.endsWith("reference-package/word/header1.xml"),
    );
    const footerPath = Object.keys(zip.files).find((name) =>
      name.endsWith("reference-package/word/footer1.xml"),
    );

    expect(documentXml).toContain('w:top="2000"');
    expect(documentXml).toContain('w:left="1400"');
    expect(documentXml).toContain('w:tblW w:type="dxa" w:w="9306"');
    expect(documentXml).toContain("w:headerReference");
    expect(documentXml).toContain("w:footerReference");
    expect(relationshipsXml).toContain("reference-package/word/header1.xml");
    expect(relationshipsXml).toContain("reference-package/word/footer1.xml");
    expect(relationshipsXml).toContain("reference-package/word/theme/theme1.xml");
    expect(relationshipsXml).toContain("reference-package/word/fontTable.xml");
    expect(contentTypesXml).toContain("reference-package/word/theme/theme1.xml");
    expect(themePath && (await xml(zip, themePath))).toContain("Corporate Theme");
    expect(fontPath && (await xml(zip, fontPath))).toContain('w:name="Aptos"');
    expect(headerPath && (await xml(zip, headerPath))).toContain("Template Header");
    expect(footerPath && (await xml(zip, footerPath))).toContain("Template Footer");
  });

  it("remaps reference numbering above generated ordered and bullet list IDs", async () => {
    const output = await convertMarkdownWithReferenceDocxToBuffer(
      "1. Ordered\n2. Still ordered\n\n- Bullet",
      await createReferenceFixture(),
    );
    const zip = await JSZip.loadAsync(output);
    const documentXml = await xml(zip, "word/document.xml");
    const numberingXml = await xml(zip, "word/numbering.xml");
    const stylesXml = await xml(zip, "word/styles.xml");
    const numIds = Array.from(
      numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g),
      (match) => Number(match[1]),
    );
    const styleNumId = Number(
      stylesXml
        .match(/w:styleId="CorpList"[\s\S]*?<w:numId w:val="(\d+)"/)?.[1],
    );

    expect(new Set(numIds).size).toBe(numIds.length);
    expect(documentXml).toMatch(/<w:numId w:val="1"\/>/);
    expect(documentXml).toMatch(/<w:numId w:val="2"\/>/);
    expect(styleNumId).toBeGreaterThan(2);
    expect(numIds).toContain(styleNumId);
  });

  it("keeps generated tables, images, and links relationship-safe", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7SAAAAAASUVORK5CYII=";
    const output = await convertMarkdownWithReferenceDocxToBuffer(
      `| A | B |
| --- | --- |
| 1 | 2 |

![pixel](data:image/png;base64,${png})

[OpenAI](https://openai.com)`,
      await createReferenceFixture(),
    );
    const zip = await JSZip.loadAsync(output);
    const documentXml = await xml(zip, "word/document.xml");
    const relationshipsXml = await xml(zip, "word/_rels/document.xml.rels");

    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain("<w:hyperlink");
    expect(relationshipsXml).toContain('Target="https://openai.com"');
    expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(true);
  });

  it("defines fallback, throw, duplicate-name, malformed-package, and abort behavior", async () => {
    const reference = await createReferenceFixture();
    const fallback = await convertMarkdownWithReferenceDocxToBuffer("# Heading", reference, {
      reference: { styles: { heading1: { name: "Missing Heading" } } },
    });
    expect(await xml(await JSZip.loadAsync(fallback), "word/document.xml")).toContain(
      'w:pStyle w:val="Heading1"',
    );

    await expect(
      convertMarkdownWithReferenceDocxToBuffer("# Heading", reference, {
        reference: {
          missingStyleBehavior: "throw",
          styles: { heading1: { name: "Missing Heading" } },
        },
      }),
    ).rejects.toMatchObject({
      context: { phase: "reference-docx", code: "MISSING_STYLE", role: "heading1" },
    });

    const duplicate = await createReferenceFixture(async (zip) => {
      const styles = await xml(zip, "word/styles.xml");
      zip.file(
        "word/styles.xml",
        styles.replace(
          "</w:styles>",
          '<w:style w:type="paragraph" w:styleId="CorpH1Duplicate"><w:name w:val="Executive Heading"/></w:style><w:style w:type="paragraph" w:styleId="CorpQuoteDuplicate"><w:name w:val="Quote"/></w:style></w:styles>',
        ),
      );
    });
    await expect(
      convertMarkdownWithReferenceDocxToBuffer("# Heading", duplicate, {
        reference: { styles: { heading1: { name: "Executive Heading" } } },
      }),
    ).rejects.toMatchObject({
      context: { code: "DUPLICATE_STYLE_NAME" },
    });
    const firstDuplicate = await convertMarkdownWithReferenceDocxToBuffer(
      "# Heading",
      duplicate,
      {
        reference: {
          duplicateStyleNameBehavior: "first",
          styles: { heading1: { name: "Executive Heading" } },
        },
      },
    );
    expect(
      await xml(await JSZip.loadAsync(firstDuplicate), "word/document.xml"),
    ).toContain('w:pStyle w:val="CorpH1"');
    const automaticDuplicate = await convertMarkdownWithReferenceDocxToBuffer(
      "> Automatically resolved quote",
      duplicate,
    );
    expect(
      await xml(await JSZip.loadAsync(automaticDuplicate), "word/document.xml"),
    ).toContain('w:pStyle w:val="CorpQuote"');

    await expect(
      convertMarkdownWithReferenceDocxToBuffer("text", Buffer.from("not a zip")),
    ).rejects.toMatchObject({ context: { code: "INVALID_ZIP" } });

    const nonDocx = new JSZip();
    nonDocx.file("hello.txt", "hello");
    await expect(
      convertMarkdownWithReferenceDocxToBuffer(
        "text",
        await nonDocx.generateAsync({ type: "nodebuffer" }),
      ),
    ).rejects.toMatchObject({ context: { code: "MISSING_PACKAGE_PART" } });

    const controller = new AbortController();
    controller.abort();
    await expect(
      convertMarkdownWithReferenceDocxToBuffer("text", reference, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ context: { code: "ABORTED" } });
  });

  it("rejects unsafe ZIP paths and bounded zip-bomb-style packages", async () => {
    const unsafe = new JSZip();
    unsafe.file("../word/document.xml", "unsafe");
    await expect(
      convertMarkdownWithReferenceDocxToBuffer(
        "text",
        await unsafe.generateAsync({ type: "nodebuffer" }),
      ),
    ).rejects.toMatchObject({ context: { code: "UNSAFE_ENTRY_PATH" } });

    const reference = await createReferenceFixture();
    let caught: unknown;
    try {
      await convertMarkdownWithReferenceDocxToBuffer("text", reference, {
        reference: { limits: { maxUncompressedBytes: 1024 } },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MarkdownConversionError);
    expect(errorContext(caught)).toMatchObject({
      code: "PACKAGE_LIMIT_EXCEEDED",
      limit: 1024,
    });

    await expect(
      convertMarkdownWithReferenceDocxToBuffer("text", reference, {
        reference: { limits: { maxEntries: 3 } },
      }),
    ).rejects.toMatchObject({ context: { code: "PACKAGE_LIMIT_EXCEEDED" } });
  });

  it("rejects malformed required and recursively imported XML parts", async () => {
    const malformedStyles = await createReferenceFixture((zip) => {
      zip.file(
        "word/styles.xml",
        STYLES_XML.replace("</w:styles>", "<w:style></w:styles>"),
      );
    });
    await expect(
      convertMarkdownWithReferenceDocxToBuffer("text", malformedStyles),
    ).rejects.toMatchObject({
      context: { code: "MALFORMED_XML", entry: "word/styles.xml" },
    });

    const malformedHeader = await createReferenceFixture((zip) => {
      zip.file(
        "word/header1.xml",
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p></w:hdr>',
      );
    });
    await expect(
      convertMarkdownWithReferenceDocxToBuffer("text", malformedHeader),
    ).rejects.toMatchObject({
      context: { code: "MALFORMED_XML", entry: "word/header1.xml" },
    });
  });

  it("reuses generated DOCX files as deterministic reference input", async () => {
    const generated = await convertMarkdownToBuffer("# Generated reference");
    const generatedZip = await JSZip.loadAsync(generated);
    const generatedStyles = await xml(generatedZip, "word/styles.xml");
    const styleIds = Array.from(
      generatedStyles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"/g),
      (match) => match[1],
    );

    expect(new Set(styleIds).size).toBe(styleIds.length);
    const output = await convertMarkdownWithReferenceDocxToBuffer(
      "# Reused successfully",
      generated,
    );
    expect(
      await xml(await JSZip.loadAsync(output), "word/document.xml"),
    ).toContain("Reused successfully");
  });

  it("accepts generated packages without a numbering part", async () => {
    const generatedZip = await JSZip.loadAsync(
      await convertMarkdownToBuffer("# Generated without numbering"),
    );
    generatedZip.remove("word/numbering.xml");
    generatedZip.file(
      "word/_rels/document.xml.rels",
      (await xml(generatedZip, "word/_rels/document.xml.rels")).replace(
        /<Relationship\b(?=[^>]*Type="[^"]*\/numbering")[^>]*\/>/,
        "",
      ),
    );
    generatedZip.file(
      "[Content_Types].xml",
      (await xml(generatedZip, "[Content_Types].xml")).replace(
        /<Override\b(?=[^>]*PartName="\/word\/numbering\.xml")[^>]*\/>/,
        "",
      ),
    );
    const generated = await generatedZip.generateAsync({ type: "arraybuffer" });
    const reference = await loadReferenceDocx(await createReferenceFixture());
    const output = await JSZip.loadAsync(
      await applyReferenceDocxPresentation(generated, reference),
    );

    const numberingXml = await xml(output, "word/numbering.xml");
    expect(numberingXml).toContain("<w:numbering");
    expect(numberingXml).toContain("<w:abstractNum");
    expect(numberingXml).toContain("<w:num ");
    expect(await xml(output, "word/_rels/document.xml.rels")).toContain(
      "/numbering\" Target=\"numbering.xml\"",
    );
    expect(await xml(output, "[Content_Types].xml")).toContain(
      'PartName="/word/numbering.xml"',
    );
    expect(await xml(output, "word/document.xml")).toContain(
      "Generated without numbering",
    );
  });

  it("rejects unsupported active header/footer relationship constructs", async () => {
    const reference = await createReferenceFixture(async (zip) => {
      const relsPath = "word/_rels/header1.xml.rels";
      const rels = await xml(zip, relsPath);
      zip.file(
        relsPath,
        addRelationship(rels, "rIdChart", "chart", "charts/chart1.xml"),
      );
    });

    await expect(
      convertMarkdownWithReferenceDocxToBuffer("Fresh body", reference),
    ).rejects.toMatchObject({
      context: {
        code: "UNSUPPORTED_RELATIONSHIP",
        relationshipType:
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
      },
    });
  });

  it("returns Blob, ArrayBuffer, and Buffer and keeps ordinary conversion isolated", async () => {
    const reference = await createReferenceFixture();
    const [blob, arrayBuffer, buffer] = await Promise.all([
      convertMarkdownWithReferenceDocx("# Output", reference),
      convertMarkdownWithReferenceDocxToArrayBuffer("# Output", reference),
      convertMarkdownWithReferenceDocxToBuffer("# Output", reference),
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const ordinary = await convertMarkdownToBuffer("# Ordinary");
    const ordinaryZip = await JSZip.loadAsync(ordinary);
    expect(Object.keys(ordinaryZip.files).some((name) => name.includes("reference-package"))).toBe(
      false,
    );
    expect(await xml(ordinaryZip, "word/document.xml")).toContain(
      'w:pStyle w:val="Heading1"',
    );
  });

  it("produces deterministic Word XML for the same markdown and reference", async () => {
    const reference = await createReferenceFixture();
    const first = await JSZip.loadAsync(
      await convertMarkdownWithReferenceDocxToBuffer("# Stable\n\n1. One", reference),
    );
    const second = await JSZip.loadAsync(
      await convertMarkdownWithReferenceDocxToBuffer("# Stable\n\n1. One", reference),
    );
    for (const part of [
      "word/document.xml",
      "word/styles.xml",
      "word/numbering.xml",
      "word/_rels/document.xml.rels",
    ]) {
      expect(await xml(first, part)).toBe(await xml(second, part));
    }
  });
});
