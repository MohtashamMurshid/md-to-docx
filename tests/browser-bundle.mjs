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
  path.join(repoRoot, "node_modules", ".browser-bundle-")
);
const packDir = path.join(tempRoot, "pack");
const appDir = path.join(tempRoot, "app");
const packageDir = path.join(
  appDir,
  "node_modules",
  "@mohtasham",
  "md-to-docx"
);
const nextBin = path.join(
  repoRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function walkJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkJavaScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

try {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });

  const tarballName = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDir, "--silent"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
  execFileSync(
    "tar",
    [
      "-xzf",
      path.join(packDir, tarballName),
      "-C",
      packageDir,
      "--strip-components=1",
    ],
    { stdio: "inherit" }
  );

  write(
    path.join(appDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        scripts: { build: "next build --turbopack" },
        dependencies: {
          "@mohtasham/md-to-docx":
            "file:./node_modules/@mohtasham/md-to-docx",
          next: "15.5.22",
          react: "19.2.4",
          "react-dom": "19.2.4",
        },
      },
      null,
      2
    )}${os.EOL}`
  );
  write(
    path.join(appDir, "next.config.mjs"),
    "export default { output: 'export' };\n"
  );
  write(
    path.join(appDir, "app", "layout.js"),
    [
      'import { createElement } from "react";',
      "",
      "export default function Layout({ children }) {",
      '  return createElement("html", { lang: "en" },',
      '    createElement("body", null, children));',
      "}",
      "",
    ].join(os.EOL)
  );
  write(
    path.join(appDir, "app", "page.js"),
    [
      '"use client";',
      "",
      'import { createElement } from "react";',
      "import {",
      "  convertMarkdownToDocx,",
      "  downloadDocx,",
      '} from "@mohtasham/md-to-docx";',
      "",
      "export default function Page() {",
      "  async function exportDocx() {",
      '    const blob = await convertMarkdownToDocx("# Browser export\\n\\nNo remote images.");',
      '    await downloadDocx(blob, "browser-export.docx");',
      "  }",
      "",
      '  return createElement("button", { onClick: exportDocx }, "Export DOCX");',
      "}",
      "",
    ].join(os.EOL)
  );

  execFileSync(process.execPath, [nextBin, "build", "--turbopack"], {
    cwd: appDir,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
  });

  const clientChunkDir = path.join(appDir, ".next", "static", "chunks");
  const clientFiles = walkJavaScriptFiles(clientChunkDir);
  if (clientFiles.length === 0) {
    throw new Error("Next.js did not emit any client JavaScript chunks");
  }

  const forbiddenImports = [
    "node:dns/promises",
    "node:net",
    'from"undici"',
    'require("undici")',
  ];
  let foundBrowserRemoteImagePolicy = false;
  for (const filePath of clientFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    foundBrowserRemoteImagePolicy ||= source.includes(
      "Remote image fetching is unavailable in browsers"
    );
    for (const forbiddenImport of forbiddenImports) {
      if (source.includes(forbiddenImport)) {
        throw new Error(
          `Browser chunk ${path.relative(appDir, filePath)} contains ${forbiddenImport}`
        );
      }
    }
  }
  if (!foundBrowserRemoteImagePolicy) {
    throw new Error(
      "Next.js client chunks did not select the browser image-fetch implementation"
    );
  }

  console.log(
    `Verified ${clientFiles.length} Next.js/Turbopack client chunks without Node image-fetch dependencies`
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
