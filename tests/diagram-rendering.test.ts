import { describe, expect, it, jest } from "@jest/globals";
import {
  convertMarkdownToDocx,
  MarkdownConversionError,
} from "../src/index";
import type { MermaidRenderInput, Options } from "../src/types";
import { getDocumentXml, getZip } from "./helpers";

const MERMAID_MARKDOWN = `Before.

\`\`\`mermaid
graph TD
  A[Start] --> B[Done]
\`\`\`

After.`;

const ONE_PX_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==",
  "base64",
);

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return getDocumentXml(blob);
}

async function mediaCount(markdown: string, options?: Options): Promise<number> {
  const blob = await convertMarkdownToDocx(markdown, options);
  const zip = await getZip(blob);
  return Object.keys(zip.files).filter(
    (path) => path.startsWith("word/media/") && !path.endsWith("/"),
  ).length;
}

function numberingMarkerCount(xml: string): number {
  return xml.match(/<w:numPr>/g)?.length || 0;
}

function zeroSpacingSpacerCount(xml: string): number {
  return xml.match(/w:before="0"[\s\S]*?w:after="0"/g)?.length || 0;
}

describe("Diagram rendering: Mermaid fenced blocks", () => {
  it("keeps mermaid fences as ordinary code blocks by default", async () => {
    const xml = await render(MERMAID_MARKDOWN);

    expect(xml).toContain("graph TD");
    expect(xml).toContain("mermaid");
    expect(xml).not.toContain("<w:drawing>");
    expect(await mediaCount(MERMAID_MARKDOWN)).toBe(0);
  });

  it("keeps mermaid fences as ordinary code blocks when disabled explicitly", async () => {
    const xml = await render(MERMAID_MARKDOWN, {
      mermaidRendering: { enabled: false },
    });

    expect(xml).toContain("graph TD");
    expect(xml).not.toContain("<w:drawing>");
  });

  it("embeds renderer output as a DOCX image when enabled", async () => {
    const renderMermaid = jest.fn((input: MermaidRenderInput) => {
      expect(input.code).toContain("graph TD");
      return {
        data: ONE_PX_PNG_BYTES,
        contentType: "image/png",
        width: 320,
        height: 180,
      };
    });

    const xml = await render(MERMAID_MARKDOWN, {
      mermaidRendering: {
        enabled: true,
        render: renderMermaid,
      },
    });

    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(xml).toContain("<w:drawing>");
    expect(xml).not.toContain("graph TD");
    expect(await mediaCount(MERMAID_MARKDOWN, {
      mermaidRendering: {
        enabled: true,
        render: () => ({
          data: ONE_PX_PNG_BYTES,
          contentType: "image/png",
        }),
      },
    })).toBe(1);
  });

  it("falls back to the original code block when rendering fails", async () => {
    const xml = await render(MERMAID_MARKDOWN, {
      mermaidRendering: {
        enabled: true,
        render: () => {
          throw new Error("Mermaid runtime unavailable");
        },
      },
    });

    expect(xml).toContain("graph TD");
    expect(xml).toContain("mermaid");
    expect(xml).not.toContain("<w:drawing>");
  });

  it("preserves a list marker when Mermaid fallback is the first list item block", async () => {
    const markdown = `- \`\`\`mermaid
  graph TD
    A --> B
  \`\`\``;

    const xml = await render(markdown, {
      mermaidRendering: {
        enabled: true,
        render: () => undefined,
      },
    });

    expect(xml).toContain("graph TD");
    expect(numberingMarkerCount(xml)).toBe(1);
  });

  it("keeps a spacer between adjacent Mermaid blocks that fall back to code", async () => {
    const markdown = `\`\`\`mermaid
graph TD
  A --> B
\`\`\`

\`\`\`mermaid
graph TD
  C --> D
\`\`\``;

    const xml = await render(markdown, {
      mermaidRendering: {
        enabled: true,
        render: () => {
          throw new Error("renderer unavailable");
        },
      },
    });

    expect(xml).toContain("A --&gt; B");
    expect(xml).toContain("C --&gt; D");
    expect(xml).toContain('w:before="0"');
    expect(xml).toContain('w:after="0"');
  });

  it("does not add a spacer after nested Mermaid fallback code", async () => {
    const options: Options = {
      mermaidRendering: {
        enabled: true,
        render: () => undefined,
      },
    };
    const topLevelCodeFence = `\`\`\`typescript
const topLevel = true;
\`\`\``;
    const listXml = await render(
      `- \`\`\`mermaid
  graph TD
    A --> B
  \`\`\`

${topLevelCodeFence}`,
      options,
    );
    const quoteXml = await render(
      `> \`\`\`mermaid
> graph TD
>   A --> B
> \`\`\`

${topLevelCodeFence}`,
      options,
    );

    expect(listXml).toContain("graph TD");
    expect(listXml).toContain("const topLevel");
    expect(zeroSpacingSpacerCount(listXml)).toBe(0);
    expect(quoteXml).toContain("graph TD");
    expect(quoteXml).toContain("const topLevel");
    expect(zeroSpacingSpacerCount(quoteXml)).toBe(0);
  });

  it("can render a placeholder or throw on render failure", async () => {
    const placeholderXml = await render(MERMAID_MARKDOWN, {
      mermaidRendering: {
        enabled: true,
        failureMode: "placeholder",
        render: () => undefined,
      },
    });

    expect(placeholderXml).toContain("Mermaid diagram could not be rendered");
    expect(placeholderXml).not.toContain("graph TD");

    await expect(
      convertMarkdownToDocx(MERMAID_MARKDOWN, {
        mermaidRendering: {
          enabled: true,
          failureMode: "throw",
          render: () => {
            throw new Error("bad diagram");
          },
        },
      }),
    ).rejects.toThrow(MarkdownConversionError);
  });
});
