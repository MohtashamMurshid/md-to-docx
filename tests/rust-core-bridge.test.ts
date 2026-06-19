import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  convertMarkdownToDocxModelWithRust,
  isRustCoreAvailable,
  MarkdownConversionError,
} from "../src/index";

describe("Rust core bridge", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-to-docx-rust-core-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("invokes a JSON CLI contract and returns the document model", async () => {
    if (process.platform === "win32") {
      return;
    }

    const executable = path.join(tempDir, "core.mjs");
    await fsp.writeFile(
      executable,
      [
        "#!/usr/bin/env node",
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({",
        "    model: {",
        "      children: [{",
        "        type: 'heading',",
        "        level: 1,",
        "        children: [{ type: 'text', value: request.markdown.trim().replace(/^#\\s*/, '') }]",
        "      }]",
        "    }",
        "  }));",
        "});",
        "",
      ].join(os.EOL),
      { mode: 0o755 },
    );

    await expect(isRustCoreAvailable(executable)).resolves.toBe(true);
    await expect(
      convertMarkdownToDocxModelWithRust("# From Rust", {
        executablePath: executable,
      }),
    ).resolves.toEqual({
      children: [
        {
          type: "heading",
          level: 1,
          children: [{ type: "text", value: "From Rust" }],
        },
      ],
    });
  });

  it("reports unavailable Rust core binaries as conversion errors", async () => {
    const missingExecutable = path.join(tempDir, "missing-core");

    await expect(isRustCoreAvailable(missingExecutable)).resolves.toBe(false);
    await expect(
      convertMarkdownToDocxModelWithRust("# Missing", {
        executablePath: missingExecutable,
      }),
    ).rejects.toBeInstanceOf(MarkdownConversionError);
  });

  it("times out hung Rust core processes", async () => {
    if (process.platform === "win32") {
      return;
    }

    const executable = path.join(tempDir, "hung-core.mjs");
    await fsp.writeFile(
      executable,
      [
        "#!/usr/bin/env node",
        "process.stdin.resume();",
        "setTimeout(() => {}, 60_000);",
        "",
      ].join(os.EOL),
      { mode: 0o755 },
    );

    await expect(
      convertMarkdownToDocxModelWithRust("# Hung", {
        executablePath: executable,
        timeoutMs: 10,
      }),
    ).rejects.toThrow("timed out");
  });
});
