// Schemas for every JSON file the three tools exchange. Shared by detect.ts,
// fix.ts and comment.ts, so any change here is a contract change.
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const Impact = z.enum(["minor", "moderate", "serious", "critical"]);
export type Impact = z.infer<typeof Impact>;

export const ViolationNode = z.object({
  /** axe target, normalised to a flat list of CSS selectors (shadow DOM hops in order). */
  target: z.array(z.string()),
  html: z.string(),
  failureSummary: z.string().default(""),
  /** ruleId plus normalised target (see CLAUDE.md, detect.ts). */
  fingerprint: z.string(),
  outOfScope: z.boolean().optional(),
});
export type ViolationNode = z.infer<typeof ViolationNode>;

export const Violation = z.object({
  ruleId: z.string(),
  impact: Impact.nullable(),
  help: z.string(),
  helpUrl: z.string(),
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
