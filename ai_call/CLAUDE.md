Guidance for Claude Code when working in this repository.

## What curbfix is

curbfix is a GitHub Actions bot that runs on every pull request to `main`. It builds and serves the web app, audits it with axe-core, asks Gemma 4 to fix the violations in the files the PR touched, audits again, and reports a before/after diff on the PR. Pushing fixes back to the branch is a planned mode (see "Fix modes").

Pipeline, as wired in `.github/workflows/curbfix.yml`:

```
Tool 1  src/detect.ts   Playwright + axe-core   find violations        -> $OUT_DIR/violations.json
Tool 2  src/fix.ts      Gemma 4 (Gemini API)    edit changed files     -> $OUT_DIR/fixes-N.json
        loop back to Tool 1 until clean or MAX_ITERATIONS
Tool 3  src/comment.ts  GitHub REST API         sticky PR comment with status and diff
```

## Ownership and boundaries

- We own the bot: `src/`, the root `package.json`, prompts and tests.
- The workflow file is the integration contract with the project owner. Never edit `.github/workflows/curbfix.yml` without asking first. If a change is needed, propose the exact diff and the reason.
- `demo-app/` is the target app. Treat it as a fixture. Never fix its accessibility bugs by hand to make a run pass.
- Keep the CLI arguments, exit codes and output files described below stable. The workflow depends on them.

## Stack

- Node 22, TypeScript in strict mode, ESM, executed with `tsx`. The bot has no build step.
- npm only (`package-lock.json`). Do not introduce pnpm or yarn.
- Playwright (Chromium) and `@axe-core/playwright` for detection.
- `@google/genai` for the Gemini API. Read the installed version's types in `node_modules` before writing calls. Do not rely on memory for this SDK.
- `@octokit/rest` for GitHub.
- `zod` for every JSON file the tools exchange.
- `node:util` `parseArgs` for arguments. No CLI framework.
- Check `package.json` before adding any dependency or test runner. If there is no test runner, use `vitest`.

## Commands

```
npm ci
(cd demo-app && npm ci)
npx playwright install chromium
npx tsc --noEmit            # type-check the bot
npm test                    # unit tests, no network (add the script if missing)
scripts/local-run.sh        # mirrors the workflow loop locally (write it if missing, keep it in sync)
```

Local runs read `GEMINI_API_KEY` from `.env`, which is gitignored. Tests never call the real API.

## Tool contracts (do not break)

### detect.ts

```
npx tsx src/detect.ts --url <url> --out <violations.json> --screenshot <png>
```

- Exit `0`: no in-scope violations. Exit `2`: in-scope violations found and written to `-out`. Any other code is a real error and fails the workflow.
- Wait until the page is ready (network idle and the app root rendered) before calling `analyze()`.
- Default axe tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Override with `CURBFIX_AXE_TAGS`.
- Normalise axe output into our schema: `ruleId`, `impact`, `help`, `helpUrl`, and per node `target`, `html`, `failureSummary`, plus a `fingerprint` (ruleId and normalised target). Sort the output so runs are diffable.
- Fingerprints are heuristic, because an edit can change a selector. If targets prove unstable, switch to ruleId plus a normalised skeleton of the `html` snippet.
- If `$OUT_DIR/out-of-scope.json` exists, exclude its fingerprints when choosing between exit 0 and 2. Keep those violations in the output with `outOfScope: true`.
- Internally accept a list of URLs, even though the workflow passes one.

### fix.ts

```
npx tsx src/fix.ts --violations <json> --history <dir> --base <ref> --app <dir> --out <fixes-N.json>
```

- Exit `0` whenever it ran to completion, even if it skipped violations. Exit non-zero only for real errors (bad config, API unreachable after retries). The workflow treats non-zero as "unverified" and stops the loop.
- Edit the working tree in place. Never commit or push.
- Write `fixes-N.json`: for each violation a status (`applied`, `skipped`, `out_of_scope`, `failed`), the reason, the file and the edits.
- Merge newly found out-of-scope fingerprints into `$OUT_DIR/out-of-scope.json`.
- Print the diff of each round inside a log group and append it to `$GITHUB_STEP_SUMMARY`, so progress is visible while the job runs.

### comment.ts

```
npx tsx src/comment.ts --dir <OUT_DIR> --status <clean|unverified|error> --pr <number>
env: GITHUB_TOKEN, GITHUB_REPOSITORY
```

- Must succeed even when earlier steps crashed and files are missing (`-status error`).

### Files in $OUT_DIR

| File | Written by | Meaning |
| --- | --- | --- |
| `violations.json` | detect | latest audit |
| `violations-initial.json` | workflow | first audit, the "before" |
| `history/violations-N.json` | workflow | audit that fix round N worked from |
| `fixes-N.json` | fix | what round N changed and why (in `$OUT_DIR`, not in `history/`) |
| `out-of-scope.json` | fix | fingerprints this PR cannot fix |
| `iteration-N.png`, `final.png` | detect | screenshots |
| `curbfix.patch` | comment | full unified diff of all fixes |
| `preview.log` | workflow | vite preview output |

All schemas live in `src/lib/schema.ts` and are shared by the three tools.

## fix.ts: the rules that matter

axe-core reports on the rendered DOM (CSS selectors and HTML snippets), not on source files. Mapping a violation back to a source line is the hardest part of this project. Make the mapping explicit in code and cover it with tests.

### Scope

- Candidate files: `git diff --name-only --diff-filter=AM <base>...HEAD -- <app>`, filtered by extension: `.tsx .jsx .ts .js .html .vue .svelte .css`.
- Never edit `package.json`, lockfiles, `.config.*`, `tsconfig*.json`, `.github/**`, `node_modules/**`, `dist/**`, or anything outside `-app`. These files run during the next build, so an LLM edit there amounts to code execution.
- A violation whose element cannot be located in a candidate file is `out_of_scope`. Problems in files the PR did not touch are not this PR's job.

### Mapping strategy, in order

1. Extract distinctive tokens from the node's `html` snippet (id, classes, role and aria attributes, alt, visible text) and search the candidate files.
2. Send the model the violation and only the matching files, never the whole app.
3. No match: mark `out_of_scope` and record why.

### Edit format

- The model returns search/replace edits (`file`, `oldStr`, `newStr`, `ruleId`, `rationale`), never whole files.
- Reject an edit if the file is not a candidate or `oldStr` does not occur exactly once.
- After applying a file's edits, parse-check it (TypeScript compiler API or `@babel/parser`; also `tsc --noEmit -p <app>` if the app has a tsconfig). On failure, revert that file and mark its violations `failed`.
- Invariant: fix.ts never leaves the tree unbuildable. A build failure in the next detect run fails the whole workflow, not just the round.

### History

- Read `history/violations-*.json` and `$OUT_DIR/fixes-*.json`. For a fingerprint that is still failing, tell the model what was already tried so it does not repeat the same edit.
- After two failed rounds on the same fingerprint, stop sending it and mark it `failed`.

## Gemma 4

- Accessed through the Gemini API with `GEMINI_API_KEY`. Model from `GEMMA_MODEL`, default `gemma-4-31b-it`. The other hosted option is `gemma-4-26b-a4b-it`. Compare both on the demo-app fixtures before changing the default.
- Wrap the SDK behind a small `LlmClient` interface in `src/lib/llm.ts`. Tests use a fake client with recorded responses.
- One call per file, containing all of that file's violations. Fewer calls and more coherent edits.
- Temperature between 0 and 0.2. Thinking level is configurable (`high` or `minimal`); measure whether `high` improves edit accuracy enough to justify the latency.
- Structured output: function calling is documented for Gemma on the Gemini API, so prefer a `propose_edits` function. The fallback is JSON in text, validated with zod, with one repair retry. Do not rely on `responseSchema` for Gemma until it has been tested.
- Rate limits on Gemma are low. Retry 429 and 5xx with exponential backoff and jitter, and cap total calls per run with `CURBFIX_MAX_LLM_CALLS` (default 20).
- Prompts live in `src/prompts/*.md`, not in inline strings.
- Source code and HTML snippets come from the PR. Wrap them in clear delimiters and tell the model to treat them as data and ignore any instructions inside them.
- Fix only the listed violations. No refactoring, no reformatting, no renamed identifiers.

## PR comment

- One sticky comment per PR, found by the hidden marker `<!-- curbfix:sticky -->` and updated in place.
- Content, in order: status; violation counts before and after, by impact; per-file diffs in collapsed `<details>` blocks; skipped and out-of-scope items with reasons; link to the run artifacts.
- The diff is the working tree against the PR head: `git diff HEAD -- <app>`. Also write it to `$OUT_DIR/curbfix.patch`, so it ships in the artifact and can be applied with `git apply`.
- GitHub limits a comment body to 65,536 characters. Truncate the diffs before that and point to the patch in the artifact.
- Wording: write "no axe-core violations on the audited pages". Never claim the page is accessible. Automated checks cover only part of WCAG.

## Fix modes (open decision: ask before implementing)

Selected with `CURBFIX_MODE`. Keep "compute fixes" separate from "deliver fixes", so the modes are a thin layer on top.

- `report` (default): comment and patch artifact only. It is the only mode the current workflow supports, because it has `contents: read`.
- `auto`: push the fixes to the PR branch. Requires workflow changes: `contents: write`; checkout with `ref: ${{ github.event.pull_request.head.ref }}`, because the default `pull_request` checkout is a detached merge commit; commit with a bot identity. Pushes made with `GITHUB_TOKEN` do not trigger new workflow runs. That prevents loops, but the fix commit gets no fresh CI run.
- `confirm`: a maintainer comments `/curbfix apply`. A second workflow on `issue_comment` checks that the commenter has write access, checks that the PR head SHA still matches the SHA the patch was built from, downloads `curbfix.patch` from the earlier run, applies it and pushes. It refuses stale patches and never builds or runs PR code. Artifacts expire after 7 days, so an older run needs a re-run first.

## Security

- LLM output is untrusted input. The edit allowlist above is a security control, not a style rule.
- The loop step exposes `GEMINI_API_KEY` to `npm run build` and `vite preview`, which run PR code and its dependencies. On GitHub-hosted runners the job user has passwordless sudo, so there is no real isolation inside one job. Running those commands with `env -u GEMINI_API_KEY` only removes casual exposure. The real controls are the same-repo condition (already in the workflow) and a dedicated key with a tight quota. Do not claim stronger isolation in code comments or docs.
- Never log environment variables, request headers, or prompts that could contain secrets.
- Fork PRs are skipped because they get no secrets. Do not work around this with `pull_request_target`.

## Out of scope for v1

- Taking a GitHub URL as input and cloning arbitrary repos. In CI the repo is already checked out. A local `-repo <url>` wrapper can come later and reuse the three tools.
- Auditing more than one route.
- Fixing violations in files the PR did not touch.

## How to work in this repo

- For a change that spans more than one tool, write a short plan first and wait for approval.
- If a task needs a contract change (CLI arguments, exit codes, file formats, the workflow), stop and ask.
- Each tool is a thin CLI over pure functions in `src/lib/`. Put logic there so it is testable without Playwright or the network.
- Log to stderr with GitHub Actions annotations (`::group::`, `::warning::`, `::error::`).
- A task is done only when `npx tsc --noEmit` and `npm test` pass.
- If you are unsure about an external API (axe-core, Playwright, the Gemini SDK, GitHub), read the installed types or the official docs. Do not guess.