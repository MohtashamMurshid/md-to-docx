import { describe, expect, it } from "vitest";
import { convertMarkdownToDocx, MarkdownConversionError } from "../src/index.js";
import type { ConversionWarning, Options } from "../src/types.js";
import { getDocumentXml } from "./helpers.js";

const HTML_ON: Options = { htmlRendering: { enabled: true } };

async function render(markdown: string, options?: Options): Promise<string> {
  return getDocumentXml(await convertMarkdownToDocx(markdown, options));
}

describe("htmlRendering", () => {
  it("leaves raw HTML as it was when the option is off", async () => {
    const markdown = "E = mc<sup>2</sup>\n\n<table><tr><td>Ada</td></tr></table>";

    const xml = await render(markdown);

    expect(xml).toContain("&lt;sup&gt;");
    expect(xml).not.toContain("<w:tbl>");
    expect(xml).not.toContain("Ada");
    expect(await render(markdown, { htmlRendering: { enabled: false } })).toBe(xml);
  });

  it.each([
    { name: "a non-object", htmlRendering: "on" },
    { name: "an array", htmlRendering: [] },
    { name: "a non-boolean enabled", htmlRendering: { enabled: "yes" } },
  ])("rejects $name htmlRendering option", async ({ htmlRendering }) => {
    // Plain-JS callers and CLI JSON can pass any value.
    const options: unknown = { htmlRendering };

    await expect(
      convertMarkdownToDocx("text", options as Options),
    ).rejects.toThrow(MarkdownConversionError);
  });

  it("renders inline <sup> as a superscript run", async () => {
    const xml = await render("E = mc<sup>2</sup>", HTML_ON);

    expect(xml).toMatch(
      /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t[^>]*>2<\/w:t>/,
    );
    expect(xml).not.toContain("&lt;sup");
  });

  it("keeps the Markdown formatting an inline HTML element wraps", async () => {
    const xml = await render(
      "<u>**b** *i* ~~s~~ `c` [l](https://example.com/)</u>",
      HTML_ON,
    );

    expect(xml).toMatch(/<w:b\/>.*<w:u w:val="single"\/>.*>b<\/w:t>/);
    expect(xml).toMatch(/<w:i\/>.*<w:u w:val="single"\/>.*>i<\/w:t>/);
    expect(xml).toMatch(/<w:strike\/>.*>s<\/w:t>/);
    expect(xml).toMatch(/<w:hyperlink [^>]*>.*>l<\/w:t>/);
    expect(xml).toContain(">c</w:t>");
    expect(xml).not.toContain("&lt;u");
  });

  it("renders inline <br> as a line break", async () => {
    const xml = await render("one<br>two", HTML_ON);

    expect(xml).toMatch(/>one<\/w:t><\/w:r>.*<w:br\/>.*>two<\/w:t>/s);
    expect(xml).not.toContain("&lt;br");
  });

  it("renders a block <table> as a Word table", async () => {
    const xml = await render(
      "<table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table>",
      HTML_ON,
    );

    expect(xml).toMatch(/<w:tbl>.*>Name<.*>Ada<.*<\/w:tbl>/s);
  });

  it("renders nested HTML lists at their nesting levels", async () => {
    const xml = await render(
      "<ul><li>one<ul><li>two</li></ul></li></ul>",
      HTML_ON,
    );

    expect(xml).toMatch(/<w:ilvl w:val="0"\/>.*?>one</s);
    expect(xml).toMatch(/<w:ilvl w:val="1"\/>.*?>two</s);
  });

  it.each([
    { name: "malformed", html: "<div>a < b broken</div>", text: "broken" },
    { name: "too deeply nested", html: `${"<div>".repeat(5000)}deep`, text: "deep" },
  ])("falls back to the default for $name HTML with a warning", async ({ html, text }) => {
    const warnings: ConversionWarning[] = [];

    const xml = await render(`Before\n\n${html}`, {
      ...HTML_ON,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(xml).toContain("Before");
    expect(xml).not.toContain(text);
    expect(warnings.map((warning) => warning.code)).toContain("HTML_FALLBACK");
  });

  it.each([
    { name: "200,000 nested block <div>s", markdown: `${"<div>".repeat(200_000)}deep` },
    { name: "100,000 unclosed inline <b>s", markdown: `x${"<b>".repeat(100_000)}deep` },
  ])("falls back without quadratic parsing for $name", async ({ markdown }) => {
    const warnings: ConversionWarning[] = [];
    const started = performance.now();

    await render(markdown, {
      ...HTML_ON,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(performance.now() - started).toBeLessThan(5_000);
    expect(warnings.map((warning) => warning.code)).toContain("HTML_FALLBACK");
  }, 30_000);

  it.each([
    { name: "text", html: "<p>the word pagebreak</p>", text: "the word pagebreak" },
    { name: "an attribute", html: "<p>before<img src='pagebreak.png' alt='x'></p>", text: "before" },
  ])("renders HTML that mentions pagebreak in $name as HTML, not a page break", async ({ html, text }) => {
    const xml = await render(`${html}\n\n\\pagebreak\n\nafter`, HTML_ON);
    const withoutHtml = await render(html);

    expect(xml).toContain(text);
    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(1);
    expect(withoutHtml).toContain('<w:br w:type="page"/>');
  });

  it("keeps a lone <!-- pagebreak --> comment as a page break with HTML rendering on", async () => {
    const xml = await render("before\n\n<!-- pagebreak -->\n\nafter", HTML_ON);

    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(1);
    expect(xml).toContain("before");
    expect(xml).toContain("after");
  });

  it("counts HTML elements toward maxElements", async () => {
    const cells = "<td>x</td>".repeat(50);

    await expect(
      convertMarkdownToDocx(`<table><tr>${cells}</tr></table>`, {
        ...HTML_ON,
        maxElements: 40,
      }),
    ).rejects.toThrow("Markdown element count exceeds maxElements");
  });
});
