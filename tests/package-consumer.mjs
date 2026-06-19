import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const tempRoot = fs.mkdtempSync(
  path.join(repoRoot, "node_modules", ".package-consumer-")
);
const packDir = path.join(tempRoot, "pack");
const consumerDir = path.join(tempRoot, "consumer");
const packageDir = path.join(
  consumerDir,
  "node_modules",
  "@mohtasham",
  "md-to-docx"
);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}${os.EOL}`);
}

try {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });

  const tarballName = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDir, "--silent"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
  const tarballPath = path.join(packDir, tarballName);

  run("tar", ["-xzf", tarballPath, "-C", packageDir, "--strip-components=1"]);

  writeJson(path.join(consumerDir, "package.json"), {
    type: "module",
    dependencies: {
      "@mohtasham/md-to-docx": "file:./node_modules/@mohtasham/md-to-docx",
    },
  });

  fs.writeFileSync(
    path.join(consumerDir, "index.ts"),
    [
      'import { convertMarkdownToDocx } from "@mohtasham/md-to-docx";',
      "",
      "async function main() {",
      '  const doc = await convertMarkdownToDocx("# Hello");',
      "  console.log(doc instanceof Blob);",
      "}",
      "",
      "void main();",
      "",
    ].join(os.EOL)
  );

  const configs = {
    node16: {
      target: "ES2020",
      module: "Node16",
      moduleResolution: "Node16",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    nodenext: {
      target: "ES2020",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    bundler: {
      target: "ES2020",
      module: "ES2020",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
  };

  for (const [name, compilerOptions] of Object.entries(configs)) {
    writeJson(path.join(consumerDir, `tsconfig.${name}.json`), {
      compilerOptions,
      include: ["index.ts"],
    });
  }

  const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

  for (const name of Object.keys(configs)) {
    console.log(`Verifying consumer import with ${name} resolution`);
    run(process.execPath, [tscPath, "-p", `tsconfig.${name}.json`], {
      cwd: consumerDir,
    });
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
