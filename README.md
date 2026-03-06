# md-to-docx

`@mohtasham/md-to-docx` is a TypeScript library and CLI for converting Markdown into Microsoft Word `.docx` documents.

It is designed for developers who want a programmable Markdown-to-Word pipeline, teams who need a CLI for document generation, and contributors who want a focused TypeScript codebase with tests and generated API docs.

## Why Use It

- library API for Node.js and browser workflows
- standalone CLI for file-to-file conversion
- section templates, per-section overrides, headers, footers, and page numbering
- table of contents and `\pagebreak` support
- styling controls for fonts, spacing, alignment, and direction
- support for headings, lists, tables, images, code blocks, links, comments, underline, and strikethrough

## Install

```bash
npm install @mohtasham/md-to-docx
```

## Quick Start

### Library

```ts
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";

const markdown = "# Hello\n\nThis DOCX started as Markdown.";
const blob = await convertMarkdownToDocx(markdown);
```

### CLI

```bash
npx @mohtasham/md-to-docx input.md output.docx
```

### Browser Download

```ts
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const blob = await convertMarkdownToDocx("# Browser Example");
downloadDocx(blob, "example.docx");
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [CLI guide](./docs/cli.md)
- [Library API guide](./docs/library-api.md)
- [Sections, headers, and footers](./docs/sections-headers-footers.md)
- [Examples](./docs/examples.md)
- [Agent skill usage](./docs/skill.md)
- [Contributor guide](./docs/contributing.md)
- [Generated API reference](./docs/api/index.md)

## Common Features

### Document Structure

- `[TOC]` for generated table of contents placement
- `\pagebreak` for explicit page breaks
- template and section support for multi-part documents
- per-section page numbering, headers, footers, and title-page behavior

### Formatting

- `#` through `#####` headings
- `**bold**`, `*italic*`, `++underline++`, `~~strikethrough~~`
- blockquotes, links, inline code, and fenced code blocks
- tables with headers and auto-fit support
- text replacements before conversion
- RTL/LTR direction support

## CLI Example With Options

```json
{
  "documentType": "report",
  "style": {
    "fontFamily": "Trebuchet MS",
    "heading1Alignment": "CENTER",
    "paragraphAlignment": "JUSTIFIED"
  }
}
```

```bash
npx @mohtasham/md-to-docx input.md output.docx --options options.json
```

## Install As An Agent Skill

```bash
npx skills add MohtashamMurshid/md-to-docx --skill md-to-docx --agent cursor --yes --full-depth
```

More skill-specific usage lives in [docs/skill.md](./docs/skill.md).

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), then use [docs/contributing.md](./docs/contributing.md) for the longer development guide.

## License

[MIT](./LICENSE)
