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

## Runtime dependencies

| Dependency | Why |
| --- | --- |
| `undici` (`^6`) | The Node image fetcher pins each connection to the DNS-verified address through an undici `Agent` with a custom connector, and calls the `fetch` exported by the same `undici` package, never the global one. An `Agent` only works with the `fetch` from its own undici release: Node 26's bundled undici 8 rejects an undici 6 `Agent` (`invalid onError method`), so with the global `fetch` every remote image failed there. The tests replace `undici`'s `fetch` with `tests/undiciFetchMock.ts`, and one test runs the real connector against a stubbed `tls.connect`. It stays on 6 because undici 7 and later need Node 20.18.1, above the Node 18 floor in `engines`. |
| `hast-util-from-html`, `hast-util-sanitize`, `hast-util-to-html` | `htmlRendering` hands raw HTML to `docx/html`, which embeds data-URL and inline-SVG images itself and blocks only `javascript:`-like links. The library parses the HTML first, counts its nodes toward `maxElements`, sanitizes it with GitHub's schema (links held to the Markdown allowlist), sends every `<img>` through the image pipeline, and serializes the result for `docx/html`. These are the unified ecosystem's own HTML tools, beside `remark`; they run in Node and browsers. They and `docx/html` load with a dynamic `import()` on the first raw HTML node, so bundles and conversions without HTML do not carry them up front. `docx` moves to `^9.15.4`, the first version this was built and tested against with `docx/html`. |

## Lint exceptions

| Rule | Where | Why |
| --- | --- | --- |
| `@typescript-eslint/no-non-null-assertion` | everywhere | Off. With `noUncheckedIndexedAccess`, a `!` after a bounds check or a non-optional regex group states a fact the compiler cannot see. Banning it pushes code toward `as` casts or dead fallbacks, which are worse. |
| `@typescript-eslint/restrict-template-expressions` | everywhere | Numbers and booleans are allowed in template literals; error messages and XML attributes interpolate them constantly, and their string form is unambiguous. Objects, `unknown`, `null` and `undefined` stay banned. |
| `@typescript-eslint/no-unused-vars` | everywhere | Configured, not relaxed: `_`-prefixed names are allowed for intentionally unused parameters and destructured values. |
| `@typescript-eslint/no-invalid-void-type` | `src/pluginTypes.ts` | Public plugin hooks return `Root \| void \| Promise<Root \| void>`. Replacing `void` with `undefined` would stop hooks written as `() => {}`, or annotated `: Root \| void`, from compiling for consumers. |
| `@typescript-eslint/no-deprecated` | `src/utils/styleUtils.ts`, `tests/rendering.test.ts` | `resolveFontFamily` is the one reader of the deprecated `fontFamilly` alias, kept for backwards compatibility, and `tests/rendering.test.ts` proves the alias still works. Everything else calls `resolveFontFamily`. Elsewhere the rule stays on; an option object passed where a type accepts `T \| string` (such as docx's `TextRun`) gets `satisfies T`, because typescript-eslint otherwise resolves a `bold` or `italics` key against the deprecated `String.prototype.bold()` / `italics()`. |

## Fallow exceptions

| Setting | Why |
| --- | --- |
| `ignoreDependencies`: `conventional-changelog-conventionalcommits` | Loaded by name through `.releaserc.json`'s `preset`, never imported. |
| `ignoreDependencies`: `next`, `react`, `react-dom` | `tests/browser-bundle.mjs` builds a throwaway Next.js app with them to prove the browser bundle has no Node-only imports; it runs `next`'s binary rather than importing it. |
| `duplicates.ignoredClones`: `dup:4143b1d8:2` | `src/renderers/mathRenderer.ts`'s `COMMAND_REPLACEMENTS` table of TeX command names and symbols. With string literals blinded, its two halves look alike; it is data, not copied logic. Only reviewed data tables go in this list. |
