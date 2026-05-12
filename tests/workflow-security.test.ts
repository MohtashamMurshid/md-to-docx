import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("Workflow security", () => {
  it("does not use mutable major-version GitHub Action tags", () => {
    const workflowDir = path.join(process.cwd(), ".github", "workflows");
    const workflows = fs
      .readdirSync(workflowDir)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));

    for (const workflow of workflows) {
      const contents = fs.readFileSync(path.join(workflowDir, workflow), "utf8");
      expect(contents).not.toMatch(/uses:\s*actions\/[^@\s]+@v\d+\b/);
    }
  });
});
