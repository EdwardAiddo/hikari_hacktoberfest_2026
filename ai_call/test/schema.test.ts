import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FixesFile, ViolationsFile, readJson } from "../src/lib/schema.ts";

describe("schema", () => {
  test("parses a violations file and fills defaults", () => {
    const parsed = ViolationsFile.parse({
      violations: [
        {
          ruleId: "image-alt",
          impact: "critical",
          help: "Images must have alternate text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
          nodes: [{ target: ["img.logo"], html: '<img class="logo">', fingerprint: "image-alt|img.logo" }],
        },
      ],
    });
    expect(parsed.urls).toEqual([]);
    expect(parsed.violations[0]?.nodes[0]?.failureSummary).toBe("");
  });

  test("rejects an unknown fix status", () => {
    const result = FixesFile.safeParse({
      round: 1,
      generatedAt: "x",
      model: "m",
      llmCalls: 0,
      records: [
        { fingerprint: "f", ruleId: "r", impact: null, target: [], status: "done", reason: "", file: null, edits: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("readJson names the file on error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curbfix-"));
    const path = join(dir, "bad.json");
    await writeFile(path, '{"violations": 3}');
    await expect(readJson(path, ViolationsFile)).rejects.toThrow(/bad\.json/);
  });
});
