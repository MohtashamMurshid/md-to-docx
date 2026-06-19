import type { DocxDocumentModel } from "./docxModel.js";
import { MarkdownConversionError } from "./errors.js";

export interface RustCoreOptions {
  executablePath?: string;
  mathEnabled?: boolean;
}

interface RustCoreResponse {
  model?: DocxDocumentModel;
}

const RUST_CORE_ENV = "MD_TO_DOCX_RUST_CORE";

export async function convertMarkdownToDocxModelWithRust(
  markdown: string,
  options: RustCoreOptions = {},
): Promise<DocxDocumentModel> {
  const executablePath = await resolveRustCoreExecutable(options.executablePath);
  const request = JSON.stringify({
    markdown,
    options: {
      mathEnabled: options.mathEnabled ?? true,
    },
  });

  const response = await runRustCoreExecutable(executablePath, request);
  const parsed = parseRustCoreResponse(response);
  return parsed.model;
}

export async function isRustCoreAvailable(
  executablePath?: string,
): Promise<boolean> {
  try {
    await resolveRustCoreExecutable(executablePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRustCoreExecutable(
  explicitPath?: string,
): Promise<string> {
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const fs = await import("node:fs/promises");

  const envPath = process.env[RUST_CORE_ENV];
  const candidates = explicitPath ? [explicitPath] : [
    envPath,
    path.resolve(process.cwd(), "target", "release", executableName()),
    path.resolve(process.cwd(), "target", "debug", executableName()),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "target",
      "release",
      executableName(),
    ),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "target",
      "debug",
      executableName(),
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new MarkdownConversionError(
    `Rust core executable not found. Build crates/md-to-docx-core or set ${RUST_CORE_ENV}.`,
  );
}

function executableName(): string {
  return process.platform === "win32" ? "md-to-docx-core.exe" : "md-to-docx-core";
}

async function runRustCoreExecutable(
  executablePath: string,
  request: string,
): Promise<string> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: Error) => {
      reject(
        new MarkdownConversionError(
          `Failed to start Rust core: ${error.message}`,
          { originalError: error },
        ),
      );
    });
    child.on("close", (code: number | null) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(
          new MarkdownConversionError(
            `Rust core failed with exit code ${code ?? "unknown"}${
              errorOutput ? `: ${errorOutput}` : ""
            }`,
          ),
        );
        return;
      }
      resolve(output);
    });

    child.stdin.end(request);
  });
}

function parseRustCoreResponse(response: string): { model: DocxDocumentModel } {
  let parsed: RustCoreResponse;
  try {
    parsed = JSON.parse(response) as RustCoreResponse;
  } catch (error) {
    throw new MarkdownConversionError(
      `Rust core returned invalid JSON: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error },
    );
  }

  if (!parsed.model || !Array.isArray(parsed.model.children)) {
    throw new MarkdownConversionError(
      "Rust core returned an invalid document model",
      { response },
    );
  }

  return { model: parsed.model };
}
