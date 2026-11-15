#!/usr/bin/env node
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertMarkdownToBuffer,
  convertMarkdownWithReferenceDocxToBuffer,
  patchMarkdownInDocxToBuffer,
} from "./index.js";
import type { ReferenceDocxGenerationOptions } from "./types.js";

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
  readStdin?: () => Promise<string>;
  writeStdout?: (data: Buffer) => Promise<void>;
}

const HELP_TEXT = `Usage:
  md-to-docx <input.md|-> <output.docx|-> [options]
  md-to-docx --batch <input-directory> <output-directory> [options]
  md-to-docx <template.docx> <output.docx> --patches <patches.json>

Options:
  --options, -o <options.json>  Conversion options
  --reference <reference.docx> Adopt reference document styles
  --patches <patches.json>     Replace named placeholders with Markdown
  --base-dir <directory>      Base directory for local image paths
  --batch                     Convert .md files recursively, preserving directories
  --watch                     Rebuild when inputs, options, or local assets change
  --help, -h                  Show help

Use - for stdin/stdout. Diagnostics go to stderr when writing binary stdout.`;

interface CliArgs {
  input: string;
  output: string;
  options?: string;
  reference?: string;
  patches?: string;
  baseDirectory?: string;
  batch: boolean;
  watch: boolean;
}
type ValueFlagField = "options" | "reference" | "patches" | "baseDirectory";
const VALUE_FLAGS: Record<string, ValueFlagField> = {
  "--options": "options",
  "-o": "options",
  "--reference": "reference",
  "--patches": "patches",
  "--base-dir": "baseDirectory",
};

function flagValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("-"))
    throw new Error(`Missing value for ${flag}`);
  return value;
}

/** Reads flags into `result` and returns the positional arguments. */
function collectCliArgs(args: string[], result: CliArgs): string[] {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--batch" || arg === "--watch") {
      result[arg.slice(2) as "batch" | "watch"] = true;
      continue;
    }
    const key = VALUE_FLAGS[arg];
    if (key) result[key] = flagValue(args[++i], arg);
    else if (arg.startsWith("-") && arg !== "-")
      throw new Error(`Unknown argument: ${arg}`);
    else positional.push(arg);
  }
  return positional;
}

function assertCompatibleArgs(result: CliArgs, positional: string[]): void {
  if (
    result.patches &&
    (result.reference || result.batch || result.input === "-")
  )
    throw new Error(
      "--patches cannot be combined with --reference, --batch, or stdin",
    );
  if ((result.watch || result.batch) && positional.includes("-"))
    throw new Error("--watch and --batch require file paths");
  if (
    result.batch &&
    path.resolve(result.input) === path.resolve(result.output)
  )
    throw new Error("Batch input and output directories must differ");
}

function parseCliArgs(args: string[]): CliArgs | undefined {
  if (args.includes("--help") || args.includes("-h")) return undefined;
  const result: CliArgs = { input: "", output: "", batch: false, watch: false };
  const positional = collectCliArgs(args, result);
  if (positional.length !== 2)
    throw new Error(
      "Expected exactly 2 positional arguments: <input.md> <output.docx>",
    );
  result.input = positional[0]!;
  result.output = positional[1]!;
  assertCompatibleArgs(result, positional);
  return result;
}
async function readOptionsFile(
  file: string,
): Promise<ReferenceDocxGenerationOptions> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        `Invalid JSON in options file "${file}": ${error.message}`,
      );
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Options JSON must be an object");
  if ("plugins" in parsed)
    throw new Error(
      "Plugins are trusted executable code and cannot be loaded from CLI JSON",
    );
  return parsed;
}
async function collectFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}
async function standardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    // Stdin yields Buffers (or strings once an encoding is set).
    const data: unknown = chunk;
    chunks.push(
      data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data)),
    );
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function standardOutput(data: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(data, (error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
}
async function atomicWrite(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** One CLI run: parsed arguments and where its output and messages go. */
interface CliRun {
  parsed: CliArgs;
  output: CliOutput;
  signal: AbortSignal | undefined;
  /** Progress messages: stdout, or stderr when stdout carries the DOCX. */
  report: (message: string) => void;
  binaryStdout: boolean;
}

/** A CLI run with its options file and reference DOCX loaded. */
interface CliJob extends CliRun {
  options: ReferenceDocxGenerationOptions;
  reference: Buffer | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listInputs(parsed: CliArgs): Promise<string[]> {
  if (!parsed.batch) return [parsed.input];
  const files = await collectFiles(path.resolve(parsed.input));
  return files.filter((file) => /\.md$/i.test(file));
}

/** The JSON options for one input, with the caller's signal and warnings. */
function conversionOptionsFor(input: string, job: CliJob) {
  const { parsed, options, signal, output } = job;
  const baseDirectory = path.resolve(
    parsed.baseDirectory ??
      options.imageHandling?.baseDirectory ??
      (input === "-" ? process.cwd() : path.dirname(input)),
  );
  // The caller's signal always replaces any `signal` key from JSON.
  const { signal: _jsonSignal, ...jsonOptions } = options;
  return {
    ...jsonOptions,
    ...(signal ? { signal } : {}),
    imageHandling: { ...options.imageHandling, baseDirectory },
    onWarning: (warning: { code: string; message: string }) => {
      output.error(`[${warning.code}] ${warning.message}`);
    },
  };
}

async function renderInput(input: string, job: CliJob): Promise<Buffer> {
  const { parsed, reference, output } = job;
  const conversionOptions = conversionOptionsFor(input, job);
  if (parsed.patches) {
    const patches: unknown = JSON.parse(
      await fs.readFile(parsed.patches, "utf8"),
    );
    return patchMarkdownInDocxToBuffer(
      await fs.readFile(input),
      patches as Parameters<typeof patchMarkdownInDocxToBuffer>[1],
      conversionOptions,
    );
  }
  const markdown =
    input === "-"
      ? await (output.readStdin ?? standardInput)()
      : await fs.readFile(input, "utf8");
  return reference
    ? convertMarkdownWithReferenceDocxToBuffer(
        markdown,
        reference,
        conversionOptions,
      )
    : convertMarkdownToBuffer(markdown, conversionOptions);
}

/** Batch outputs mirror the input tree, with .md renamed to .docx. */
function destinationFor(parsed: CliArgs, input: string): string {
  return parsed.batch
    ? path.resolve(
        parsed.output,
        path
          .relative(path.resolve(parsed.input), input)
          .replace(/\.md$/i, ".docx"),
      )
    : path.resolve(parsed.output);
}

async function convertInput(input: string, job: CliJob): Promise<void> {
  // Called unbound, as the caller-supplied CliOutput function always was.
  const { output, report } = job;
  const buffer = await renderInput(input, job);
  const destination = destinationFor(job.parsed, input);
  if (job.binaryStdout) await (output.writeStdout ?? standardOutput)(buffer);
  else {
    await atomicWrite(destination, buffer);
    report(`DOCX created at: ${destination}`);
  }
}

/**
 * Converts every input once. In batch mode a failed input is reported and
 * the rest still convert; the run then fails as a whole.
 */
async function convertAll(run: CliRun): Promise<void> {
  const { parsed, signal } = run;
  const options = parsed.options ? await readOptionsFile(parsed.options) : {};
  const inputs = await listInputs(parsed);
  if (!inputs.length) throw new Error("No Markdown files found");
  const reference = parsed.reference
    ? await fs.readFile(parsed.reference)
    : undefined;
  const job: CliJob = { ...run, options, reference };
  let failed = false;
  for (const input of inputs) {
    if (signal?.aborted) return;
    try {
      await convertInput(input, job);
    } catch (error) {
      if (!parsed.batch) throw error;
      failed = true;
      run.output.error(`${input}: ${errorText(error)}`);
    }
  }
  if (failed) throw new Error("One or more batch conversions failed");
}

export async function runCli(
  args: string[],
  output: CliOutput = { log: console.log, error: console.error },
  signal?: AbortSignal,
): Promise<number> {
  let cleanup = (): void => {};
  try {
    const parsed = parseCliArgs(args);
    if (!parsed) {
      output.log(HELP_TEXT);
      return 0;
    }
    const binaryStdout = parsed.output === "-";
    const report = binaryStdout ? output.error : output.log;
    const convert = (): Promise<void> =>
      convertAll({ parsed, output, signal, report, binaryStdout });
    try {
      await convert();
    } catch (error) {
      if (!parsed.watch) throw error;
      output.error(String(error));
    }
    if (!parsed.watch) return 0;
    const roots = new Set([
      path.resolve(parsed.batch ? parsed.input : path.dirname(parsed.input)),
      ...[parsed.options, parsed.reference, parsed.patches]
        .filter((file): file is string => !!file)
        .map((file) => path.dirname(path.resolve(file))),
    ]);
    if (parsed.baseDirectory) roots.add(path.resolve(parsed.baseDirectory));
    let finishRun: Promise<void> = Promise.resolve();
    let dirty = false;
    let running = false;
    let closed = false;
    // Read through a function: `stop` can close the watcher during an await.
    const isClosed = (): boolean => closed;
    const watchers = new Map<string, ReturnType<typeof watch>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (): Promise<void> => {
      const assetDirectory = parsed.options
        ? (await readOptionsFile(parsed.options)).imageHandling?.baseDirectory
        : undefined;
      if (assetDirectory) roots.add(path.resolve(assetDirectory));
      const visit = async (directory: string): Promise<void> => {
        if (closed) return;
        if (!watchers.has(directory)) {
          const watcher = watch(directory, (_event, filename) => {
            if (
              filename &&
              /\.(docx|tmp)$/i.test(filename) &&
              ![parsed.reference, parsed.patches, parsed.input].some(
                (file) =>
                  file &&
                  path.resolve(file) ===
                    path.join(directory, filename),
              )
            )
              return;
            dirty = true;
            clearTimeout(timer);
            timer = setTimeout(() => {
              finishRun = rebuild();
            }, 100);
          });
          watcher.on("error", (error) =>
            { output.error(`Watch error: ${error.message}`); },
          );
          watchers.set(directory, watcher);
        }
        for (const entry of await fs.readdir(directory, {
          withFileTypes: true,
        }))
          if (entry.isDirectory())
            await visit(path.join(directory, entry.name));
      };
      for (const root of roots) await visit(root);
    };
    const rebuild = async (): Promise<void> => {
      if (running || closed) return;
      running = true;
      try {
        while (dirty && !isClosed()) {
          dirty = false;
          try {
            await convert();
            await refresh();
          } catch (error) {
            output.error(String(error));
          }
        }
      } finally {
        running = false;
      }
    };
    await new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        closed = true;
        clearTimeout(timer);
        for (const watcher of watchers.values()) watcher.close();
        resolve();
      };
      cleanup = () => {
        stop();
        signal?.removeEventListener("abort", stop);
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      };
      signal?.addEventListener("abort", stop, { once: true });
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      if (signal?.aborted) stop();
      else
        void refresh()
          .then(() => { report("Watching for changes..."); })
          .catch(reject);
    });
    await finishRun;
    return 0;
  } catch (error) {
    output.error(`Error: ${errorText(error)}`);
    output.error(HELP_TEXT);
    return 1;
  } finally {
    cleanup();
  }
}

export async function isDirectCliInvocation(
  invokedFilePath: string,
  currentFilePath: string,
  realpath: (filePath: string) => Promise<string> = fs.realpath,
): Promise<boolean> {
  if (!invokedFilePath) {
    return false;
  }

  const resolvedInvokedFilePath = path.resolve(invokedFilePath);
  const resolvedCurrentFilePath = path.resolve(currentFilePath);

  try {
    return (
      (await realpath(resolvedInvokedFilePath)) ===
      (await realpath(resolvedCurrentFilePath))
    );
  } catch {
    return resolvedInvokedFilePath === resolvedCurrentFilePath;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

void isDirectCliInvocation(invokedFilePath, currentFilePath).then(
  async (isDirect) => {
    if (!isDirect) {
      return;
    }

    process.exitCode = await runCli(process.argv.slice(2));
  },
);
