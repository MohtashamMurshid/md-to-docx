import { convertMarkdownToDocx } from "../src/index";
import * as fs from "fs/promises";
import * as path from "path";

describe("List Item Formatting", () => {
  it("should handle bold text within list items", async () => {
    const markdown = `- Regular list item
- **List** item with **bold text** inside
- Another list item with **multiple** bold **words**
- List item
  **Bold text on next line**
1. Numbered list with **bold text**
2. Another numbered item with **multiple** bold **sections**
- **List** item with **bold text** inside
- **List** item with **bold text** inside`;

    const docxBlob = await convertMarkdownToDocx(markdown);

    // Save the blob to a file
    const buffer = await docxBlob.arrayBuffer();
    const outputPath = path.join(process.cwd(), "test-output");
    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(
      path.join(outputPath, "list-formatting-test.docx"),
      Buffer.from(buffer)
    );

    // Verify the blob was created successfully
    expect(docxBlob).toBeInstanceOf(Blob);
    expect(docxBlob.size).toBeGreaterThan(0);
    expect(docxBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("should handle mixed formatting in list items", async () => {
    const markdown = `- List item with **bold** and *italic* text
- List item with \`code\` and **bold** formatting
- List item with **bold _italic_ text**`;

    const docxBlob = await convertMarkdownToDocx(markdown);

    // Save the blob to a file
    const buffer = await docxBlob.arrayBuffer();
    const outputPath = path.join(process.cwd(), "test-output");
    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(
      path.join(outputPath, "list-formatting-mixed-test.docx"),
      Buffer.from(buffer)
    );

    // Verify the blob was created successfully
    expect(docxBlob).toBeInstanceOf(Blob);
    expect(docxBlob.size).toBeGreaterThan(0);
    expect(docxBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });
});
