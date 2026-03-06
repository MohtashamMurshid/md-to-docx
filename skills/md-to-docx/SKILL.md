---
name: md-to-docx
description: Convert Markdown files and strings into DOCX documents using @mohtasham/md-to-docx. Use when a user needs Markdown to Word conversion, CLI-based file conversion, options-driven styling/alignment/font family, TOC/page break handling, underline/strikethrough formatting, multi-section documents with per-section headers/footers, or programmatic conversion in Node/browser code.
---

# md-to-docx

Use this skill to reliably produce `.docx` output from Markdown.

## Workflow

1. Decide the execution mode:
   - CLI mode for file-to-file conversion.
   - Programmatic mode for app code integration.
2. Confirm input source (Markdown file or Markdown string).
3. Confirm output target (`.docx` file path or browser download).
4. Apply options only when requested (alignment, sizes, direction, font family, replacements, sections, template).
5. Run conversion and report resulting output path or filename.

## CLI Mode

Use these commands:

```bash
npx @mohtasham/md-to-docx input.md output.docx
md-to-docx input.md output.docx
md-to-docx input.md output.docx --options options.json
md-to-docx input.md output.docx -o options.json
md-to-docx --help
```

CLI contract:
- Required positional args: `<input.md> <output.docx>`
- Optional options file: `--options <options.json>` or `-o <options.json>`
- Help flags: `-h` or `--help`
- On success, expect: `DOCX created at: <absolute-path>`

## Programmatic Mode

```typescript
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const markdown = "# Title\n\nHello **DOCX**.";
const blob = await convertMarkdownToDocx(markdown, {
  documentType: "report",
  style: {
    fontFamily: "Trebuchet MS",
    heading1Alignment: "CENTER",
    paragraphAlignment: "JUSTIFIED",
    codeBlockAlignment: "LEFT",
    direction: "LTR"
  }
});

downloadDocx(blob, "output.docx");
```

Use `convertMarkdownToDocx(markdown, options?)` to produce a DOCX `Blob`.
Use `downloadDocx(blob, filename?)` only in browser environments.

## Multi-Section Documents

Use `options.template` for shared defaults and `options.sections` for per-section markdown and overrides:

```typescript
const blob = await convertMarkdownToDocx("", {
  template: {
    footers: {
      default: { pageNumberDisplay: "currentAndTotal", alignment: "CENTER" }
    }
  },
  sections: [
    {
      markdown: "# Cover Page\n\nIntroduction here.",
      titlePage: true,
      headers: { first: { text: "Confidential", alignment: "RIGHT" } },
      pageNumbering: { start: 1, display: "none" }
    },
    {
      markdown: "# Chapter 1\n\nBody content.",
      style: { paragraphAlignment: "JUSTIFIED" },
      pageNumbering: { start: 1, display: "currentAndTotal" }
    }
  ]
});
```

Each section can override: `style`, `headers`, `footers`, `pageNumbering`, `page` (margins/size/orientation), `titlePage`, and `type` (break type).

## Markdown Features to Expect

Support includes:
- Headings `#` to `#####`
- Ordered/unordered lists
- Bold, italic, underline (`++text++`), strikethrough (`~~text~~`)
- Custom font family via `fontFamily` style option
- Blockquotes
- Tables
- Code blocks and inline code (with configurable `codeBlockAlignment`)
- Links and images
- `COMMENT: ...`
- `[TOC]` on its own line
- `\pagebreak` on its own line

## Style Options Quick Reference

| Option | Values | Default |
|---|---|---|
| `paragraphAlignment` | `LEFT`, `CENTER`, `RIGHT`, `JUSTIFIED` | `LEFT` |
| `heading1Alignment`–`heading5Alignment` | same | `LEFT` |
| `blockquoteAlignment` | same | `LEFT` |
| `codeBlockAlignment` | same | `LEFT` |
| `fontFamily` | any font name string | `Calibri` |
| `direction` | `LTR`, `RTL` | `LTR` |
| `tableLayout` | `autofit`, `fixed` | `autofit` |

## Troubleshooting

- If CLI fails with argument errors, re-check that exactly two positional paths are provided.
- If options parsing fails, validate JSON syntax and ensure the root is an object.
- If output is missing, verify destination directory permissions and path spelling.
- If in Node and you need a file, write the returned `Blob` bytes to disk instead of using `downloadDocx`.
- If sections produce unexpected numbering, ensure each section sets `pageNumbering.start` to reset counts.
