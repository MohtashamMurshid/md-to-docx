# Getting Started

`@mohtasham/md-to-docx` converts Markdown into Microsoft Word `.docx` documents from Node.js, the browser, or the command line.

## Install

```bash
npm install @mohtasham/md-to-docx
```

Node.js `20` or newer is recommended for development and CI in this repository.

## Quick Start

### Library

```ts
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";

const markdown = "# Hello\n\nThis file was generated from Markdown.";
const blob = await convertMarkdownToDocx(markdown);
```

### CLI

```bash
npx @mohtasham/md-to-docx input.md output.docx
```

## What To Read Next

- [CLI guide](./cli.md)
- [Library API guide](./library-api.md)
- [Advanced sections, headers, and footers](./sections-headers-footers.md)
- [Examples](./examples.md)
- [API reference](./api/index.md)
