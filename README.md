# Hikari 光

**Accessibility fixes that prove themselves.**

Hikari is a GitHub bot that audits every pull request for accessibility problems, has **Gemma 4** write the fix, **re-runs the audit to prove the fix works**, and reports the result in a single PR comment.

*Hikari (光) is Japanese for "light": it shines a light on the accessibility problems nobody has time to look for, and shows how to fix them.*

Built by Team Hikari at the Hacktoberfest Hack Day Milano x Coding Bunker, 17 October 2026.

---

## 1. The problem

Accessibility bugs are everywhere on real websites: images without alt text, buttons without a label, text too faint to read, skipped heading levels, form fields without a name. Most teams agree these matter, yet the bugs stay unfixed:

- **Nobody checks every pull request.** Audits happen rarely, long after the code shipped.
- **Existing tools only report.** They say "element X violates rule Y", and a human still has to find the file, understand the rule and write the change.
- **Fixing is tedious**, so it gets postponed again and again.

## 2. The solution

Hikari closes the loop. On every pull request it:

1. **Finds** the violations on the running app.
2. **Fixes** them: Gemma 4 edits the files the PR touched.
3. **Proves** the fix: the audit runs again, and a fix counts as **verified** only when the violation is really gone.
4. **Reports** the outcome in one comment on the PR, with the suggested diffs.

The verification step is the difference: Hikari does not ask you to trust the model, it re-checks its work with a deterministic tool.

What the contributor sees on the PR:

| Outcome | Meaning |
| --- | --- |
| ✅ Verified | The fix was applied and the re-scan no longer reports the element |
| ⚠️ Unverified | A fix was applied but the element is still reported: needs human review |
| ❌ Not fixed | The model's edit was rejected, or it gave up |
| ➖ Out of scope | The problem is in code this PR did not change |

Hikari never commits to your branch. The suggested changes are shown in the comment for you to review and apply.

## 3. How it was built

### Architecture

```
Pull request opened against main
        │
        ▼
GitHub Action
   build and serve the app on localhost
        │
        ▼
┌─► Detect    Playwright + axe-core    finds the violations
│       │      exit 0 = nothing left to fix
│       │      exit 2 = violations found
│       ▼
│   Fix       Gemma 4 (Gemini API)     edits the files changed in the PR
│       │
└───────┘      rebuild, then detect again (up to 3 rounds)
        │
        ▼
Comment       GitHub REST API          one PR comment: issues, diffs, and
                                        "verified" or "unverified"
```

The pipeline is three independent command-line tools, glued together by a GitHub Actions workflow. They talk through JSON files in a shared output folder (`curbfix-out/`) and plain exit codes, so each tool can be developed, tested and run on its own.

### Tool 1: Detect (`Detect/`)

Opens the built app in headless **Playwright** Chromium and runs **axe-core**. Detection is deterministic: the same page gives the same result, which is what makes verification trustworthy.

- One entry per failing element, with rule, impact, HTML snippet, CSS selector and axe's failure summary.
- For `color-contrast`, the foreground and background colors and the contrast ratio are kept, so the model can choose a valid color.
- Results are sorted by impact, critical first, and optionally a full-page screenshot is saved.
- Exit codes drive the loop: `0` nothing to fix, `2` violations found, `1` error.

### Tool 2: Fix (`ai_call/`)

**Gemma 4**, an open-weight model, is the engine, called through the Gemini API with function calling and a JSON fallback.

- **Scope limited to the PR.** Only files the PR added or modified are candidates. A problem in code the PR did not touch is reported as *out of scope* rather than "fixed" somewhere unrelated.
- **Element to source file.** axe reports on the rendered page, not on source lines, so Hikari scores the candidate files by the ids, text, `alt`/`aria-label` values and class names found in the failing element's HTML.
- **Small edits, one call per file.** The model returns search/replace edits instead of whole files, which is more reliable for a small model and keeps the diff minimal.
- **Model output is untrusted.** An edit must name a file from that call and its `oldStr` must occur exactly once. Each file is all-or-nothing, an edited file must still parse, and it must not add TypeScript errors. Otherwise the file is left unchanged.
- **Learns from failed rounds.** Earlier attempts on a still-failing element go into the next prompt; after two failed rounds the element is marked failed.
- **Prompt-injection guard.** PR content goes into randomly delimited data blocks, and files that run during the build (`package.json`, lockfiles, `*.config.*`, `.github/`) can never be edited.

### Tool 3: Comment (`Comment/`)

Reads the files the loop left behind and builds one markdown report: a headline ("5 of 6 detected issues fixed and verified"), a summary table, and a collapsible section per issue with the rule, impact, file, diff and outcome. It finds its own earlier comment by a hidden marker and updates it, so a PR never collects duplicates. PRs with no violations get no comment, and very large reports fall back to a compact table to stay under GitHub's size limit.

### The workflow (`.github/workflows/`)

Triggered on every pull request to `main`. It installs the tools, builds and serves the app, then runs the loop: **Detect → Fix → rebuild → Detect**, for at most 3 rounds, ending as soon as Detect finds nothing. The comment step always runs, even when the loop failed, so the PR is never left silent. Screenshots and logs are uploaded as an artifact. Concurrent runs on the same PR cancel each other, and permissions are limited to `contents: read` and `pull-requests: write`.

### Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript on Node.js 22+, run with `tsx` (no build step) |
| Browser automation | Playwright (Chromium) |
| Accessibility engine | axe-core via `@axe-core/playwright` |
| AI model | Gemma 4 (`gemma-4-31b-it`, or `gemma-4-26b-a4b-it`) through `@google/genai` |
| Validation | `zod` for every JSON file exchanged between tools |
| GitHub integration | GitHub Actions and the GitHub REST API |
| Landing page | Next.js |

### Repository layout

| Folder | What it is |
| --- | --- |
| [`Detect/`](Detect) | Tool 1: scanner and CLI |
| `ai_call/` | Tool 2: the Gemma 4 fixer, see [`ai_call/README.md`](ai_call/README.md) |
| [`Comment/`](Comment) | Tool 3: PR report and comment |
| `website/` | Project landing page |
| [`.github/workflows/`](.github/workflows) | The pipeline |

## 4. Using it

### Set it up

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com).
2. In your repository open **Settings → Secrets and variables → Actions → New repository secret** and add `GEMINI_API_KEY`. (`GITHUB_TOKEN` is provided by GitHub.)
3. Copy the workflow from [`.github/workflows/`](.github/workflows) into your repository.
4. Open a pull request **from a branch of the same repository** into `main`. Pull requests from forks are skipped, because GitHub gives them no access to secrets. When the run finishes, the comment appears on the PR.

### Run the tools locally

Requirements: Node.js 22 or newer, and Git.

**Detect**: audit any page.

```bash
cd Detect
npm ci
npx playwright install chromium
npx tsx src/detect.ts --url http://localhost:4173 \
  --out ../curbfix-out/violations.json --screenshot ../curbfix-out/page.png
```

**Comment**: preview the PR comment without posting anything.

```bash
cd Comment
npm ci
npx tsx src/comment.ts --dir ../curbfix-out --status unverified --dry-run
npm test
```

**Fix**: options and tests are described in [`ai_call/README.md`](ai_call/README.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Gemini API key |
| `GEMMA_MODEL` | `gemma-4-31b-it` | Model ID |
| `CURBFIX_MAX_LLM_CALLS` | `20` | Maximum API requests per fix run |

## 5. Scope and limits

Hikari is honest about what it covers:

- **Detects** issues on any web app that can be built and served: axe and Playwright test the rendered page, whatever the stack.
- **Fixes** source code of React + TypeScript + Tailwind apps.
- **Typical rules:** `image-alt`, `button-name`, `color-contrast`, `heading-order`, `label`, `html-has-lang`.
- **Does not cover** pages behind a login, deep UI states, native apps, or backend-only repositories.
- **Automated checks find only part of the accessibility problems.** A clean result means "axe-core reports no violations on the audited pages", not that the site is accessible. Suggested texts such as `alt` and labels need a human check.
- Element-to-file mapping is heuristic: markup built at runtime, or hashed CSS-module class names, may end up out of scope.

## 6. Open source and open weights

- **Model:** Gemma 4, an open-weight model from Google. The model sits behind a small client interface, so another compatible model can be plugged in.
- **Engine:** axe-core and Playwright, both open source.
- **License:** MIT.

Built for the **Best Use of Gemma 4** and **Best Open-Source AI Project** challenges.

## Team

**Hikari**: Edward K Aiddo, Leonardo, Riccardo Ventura, Marcelo Kaihara.

## License

[MIT](LICENSE)
