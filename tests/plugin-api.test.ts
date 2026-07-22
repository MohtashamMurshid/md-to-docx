import { describe, expect, it } from "@jest/globals";
import type { Node, Parent, Root } from "mdast";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
  patchMarkdownInDocxToBuffer,
} from "../src/index";
import type {
  MarkdownDocxPlugin,
  PluginRenderContext,
  PluginRenderResult,
} from "../src/index";
import { getDocumentXml, getZip } from "./helpers";
import { Document, Packer, Paragraph } from "docx";

const ONE_PX_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==",
  "base64",
);

function fencePlugin(
  name: string,
  render: (value: string, context: PluginRenderContext) => PluginRenderResult,
  options: { language?: string; priority?: number; failureMode?: "fallback" | "skip" | "throw" } = {},
): MarkdownDocxPlugin {
  return {
    apiVersion: 1,
    name,
    priority: options.priority,
    fencedBlocks: [
      {
        languages: [options.language ?? "notice"],
        failureMode: options.failureMode,
        render: (input, context) => render(input.value, context),
      },
    ],
  };
}

function replaceMarkedParagraphs(root: Root): void {
  const walk = (parent: Parent): void => {
    parent.children = parent.children.map((node) => {
      if (
        node.type === "paragraph" &&
        node.children.length === 1 &&
        node.children[0].type === "text" &&
        node.children[0].value.startsWith(":::note ")
      ) {
        const text = node.children[0].value.slice(":::note ".length);
        return {
          type: "noteDirective",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: text }],
            },
          ],
        } as unknown as Node;
      }
      if ("children" in node && Array.isArray(node.children)) {
        walk(node as Parent);
      }
      return node;
    }) as Parent["children"];
  };
  walk(root);
}

describe("stable custom renderer plugin API", () => {
  it("renders a custom fenced block with semantic content", async () => {
    const xml = await getDocumentXml(
      await convertMarkdownToDocx("```notice\nShip it\n```", {
        plugins: [
          fencePlugin("acme.notice", (value) => ({
            type: "paragraph",
            children: [{ type: "text", value: `NOTICE: ${value}`, bold: true }],
          })),
        ],
      }),
    );

    expect(xml).toContain("NOTICE: Ship it");
    expect(xml).toContain("<w:b/>");
    expect(xml).not.toContain("notice</w:t>");
  });

  it("transforms and renders custom block nodes inside lists with controlled children", async () => {
    const parents: string[] = [];
    const plugin: MarkdownDocxPlugin = {
      apiVersion: 1,
      name: "acme.directives",
      transformAst(root) {
        replaceMarkedParagraphs(root);
      },
      blockNodes: [
        {
          nodeTypes: ["noteDirective"],
          render(_input, context) {
            parents.push(context.parent);
            return [
              { type: "paragraph", children: "Note" },
              context.renderChildren(),
            ];
          },
        },
      ],
    };
    const xml = await getDocumentXml(
      await convertMarkdownToDocx("- :::note Nested body", { plugins: [plugin] }),
    );

    expect(parents).toEqual(["list"]);
    expect(xml).toContain("Note");
    expect(xml).toContain("Nested body");
    expect(xml.match(/<w:numPr>/g)?.length).toBe(1);
  });

  it("reports blockquote/callout and footnote nesting without dropping output", async () => {
    const parents: string[] = [];
    const plugin = fencePlugin("acme.contexts", (value, context) => {
      parents.push(context.parent);
      return { type: "paragraph", children: value };
    });
    const blob = await convertMarkdownToDocx(
      `> [!NOTE]
> \`\`\`notice
> quoted plugin
> \`\`\`

Footnote reference[^plugin].

[^plugin]:
    \`\`\`notice
    footnote plugin
    \`\`\``,
      { plugins: [plugin] },
    );
    const zip = await getZip(blob);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const footnotesXml = await zip.file("word/footnotes.xml")?.async("string");

    expect(documentXml).toContain("quoted plugin");
    expect(footnotesXml).toContain("footnote plugin");
    expect(parents).toEqual(["blockquote", "footnote"]);
  });

  it("awaits async setup/transforms/renderers and cancels through AbortSignal", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const plugin: MarkdownDocxPlugin<{ prefix: string }> = {
      apiVersion: 1,
      name: "acme.async",
      async setup() {
        await Promise.resolve();
        calls.push("setup");
        return { prefix: "async" };
      },
      async transformAst(_root, context) {
        await Promise.resolve();
        calls.push(context.state.prefix);
      },
      fencedBlocks: [
        {
          languages: ["wait"],
          async render(_input, context) {
            calls.push("render");
            markStarted?.();
            await new Promise<void>((_resolve, reject) => {
              context.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
                once: true,
              });
            });
            return { type: "paragraph", children: "unreachable" };
          },
        },
      ],
    };

    const conversion = convertMarkdownToDocx("```wait\nx\n```", {
      plugins: [plugin],
      signal: controller.signal,
    });
    await started;
    controller.abort("test cancellation");

    await expect(conversion).rejects.toMatchObject({
      name: "MarkdownConversionError",
      message: "Markdown conversion was aborted",
    });
    expect(calls).toEqual(["setup", "async", "render"]);
  });

  it("uses priority then registration order only when conflicts are explicitly allowed", async () => {
    const transformOrder: string[] = [];
    const low = fencePlugin("acme.low", () => ({ type: "paragraph", children: "low" }), {
      priority: 1,
    });
    const high = fencePlugin("acme.high", () => ({ type: "paragraph", children: "high" }), {
      priority: 10,
    });
    low.transformAst = () => {
      transformOrder.push("low");
    };
    high.transformAst = () => {
      transformOrder.push("high");
    };

    await expect(
      convertMarkdownToDocx("```notice\nx\n```", { plugins: [low, high] }),
    ).rejects.toThrow("Conflicting plugin fence handlers");

    const xml = await getDocumentXml(
      await convertMarkdownToDocx("```notice\nx\n```", {
        plugins: [low, high],
        pluginOptions: { conflictPolicy: "use-priority" },
      }),
    );
    expect(xml).toContain("high");
    expect(xml).not.toContain(">low<");
    expect(transformOrder).toEqual(["high", "low"]);

    const first = fencePlugin("acme.first", () => ({ type: "paragraph", children: "first" }));
    const second = fencePlugin("acme.second", () => ({ type: "paragraph", children: "second" }));
    const equalPriorityXml = await getDocumentXml(
      await convertMarkdownToDocx("```notice\nx\n```", {
        plugins: [first, second],
        pluginOptions: { conflictPolicy: "use-priority" },
      }),
    );
    expect(equalPriorityXml).toContain("first");
    expect(equalPriorityXml).not.toContain(">second<");
  });

  it("rejects duplicate plugin names, duplicate handlers, and built-in collisions", async () => {
    const duplicateHandler: MarkdownDocxPlugin = {
      apiVersion: 1,
      name: "acme.duplicate-handler",
      fencedBlocks: [
        { languages: ["same", "SAME"], render: () => ({ type: "skip" }) },
      ],
    };
    const duplicateAcrossHandlers: MarkdownDocxPlugin = {
      apiVersion: 1,
      name: "acme.duplicate-across-handlers",
      fencedBlocks: [
        { languages: ["same"], render: () => ({ type: "skip" }) },
        { languages: ["SAME"], render: () => ({ type: "skip" }) },
      ],
    };
    await expect(
      convertMarkdownToDocx("text", {
        plugins: [fencePlugin("acme.same", () => ({ type: "skip" })), fencePlugin("acme.same", () => ({ type: "skip" }))],
      }),
    ).rejects.toThrow("Duplicate plugin name");
    await expect(
      convertMarkdownToDocx("text", { plugins: [duplicateHandler] }),
    ).rejects.toThrow("Duplicate plugin fence handler name");
    await expect(
      convertMarkdownToDocx("text", {
        plugins: [duplicateAcrossHandlers],
        pluginOptions: { conflictPolicy: "use-priority" },
      }),
    ).rejects.toThrow("Duplicate plugin fence handler");
    await expect(
      convertMarkdownToDocx("```mermaid\ngraph TD\n```", {
        mermaidRendering: { enabled: true, render: () => null },
        plugins: [fencePlugin("acme.mermaid", () => ({ type: "skip" }), { language: "mermaid" })],
      }),
    ).rejects.toThrow("conflicts with an enabled built-in renderer");
  });

  it.each<["fallback" | "skip" | "throw", boolean, boolean]>([
    ["fallback", true, false],
    ["skip", false, false],
    ["throw", false, true],
  ])("applies the %s failure policy", async (failureMode, keepsCode, throws) => {
    const options = {
      plugins: [
        fencePlugin("acme.failure", () => {
          throw new Error("renderer exploded");
        }, { failureMode }),
      ],
    };
    if (throws) {
      await expect(convertMarkdownToDocx("```notice\nsource\n```", options)).rejects.toThrow(
        MarkdownConversionError,
      );
      return;
    }
    const xml = await getDocumentXml(
      await convertMarkdownToDocx("```notice\nsource\n```", options),
    );
    expect(xml.includes("source")).toBe(keepsCode);
  });

  it("adds plugin, hook, language, and section details to thrown errors", async () => {
    try {
      await convertMarkdownToDocx("", {
        sections: [{ markdown: "plain" }, { markdown: "```notice\nx\n```" }],
        plugins: [
          fencePlugin("acme.context", () => {
            throw new Error("bad output");
          }, { failureMode: "throw" }),
        ],
      });
      throw new Error("expected conversion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownConversionError);
      expect((error as MarkdownConversionError).context).toMatchObject({
        plugin: "acme.context",
        hook: "fence",
        language: "notice",
        section: { index: 1, count: 2, kind: "section" },
      });
    }
  });

  it("enforces transformed element limits and plugin image budgets", async () => {
    const expanding: MarkdownDocxPlugin = {
      apiVersion: 1,
      name: "acme.expanding",
      transformAst(root) {
        root.children.push(
          { type: "paragraph", children: [{ type: "text", value: "extra one" }] },
          { type: "paragraph", children: [{ type: "text", value: "extra two" }] },
        );
      },
    };
    await expect(
      convertMarkdownToDocx("base", { plugins: [expanding], maxElements: 2 }),
    ).rejects.toThrow("Markdown element count exceeds maxElements");
    await expect(
      convertMarkdownToDocx("```notice\nbase\n```", {
        plugins: [
          fencePlugin("acme.output-limit", () => [
            { type: "paragraph", children: "one" },
            { type: "paragraph", children: "two" },
          ]),
        ],
        maxElements: 2,
      }),
    ).rejects.toThrow("Markdown element count exceeds maxElements");

    const imagePlugin = fencePlugin("acme.images", () => ({
      type: "image",
      data: ONE_PX_PNG_BYTES,
      contentType: "image/png",
      alt: "plugin asset",
    }));
    const blob = await convertMarkdownToDocx(
      "```notice\none\n```\n\n```notice\ntwo\n```",
      { plugins: [imagePlugin], imageHandling: { maxImages: 1 } },
    );
    const zip = await getZip(blob);
    const xml = await getDocumentXml(blob);
    const media = Object.keys(zip.files).filter((path) => path.startsWith("word/media/") && !path.endsWith("/"));
    expect(media).toHaveLength(1);
    expect(xml).toContain("Image could not be loaded");
  });

  it("shares plugin state across sections but isolates separate conversions", async () => {
    const seenSections: number[] = [];
    const plugin: MarkdownDocxPlugin<{ count: number }> = {
      apiVersion: 1,
      name: "acme.state",
      setup: () => ({ count: 0 }),
      fencedBlocks: [
        {
          languages: ["counter"],
          render(_input, context) {
            seenSections.push(context.section.index);
            context.state.count++;
            return { type: "paragraph", children: `count ${context.state.count}` };
          },
        },
      ],
    };
    const first = await getDocumentXml(
      await convertMarkdownToDocx("", {
        sections: [
          { markdown: "```counter\nx\n```" },
          { markdown: "```counter\ny\n```" },
        ],
        plugins: [plugin],
      }),
    );
    const second = await getDocumentXml(
      await convertMarkdownToDocx("```counter\nz\n```", { plugins: [plugin] }),
    );
    expect(first).toContain("count 1");
    expect(first).toContain("count 2");
    expect(second).toContain("count 1");
    expect(seenSections).toEqual([0, 1, 0]);
  });

  it("preserves no-plugin output and supports reference-DOCX patching", async () => {
    const markdown = "# Stable\n\n```mermaid\ngraph TD\n```";
    const withoutPlugins = await getDocumentXml(await convertMarkdownToDocx(markdown));
    const emptyPlugins = await getDocumentXml(
      await convertMarkdownToDocx(markdown, { plugins: [] }),
    );
    expect(emptyPlugins).toBe(withoutPlugins);

    const template = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph("{{body}}")]}] }),
    );
    const output = await patchMarkdownInDocxToBuffer(
      template,
      { body: "```notice\npatched by plugin\n```" },
      {
        plugins: [
          fencePlugin("acme.patch", (value, context) => ({
            type: "paragraph",
            children: `${context.section.placeholder}: ${value}`,
          })),
        ],
      },
    );
    const zip = await getZip(new Blob([output]));
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toContain("body: patched by plugin");
  });

  it("rejects unsupported plugin tables in lists instead of silently dropping them", async () => {
    const plugin = fencePlugin(
      "acme.table",
      () => ({ type: "table", headers: ["A"], rows: [["B"]] }),
      { failureMode: "throw" },
    );
    await expect(
      convertMarkdownToDocx("- ```notice\n  x\n  ```", { plugins: [plugin] }),
    ).rejects.toThrow("not supported inside lists");
  });
});
