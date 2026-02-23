import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliOutput, runCli } from "../src/cli";

describe("standalone CLI", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-to-docx-cli-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("converts a markdown file to docx", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output.docx");
    const logs: string[] = [];
    const errors: string[] = [];
    const output: CliOutput = {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    };

    await fsp.writeFile(inputPath, "# CLI Test\n\nThis file should convert.");

    const exitCode = await runCli([inputPath, outputPath], output);

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toContain("DOCX created at:");

    const stat = await fsp.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("supports options loaded from JSON file", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output-with-options.docx");
    const optionsPath = path.join(tempDir, "options.json");
    const output: CliOutput = {
      log: () => {},
      error: () => {},
    };

    await fsp.writeFile(inputPath, "# Styled CLI Test\n\nContent.");
    await fsp.writeFile(
      optionsPath,
      JSON.stringify({
        documentType: "report",
        style: {
          heading1Alignment: "CENTER",
          paragraphAlignment: "JUSTIFIED",
        },
      })
    );

    const exitCode = await runCli(
      [inputPath, outputPath, "--options", optionsPath],
      output
    );

    expect(exitCode).toBe(0);
    const stat = await fsp.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("returns non-zero on invalid arguments", async () => {
    const errors: string[] = [];
    const output: CliOutput = {
      log: () => {},
      error: (message) => errors.push(message),
    };

    const exitCode = await runCli([], output);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Usage:");
  });
});
