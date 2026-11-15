import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

const typed = ["src/**/*.ts", "tests/**/*.ts"];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tsPlugin.configs["flat/strict-type-checked"].map((config) => ({
    ...config,
    files: typed,
  })),
  {
    files: typed,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Exceptions to strict-type-checked; each has a row in docs/DECISIONS.md.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        // The preset's options, restated because ESLint replaces rather than
        // merges them, with only numbers and booleans allowed.
        {
          allowAny: false,
          allowBoolean: true,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
    },
  },
  {
    // The complexity refactor series removes a file from this list once its
    // functions pass fallow's thresholds and these two rules
    // (docs/DECISIONS.md, "Complexity baseline").
    files: [
      "src/renderers/chartRenderer.ts",
      "src/renderers/imageRenderer.ts",
    ],
    rules: {
      "max-depth": "off",
      "max-params": "off",
    },
  },
  {
    // Public plugin hook types keep `Root | void` so hooks written as
    // `() => {}` or annotated `: Root | void` stay assignable (docs/DECISIONS.md).
    files: ["src/pluginTypes.ts"],
    rules: {
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    // The one place that still reads the deprecated `fontFamilly` alias for
    // backwards compatibility, and the test that proves the alias still works
    // (docs/DECISIONS.md).
    files: ["src/utils/styleUtils.ts", "tests/rendering.test.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
];
