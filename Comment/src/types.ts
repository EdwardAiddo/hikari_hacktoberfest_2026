import { z } from "zod";

export type Status = "clean" | "unverified" | "error";

export const Impact = z.enum(["minor", "moderate", "serious", "critical"]);
export type Impact = z.infer<typeof Impact>;

/** One search/replace edit recorded by fix.ts in fixes-N.json. */
const Edit = z.object({
	file: z.string(),
	oldStr: z.string(),
	newStr: z.string(),
	rationale: z.string().default(""),
});
export type Edit = z.infer<typeof Edit>;

const FixRecord = z.object({
	ruleId: z.string(),
	impact: Impact.nullable().default(null),
	target: z.array(z.string()),
	status: z.enum(["applied", "skipped", "out_of_scope", "failed"]),
	reason: z.string().default(""),
	file: z.string().nullable().default(null),
	edits: z.array(Edit).default([]),
});
export type FixRecord = z.infer<typeof FixRecord>;

/** fixes-N.json, written by fix.ts. */
export const FixesFile = z.object({
	round: z.number(),
	model: z.string().default(""),
	error: z.string().optional(),
	records: z.array(FixRecord),
});
export type FixesFile = z.infer<typeof FixesFile>;

/** A failing element, reduced to what the report needs. */
export interface Finding {
	ruleId: string;
	impact: Impact | null;
	help: string;
	target: string[];
}

/** Everything the report is built from. */
export interface RunData {
	/** violations found by the first scan (before any fix) */
	initial: Finding[] | null;
	/** violations still present after the last scan; null if there was no scan */
	remaining: Finding[] | null;
	/** fix rounds in ascending order */
	rounds: FixesFile[];
}

export type Outcome = "verified" | "unverified" | "failed" | "out_of_scope" | "not_attempted";

/** One row of the report: a finding plus what happened to it. */
export interface Issue extends Finding {
	outcome: Outcome;
	file: string | null;
	edits: Edit[];
	reason: string;
}
