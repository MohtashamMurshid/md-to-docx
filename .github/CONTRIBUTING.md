# Contributing

People and agents follow the same rules. Setup is in the [README](../README.md#development), and the engineering rules are in [AGENTS.md](../AGENTS.md).

## The path of a change

1. **Issue.** For anything beyond a small fix, open an issue first (bug report or feature request) so the approach can be agreed before you write it.
2. **Branch and commits.** Work on a branch, never on `main`. Commit as [COMMITS.md](COMMITS.md) describes.
3. **Checks.** Run `npm run ci` before you push. It runs the same steps as CI: guardrails, lint, typecheck, build, tests with coverage, fallow, and the packed-consumer and browser-bundle checks. [docs/DECISIONS.md](../docs/DECISIONS.md) says what each check enforces and why.
4. **Pull request.** Open the PR with the template filled in. The title is a Conventional Commit subject, because the PR is squash-merged and its title becomes the commit that decides the release. One problem per PR.
5. **Review.** CI and the review bots (CodeRabbit, Cursor Bugbot) run on every push. Fix each finding or answer it on its thread with a reason, then push again.
6. **Merge.** Squash and merge once checks pass and every finding is resolved. semantic-release publishes from `main`; never bump versions, tag or publish by hand ([RELEASING.md](../RELEASING.md)).

## What a good change looks like

- It keeps the public API backwards compatible: exports from `src/index.ts`, the CLI flags, and `skills/md-to-docx/SKILL.md`. Breaking changes are marked `!` and explained in a `BREAKING CHANGE:` footer.
- It proves itself through generated output. Tests assert the XML parts of the produced `.docx`, not internal calls. A bug fix comes with the one test that failed before it.
- It changes the agent skill (`skills/md-to-docx/SKILL.md`) and README in the same PR when it changes CLI flags or options. Guardrails fail when a CLI flag is missing from the skill.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes. Do not open a public issue or PR for one.
