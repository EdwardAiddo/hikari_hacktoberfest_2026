import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runRound, type RoundInput } from "../src/lib/fixer.ts";
import type { History } from "../src/lib/history.ts";
import { FakeLlmClient, LlmBudgetError, LlmFatalError, type LlmResponse } from "../src/lib/llm.ts";
import { silentLogger } from "../src/lib/log.ts";
import type { SourceFile } from "../src/lib/mapping.ts";
import type { Edit, Violation, ViolationsFile } from "../src/lib/schema.ts";

const HEADER = `export function Header() {
  return (
    <header className="site-header">
      <img src={logo} className="brand-logo" />
      <button className="menu-toggle" onClick={toggle}><svg /></button>
    </header>
  );
}
`;
const FORM = `export function SignupForm() {
  return <input id="email" type="email" />;
}
`;

const imageAlt: Violation = {
  ruleId: "image-alt",
  impact: "critical",
  help: "Images must have alternate text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
  nodes: [{ target: ["img.brand-logo"], html: '<img src="/logo.png" class="brand-logo">', failureSummary: "no alt", fingerprint: "image-alt|img.brand-logo" }],
};
const buttonName: Violation = {
  ruleId: "button-name",
  impact: "critical",
  help: "Buttons must have discernible text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.10/button-name",
  nodes: [{ target: [".menu-toggle"], html: '<button class="menu-toggle"><svg></svg></button>', failureSummary: "no text", fingerprint: "button-name|.menu-toggle" }],
};
const label: Violation = {
  ruleId: "label",
  impact: "critical",
  help: "Form elements must have labels",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
  nodes: [{ target: ["#email"], html: '<input id="email" type="email">', failureSummary: "no label", fingerprint: "label|#email" }],
};
const footer: Violation = {
  ruleId: "color-contrast",
  impact: "serious",
  help: "Elements must meet minimum color contrast ratio thresholds",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
  nodes: [{ target: ["footer > p"], html: "<p>© 2026 Acme Corporation</p>", failureSummary: "contrast 2.1", fingerprint: "color-contrast|footer > p" }],
};

const altEdit: Edit = {
  file: "app/src/Header.tsx",
  oldStr: 'className="brand-logo" />',
  newStr: 'className="brand-logo" alt="Acme" />',
  ruleId: "image-alt",
  violationId: "v1",
  rationale: "Adds a text alternative.",
};
const labelEdit: Edit = {
  file: "app/src/SignupForm.tsx",
  oldStr: '<input id="email" type="email" />',
  newStr: '<input id="email" type="email" aria-label="Email" />',
  ruleId: "label",
  violationId: "v1",
  rationale: "Labels the input.",
};

const call = (edits: Edit[], skipped: { violationId: string; reason: string }[] = []): Partial<LlmResponse> => ({
  functionArgs: { edits, skipped },
});

async function setup(violations: Violation[], overrides: Partial<RoundInput> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "curbfix-fixer-"));
  const candidates: SourceFile[] = [];
  for (const [rel, content] of [
    ["app/src/Header.tsx", HEADER],
    ["app/src/SignupForm.tsx", FORM],
  ] as const) {
    const path = join(dir, rel.replace(/\//g, "_"));
    await writeFile(path, content);
    candidates.push({ path, rel, content });
  }
  const file: ViolationsFile = { urls: ["http://localhost:4173/"], violations };
  const input: RoundInput = {
    violations: file,
    candidates,
    history: new Map(),
    knownOutOfScope: new Set(),
    client: new FakeLlmClient([]),
    mode: "function",
    typecheck: null,
    log: silentLogger,
    ...overrides,
  };
  return { input, candidates, header: candidates[0]!, form: candidates[1]! };
}

const byFingerprint = <T extends { fingerprint: string }>(records: T[]): Record<string, T> => Object.fromEntries(records.map((r) => [r.fingerprint, r]));

describe("runRound", () => {
  test("applies edits, records skips, one call per file", async () => {
    const client = new FakeLlmClient([
      call([altEdit], [{ violationId: "v2", reason: "icon meaning unclear" }]),
      call([labelEdit]),
    ]);
    const { input, header, form } = await setup([imageAlt, buttonName, label], { client });
    const out = await runRound(input);

    expect(client.calls).toBe(2);
    expect(client.requests[0]?.user).toContain("app/src/Header.tsx");
    expect(client.requests[0]?.user).not.toContain("SignupForm");
    const r = byFingerprint(out.records);
    expect(r["image-alt|img.brand-logo"]).toMatchObject({ status: "applied", file: "app/src/Header.tsx", edits: [altEdit] });
    expect(r["button-name|.menu-toggle"]).toMatchObject({ status: "skipped", reason: "icon meaning unclear" });
    expect(r["label|#email"]).toMatchObject({ status: "applied" });
    expect(await readFile(header.path, "utf8")).toContain('alt="Acme"');
    expect(await readFile(form.path, "utf8")).toContain('aria-label="Email"');
    expect(out.changed.map((c) => c.file.rel)).toEqual(["app/src/Header.tsx", "app/src/SignupForm.tsx"]);
    expect(out.fatal).toBeNull();
  });

  test("an element not found in changed files is out of scope, without a call", async () => {
    const client = new FakeLlmClient([]);
    const { input } = await setup([footer], { client });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "out_of_scope", file: null });
    expect(out.newOutOfScope).toEqual([
      expect.objectContaining({ fingerprint: "color-contrast|footer > p", ruleId: "color-contrast" }),
    ]);
    expect(client.calls).toBe(0);
  });

  test("known out-of-scope fingerprints and detect's flag are not retried", async () => {
    const flagged: Violation = { ...label, nodes: [{ ...label.nodes[0]!, outOfScope: true }] };
    const { input } = await setup([imageAlt, flagged], { knownOutOfScope: new Set(["image-alt|img.brand-logo"]) });
    const out = await runRound(input);
    expect(out.records.map((r) => r.status)).toEqual(["out_of_scope", "out_of_scope"]);
    expect(out.newOutOfScope).toEqual([]);
  });

  test("gives up after two failed rounds and tells the model about one previous attempt", async () => {
    const history: History = new Map([
      [
        "image-alt|img.brand-logo",
        [
          { round: 1, status: "applied", reason: "r1", edits: [altEdit] },
          { round: 2, status: "failed", reason: "r2", edits: [] },
        ],
      ],
      ["label|#email", [{ round: 1, status: "applied", reason: "added aria-label", edits: [labelEdit] }]],
    ]);
    const client = new FakeLlmClient([call([], [{ violationId: "v1", reason: "no better idea" }])]);
    const { input } = await setup([imageAlt, label], { history, client });
    const out = await runRound(input);
    const r = byFingerprint(out.records);
    expect(r["image-alt|img.brand-logo"]).toMatchObject({ status: "failed" });
    expect(r["image-alt|img.brand-logo"]!.reason).toMatch(/after 2 attempts \(rounds 1, 2\)/);
    expect(client.calls).toBe(1);
    expect(client.requests[0]?.user).toContain("Previous attempts that did not fix it");
    expect(client.requests[0]?.user).toContain("added aria-label");
  });

  test("rejected edits leave the file untouched and mark the violation failed", async () => {
    const bad = { ...altEdit, oldStr: "not in the file" };
    const client = new FakeLlmClient([call([bad])]);
    const { input, header } = await setup([imageAlt], { client });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "failed", reason: "edits rejected: oldStr not found in the file" });
    expect(await readFile(header.path, "utf8")).toBe(HEADER);
    expect(out.changed).toEqual([]);
  });

  test("an edit to a file outside the call's file set is rejected", async () => {
    const sneaky = { ...altEdit, file: "app/package.json", oldStr: "{", newStr: '{"scripts":{}' };
    const client = new FakeLlmClient([call([sneaky])]);
    const { input } = await setup([imageAlt], { client });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "failed" });
    expect(out.records[0]!.reason).toMatch(/not an editable file/);
  });

  test("edits for rules that were not listed are dropped", async () => {
    const extra = { ...altEdit, ruleId: "region", violationId: undefined };
    const client = new FakeLlmClient([call([extra])]);
    const { input, header } = await setup([imageAlt], { client });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "skipped", reason: "the model proposed no edit" });
    expect(await readFile(header.path, "utf8")).toBe(HEADER);
  });

  test("edits without violationId are attributed by ruleId", async () => {
    const client = new FakeLlmClient([call([{ ...altEdit, violationId: undefined }])]);
    const { input } = await setup([imageAlt], { client });
    expect((await runRound(input)).records[0]).toMatchObject({ status: "applied" });
  });

  test("reverts a group when the type check gets worse", async () => {
    const client = new FakeLlmClient([call([altEdit])]);
    let calls = 0;
    const typecheck = async () => (calls++ === 0 ? { errors: 1, output: "" } : { errors: 2, output: "error TS2322" });
    const { input, header } = await setup([imageAlt], { client, typecheck });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "failed" });
    expect(out.records[0]!.reason).toMatch(/tsc reported 2 error\(s\), 1 before/);
    expect(await readFile(header.path, "utf8")).toBe(HEADER);
    expect(out.changed).toEqual([]);
  });

  test("budget exhaustion skips the remaining files and is not fatal", async () => {
    const client = new FakeLlmClient([new LlmBudgetError(1)]);
    const { input } = await setup([imageAlt, label], { client });
    const out = await runRound(input);
    expect(out.records.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(out.records[0]!.reason).toMatch(/budget exhausted/);
    expect(out.fatal).toBeNull();
  });

  test("a fatal API error stops the round and keeps earlier results", async () => {
    const client = new FakeLlmClient([call([altEdit]), new LlmFatalError("Gemini API unreachable after 5 attempts")]);
    const { input } = await setup([imageAlt, label], { client });
    const out = await runRound(input);
    const r = byFingerprint(out.records);
    expect(r["image-alt|img.brand-logo"]).toMatchObject({ status: "applied" });
    expect(r["label|#email"]).toMatchObject({ status: "skipped" });
    expect(out.fatal?.message).toMatch(/unreachable/);
  });

  test("no API key is a configuration error only when a call is needed", async () => {
    const withWork = await setup([imageAlt], { client: null });
    expect((await runRound(withWork.input)).fatal?.message).toMatch(/GEMINI_API_KEY/);
    const withoutWork = await setup([footer], { client: null });
    expect((await runRound(withoutWork.input)).fatal).toBeNull();
  });

  test("invalid model output after repair marks the file's violations failed", async () => {
    const client = new FakeLlmClient([{ text: "sorry" }, { text: "still sorry" }]);
    const { input } = await setup([imageAlt], { client });
    const out = await runRound(input);
    expect(out.records[0]).toMatchObject({ status: "failed" });
    expect(out.records[0]!.reason).toMatch(/invalid model output after repair/);
  });

  test("duplicate fingerprints are handled once", async () => {
    const client = new FakeLlmClient([call([altEdit])]);
    const { input } = await setup([imageAlt, { ...imageAlt, url: "http://localhost:4173/other" }], { client });
    expect((await runRound(input)).records).toHaveLength(1);
  });
});
