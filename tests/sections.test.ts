import { describe, expect, it } from "@jest/globals";
import { convertMarkdownToDocx, parseToDocxOptions } from "../src/index";
import type { Options } from "../src/types";

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

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
