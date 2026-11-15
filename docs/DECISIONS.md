# Decisions

Each tool choice, check and lint exception in this repository, and why. When you add a check, relax a rule or pick a tool, add a row here in the same change. `npm run guardrails` fails if `eslint.config.js` relaxes a rule that no row names.

## Checks

| Check | What it enforces | Why |
| --- | --- | --- |
| `npm run ci` | Runs everything CI runs, in CI's order: guardrails, lint, typecheck, build, tests with coverage, fallow, and the packed-consumer and browser-bundle checks. | One command reproduces a CI failure locally. |
| `npm test` | Vitest (`vitest.config.ts`) runs `tests/**/*.test.ts` in the Node environment; `npm run test:coverage` adds v8 coverage as JSON. | Vitest runs ESM and TypeScript natively, so there is no ts-jest transform and no `--experimental-vm-modules`. `vi.fn` / `vi.spyOn` are near drop-in for the `jest.*` calls the tests used, and `resolve.alias` maps `#image-assets` and `#secure-image-fetch` to their Node sources the way Jest's `moduleNameMapper` did. Vitest 4 is the newest major whose `engines` accepts Node 20; Vitest 5 needs Node 22.12. |
| Node versions in CI | Unit tests, the packed-consumer check and the browser-bundle check run on Node 20, 22 and 24; pnpm and Bun consumers on 20 and 22. Node 18 runs only `npm run test:consumer` (`consumer-node18`). | Node 18 is past end-of-life and the test tooling no longer supports it, but `engines` still allows it, so CI still proves the packed package imports there. Dropping Node 18 from `engines` would be a breaking release. |
| `npm run typecheck` | `tsc` over `src/`, `tests/` and `vitest.config.ts` together (`tsconfig.test.json`), including Vitest's types. | Vitest strips types without checking them. Under ts-jest, which compiled each test file on its own, the tests used extensionless imports that never resolved under Node16, so every type in them was an error type and nothing noticed. Typechecking the tests as one program catches that. |
| `tsconfig.json` strict flags | `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals` and `noUnusedParameters`. | `noUncheckedIndexedAccess` makes the existing `children[0]` / `arr[arr.length - 1]` guards meaningful instead of dead, and `exactOptionalPropertyTypes` separates a missing option from one set to `undefined`, which this library's merge logic depends on. |
| `npm run lint` | `@typescript-eslint` `strict-type-checked`, plus `max-depth` 3 and `max-params` 4. `noInlineConfig` is on. | Type-aware rules catch unsafe `any` flow and dead conditions; inline config would let one call site opt out silently. |
| `npm run fallow` | Fails on dead files, exports and dependencies, any clone group, and any function above cognitive 15, cyclomatic 20 or CRAP 30. CRAP uses real test coverage: Vitest's v8 provider writes Istanbul-shaped JSON to `coverage/coverage-final.json`. | Thresholds match the ones used in our other repositories. Measured coverage keeps CRAP honest: a well-tested complex function scores lower than its static estimate. |
| `npm run guardrails` | No inline suppressions; exact devDependency pins and ranged runtime dependencies; SHA-pinned workflow actions with a tag comment, explicit `permissions` and `persist-credentials: false` (read from each checkout step's parsed `with:` via the `yaml` devDependency, so comments and other keys can't stand in); `skills/md-to-docx/SKILL.md` documents every CLI flag in `--help`; every relaxed lint rule has a row here. | Rules lint and tsc cannot express. Each one is a correction that would otherwise be repeated in review. |

## Lint exceptions

| Rule | Where | Why |
| --- | --- | --- |
| `@typescript-eslint/no-non-null-assertion` | everywhere | Off. With `noUncheckedIndexedAccess`, a `!` after a bounds check or a non-optional regex group states a fact the compiler cannot see. Banning it pushes code toward `as` casts or dead fallbacks, which are worse. |
| `@typescript-eslint/restrict-template-expressions` | everywhere | Numbers and booleans are allowed in template literals; error messages and XML attributes interpolate them constantly, and their string form is unambiguous. Objects, `unknown`, `null` and `undefined` stay banned. |
| `@typescript-eslint/no-unused-vars` | everywhere | Configured, not relaxed: `_`-prefixed names are allowed for intentionally unused parameters and destructured values. |
| `max-depth`, `max-params` | `src/index.ts`, `src/mdastToDocxModel.ts`, `src/modelToDocx.ts`, `src/patchPackage.ts`, `src/referenceDocx.ts`, `src/renderers/chartRenderer.ts`, `src/renderers/imageRenderer.ts`, `src/richTables.ts` | Complexity baseline: these files hold the functions in `fallow-baselines/health.json`. The complexity refactor series removes a file from this list, and its functions from the baseline, once they pass. Both lists only shrink. |
| `@typescript-eslint/no-invalid-void-type` | `src/pluginTypes.ts` | Public plugin hooks return `Root \| void \| Promise<Root \| void>`. Replacing `void` with `undefined` would stop hooks written as `() => {}`, or annotated `: Root \| void`, from compiling for consumers. |
| `@typescript-eslint/no-deprecated` | `src/utils/styleUtils.ts`, `tests/rendering.test.ts` | `resolveFontFamily` is the one reader of the deprecated `fontFamilly` alias, kept for backwards compatibility, and `tests/rendering.test.ts` proves the alias still works. Everything else calls `resolveFontFamily`. Elsewhere the rule stays on; an option object passed where a type accepts `T \| string` (such as docx's `TextRun`) gets `satisfies T`, because typescript-eslint otherwise resolves a `bold` or `italics` key against the deprecated `String.prototype.bold()` / `italics()`. |

## Fallow exceptions

| Setting | Why |
| --- | --- |
| `ignoreDependencies`: `conventional-changelog-conventionalcommits` | Loaded by name through `.releaserc.json`'s `preset`, never imported. |
| `ignoreDependencies`: `next`, `react`, `react-dom` | `tests/browser-bundle.mjs` builds a throwaway Next.js app with them to prove the browser bundle has no Node-only imports; it runs `next`'s binary rather than importing it. |
| `duplicates.ignoredClones`: `dup:4143b1d8:2` | `src/renderers/mathRenderer.ts`'s `COMMAND_REPLACEMENTS` table of TeX command names and symbols. With string literals blinded, its two halves look alike; it is data, not copied logic. Only reviewed data tables go in this list. |
| `fallow-baselines/health.json` | The complexity findings that existed when fallow was adopted, saved per function (`--baseline-mode identity`) so a new complex function fails even in a file that already has one. Refactor PRs delete entries; nothing adds them. |
