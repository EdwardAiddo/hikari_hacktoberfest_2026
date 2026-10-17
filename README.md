# hikari_hacktoberfest_2026

Accessibility fixes that prove themselves.

**curbfix** is a GitHub Actions bot. On every pull request to `main` it builds and serves the web app, audits it with axe-core, asks Gemma 4 to fix the violations in the files the PR changed, audits again to verify the fixes, and posts a before/after report on the PR. It never commits: the fixes are suggestions in the comment.

## How the pieces fit

```
.github/workflows/curbfix.yml    runs the loop on every PR
    Detect/     Tool 1  Playwright + axe-core   -> curbfix-out/violations.json      (exit 2 = violations)
    ai_call/    Tool 2  Gemma 4 (Gemini API)    -> edits the changed files, fixes-N.json
                (loop back to Detect, up to MAX_ITERATIONS = 3, until it exits 0)
    Comment/    Tool 3  GitHub API              -> one sticky PR comment with the results
demo-app/       the app being audited (has deliberate accessibility bugs)
```

Each folder is its own npm package with its own README:

- [`Detect/`](Detect): audits a URL, writes `violations.json` (the shared format is `Detect/src/types.ts`). Violations that Tool 2 marked out of scope for the PR are kept but don't count.
- [`ai_call/`](ai_call/README.md): maps each violation back to a source file the PR changed, asks Gemma 4 for minimal search/replace edits, checks they parse, applies them.
- [`Comment/`](Comment): turns the loop's files into the PR comment: verified, unverified, not fixed, out of scope.
- [`demo-app/`](demo-app/README.md): small Vite + React app. Its bugs are intentional: don't fix them by hand.

## Turn it on in GitHub

1. Add a repository secret **`GEMINI_API_KEY`** (Settings → Secrets and variables → Actions). Use a dedicated key with a tight quota: the workflow builds PR code in the same job.
2. Open a pull request against `main` from a branch in this repository (forks are skipped: they get no secrets).
3. curbfix only fixes files the PR changed. To see it work, touch one of the files listed in [`demo-app/README.md`](demo-app/README.md).

The run's screenshots, `violations*.json`, `fixes-*.json` and logs are uploaded as the `curbfix-debug` artifact.

## Run it locally

```sh
(cd Detect && npm ci && npx playwright install chromium)
(cd ai_call && npm ci)
(cd Comment && npm ci)
(cd demo-app && npm ci)
```

Put `GEMINI_API_KEY=...` in `ai_call/.env` (gitignored). The steps for running the loop by hand are in [`ai_call/README.md`](ai_call/README.md#running-the-whole-pipeline-locally).

Tests: `npm test` in `ai_call/`, `Detect/` and `Comment/`. Type-check: `npx tsc --noEmit` in each.

Automated checks (axe-core) catch only part of the accessibility problems: a clean result means no axe-core violations on the audited page, not that the page is accessible.
