import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliOutput, isDirectCliInvocation, runCli } from "../src/cli";

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

  it("loads options from JSON (--options and -o) and supports multi-section template", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const simpleOptionsPath = path.join(tempDir, "options.json");
    const multiSectionOptionsPath = path.join(tempDir, "multi-section.json");

    await fsp.writeFile(inputPath, "# Styled CLI Test\n\nContent.");
    await fsp.writeFile(
      simpleOptionsPath,
      JSON.stringify({
        documentType: "report",
        style: {
          heading1Alignment: "CENTER",
          paragraphAlignment: "JUSTIFIED",
        },
      })
    );
    await fsp.writeFile(
      multiSectionOptionsPath,
      JSON.stringify({
        template: {
          page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 } },
          pageNumbering: { display: "current", alignment: "CENTER" },
        },
        sections: [
          {
            markdown: "# Cover\n\nPrepared by CLI",
            footers: { default: null },
            pageNumbering: { display: "none" },
            style: { paragraphAlignment: "CENTER" },
          },
          {
            markdown: "# Body\n\nMain content starts here.\n\n1. One\n2. Two",
            headers: { default: { text: "Main Section", alignment: "RIGHT" } },
            pageNumbering: { start: 1, formatType: "decimal" },
          },
        ],
      })
    );

    // --options (long flag)
    const long = captureOutput();
    const longOut = path.join(tempDir, "long.docx");
    expect(
      await runCli([inputPath, longOut, "--options", simpleOptionsPath], long)
    ).toBe(0);
    expect(long.errors).toHaveLength(0);
    expect((await fsp.stat(longOut)).size).toBeGreaterThan(0);

    // -o (short flag)
    const short = captureOutput();
    const shortOut = path.join(tempDir, "short.docx");
    expect(
      await runCli([inputPath, shortOut, "-o", simpleOptionsPath], short)
    ).toBe(0);
    expect(short.errors).toHaveLength(0);

    // multi-section template
    const multi = captureOutput();
    const multiOut = path.join(tempDir, "multi.docx");
    expect(
      await runCli(
        [inputPath, multiOut, "--options", multiSectionOptionsPath],
        multi
      )
    ).toBe(0);
    expect(multi.errors).toHaveLength(0);
    expect((await fsp.stat(multiOut)).size).toBeGreaterThan(0);
  });

  it("creates nested output directories automatically", async () => {
    const inputPath = path.join(tempDir, "input.md");
    const outputPath = path.join(tempDir, "nested", "deep", "output.docx");
    const output = captureOutput();

    await fsp.writeFile(inputPath, "# Nested\n\nContent.");

    const exitCode = await runCli([inputPath, outputPath], output);

    expect(exitCode).toBe(0);
    expect((await fsp.stat(outputPath)).size).toBeGreaterThan(0);
  });

  it("recognizes npm bin symlinks as direct CLI invocations", async () => {
    const cliPath = path.join(tempDir, "dist", "cli.js");
    const binPath = path.join(tempDir, "node_modules", ".bin", "md-to-docx");

    await fsp.mkdir(path.dirname(cliPath), { recursive: true });
    await fsp.mkdir(path.dirname(binPath), { recursive: true });
    await fsp.writeFile(cliPath, "#!/usr/bin/env node\n");
    await fsp.symlink(cliPath, binPath);

    await expect(isDirectCliInvocation(binPath, cliPath)).resolves.toBe(true);
  });

  it.each([["--help"], ["-h"]])(
    "prints help text with %s and exits 0",
    async (flag) => {
      const output = captureOutput();
      const exitCode = await runCli([flag], output);

      expect(exitCode).toBe(0);
      expect(output.logs.join("\n")).toContain("Usage:");
      if (flag === "--help") {
        expect(output.logs.join("\n")).toContain("--options");
      }
    }
  );

  describe("failure modes", () => {
    // Cases that don't require setup beyond a fresh captureOutput/tempDir.
    const simpleCases: Array<{
      label: string;
      argv: (tmp: string) => string[];
      expectedError: string | RegExp;
    }> = [
      {
        label: "no arguments",
        argv: () => [],
        expectedError: "Usage:",
      },
      {
        label: "unknown flag",
        argv: () => ["a.md", "b.docx", "--verbose"],
        expectedError: "Unknown argument: --verbose",
      },
      {
        label: "--options without value",
        argv: () => ["a.md", "b.docx", "--options"],
        expectedError: "Missing value for --options",
      },
      {
        label: "too many positional arguments",
        argv: () => ["a.md", "b.docx", "extra.md"],
        expectedError: "Expected exactly 2 positional arguments",
      },
      {
        label: "only one positional argument",
        argv: () => ["a.md"],
        expectedError: "Expected exactly 2 positional arguments",
      },
      {
        label: "nonexistent input file",
        argv: (tmp) => [
          path.join(tmp, "missing.md"),
          path.join(tmp, "output.docx"),
        ],
        expectedError: /no such file|ENOENT/,
      },
    ];

    it.each(simpleCases)(
      "fails on $label",
      async ({ argv, expectedError }) => {
        const output = captureOutput();
        const exitCode = await runCli(argv(tempDir), output);

        expect(exitCode).toBe(1);
        const errText = output.errors.join("\n");
        if (typeof expectedError === "string") {
          expect(errText).toContain(expectedError);
        } else {
          expect(errText).toMatch(expectedError);
        }
      }
    );

    it.each([
      {
        label: "invalid JSON",
        body: "not valid json",
        expectedError: "Invalid JSON",
      },
      {
        label: "non-object JSON value",
        body: '["not", "an", "object"]',
        expectedError: "Options JSON must be an object",
      },
    ])("fails when options file contains $label", async ({ body, expectedError }) => {
      const inputPath = path.join(tempDir, "input.md");
      const outputPath = path.join(tempDir, "output.docx");
      const optionsPath = path.join(tempDir, "options.json");
      const output = captureOutput();

      await fsp.writeFile(inputPath, "# Test\n\nContent.");
      await fsp.writeFile(optionsPath, body);

      const exitCode = await runCli(
        [inputPath, outputPath, "--options", optionsPath],
        output
      );

      expect(exitCode).toBe(1);
      expect(output.errors.join("\n")).toContain(expectedError);
    });
  });
});
