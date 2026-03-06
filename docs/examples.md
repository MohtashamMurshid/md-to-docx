# Examples

## Basic Conversion

```ts
import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";

const blob = await convertMarkdownToDocx("# Example\n\nGenerated from code.");
```

## Browser Download

```ts
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const blob = await convertMarkdownToDocx("# Browser Example");
downloadDocx(blob, "browser-example.docx");
```

## Styling

```ts
const blob = await convertMarkdownToDocx("# Styled", {
  style: {
    fontFamily: "Trebuchet MS",
    paragraphAlignment: "JUSTIFIED",
    heading1Alignment: "CENTER"
  }
});
```

## Text Replacements

```ts
const blob = await convertMarkdownToDocx("Hello oldText world", {
  textReplacements: [{ find: /oldText/g, replace: "newText" }]
});
```

## Table Of Contents And Page Breaks

```ts
const markdown = `[TOC]

# Section 1

Content here.

\\pagebreak

# Section 2

More content here.`;

const blob = await convertMarkdownToDocx(markdown);
```
