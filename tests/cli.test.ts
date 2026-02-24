import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliOutput, runCli } from "../src/cli";

function captureOutput(): CliOutput & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message: string) => logs.push(message),
    error: (message: string) => errors.push(message),
  };
}

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
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# CLI Test\n\nThis file should convert.");

    const exitCode = await runCli([inputPath, outputPath], output);

    expect(exitCode).toBe(0);
    expect(output.errors).toHaveLength(0);
    expect(output.logs.join("\n")).toContain("DOCX created at:");

    const stat = await fsp.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("supports options loaded from JSON file", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output-with-options.docx");
    const optionsPath = path.join(tempDir, "options.json");
    const output = captureOutput();

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

  it("supports -o short flag for options", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output.docx");
    const optionsPath = path.join(tempDir, "options.json");
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# Short Flag\n\nContent.");
    await fsp.writeFile(optionsPath, JSON.stringify({ documentType: "report" }));

    const exitCode = await runCli(
      [inputPath, outputPath, "-o", optionsPath],
      output
    );

    expect(exitCode).toBe(0);
    expect(output.errors).toHaveLength(0);
  });

  it("creates nested output directories automatically", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "nested", "deep", "output.docx");
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# Nested\n\nContent.");

    const exitCode = await runCli([inputPath, outputPath], output);

    expect(exitCode).toBe(0);
    const stat = await fsp.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("returns non-zero on invalid arguments", async () => {
    const output = captureOutput();

    const exitCode = await runCli([], output);

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Usage:");
  });

  it("prints help text with --help and exits 0", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["--help"], output);

    expect(exitCode).toBe(0);
    expect(output.logs.join("\n")).toContain("Usage:");
    expect(output.logs.join("\n")).toContain("--options");
  });

  it("prints help text with -h and exits 0", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["-h"], output);

    expect(exitCode).toBe(0);
    expect(output.logs.join("\n")).toContain("Usage:");
  });

  it("fails on nonexistent input file", async () => {
    const outputPath = path.join(tempDir, "output.docx");
    const output = captureOutput();

    const exitCode = await runCli(
      [path.join(tempDir, "missing.md"), outputPath],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toMatch(/no such file|ENOENT/);
  });

  it("fails on unknown flags", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["a.md", "b.docx", "--verbose"], output);

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Unknown argument: --verbose");
  });

  it("fails when --options is given without a value", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["a.md", "b.docx", "--options"], output);

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Missing value for --options");
  });

  it("fails when options file contains invalid JSON", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output.docx");
    const optionsPath = path.join(tempDir, "bad.json");
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# Test\n\nContent.");
    await fsp.writeFile(optionsPath, "not valid json");

    const exitCode = await runCli(
      [inputPath, outputPath, "--options", optionsPath],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Invalid JSON");
  });

  it("fails when options file contains a non-object JSON value", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "output.docx");
    const optionsPath = path.join(tempDir, "array.json");
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# Test\n\nContent.");
    await fsp.writeFile(optionsPath, '["not", "an", "object"]');

    const exitCode = await runCli(
      [inputPath, outputPath, "--options", optionsPath],
      output
    );

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Options JSON must be an object");
  });

  it("fails when too many positional arguments are given", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["a.md", "b.docx", "extra.md"], output);

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Expected exactly 2 positional arguments");
  });

  it("fails when only one positional argument is given", async () => {
    const output = captureOutput();

    const exitCode = await runCli(["a.md"], output);

    expect(exitCode).toBe(1);
    expect(output.errors.join("\n")).toContain("Expected exactly 2 positional arguments");
  });
});
