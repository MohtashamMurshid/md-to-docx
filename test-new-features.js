const fs = require("fs");
const { convertMarkdownToDocx } = require("./dist/index.js");

async function testNewFeatures() {
  console.log("🧪 Testing new markdown-to-docx features...");

  const markdown = `
# Advanced Features Test

[TOC]

## Nested Lists
- Level 1
  - Level 2
    - Level 3
- Back to Level 1

1. Numbered Level 1
   1. Numbered Level 2
   2. Another Level 2

## Task Lists
- [x] Completed task
- [ ] Incomplete task
  - [x] Nested completed
  - [ ] Nested incomplete

## Definition Lists
JavaScript
: A programming language

TypeScript
: JavaScript with static types

## Math Equations
The quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$

$$
E = mc^2
$$

## Advanced Formatting
Text with ^superscript^ and ~subscript~

~~Strikethrough text~~

## Horizontal Rule
---

## Emoji Support
Hello! 😊 Welcome to our documentation! 🚀

## Citations and Footnotes
This is referenced material.[^1] More info [@smith2023].

[^1]: This is a footnote.
`;

  const options = {
    style: {
      titleSize: 32,
      taskListCheckboxSize: 24,
      mathEquationSize: 24,
      definitionListTermBold: true,
      horizontalRuleColor: "000000",
      superscriptSize: 18,
      subscriptSize: 18,
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

  try {
    console.log("Converting markdown with new features...");
    const docxBlob = await convertMarkdownToDocx(markdown, options);

    console.log("✅ Conversion successful!");
    console.log(`📄 Generated DOCX blob size: ${docxBlob.size} bytes`);

    // If running in Node.js environment, save the file
    if (typeof window === "undefined") {
      const buffer = Buffer.from(await docxBlob.arrayBuffer());
      fs.writeFileSync("test-output.docx", buffer);
      console.log("💾 Saved as test-output.docx");
    }

    console.log("🎉 All new features tested successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

// Run the test
testNewFeatures();
