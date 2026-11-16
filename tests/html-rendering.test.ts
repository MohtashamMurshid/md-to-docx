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

  it.each(["<br>", '<br class="x">', '<br data-x="1"/>', "<BR>"])(
    "renders inline %s as a line break",
    async (tag) => {
      const xml = await render(`one${tag}two`, HTML_ON);

      expect(xml).toMatch(/>one<\/w:t><\/w:r>.*<w:br\/>.*>two<\/w:t>/s);
      expect(xml).not.toMatch(/&lt;br/i);
    },
  );

  it.each([
    { name: "bold", markdown: "**bold <sup>2</sup>**", text: "2", property: "<w:b/>" },
    { name: "italic", markdown: "*it <sup>2</sup>*", text: "2", property: "<w:i/>" },
    { name: "strikethrough", markdown: "~~gone <sup>2</sup>~~", text: "2", property: "<w:strike/>" },
    { name: "bold, around malformed HTML", markdown: "**bold <span/>**", text: "&lt;span/&gt;", property: "<w:b/>" },
  ])("applies the $name around inline HTML to its runs", async ({ markdown, text, property }) => {
    const xml = await render(markdown, HTML_ON);

    const run = new RegExp(`<w:r>(?:(?!<w:r>).)*>${text}</w:t>`).exec(xml)?.[0];
    expect(run).toContain(property);
  });

  it.each([
    { name: "inline HTML", markdown: "[x <sup>2</sup>](https://example.com/)", text: "2" },
    { name: "malformed inline HTML", markdown: "[x <span/>](https://example.com/)", text: "&lt;span/&gt;" },
  ])("keeps $name in link text inside the hyperlink", async ({ markdown, text }) => {
    const xml = await render(markdown, HTML_ON);

    expect(xml).toMatch(
      new RegExp(`<w:hyperlink [^>]*>(?:(?!</w:hyperlink>).)*>${text}</w:t>`),
    );
  });

  it.each([
    {
      name: "an element in the same HTML",
      markdown: '<div><a href="#target">Go</a> <span id="target">There</span></div>',
    },
    {
      name: "a Markdown heading, from an HTML block",
      markdown: '# Some Markdown Heading\n\n<div><a href="#some-markdown-heading">Go</a></div>',
    },
    {
      name: "a Markdown heading, from inline HTML",
      markdown: '# Some Markdown Heading\n\nSee <a href="#some-markdown-heading">Go</a>',
    },
  ])("links an HTML fragment to $name", async ({ markdown }) => {
    const warnings: ConversionWarning[] = [];

    const xml = await render(markdown, {
      ...HTML_ON,
      onWarning: (warning) => warnings.push(warning),
    });

    const anchor = /<w:hyperlink [^>]*w:anchor="([^"]+)"/.exec(xml)?.[1];
    expect(anchor).toBeDefined();
    expect(xml).toContain(`<w:bookmarkStart w:name="${anchor ?? ""}"`);
    expect(warnings).toEqual([]);
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
    // HTML ignores the slash on a non-void start tag, so these nest too.
    { name: "200,000 block <div/>s", markdown: `${"<div/>".repeat(200_000)}deep` },
    { name: "200,000 inline <span/>s", markdown: `x${"<span/>".repeat(200_000)}deep` },
    { name: "20,000 unclosed inline <b>s before math", markdown: `x${"<b>".repeat(20_000)}$x$` },
    { name: "a 200 KB unclosed tag", markdown: `<div><a${"b".repeat(200_000)}` },
  ])("falls back without quadratic parsing for $name", async ({ markdown }) => {
    const warnings: ConversionWarning[] = [];
    // Compared with the same input with HTML rendering off, so the check holds
    // on any machine; the quadratic cases took 50-200 times longer.
    const baselineStarted = performance.now();
    await render(markdown);
    const baseline = performance.now() - baselineStarted;

    const started = performance.now();
    await render(markdown, {
      ...HTML_ON,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(performance.now() - started).toBeLessThan(baseline * 3 + 500);
    expect(warnings.map((warning) => warning.code)).toContain("HTML_FALLBACK");
  }, 60_000);

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
