import { describe, expect, it } from "bun:test";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../dist/index.js";
import { getDocumentXml, getZip } from "./helpers";

const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

async function render(markdown: string, options = {}): Promise<string> {
  return getDocumentXml(await convertMarkdownToDocx(markdown, options));
}

function fieldInstructions(xml: string, field: "SEQ" | "REF"): string[] {
  return Array.from(
    xml.matchAll(new RegExp(`<w:fldSimple w:instr=" ([^"]*${field}[^"]*)">`, "g")),
    (match) => match[1],
  );
}

describe("figure/table captions and cross-references", () => {
  it("numbers figures and tables independently with native fields and bookmarks", async () => {
    const markdown = `See [@fig:overview] and [@tbl:results].

![Architecture overview](${ONE_PX_PNG})

: System *overview* {#fig:overview}

| Metric | Value |
| --- | --- |
| Score | 42 |

: **Results** summary {#tbl:results}`;
    const blob = await convertMarkdownToDocx(markdown);
    const xml = await getDocumentXml(blob);
    const settings = await (await getZip(blob))
      .file("word/settings.xml")
      ?.async("string");

    expect(fieldInstructions(xml, "SEQ")).toEqual([
      "SEQ MdToDocxFigure \\* ARABIC ",
      "SEQ MdToDocxTable \\* ARABIC ",
    ]);
    expect(fieldInstructions(xml, "REF")).toHaveLength(2);
    expect(xml).toMatch(/w:name="mdxref_figoverview_[a-z0-9]+"/);
    expect(xml).toMatch(/w:name="mdxref_tblresults_[a-z0-9]+"/);
    expect(xml).toContain("Figure 1");
    expect(xml).toContain("Table 1");
    expect(xml).toMatch(/<w:i\/>[\s\S]*?>overview<\/w:t>/);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?>Results<\/w:t>/);
    expect(settings).toContain("<w:updateFields/>");
  });

  it("supports multiple clickable forward references", async () => {
    const xml = await render(`First [@fig:later], then [@fig:later] again.

![Forward reference](${ONE_PX_PNG})

: Defined later {#fig:later}`);
    const refs = fieldInstructions(xml, "REF");

    expect(refs).toHaveLength(2);
    expect(refs.every((instruction) => instruction.includes("\\h"))).toBe(true);
    expect(xml.match(/Figure 1/g)).toHaveLength(2);
  });

  it("can suppress Word's automatic field-update prompt", async () => {
    const blob = await convertMarkdownToDocx(
      `See [@fig:prompt-free].

![Prompt-free figure](${ONE_PX_PNG})

: Prompt-free caption {#fig:prompt-free}`,
      { captions: { updateFieldsOnOpen: false } },
    );
    const settings = await (await getZip(blob))
      .file("word/settings.xml")
      ?.async("string");

    expect(settings).not.toContain("<w:updateFields");
    const xml = await getDocumentXml(blob);
    expect(fieldInstructions(xml, "REF")).toHaveLength(1);
    expect(xml).toContain("Figure 1");
  });

  it("validates the automatic field-update option", async () => {
    await expect(
      convertMarkdownToDocx("Text", {
        captions: { updateFieldsOnOpen: "no" as unknown as boolean },
      }),
    ).rejects.toThrow(
      "Invalid captions.updateFieldsOnOpen: Must be a boolean",
    );
  });

  it("continues automatic numbering across document sections", async () => {
    const xml = await getDocumentXml(
      await convertMarkdownToDocx("", {
        sections: [
          {
            markdown: `![First](${ONE_PX_PNG})

: First section {#fig:first}`,
          },
          {
            markdown: `Reference [@fig:first].

![Second](${ONE_PX_PNG})

: Second section {#fig:second}

| A |
| --- |
| B |

: Section table {#tbl:section}`,
          },
        ],
      }),
    );

    expect(xml).toContain("Figure 1");
    expect(xml).toMatch(
      /SEQ MdToDocxFigure[^"]*">(?:(?!<\/w:fldSimple>)[\s\S])*?>2<\/w:t>/,
    );
    expect(xml).toMatch(
      /SEQ MdToDocxTable[^"]*">(?:(?!<\/w:fldSimple>)[\s\S])*?>1<\/w:t>/,
    );
    expect(fieldInstructions(xml, "SEQ")).toHaveLength(3);
  });

  it("keeps the first duplicate ID and preserves later duplicate syntax by default", async () => {
    const xml = await render(`![First](${ONE_PX_PNG})

: First caption {#fig:duplicate}

![Second](${ONE_PX_PNG})

: Duplicate caption {#fig:duplicate}

See [@fig:duplicate].`);

    expect(fieldInstructions(xml, "SEQ")).toHaveLength(1);
    expect(xml).toContain("Duplicate caption");
    expect(xml).toContain("{#fig:duplicate}");
    expect(xml).toContain("Figure 1");
  });

  it("can fail on duplicate, malformed, and unresolved identifiers", async () => {
    const duplicate = `![One](${ONE_PX_PNG})

: One {#fig:same}

![Two](${ONE_PX_PNG})

: Two {#fig:same}`;
    await expect(
      convertMarkdownToDocx(duplicate, {
        captions: { failureMode: "throw" },
      }),
    ).rejects.toThrow("Duplicate caption identifier");

    await expect(
      convertMarkdownToDocx(`![Bad](${ONE_PX_PNG})

: Bad ID {#tbl:not-a-figure}`, {
        captions: { failureMode: "throw" },
      }),
    ).rejects.toThrow("Figure captions require a fig: identifier");

    await expect(
      convertMarkdownToDocx("Missing [@fig:unknown].", {
        captions: { failureMode: "throw" },
      }),
    ).rejects.toThrow(MarkdownConversionError);
    await expect(
      convertMarkdownToDocx("Missing [@fig:unknown].", {
        captions: { failureMode: "throw" },
      }),
    ).rejects.toThrow("Unresolved cross-reference");
  });

  it("preserves unresolved references as literal text by default", async () => {
    const xml = await render("Missing [@tbl:nope] remains visible.");

    expect(xml).toContain("[@tbl:nope]");
    expect(fieldInstructions(xml, "REF")).toHaveLength(0);
  });

  it("sanitizes unsafe IDs into stable collision-resistant Word bookmarks", async () => {
    const markdown = `See [@fig:a/b?c].

![Unsafe ID](${ONE_PX_PNG})

: Unsafe identifier {#fig:a/b?c}`;
    const first = await render(markdown);
    const second = await render(markdown);
    const bookmark = first.match(/w:name="(mdxref_[^"]+)"/)?.[1];

    expect(bookmark).toBeDefined();
    expect(bookmark).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/);
    expect(bookmark).not.toContain("/");
    expect(bookmark).not.toContain("?");
    expect(second).toContain(`w:name="${bookmark}"`);
    expect(first).toContain(`REF ${bookmark} \\h`);
  });

  it("applies typed labels, placement, and caption styling", async () => {
    const xml = await render(
      `![Styled](${ONE_PX_PNG})

: Styled caption {#fig:styled}`,
      {
        captions: {
          figureLabel: "Illustration",
          figurePlacement: "above",
          alignment: "LEFT",
          italic: true,
          size: 20,
        },
      },
    );
    const captionIndex = xml.indexOf("Illustration");
    const imageIndex = xml.indexOf("<w:drawing>");

    expect(captionIndex).toBeGreaterThan(-1);
    expect(captionIndex).toBeLessThan(imageIndex);
    expect(xml.slice(captionIndex - 500, captionIndex)).toContain('w:val="left"');
    expect(xml).toMatch(/<w:i\/>[\s\S]*?<w:sz w:val="20"\/>/);
  });

  it("does not reinterpret ordinary images, tables, links, or inline code", async () => {
    const blob = await convertMarkdownToDocx(`![Accessible ordinary image](${ONE_PX_PNG})

| A | B |
| --- | --- |
| 1 | 2 |

[External link](https://example.com) and \`[@fig:literal]\`.`);
    const xml = await getDocumentXml(blob);
    const rels = await (await getZip(blob))
      .file("word/_rels/document.xml.rels")
      ?.async("string");

    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("[@fig:literal]");
    expect(xml).toContain('descr="Accessible ordinary image"');
    expect(fieldInstructions(xml, "SEQ")).toHaveLength(0);
    expect(fieldInstructions(xml, "REF")).toHaveLength(0);
    expect(rels).toContain("https://example.com");
  });
});
