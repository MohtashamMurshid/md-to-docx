import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const supportedPackageManagers = new Set(["bun", "pnpm"]);
const packageManager = process.argv[2];

if (!supportedPackageManagers.has(packageManager)) {
  console.error("Usage: node tests/package-manager-consumer.mjs <bun|pnpm>");
  process.exit(1);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), `md-to-docx-${packageManager}-consumer-`),
);
const packDir = path.join(tempRoot, "pack");
const consumerDir = path.join(tempRoot, "consumer");
const consumerEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("npm_")),
);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? consumerDir,
    env: consumerEnv,
    stdio: "inherit",
  });
}

function assertDocx(filePath, label) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 4 || bytes.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(`${label} did not produce a valid DOCX ZIP package`);
  }
}

try {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumerDir, { recursive: true });

  const tarballName = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDir, "--silent"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  const tarballPath = path.join(packDir, tarballName);

  fs.writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}${os.EOL}`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "index.mjs"),
    [
      'import fs from "node:fs/promises";',
      'import { convertMarkdownToBuffer } from "@mohtasham/md-to-docx";',
      "",
      'const output = await convertMarkdownToBuffer("# Package manager check\\n\\n- [x] Works");',
      'if (output.subarray(0, 2).toString("ascii") !== "PK") {',
      '  throw new Error("Library API did not return a valid DOCX ZIP package");',
      "}",
      'await fs.writeFile("api-output.docx", output);',
      `console.log("${packageManager} library import passed");`,
      "",
    ].join(os.EOL),
  );
  fs.writeFileSync(
    path.join(consumerDir, "cli-input.md"),
    "# Package manager CLI check\n\nThe published binary works.\n",
  );

  if (packageManager === "pnpm") {
    run("pnpm", ["add", "--ignore-scripts", tarballPath]);
    run("pnpm", ["exec", "node", "index.mjs"]);
    run("pnpm", ["exec", "md-to-docx", "cli-input.md", "cli-output.docx"]);
  } else {
    run("bun", ["add", "--ignore-scripts", tarballPath]);
    run("bun", ["run", "--bun", "index.mjs"]);
    run("bun", ["run", "--bun", "md-to-docx", "cli-input.md", "cli-output.docx"]);
  }

  assertDocx(path.join(consumerDir, "api-output.docx"), "Library API");
  assertDocx(path.join(consumerDir, "cli-output.docx"), "CLI");
  console.log(`${packageManager} package installation, import, and CLI passed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
