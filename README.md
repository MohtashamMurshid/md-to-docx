# @mohtasham/md-to-docx

> Convert Markdown to Microsoft Word (`.docx`) documents — in Node.js, in the browser, or straight from your terminal.

[npm version](https://www.npmjs.com/package/@mohtasham/md-to-docx)
[npm downloads](https://www.npmjs.com/package/@mohtasham/md-to-docx)
[license](./LICENSE)
[types](https://www.npmjs.com/package/@mohtasham/md-to-docx)
[node](https://nodejs.org)

A TypeScript-first library and CLI that turns Markdown into production-ready Word documents: headings, tables, lists, images, code blocks with optional syntax highlighting, multi-section templates, per-section headers/footers, page numbering, TOC, and fine-grained style control.

---

## Table of contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [CLI](#cli)
- [Programmatic usage](#programmatic-usage)
  - [Browser](#browser)
  - [Node.js](#nodejs)
  - [React](#react)
- [Features](#features)
  - [Multi-section documents (template + sections)](#multi-section-documents-template--sections)
  - [Syntax-highlighted code blocks](#syntax-highlighted-code-blocks)
  - [Custom heading and paragraph alignment](#custom-heading-and-paragraph-alignment)
  - [Table of Contents styling](#table-of-contents-styling)
  - [Text find-and-replace](#text-find-and-replace)
  - [RTL / bidirectional text](#rtl--bidirectional-text)
- [Supported Markdown](#supported-markdown)
- [API reference](#api-reference)
- [Requirements](#requirements)
- [Install as an agent skill](#install-as-an-agent-skill)
- [Development](#development)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **Zero-config defaults** — pass any Markdown string, get a valid `.docx` Blob back.
- **First-class CLI** — `npx @mohtasham/md-to-docx input.md output.docx`.
- **TypeScript-native** — fully typed options surface, including `CodeHighlightTheme`, `Options`, and `DocumentSection`.
- **Multi-section documents** — cover pages, per-section headers/footers, page numbering resets, mixed orientations, style overrides.
- **Optional syntax highlighting** — opt-in, powered by `[lowlight](https://github.com/wooorm/lowlight)`; ships a GitHub-light theme and lets you override any token color.
- **Works everywhere** — Node.js (18+) and modern browsers; the package ships ESM with type declarations.
- **Small public surface, stable API** — only the root entrypoint is exported via `package.json#exports`.

## Installation

```bash
npm install @mohtasham/md-to-docx
# or
pnpm add @mohtasham/md-to-docx
# or
yarn add @mohtasham/md-to-docx
```

## Quick start

```typescript
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";
import fs from "node:fs/promises";

const markdown = `
# Hello, Word

This document was generated from **Markdown** in TypeScript.

- Supports lists
- **Bold**, *italic*, ++underline++, ~~strikethrough~~
- Tables, blockquotes, images, and code blocks

\`\`\`ts
const greet = (name: string) => \`Hello, \${name}!\`;
\`\`\`
`;

const blob = await convertMarkdownToDocx(markdown);
await fs.writeFile("hello.docx", Buffer.from(await blob.arrayBuffer()));
```

## CLI

Convert files without writing any code:

```bash
# Run without installing
npx @mohtasham/md-to-docx input.md output.docx

# Or install globally
npm install -g @mohtasham/md-to-docx
md-to-docx input.md output.docx

# Apply styling or multi-section config from a JSON file
md-to-docx input.md output.docx --options options.json
md-to-docx input.md output.docx -o options.json

# Help
md-to-docx --help
```

The `--options` JSON file accepts the same shape as the programmatic `Options` argument. Example:

```json
{
  "documentType": "report",
  "style": {
    "fontFamily": "Trebuchet MS",
    "heading1Alignment": "CENTER",
    "paragraphAlignment": "JUSTIFIED"
  },
  "codeHighlighting": { "enabled": true }
}
```

For a multi-section document, use `template` + `sections` (the CLI ignores the positional markdown argument when `sections` is provided):

```json
{
  "template": {
    "pageNumbering": { "display": "current", "alignment": "CENTER" }
  },
  "sections": [
    {
      "markdown": "# Cover\n\nPrepared for ACME",
      "footers": { "default": null },
      "pageNumbering": { "display": "none" }
    },
    {
      "markdown": "[TOC]\n\n# Body\n\nMain content…",
      "headers": { "default": { "text": "Main Section", "alignment": "RIGHT" } },
      "pageNumbering": { "start": 1, "formatType": "decimal" }
    }
  ]
}
```

## Programmatic usage

### Browser

```typescript
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const blob = await convertMarkdownToDocx("# Hello\n\nWorld.");
downloadDocx(blob, "hello.docx");
```

### Node.js

```typescript
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";
import fs from "node:fs/promises";

const blob = await convertMarkdownToDocx(await fs.readFile("input.md", "utf8"));
await fs.writeFile("output.docx", Buffer.from(await blob.arrayBuffer()));
```

### React

```tsx
import { useState } from "react";
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

export function MarkdownExporter() {
  const [markdown, setMarkdown] = useState("");

  const exportDocx = async () => {
    const blob = await convertMarkdownToDocx(markdown);
    downloadDocx(blob, "export.docx");
  };

  return (
    <>
      <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
      <button onClick={exportDocx}>Export as DOCX</button>
    </>
  );
}
```

## Features

### Multi-section documents (template + sections)

Use `template` for shared section defaults and `sections` for explicit parts with their own markdown, headers, footers, page numbering, orientation, and style overrides.

```typescript
const blob = await convertMarkdownToDocx("", {
  style: { fontFamily: "Trebuchet MS", paragraphSize: 24 },
  template: {
    page: {
      margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
    },
    pageNumbering: { display: "current", alignment: "CENTER" },
  },
  sections: [
    {
      markdown: "# My Report\n\nPrepared for ACME",
      footers: { default: null },
      pageNumbering: { display: "none" },
      style: { paragraphAlignment: "CENTER", paragraphSize: 28 },
    },
    {
      markdown: "[TOC]\n\n# Executive Summary\n\n…",
      titlePage: true,
      type: "NEXT_PAGE",
      headers: {
        default: { text: "Executive Summary", alignment: "RIGHT" },
        first: { text: "Executive Summary (First)", alignment: "RIGHT" },
      },
      footers: {
        default: {
          text: "Page",
          pageNumberDisplay: "currentAndSectionTotal",
          alignment: "RIGHT",
        },
      },
      pageNumbering: { start: 1, formatType: "decimal" },
      style: { paragraphAlignment: "JUSTIFIED" },
    },
    {
      markdown: "# Appendix\n\n…",
      type: "ODD_PAGE",
      page: { size: { orientation: "LANDSCAPE" } },
      pageNumbering: { start: 1, formatType: "upperRoman" },
      style: { paragraphSize: 22 },
    },
  ],
});
```

**Precedence (last wins):** global `style` → `template.style` → per-section `style`. For `headers` / `footers`, each slot (`default`, `first`, `even`) can inherit, override, or be explicitly disabled with `null`.

### Syntax-highlighted code blocks

Highlighting is **opt-in**; when disabled (the default) output is byte-identical to pre-highlighting versions. When enabled, each token becomes its own colored `TextRun`.

```typescript
await convertMarkdownToDocx(markdown, {
  codeHighlighting: {
    enabled: true,
    showLanguageLabel: true,
    languages: ["typescript", "javascript", "python", "bash"],
    theme: {
      background: "0D1117",
      border: "30363D",
      default: "C9D1D9",
      languageLabel: "8B949E",
      keyword: "FF7B72",
      string: "A5D6FF",
      number: "79C0FF",
      comment: "8B949E",
      "title.function": "D2A8FF",
    },
  },
});
```

Theme keys map 1:1 to `hljs-*` token classes (without the `hljs-` prefix); values are RRGGBB hex strings without `#`. Reserved keys: `default`, `background`, `border`, `languageLabel`. Unknown or non-whitelisted languages fall back to the plain rendering path, so conversion never throws on an unsupported fence.

### Custom heading and paragraph alignment

Each heading level and block type can be aligned independently:

```typescript
await convertMarkdownToDocx(markdown, {
  style: {
    heading1Alignment: "CENTER",
    heading2Alignment: "RIGHT",
    heading3Alignment: "JUSTIFIED",
    paragraphAlignment: "JUSTIFIED",
    blockquoteAlignment: "CENTER",
  },
});
```

Set `headingAlignment` to provide a fallback for any level without its own override.

### Table of Contents styling

Drop `[TOC]` on its own line in your markdown to render a clickable, auto-populated table of contents. Every TOC level is individually styleable:

```typescript
await convertMarkdownToDocx(markdown, {
  style: {
    tocFontSize: 22,
    tocHeading1FontSize: 28, tocHeading1Bold: true,
    tocHeading2FontSize: 24, tocHeading2Bold: true,
    tocHeading3FontSize: 22,
    tocHeading4FontSize: 20, tocHeading4Italic: true,
    tocHeading5FontSize: 18, tocHeading5Italic: true,
  },
});
```

### Text find-and-replace

Run string, regex, or functional replacements over the Markdown AST before conversion — they apply across every element type (headings, paragraphs, list items, table cells, etc.):

```typescript
await convertMarkdownToDocx(markdown, {
  textReplacements: [
    { find: /oldText/g, replace: "newText" },
    { find: "Company Name", replace: "Acme Corp" },
    { find: /(\d+)/g, replace: (match) => `Number: ${match}` },
  ],
});
```

### RTL / bidirectional text

```typescript
await convertMarkdownToDocx(markdown, {
  style: {
    direction: "RTL",
    paragraphAlignment: "RIGHT",
  },
});
```

## Supported Markdown


| Feature           | Syntax                 | Notes                                                |
| ----------------- | ---------------------- | ---------------------------------------------------- |
| Headings          | `# … #####`            | H1–H5, individually styleable                        |
| Bold / italic     | `**bold**`, `*italic*` |                                                      |
| Underline         | `++underline++`        | Custom marker                                        |
| Strikethrough     | `~~text~~`             | GFM                                                  |
| Inline code       | ``code``               |                                                      |
| Code blocks       | ````` fenced           | Optional syntax highlighting per block               |
| Lists             | `-`, `*`, `1.`         | Bullet, numbered, nested, rich formatting inside     |
| Tables            | `| a | b |`            | GFM — headers, alignment markers, inline formatting  |
| Blockquotes       | `> text`               |                                                      |
| Links             | `[text](url)`          |                                                      |
| Images            | `![alt](url)`          | HTTP(S) and `data:` URLs; supports `#w=…&h=…` sizing |
| Horizontal rule   | `---`                  | Skipped during conversion                            |
| Table of Contents | `[TOC]`                | Clickable, auto-populated                            |
| Page break        | `\pagebreak`           | Place on its own line                                |
| Comments          | `COMMENT: text`        | Rendered as Word comments                            |


## API reference

### `convertMarkdownToDocx(markdown, options?): Promise<Blob>`

Converts Markdown text (or a multi-section template) to a DOCX Blob.


| Argument   | Type       | Description                                                 |
| ---------- | ---------- | ----------------------------------------------------------- |
| `markdown` | `string`   | Markdown source. Ignored if `options.sections` is provided. |
| `options`  | `Options?` | See below.                                                  |


### `downloadDocx(blob, filename?): void`

Browser-only helper that triggers a file download. Throws in non-browser environments. `filename` defaults to `"document.docx"`.

### `Options`

```typescript
interface Options {
  documentType?: "document" | "report";
  style?: Style;
  template?: DocumentSection;
  sections?: DocumentSection[];
  codeHighlighting?: CodeHighlightOptions;
  textReplacements?: TextReplacement[];
}
```

#### `Style`

Text sizes


| Option                                        | Type                  | Description                              |
| --------------------------------------------- | --------------------- | ---------------------------------------- |
| `fontFamily`                                  | `string`              | Base font family                         |
| `fontFamilly`                                 | `string` (deprecated) | Alias for `fontFamily`                   |
| `titleSize`                                   | `number`              | Title size (half-points)                 |
| `heading1Size` … `heading5Size`               | `number`              | Per-level heading sizes                  |
| `paragraphSize`                               | `number`              | Paragraph size                           |
| `listItemSize`                                | `number`              | List item size                           |
| `codeBlockSize`                               | `number`              | Code block size                          |
| `blockquoteSize`                              | `number`              | Blockquote size                          |
| `tocFontSize`                                 | `number`              | TOC entry size (fallback for all levels) |
| `tocHeading1FontSize` … `tocHeading5FontSize` | `number`              | Per-level TOC entry size                 |
| `tocHeading1Bold` … `tocHeading5Bold`         | `boolean`             | Per-level TOC entry bold flag            |
| `tocHeading1Italic` … `tocHeading5Italic`     | `boolean`             | Per-level TOC entry italic flag          |




Spacing & layout


| Option             | Type                  | Description                           |
| ------------------ | --------------------- | ------------------------------------- |
| `headingSpacing`   | `number`              | Space before/after headings           |
| `paragraphSpacing` | `number`              | Space before/after paragraphs         |
| `lineSpacing`      | `number`              | Line spacing multiplier (e.g. `1.15`) |
| `tableLayout`      | `"autofit" | "fixed"` | Table layout algorithm                |




Alignment & direction


| Option                                    | Type                                        | Description                    |
| ----------------------------------------- | ------------------------------------------- | ------------------------------ |
| `paragraphAlignment`                      | `"LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED"` | Paragraphs                     |
| `blockquoteAlignment`                     | `"LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED"` | Blockquotes                    |
| `headingAlignment`                        | `"LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED"` | Fallback for any heading level |
| `heading1Alignment` … `heading5Alignment` | Same                                        | Overrides per level            |
| `direction`                               | `"LTR" | "RTL"`                             | Bidirectional flow             |




#### `DocumentSection` (for `template` and each entry in `sections`)


| Field           | Type                                                    | Description                                                                                  |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `markdown`      | `string`                                                | Section-local markdown (required on entries in `sections`).                                  |
| `style`         | `Style`                                                 | Section-local style overrides.                                                               |
| `headers`       | `{ default?, first?, even? }`                           | Header slots. Each can be `null` to disable, or `{ text?, alignment?, pageNumberDisplay? }`. |
| `footers`       | Same as `headers`                                       | Footer slots.                                                                                |
| `pageNumbering` | See below                                               | Section-local numbering and reset behavior.                                                  |
| `page`          | `{ margin?, size? }`                                    | Section page geometry (margins, size, `orientation: "PORTRAIT" | "LANDSCAPE"`).              |
| `titlePage`     | `boolean`                                               | Enables first-page header/footer behavior.                                                   |
| `type`          | `"NEXT_PAGE" | "CONTINUOUS" | "ODD_PAGE" | "EVEN_PAGE"` | Section break type.                                                                          |


`**pageNumbering`:**


| Field        | Type                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `display`    | `"none" | "current" | "currentAndTotal" | "currentAndSectionTotal"`       |
| `alignment`  | `"LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"`                               |
| `start`      | `number` (≥ 1)                                                            |
| `formatType` | `"decimal" | "upperRoman" | "lowerRoman" | "upperLetter" | "lowerLetter"` |
| `separator`  | `"hyphen" | "period" | "colon" | "emDash" | "endash"`                     |


#### `CodeHighlightOptions`


| Option              | Type                          | Default      | Description                                                                            |
| ------------------- | ----------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `enabled`           | `boolean`                     | `false`      | Turn syntax highlighting on.                                                           |
| `theme`             | `Partial<CodeHighlightTheme>` | GitHub-light | Partial override merged over the default theme. Values are RRGGBB hex.                 |
| `languages`         | `string[]`                    | `common`     | Whitelist of language grammars to load. Excluded/unknown languages fall back to plain. |
| `showLanguageLabel` | `boolean`                     | `true`       | Render the language name as a bold label above the block.                              |


#### `TextReplacement`


| Field     | Type                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `find`    | `string | RegExp`                                                                       |
| `replace` | `string | ((match: string, ...groups: string[]) => string | mdast.Node | mdast.Node[])` |


### Errors

All conversion failures throw `MarkdownConversionError` (exported from the root). The error exposes a typed `context` field (e.g. `{ orientation, sectionIndex }`) to make debugging easier.

## Requirements

- **Node.js** ≥ 18 (ESM-only package)
- **Browsers:** any evergreen browser that supports ES2020 + Blobs

## Install as an agent skill

For use in agent environments that speak the `skills` CLI:

```bash
# Quick add from GitHub URL
npx skills add https://github.com/mohtashammurshid/md-to-docx --skill md-to-docx

# From GitHub shorthand, pinned to an agent
npx skills add MohtashamMurshid/md-to-docx --skill md-to-docx --agent cursor --yes --full-depth

# From a local clone
npx skills add . --skill md-to-docx --agent cursor --yes --full-depth

# Discover before installing
npx skills add MohtashamMurshid/md-to-docx --list --full-depth
```

## Development

```bash
git clone https://github.com/MohtashamMurshid/md-to-docx.git
cd md-to-docx
npm install

npm run build   # compile TypeScript to dist/
npm test        # run the Jest suite (4 suites, 45 tests)
```

Tests run offline against generated Word XML using JSZip. Set `DEBUG_DOCX=1` to have tests also write `.docx` artifacts under `test-output/` for manual inspection.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a detailed history.

## Contributing

PRs and issues are welcome. A few guidelines:

1. Open an issue to discuss non-trivial changes before sending a patch.
2. Add or update tests under `tests/` — the suite uses XML-level assertions on the generated DOCX, so changes to rendering should be verified at that level.
3. Keep the public API surface stable; internal refactors should not require bumping the major version.
4. Run `npm run build && npm test` before pushing.

## License

[MIT](./LICENSE) © Mohtasham Murshid Madani

---

Built on top of `[docx](https://www.npmjs.com/package/docx)`, `[unified](https://unifiedjs.com)`, `[remark](https://github.com/remarkjs/remark)`, and `[lowlight](https://github.com/wooorm/lowlight)`.