import { describe, expect, it } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import type { Options } from "../src/types";
import { getDocumentXml, saveBlobForDebug } from "./helpers";

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return getDocumentXml(blob);
}

const JS_MARKDOWN = `\`\`\`javascript
const x = 1;
function greet(name) {
  return "Hello, " + name;
}
\`\`\``;

describe("Code highlighting: disabled by default", () => {
  it("does not emit per-token colors when codeHighlighting is absent", async () => {
    const xml = await render(JS_MARKDOWN);

    // Baseline code block uses a single grey (#444444) color on runs.
    expect(xml).toContain('w:val="444444"');
    // Default theme's GitHub-light keyword color is NOT expected.
    expect(xml).not.toContain('w:val="D73A49"');
    expect(xml).toContain("const x = 1;");
  });

  it("does not emit per-token colors when enabled is false", async () => {
    const xml = await render(JS_MARKDOWN, {
      codeHighlighting: { enabled: false },
    });

    expect(xml).toContain('w:val="444444"');
    expect(xml).not.toContain('w:val="D73A49"');
  });
});

describe("Code highlighting: enabled with default theme", () => {
  it("emits keyword, number, and string colors for a JS snippet", async () => {
    const blob = await convertMarkdownToDocx(JS_MARKDOWN, {
      codeHighlighting: { enabled: true },
    });
    await saveBlobForDebug(blob, "code-highlighting-default.docx");
    const xml = await getDocumentXml(blob);

    // Default theme (GitHub-light):
    //   keyword -> D73A49 (e.g. `const`, `function`, `return`)
    //   number  -> 005CC5 (e.g. `1`)
    //   string  -> 032F62 (e.g. `"Hello, "`)
    expect(xml).toContain('w:val="D73A49"');
    expect(xml).toContain('w:val="005CC5"');
    expect(xml).toContain('w:val="032F62"');

    // Background fill should use the themed default (pure white).
    expect(xml.toUpperCase()).toContain('W:FILL="FFFFFF"');

    // Highlighted output is split into per-token runs, so the raw source
    // string is not contiguous; check the individual tokens instead.
    expect(xml).toContain(">const</w:t>");
    expect(xml).toContain(">1</w:t>");
    expect(xml).toContain("Hello, ");
  });

  it("respects the default language label color", async () => {
    const xml = await render(JS_MARKDOWN, {
      codeHighlighting: { enabled: true },
    });

    // Themed language-label color is 6A737D; the un-themed default was 666666.
    expect(xml).toContain('w:val="6A737D"');
  });

  it("omits the language label when showLanguageLabel is false", async () => {
    const markdown = `\`\`\`javascript
const y = 2;
\`\`\``;

    const xml = await render(markdown, {
      codeHighlighting: { enabled: true, showLanguageLabel: false },
    });

    // With the label gone, the string "javascript" should not appear as a run.
    expect(xml).not.toMatch(/<w:t[^>]*>javascript<\/w:t>/);
    // But the body is still highlighted.
    expect(xml).toContain('w:val="D73A49"');
  });
});

describe("Code highlighting: unknown language falls back to plain", () => {
  it("does not throw and keeps the plain-grey run output", async () => {
    const markdown = `\`\`\`doesnotexist
keyword value 1 2 3
\`\`\``;

    const xml = await render(markdown, {
      codeHighlighting: { enabled: true },
    });

    // Highlighting enabled + unknown language => fallback path, which still
    // uses the themed default color (24292E), never the keyword color.
    expect(xml).toContain('w:val="24292E"');
    expect(xml).not.toContain('w:val="D73A49"');
    expect(xml).toContain("keyword value 1 2 3");
  });

  it("does not throw when the code block has no language at all", async () => {
    const markdown = `\`\`\`
const plain = true;
\`\`\``;

    const xml = await render(markdown, {
      codeHighlighting: { enabled: true },
    });

    expect(xml).toContain("const plain = true");
    expect(xml).not.toContain('w:val="D73A49"');
  });
});

describe("Code highlighting: custom theme override", () => {
  it("uses a user-supplied keyword color over the default", async () => {
    const customKeyword = "FF00AA";
    const customBackground = "101010";

    const xml = await render(JS_MARKDOWN, {
      codeHighlighting: {
        enabled: true,
        theme: {
          keyword: customKeyword,
          background: customBackground,
        },
      },
    });

    // Custom colors present, GitHub-light defaults for overridden keys absent.
    expect(xml).toContain(`w:val="${customKeyword}"`);
    expect(xml).not.toContain('w:val="D73A49"');
    expect(xml.toUpperCase()).toContain(`W:FILL="${customBackground}"`);

    // Non-overridden theme entries should still come from the default theme.
    expect(xml).toContain('w:val="005CC5"'); // number color untouched
    expect(xml).toContain('w:val="032F62"'); // string color untouched
  });
});

describe("Code highlighting: newline preservation", () => {
  it("keeps explicit line breaks in multi-line highlighted code", async () => {
    const xml = await render(JS_MARKDOWN, {
      codeHighlighting: { enabled: true },
    });

    // docx uses <w:br /> for soft breaks (break: 1). The snippet has 4 body
    // lines, so at minimum 3 line-break runs should appear inside the code
    // paragraph. Using a conservative lower bound to avoid flakiness across
    // lowlight/docx versions.
    const breakMatches = xml.match(/<w:br\b/g) || [];
    expect(breakMatches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Code highlighting: language whitelist", () => {
  it("falls back to plain rendering when the language is not in the whitelist", async () => {
    const markdown = `\`\`\`python
def greet(name):
    return "Hello, " + name
\`\`\``;

    const xml = await render(markdown, {
      codeHighlighting: {
        enabled: true,
        languages: ["javascript"],
      },
    });

    expect(xml).toContain("def greet(name):");
    // python keywords should not be themed because python wasn't whitelisted;
    // the fallback path still uses the themed default color (24292E).
    expect(xml).not.toContain('w:val="D73A49"');
    expect(xml).toContain('w:val="24292E"');
  });
});
