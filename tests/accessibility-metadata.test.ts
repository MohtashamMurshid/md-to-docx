import { afterEach, describe, expect, it, jest } from "@jest/globals";
import JSZip from "jszip";
import {
  convertMarkdownToArrayBuffer,
  convertMarkdownToBuffer,
  convertMarkdownToDocx,
  MarkdownConversionError,
  patchMarkdownInDocx,
  patchMarkdownInDocxToArrayBuffer,
  patchMarkdownInDocxToBuffer,
} from "../src/index";
import { applyDocumentMetadata } from "../src/metadata";
import { getDocumentXml, getZip } from "./helpers";

const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";
const ONE_PX_PNG_BYTES = Buffer.from(ONE_PX_PNG.split(",")[1], "base64");

async function zipFromBuffer(buffer: Buffer | ArrayBuffer): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}

async function part(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`${path} missing`);
  return file.async("string");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("document metadata package parts", () => {
  it("writes every supported core, app, and custom property with explicit timestamps", async () => {
    const blob = await convertMarkdownToDocx("# Report", {
      metadata: {
        title: "Roadmap v3",
        subject: "Accessibility",
        description: "Generated report",
        creator: "Primary creator",
        author: "Ignored alias",
        keywords: ["docx", "a11y", "Unicode 二"],
        category: "Engineering",
        company: "Example Co",
        language: "en-GB",
        created: "2026-01-02T03:04:05Z",
        modified: new Date("2026-02-03T04:05:06Z"),
        custom: { Build: "v3", ReviewState: "Draft" },
      },
    });
    const zip = await getZip(blob);
    const core = await part(zip, "docProps/core.xml");
    const app = await part(zip, "docProps/app.xml");
    const custom = await part(zip, "docProps/custom.xml");

    expect(core).toContain("<dc:title");
    expect(core).toContain(">Roadmap v3</dc:title>");
    expect(core).toContain(">Accessibility</dc:subject>");
    expect(core).toContain(">Generated report</dc:description>");
    expect(core).toContain(">Primary creator</dc:creator>");
    expect(core).not.toContain("Ignored alias");
    expect(core).toContain(">docx; a11y; Unicode 二</cp:keywords>");
    expect(core).toContain(">Engineering</cp:category>");
    expect(core).toContain(">en-GB</dc:language>");
    expect(core).toContain("2026-01-02T03:04:05.000Z");
    expect(core).toContain("2026-02-03T04:05:06.000Z");
    expect(app).toContain("<Company>Example Co</Company>");
    expect(custom).toContain('name="Build"');
    expect(custom).toContain(">v3</vt:lpwstr>");
    expect(custom).toContain('name="ReviewState"');
  });

  it("escapes XML-special characters, preserves Unicode, and omits implicit timestamps", async () => {
    const blob = await convertMarkdownToDocx("Content", {
      metadata: {
        title: "R&D <測試> \"alpha\"",
        creator: "Zoë & فريق",
        company: "A < B & C",
        custom: { "Owner & team": "Miyuki <美雪> & co" },
      },
    });
    const zip = await getZip(blob);
    const core = await part(zip, "docProps/core.xml");
    const app = await part(zip, "docProps/app.xml");
    const custom = await part(zip, "docProps/custom.xml");

    expect(core).toContain('R&amp;D &lt;測試&gt; "alpha"');
    expect(core).toContain("Zoë &amp; فريق");
    expect(core).not.toContain("dcterms:created");
    expect(core).not.toContain("dcterms:modified");
    expect(app).toContain("A &lt; B &amp; C");
    expect(custom).toContain('name="Owner &amp; team"');
    expect(custom).toContain("Miyuki &lt;美雪&gt; &amp; co");
    expect(app.match(/<\?xml/g)).toHaveLength(1);
  });

  it("rejects invalid controls, oversized values, dates, language, and custom-property counts", async () => {
    await expect(
      convertMarkdownToDocx("Content", { metadata: { title: "bad\u0001value" } }),
    ).rejects.toMatchObject({
      name: "MarkdownConversionError",
      context: { context: "metadata.title" },
    });
    await expect(
      convertMarkdownToDocx("Content", {
        metadata: { description: "x".repeat(4_097) },
      }),
    ).rejects.toThrow("maximum length of 4096");
    await expect(
      convertMarkdownToDocx("Content", { metadata: { created: "not-a-date" } }),
    ).rejects.toThrow("metadata.created must be a valid ISO date");
    await expect(
      convertMarkdownToDocx("Content", { metadata: { language: "not a tag" } }),
    ).rejects.toThrow("BCP 47-style");
    await expect(
      convertMarkdownToDocx("Content", {
        metadata: {
          custom: Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`P${index}`, "value"]),
          ),
        },
      }),
    ).rejects.toThrow("maximum of 64 properties");
  });

  it("keeps the legacy metadata packing path when metadata is unused", async () => {
    const zip = await getZip(await convertMarkdownToDocx("Content"));
    const core = await part(zip, "docProps/core.xml");
    const styles = await part(zip, "word/styles.xml");

    expect(core).toContain("dcterms:created");
    expect(core).toContain("dcterms:modified");
    expect(core).toContain("Un-named");
    expect(styles).not.toContain("<w:lang");
  });

  it("treats an empty metadata object as an explicit normalized metadata set", async () => {
    const zip = await getZip(
      await convertMarkdownToDocx("Content", { metadata: {} }),
    );
    const core = await part(zip, "docProps/core.xml");

    expect(core).not.toContain("dcterms:created");
    expect(core).not.toContain("dcterms:modified");
    expect(core).not.toContain("Un-named");
  });

  it("preserves extended app properties when company is omitted", async () => {
    const sourceZip = await getZip(await convertMarkdownToDocx("Content"));
    const app = await part(sourceZip, "docProps/app.xml");
    sourceZip.file(
      "docProps/app.xml",
      app.replace(
        /\/>\n?$/u,
        "><Company>Existing Co</Company></Properties>",
      ),
    );
    const source = await sourceZip.generateAsync({ type: "nodebuffer" });

    const updated = (await applyDocumentMetadata(
      source,
      { title: "Updated title" },
      "new",
      "nodebuffer",
    )) as Buffer;
    const updatedZip = await zipFromBuffer(updated);

    expect(await part(updatedZip, "docProps/core.xml")).toContain("Updated title");
    expect(await part(updatedZip, "docProps/app.xml")).toContain(
      "<Company>Existing Co</Company>",
    );
  });

  it("returns metadata consistently from Blob, ArrayBuffer, and Buffer helpers", async () => {
    const options = { metadata: { title: "Helper metadata" } } as const;
    const blob = await convertMarkdownToDocx("Content", options);
    const arrayBuffer = await convertMarkdownToArrayBuffer("Content", options);
    const buffer = await convertMarkdownToBuffer("Content", options);

    expect(blob).toBeInstanceOf(Blob);
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    for (const zip of [
      await getZip(blob),
      await zipFromBuffer(arrayBuffer),
      await zipFromBuffer(buffer),
    ]) {
      expect(await part(zip, "docProps/core.xml")).toContain("Helper metadata");
    }
  });
});

describe("drawing accessibility properties", () => {
  it("writes Markdown image alt text and title into Word drawing properties", async () => {
    const markdown = `![Revenue & growth](${ONE_PX_PNG} "Chart <Q1>")`;
    const xml = await getDocumentXml(await convertMarkdownToDocx(markdown));

    expect(xml).toContain(
      'name="Chart &lt;Q1&gt;" descr="Revenue &amp; growth" title="Chart &lt;Q1&gt;"',
    );
  });

  it("propagates alt text for allowed remote images", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(ONE_PX_PNG_BYTES), {
        status: 200,
        headers: { "content-type": "image/png" },
      }) as never,
    );
    const xml = await getDocumentXml(
      await convertMarkdownToDocx(
        "![Remote chart](https://93.184.216.34/chart.png)",
        { imageHandling: { remote: { enabled: true } } },
      ),
    );

    expect(xml).toContain('name="Remote chart" descr="Remote chart"');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("allows empty alt text by default without claiming decorative semantics", async () => {
    const xml = await getDocumentXml(
      await convertMarkdownToDocx(`![](${ONE_PX_PNG})`),
    );

    expect(xml).toContain('<wp:docPr id="1" name="Image"/>');
    expect(xml).not.toContain("decorative");
  });

  it("throws for empty normal and remote image alt text in strict mode before lookup", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    await expect(
      convertMarkdownToDocx(`![](${ONE_PX_PNG})`, {
        accessibility: { missingImageAltText: "throw" },
      }),
    ).rejects.toThrow("strict accessibility mode");
    await expect(
      convertMarkdownToDocx("![](https://example.com/image.png)", {
        accessibility: { missingImageAltText: "throw" },
        imageHandling: { remote: { enabled: true } },
      }),
    ).rejects.toThrow("strict accessibility mode");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid and oversized image descriptions with conversion context", async () => {
    await expect(
      convertMarkdownToDocx(`![${"x".repeat(2_049)}](${ONE_PX_PNG})`),
    ).rejects.toThrow("maximum length of 2048");
    await expect(
      convertMarkdownToDocx(`![bad\u0001alt](${ONE_PX_PNG})`),
    ).rejects.toThrow(MarkdownConversionError);
  });

  it("writes chart alt/title properties for built-in and custom rendering", async () => {
    const definition = JSON.stringify({
      type: "bar",
      data: { labels: ["Q1"], datasets: [{ data: [12] }] },
      alt: "Quarterly revenue",
      options: { plugins: { title: { display: true, text: "FY26 <Revenue>" } } },
    });
    const customRenderer = jest.fn(() => ONE_PX_PNG);
    const builtInXml = await getDocumentXml(
      await convertMarkdownToDocx(`\`\`\`chart\n${definition}\n\`\`\``, {
        chartRendering: { enabled: true },
      }),
    );
    const customXml = await getDocumentXml(
      await convertMarkdownToDocx(`\`\`\`chart\n${definition}\n\`\`\``, {
        chartRendering: { enabled: true, renderer: customRenderer },
      }),
    );

    for (const xml of [builtInXml, customXml]) {
      expect(xml).toContain('descr="Quarterly revenue"');
      expect(xml).toContain('title="FY26 &lt;Revenue&gt;"');
    }
    expect(customRenderer).toHaveBeenCalledTimes(1);
  });

  it("enforces explicit chart alt text in strict mode", async () => {
    const definition = JSON.stringify({
      type: "line",
      data: { datasets: [{ data: [1, 2] }] },
    });
    await expect(
      convertMarkdownToDocx(`\`\`\`chart\n${definition}\n\`\`\``, {
        chartRendering: { enabled: true },
        accessibility: { missingImageAltText: "throw" },
      }),
    ).rejects.toThrow("strict accessibility mode");

    await expect(
      convertMarkdownToDocx(
        `![First](${ONE_PX_PNG})\n\n\`\`\`chart\n${definition}\n\`\`\``,
        {
          chartRendering: { enabled: true },
          imageHandling: { maxImages: 1 },
          accessibility: { missingImageAltText: "throw" },
        },
      ),
    ).rejects.toThrow("strict accessibility mode");
  });

  it("uses Mermaid renderer alt/title output and rejects missing strict alt", async () => {
    const markdown = "```mermaid\ngraph TD\nA-->B\n```";
    const xml = await getDocumentXml(
      await convertMarkdownToDocx(markdown, {
        mermaidRendering: {
          enabled: true,
          render: () => ({
            data: ONE_PX_PNG_BYTES,
            altText: "Flow from A to B",
            title: "Process <flow>",
          }),
        },
      }),
    );
    expect(xml).toContain('descr="Flow from A to B"');
    expect(xml).toContain('title="Process &lt;flow&gt;"');

    await expect(
      convertMarkdownToDocx(markdown, {
        accessibility: { missingImageAltText: "throw" },
        mermaidRendering: {
          enabled: true,
          render: () => ({ data: ONE_PX_PNG_BYTES }),
        },
      }),
    ).rejects.toThrow("strict accessibility mode");
  });
});

describe("language, structure, sections, and reference DOCX behavior", () => {
  it("emits language, bidirectional runs/paragraphs, semantic headings, and table headers", async () => {
    const blob = await convertMarkdownToDocx(
      "# عنوان\n\nنص\n\n| الرأس | القيمة |\n| --- | --- |\n| أ | 1 |",
      {
        metadata: { language: "ar-SA" },
        style: { direction: "RTL" },
      },
    );
    const zip = await getZip(blob);
    const documentXml = await part(zip, "word/document.xml");
    const stylesXml = await part(zip, "word/styles.xml");

    expect(stylesXml).toContain('w:lang w:val="ar-SA" w:bidi="ar-SA"');
    expect(stylesXml).toContain('<w:outlineLvl w:val="1"/>');
    expect(documentXml).toContain("<w:bidi/>");
    expect(documentXml).toContain("<w:rtl/>");
    expect(documentXml).toContain('w:pStyle w:val="Heading1"');
    expect(documentXml).toContain("<w:tblHeader/>");
  });

  it("uses style language over metadata and section style over document style", async () => {
    const blob = await convertMarkdownToDocx("", {
      metadata: { language: "fr-FR" },
      style: { language: "en-GB" },
      sections: [
        { markdown: "First section." },
        { markdown: "القسم الثاني.", style: { language: "ar-SA", direction: "RTL" } },
      ],
    });
    const zip = await getZip(blob);
    const core = await part(zip, "docProps/core.xml");
    const documentXml = await part(zip, "word/document.xml");
    const stylesXml = await part(zip, "word/styles.xml");

    expect(core).toContain(">fr-FR</dc:language>");
    expect(stylesXml).toContain('w:lang w:val="en-GB"');
    expect(documentXml).toContain('w:lang w:val="en-GB"');
    expect(documentXml).toContain('w:lang w:val="ar-SA" w:bidi="ar-SA"');
  });

  it("applies one metadata set to a multi-section package", async () => {
    const blob = await convertMarkdownToDocx("", {
      metadata: { title: "Multi-section report", company: "Sections Inc" },
      sections: [{ markdown: "# One" }, { markdown: "# Two" }],
    });
    const zip = await getZip(blob);
    const documentXml = await part(zip, "word/document.xml");

    expect(documentXml.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(await part(zip, "docProps/core.xml")).toContain("Multi-section report");
    expect(await part(zip, "docProps/app.xml")).toContain("Sections Inc");
  });

  it("preserves reference metadata by default and overrides/merges only supplied fields", async () => {
    const reference = await convertMarkdownToBuffer("{{body}}", {
      metadata: {
        title: "Template title",
        subject: "Preserved subject",
        company: "Template Co",
        created: "2024-01-01T00:00:00Z",
        custom: { Build: "old", Keep: "yes" },
      },
    });
    const referenceZip = await zipFromBuffer(reference);
    const referenceCore = await part(referenceZip, "docProps/core.xml");
    const referenceStyles = await part(referenceZip, "word/styles.xml");

    const preserved = await patchMarkdownInDocxToBuffer(reference, {
      body: `![Patched image](${ONE_PX_PNG})`,
    });
    const preservedZip = await zipFromBuffer(preserved);
    expect(await part(preservedZip, "docProps/core.xml")).toBe(referenceCore);
    expect(await part(preservedZip, "word/document.xml")).toContain(
      'descr="Patched image"',
    );

    const overridden = await patchMarkdownInDocxToBuffer(
      reference,
      { body: "# Updated" },
      {
        metadata: {
          title: "Override title",
          company: "Override Co",
          language: "de-DE",
          custom: { Build: "new", Added: "true" },
        },
      },
    );
    const overriddenZip = await zipFromBuffer(overridden);
    const core = await part(overriddenZip, "docProps/core.xml");
    const app = await part(overriddenZip, "docProps/app.xml");
    const custom = await part(overriddenZip, "docProps/custom.xml");
    const documentXml = await part(overriddenZip, "word/document.xml");

    expect(core).toContain("Override title");
    expect(core).toContain("Preserved subject");
    expect(core).toContain("2024-01-01T00:00:00.000Z");
    expect(core).toContain(">de-DE</dc:language>");
    expect(app).toContain("Override Co");
    expect(custom).toContain('name="Keep"');
    expect(custom).toContain('name="Build"');
    expect(custom).toContain(">new</vt:lpwstr>");
    expect(custom).toContain('name="Added"');
    expect(documentXml).toContain('w:lang w:val="de-DE"');
    expect(await part(overriddenZip, "word/styles.xml")).toBe(referenceStyles);
  });

  it("keeps patched metadata aligned across Blob, ArrayBuffer, and Buffer helpers", async () => {
    const reference = await convertMarkdownToBuffer("{{body}}", {
      metadata: { title: "Template" },
    });
    const options = { metadata: { title: "Patched helper" } } as const;
    const blob = await patchMarkdownInDocx(reference, { body: "Blob" }, options);
    const arrayBuffer = await patchMarkdownInDocxToArrayBuffer(
      reference,
      { body: "ArrayBuffer" },
      options,
    );
    const buffer = await patchMarkdownInDocxToBuffer(
      reference,
      { body: "Buffer" },
      options,
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    for (const zip of [
      await getZip(blob),
      await zipFromBuffer(arrayBuffer),
      await zipFromBuffer(buffer),
    ]) {
      expect(await part(zip, "docProps/core.xml")).toContain("Patched helper");
    }
  });
});
