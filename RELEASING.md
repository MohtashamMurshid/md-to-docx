# Releasing

This package is released automatically by [semantic-release](https://github.com/semantic-release/semantic-release) on every push to `main`.

## How it works

1. Open a PR and squash-merge it into `main` with a [Conventional Commits](https://www.conventionalcommits.org/) subject line.
2. `.github/workflows/release.yml` runs on the push to `main`.
3. semantic-release analyzes commits since the last `v*` tag and decides whether a release is needed:
   - `fix:` → patch (`x.y.Z`)
   - `feat:` → minor (`x.Y.0`)
   - `feat!:` or body contains `BREAKING CHANGE:` → major (`X.0.0`)
   - `chore:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `ci:`, `build:` → no release
4. On a releasable commit, the workflow:
   - Bumps `version` in `package.json` and `package-lock.json`.
   - Prepends release notes to `CHANGELOG.md`.
   - Commits those changes with `chore(release): x.y.z [skip ci]`.
   - Creates git tag `vx.y.z` and pushes it.
   - Publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements).
   - Creates a GitHub Release with the generated notes.

## Commit message examples

```
feat: add syntax highlighting option to code blocks
fix: preserve aliases in codeHighlighting.languages
feat!: drop support for Node 16

BREAKING CHANGE: Node 18 is now the minimum supported runtime.
```

## One-time repository settings

These need to be configured once in GitHub / npm; they are not captured in the repo.

### npm

- Create an **Automation** access token on npmjs.com with publish rights for `@mohtasham/md-to-docx`.
- Save it as the `NPM_TOKEN` secret in GitHub repo settings (Settings → Secrets and variables → Actions).
- On the package's Settings on npmjs.com, set 2FA mode to **"Authorization only"** (not "Authorization and publishing"), so the automation token can publish without an OTP.

### GitHub

- Settings → Actions → General → **Workflow permissions**:
  - Select **"Read and write permissions"**.
  - Check **"Allow GitHub Actions to create and approve pull requests"**.
- Branch protection on `main` (optional but recommended): allow the `github-actions[bot]` (or your release bot) to push tag and `[skip ci]` commits, or disable "Require linear history" / "Require PR before merging" for the bot. The simplest setup is to allow administrators to bypass branch protection and have the workflow use the default `GITHUB_TOKEN`.

## Running a release manually (not normally needed)

```bash
# dry run locally (requires GITHUB_TOKEN and NPM_TOKEN env vars)
npx semantic-release --dry-run --no-ci
```

## Skipping a release

If you push a commit to `main` that should not trigger a release, use a non-releasing type (`chore:`, `docs:`, etc.) — semantic-release will simply exit without creating a release.
