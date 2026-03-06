# Library API Guide

Use the library API when you want to convert Markdown from application code, compose advanced options, or work with the resulting `Blob`.

## Basic Conversion

```ts
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";

const markdown = "# Title\n\nThis paragraph becomes a DOCX paragraph.";
const blob = await convertMarkdownToDocx(markdown);
```

## Browser Download

```ts
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const blob = await convertMarkdownToDocx("# Browser Example");
downloadDocx(blob, "example.docx");
```

## Common Options

```ts
const blob = await convertMarkdownToDocx(markdown, {
  documentType: "report",
  style: {
    fontFamily: "Trebuchet MS",
    paragraphAlignment: "JUSTIFIED",
    heading1Alignment: "CENTER",
    direction: "LTR"
  }
});
```

## Option Concepts

- `documentType`: choose between `"document"` and `"report"`.
- `style`: adjust font family, alignment, spacing, TOC styling, and direction.
- `template`: define shared defaults for all sections.
- `sections`: provide explicit document sections with their own markdown and overrides.
- `textReplacements`: transform markdown text before rendering.

## Related Docs

- [Examples](./examples.md)
- [Advanced sections, headers, and footers](./sections-headers-footers.md)
- [Generated API reference](./api/index.md)
