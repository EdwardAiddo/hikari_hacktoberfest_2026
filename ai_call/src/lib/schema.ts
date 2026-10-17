// Schemas for the JSON files fix.ts reads and writes. The team-wide contract
// for violations.json is Detect/src/types.ts (DetectOutput); DetectOutput below
// mirrors it, and parseViolationsFile() converts it to the grouped shape fix.ts
// works with. fixes-N.json is read by Comment/src/types.ts (FixesFile).
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const Impact = z.enum(["minor", "moderate", "serious", "critical"]);
export type Impact = z.infer<typeof Impact>;

export const ViolationNode = z.object({
  /** axe target, normalised to a flat list of CSS selectors (shadow DOM hops in order). */
  target: z.array(z.string()),
  html: z.string(),
  failureSummary: z.string().default(""),
  /** ruleId plus normalised target, see fingerprintOf(). */
  fingerprint: z.string(),
  outOfScope: z.boolean().optional(),
  /** Extra axe check data; for color-contrast: fgColor, bgColor, contrastRatio, expectedContrastRatio. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ViolationNode = z.infer<typeof ViolationNode>;

export const Violation = z.object({
  ruleId: z.string(),
  impact: Impact.nullable(),
  help: z.string(),
  helpUrl: z.string().default(""),
  /** Page the violation was found on. detect.ts accepts a list of URLs. */
  url: z.string().optional(),
  nodes: z.array(ViolationNode),
});
export type Violation = z.infer<typeof Violation>;

export const ViolationsFile = z.object({
  generatedAt: z.string().optional(),
  urls: z.array(z.string()).default([]),
  violations: z.array(Violation),
});
export type ViolationsFile = z.infer<typeof ViolationsFile>;

/** One failing element, as Detect writes it (Detect/src/types.ts, Violation). */
export const DetectViolation = z.object({
  ruleId: z.string(),
  impact: Impact.nullable().catch(null),
  help: z.string().default(""),
  html: z.string(),
  target: z.array(z.string()),
  failureSummary: z.string().default(""),
  // Detect copies axe's check data as is: often null, sometimes a string. Only objects are useful.
  data: z.record(z.string(), z.unknown()).nullish().catch(undefined),
  /** Set by Detect for fingerprints listed in out-of-scope.json. */
  outOfScope: z.boolean().optional(),
});

/** violations.json as Detect writes it (Detect/src/types.ts, DetectOutput). */
export const DetectOutput = z.object({
  url: z.string(),
  scannedAt: z.string().optional(),
  violations: z.array(DetectViolation),
});
export type DetectOutput = z.infer<typeof DetectOutput>;

/**
 * Identity of a failing element across rounds: rule plus selector. Same key
 * as Comment's keyOf(), with whitespace normalised. Heuristic: an edit can
 * change a selector.
 */
export function fingerprintOf(ruleId: string, target: string[]): string {
  return `${ruleId}|${target.join(" ").replace(/\s+/g, " ").trim()}`;
}

/** Group Detect's one-entry-per-element list by rule, in first-seen order. */
export function fromDetectOutput(detect: DetectOutput): ViolationsFile {
  const byRule = new Map<string, Violation>();
  for (const v of detect.violations) {
    const violation = byRule.get(v.ruleId) ?? {
      ruleId: v.ruleId,
      impact: v.impact,
      help: v.help,
      helpUrl: "",
      url: detect.url,
      nodes: [],
    };
    violation.nodes.push({
      target: v.target,
      html: v.html,
      failureSummary: v.failureSummary,
      fingerprint: fingerprintOf(v.ruleId, v.target),
      ...(v.outOfScope ? { outOfScope: true } : {}),
      ...(v.data ? { data: v.data } : {}),
    });
    byRule.set(v.ruleId, violation);
  }
  return { generatedAt: detect.scannedAt, urls: [detect.url], violations: [...byRule.values()] };
}

/**
 * Accept both violations shapes: Detect's flat list (the team contract) and
 * the grouped shape with per-node fingerprints. Throws with the Detect
 * schema's error, since that is the format callers are expected to produce.
 */
export function parseViolationsFile(raw: unknown): ViolationsFile {
  const list = (raw as { violations?: unknown[] } | null)?.violations;
  const grouped = Array.isArray(list) && list.length > 0 && list.every((v) => Array.isArray((v as { nodes?: unknown })?.nodes));
  if (grouped) return ViolationsFile.parse(raw);
  const detect = DetectOutput.safeParse(raw);
  if (detect.success) return fromDetectOutput(detect.data);
  // An empty grouped file ({ violations: [] } without url) is valid too.
  const fallback = ViolationsFile.safeParse(raw);
  if (fallback.success) return fallback.data;
  throw new Error(z.prettifyError(detect.error));
}

export async function readViolationsFile(path: string): Promise<ViolationsFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return parseViolationsFile(raw);
  } catch (err) {
    throw new Error(`invalid ${path}: ${(err as Error).message}`);
  }
}

/** One search/replace edit, as proposed by the model and as recorded in fixes-N.json. */
export const Edit = z.object({
  file: z.string().describe("Path of the file to edit, exactly as given in the prompt."),
  oldStr: z
    .string()
    .min(1)
    .describe("Exact text to replace. Must occur exactly once in the file. Include enough context to be unique."),
  newStr: z.string().describe("Replacement text."),
  ruleId: z.string().describe("axe rule id this edit fixes."),
  violationId: z
    .string()
    .optional()
    .describe("Id of the violation this edit fixes, e.g. v1, as given in the prompt."),
  rationale: z.string().describe("One sentence: why this edit fixes the violation."),
});
export type Edit = z.infer<typeof Edit>;

export const FixStatus = z.enum(["applied", "skipped", "out_of_scope", "failed"]);
export type FixStatus = z.infer<typeof FixStatus>;

/** Outcome for one violating node (identified by its fingerprint). */
export const FixRecord = z.object({
  fingerprint: z.string(),
  ruleId: z.string(),
  impact: Impact.nullable(),
  target: z.array(z.string()),
  status: FixStatus,
  reason: z.string(),
  file: z.string().nullable(),
  edits: z.array(Edit),
});
export type FixRecord = z.infer<typeof FixRecord>;

export const FixesFile = z.object({
  round: z.number().int().nonnegative(),
  generatedAt: z.string(),
  model: z.string(),
  llmCalls: z.number().int().nonnegative(),
  /** Set when fix.ts stopped on a real error; records written so far are still valid. */
  error: z.string().optional(),
  records: z.array(FixRecord),
});
export type FixesFile = z.infer<typeof FixesFile>;

export const OutOfScopeEntry = z.object({
  fingerprint: z.string(),
  ruleId: z.string(),
  reason: z.string(),
});
export type OutOfScopeEntry = z.infer<typeof OutOfScopeEntry>;

export const OutOfScopeFile = z.object({
  fingerprints: z.array(OutOfScopeEntry),
});
export type OutOfScopeFile = z.infer<typeof OutOfScopeFile>;

/** Read and validate a JSON file. Throws with the file name on any failure. */
export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Stable JSON for files that should diff cleanly between runs. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
