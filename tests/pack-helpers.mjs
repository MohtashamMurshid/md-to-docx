import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Create a temporary fixture under the repository's node_modules, with a
 * `pack` directory for the tarball and a `projectName` directory whose
 * node_modules holds the extracted package.
 */
export function createPackFixture(prefix, projectName) {
  const tempRoot = fs.mkdtempSync(path.join(repoRoot, "node_modules", prefix));
  const projectDir = path.join(tempRoot, projectName);
  return {
    tempRoot,
    packDir: path.join(tempRoot, "pack"),
    projectDir,
    packageDir: path.join(projectDir, "node_modules", "@mohtasham", "md-to-docx"),
  };
}

/** `npm pack` the repository into packDir and extract it into packageDir. */
export function packAndExtract({ packDir, packageDir }) {
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
    { cwd: repoRoot, env: process.env, stdio: "inherit" }
  );
}
