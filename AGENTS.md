# md-to-docx

A TypeScript library and CLI that converts Markdown to Word `.docx`, in Node and the browser, published as `@mohtasham/md-to-docx`.

The pipeline runs in this order:

1. `src/markdownAst.ts` parses Markdown with remark.
2. `src/mdastToDocxModel.ts` turns the mdast into a docx model.
3. `src/modelToDocx.ts` builds docx objects from the model.
4. `src/packageRepairs.ts` packs them.

Other entry points:

- `src/referenceDocx.ts` adopts a reference document's styles.
- `src/patchPackage.ts` fills placeholders in an existing `.docx`.
- `src/pluginRuntime.ts` runs custom renderer plugins.
- `src/cli.ts` is the CLI.

Node-only and browser-only code is split through `package.json` `imports` (`#image-assets`, `#secure-image-fetch`).

People and agents follow the same rules. Before opening an issue or a PR, read [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

## How to work

- When several options all work, pick the one that is best for the library's users first, then contributors, then agents, and break nothing.
- The public API is everything exported from `src/index.ts`, plus the CLI flags and `skills/md-to-docx/SKILL.md`. Keep it backwards compatible. A breaking change needs `!` in the PR title and a `BREAKING CHANGE:` footer.
- [docs/DECISIONS.md](docs/DECISIONS.md) records every tool choice, check and lint exception, with its reason. Follow its rows. When you add or relax one, add a row in the same change.
- When the same correction comes up twice, make it a lint rule or a check in `scripts/guardrails.mjs`, not another line in this file.
- Before you add complexity for an unlikely race or security edge case, explain the concrete failure, how likely it is and what it costs, and get agreement first.

## Code

- Validate untrusted input once, at the boundary: `src/validation.ts`, plugin validation in `src/pluginRuntime.ts`, JSON fences (`chart`, `table`) and CLI options files. Read the value as `unknown` and narrow it. Plain-JS callers and JSON files ignore TypeScript types, so never delete a runtime check because the type says it can't fail. Past the boundary, trust the types.
- No inline suppressions: `eslint-disable`, `@ts-ignore`, `@ts-expect-error` and `fallow-ignore` all fail guardrails. Fix the code, or change the config and add a DECISIONS row.
- Narrow types instead of casting with `as`. Use `!` only where the bounds are proven in the code next to it.
- Output is deterministic: the same input gives byte-identical package parts, apart from the `docProps` timestamps. docx draws bookmark and drawing IDs from process-wide counters, and `renumberProcessWideIds` in `src/packageRepairs.ts` renumbers them per document. Never depend on the raw IDs docx assigns.
- Security-sensitive code: `src/utils/secureImageFetch.node.ts` (SSRF guard, DNS pinning, redirect and byte limits), the ZIP and XML validation in `src/referenceDocx.ts` and `src/patchPackage.ts`, and `src/processingLimits.ts`. Keep every check, in the same order. Cover changes in `tests/security-regressions.test.ts` or `tests/image-security.test.ts`.
- The CLI never loads executable plugins from JSON.

## Tests

- Add a test only when the task asks for one or you are fixing a regression. For a regression, add the one test that fails without the fix, and watch it fail before you apply the fix.
- Assert observable output, meaning the generated XML parts read through the JSZip helpers in `tests/helpers.ts`, not internal call shapes. Prove each behaviour once, at the strongest boundary, and extend an existing table or test before adding a new one.
- A refactor must not change output. Show that the tests still pass and that the generated parts are unchanged before and after.

## Checks

- `npm run ci` runs everything CI runs, in CI's order. Before each commit, run at least `npm run guardrails`, `npm run lint`, `npm run typecheck`, and the tests for what you touched.
- `npm run fallow` fails on dead files, exports and dependencies, on any clone group, and on any function above cognitive complexity 15, cyclomatic complexity 20 or CRAP 30. CRAP uses coverage from `npm run test:coverage`, so run that first. Extract shared code instead of copying it. Only reviewed data tables go in `duplicates.ignoredClones`.
- There is no complexity baseline: every function passes the thresholds and lint caps, so a new finding fails CI. Split or simplify the function; never raise a threshold or add a file-level lint override without a DECISIONS row.
- Lint caps nesting at depth 3 and parameters at 4. Use an options object instead of a fifth parameter.

## Releases

semantic-release publishes from `main` on every push (`.github/workflows/release.yml`, `.releaserc.json`). Never do any of these by hand:

- bump `version` in `package.json` or `package-lock.json`
- edit `CHANGELOG.md`
- create a `v*` tag or a GitHub Release
- run `npm publish`

PRs are squash-merged, so the PR title becomes the commit that semantic-release reads. It decides the release:

| Title type | Release |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:`, or a `BREAKING CHANGE:` footer | major |
| `chore:` `docs:` `style:` `refactor:` `perf:` `test:` `ci:` `build:` | none |

If asked to "cut a release" or "bump the version", don't. Check for releasable commits since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`). If none exist, say so and ask what change should ship. [RELEASING.md](RELEASING.md) has the full process.

`release.yml` runs on Node 22, because semantic-release 25 needs Node 22.14 or later. Its `setup-node` must not set `registry-url`: semantic-release writes its own npm auth, and a second `.npmrc` causes a 401.

## Gotchas

- `#image-assets` and `#secure-image-fetch` take their types from `dist/*.d.ts`. After changing those modules or their types, run `npm run build` before `npm run typecheck`.
- fallow needs Node 22 or later. The library itself supports the range in `package.json` `engines`.
- Set `DEBUG_DOCX=1` to make tests write `.docx` files to `test-output/` for inspection in Word.
