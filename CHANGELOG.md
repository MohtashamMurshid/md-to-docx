# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New template + sections API (`options.template`, `options.sections`) for real multi-section document generation.
- Per-section header/footer slots (`default`, `first`, `even`) with optional page-number field rendering.
- Section-level page numbering controls (`start`, `formatType`, `separator`, and display strategy).
- Section-level style overrides so formatting can change mid-document (addresses GitHub issue #16 use case).

### Changed

- `parseToDocxOptions` now emits real DOCX section entries instead of forcing a single continuous section.
- Numbered-list sequence IDs are offset per rendered section to avoid cross-section numbering collisions.

### Tests

- Added `tests/sections.test.ts` covering section properties, footer behavior, numbering resets, and per-section style conversion.

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
