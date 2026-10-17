# curbfix

Accessibility fixes that prove themselves.

curbfix is a GitHub Actions bot for pull requests. It audits the built web app with axe-core, asks Gemma 4 to fix the violations in the files the PR touched, audits again, and reports a before/after diff on the PR.

> **Status.** This package currently contains **Tool 2, `src/fix.ts`**: the part that calls the model and edits the code. `detect.ts` (the axe-core audit), `comment.ts` (the PR comment) and the workflow are not written yet. `PROGRESS.md` tracks what is done and what is next.

## How it works

### The pipeline

```
Tool 1  detect.ts   Playwright + axe-core   find violations        -> violations.json
Tool 2  fix.ts      Gemma 4 (Gemini API)    edit changed files     -> fixes-N.json      <- this package
        loop back to Tool 1 until clean or MAX_ITERATIONS
Tool 3  comment.ts  GitHub REST API         sticky PR comment with status and diff
```

Each run of `fix.ts` is one **round**. It reads the latest audit, edits the working tree in place, and records what it did. It never commits or pushes. The next audit decides whether the edits worked.

### One round, step by step

1. **Find the candidate files.** These are the files the PR added or modified inside the app (`git diff --name-only --diff-filter=AM <base>...HEAD`) with the extensions `.tsx .jsx .ts .js .html .vue .svelte .css`. Files that run during the build are never candidates, because an LLM edit there would amount to code execution: `package.json`, lockfiles, `*.config.*`, `tsconfig*.json`, `.github/`, `node_modules/`, `dist/`, and symlinks pointing at any of these.

2. **Map each violation back to a source file.** axe-core reports on the rendered page (a CSS selector and an HTML snippet), not on source lines. curbfix extracts distinctive tokens from the element and searches the candidate files for them:

   | Token | Weight |
   | --- | --- |
   | `id` | 10 |
   | `data-testid` | 8 |
   | visible text, `alt`, `aria-label`, `placeholder` | 6 |
   | `<html>`, `<head>`, `<body>`, `<title>` | 5 |
   | class name | 3 |
   | `role` | 1 |

   A token found in *n* files adds *weight / n* to each of them, so tokens shared by many files count for little. The best-scoring file wins if it reaches 3 points. Only markup files can win. CSS files that style the element, or that the winning file imports, come along as extra editable files, so colour-contrast fixes can land in the stylesheet.

   An element that can't be found in a candidate file is **out of scope**: it lives in code this PR didn't touch, so fixing it is not this PR's job.

3. **Ask the model, one call per file.** Each call contains all of that file's violations, the file itself and any related CSS, and nothing else from the app. The model replies by calling a `propose_edits` function with search/replace edits (`file`, `oldStr`, `newStr`, `ruleId`, `violationId`, `rationale`) and a list of violations it chose to skip. If it doesn't call the function, curbfix looks for JSON in the reply text. If that is invalid too, it asks once more with the validation error.

4. **Check and apply the edits.** The model's output is treated as untrusted input:
   - An edit is rejected if it names a file outside that call, or if its `oldStr` doesn't occur **exactly once**.
   - Each file is all-or-nothing: if one edit fails, none of that file's edits are applied.
   - After editing, the file must still parse (Babel for JS/TS, built-in checks for CSS, HTML, Vue and Svelte). If it doesn't, the file is left unchanged.
   - If the app has a `tsconfig.json` and its own TypeScript installed, `tsc --noEmit` runs after each file. If the number of type errors goes up, the edits are reverted.

   The rule is that `fix.ts` never leaves the tree unbuildable.

5. **Learn from earlier rounds.** For an element that is still failing, the prompt lists what was already tried so the model doesn't repeat it. After two failed rounds, curbfix stops sending that element to the model and marks it `failed`.

6. **Record the outcome.** Every violating element gets a status in `fixes-N.json`:

   | Status | Meaning |
   | --- | --- |
   | `applied` | an edit was applied (the next audit confirms whether it worked) |
   | `skipped` | the model declined, the call limit was reached, or the run stopped early |
   | `out_of_scope` | the element is not in a file this PR changed |
   | `failed` | the edits were rejected or reverted, or two rounds already failed |

   Newly found out-of-scope elements are added to `out-of-scope.json` so later rounds don't retry them. The round's diff is printed in a collapsible log group and appended to the GitHub job summary.

### Prompt-injection guard

Source code and HTML snippets come from the PR, so they could contain text like "ignore your instructions". Every piece of PR content goes into a block that opens with `<<<DATA <nonce>` and closes with `<<<END <nonce>>>`. The nonce is random for each call, so the content can't close its own block. The system prompt tells the model that everything inside these blocks is data, not instructions. The real protection is still step 4: whatever the model says, it can only make unique search/replace edits to the files of that call, and the result has to parse.

## Requirements

- Node.js 22 or newer
- npm (the repo uses `package-lock.json`; don't use pnpm or yarn)
- git
- A Gemini API key, for real runs only. The tests never call the API.

## Setup

```sh
cd ai_call
npm ci
```

npm 11 may warn that install scripts were skipped (esbuild, protobufjs). That's expected: everything works without them.

To run against the real model, put your key in `ai_call/.env` (this file is gitignored):

```sh
echo 'GEMINI_API_KEY=your-key-here' > .env
```

Use a dedicated key with a tight quota. In CI the build runs PR code, and that code can read the job's environment.

## Checks

```sh
npx tsc --noEmit   # type-check
npm test           # unit and end-to-end tests: no network, no API key
```

The end-to-end test (`test/e2e.test.ts`) runs the real CLI and the real Google SDK against a local fake of the Gemini API. It points the SDK there with `GOOGLE_GEMINI_BASE_URL`, which the SDK supports natively.

## Running fix.ts

```sh
npx tsx src/fix.ts \
  --violations <violations.json> \
  --history    <dir with violations-N.json from earlier rounds> \
  --base       <git ref the PR targets, e.g. origin/main> \
  --app        <app directory> \
  --out        <OUT_DIR>/fixes-N.json
```

Run it from the root of the repository you want to fix, with the PR branch checked out. The round number *N* comes from the `--out` file name.

**Exit codes:** `0` means the round completed, even if some violations were skipped. `1` means a real error: bad configuration, a missing API key while there was work to do, or the API still unreachable after retries. `fixes-N.json` is still written, with an `error` field, and edits made before the error are kept.

### Try it on a toy repo

`detect.ts` doesn't exist yet, so this walkthrough writes `violations.json` by hand.

```sh
BOT=$PWD    # run this from ai_call/

# A repo with a "PR" branch that adds an image without alt text
mkdir /tmp/curbfix-demo && cd /tmp/curbfix-demo
git init -q -b main
mkdir -p app/src
echo 'export function App() { return null; }' > app/src/App.tsx
git add -A && git commit -qm base
git checkout -qb my-feature
cat > app/src/App.tsx <<'EOF'
export function App() {
  return (
    <main>
      <img src="/hero.png" className="hero-image" />
      <h1>Welcome to Acme</h1>
    </main>
  );
}
EOF
git commit -qam "add hero"

# What detect.ts would have found: one violation in the changed file,
# one in code this PR didn't touch
mkdir -p out/history
cat > out/violations.json <<'EOF'
{
  "urls": ["http://localhost:4173/"],
  "violations": [
    {
      "ruleId": "image-alt",
      "impact": "critical",
      "help": "Images must have alternate text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/image-alt",
      "nodes": [{
        "target": ["img.hero-image"],
        "html": "<img src=\"/hero.png\" class=\"hero-image\">",
        "failureSummary": "Fix any of the following:\n  Element does not have an alt attribute",
        "fingerprint": "image-alt|img.hero-image"
      }]
    },
    {
      "ruleId": "link-name",
      "impact": "serious",
      "help": "Links must have discernible text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/link-name",
      "nodes": [{
        "target": ["footer a.social"],
        "html": "<a class=\"social\" href=\"https://x.example\"></a>",
        "failureSummary": "Fix all of the following:\n  Element is in tab order and does not have accessible text",
        "fingerprint": "link-name|footer a.social"
      }]
    }
  ]
}
EOF

# Run one round (loads GEMINI_API_KEY from the bot's .env if it exists)
"$BOT/node_modules/.bin/tsx" --env-file-if-exists="$BOT/.env" "$BOT/src/fix.ts" \
  --violations out/violations.json --history out/history \
  --base main --app app --out out/fixes-1.json

git diff                 # the model's edit
cat out/fixes-1.json     # image-alt: applied, link-name: out_of_scope
```

Without an API key the run still maps both violations: `link-name` is recorded as `out_of_scope` in `out/out-of-scope.json`. It then exits `1` with `GEMINI_API_KEY is not set, but there are violations to fix`.

## Configuration

All settings are environment variables. Empty values count as unset.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | (none) | Gemini API key. Required only when there is something to send to the model. |
| `GEMMA_MODEL` | `gemma-4-31b-it` | Model ID. The other hosted option is `gemma-4-26b-a4b-it`. |
| `CURBFIX_MAX_LLM_CALLS` | `20` | Maximum API requests per `fix.ts` run, retries and repair requests included. When it runs out, the remaining violations are `skipped`. |
| `CURBFIX_TEMPERATURE` | `0.1` | Sampling temperature, from 0 to 0.2. |
| `CURBFIX_THINKING_LEVEL` | `minimal` | `high`, `minimal`, or `off` (sends no thinking setting at all). |
| `CURBFIX_STRUCTURED_OUTPUT` | `function` | `function` (the model calls `propose_edits`) or `json` (the model replies with JSON text). |
| `OUT_DIR` | folder of `--out` | Where `fixes-*.json` and `out-of-scope.json` live. |
| `GITHUB_STEP_SUMMARY` | (set by Actions) | If set, the round summary and diff are appended to this file. |

API errors 429 and 5xx, and network errors, are retried up to 5 times with exponential backoff and jitter. Other 4xx errors, such as a bad key or an unknown model, stop the run at once.

## Files

| File | Written by | Meaning |
| --- | --- | --- |
| `violations.json` | detect | latest audit; input to `fix.ts` |
| `history/violations-N.json` | workflow | the audit round N worked from |
| `fixes-N.json` | fix | what round N changed and why |
| `out-of-scope.json` | fix | elements this PR can't fix |

The JSON formats are defined, and validated, in `src/lib/schema.ts`, which all three tools share.

## Project layout

```
src/
  fix.ts              CLI: arguments, files, logging, exit codes
  lib/
    fixer.ts          one round: scope, grouping, model calls, outcomes
    scope.ts          candidate files and the deny list
    mapping.ts        axe element -> source file
    edits.ts          validate and apply search/replace edits
    syntax.ts         parse checks and the optional tsc check
    history.ts        earlier attempts, two-failure rule
    llm.ts            LlmClient interface, Gemini client, fake client
    propose.ts        propose_edits schema, JSON fallback, repair
    prompts.ts        prompt templates and data blocks
    config.ts         environment settings
    schema.ts         shared JSON formats
    diff.ts, log.ts   diffs and GitHub Actions log output
  prompts/*.md        the prompts
test/                 vitest tests, one file per module plus e2e
```

## Limits

- axe-core checks only part of WCAG. A clean result means "no axe-core violations on the audited pages", not that the page is accessible.
- Mapping is heuristic. An element whose markup is built at runtime, or whose classes are hashed (CSS modules), may not be found and ends up out of scope.
- Fork PRs are skipped, because they get no secrets.

See `CLAUDE.md` for the full design rules and `PROGRESS.md` for status and open questions.
