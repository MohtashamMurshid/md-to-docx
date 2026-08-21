# Version 3 release checklist

This branch integrates the version 3 feature set behind one release boundary. Do not merge the individual feature pull requests into `main`; they are collected here first so semantic-release publishes one major release.

## Included features

- GFM task lists and native thematic breaks
- Figure/table captions and native cross-references
- Reference-DOCX style generation
- Versioned custom renderer plugins
- Document metadata and accessibility semantics

## Release gates

- `bun install --frozen-lockfile`
- `bun run build`
- `bun run lint`
- `bun run test -- --runInBand`
- `bun run test:bun-runtime`
- `bun run test:consumer`
- Render and inspect `test-output/v3-all-use-cases.docx` in Microsoft Word
- Update Word fields with `Ctrl+A`, then `F9`, before checking the TOC, captions, cross-references, and page totals
- Run Word's Accessibility Checker on the visual fixture

## Merge and publish

1. Keep the release pull request in draft until code review and visual sign-off are complete.
2. Squash-merge the release pull request into `main` with the exact conventional title `feat!: release version 3`.
3. Confirm the gated `Release` job publishes `3.0.0` only after the full CI matrix passes, then creates the corresponding GitHub release and npm package.

The package version remains unchanged on this branch because semantic-release owns version files and release notes on `main`.
