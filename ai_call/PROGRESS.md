# curbfix: AI component (fix.ts) implementation progress

This file is the hand-off log. If a session is interrupted, read it first, then
`CLAUDE.md`, then continue with the first milestone that isn't `[x]`.

## Scope of this effort

Implement **Tool 2: `src/fix.ts`**, the component that calls Gemma 4, plus the
shared pieces it needs (`src/lib/schema.ts`, `src/lib/llm.ts`, prompts, tests).
`detect.ts`, `comment.ts`, the workflow and `demo-app/` are **not** part of this
effort. There is no workflow file or demo-app in the repo yet.

The bot's package root is `ai_call/` (where `CLAUDE.md` lives).

## Stack decisions (2026-10-17)

| Package | Version | Note |
| --- | --- | --- |
| Node | engines `>=22` | local machine runs Node 26 |
| typescript | 7.0.x | native compiler, used only for `tsc --noEmit` |
| tsx | 4.23.x | runs the CLIs, no build step |
| vitest | 5.0.x | `npm test` = `vitest run` |
| @google/genai | 2.30.x | Gemini API client. Types read from `node_modules/@google/genai/dist/node/node.d.ts` |
| zod | 4.x | all JSON exchanged between tools |
| @babel/parser | 8.x | parse-check edited JS/TS files. Used instead of the TS compiler API because TS 7's JS API is not the stable path |
| @types/node | 22.x | matches the minimum runtime |

npm 11 blocks install scripts by default (esbuild, protobufjs). Everything works
without them; don't approve them unless something breaks.

SDK facts verified in the installed types:
- `new GoogleGenAI({ apiKey })`, `ai.models.generateContent({ model, contents, config })`.
- `config.tools = [{ functionDeclarations: [{ name, description, parametersJsonSchema }] }]`.
- `config.toolConfig.functionCallingConfig = { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames }`.
- `config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH | MINIMAL }`.
- `response.functionCalls`, `response.text` are getters.
- Errors: `ApiError` with numeric `status`.
- Per-request `config.httpOptions.retryOptions.attempts`. We set it to 1 and do our own
  backoff so that every HTTP attempt counts towards `CURBFIX_MAX_LLM_CALLS`.

## Milestones

- [x] **M0 Scaffold**: package.json, tsconfig, .gitignore, vitest, `npm test`, `npx tsc --noEmit`.
- [x] **M1 Schemas** (`src/lib/schema.ts`): violations, fixes-N, out-of-scope, edit format.
- [x] **M2 Scope** (`src/lib/scope.ts`): candidate files from git, extension filter, deny list.
- [x] **M3 Mapping** (`src/lib/mapping.ts`): tokens from axe `html`/`target`, locate in candidate files, related CSS files.
- [x] **M4 Edits** (`src/lib/edits.ts`, `src/lib/syntax.ts`): validate, apply, parse-check, revert.
- [x] **M5 History** (`src/lib/history.ts`): previous attempts per fingerprint, two-strike rule.
- [x] **M6 LLM client** (`src/lib/llm.ts`, `src/lib/propose.ts`): `LlmClient` interface, Gemini impl, retries, call budget, function calling + JSON fallback with one repair, fake client.
- [x] **M7 Prompts** (`src/prompts/*.md`, `src/lib/prompts.ts`): templates, nonce delimiters against prompt injection.
- [x] **M8 Orchestration + CLI** (`src/lib/fixer.ts`, `src/fix.ts`): round logic, fixes-N.json, out-of-scope merge, log groups, step summary, exit codes.
- [x] **M9 End-to-end check** (`test/e2e.test.ts`): real CLI + real SDK against a local HTTP stub of the Gemini API (`GOOGLE_GEMINI_BASE_URL`, read natively by the SDK). Covers success, HTTP 400 → exit 1, bad config → exit 1.
- [~] **M10 Live test**. First live run done 2026-10-17 (see "Live test results"). Still open: compare `gemma-4-31b-it` vs `gemma-4-26b-a4b-it`, and `high` vs `minimal` thinking.

## Design notes (keep in sync with code)

- **Paths.** `scope.listCandidateFiles` returns absolute *real* paths (git reports
  real paths; macOS `/var` is a symlink). `SourceFile.rel` is repo-root-relative and
  is what the model sees and what `fixes-N.json` records.
- **Schemas** (`src/lib/schema.ts`). detect.ts does not exist yet, so this effort
  defines the violations format: `{ generatedAt?, urls[], violations: [{ ruleId,
  impact|null, help, helpUrl, url?, nodes: [{ target: string[], html,
  failureSummary, fingerprint, outOfScope? }] }] }`. `fixes-N.json` holds one
  `FixRecord` per node fingerprint (the "violation" unit fix.ts reasons about).
  `Edit` adds an optional `violationId` (`v1`, `v2`…, scoped to one LLM call) on
  top of the CLAUDE.md fields so edits map to exact nodes, not just a ruleId.
- **Scope deny list** (`denyReason`): outside app, `.github/`, `node_modules/`,
  `dist/`, `package.json`, lockfiles, `tsconfig*.json`, `*.config.*`, extension
  allowlist. Symlinks are resolved and re-checked.
- **Mapping** (`src/lib/mapping.ts`): tokens from root tag attrs, target selector
  and visible text; weights id 10, data-testid 8, text/alt/aria-label/placeholder 6,
  class 3, role 1, `<html>/<head>/<body>/<title>` 5. Weak tokens (added after the
  first live run): `src`/`poster` exact value 4, de-hashed asset file name 3,
  non-ASCII symbol text up to 3 chars 2 (also matched as entity / `\u` escape),
  each inline style declaration 1.5 (kebab or camelCase prop, `rgb()` also as
  `#rrggbb`/`#rgb`, `Npx` also as bare `N`), `width`/`height` 1 (quoted or `{N}`). A token found in n markup files
  adds weight/n to each. Winner needs score >= 3 (`MIN_SCORE`). CSS files never
  locate an element; they are attached as `related` when they style a class/id of
  the node or are imported by the winning file.
- **Edits** (`src/lib/edits.ts`): `planEdits` is pure; edits naming a file outside
  the call's file set are `disallowed`; per file, edits apply in order and the file
  is all-or-nothing (missing/non-unique `oldStr`, no-op, or parse failure rejects
  every edit for that file). `writePlan` writes accepted files.
- **Syntax** (`src/lib/syntax.ts`): Babel for .ts/.tsx/.js/.jsx (`.ts` without the
  jsx plugin), hand-written checks for CSS (balance, strings, comments), HTML (quotes
  in tags, comments, inline script/style), Vue/Svelte (script + style blocks).
  `typecheckApp` runs the app's own `node_modules/.bin/tsc --noEmit -p <app>` with
  `GEMINI_API_KEY` removed; null when no tsconfig or no local tsc.
- **History** (`src/lib/history.ts`): attempts come from `$OUT_DIR/fixes-N.json`
  with N < current round; if `history/violations-N.json` exists the fingerprint must
  be in it. A round "failed" for a fingerprint when its status was `applied` or
  `failed` and the fingerprint is still in the current audit. 2 failures = give up.
- **Config** (`src/lib/config.ts`): `GEMINI_API_KEY`, `GEMMA_MODEL`
  (gemma-4-31b-it), `CURBFIX_MAX_LLM_CALLS` (20, counts every HTTP attempt incl.
  retries and repair calls, per fix.ts invocation), `CURBFIX_TEMPERATURE` (0.1,
  allowed 0–0.2), `CURBFIX_THINKING_LEVEL` (high|minimal|off, default minimal),
  `CURBFIX_STRUCTURED_OUTPUT` (function|json, default function). Empty = unset.
- **LLM** (`src/lib/llm.ts`): `LlmClient.generate({system,user,fn?})`.
  `GeminiClient`: own retry loop (5 attempts, full-jitter backoff 2 s→60 s) for 429,
  5xx and network errors; other 4xx = `LlmFatalError`; exhausted retries =
  `LlmFatalError`; budget = `LlmBudgetError` (non-fatal). If the model rejects
  `systemInstruction` (HTTP 400 mentioning system/developer instruction) it
  switches to inlining the system prompt for the rest of the run. `FakeLlmClient`
  replays recorded responses.
- **Propose** (`src/lib/propose.ts`): `propose_edits` function with JSON Schema from
  zod (`$schema`/`default` stripped for Gemini). No function call → JSON from text.
  Invalid → exactly one repair call without tools. Still invalid → `{ok:false}`.
- **Prompts** (`src/prompts/*.md`, `src/lib/prompts.ts`): `system.md`, `fix-file.md`,
  `output-function.md` / `output-json.md`, `repair.md`. Single-pass `{{key}}`
  rendering (values are never re-expanded). PR content goes in
  `<<<DATA <nonce> kind=...>>> … <<<END <nonce>>>` blocks; the nonce is 16 random hex
  chars per call, so content cannot close its own block.
- **Round** (`src/lib/fixer.ts` `runRound`): per node fingerprint (deduped):
  detect's `outOfScope` flag or known out-of-scope → `out_of_scope`; two failed rounds
  → `failed`; not located → `out_of_scope` + new out-of-scope entry. Remaining nodes
  are grouped by located file; one call per file, files sent = located file + related
  CSS. Ids `v1..vn` per call. Edits map by `violationId`, else by `ruleId`; edits for
  unlisted rules are dropped. After writing, if a type check is available and the
  error count went up versus the round's baseline, the group's files are reverted
  and its nodes are `failed`. Budget exhausted → remaining groups `skipped`,
  not fatal. Fatal error / missing key with work to do → remaining groups `skipped`,
  `fatal` set. Files > 100k chars are not sent (`failed`).
- **CLI** (`src/fix.ts`): CLAUDE.md arguments. `OUT_DIR` env, else `dirname(--out)`.
  Round N from `fixes-N.json` in `--out`. Writes `fixes-N.json` (with `error` on a
  fatal stop), merges `out-of-scope.json`, prints the round diff in `::group::`,
  appends a summary to `$GITHUB_STEP_SUMMARY`. Exit 0, or 1 on fatal/config errors.

## Live test results (2026-10-17)

Target: TanStack `examples/react/a11y-devtools` (React 19 + Vite, commit 6fbe63f of
TanStack/devtools) copied into a scratch repo as a one-commit "PR". Audit by a throwaway
Playwright + @axe-core/playwright 4.14.0 script (stand-in for detect.ts, same tags and
fingerprint scheme). Model `gemma-4-31b-it`, thinking `minimal`, function calling.

- Gemma 4 31B accepted `systemInstruction` + `thinkingLevel: MINIMAL` + forced
  `propose_edits` function calling in one request. No inline-system fallback, no repair.
- Before: 7 nodes (button-name, 2x color-contrast, 2x image-alt, link-name, select-name).
- Round 1: 1 call, ~20 s. 4 applied, 3 out_of_scope. Re-audit: 3 of 4 fixed; one
  contrast fix (white on #0284c7) still failed although the model claimed 4.59:1.
- Round 2: 1 call; history told the model the previous colour; #0277b3 passed.
- After: 3 nodes left, all out_of_scope with "no distinctive tokens": `<img>` with only
  src/width/height (src shared with an accessible image), and a button whose only text
  is `×` inside aria-hidden.
- Lesson: model-reported contrast ratios are unreliable; the re-audit loop is what
  catches it. Consider computing contrast for proposed colours locally.
- Mapping gap: elements with no id/class/text (3 of 7) were out of scope. Fixed
  the same day with weak tokens (see Mapping above).

Second live run (same day, after the mapping change, fresh outputs):
- Round 1: 1 call, all 7 nodes located in `app/src/App.tsx`, 7 applied.
  Re-audit: 1 left (the same blue-background contrast; model again chose #0284c7).
- Round 2: 1 call, #0277bd. Re-audit: 0 nodes. 7 → 0 in 2 rounds, 2 LLM calls.
- Edit quality notes: `alt="Placeholder"` is weak but honest for a placeholder
  image; `aria-label="Close"` on the × button is a guess; the icon link got both
  `aria-label` and `alt` (redundant); the button tag was split over 3 lines with
  trailing spaces, which brushes against "no reformatting". Worth a prompt tweak.
- Still not built: context from the surrounding DOM (nearest heading) would need
  detect.ts to emit it, i.e. a schema change.

## Open questions / follow-ups

- **detect.ts must emit the schema in `src/lib/schema.ts`** (target flattened to
  `string[]`, `fingerprint` per node). If detect needs a different shape, change
  the schema once and both tools follow.
- **Cross-file partial fixes.** Files are all-or-nothing, but if a violation's edits
  span two files and only one file is accepted, the accepted edit stays and the
  violation is `failed`. The next audit decides. Revisit if this causes noise.
- **`tsc --noEmit -p <app>`** is a no-op for Vite-style solution tsconfigs
  (`files: []` + `references`). Consider `tsc -b` once demo-app exists.
- **Call cap scope.** `CURBFIX_MAX_LLM_CALLS` is per fix.ts invocation (per round),
  not per workflow run. Persisting a count in `$OUT_DIR` would make it per run.
  Confirm which one is intended.
- **Default thinking level** is `minimal` until measured.
- **`scripts/local-run.sh`** is not written: it needs detect.ts. Write it with detect.

## Log

- 2026-10-17: Plan written. Deps installed. M0-M3 done, 35 tests green.
- 2026-10-17: M4-M6 done, 87 tests green.
- 2026-10-17: M7-M9 done. `npx tsc --noEmit` clean, `npm test` 111 tests green. Next: M10 (needs API key).
- 2026-10-17: First live run against Gemma 4 31B: all 5 mappable violations fixed in 2 rounds; 3 left out of scope by the mapping heuristic.
- 2026-10-17: Weak mapping tokens added (src, asset name, symbols, inline styles, width/height); 125 tests green. Second live run: 7 → 0 violations in 2 rounds.
