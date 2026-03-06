# Contributing

Thanks for your interest in improving `@mohtasham/md-to-docx`.

## Before You Start

- read the [README](./README.md) for product scope and docs entry points
- check [docs/contributing.md](./docs/contributing.md) for the longer development guide
- search existing issues and pull requests before opening a new one

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

## Contribution Guidelines

- keep changes focused and explain the user-facing impact clearly
- update docs and JSDoc when public behavior or options change
- add or update tests for bug fixes and new behavior
- prefer deterministic fixtures over network-dependent test assets
- keep examples copy-pasteable for library users and CLI users

## Pull Requests

Before opening a pull request:

- make sure the branch builds and tests pass locally
- update relevant docs in `README.md`, `docs/`, or generated API docs
- add changelog context if the change is release-worthy
- include before/after behavior, especially for converter output changes

## Reporting Bugs

Use the bug report template and include:

- a minimal markdown sample
- the expected DOCX behavior
- the actual DOCX behavior
- package version and runtime details
- reproduction steps
