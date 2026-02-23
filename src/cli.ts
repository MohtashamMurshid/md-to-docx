#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertMarkdownToDocx } from "./index.js";
import { Options } from "./types.js";

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface ParsedCliArgs {
  inputPath: string;
  outputPath: string;
  optionsPath?: string;
}

interface HelpCliArgs {
  showHelp: true;
}

type CliArgs = ParsedCliArgs | HelpCliArgs;

const HELP_TEXT = `Usage:
  md-to-docx <input.md> <output.docx> [--options <options.json>]

Examples:
  md-to-docx a.md b.docx
  npx @mohtasham/md-to-docx a.md b.docx
  md-to-docx a.md b.docx --options options.json`;

function parseCliArgs(args: string[]): CliArgs {
  if (args.includes("-h") || args.includes("--help")) {
    return { showHelp: true };
  }

  const positional: string[] = [];
  let optionsPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--options" || arg === "-o") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        throw new Error("Missing value for --options");
      }
      optionsPath = nextArg;
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length !== 2) {
    throw new Error("Expected exactly 2 positional arguments: <input.md> <output.docx>");
  }

  return {
    inputPath: positional[0],
    outputPath: positional[1],
    optionsPath,
  };
}

async function readOptionsFile(optionsPath: string): Promise<Options> {
  const content = await fs.readFile(optionsPath, "utf8");

  try {
    const parsed: unknown = JSON.parse(content);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Options JSON must be an object");
    }

    return parsed as Options;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in options file "${optionsPath}": ${error.message}`);
    }
    throw error;
  }
}

export async function runCli(
  args: string[],
  output: CliOutput = { log: console.log, error: console.error }
): Promise<number> {
  try {
    const parsedArgs = parseCliArgs(args);
    if ("showHelp" in parsedArgs) {
      output.log(HELP_TEXT);
      return 0;
    }

    const inputPath = path.resolve(parsedArgs.inputPath);
    const outputPath = path.resolve(parsedArgs.outputPath);
    const markdown = await fs.readFile(inputPath, "utf8");
    const options = parsedArgs.optionsPath
      ? await readOptionsFile(path.resolve(parsedArgs.optionsPath))
      : undefined;
    const blob = await convertMarkdownToDocx(markdown, options);
    const arrayBuffer = await blob.arrayBuffer();

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));

    output.log(`DOCX created at: ${outputPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    output.error(`Error: ${message}`);
    output.error("");
    output.error(HELP_TEXT);
    return 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedFilePath === path.resolve(currentFilePath)) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
