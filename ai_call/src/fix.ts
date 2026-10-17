// Tool 2: ask Gemma 4 to fix the in-scope axe violations in files the PR touched.
//
//   npx tsx src/fix.ts --violations <json> --history <dir> --base <ref> --app <dir> --out <fixes-N.json>
//
// Exit 0 whenever the round ran to completion, even with skipped violations.
// Exit 1 on real errors (bad config, API unreachable after retries).
// Edits the working tree in place; never commits or pushes.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.ts";
import { unifiedDiff } from "./lib/diff.ts";
import { runRound, type RoundOutput } from "./lib/fixer.ts";
import { loadHistory, numberedFiles, roundFromPath } from "./lib/history.ts";
import { GeminiClient } from "./lib/llm.ts";
import { actionsLogger as log } from "./lib/log.ts";
import type { SourceFile } from "./lib/mapping.ts";
import {
  FixesFile,
  OutOfScopeFile,
  readJson,
  readViolationsFile,
  toJson,
  type FixRecord,
  type OutOfScopeEntry,
} from "./lib/schema.ts";
import { gitRoot, listCandidateFiles } from "./lib/scope.ts";
import { typecheckApp } from "./lib/syntax.ts";

const MAX_SUMMARY_DIFF_CHARS = 60_000;

function parseCli() {
  const { values } = parseArgs({
    options: {
      violations: { type: "string" },
      history: { type: "string" },
      base: { type: "string" },
      app: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  const missing = (["violations", "history", "base", "app", "out"] as const).filter((k) => !values[k]);
  if (missing.length) throw new Error(`missing required option(s): ${missing.map((k) => `--${k}`).join(", ")}`);
  return values as Record<"violations" | "history" | "base" | "app" | "out", string>;
}

async function nextRound(outDir: string): Promise<number> {
  const existing = await numberedFiles(outDir, "fixes");
  return (existing.at(-1)?.n ?? 0) + 1;
}

async function readOutOfScope(path: string): Promise<OutOfScopeEntry[]> {
  return existsSync(path) ? (await readJson(path, OutOfScopeFile)).fingerprints : [];
}

function mergeOutOfScope(existing: OutOfScopeEntry[], added: OutOfScopeEntry[]): OutOfScopeEntry[] {
  const byFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));
  for (const e of added) if (!byFingerprint.has(e.fingerprint)) byFingerprint.set(e.fingerprint, e);
  return [...byFingerprint.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

function statusCounts(records: FixRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return ["applied", "skipped", "out_of_scope", "failed"].map((s) => `${s}: ${counts.get(s) ?? 0}`).join(", ");
}

async function roundDiff(out: RoundOutput): Promise<string> {
  const parts: string[] = [];
  for (const { file, before } of [...out.changed].sort((a, b) => a.file.rel.localeCompare(b.file.rel))) {
    parts.push(await unifiedDiff(file.rel, before, file.content));
  }
  return parts.join("");
}

function summaryMarkdown(round: number, model: string, out: RoundOutput, diff: string): string {
  const lines = [`### curbfix fix round ${round} (${model})`, "", statusCounts(out.records), ""];
  const notable = out.records.filter((r) => r.status !== "applied");
  if (notable.length) {
    lines.push("| Status | Rule | Target | Reason |", "| --- | --- | --- | --- |");
    for (const r of notable) {
      const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 300);
      lines.push(`| ${r.status} | ${r.ruleId} | \`${cell(r.target.join(" "))}\` | ${cell(r.reason)} |`);
    }
    lines.push("");
  }
  if (diff) {
    const shown = diff.length > MAX_SUMMARY_DIFF_CHARS ? `${diff.slice(0, MAX_SUMMARY_DIFF_CHARS)}\n... (truncated)\n` : diff;
    lines.push("<details><summary>Diff</summary>", "", "```diff", shown.trimEnd(), "```", "", "</details>", "");
  } else {
    lines.push("No files changed in this round.", "");
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const args = parseCli();
  const config = loadConfig();
  const cwd = process.cwd();
  const outPath = resolve(cwd, args.out);
  const outDir = resolve(cwd, config.outDir ?? dirname(outPath));
  const appDir = resolve(cwd, args.app);
  const round = roundFromPath(outPath) ?? (await nextRound(outDir));

  const violations = await readViolationsFile(resolve(cwd, args.violations));
  const outOfScopePath = join(outDir, "out-of-scope.json");
  const knownOutOfScope = await readOutOfScope(outOfScopePath);
  const history = await loadHistory({ outDir, historyDir: resolve(cwd, args.history), currentRound: round });

  const root = await gitRoot(cwd);
  const candidatePaths = await listCandidateFiles({ base: args.base, appDir, cwd });
  const candidates: SourceFile[] = await Promise.all(
    candidatePaths.map(async (path) => ({ path, rel: relative(root, path), content: await readFile(path, "utf8") })),
  );
  log.info(`curbfix: round ${round}, ${candidates.length} candidate file(s), model ${config.model}`);

  const client = config.apiKey
    ? new GeminiClient({
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        thinking: config.thinking,
        maxCalls: config.maxLlmCalls,
      })
    : null;

  const out = await runRound({
    violations,
    candidates,
    history,
    knownOutOfScope: new Set(knownOutOfScope.map((e) => e.fingerprint)),
    client,
    mode: config.structuredOutput,
    typecheck: () => typecheckApp(appDir),
    log,
  });

  const fixes: FixesFile = {
    round,
    generatedAt: new Date().toISOString(),
    model: config.model,
    llmCalls: client?.calls ?? 0,
    ...(out.fatal ? { error: out.fatal.message } : {}),
    records: out.records,
  };
  await writeFile(outPath, toJson(FixesFile.parse(fixes)));
  await writeFile(outOfScopePath, toJson({ fingerprints: mergeOutOfScope(knownOutOfScope, out.newOutOfScope) }));

  const diff = await roundDiff(out);
  log.group(`curbfix round ${round} diff (${out.changed.length} file(s))`, diff || "(no changes)");
  log.info(`curbfix: ${statusCounts(out.records)}; ${fixes.llmCalls} LLM call(s)`);
  if (config.stepSummary) await appendFile(config.stepSummary, summaryMarkdown(round, config.model, out, diff));

  if (out.fatal) {
    log.error(`curbfix fix round ${round} stopped: ${out.fatal.message}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log.error(`curbfix fix failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
