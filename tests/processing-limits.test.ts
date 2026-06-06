import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
  parseToDocxOptions,
} from "../src/index";
import { modelToDocx } from "../src/modelToDocx";
import type { DocxDocumentModel } from "../src/docxModel";
import type { Options, Style } from "../src/types";

afterEach(() => {
  jest.restoreAllMocks();
});

const invalidLimitCases: Array<{
  optionName: keyof Pick<Options, "maxInputLength" | "maxElements">;
  value: number;
}> = [
  { optionName: "maxInputLength", value: 0 },
  { optionName: "maxInputLength", value: 1.5 },
  { optionName: "maxElements", value: 0 },
  { optionName: "maxElements", value: Number.POSITIVE_INFINITY },
];

const testStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
};

describe("Processing limits", () => {
  it("rejects oversized single markdown input when maxInputLength is set", async () => {
    await expect(
      parseToDocxOptions("123456", { maxInputLength: 5 })
    ).rejects.toThrow("Markdown input length exceeds maxInputLength");
  });

  it("rejects summed multi-section markdown input when maxInputLength is set", async () => {
    await expect(
      parseToDocxOptions("", {
        maxInputLength: 5,
        sections: [{ markdown: "123" }, { markdown: "456" }],
      })
    ).rejects.toThrow("Markdown input length exceeds maxInputLength");
  });

  it.each(invalidLimitCases)(
    "rejects invalid $optionName values",
    async ({ optionName, value }) => {
      await expect(
        parseToDocxOptions("Valid input", {
          [optionName]: value,
        } as Options)
      ).rejects.toBeInstanceOf(MarkdownConversionError);
    }
  );

  it("rejects invalid signal values", async () => {
    await expect(
      parseToDocxOptions("Valid input", {
        signal: { aborted: false } as unknown as AbortSignal,
      })
    ).rejects.toThrow("Invalid signal");
  });

  it("rejects markdown that exceeds maxElements", async () => {
    await expect(
      parseToDocxOptions("Hello", { maxElements: 1 })
    ).rejects.toThrow("Markdown element count exceeds maxElements");
  });

  it("applies maxElements across sections", async () => {
    await expect(
      parseToDocxOptions("", {
        maxElements: 3,
        sections: [{ markdown: "# One" }, { markdown: "# Two" }],
      })
    ).rejects.toThrow("Markdown element count exceeds maxElements");
  });

  it("does not apply input length or element limits by default", async () => {
    await expect(parseToDocxOptions("a".repeat(1_048_577))).resolves.toBeDefined();
  });
});

describe("Conversion cancellation", () => {
  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));

    await expect(
      convertMarkdownToDocx("# Cancelled", { signal: controller.signal })
    ).rejects.toThrow("Markdown conversion was aborted");
  });

  it("rejects when the signal aborts during remote image fetch", async () => {
    const controller = new AbortController();
    jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      setTimeout(() => {
        controller.abort(new Error("caller cancelled"));
      }, 0);

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }) as never;
    });

    await expect(
      convertMarkdownToDocx("![remote](https://93.184.216.34/image.png)", {
        imageHandling: { remote: { enabled: true } },
        signal: controller.signal,
      })
    ).rejects.toThrow("Markdown conversion was aborted");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rethrows image aborts from model rendering", async () => {
    const controller = new AbortController();
    const model: DocxDocumentModel = {
      children: [
        {
          type: "image",
          alt: "remote",
          url: "https://93.184.216.34/image.png",
        },
      ],
    };

    jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      setTimeout(() => {
        controller.abort(new Error("caller cancelled"));
      }, 0);

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }) as never;
    });

    await expect(
      modelToDocx(
        model,
        testStyle,
        {
          imageHandling: { remote: { enabled: true } },
          signal: controller.signal,
        },
      )
    ).rejects.toThrow("Markdown conversion was aborted");
  });
});
