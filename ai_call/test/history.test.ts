import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { failedRounds, loadHistory, roundFromPath, shouldGiveUp } from "../src/lib/history.ts";
import { toJson, type FixRecord, type FixStatus } from "../src/lib/schema.ts";

const record = (fingerprint: string, status: FixStatus): FixRecord => ({
  fingerprint,
  ruleId: "image-alt",
  impact: "critical",
  target: ["img"],
  status,
  reason: `reason ${status}`,
  file: "app/src/A.tsx",
  edits: status === "applied" ? [{ file: "app/src/A.tsx", oldStr: "a", newStr: "b", ruleId: "image-alt", rationale: "r" }] : [],
});

const fixes = (round: number, records: FixRecord[]) =>
  toJson({ round, generatedAt: "t", model: "m", llmCalls: 1, records });

const audit = (fingerprints: string[]) =>
  toJson({
    violations: [
      {
        ruleId: "image-alt",
        impact: "critical",
        help: "h",
        helpUrl: "u",
        nodes: fingerprints.map((fingerprint) => ({ target: ["img"], html: "<img>", fingerprint })),
      },
    ],
  });

async function setup() {
  const out = await mkdtemp(join(tmpdir(), "curbfix-history-"));
  const hist = join(out, "history");
  await mkdir(hist);
  return { out, hist };
}

describe("loadHistory", () => {
  test("collects attempts per fingerprint from earlier rounds only", async () => {
    const { out, hist } = await setup();
    await writeFile(join(out, "fixes-1.json"), fixes(1, [record("a", "applied"), record("b", "skipped")]));
    await writeFile(join(out, "fixes-2.json"), fixes(2, [record("a", "failed")]));
    await writeFile(join(out, "fixes-3.json"), fixes(3, [record("a", "applied")]));
    const history = await loadHistory({ outDir: out, historyDir: hist, currentRound: 3 });
    expect(history.get("a")?.map((a) => [a.round, a.status])).toEqual([
      [1, "applied"],
      [2, "failed"],
    ]);
    expect(history.get("b")?.map((a) => a.status)).toEqual(["skipped"]);
  });

  test("ignores attempts for fingerprints missing from that round's audit", async () => {
    const { out, hist } = await setup();
    await writeFile(join(hist, "violations-1.json"), audit(["b"]));
    await writeFile(join(out, "fixes-1.json"), fixes(1, [record("a", "applied"), record("b", "applied")]));
    const history = await loadHistory({ outDir: out, historyDir: hist, currentRound: 2 });
    expect(history.has("a")).toBe(false);
    expect(history.has("b")).toBe(true);
  });

  test("a missing history directory is fine", async () => {
    const history = await loadHistory({ outDir: "/nonexistent", historyDir: "/nonexistent/h", currentRound: 1 });
    expect(history.size).toBe(0);
  });
});

describe("two-strike rule", () => {
  test("skipped and out-of-scope rounds do not count", () => {
    const attempts = [
      { round: 1, status: "skipped" as const, reason: "", edits: [] },
      { round: 2, status: "applied" as const, reason: "", edits: [] },
    ];
    expect(failedRounds(attempts)).toHaveLength(1);
    expect(shouldGiveUp(attempts)).toBe(false);
    expect(shouldGiveUp([...attempts, { round: 3, status: "failed", reason: "", edits: [] }])).toBe(true);
    expect(shouldGiveUp(undefined)).toBe(false);
  });
});

test("roundFromPath", () => {
  expect(roundFromPath("/out/fixes-12.json")).toBe(12);
  expect(roundFromPath("/out/fixes.json")).toBeNull();
});
