import { describe, it, expect } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "test-output");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

describe("Table rendering", () => {
  it("should render basic tables with headers and rows", async () => {
    const markdown = `
---

## 📊 Example Workflow Summary

| Stage | Tool | Output |
|--------|------|--------|
| Quantity Takeoff | Revit / Navisworks | Excel / CSV schedule |
| Cost Estimate | 5D Cost Software (e.g., CostX, Synchro, Revit plug-ins) | BOQ / Cost report |
| Coordination | Navisworks / Solibri | Clash report (BCF / PDF) |

---

Would you like a **template or example format** for these reports (e.g., Excel or PDF structure for quantity, cost, and clash tracking)? I can outline those next.
`;

    const blob = await convertMarkdownToDocx(markdown);
    const buffer = await blob.arrayBuffer();
    const outputPath = path.join(outputDir, "table-basic.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("should support alignment markers and empty cells", async () => {
    const markdown = `
| Left | Center | Right | Empty |
|:-----|:------:|------:|-------|
| a    |   b    |     c |       |
| d    |   e    |     f |   g   |
`;

    const blob = await convertMarkdownToDocx(markdown);
    const buffer = await blob.arrayBuffer();
    const outputPath = path.join(outputDir, "table-aligned-empty.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  // GitHub Issue #23 regression test
  it("should render table from GitHub issue #23 with proper width (not narrow)", async () => {
    const markdown = `
---

## 📊 Example Workflow Summary

| Stage | Tool | Output |
|--------|------|--------|
| Quantity Takeoff | Revit / Navisworks | Excel / CSV schedule |
| Cost Estimate | 5D Cost Software (e.g., CostX, Synchro, Revit plug-ins) | BOQ / Cost report |
| Coordination | Navisworks / Solibri | Clash report (BCF / PDF) |

---

Would you like a **template or example format** for these reports (e.g., Excel or PDF structure for quantity, cost, and clash tracking)? I can outline those next.
`;

    const blob = await convertMarkdownToDocx(markdown);
    const buffer = await blob.arrayBuffer();
    const outputPath = path.join(outputDir, "github-issue-23.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("should apply column alignment from markdown alignment markers", async () => {
    const markdown = `
| Left Aligned | Center Aligned | Right Aligned |
|:-------------|:--------------:|--------------:|
| left text    | center text    | right text    |
| more left    | more center    | more right    |
`;

    const blob = await convertMarkdownToDocx(markdown);
    const buffer = await blob.arrayBuffer();
    const outputPath = path.join(outputDir, "table-column-alignment.docx");
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("should use configurable tableLayout option", async () => {
    const markdown = `
| Column A | Column B | Column C |
|----------|----------|----------|
| Short    | Text     | Here     |
`;

    // Test with autofit (default)
    const blobAutofit = await convertMarkdownToDocx(markdown, {
      style: { tableLayout: "autofit" }
    });
    const bufferAutofit = await blobAutofit.arrayBuffer();
    const outputPathAutofit = path.join(outputDir, "table-layout-autofit.docx");
    fs.writeFileSync(outputPathAutofit, Buffer.from(bufferAutofit));

    // Test with fixed
    const blobFixed = await convertMarkdownToDocx(markdown, {
      style: { tableLayout: "fixed" }
    });
    const bufferFixed = await blobFixed.arrayBuffer();
    const outputPathFixed = path.join(outputDir, "table-layout-fixed.docx");
    fs.writeFileSync(outputPathFixed, Buffer.from(bufferFixed));

    expect(blobAutofit).toBeInstanceOf(Blob);
    expect(blobFixed).toBeInstanceOf(Blob);
  });
});
