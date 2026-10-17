import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FixesFile, Impact, type Finding, type RunData } from "./types.js";

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (err) {
		throw new Error(`cannot read ${path}: ${(err as Error).message}`);
	}
}

const asImpact = (v: unknown): Finding["impact"] => {
	const parsed = Impact.safeParse(v);
	return parsed.success ? parsed.data : null;
};

const asTarget = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * Reduce a violations file to a flat list of findings, one per failing element.
 * Accepts both shapes in use: one entry per element ({ ruleId, target, ... })
 * and axe's grouped shape ({ ruleId, nodes: [{ target, ... }] }).
 */
export function parseFindings(raw: unknown): Finding[] {
	const list = (raw as { violations?: unknown })?.violations;
	if (!Array.isArray(list)) throw new Error('violations file has no "violations" array');

	const findings: Finding[] = [];
	for (const v of list as Record<string, unknown>[]) {
		const base = {
			ruleId: String(v.ruleId ?? "unknown"),
			impact: asImpact(v.impact),
			help: String(v.help ?? ""),
		};
		if (Array.isArray(v.nodes)) {
			for (const node of v.nodes as Record<string, unknown>[]) {
				findings.push({ ...base, target: asTarget(node.target) });
			}
		} else {
			findings.push({ ...base, target: asTarget(v.target) });
		}
	}
	return findings;
}

async function readFindings(path: string): Promise<Finding[] | null> {
	return existsSync(path) ? parseFindings(await readJson(path)) : null;
}

/** Load the files the loop left in `dir` (curbfix-out). Missing files are fine. */
export async function loadRunData(dir: string): Promise<RunData> {
	const initial = await readFindings(join(dir, "violations-initial.json"));
	const remaining = await readFindings(join(dir, "violations.json"));

	const rounds: FixesFile[] = [];
	if (existsSync(dir)) {
		const names = (await readdir(dir)).filter((f) => /^fixes-\d+\.json$/.test(f));
		for (const name of names) {
			const parsed = FixesFile.safeParse(await readJson(join(dir, name)));
			if (!parsed.success) throw new Error(`invalid ${name}: ${parsed.error.message}`);
			rounds.push(parsed.data);
		}
	}
	rounds.sort((a, b) => a.round - b.round);

	return { initial, remaining, rounds };
}
