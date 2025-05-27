import { describe, it, expect, jest } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import { Options } from "../src/types";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "test-output");

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Increase timeout for tests with image processing
jest.setTimeout(30000);

describe("convertMarkdownToDocx", () => {
  it("should handle images correctly", async () => {
    console.log("Starting image test");

    const markdown = `
# Image Test
This is a test with an embedded image.

![Test Image](https://picsum.photos/200/200)
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        heading1Alignment: "CENTER", // Test heading alignment with image
      },
    };

    console.log("Converting markdown to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", await buffer.size);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "image-test.docx");
    console.log("Saving file to:", outputPath);

    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved successfully");

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle code blocks correctly", async () => {
    console.log("Starting code block test");

    const markdown = `
# Code Block Test
This is a test with various code blocks.

## Inline Code
This is an example of \`inline code\` in a paragraph.

## Multi-line Code Block
\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

const result = hello("World");
console.log(result);
\`\`\`

## Code Block with Language
\`\`\`javascript
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log(doubled);
\`\`\`

## Code Block with Multiple Lines
\`\`\`python
def calculate_fibonacci(n: int) -> list[int]:
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib
\`\`\`
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
        codeBlockSize: 20,
      },
    };

    console.log("Converting markdown to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", await buffer.size);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "code-block-test.docx");
    console.log("Saving file to:", outputPath);

    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved successfully");

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should convert full markdown to docx with various alignments", async () => {
    const markdown = `
# Test Document
## Subtitle
This is a paragraph with **bold** and *italic* text.

- Bullet point 1
- Bullet point 2
  **Bold text in list**

1. Numbered item 1
2. Numbered item 2

![Test Image](https://raw.githubusercontent.com/microsoft/vscode/main/resources/win32/code_70x70.png)

> This is a blockquote

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |

COMMENT: This is a comment
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        // Test different alignments
        heading1Alignment: "CENTER",
        heading2Alignment: "RIGHT",
        paragraphAlignment: "JUSTIFIED",
        blockquoteAlignment: "CENTER",
      },
    };

    const buffer = await convertMarkdownToDocx(markdown, options);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "test-output.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle TOC and Page Break markers", async () => {
    const markdown = `
[TOC]

# Section 1

This is the first section.

## Subsection 1.1

Content for subsection 1.1.

\\pagebreak

# Section 2

This is the second section, appearing after a page break.

### Subsection 2.1.1

More content here.

- List item 1
- List item 2
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        // Use default or slightly modified styles for testing
        titleSize: 30,
        paragraphSize: 24,
        lineSpacing: 1.15,
        // Add missing required properties
        headingSpacing: 240, // Default value
        paragraphSpacing: 240, // Default value
      },
    };

    let buffer: Blob | null = null;
    try {
      buffer = await convertMarkdownToDocx(markdown, options);
    } catch (error) {
      // Fail the test if conversion throws an error
      console.error("TOC/Page Break test failed during conversion:", error);
      throw error; // Re-throw to make Jest aware of the failure
    }

    // Verify the buffer is a valid Blob
    expect(buffer).toBeInstanceOf(Blob);
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "test-toc-pagebreak.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("TOC/Page Break test output saved to:", outputPath);
  });

  it("should handle custom options with specific heading alignments", async () => {
    console.log("Starting custom options test");
    const markdown = `
## 1. Introduction

Brain-Computer Interfaces (BCIs) represent a groundbreaking technology that facilitates direct communication between the human brain and external devices. This emerging field has vast implications for assistive technologies, healthcare, and neuroscience research.

### 1.1 Background

BCIs leverage advancements in cognitive neuroscience, machine learning, and signal processing to decode neural activity and translate it into actionable outputs.

## 2. Methodology

The methodology includes a comprehensive review of existing literature, analysis of technological developments, and a systematic examination of applications.

### 2.1 Research Design

The research design for this seminar report is primarily qualitative, utilizing a systematic literature review approach.

> Key findings suggest that BCIs have significant potential in medical applications.
`;

    const customOptions: Options = {
      documentType: "report" as const,
      style: {
        titleSize: 40,
        paragraphSize: 24,
        headingSpacing: 480,
        paragraphSpacing: 360,
        lineSpacing: 1.5,
        // Test all heading alignment options
        heading1Alignment: "CENTER",
        heading2Alignment: "RIGHT",
        heading3Alignment: "LEFT",
        paragraphAlignment: "JUSTIFIED",
        blockquoteAlignment: "CENTER",
      },
    };

    console.log("Converting markdown with custom options");
    const buffer = await convertMarkdownToDocx(markdown, customOptions);
    console.log("Conversion complete, buffer size:", await buffer.size);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "custom-options-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });
});

// New Features Tests (Copied from new-features.test.ts)
describe("New Features Tests", () => {
  it("should handle nested lists correctly", async () => {
    console.log("Starting nested lists test");

    const markdown = `
# Nested Lists Test

## Unordered Nested Lists
- Level 1 item
  - Level 2 item
    - Level 3 item
  - Another level 2 item
- Back to level 1

## Ordered Nested Lists
1. First item
   1. Nested item 1
   2. Nested item 2
      1. Deep nested item
2. Second item
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        listItemSize: 24,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
      },
    };

    console.log("Converting nested lists to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "nested-lists-test.docx");
    console.log("Saving file to:", outputPath);

    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved successfully");

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle task lists correctly", async () => {
    console.log("Starting task lists test");

    const markdown = `
# Task Lists Test

## Simple Task List
- [ ] Incomplete task
- [x] Completed task
- [ ] Another incomplete task

## Nested Task Lists
- [ ] Main task
  - [x] Subtask 1 (completed)
  - [ ] Subtask 2 (incomplete)
    - [ ] Sub-subtask
      - [x] Deep nested completed task
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        taskListCheckboxSize: 26,
        taskListTextSize: 24,
        heading1Alignment: "CENTER",
      },
    };

    console.log("Converting task lists to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "task-lists-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle definition lists correctly", async () => {
    console.log("Starting definition lists test");

    const markdown = `
# Definition Lists Test

Apple
: A red or green fruit that grows on trees

Banana
: A yellow tropical fruit with potassium

Computer
: An electronic device for processing data

TypeScript
: A programming language that builds on JavaScript
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        definitionListTermSize: 26,
        definitionListDescSize: 24,
        definitionListTermBold: true,
        definitionListIndent: 400,
        heading1Alignment: "CENTER",
      },
    };

    console.log("Converting definition lists to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "definition-lists-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle mathematical equations correctly", async () => {
    console.log("Starting math equations test");

    const markdown = `
# Mathematical Equations Test

## Inline Math
The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ which is useful in algebra.

Einstein's famous equation is $E = mc^2$.

## Block Math Equations
$$\nint_{-\infty}^{\infty} e^{-x^2} dx = \\sqrt{\pi}$$

$$\nsum_{n=1}^{\infty} \\frac{1}{n^2} = \\frac{\pi^2}{6}$$

## Multi-line Block Math
$$\nf(x) = \\begin{cases}\nx^2 & \\text{if } x \\geq 0 \\\\\n-x^2 & \\text{if } x < 0\n\\end{cases}$$
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        mathEquationSize: 26,
        mathEquationAlignment: "CENTER",
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
      },
    };

    console.log("Converting math equations to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "math-equations-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle superscript and subscript correctly", async () => {
    console.log("Starting superscript/subscript test");

    const markdown = `
# Superscript and Subscript Test

## Chemical Formulas
- Water: H^2^O
- Sulfuric Acid: H~2~SO~4~
- Carbon Dioxide: CO~2~

## Mathematical Notation
- Pythagorean theorem: x^2^ + y^2^ = z^2^
- Exponential: e^x^
- Logarithm base: log~10~(x)

## Mixed Usage
The reaction 2H~2~ + O~2~ → 2H~2^16^O occurs at 25^°^C.
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        superscriptSize: 18,
        subscriptSize: 18,
        paragraphSize: 24,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
      },
    };

    console.log("Converting superscript/subscript to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "superscript-subscript-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle horizontal rules correctly", async () => {
    console.log("Starting horizontal rules test");

    const markdown = `
# Horizontal Rules Test

This is some content before the first rule.

---

This content is between horizontal rules.

***

More content here.

___

Final content after the last rule.
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        horizontalRuleColor: "333333",
        horizontalRuleThickness: 2,
        heading1Alignment: "CENTER",
      },
    };

    console.log("Converting horizontal rules to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "horizontal-rules-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle footnotes and citations correctly", async () => {
    console.log("Starting footnotes and citations test");

    const markdown = `
# Footnotes and Citations Test

This is a sentence with a footnote.[^1] Here's another footnote reference.[^note]

Research shows that markdown is popular [@smith2023]. Multiple studies confirm this [@jones2022; @brown2021].

More text with additional footnotes.[^2]

[^1]: This is the first footnote with detailed information.
[^note]: This is a named footnote with additional context.
[^2]: Another footnote for testing purposes.
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        footnoteSize: 18,
        citationSize: 20,
        citationFormat: "APA",
        heading1Alignment: "CENTER",
      },
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

    console.log("Converting footnotes and citations to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "footnotes-citations-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle emoji support correctly", async () => {
    console.log("Starting emoji support test");

    const markdown = `
# Emoji Support Test 🎉

Welcome to our documentation! 😊 This converter supports various emoji:

## Common Emoji
- 🚀 Rocket (for launch)
- 📝 Memo (for documentation)
- ✅ Check mark (for completed tasks)
- ❌ Cross mark (for failed tasks)
- 🎉 Party (for celebrations)
- 💡 Light bulb (for ideas)
- 🔧 Wrench (for tools)
- 📊 Chart (for data)

## Emoji in Lists
1. First item with 🥇 medal
2. Second item with ⭐ star
3. Third item with 🏆 trophy

Have a great day! 🌟
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        paragraphSize: 24,
        listItemSize: 24,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
      },
    };

    console.log("Converting emoji content to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "emoji-support-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle comprehensive mixed content with all new features", async () => {
    console.log("Starting comprehensive mixed content test");

    const markdown = `
# Advanced Markdown to DOCX Features Demo

[TOC]

## Nested Lists

### Unordered Nested Lists
- Level 1 item
  - Level 2 item
    - Level 3 item
  - Another level 2 item
- Back to level 1

### Ordered Nested Lists
1. First item
   1. Nested item 1
   2. Nested item 2
      1. Deep nested item
2. Second item

## Task Lists

### Simple Task List
- [ ] Incomplete task
- [x] Completed task
- [ ] Another incomplete task

### Nested Task Lists
- [ ] Main task
  - [x] Subtask 1 (completed)
  - [ ] Subtask 2 (incomplete)
    - [ ] Sub-subtask

## Definition Lists

Apple
: A red or green fruit

Banana
: A yellow tropical fruit

Computer
: An electronic device for processing data

---

## Math Equations

### Inline Math
The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ which is useful in algebra.

### Block Math Equations
$$\nE = mc^2$$

$$\nint_{-\infty}^{\infty} e^{-x^2} dx = \\sqrt{\pi}$$

## Advanced Text Formatting

### Superscript and Subscript
- Chemical formula: H^2^O (water)
- Mathematical notation: x^2^ + y^2^ = z^2^
- Subscript example: H~2~SO~4~ (sulfuric acid)

### Strikethrough
~~This text is crossed out~~

## Footnotes

This is a sentence with a footnote.[^1] Here's another footnote reference.[^note]

[^1]: This is the first footnote.
[^note]: This is a named footnote.

## Citations

Research shows that markdown is popular [@smith2023]. Multiple studies confirm this [@jones2022; @brown2021].

## Emoji Support

Welcome to our documentation! 😊 This converter supports various emoji:
- 🚀 Rocket (for launch)
- 📝 Memo (for documentation)
- ✅ Check mark (for completed tasks)
- ❌ Cross mark (for failed tasks)
- 🎉 Party (for celebrations)

## Code Examples

### Inline Code
Use the \`convertMarkdownToDocx()\` function to convert your markdown.

### Code Blocks
\`\`\`javascript
import { convertMarkdownToDocx } from "md-to-docx";

const markdown = \`
# Hello World
This is **bold** and *italic* text.
\`;\n

const docxBlob = await convertMarkdownToDocx(markdown);\n
\`\`\`\n

\`\`\`python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))\n\`\`\`\n

## Horizontal Rules

Above this line is content.\n

---\n

Below this line is more content.\n

***\n

And here's another section separator.\n

## Mixed Content Example

Here's a complex example combining multiple features:\n

### Project Tasks 📋
- [ ] **Phase 1: Planning**
  - [x] Define requirements ^important^
  - [x] Create timeline
  - [ ] Review with stakeholders[^review]
- [ ] **Phase 2: Development**
  - [ ] Setup development environment
    - [ ] Install dependencies
    - [ ] Configure database
  - [ ] Implement core features
- [x] **Phase 3: Testing**

### Mathematical Models

The area of a circle is calculated using:\n

$$\nA = \\pi r^2$$

Where:\n
- A = Area\n
- π ≈ 3.14159\n
- r = radius

For chemical reactions, consider:\n

C~6~H~12~O~6~ + 6O~2~ → 6CO~2~ + 6H~2~O

---

## Summary

This document demonstrates:\n
1. ✅ Nested lists (both ordered and unordered)\n
2. ✅ Task lists with checkboxes\n
3. ✅ Definition lists\n
4. ✅ Mathematical equations (LaTeX)\n
5. ✅ Superscript and subscript\n
6. ✅ Horizontal rules\n
7. ✅ Footnotes\n
8. ✅ Citations\n
9. ✅ Emoji support\n
10. ✅ Enhanced formatting\n

All these features are now supported in the markdown-to-docx converter! 🎉

[^review]: Stakeholder review meeting scheduled for next week.
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 36,
        headingSpacing: 300,
        paragraphSpacing: 280,
        lineSpacing: 1.2,
        taskListCheckboxSize: 26,
        taskListTextSize: 24,
        mathEquationSize: 26,
        mathEquationAlignment: "CENTER",
        definitionListTermSize: 26,
        definitionListDescSize: 24,
        definitionListTermBold: true,
        definitionListIndent: 400,
        footnoteSize: 18,
        citationSize: 20,
        citationFormat: "APA",
        horizontalRuleColor: "333333",
        horizontalRuleThickness: 2,
        superscriptSize: 16,
        subscriptSize: 16,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
        heading3Alignment: "LEFT",
        paragraphAlignment: "LEFT",
      },
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

    console.log("Converting comprehensive mixed content to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "comprehensive-features-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle enhanced text formatting correctly", async () => {
    console.log("Starting enhanced text formatting test");

    const markdown = `
# Enhanced Text Formatting Test

## Strikethrough
~~This text is crossed out~~

Normal text with ~~strikethrough~~ in the middle.

## Mixed Formatting
This is **bold**, *italic*, ~~strikethrough~~, \`inline code\`, ^superscript^, and ~subscript~ text.

## Complex Combinations
Chemical formula: H~2~SO~4~ with **bold** and *italic* styling.

Mathematical expression: x^2^ + y^2^ = z^2^ with ~~crossed out~~ parts.

Code with formatting: \`const value = **important**\` (note: formatting inside code).
`;

    const options: Options = {
      documentType: "document" as const,
      style: {
        titleSize: 32,
        headingSpacing: 240,
        paragraphSpacing: 240,
        lineSpacing: 1.15,
        paragraphSize: 24,
        superscriptSize: 18,
        subscriptSize: 18,
        heading1Alignment: "CENTER",
        heading2Alignment: "LEFT",
      },
    };

    console.log("Converting enhanced formatting to docx");
    const buffer = await convertMarkdownToDocx(markdown, options);
    console.log("Conversion complete, buffer size:", buffer.size);

    const outputPath = path.join(outputDir, "enhanced-formatting-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log("File saved to:", outputPath);

    const size = buffer.size;
    expect(size).toBeGreaterThan(0);
  });
});
