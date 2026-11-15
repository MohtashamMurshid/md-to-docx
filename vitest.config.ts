import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (file: string): string =>
  fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  resolve: {
    // package.json `imports` point at dist/; tests run against the Node
    // variants of the sources instead.
    alias: [
      {
        find: /^#image-assets$/,
        replacement: source("./src/utils/imageAssets.node.ts"),
      },
      {
        find: /^#secure-image-fetch$/,
        replacement: source("./src/utils/secureImageFetch.node.ts"),
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "coverage",
    },
  },
});
