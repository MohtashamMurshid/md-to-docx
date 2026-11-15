import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPackFixture, packAndExtract, repoRoot } from "./pack-helpers.mjs";

const fixture = createPackFixture(".package-consumer-", "consumer");
const { tempRoot, projectDir: consumerDir } = fixture;

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
  packAndExtract(fixture);

  writeJson(path.join(consumerDir, "package.json"), {
    type: "module",
    dependencies: {
      "@mohtasham/md-to-docx": "file:./node_modules/@mohtasham/md-to-docx",
    },
  });

  fs.writeFileSync(
    path.join(consumerDir, "index.ts"),
    [
      'import { convertMarkdownToDocx, convertMarkdownWithReferenceDocxToBuffer, MarkdownConversionError, type ReferenceDocxGenerationOptions, type MarkdownDocxPlugin, type PluginRenderContext, type AccessibilityOptions, type DocumentMetadata, type Options } from "@mohtasham/md-to-docx";',
      "",
      "const plugin: MarkdownDocxPlugin = {",
      "  apiVersion: 1,",
      '  name: "consumer.notice",',
      "  fencedBlocks: [{",
      '    languages: ["notice"],',
      "    render(input, context: PluginRenderContext) {",
      '      return { type: "paragraph", children: `${context.pluginName}: ${input.value}` };',
      "    },",
      "  }],",
      "};",
      "",
      "async function main() {",
      '  const legacyError = new MarkdownConversionError("legacy", ["custom", 42]);',
      '  const metadata: DocumentMetadata = { title: "Accessible report", language: "en-GB" };',
      '  const accessibility: AccessibilityOptions = { missingImageAltText: "throw" };',
      "  const options: Options = { metadata, accessibility, plugins: [plugin] };",
      "  const referenceOptions: ReferenceDocxGenerationOptions = { reference: { missingStyleBehavior: \"throw\" } };",
      '  const doc = await convertMarkdownToDocx("# Hello", options);',
      "  void convertMarkdownWithReferenceDocxToBuffer;",
      "  void referenceOptions;",
      "  void legacyError;",
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
