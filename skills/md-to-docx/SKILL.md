---
name: md-to-docx
description: Convert Markdown files and strings into DOCX documents using @mohtasham/md-to-docx. Use when a user needs Markdown to Word conversion, CLI-based file conversion, reference-DOCX styles or placeholder patching, options-driven styling/alignment/font family, TOC/page break handling, underline/strikethrough formatting, multi-section documents with per-section headers/footers, or programmatic conversion in Node/browser code.
---

# md-to-docx

Use this skill to reliably produce `.docx` output from Markdown.

## Workflow

1. Decide the execution mode:
   - CLI mode for file-to-file conversion.
   - Programmatic mode for app code integration.
2. Confirm input source (Markdown file or Markdown string).
3. Confirm output target (`.docx` file path or browser download).
4. Apply options only when requested (alignment, sizes, direction, font family, replacements, template, sections, page numbering).
5. Run conversion and report resulting output path or filename.

## CLI Mode

Use these commands:

```bash
npx @mohtasham/md-to-docx input.md output.docx
md-to-docx input.md output.docx
md-to-docx input.md output.docx --options options.json
md-to-docx input.md output.docx -o options.json
md-to-docx --help

# Pipes, batch, watch, local assets
cat report.md | md-to-docx - report.docx
md-to-docx report.md - > report.docx
md-to-docx --batch ./markdown ./word
md-to-docx report.md report.docx --watch
md-to-docx report.md report.docx --base-dir ./assets

# Reference DOCX workflows
md-to-docx report.md report.docx --reference corporate.docx
md-to-docx corporate.docx report.docx --patches patches.json
```

CLI contract:
- Required positional args: `<input.md> <output.docx>`. Use `-` for stdin or stdout; status and warnings go to stderr when stdout carries the DOCX.
- Optional options file: `--options <options.json>` or `-o <options.json>`. It takes the same shape as the API `Options`, such as `style`, `template`, `sections` and `textReplacements`. The CLI never loads executable plugins from JSON.
- `--reference <reference.docx>`: a new document that adopts the reference document's styles.
- `--patches <patches.json>`: the first positional argument is a template DOCX. `patches.json` maps placeholder names to Markdown strings or `{ "markdown": "...", "style": { ... } }` objects. It cannot be combined with `--reference`, `--batch` or stdin.
- `--base-dir <directory>`: local image paths resolve relative to this directory instead of the Markdown file's. Paths and symlinks must stay inside it.
- `--batch <input-directory> <output-directory>`: converts `.md` files recursively and keeps relative directories. It exits nonzero after processing the remaining files if any failed.
- `--watch`: rebuilds when inputs, options, reference files or local assets change. Ctrl+C stops it. `--watch` and `--batch` need file paths, not `-`.
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

## Reference DOCX Workflows

Choose one explicitly:

- `convertMarkdownWithReferenceDocxToBuffer(markdown, referenceBytes, options?)` creates a fresh Markdown-owned body and adopts reference named styles, theme/fonts, final-section page layout, and headers/footers.
- `patchMarkdownInDocxToBuffer(referenceBytes, patches, options?)` preserves the existing body and replaces named placeholders such as `{{body}}`.

Reference-style generation never copies static reference body text. Prefer exact `{ id: "..." }` selectors when style names are duplicated; use `{ name: "..." }` for visible Word names. Treat uploaded references as untrusted and keep the default ZIP limits unless the caller has a justified larger bound.

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

Merge precedence:
- Global `style` applies first
- `template` provides shared section defaults
- Per-section options win last

Use `pageNumbering.display` for common footer numbering modes: `none`, `current`, `currentAndTotal`, or `currentAndSectionTotal`.

## Figure and Table References

Place a Pandoc-style caption paragraph after a standalone image or table, with a blank line between the block and caption. Use `[@fig:id]` or `[@tbl:id]` in prose:

```markdown
See [@fig:flow] and [@tbl:metrics].

![Accessible flow diagram](flow.png)

: Request *flow* {#fig:flow}

| Metric | Value |
| --- | --- |
| p95 | 120 ms |

: Performance metrics {#tbl:metrics}
```

Figure and table numbering continues across sections. Use `options.captions` for labels, placement, alignment, italics, size, and `failureMode`. Reference-DOCX patch mode rejects this syntax with a validation error.

## Text Replacements

Use `textReplacements` to rewrite text before conversion:

```typescript
const blob = await convertMarkdownToDocx("# Hello oldText", {
  textReplacements: [
    { find: /oldText/g, replace: "newText" },
    { find: "Hello", replace: "Hi" }
  ]
});
```

## Markdown Features to Expect

Support includes:
- Headings `#` to `#####`
- Ordered/unordered lists
- Bold, italic, underline (`++text++`), strikethrough (`~~text~~`)
- Custom font family via `fontFamily` style option
- Blockquotes
- Tables (with inline formatting: bold, italic, code, links, strikethrough in cells)
- Code blocks and inline code (with configurable `codeBlockAlignment`)
- Links and images
- Automatically numbered figure/table captions and clickable cross-references
- Text replacements before rendering via `textReplacements`
- `COMMENT: ...`
- Raw HTML (`<sup>`, `<br>`, `<table>`, editor output) only with `"htmlRendering": { "enabled": true }`; otherwise inline tags stay literal and HTML blocks are dropped. It is sanitized and its images follow `imageHandling`
- `[TOC]` on its own line
- `\pagebreak` on its own line
- Markdown thematic breaks (`---`, `***`, `___`) render as native Word paragraph borders

## Style Options Quick Reference

| Option | Values | Default |
|---|---|---|
| `paragraphAlignment` | `LEFT`, `CENTER`, `RIGHT`, `JUSTIFIED` | `LEFT` |
| `headingAlignment` | same | `LEFT` |
| `heading1Alignment`–`heading5Alignment` | same | `LEFT` |
| `blockquoteAlignment` | same | `LEFT` |
| `codeBlockAlignment` | same | `LEFT` |
| `fontFamily` | any font name string | `Calibri` |
| `direction` | `LTR`, `RTL` | `LTR` |
| `tableLayout` | `autofit`, `fixed` | `autofit` |
| `tocFontSize` | number | library default |

## Document Options Quick Reference

Each is off by default and works from a CLI `--options` JSON file. Where patch mode (`--patches`) cannot apply one, it fails with an error instead of ignoring it.

| Option | Values | Default | Patch mode |
|---|---|---|---|
| `htmlRendering.enabled` | `true` renders raw HTML as native Word content, sanitized: no scripts, links limited to http(s)/mailto/tel, images follow `imageHandling` | `false` | supported |
| `chartRendering.output` | `image` (PNG), `native` (editable Word chart; needs `chartRendering.enabled: true`) | `image` | `native` falls back to the PNG with a warning |
| `toc.tabLeader` | `dot`, `hyphen`, `underscore`, `middleDot`, `none` | `dot` | supported |
| `toc.prefillPageNumbers` | `true` estimates TOC page numbers so Word does not ask to update fields on open | `false` | supported |
| `footnotes.placement` | `footnotes`, `endnotes` (Word endnotes at the end of the document, numbered 1, 2, 3) | `footnotes` | `endnotes` rejected |
| `taskLists.checkboxes` | `text` (`☐`/`☒` characters), `content-control` (clickable Word checkboxes, checked state kept) | `text` | supported |

## Troubleshooting

- If CLI fails with argument errors, re-check that exactly two positional paths are provided.
- If options parsing fails, validate JSON syntax and ensure the root is an object.
- If output is missing, verify destination directory permissions and path spelling.
- If in Node and you need a file, write the returned `Blob` bytes to disk instead of using `downloadDocx`.
- If sections produce unexpected numbering, ensure each section sets `pageNumbering.start` to reset counts.
- If first-page headers or footers do not appear, set `titlePage: true` on that section.
