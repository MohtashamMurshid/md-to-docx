import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
  parseToDocxOptions,
} from "../src/index";
import type { Options } from "../src/types";

const outputDir = path.join(process.cwd(), "test-output");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

describe("sections API", () => {
  it("builds distinct section properties and footer behavior", async () => {
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
          footers: {
            default: null,
          },
          pageNumbering: {
            display: "none",
          },
          style: {
            paragraphAlignment: "CENTER",
          },
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
          pageNumbering: {
            start: 1,
            formatType: "decimal",
          },
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
        {
          markdown: "1. First section item\n2. Second item",
        },
        {
          markdown: "1. New section item\n2. Another section item",
        },
      ],
    });

    expect(docxOptions.numbering?.config).toHaveLength(2);
    expect(docxOptions.numbering?.config[0].reference).toBe("numbered-list-1");
    expect(docxOptions.numbering?.config[1].reference).toBe("numbered-list-2");
  });

  it("supports style overrides per section during full conversion", async () => {
    const blob = await convertMarkdownToDocx("", {
      style: {
        paragraphSize: 24,
      },
      sections: [
        {
          markdown: "# Section One\n\nSmaller text section.",
          style: {
            paragraphSize: 20,
          },
          pageNumbering: {
            display: "none",
          },
        },
        {
          markdown: "# Section Two\n\nLarger text section.",
          style: {
            paragraphSize: 30,
          },
          pageNumbering: {
            start: 1,
          },
        },
      ],
    });

    const arrayBuffer = await blob.arrayBuffer();
    const outputPath = path.join(outputDir, "sections-style-overrides.docx");
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("applies advanced section properties from template and section overrides", async () => {
    const docxOptions = await parseToDocxOptions("", {
      template: {
        page: {
          margin: {
            top: 1600,
            left: 1200,
          },
        },
        headers: {
          default: {
            text: "Template Header",
            alignment: "LEFT",
          },
        },
        pageNumbering: {
          display: "current",
          alignment: "CENTER",
        },
      },
      sections: [
        {
          markdown: "# Intro\n\nTemplate should apply here.",
          titlePage: true,
          type: "ODD_PAGE",
          page: {
            size: {
              orientation: "LANDSCAPE",
            },
          },
          headers: {
            first: {
              text: "First Page Header",
              alignment: "RIGHT",
            },
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
      ],
    });

    expect(docxOptions.sections).toHaveLength(1);
    expect(docxOptions.sections[0].headers?.default).toBeDefined();
    expect(docxOptions.sections[0].headers?.first).toBeDefined();
    expect(docxOptions.sections[0].footers?.default).toBeDefined();
    expect(docxOptions.sections[0].properties?.titlePage).toBe(true);
    expect(docxOptions.sections[0].properties?.type).toBeDefined();
    expect(docxOptions.sections[0].properties?.page?.size?.orientation).toBeDefined();
    expect(docxOptions.sections[0].properties?.page?.margin?.top).toBe(1600);
    expect(docxOptions.sections[0].properties?.page?.margin?.left).toBe(1200);
    expect(docxOptions.sections[0].properties?.page?.pageNumbers?.start).toBe(5);
    expect(docxOptions.sections[0].properties?.page?.pageNumbers?.formatType).toBeDefined();
    expect(docxOptions.sections[0].properties?.page?.pageNumbers?.separator).toBeDefined();
  });

  it("supports section type and page numbering variants across sections", async () => {
    const docxOptions = await parseToDocxOptions("", {
      template: {
        pageNumbering: {
          display: "current",
          alignment: "RIGHT",
        },
      },
      sections: [
        {
          markdown: "# A\n\nOne",
          type: "NEXT_PAGE",
          pageNumbering: {
            start: 1,
            formatType: "decimal",
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
    expect(docxOptions.sections[0].properties?.type).toBeDefined();
    expect(docxOptions.sections[1].properties?.type).toBeDefined();
    expect(docxOptions.sections[2].properties?.type).toBeDefined();
    expect(docxOptions.sections[1].properties?.page?.pageNumbers?.separator).toBeDefined();
    expect(docxOptions.sections[2].properties?.page?.pageNumbers?.formatType).toBeDefined();
    expect(docxOptions.sections[2].footers?.default).toBeDefined();
  });

  it("throws for invalid section type", async () => {
    await expect(
      parseToDocxOptions("", {
        sections: [
          {
            markdown: "# Bad",
            type: "BAD_TYPE" as any,
          },
        ],
      })
    ).rejects.toThrow(MarkdownConversionError);
  });

  it("throws for invalid page orientation", async () => {
    await expect(
      parseToDocxOptions("", {
        sections: [
          {
            markdown: "# Bad",
            page: {
              size: {
                orientation: "SIDEWAYS" as any,
              },
            },
          },
        ],
      })
    ).rejects.toThrow("Invalid page orientation");
  });

  it("throws for invalid header alignment", async () => {
    await expect(
      parseToDocxOptions("", {
        sections: [
          {
            markdown: "# Bad",
            headers: {
              default: {
                text: "Header",
                alignment: "MIDDLE" as any,
              },
            },
          },
        ],
      })
    ).rejects.toThrow("Invalid header/footer alignment");
  });

  it("throws for invalid titlePage type", async () => {
    await expect(
      parseToDocxOptions("", {
        sections: [
          {
            markdown: "# Bad",
            titlePage: "yes" as any,
          },
        ],
      })
    ).rejects.toThrow("Invalid titlePage");
  });
});
