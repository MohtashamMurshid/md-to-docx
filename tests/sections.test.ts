import { describe, expect, it } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
  parseToDocxOptions,
} from "../src/index";
import type { Options } from "../src/types";

describe("sections API", () => {
  it("builds distinct section properties, footers, and page numbering", async () => {
    const options: Options = {
      template: {
        pageNumbering: {
          display: "current",
          alignment: "RIGHT",
        },
      },
      sections: [
        {
          markdown: "# Cover\n\nCustom cover content.",
          footers: { default: null },
          pageNumbering: { display: "none" },
          style: { paragraphAlignment: "CENTER" },
        },
        {
          markdown: "# Body\n\nMain content starts here.",
          footers: {
            default: {
              text: "Page",
              pageNumberDisplay: "currentAndSectionTotal",
              alignment: "RIGHT",
            },
          },
          pageNumbering: { start: 1, formatType: "decimal" },
        },
      ],
    };

    const docxOptions = await parseToDocxOptions("", options);

    expect(docxOptions.sections).toHaveLength(2);
    expect(docxOptions.sections[0].footers).toBeUndefined();
    expect(docxOptions.sections[1].footers?.default).toBeDefined();
    expect(docxOptions.sections[1].properties?.page?.pageNumbers?.start).toBe(1);
    expect(docxOptions.sections[1].properties?.page?.pageNumbers?.formatType).toBe(
      "decimal"
    );
  });

  it("creates independent numbered-list references across sections", async () => {
    const docxOptions = await parseToDocxOptions("", {
      sections: [
        { markdown: "1. First section item\n2. Second item" },
        { markdown: "1. New section item\n2. Another section item" },
      ],
    });

    expect(docxOptions.numbering?.config).toHaveLength(2);
    expect(docxOptions.numbering?.config[0].reference).toBe("numbered-list-1");
    expect(docxOptions.numbering?.config[1].reference).toBe("numbered-list-2");
  });

  it("applies template and section-level advanced properties, including section types and numbering variants", async () => {
    const docxOptions = await parseToDocxOptions("", {
      template: {
        page: {
          margin: { top: 1600, left: 1200 },
        },
        headers: {
          default: { text: "Template Header", alignment: "LEFT" },
        },
        pageNumbering: { display: "current", alignment: "CENTER" },
      },
      sections: [
        {
          markdown: "# Intro\n\nTemplate should apply here.",
          titlePage: true,
          type: "ODD_PAGE",
          page: { size: { orientation: "LANDSCAPE" } },
          headers: {
            first: { text: "First Page Header", alignment: "RIGHT" },
          },
          footers: {
            default: {
              text: "Custom Footer",
              pageNumberDisplay: "currentAndTotal",
              alignment: "RIGHT",
            },
          },
          pageNumbering: {
            start: 5,
            formatType: "upperRoman",
            separator: "colon",
          },
        },
        {
          markdown: "# B\n\nTwo",
          type: "CONTINUOUS",
          pageNumbering: {
            start: 1,
            formatType: "lowerRoman",
            separator: "period",
          },
        },
        {
          markdown: "# C\n\nThree",
          type: "EVEN_PAGE",
          pageNumbering: {
            start: 1,
            formatType: "upperLetter",
            separator: "hyphen",
          },
        },
      ],
    });

    expect(docxOptions.sections).toHaveLength(3);

    const first = docxOptions.sections[0];
    expect(first.headers?.default).toBeDefined();
    expect(first.headers?.first).toBeDefined();
    expect(first.footers?.default).toBeDefined();
    expect(first.properties?.titlePage).toBe(true);
    expect(first.properties?.type).toBeDefined();
    expect(first.properties?.page?.size?.orientation).toBeDefined();
    expect(first.properties?.page?.margin?.top).toBe(1600);
    expect(first.properties?.page?.margin?.left).toBe(1200);
    expect(first.properties?.page?.pageNumbers?.start).toBe(5);
    expect(first.properties?.page?.pageNumbers?.formatType).toBeDefined();
    expect(first.properties?.page?.pageNumbers?.separator).toBeDefined();

    expect(docxOptions.sections[1].properties?.type).toBeDefined();
    expect(docxOptions.sections[1].properties?.page?.pageNumbers?.separator).toBeDefined();
    expect(docxOptions.sections[2].properties?.type).toBeDefined();
    expect(docxOptions.sections[2].properties?.page?.pageNumbers?.formatType).toBeDefined();
    expect(docxOptions.sections[2].footers?.default).toBeDefined();
  });

  it("supports per-section style overrides in full conversion", async () => {
    const blob = await convertMarkdownToDocx("", {
      style: { paragraphSize: 24 },
      sections: [
        {
          markdown: "# Section One\n\nSmaller text section.",
          style: { paragraphSize: 20 },
          pageNumbering: { display: "none" },
        },
        {
          markdown: "# Section Two\n\nLarger text section.",
          style: { paragraphSize: 30 },
          pageNumbering: { start: 1 },
        },
      ],
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it.each([
    {
      label: "invalid section type",
      section: { markdown: "# Bad", type: "BAD_TYPE" as any },
      expected: MarkdownConversionError,
    },
    {
      label: "invalid page orientation",
      section: {
        markdown: "# Bad",
        page: { size: { orientation: "SIDEWAYS" as any } },
      },
      expected: "Invalid page orientation",
    },
    {
      label: "invalid header alignment",
      section: {
        markdown: "# Bad",
        headers: {
          default: { text: "Header", alignment: "MIDDLE" as any },
        },
      },
      expected: "Invalid header/footer alignment",
    },
    {
      label: "invalid titlePage type",
      section: { markdown: "# Bad", titlePage: "yes" as any },
      expected: "Invalid titlePage",
    },
  ])("rejects $label", async ({ section, expected }) => {
    await expect(
      parseToDocxOptions("", { sections: [section] })
    ).rejects.toThrow(expected as any);
  });
});
