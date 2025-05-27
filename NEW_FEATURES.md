# New Features Added to Markdown-to-DOCX Converter

This document outlines all the new features that have been added to the markdown-to-docx converter library.

## 🎯 Overview of New Features

The following advanced markdown features are now fully supported:

1. **Nested Lists** - Support for multi-level ordered and unordered lists
2. **Task Lists** - Checkbox lists with completed/incomplete states
3. **Definition Lists** - Term and definition pairs
4. **Mathematical Equations** - LaTeX math support (inline and block)
5. **Superscript and Subscript** - Enhanced text formatting
6. **Horizontal Rules** - Visual section separators
7. **Footnotes** - Reference notes with automatic numbering
8. **Citations** - Academic citation support
9. **Emoji Support** - Unicode emoji rendering
10. **Enhanced Text Formatting** - Improved strikethrough and other formatting

## 📋 Detailed Feature Documentation

### 1. Nested Lists

#### Syntax

```markdown
- Level 1 item
  - Level 2 item
    - Level 3 item
  - Another level 2 item
- Back to level 1

1. First item
   1. Nested item 1
   2. Nested item 2
      1. Deep nested item
2. Second item
```

#### Configuration

```typescript
const style = {
  // ... other options
  listItemSize: 24, // Font size for list items
};
```

### 2. Task Lists

#### Syntax

```markdown
- [ ] Incomplete task
- [x] Completed task
- [ ] Another incomplete task

// Nested task lists

- [ ] Main task
  - [x] Subtask 1 (completed)
  - [ ] Subtask 2 (incomplete)
```

#### Configuration

```typescript
const style = {
  taskListCheckboxSize: 24, // Size of checkbox characters
  taskListTextSize: 24, // Size of task text
};
```

### 3. Definition Lists

#### Syntax

```markdown
Apple
: A red or green fruit

Banana
: A yellow tropical fruit
```

#### Configuration

```typescript
const style = {
  definitionListTermSize: 24, // Size of definition terms
  definitionListDescSize: 22, // Size of definition descriptions
  definitionListTermBold: true, // Whether terms are bold
  definitionListIndent: 360, // Indentation for definitions
};
```

### 4. Mathematical Equations (LaTeX)

#### Syntax

```markdown
// Inline math
The quadratic formula is $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$

// Block math

$$
E = mc^2
$$

// Multi-line block math

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

#### Configuration

```typescript
const style = {
  mathEquationSize: 24, // Font size for equations
  mathEquationAlignment: "CENTER", // LEFT, CENTER, or RIGHT
};
```

### 5. Superscript and Subscript

#### Syntax

```markdown
// Superscript
x^2^ + y^2^ = z^2^

// Subscript  
H~2~O (water)
H~2~SO~4~ (sulfuric acid)
```

#### Configuration

```typescript
const style = {
  superscriptSize: 18, // Font size for superscript
  subscriptSize: 18, // Font size for subscript
};
```

### 6. Horizontal Rules

#### Syntax

```markdown
---
---

---
```

#### Configuration

```typescript
const style = {
  horizontalRuleColor: "000000", // Color of the rule
  horizontalRuleThickness: 1, // Thickness in points
};
```

### 7. Footnotes

#### Syntax

```markdown
This is a sentence with a footnote.[^1]

[^1]: This is the footnote content.
[^note]: Named footnotes are also supported.
```

#### Configuration

```typescript
const options = {
  footnotes: {
    enabled: true, // Enable footnote processing
    position: "bottom", // "bottom" or "end"
    numberingStyle: "arabic", // "arabic", "roman", or "alpha"
  },
  style: {
    footnoteSize: 20, // Font size for footnotes
  },
};
```

### 8. Citations

#### Syntax

```markdown
Research shows this [@smith2023].
Multiple citations [@jones2022; @brown2021].
```

#### Configuration

```typescript
const options = {
  citations: {
    enabled: true, // Enable citation processing
    style: "APA", // "APA", "MLA", "CHICAGO", or "CUSTOM"
    bibliography: true, // Generate bibliography
  },
  style: {
    citationSize: 20, // Font size for citations
    citationFormat: "APA", // Citation format style
  },
};
```

### 9. Emoji Support

#### Syntax

```markdown
Welcome! 😊 Here are some examples:

- 🚀 Rocket
- 📝 Memo
- ✅ Check mark
- ❌ Cross mark
```

Emoji are automatically detected and rendered with slightly larger font size for better visibility.

### 10. Enhanced Text Formatting

#### Strikethrough

```markdown
~~This text is crossed out~~
```

## 🔧 Usage Examples

### Basic Usage with New Features

```typescript
import { convertMarkdownToDocx, Options } from "md-to-docx";

const markdown = `
# Document with New Features

## Task List
- [x] Completed task
- [ ] Pending task

## Math Equation
The formula is $E = mc^2$.

## Definition
API
: Application Programming Interface
`;

const options: Options = {
  style: {
    titleSize: 32,
    taskListCheckboxSize: 24,
    mathEquationSize: 24,
    definitionListTermBold: true,
  },
  footnotes: {
    enabled: true,
    position: "bottom",
  },
  citations: {
    enabled: true,
    style: "APA",
  },
};

const docxBlob = await convertMarkdownToDocx(markdown, options);
```

### Advanced Configuration

```typescript
const advancedStyle = {
  // Basic settings
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,

  // Task list styling
  taskListCheckboxSize: 26,
  taskListTextSize: 24,

  // Math equation styling
  mathEquationSize: 26,
  mathEquationAlignment: "CENTER",

  // Definition list styling
  definitionListTermSize: 26,
  definitionListDescSize: 24,
  definitionListTermBold: true,
  definitionListIndent: 400,

  // Footnote styling
  footnoteSize: 18,

  // Citation styling
  citationSize: 20,
  citationFormat: "APA",

  // Horizontal rule styling
  horizontalRuleColor: "333333",
  horizontalRuleThickness: 2,

  // Super/subscript styling
  superscriptSize: 16,
  subscriptSize: 16,
};

const options: Options = {
  documentType: "document",
  style: advancedStyle,
  footnotes: {
    enabled: true,
    position: "bottom",
    numberingStyle: "arabic",
  },
  citations: {
    enabled: true,
    style: "APA",
    bibliography: true,
  },
};
```

## 🧪 Testing

Use the provided `example-with-new-features.md` file to test all the new features:

```typescript
import fs from "fs";
import { convertMarkdownToDocx } from "md-to-docx";

const markdown = fs.readFileSync("example-with-new-features.md", "utf8");
const docxBlob = await convertMarkdownToDocx(markdown);

// Save or download the file
fs.writeFileSync("output.docx", docxBlob);
```

## 🎨 Styling Options

All new features come with comprehensive styling options that can be customized through the `Style` interface. See the TypeScript definitions in `src/types.ts` for complete type information.

## 🔍 Implementation Notes

1. **Math Equations**: Currently rendered as formatted text. For production use, consider integrating with a proper LaTeX renderer.

2. **Footnotes**: Basic implementation provided. Full footnote support with proper Word footnote objects could be added in future versions.

3. **Citations**: Supports common academic styles. Bibliography generation is basic and can be enhanced.

4. **Emoji**: Uses Unicode detection and rendering. Works with most common emoji sets.

5. **Nested Lists**: Supports up to 5 levels of nesting with proper indentation.

## 🚀 Future Enhancements

Potential areas for further development:

- Enhanced math equation rendering with MathJax integration
- Advanced footnote positioning and formatting
- Bibliography generation with proper academic formatting
- Custom emoji sets and rendering
- Extended citation styles and formats
- Interactive task list support

## 📚 API Reference

For complete API documentation, refer to the TypeScript definitions and inline documentation in the source code.

All new features are backward compatible and existing code will continue to work without modification.
