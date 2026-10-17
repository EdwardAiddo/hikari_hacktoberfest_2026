// Violations that Tool 2 (fix) found it cannot fix in this PR are listed in
// out-of-scope.json, next to violations.json. They stay in the output, marked
// outOfScope, but no longer count as "violations found" for the exit code.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Violation } from "./types.js";

/** Same key fix.ts (fingerprintOf) and Comment (keyOf) use: rule plus selector. */
export function fingerprintOf(v: Pick<Violation, "ruleId" | "target">): string {
	return `${v.ruleId}|${v.target.join(" ").replace(/\s+/g, " ").trim()}`;
}

/** Fingerprints from out-of-scope.json; empty when the file is missing. */
export async function readOutOfScope(path: string): Promise<Set<string>> {
	if (!existsSync(path)) return new Set();
	const raw = JSON.parse(await readFile(path, "utf8")) as {
		fingerprints?: { fingerprint?: unknown }[];
	};
	const list = Array.isArray(raw.fingerprints) ? raw.fingerprints : [];
	return new Set(list.map((e) => e.fingerprint).filter((f): f is string => typeof f === "string"));
}

/** Mark known out-of-scope violations. Returns new objects; the input is not changed. */
export function markOutOfScope(violations: Violation[], outOfScope: Set<string>): Violation[] {
	return violations.map((v) => (outOfScope.has(fingerprintOf(v)) ? { ...v, outOfScope: true } : v));
}
