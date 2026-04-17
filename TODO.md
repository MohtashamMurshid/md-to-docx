# TODO — Follow-up work

Tracks code-quality improvements identified during the April 2026 review that were **not** included in the `cleanup and split helpers` PR. Grouped by rough impact / risk.

## High impact

### 1. Rewrite inline handling to consume mdast nodes directly

The single biggest remaining win (~700 lines of code gone, whole class of bugs fixed).

- **Problem.** `remark-parse` + `remark-gfm` already produces proper `strong`, `emphasis`, `delete`, `inlineCode`, `link`, `break` nodes. But `[src/modelToDocx.ts](src/modelToDocx.ts)` flattens these inline children back into a markdown-ish string via `encodeInlineNode`, then hands them to `processFormattedText` in `[src/renderers/textRenderer.ts](src/renderers/textRenderer.ts)`, which re-parses the string character-by-character (~300 lines). This work is duplicated in `processFormattedTextForHeading` in `[src/renderers/headingRenderer.ts](src/renderers/headingRenderer.ts)`.
- **Plan.**
  1. In `[src/mdastToDocxModel.ts](src/mdastToDocxModel.ts)`, walk mdast inline children and emit `DocxTextNode`s directly (bold/italic/underline/strike/code/link flags set from the AST).
  2. In `modelToDocx.ts`, map each `DocxTextNode` straight to `new TextRun({ bold, italics, strike, underline })`. No stringification.
  3. Delete `processFormattedText`, `processFormattedTextForHeading`, `hasUnescapedMarker`, and the "unclosed marker rollback" blocks entirely.
  4. For `++underline++`, add a micromark/remark extension instead of a hand-rolled scanner.
- **Risk.** Touches the hot path. Needs snapshot tests or byte-level comparisons against current output before merging.

### 2. Fix bookmark ID collisions

- **Problem.** `[src/renderers/headingRenderer.ts](src/renderers/headingRenderer.ts)` builds bookmark IDs as `_Toc_${sanitized}_${Date.now()}`. Two headings in the same millisecond collide, and the timestamp makes output non-deterministic (breaks snapshot testing).
- **Fix.** Use a monotonic counter scoped to the document, or a short hash of `index + text`. Move the helper into `src/utils/bookmarkUtils.ts` so both the heading renderer and any future re-entry use the same scheme.

### 3. Harden the TOC placeholder plumbing

- **Problem.** `replaceTocPlaceholders` in `[src/index.ts](src/index.ts)` identifies placeholders via a hidden `__isTocPlaceholder` property that `modelToDocx.ts` attaches with a type cast. `DocxTocPlaceholderNode` already exists in `[src/docxModel.ts](src/docxModel.ts)` — the cleaner design keeps it in the model through rendering.
- **Fix.** Have `modelToDocx` return `(Paragraph | Table | { type: "tocPlaceholder" })[]`, then match on `type === "tocPlaceholder"` in `replaceTocPlaceholders` instead of the `as unknown as { __isTocPlaceholder }` cast.

## Medium impact

### 4. Restructure the `Style` interface

- **Problem.** `[src/types.ts](src/types.ts)` has 40+ flat props (`heading1Size`, `heading2Size`, …, `tocHeading1Bold`, `tocHeading1Italic`, …). Adding a 6th heading level would touch a dozen places.
- **Fix (v3 candidate).** Nest: `headings: Partial<Record<1|2|3|4|5, { size?: number; alignment?: AlignmentOption; bold?: boolean; italic?: boolean }>>`. Keep a compatibility shim that maps the old flat props so v2 configs still work for one release.

### 5. Drop the `fontFamilly` typo alias (breaking, v3)

- **Problem.** `[src/utils/styleUtils.ts](src/utils/styleUtils.ts)` still falls back to `style.fontFamilly`. It has a `@deprecated` tag but no runtime warning.
- **Plan.**
  - v2.x: emit `console.warn` on the first use in a session.
  - v3: delete the alias and the `normalizeStyleInput` branch that handles it in `[src/index.ts](src/index.ts)`.

### 6. Remove `console.warn` / `console.error` from library code

- **Problem.** Libraries shouldn't log by default. Current offenders:
  - `console.warn` in `replaceTocPlaceholders` (`[src/index.ts](src/index.ts)`) when a TOC placeholder has no headings.
  - `console.error` x2 in `processImage` catch block (`[src/renderers/imageRenderer.ts](src/renderers/imageRenderer.ts)`) on image failures.
- **Fix.** Either surface via the error object, accept an optional `logger` in `Options`, or make silent and let callers opt-in.

### 7. Type-safety cleanup in `mdastToDocxModel.ts`

- **Problem.** ~10 `(node as any)` and `(child as any)` casts in `[src/mdastToDocxModel.ts](src/mdastToDocxModel.ts)` where mdast types already cover the shape.
- **Fix.** Replace with narrowed access like `"value" in node ? node.value : undefined`, or discriminated-union narrowing via `node.type`.

### 8. Lazy-import `file-saver`

- **Problem.** `[src/index.ts](src/index.ts)` imports `file-saver` eagerly at the top level, so Node consumers that never call `downloadDocx` still resolve the dep.
- **Fix.** Move to dynamic `import("file-saver")` inside `downloadDocx`. `type: "module"` makes this straightforward.

### 9. Make `downloadDocx` use `MarkdownConversionError`

- **Problem.** `downloadDocx` in `[src/index.ts](src/index.ts)` throws plain `Error` while the rest of the library throws `MarkdownConversionError`. Inconsistent for consumers doing `instanceof` checks.

### 10. Expose a Node-friendly `toBuffer` / `toArrayBuffer` helper

- **Problem.** `convertMarkdownToDocx` is typed as `Promise<Blob>` but in Node `Packer.toBlob` returns a Blob-ish shape. The CLI works around it via `blob.arrayBuffer()`.
- **Fix.** Export `convertMarkdownToBuffer(markdown, options): Promise<Buffer>` for Node, keep `convertMarkdownToDocx` for the browser-friendly Blob, and have the CLI use the buffer variant.

## Low impact / polish

### 11. Extract magic numbers into `src/renderers/constants.ts`

Scattered across `helpers`-descendant files:

- `720` twips (0.5 inch indent) — `[blockquoteRenderer](src/renderers/blockquoteRenderer.ts)`, list/heading layout
- `240`, `260`, `360` — spacing/line constants in code block + list numbering config
- `400` image cap, `0.75` fallback aspect ratio — `[imageRenderer](src/renderers/imageRenderer.ts)`
- Colors `"F5F5F5"`, `"DDDDDD"`, `"0000FF"`, `"444444"`, `"666666"`, `"AAAAAA"`
- `defaultSectionMargins` (already named, good model)

Gather into a single `constants.ts` so tweaking is one-file instead of shotgun.

### 12. Centralize Node-vs-browser Buffer branching

- **Problem.** `typeof Buffer !== "undefined"` appears in ~5 places in `[src/renderers/imageRenderer.ts](src/renderers/imageRenderer.ts)` alone. Same logic runs each call.
- **Fix.** Small `src/utils/binary.ts` with `toBinaryData(input): Uint8Array | Buffer` and `isNodeEnv(): boolean`. Use everywhere.

### 13. Make inline code styling configurable

- **Problem.** `processInlineCode` in `[src/renderers/textRenderer.ts](src/renderers/textRenderer.ts)` hard-codes `color: "444444"`, `shading: "F5F5F5"`, and `size` fallback. Not exposed via `Style`.
- **Fix.** Add optional `inlineCodeColor`, `inlineCodeBackground`, `inlineCodeSize` to `Style` (or, if doing #4, under a `code` sub-object).

### 14. Switch `prepare` to `prepublishOnly`

- **Problem.** `[package.json](package.json)`'s `prepare: "npm run build"` causes every `npm install` in a consumer repo (and git install) to run `tsc`. Fine for dev, wasteful everywhere else.
- **Fix.** Either move to `prepublishOnly`, or gate with something that skips when installed as a dep.

### 15. Add lint/format/typecheck tooling

Not done in the cleanup PR because scope. Suggested:

```json
"scripts": {
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
  "lint": "eslint src tests",
  "format": "prettier --write src tests"
}
```

With a light ESLint config (`@typescript-eslint/recommended` + `no-console`) and a separate `tsconfig.test.json` that extends the main one and includes `tests/**`. This would have caught several of the `any` casts and the contradictory `tsconfig.json` settings on its own.

### 16. Unused TOC style props

If #4 happens, the 15 `tocHeading<N><Size|Bold|Italic>` props in `[src/types.ts](src/types.ts)` should collapse into the nested heading config. Otherwise leave them — they're public API.