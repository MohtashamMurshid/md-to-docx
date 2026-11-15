# Commit messages

Subjects follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The rest of the message follows [the seven rules](https://cbea.ms/git-commit/).

```text
type(scope): summary in the imperative

A body only when the subject cannot carry the context. Say what was
wrong and why this change fixes it; the diff shows how. Wrap at 72.
```

PRs are squash-merged, so the **PR title** becomes the commit on `main`. semantic-release reads it, and the type decides the release.

| Type | Use it for | Release |
| --- | --- | --- |
| `feat` | a new capability for users | minor |
| `fix` | a bug fix users can notice | patch |
| `perf` | the same behaviour, faster or lighter | none |
| `refactor` | a code change with no change in behaviour | none |
| `test` | tests only | none |
| `docs` | documentation only | none |
| `build` | dependencies, packaging and build scripts | none |
| `ci` | CI configuration | none |
| `style` | formatting only | none |
| `chore` | anything else, such as tooling and config | none |
| `revert` | undoing an earlier commit | depends on what it reverts |

Add `!` after the type or scope for a breaking change, such as `feat!: drop the fontFamilly alias`, and describe it in a `BREAKING CHANGE:` footer. That releases a major version.

## Subject

- Use the imperative: "add", not "added" or "adds". It should complete "If applied, this commit will …".
- Start in lowercase, end without a full stop, aim for 50 characters and stay under 72.
- A scope is optional. When you use one, name the narrowest area the change touches, such as `fix(cli)`, `feat(charts)`, `ci(release)` or `build(deps)`.
- Pick the type by what users get. A dependency bump that changes generated output is `fix(deps)`, not `build(deps)`, so that it releases.

## Body

- Most commits are the subject alone. Add a body only when a reviewer needs context the subject can't carry, such as why the obvious fix was wrong.
- Leave one blank line after the subject.

## Never

- Subjects such as "wip", "fix stuff" or "address review".
- `chore(release)` commits by hand: only the release workflow writes those.
