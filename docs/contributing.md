# Contributor Guide

This page is the longer-form companion to the root [contributing guide](../CONTRIBUTING.md).

## Local Setup

```bash
npm install
npm run build
npm test
```

## Useful Commands

```bash
npm run build
npm test
npm run docs:api
npm run pack:check
```

## Project Areas

- `src/`: library implementation and CLI entrypoints
- `tests/`: Jest coverage for converter and CLI behavior
- `docs/`: user-facing guides and generated API docs
- `.github/workflows/`: CI and release automation

## Contribution Expectations

- keep public API changes documented in `README.md`, `docs/`, and JSDoc
- add or update tests for behavior changes
- avoid introducing flaky network-dependent fixtures when local fixtures or data URLs work
- keep examples copy-pasteable for npm users and CLI users

## Release Notes

Document user-facing changes in [CHANGELOG.md](../CHANGELOG.md) when preparing a release-worthy change.
