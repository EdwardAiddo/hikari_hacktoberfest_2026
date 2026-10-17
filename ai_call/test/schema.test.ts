import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FixesFile,
  ViolationsFile,
  fingerprintOf,
  parseViolationsFile,
  readJson,
  readViolationsFile,
} from "../src/lib/schema.ts";

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

// Shape written by Detect/src/detect.ts (DetectOutput in Detect/src/types.ts).
const detectOutput = {
  url: "http://localhost:4173/",
  scannedAt: "2026-10-17T12:00:00.000Z",
  violations: [
    {
      ruleId: "image-alt",
      impact: "critical",
      help: "Images must have alternate text",
      html: '<img src="/a.png">',
      target: ["img.a"],
      failureSummary: "Fix any of the following: no alt",
    },
    {
      ruleId: "color-contrast",
      impact: "serious",
      help: "Elements must meet minimum color contrast ratio thresholds",
      html: "<p>Low</p>",
      target: ["div > p"],
      failureSummary: "contrast",
      data: { fgColor: "#aaaaaa", bgColor: "#ffffff", contrastRatio: 2.32, expectedContrastRatio: "4.5:1" },
    },
    {
      ruleId: "image-alt",
      impact: "critical",
      help: "Images must have alternate text",
      html: '<img src="/b.png">',
      target: ["img.b"],
      failureSummary: "Fix any of the following: no alt",
    },
  ],
};

describe("parseViolationsFile", () => {
  test("groups Detect's flat list by rule and computes fingerprints", () => {
    const parsed = parseViolationsFile(detectOutput);
    expect(parsed.urls).toEqual(["http://localhost:4173/"]);
    expect(parsed.generatedAt).toBe("2026-10-17T12:00:00.000Z");
    expect(parsed.violations.map((v) => [v.ruleId, v.nodes.map((n) => n.fingerprint)])).toEqual([
      ["image-alt", ["image-alt|img.a", "image-alt|img.b"]],
      ["color-contrast", ["color-contrast|div > p"]],
    ]);
    expect(parsed.violations[0]?.helpUrl).toBe("");
    expect(parsed.violations[1]?.nodes[0]?.data).toMatchObject({ contrastRatio: 2.32 });
  });

  test("still accepts the grouped shape", () => {
    const grouped = {
      violations: [
        { ruleId: "r", impact: null, help: "h", helpUrl: "u", nodes: [{ target: ["a"], html: "<a>", fingerprint: "custom" }] },
      ],
    };
    expect(parseViolationsFile(grouped).violations[0]?.nodes[0]?.fingerprint).toBe("custom");
  });

  test("accepts Detect's clean output and an empty grouped file", () => {
    expect(parseViolationsFile({ url: "http://x/", scannedAt: "t", violations: [] }).violations).toEqual([]);
    expect(parseViolationsFile({ violations: [] }).violations).toEqual([]);
  });

  test("keeps Detect's outOfScope flag", () => {
    const parsed = parseViolationsFile({ url: "http://x/", violations: [{ ...detectOutput.violations[0], outOfScope: true }] });
    expect(parsed.violations[0]?.nodes[0]?.outOfScope).toBe(true);
  });

  test("null or non-object data from axe is dropped", () => {
    const base = detectOutput.violations[0]!;
    const parsed = parseViolationsFile({
      url: "http://x/",
      violations: [
        { ...base, target: ["img.n"], data: null },
        { ...base, target: ["img.s"], data: "some string" },
      ],
    });
    expect(parsed.violations[0]?.nodes.map((n) => n.data)).toEqual([undefined, undefined]);
  });

  test("an unknown impact becomes null instead of failing the run", () => {
    const odd = { url: "http://x/", violations: [{ ...detectOutput.violations[0], impact: "weird" }] };
    expect(parseViolationsFile(odd).violations[0]?.impact).toBeNull();
  });

  test("reports Detect's schema errors", () => {
    expect(() => parseViolationsFile({ url: "http://x/", violations: [{ ruleId: "r" }] })).toThrow(/html/);
  });

  test("readViolationsFile names the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "curbfix-"));
    const path = join(dir, "violations.json");
    await writeFile(path, JSON.stringify({ url: 3 }));
    await expect(readViolationsFile(path)).rejects.toThrow(/violations\.json/);
  });

  test("fingerprintOf matches Comment's key, whitespace normalised", () => {
    expect(fingerprintOf("label", ["form  >\n input"])).toBe("label|form > input");
  });
});
