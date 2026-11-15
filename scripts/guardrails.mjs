#!/usr/bin/env node
// Repository rules that lint and tsc cannot express. Each check returns a list
// of problems; every problem is printed in one run, and any problem fails it.
// Run with `npm run guardrails`. docs/DECISIONS.md records why each rule exists.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/** Tracked and untracked (but not ignored) files matching the pathspecs. */
function repoFiles(...pathspecs) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    { cwd: root, encoding: "utf8" },
  );
  // NUL-separated, so unusual filenames come back verbatim instead of quoted.
  return output
    .split("\0")
    .filter((file) => file && fs.existsSync(path.join(root, file)));
}

const SUPPRESSION =
  /eslint-disable|@ts-(?:ignore|expect-error|nocheck)|fallow-ignore/;

/** Inline suppressions hide a problem at one call site; fix it or change config with a DECISIONS row. */
function suppressionProblems() {
  const files = repoFiles("src", "tests", "scripts").filter(
    (file) => /\.(?:[cm]?[jt]s)$/.test(file) && file !== "scripts/guardrails.mjs",
  );
  return files.flatMap((file) =>
    read(file)
      .split("\n")
      .flatMap((line, index) =>
        SUPPRESSION.test(line)
          ? [
              `${file}:${index + 1} has an inline suppression; fix the code, or change eslint.config.js / .fallowrc.json and add a docs/DECISIONS.md row: ${line.trim()}`,
            ]
          : [],
      ),
  );
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * devDependencies are pinned exactly so CI and every contributor run the same
 * tools. Runtime dependencies stay ranges: consumers install them, and ranges
 * let their package manager deduplicate.
 */
function pinProblems() {
  const manifest = JSON.parse(read("package.json"));
  const ranged = Object.entries(manifest.devDependencies ?? {}).filter(
    ([, version]) => !EXACT_VERSION.test(version),
  );
  const exactRuntime = Object.entries(manifest.dependencies ?? {}).filter(
    ([, version]) => EXACT_VERSION.test(version),
  );
  return [
    ...ranged.map(
      ([name, version]) =>
        `package.json devDependencies must pin exact versions: ${name} is ${version}`,
    ),
    ...exactRuntime.map(
      ([name, version]) =>
        `package.json dependencies must be ranges that consumers can deduplicate: ${name} is pinned to ${version}`,
    ),
  ];
}

const PINNED_ACTION = /^[^@\s]+@[0-9a-f]{40}\s+#\s*v\d[\w.-]*\s*$/;

/** The action a `uses:` line names, or undefined for other lines and local actions. */
function remoteAction(line) {
  const reference = line.match(/^\s*(?:-\s+)?uses:\s*(.+)$/)?.[1].trim();
  return reference?.startsWith("./") ? undefined : reference;
}

function actionPinProblems(where, reference) {
  return PINNED_ACTION.test(reference)
    ? []
    : [`${where} pins ${reference}; use a full commit SHA followed by "# vX.Y.Z"`];
}

function checkoutProblems(where, reference, stepLines) {
  const keepsToken =
    /^actions\/checkout@/.test(reference) &&
    !/persist-credentials:\s*false/.test(stepLines.join("\n"));
  return keepsToken
    ? [`${where} checks out without persist-credentials: false`]
    : [];
}

const indentOf = (line) => line.length - line.trimStart().length;
const STEP_START = /^\s*-\s/;

function stepStartIndex(lines, index) {
  let start = index;
  while (start > 0 && !STEP_START.test(lines[start])) start--;
  return start;
}

const endsStep = (line, indent) =>
  line.trim() !== "" && indentOf(line) <= indent;

/** The lines of the workflow step that contains `index`, from its `-` to the next step. */
function stepLines(lines, index) {
  const start = stepStartIndex(lines, index);
  const indent = indentOf(lines[start]);
  const length = lines
    .slice(start + 1)
    .findIndex((line) => endsStep(line, indent));
  return lines.slice(start, length === -1 ? lines.length : start + 1 + length);
}

function stepProblems(file, lines, index) {
  const reference = remoteAction(lines[index]);
  if (reference === undefined) return [];
  const where = `${file}:${index + 1}`;
  return [
    ...actionPinProblems(where, reference),
    ...checkoutProblems(where, reference, stepLines(lines, index)),
  ];
}

/** Each `uses:` is a commit SHA with its tag beside it, checkouts drop their token, and permissions are explicit. */
function workflowProblems() {
  const workflows = repoFiles(".github/workflows").filter((file) =>
    /\.ya?ml$/.test(file),
  );
  return workflows.flatMap((file) => {
    const text = read(file);
    const lines = text.split("\n");
    const permissions = /^permissions:/m.test(text)
      ? []
      : [`${file} has no top-level permissions block`];
    return [
      ...permissions,
      ...lines.flatMap((_, index) => stepProblems(file, lines, index)),
    ];
  });
}

/** The published agent skill documents every CLI flag the help text offers. */
function skillProblems() {
  const cli = read("src/cli.ts");
  const help = cli.match(/const HELP_TEXT = `([\s\S]*?)`;/);
  if (!help) {
    return ["src/cli.ts has no `const HELP_TEXT = `...`` help text for guardrails to read"];
  }
  const flags = new Set(help[1].match(/(?<![\w-])--?[a-z][a-z-]*/g));
  const skill = read("skills/md-to-docx/SKILL.md");
  return [...flags]
    .filter((flag) => !new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(skill))
    .map(
      (flag) =>
        `skills/md-to-docx/SKILL.md does not document the CLI flag ${flag} from md-to-docx --help`,
    );
}

/** Every rule eslint.config.js turns off or relaxes names a reason in docs/DECISIONS.md. */
function lintExceptionProblems() {
  const config = read("eslint.config.js");
  const decisions = fs.existsSync(path.join(root, "docs/DECISIONS.md"))
    ? read("docs/DECISIONS.md")
    : "";
  const relaxed = [
    // "off", "warn", 0 or 1, alone or as an array's severity, or "error" with
    // options that replace the preset's.
    ...config.matchAll(
      /"((?:@typescript-eslint\/)?[a-z-]+)":\s*(?:\[\s*)?(?:"(?:off|warn)"|[01]\b|(?<=\[\s*)"error",\s*\{)/g,
    ),
  ].map((match) => match[1]);
  return [...new Set(relaxed)]
    .filter((rule) => !decisions.includes(`\`${rule}\``))
    .map(
      (rule) =>
        `eslint.config.js relaxes ${rule}, but docs/DECISIONS.md has no row naming \`${rule}\``,
    );
}

const checks = {
  suppressions: suppressionProblems,
  pins: pinProblems,
  workflows: workflowProblems,
  skill: skillProblems,
  "lint exceptions": lintExceptionProblems,
};

const problems = Object.entries(checks).flatMap(([name, check]) =>
  check().map((problem) => `[${name}] ${problem}`),
);

if (problems.length > 0) {
  console.error(`guardrails found ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`guardrails: ${Object.keys(checks).length} checks passed`);
