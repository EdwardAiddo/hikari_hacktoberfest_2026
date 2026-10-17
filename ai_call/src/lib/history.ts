// What earlier rounds already tried, per fingerprint. Used to tell the model
// not to repeat an edit, and to give up after MAX_FAILED_ROUNDS.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FixesFile, ViolationsFile, readJson, type Edit, type FixStatus } from "./schema.ts";

export const MAX_FAILED_ROUNDS = 2;

export interface Attempt {
  round: number;
  status: FixStatus;
  reason: string;
  edits: Edit[];
}

export type History = Map<string, Attempt[]>;

/** Numbered files like `fixes-3.json` in `dir`, sorted by number. Missing dir = none. */
export async function numberedFiles(dir: string, prefix: string): Promise<{ n: number; path: string }[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const re = new RegExp(`^${prefix}-(\\d+)\\.json$`);
  return names
    .map((name) => ({ m: re.exec(name), name }))
    .filter((x): x is { m: RegExpExecArray; name: string } => x.m !== null)
    .map(({ m, name }) => ({ n: Number(m[1]), path: join(dir, name) }))
    .sort((a, b) => a.n - b.n);
}

/**
 * Attempts from fixes-N.json for N < currentRound. When history/violations-N.json
 * exists, an attempt only counts if its fingerprint was in that audit, so a
 * stale or re-run file cannot inflate the count.
 */
export async function loadHistory(opts: { outDir: string; historyDir: string; currentRound: number }): Promise<History> {
  const audits = new Map<number, Set<string>>();
  for (const { n, path } of await numberedFiles(opts.historyDir, "violations")) {
    const file = await readJson(path, ViolationsFile);
    audits.set(n, new Set(file.violations.flatMap((v) => v.nodes.map((node) => node.fingerprint))));
  }

  const history: History = new Map();
  for (const { n, path } of await numberedFiles(opts.outDir, "fixes")) {
    if (n >= opts.currentRound) continue;
    const fixes = await readJson(path, FixesFile);
    const audit = audits.get(n);
    for (const r of fixes.records) {
      if (audit && !audit.has(r.fingerprint)) continue;
      const list = history.get(r.fingerprint) ?? [];
      list.push({ round: n, status: r.status, reason: r.reason, edits: r.edits });
      history.set(r.fingerprint, list);
    }
  }
  return history;
}

/**
 * Rounds in which an edit was attempted for a fingerprint that is still
 * failing now. Call only for fingerprints present in the current audit.
 */
export function failedRounds(attempts: Attempt[] | undefined): Attempt[] {
  return (attempts ?? []).filter((a) => a.status === "applied" || a.status === "failed");
}

export function shouldGiveUp(attempts: Attempt[] | undefined): boolean {
  return failedRounds(attempts).length >= MAX_FAILED_ROUNDS;
}

/** The round number from `fixes-N.json`, or null. */
export function roundFromPath(path: string): number | null {
  const m = /fixes-(\d+)\.json$/.exec(path);
  return m ? Number(m[1]) : null;
}
