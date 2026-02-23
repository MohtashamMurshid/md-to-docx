# Markdown to DOCX Converter

A powerful TypeScript module that converts Markdown text to Microsoft Word (.docx) documents with support for various Markdown features. Perfect for both Node.js and browser environments.

## Github Repo (Open Source)

[https://github.com/MohtashamMurshid/md-to-docx]

## Features

- 🎯 Convert Markdown to DOCX format
- 📚 Table of Contents generation with clickable links (`[TOC]`)
- 📄 Page break support (`\pagebreak`)
- #️⃣ Automatic page numbering (centered in footer)
- 📝 Support for all heading levels (H1-H5)
- 📋 Bullet points and numbered lists with rich formatting
- 📊 Tables with headers and data
- 🔤 Bold and italic text formatting (including in lists)
- 💬 Blockquotes
- 💡 Comments
- 🎨 Customizable styling
- 📄 Report and document modes
- 🌐 Browser and Node.js support
- 🖼️ Support for embedded images
- 💻 Code blocks (inline and multi-line)
- 🔗 Support for links
- ~~Strikethrough~~ text support
- 📏 Custom font sizes for all elements
- ⚖️ Text alignment control for all elements
- ↔️ RTL/LTR direction control
- 🔄 Text find-and-replace functionality
- 🧪 Comprehensive test coverage

## Installation

```bash
npm install @mohtasham/md-to-docx
```

## Usage

### Standalone CLI

Run directly without writing code:

```bash
npx @mohtasham/md-to-docx a.md b.docx
```

If installed globally, you can use:

```bash
md-to-docx a.md b.docx
```

Use custom options from a JSON file:

```bash
md-to-docx a.md b.docx --options options.json
```

### Basic Usage

```typescript
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const markdown = `
# Title
## Subtitle
This is a paragraph with **bold** and *italic* text.

- Bullet point with **bold text** inside
- Another point with *italic* and \`code\`
  **Bold text on next line**

1. Numbered item with **bold** formatting
2. Another item with mixed **bold** and *italic*

> This is a blockquote

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |

\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

![Test Image](https://picsum.photos/200/200)

COMMENT: This is a comment
`;

// Convert to DOCX
const blob = await convertMarkdownToDocx(markdown);

// Download in browser
downloadDocx(blob, "output.docx");
```

### With Custom Options

```typescript
const options = {
  documentType: "report", // or 'document'
  style: {
    titleSize: 32,
    headingSpacing: 240,
    paragraphSpacing: 240,
    lineSpacing: 1.15,
    heading1Size: 32,
    heading2Size: 28,
    heading3Size: 24,
    heading4Size: 20,
    heading5Size: 18,
    paragraphSize: 24,
    listItemSize: 24,
    codeBlockSize: 20,
    blockquoteSize: 24,
    tocFontSize: 22, // Custom font size for TOC entries
    paragraphAlignment: "JUSTIFIED",
    blockquoteAlignment: "CENTER",
    direction: "RTL", // Set document direction to Right-to-Left
  },
};

const blob = await convertMarkdownToDocx(markdown, options);
```

### Custom Table of Contents Styling

```typescript
const options = {
  documentType: "document",
  style: {
    // Regular document styling
    titleSize: 32,
    headingSpacing: 240,
    paragraphSpacing: 240,

    // Custom TOC styling for each heading level
    tocHeading1FontSize: 28,
    tocHeading1Bold: true,
    tocHeading1Italic: false,

    tocHeading2FontSize: 24,
    tocHeading2Bold: true,
    tocHeading2Italic: false,

    tocHeading3FontSize: 22,
    tocHeading3Bold: false,
    tocHeading3Italic: false,

    tocHeading4FontSize: 20,
    tocHeading4Bold: false,
    tocHeading4Italic: true,

    tocHeading5FontSize: 18,
    tocHeading5Bold: false,
    tocHeading5Italic: true,
  },
};

const blob = await convertMarkdownToDocx(markdownWithToc, options);
```

### Text Alignment Example

```typescript
const markdownWithAlignment = `
# Left-Aligned Heading 1

## Left-Aligned Heading 2

This is a justified paragraph that demonstrates how text can be spread evenly across the width of the page. This creates a clean, professional look with straight edges on both the left and right margins.

> This is a centered blockquote that stands out from the regular text.

This is a left-aligned paragraph (default alignment) that shows the standard text positioning.
`;

const alignmentOptions = {
  documentType: "document",
  style: {
    paragraphAlignment: "JUSTIFIED",
    blockquoteAlignment: "CENTER",
    direction: "LTR", // Default; set to "RTL" for right-to-left languages
    // All headings default to LEFT alignment
  },
};

const blob = await convertMarkdownToDocx(
  markdownWithAlignment,
  alignmentOptions
);
```

### Custom Heading Alignments

You can customize the alignment for each heading level individually:

```typescript
const customHeadingOptions = {
  documentType: "document",
  style: {
    // Individual heading alignments
    heading1Alignment: "CENTER", // H1 will be centered
    heading2Alignment: "RIGHT", // H2 will be right-aligned
    heading3Alignment: "JUSTIFIED", // H3 will be justified
    heading4Alignment: "LEFT", // H4 will be left-aligned
    heading5Alignment: "CENTER", // H5 will be centered

    // Other style options
    paragraphAlignment: "LEFT", // Paragraphs will be left-aligned
    blockquoteAlignment: "LEFT", // Blockquotes will be left-aligned
    direction: "RTL", // Example: apply RTL flow with per-heading alignments
  },
};

const markdown = `
# This will be centered
## This will be right-aligned
### This will be justified
#### This will be left-aligned
##### This will be centered
`;

const blob = await convertMarkdownToDocx(markdown, customHeadingOptions);
```

### Text Find-and-Replace

You can apply text replacements to the markdown before conversion:

```typescript
const markdown = `
# Document Title
Hello oldText world. Company Name is great.
`;

const options = {
  documentType: "document",
  textReplacements: [
    // Replace using RegExp
    { find: /oldText/g, replace: 'newText' },
    // Replace using string literal
    { find: 'Company Name', replace: 'Acme Corp' },
    // Replace with function
    { find: /(\d+)/g, replace: (match) => `Number: ${match}` }
  ],
};

const blob = await convertMarkdownToDocx(markdown, options);
```

The replacements are applied to the markdown AST before conversion, so they work across all markdown elements (headings, paragraphs, lists, etc.).

### In React

```typescript
import { useState } from "react";
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

function MarkdownConverter() {
  const [markdown, setMarkdown] = useState("");

  const handleConvert = async () => {
    try {
      const blob = await convertMarkdownToDocx(markdown);
      downloadDocx(blob, "converted.docx");
    } catch (error) {
      console.error("Conversion failed:", error);
    }
  };

  return (
    <div>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
      />
      <button onClick={handleConvert}>Convert to DOCX</button>
    </div>
  );
}
```

## API

### `convertMarkdownToDocx(markdown: string, options?: Options): Promise<Blob>`

Converts Markdown text to a DOCX document.

#### Parameters

- `markdown` (string): The Markdown text to convert
- `options` (object, optional): Configuration options
  - `documentType` (string): Either 'document' or 'report'
  - `style` (object): Styling options
    - Text Sizes:
      - `titleSize` (number): Font size for titles
      - `heading1Size` through `heading5Size` (number): Font sizes for H1-H5
      - `paragraphSize` (number): Font size for paragraphs
      - `listItemSize` (number): Font size for list items
      - `codeBlockSize` (number): Font size for code blocks
      - `blockquoteSize` (number): Font size for blockquotes
      - `tocFontSize` (number): Font size for Table of Contents entries
      - `tocHeading1FontSize` through `tocHeading5FontSize` (number): Font sizes for specific heading levels in TOC
      - `tocHeading1Bold` through `tocHeading5Bold` (boolean): Whether specific heading levels in TOC should be bold
      - `tocHeading1Italic` through `tocHeading5Italic` (boolean): Whether specific heading levels in TOC should be italic
    - Spacing:
      - `headingSpacing` (number): Spacing before/after headings
      - `paragraphSpacing` (number): Spacing before/after paragraphs
      - `lineSpacing` (number): Line spacing multiplier
    - Alignment:
      - `paragraphAlignment` (string): "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED"
      - `headingAlignment` (string): "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED" (fallback for all headings)
      - `heading1Alignment` through `heading5Alignment` (string): Individual heading level alignments
      - `blockquoteAlignment` (string): "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED"
    - Direction:
      - `direction` (string): "LTR" | "RTL". Applies bidirectional layout for paragraphs and runs. Combine with `paragraphAlignment: "RIGHT"` for typical RTL layouts.
    - Text Replacements:
      - `textReplacements` (array, optional): Array of `TextReplacement` objects for pattern-based text replacement
        - `find` (string | RegExp): The pattern to find
        - `replace` (string | function): The replacement (string or function that returns string or array of nodes)

#### Returns

Promise that resolves to a Blob containing the DOCX file.

### `downloadDocx(blob: Blob, filename?: string): void`

Downloads a DOCX file in the browser environment.

#### Parameters

- `blob` (Blob): The Blob containing the DOCX file data
- `filename` (string, optional): The name to save the file as (defaults to "document.docx")

#### Throws

- Error if called outside browser environment
- Error if invalid blob or filename is provided
- Error if file save fails

## Markdown Support

The module supports the following Markdown features:

- Table of Contents: `[TOC]` (place on its own line where TOC should appear)
- Page Breaks: `\pagebreak` (place on its own line to force a page break)
- Headings: `#`, `##`, `###`, `####`, `#####`
- Lists: `-`, `*`, `1.`, `2.`, etc.
- Bold: `**text**`
- Italic: `*text*`
- Strikethrough: `~~text~~`
- Blockquotes: `> text`
- Tables: `| Header | Header |`
- Comments: `COMMENT: text`
- Images: `![alt text](image-url)`
- Code blocks: `code`
- Inline code: `code`
- Links: `[text](url)`
- Markdown Separators: `---` (horizontal rule, skipped during conversion)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## List Formatting Examples

The module supports rich text formatting within list items:

```typescript
const markdown = `
- Regular list item
- List item with **bold text** inside
- Item with *italic* and \`code\`
- Mixed **bold** and *italic* formatting
- List item
  **Bold text on next line**

1. Numbered list with **bold text**
2. Numbered item with \`code\` and *italic*
3. Mixed **bold** and *italic* text
`;

const blob = await convertMarkdownToDocx(markdown);
```

### Basic Usage with TOC and Page Breaks

```typescript
import { convertMarkdownToDocx, downloadDocx } from "@mohtasham/md-to-docx";

const markdown = `
[TOC]

# Section 1

This is the first section.

## Subsection 1.1

Content for subsection 1.1.

\pagebreak

# Section 2

This is the second section, appearing after a page break.

- Item A
- Item B
`;

// Convert to DOCX
const blob = await convertMarkdownToDocx(markdown);

// Download in browser
downloadDocx(blob, "output_with_toc.docx");
```
