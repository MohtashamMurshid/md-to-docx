import { describe, it, expect, jest } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import { Options } from "../src/types";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "test-output");
const transparentPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Increase timeout for tests with image processing
jest.setTimeout(30000);

describe("convertMarkdownToDocx", () => {
  it("should handle images correctly", async () => {
    const markdown = `
# Image Test
This is a test with embedded images and explicit sizing.

![Square 200x200](${transparentPngDataUrl})
![Logo 180x16](${transparentPngDataUrl}#180x16)
![Explicit w h params](${transparentPngDataUrl}#w=150&h=100)
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

    const buffer = await convertMarkdownToDocx(markdown, options);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "image-test.docx");

    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });

  it("should handle code blocks correctly", async () => {
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

    const buffer = await convertMarkdownToDocx(markdown, options);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "code-block-test.docx");

    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

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

![Test Image](${transparentPngDataUrl})

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
  });

  it("should handle custom options with specific heading alignments", async () => {
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

    const buffer = await convertMarkdownToDocx(markdown, customOptions);

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "custom-options-test.docx");
    const arrayBuffer = await buffer.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    // Verify the buffer is not empty
    const size = await buffer.size;
    expect(size).toBeGreaterThan(0);
  });
});

describe("convertMarkdownToDocx with complex content", () => {
  it("should convert markdown with various complex elements correctly", async () => {
    const markdown = `
## Supporting Evidence

Artificial intelligence's transformative impact is well-documented across multiple industries, supported by a wealth of empirical data, case studies, and expert insights. Here are some key pieces of evidence underpinning the claims made throughout this report:

**Operational Efficiency and Cost Savings**  
Numerous organizations have reported significant reductions in operational costs through AI-driven automation. For example, a report by McKinsey estimates that AI-powered automation can reduce process costs by up to 30%, as seen in banking and insurance claim processing. In healthcare, AI diagnostic tools have increased early detection rates of diseases like cancer by over 20%, leading to more timely interventions and cost efficiencies.

**Market Adoption and Revenue Growth**  
A survey from IDC indicates that early adopters of AI in retail and consumer services boosted revenue growth by an average of 15% year-over-year. Leading companies such as Amazon and Alibaba leverage recommendation engines powered by machine learning to personalize shopping experiences, resulting in user engagement increases exceeding 20%. Similarly, OpenAI's GPT-based applications have enabled content creators and businesses to generate high-quality text content rapidly, opening new revenue streams.

**Generative AI and Content Creation**  
Generative models like DALL·E for images and GPT-4 for text have demonstrated remarkable capabilities. For instance, DALL·E has been used by marketing agencies to produce customized visual content at scale, reducing creative production costs by approximately 25%. In entertainment, AI-generated music compositions with models like MusicLM are attracting attention for their quality comparable to human composers—highlighting the commercial potential of AI in creative sectors.

**Explainability and Regulatory Compliance**  
Organizations adopting explainable AI frameworks report better regulatory compliance outcomes. For example, a financial institution implementing SHAP explanations for credit scoring models observed a 35% reduction in model bias incidents during audits. As regulatory bodies such as the EU's European Data Protection Board emphasize transparency, companies investing in XAI tools are better positioned to meet evolving legal standards and avoid penalties.

"In sectors where decisions directly impact individuals' lives—like lending or hiring—transparency isn't just ethical; it's a regulatory requirement," notes Dr. Maria Lopez, Director of AI Ethics at the Global Institute for Responsible Innovation.
`;
    const blob = await convertMarkdownToDocx(markdown);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    // Save the file for manual inspection
    const outputPath = path.join(outputDir, "supporting-evidence-test.docx");
    const arrayBuffer = await blob.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

    // Add more specific assertions if needed, e.g., by unpacking and inspecting the docx content
  });
});

describe("List Functionality Tests", () => {
  it("should correctly handle bullet points and numbered lists", async () => {
    const markdown = `# Lists Test Document

## Bullet Points Test
- **First** bullet point
- **Second** bullet point with **bold text**
- **Third** bullet point with *italic text*
- **Fourth** bullet point with \`inline code\`

## Numbered Lists Test
1. First numbered item
2. Second numbered item with **bold text**
3. Third numbered item with *italic text*
4. Fourth numbered item with \`inline code\`

## Mixed Lists Test
- **Bullet** point one
- **Bullet** point two

1. First numbered item
2. Second numbered item
3. Third numbered item

- Back to bullet points
- Another bullet point

## Complex List Items
- List item with multiple formatting: **bold**, *italic*, and \`code\`
- List item with special characters: "quotes", 'apostrophes', & symbols

1. Numbered item with multiple formatting: **bold**, *italic*, and \`code\`
2. Numbered item with special characters: "quotes", 'apostrophes', & symbols

## Lists with Bold Text on Next Line
- Regular list item
  **Bold text on next line**
- Another list item
  **More bold text**

1. Numbered list item
2. Another numbered item`;

    const docxBlob = await convertMarkdownToDocx(markdown);

    // Save the blob to a file for manual inspection
    const buffer = await docxBlob.arrayBuffer();
    const outputPath = path.join(outputDir, "lists-functionality-test.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    // Verify the blob was created successfully
    expect(docxBlob).toBeInstanceOf(Blob);
    expect(docxBlob.size).toBeGreaterThan(0);
    expect(docxBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("should handle list resets and transitions", async () => {
    const markdown = `# Advanced Lists Test

## Sequential Numbered Lists (should reset)
1. First list item
2. Second list item

Some interrupting text here.

1. New list should start from 1 again
2. Second item in new list
3. Third item

## Bullet to Number Transition
- Bullet item 1
- Bullet item 2

1. Number item 1 (should be 1, not 3)
2. Number item 2

## Number to Bullet Transition  
1. Number item 1
2. Number item 2

- Bullet item 1 
- Bullet item 2`;

    const docxBlob = await convertMarkdownToDocx(markdown);

    // Save the blob to a file
    const buffer = await docxBlob.arrayBuffer();
    const outputPath = path.join(outputDir, "advanced-lists-test.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    // Verify the blob was created successfully
    expect(docxBlob).toBeInstanceOf(Blob);
    expect(docxBlob.size).toBeGreaterThan(0);
  });
});
