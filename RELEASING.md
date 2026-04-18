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

## Troubleshooting

### `[semantic-release]: node version ^22.14.0 || >= 24.10.0 is required`

semantic-release 25+ needs Node 22.14+. The `release.yml` workflow pins `node-version: "22"` for this reason. If you bump the major of `semantic-release`, check its engines field and raise the workflow's Node version accordingly.

### `EINVALIDNPMTOKEN Invalid npm token` / `401 Unauthorized - GET /-/whoami`

Two common causes:

1. The `NPM_TOKEN` secret is a Publish or Read-only token. Only **Automation** classic tokens or **Granular** tokens with "Bypass 2FA" work in CI. On npmjs.com → Access Tokens, the token must show a green check under the "Bypass 2FA" column.
2. The `setup-node` step has `registry-url:` set. Do not set it — semantic-release writes its own `.npmrc` from `NPM_TOKEN`, and `setup-node` writing a second `.npmrc` expecting `NODE_AUTH_TOKEN` causes npm to use the wrong auth header.

### `OIDC token exchange error - package not found`

Informational only. semantic-release tries OIDC first, and because this package is not configured as a Trusted Publisher on npmjs.com, it falls back to `NPM_TOKEN`. This is expected; no action needed.

### Release bot commit triggered another release run

The bot commit must end with `[skip ci]`. The `if:` guard on the `release` job in `release.yml` filters on `github.event.head_commit.message`. If this ever loops, check the `message` template in `.releaserc.json` still contains `[skip ci]`.

### Workflow didn't fire after push

Sometimes GitHub delays the first run for a newly-added workflow by up to a minute. If it never fires: check Settings → Actions → General → Workflow permissions is "Read and write permissions" and that Actions are enabled.

## Running a release manually (not normally needed)

```bash
# dry run locally (requires GITHUB_TOKEN and NPM_TOKEN env vars)
npx semantic-release --dry-run --no-ci
```

## Skipping a release

If you push a commit to `main` that should not trigger a release, use a non-releasing type (`chore:`, `docs:`, etc.) — semantic-release will simply exit without creating a release.
