# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.10.0] - 2026-04-17

### Added

- Optional syntax highlighting for fenced code blocks, powered by `[lowlight](https://github.com/wooorm/lowlight)`. Enable via `options.codeHighlighting.enabled` and each token is rendered as a colored `TextRun` in the DOCX output.
  - New `CodeHighlightOptions` and `CodeHighlightTheme` types exported from the package root.
  - Built-in GitHub-light default theme. Users can override any subset via a partial `theme` map. Reserved keys `default`, `background`, `border`, and `languageLabel` style the code block chrome.
  - `languages` whitelist (defaults to the lowlight `common` bundle of ~37 popular languages) controls which grammars get loaded; unknown or excluded languages transparently fall back to the plain rendering path so conversion never fails on an unsupported fence.
  - `showLanguageLabel` (default `true`) toggles the bold language label above the code.
- New `src/utils/codeHighlight.ts` module containing the theme, the cached lowlight instance factory, and the hast-tree tokenizer.

### Changed

- `processCodeBlock` in `src/renderers/codeRenderer.ts` now accepts an optional fourth `CodeHighlightOptions` argument. When highlighting is disabled (the default), output is byte-identical to 2.9.1.
- `modelToDocx` threads `options.codeHighlighting` through to the code block renderer.
- `modelToDocx` now inserts a blank spacer paragraph between two immediately-adjacent fenced code blocks so Word does not collapse their shared borders into a single visual block.

### Fixed

- `codeHighlighting.languages` now honors alias spellings. Previously, user-supplied aliases like `js`, `sh`, `yml`, `c++`, or `ts` were silently dropped because the grammar selector only accepted canonical keys from the lowlight `common` bundle; this disagreed with the documented contract ("those languages plus aliases are highlighted") and meant `languages: ["js"]` disabled highlighting entirely while `languages: ["javascript"]` worked. Aliases are now resolved to their canonical grammar before registration, so `["js"]`, `["sh"]`, `["yml"]`, `["c++"]`, and `["ts"]` all register the underlying grammar and highlight both alias and canonical fences. A new exported `canonicalLanguageName` helper in `src/utils/codeHighlight.ts` provides the resolution, memoized per process to avoid repeated probing.

### Tests

- Consolidated the test suite from 10 files / ~1,813 lines / ~24 mostly-smoke tests into 4 focused files / ~912 lines / 45 tests that make real semantic assertions against the generated Word XML instead of only checking `blob.size > 0`.
  - New `tests/rendering.test.ts` replaces eight old files (`index`, `heading-alignment`, `text-alignment`, `list-formatting`, `newline`, `image-size`, `style-system-v2`, `table`). Each test inspects `word/document.xml` via JSZip to verify alignment attributes, `<w:b/>`/`<w:i/>`/`<w:u/>`/`<w:strike/>` run properties, `<w:numPr>` numbering references, `<pic:pic>` image embedding, TOC fields, and `<w:br w:type="page"/>` page breaks.
  - New `tests/helpers.ts` shared utilities: `getDocumentXml(blob)`, `getZip(blob)`, and `saveBlobForDebug(blob, name)` — the latter gated behind `DEBUG_DOCX=1` so the `test-output/` directory no longer accumulates stale `.docx` artifacts on every run.
  - `tests/sections.test.ts` trimmed from 292 to 194 lines: merged overlapping "section type variants" and "advanced section properties" cases, collapsed the four invalid-config throws into a single `it.each` table.
  - `tests/cli.test.ts` trimmed from 286 to 232 lines: failure modes collapsed into two `it.each` tables (simple cases plus options-file parse errors); happy-path cases kept individual.
  - Eliminated all network-dependent image tests (previously hit `picsum.photos` and `raw.githubusercontent.com` with 30s timeouts). Image rendering is now exercised via an inline base64 PNG, so the suite runs offline and deterministically.
- Added `tests/code-highlighting.test.ts` covering default-off behavior, default-theme coloring for keyword/number/string tokens, custom theme overrides, unknown-language fallback, missing-language fallback, `showLanguageLabel: false`, language whitelist filtering, alias-valued whitelists (`js`, `sh`, `yml`, `c++`, `ts`), silent drop of unknown names, and newline preservation across multi-line highlighted blocks.
- Added `tsconfig.test.json` (and pointed `ts-jest` at it via `jest.config.mjs`) so test files can import shared helpers without violating the `rootDir: ./src` constraint used for library builds.
- Added `jszip@^3.10.1` as an explicit `devDependency` (previously pulled in only transitively via `docx`).
- Removed the stale `test:alignment` npm script (pointed at a long-gone path).

Full suite: 53/53 passing in ~2s.

## [2.9.1] - 2026-04-17

### Added

- Added a `package.json` `exports` field that formally scopes the public API to the root entrypoint (`.`) plus `./package.json`. This makes the supported surface explicit: anything not re-exported from `src/index.ts` is internal and may be reorganized without a major version bump. Deep imports into `dist/**` are no longer part of the compatibility contract.

### Changed

- Split the 1,449-line `src/helpers.ts` god-file into nine focused renderer modules under `src/renderers/` (`textRenderer`, `headingRenderer`, `listRenderer`, `tableRenderer`, `blockquoteRenderer`, `codeRenderer`, `commentRenderer`, `imageRenderer`, `paragraphRenderer`) and two shared utilities under `src/utils/` (`bookmarkUtils`, `styleUtils`).
- `processImage` now delegates aspect-ratio math to `computeImageDimensions` instead of re-inlining the same block; intrinsic PNG/JPG/GIF dimension reading extracted to a private helper.
- `MarkdownConversionError.context` is now typed as `unknown` instead of `any`.
- `fontFamilly` style property now carries a proper `@deprecated` JSDoc tag.

### Removed

- Deleted unused duplicate stubs and scanners that were never wired into the public code path: `src/parsers/textParser.ts`, all seven unused files under `src/renderers/*` (restored with the live implementations), the old `src/utils/bookmarkUtils.ts` duplicate, and `src/types.d.ts`.
- Removed the dead `processLink` function (returned a styled `TextRun` with no actual hyperlink behavior).
- Removed the unused `defaultStyle` and `headingConfigs` exports from `src/types.ts` (the canonical `defaultStyle` in `src/index.ts` is unchanged).

### Fixed

- Corrected contradictory `include`/`exclude` settings in `tsconfig.json` that simultaneously listed a single test file and excluded all `*.test.ts`.

### Internal

- No public API changes. All 57 existing tests pass unchanged.
- Added `TODO.md` tracking the remaining code-quality follow-ups (inline-parser rewrite, bookmark ID collisions, `Style` restructure, lint tooling, etc.).

## [2.9.0] - 2026-03-06

### Added

- New template + sections API (`options.template`, `options.sections`) for real multi-section document generation.
- Per-section header/footer slots (`default`, `first`, `even`) with optional page-number field rendering.
- Section-level page numbering controls (`start`, `formatType`, `separator`, and display strategy).
- Section-level style overrides so formatting can change mid-document (addresses GitHub issue #16 use case).
- Configurable `codeBlockAlignment` style option for code block paragraphs (`LEFT`, `CENTER`, `RIGHT`, `JUSTIFIED`), defaulting to `LEFT` (PR #40).

### Fixed

- Table cells now preserve inline formatting (bold, italic, strikethrough, underline, inline code, links) instead of stripping to plain text (GitHub issue #35).

### Changed

- `parseToDocxOptions` now emits real DOCX section entries instead of forcing a single continuous section.
- Numbered-list sequence IDs are offset per rendered section to avoid cross-section numbering collisions.
- `DocxTableNode` model stores rich `DocxTextNode[][]` cell content instead of plain strings.
- `processTable` in helpers now uses `processFormattedText` for cell rendering, enabling full inline markup support.

### Tests

- Added `tests/sections.test.ts` covering section properties, footer behavior, numbering resets, and per-section style conversion.
- Added table inline formatting tests covering bold, italic, strikethrough, underline, inline code, and links in cells and headers (issue #35).

## [2.8.0] - 2026-02-24

### Added

- Underline text formatting support via `++text++` markers in paragraphs, headings, and list items
- New `fontFamily` style option to set the base font family for all regular text runs (code spans/blocks remain monospace)
- Deprecated `fontFamilly` alias preserved for backwards compatibility
- Validation that rejects empty or whitespace-only `fontFamily` values

### Changed

- Refactored heading and paragraph text processing to use shared `createRun`/`flushCurrentText` helpers, reducing duplication
- Strikethrough (`~~text~~`) now properly wired through the internal document model (`DocxTextNode.strikethrough`)

### Tests

- Added `tests/style-system-v2.test.ts` covering font family, deprecated alias, underline markers, and invalid-value rejection

## [2.7.1] - 2026-02-24

### Added

- Added a reusable `md-to-docx` agent skill under `skills/md-to-docx/SKILL.md` to guide Markdown-to-DOCX conversions via CLI and programmatic API.
- Added install-ready skill metadata and workflow instructions so the repository can be discovered and installed with the `skills` CLI.

## [2.7.0] - 2026-02-24

### Added

- Added a standalone CLI via package binary `md-to-docx` to convert files directly from terminal.
- CLI now supports direct usage like `npx @mohtasham/md-to-docx a.md b.docx`.
- Added optional CLI flag `--options <options.json>` to load conversion options from a JSON file.

### Documentation

- Added README examples for standalone CLI usage.

### Fixed

- Fixed CLI error handler displaying "Unknown error" instead of actual error messages in ESM environments (cross-realm `instanceof Error` mismatch).

### Tests

- Added `tests/cli.test.ts` covering conversion success, options-file support, and invalid-argument handling.
- Added CLI tests for `-o` short flag, `--help`/`-h` flags, nested output directory creation, nonexistent input file, unknown flags, missing `--options` value, invalid JSON options, non-object JSON options, and wrong positional argument counts.

## [2.6.1] - 2026-01-21

### Fixed

- Fixed tables rendering with very narrow columns by adding explicit `columnWidths` array for proper auto-fit width calculation (PR #24)
- Added proper column width calculation based on A4 page content width (9026 DXA units)
- Fixed column-count mismatches in table width calculation by deriving max column count from both headers and all rows
- Ensured at least 1 column to avoid division by zero edge cases

## [2.6.0] - 2026-01-09

### Fixed

- Fixed table rendering issues where tables were narrow and columns misaligned (GitHub issue #23)
- Changed default table layout from `FIXED` to `AUTOFIT` for better automatic column sizing
- Table column alignment markers (`:---`, `:---:`, `---:`) are now properly captured and applied to DOCX cells

### Added

- New `tableLayout` style option to configure table layout mode (`"autofit"` or `"fixed"`)
- Support for partial style overrides - users can now pass only the style properties they want to change

### Changed

- `Options.style` now accepts `Partial<Style>` allowing partial style configuration that merges with defaults
- Updated `processTable` function signature to accept optional style parameter for layout configuration

## [2.5.1] - 2025-12-15

### Fixed

- Fixed data validation check in `processImage` function by simplifying the validation logic for improved efficiency and maintainability

## [2.5.0] - 2025-12-09

### Added

- Text find-and-replace functionality via `textReplacements` option in `Options`
- Support for pattern-based text replacement before markdown conversion using `mdast-util-find-and-replace`
- New `TextReplacement` interface for defining find/replace patterns (supports string or RegExp patterns)
- New `applyTextReplacements()` function exported from `markdownAst.ts` for advanced use cases
- Support for bold+italic formatting with `***text***` markers (triple asterisks) in paragraphs, headings, and list items
- Enhanced nested list handling with proper level tracking for multi-level bullet and numbered lists
- New internal document model architecture with `docxModel.ts`, `mdastToDocxModel.ts`, and `modelToDocx.ts` for improved separation of concerns

### Changed

- Major refactoring of markdown processing pipeline: conversion now uses AST-based approach with `remark-parse` and `remark-gfm`
- Improved list item rendering with proper level support for nested lists
- Enhanced text parser to handle combined bold+italic formatting (`***text***`) correctly
- Updated `ListItemConfig` interface to include `level` property for nested list support

### Notes

- Text replacements are applied to the markdown AST before conversion to DOCX, preserving markdown structure
- Supports both string literals and regular expressions for pattern matching
- Replacement can be a string or a function that returns a string or array of nodes
- Bold+italic formatting (`***text***`) is now properly recognized and rendered in all text contexts

## [2.4.0] - 2025-10-01

### Added

- Convert inline markdown links in text (e.g., `[text](url)`) into clickable hyperlinks inside paragraphs and list items.

### Notes

- This change extends `processFormattedText` to emit `ExternalHyperlink` nodes alongside `TextRun`, enabling mixed inline links within content.

## [2.3.0] - 2025-09-05

### Added

- New exported function `parseToDocxOptions(markdown, options)` that generates the `docx` `Document` configuration without creating a Blob. Useful for advanced pipelines, custom transforms, and testing.

### Changed

- Refactored `convertMarkdownToDocx` to delegate configuration generation to `parseToDocxOptions`, improving separation of concerns and testability. No breaking changes to the existing API.

### Fixed

- Images now preserve aspect ratio instead of being forced square; honors size hints in the image URL fragment such as `#180x16`, `#w=150&h=100`, and `#width=..&height=..`. Also supports data URLs directly. (Addresses issue #11)

### Tests

- Expanded image test in `tests/index.test.ts` to include explicit width/height hints.
- Added `tests/image-size.test.ts` to validate width-only, width+height, and data URL scenarios for images.

## [2.2.1] - 2025-08-09

### Fixed

- Unified table separator detection in `src/index.ts` to support alignment markers (`:---`, `:---:`, `---:`) in Markdown tables, matching `collectTables` behavior.

### Added

- New tests for table rendering covering alignment markers and empty cells.

## [2.2.0] - 2025-08-08

### Added

- Inline link support inside paragraphs (e.g., mixed text with `[text](url)`)
- Strikethrough formatting with `~~text~~` for headings and paragraphs

### Fixed

- ESM export path in `src/index.ts` to ensure Node ESM consumers resolve `./types.js`
- Image handling works in both Node and browsers; infers image type from headers/URL and uses `Uint8Array` in browsers
- Table parsing preserves empty cells (no column collapse)
- Enforced input validation in `convertMarkdownToDocx` for safer API usage
- Reduced noisy console logs in library code

### Removed

- Deleted dead root-level `index.ts` that referenced undefined variables

## [2.1.0] - 2025-08-08

### Added

- RTL/LTR direction support via new `style.direction` option (`"LTR" | "RTL"`).
  - Applies bidirectional layout to paragraphs, headings, blockquotes, list items, TOC entries, links, inline code, and code blocks (uses paragraph `bidirectional` and text run `rightToLeft` where appropriate in `docx`).
  - Works well in combination with `paragraphAlignment: "RIGHT"` for typical RTL layouts.

### Notes

- Direction is applied at paragraph and run level; style-level paragraph style does not include `bidirectional` per `docx` typings, so it is set on individual elements.

## [2.0.3] - 2025-01-21

### Fixed

- Fixed bold text formatting issue at the beginning of bullet points where `- **bold text**` was incorrectly rendered as `- bold text**` instead of properly bold formatted text
- Corrected regex pattern in list text extraction to preserve markdown formatting markers

## [2.0.0] - 2025-06-16

### Changed

- Major refactoring of the core conversion engine for improved performance and reliability
- Updated to use the latest version of docx library (v8.0.0)
- Improved error handling and reporting
- Enhanced type safety throughout the codebase

### Breaking Changes

- Removed support for legacy style options
- Changed default font family to 'Calibri'
- Modified table of contents generation API
- Updated configuration interface for better type safety

### Added

- Support for custom page margins
- Enhanced image handling with better size control
- New style options for list formatting
- Improved documentation with TypeScript examples

## [1.4.9] - 2025-06-6

### Changed

- added numbered list support
- Updated dependencies to latest versions
- Improved documentation and examples

## [1.4.8] - 2025-05-27

### Fixed

- Corrected an issue where markdown bold syntax (`**text**`) with internal spaces was not being rendered correctly as bold text in the output document.

## [1.4.7] - 2025-05-27

### Added

- Added feature to remove markdown separators (e.g., ---)

## [1.4.6] - 2025-04-28

### Changed

- Improved table detection and handling:
  - Enhanced regex checks for table separators
  - Better support for additional table format ting scenarios
  - More robust table structure validation

## [1.4.5] - 2025-04-28

### Added

- Level-specific styling for Table of Contents entries:
  - `tocHeading1FontSize` through `tocHeading5FontSize` for different font sizes
  - `tocHeading1Bold` through `tocHeading5Bold` for bold formatting
  - `tocHeading1Italic` through `tocHeading5Italic` for italic formatting

## [1.4.4] - 2025-04-28

### Added

- Custom font size for Table of Contents entries via `tocFontSize` style option.

## [1.4.3] - 2025-04-28

### Added

- Automatic page numbering (centered in the footer).

## [1.4.2] - 2025-04-28

### Added

- Table of Contents (TOC) generation via `[TOC]` marker.
- Clickable internal links from TOC entries to corresponding headings.
- Page break support via `\pagebreak` command on its own line.

## [1.4.1] - 2025-04-19

### Changed

- Reorganized test files into dedicated `tests` directory
- Improved test organization and structure
- Enhanced test coverage for list formatting features

## [1.4.0] - 2025-04-19

### Added

- Enhanced text alignment support with improved justification handling
- Better spacing control for justified text
- Improved paragraph formatting with dynamic spacing

### Changed

- Updated text alignment implementation for better compatibility
- Refined default alignment settings for better document consistency

## [1.3.1] - 2025-04-18

### Changed

- Updated default heading alignments to be consistently left-aligned
- Improved heading alignment configuration with individual level controls

## [1.3.0] - 2025-03-31

### Added

- Text alignment support for all document elements
  - Paragraph alignment (LEFT, RIGHT, CENTER, JUSTIFIED)
  - Blockquote alignment (LEFT, CENTER, RIGHT)
  - Default heading alignments (H1: CENTER, H2: RIGHT, others: LEFT)
  - Configurable alignment through style options
- Enhanced documentation with text alignment examples

## [1.2.2] - 2025-03-31

### Added

- Custom font size support for all document elements
  - Headings (H1-H5)
  - Paragraphs
  - List items
  - Code blocks
  - Blockquotes
- Enhanced documentation with examples of custom font sizes

## [1.1.1] - 2025-03-30

### Added

- GitHub Actions workflows for CI/CD
- Automated npm publishing on release
- Automated testing and type checking

### Changed

- Updated build process to be more robust
- Improved documentation

## [1.1.0] - 2025-03-30

### Added

- Support for code blocks (inline and multi-line)
- Support for strikethrough text
- Support for links
- Support for images (embedded, non-clickable)

## [1.0.0] - 2025-03-29

### Added

- Initial release
- Convert Markdown to DOCX format
- Support for headings (H1, H2, H3)
- Support for bullet points and numbered lists
- Support for tables
- Support for bold and italic text
- Support for blockquotes
- Support for comments
- Customizable styling
- Report and document modes