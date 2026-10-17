import type { Edit, Finding, Issue, Outcome, RunData, Status } from "./types.js";

/** Hidden marker used to find (and update) our comment on later runs. */
export const MARKER = "<!-- curbfix -->";

/** GitHub rejects comments over 65536 characters. */
const MAX_COMMENT_CHARS = 60_000;
const MAX_DIFF_LINES = 40;

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"];

const OUTCOME_LABEL: Record<Outcome, string> = {
	verified: "✅ Verified",
	unverified: "⚠️ Unverified",
	failed: "❌ Not fixed",
	out_of_scope: "➖ Out of scope",
	not_attempted: "⏭️ Not attempted",
};

const keyOf = (f: Pick<Finding, "ruleId" | "target">) => `${f.ruleId}|${f.target.join(" ")}`;

const impactRank = (impact: Finding["impact"]) => {
	const i = impact ? IMPACT_ORDER.indexOf(impact) : -1;
	return i === -1 ? IMPACT_ORDER.length : i;
};

/** Join what the first scan found with what the fix rounds and the last scan say happened to it. */
export function buildIssues(data: RunData): Issue[] {
	const stillFailing = data.remaining ? new Set(data.remaining.map(keyOf)) : null;

	// latest record wins; edits from every round that applied them are kept, in order
	const latest = new Map<string, { status: string; reason: string; file: string | null }>();
	const edits = new Map<string, Edit[]>();
	for (const round of data.rounds) {
		for (const rec of round.records) {
			const key = keyOf(rec);
			latest.set(key, { status: rec.status, reason: rec.reason, file: rec.file });
			if (rec.status === "applied") edits.set(key, [...(edits.get(key) ?? []), ...rec.edits]);
		}
	}

	const seen = new Set<string>();
	const issues: Issue[] = [];
	for (const finding of data.initial ?? []) {
		const key = keyOf(finding);
		if (seen.has(key)) continue;
		seen.add(key);

		const rec = latest.get(key);
		const present = stillFailing === null || stillFailing.has(key);
		let outcome: Outcome;
		let reason = rec?.reason ?? "";
		if (rec?.status === "out_of_scope") {
			outcome = "out_of_scope";
		} else if (!present) {
			outcome = "verified";
			if (!rec) reason = "No longer reported by the re-scan.";
		} else if (rec?.status === "applied") {
			outcome = "unverified";
			reason ||= "A fix was applied but the re-scan still reports this element.";
		} else if (rec?.status === "failed") {
			outcome = "failed";
		} else {
			outcome = "not_attempted";
		}

		issues.push({
			...finding,
			outcome,
			reason,
			file: rec?.file ?? edits.get(key)?.[0]?.file ?? null,
			edits: edits.get(key) ?? [],
		});
	}

	return issues.sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const fenced = (lang: string, body: string) => {
	const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((m) => m.length));
	const fence = "`".repeat(longest + 1);
	return `${fence}${lang}\n${body}\n${fence}`;
};

/** Show an edit as a small unified-style diff built from its old/new text. */
function editDiff(edit: Edit): string {
	const lines = [
		`--- a/${edit.file}`,
		`+++ b/${edit.file}`,
		...edit.oldStr.split("\n").map((l) => `- ${l}`),
		...edit.newStr.split("\n").map((l) => `+ ${l}`),
	];
	const shown = lines.length > MAX_DIFF_LINES ? [...lines.slice(0, MAX_DIFF_LINES), "... (truncated)"] : lines;
	return fenced("diff", shown.join("\n"));
}

function renderIssue(issue: Issue): string {
	const target = issue.target.join(" ");
	const title = `${OUTCOME_LABEL[issue.outcome]} · <code>${issue.ruleId}</code>${issue.impact ? ` (${issue.impact})` : ""}`;
	const body: string[] = [];
	if (issue.help) body.push(issue.help);
	if (target) body.push(`Element: \`${target.replace(/`/g, "'")}\``);
	if (issue.file) body.push(`File: \`${issue.file}\``);
	for (const edit of issue.edits) {
		if (edit.rationale) body.push(`_${edit.rationale}_`);
		body.push(editDiff(edit));
	}
	if (issue.outcome !== "verified" && issue.reason) body.push(`> ${issue.reason}`);
	return `<details>\n<summary>${title}</summary>\n\n${body.join("\n\n")}\n\n</details>`;
}

export interface RenderOptions {
	status: Status;
	/** link to the workflow run, for the debug artifact */
	runUrl?: string;
	/** error text shown when the run did not finish */
	errorDetail?: string;
}

const count = (issues: Issue[], outcome: Outcome) => issues.filter((i) => i.outcome === outcome).length;

/** Build the full markdown body of the PR comment. */
export function renderComment(data: RunData, opts: RenderOptions): string {
	const issues = buildIssues(data);
	const total = issues.length;
	const verified = count(issues, "verified");
	const lines: string[] = [MARKER, "## CurbFix accessibility report", ""];

	if (opts.status === "error" && total === 0) {
		lines.push("❌ CurbFix could not finish its check on this pull request.");
		if (opts.errorDetail) lines.push("", `> ${opts.errorDetail}`);
	} else if (total === 0) {
		lines.push("✅ No accessibility violations detected by axe-core on this pull request.");
	} else {
		const needReview = total - verified;
		if (opts.status === "error") {
			lines.push("❌ CurbFix stopped before it finished. The results below are partial.", "");
		}
		lines.push(
			needReview === 0
				? `✅ All **${total}** detected issue${total === 1 ? "" : "s"} fixed and **verified**: the re-scan no longer reports them.`
				: `⚠️ **${verified}** of **${total}** detected issues fixed and verified. **${needReview}** need${needReview === 1 ? "s" : ""} human review.`,
		);

		lines.push("", "| Outcome | Issues |", "| --- | ---: |");
		for (const outcome of Object.keys(OUTCOME_LABEL) as Outcome[]) {
			const n = count(issues, outcome);
			if (n) lines.push(`| ${cell(OUTCOME_LABEL[outcome])} | ${n} |`);
		}

		lines.push("", "### Details", "", ...issues.map(renderIssue).flatMap((s) => [s, ""]));
		lines.push(
			"_Suggested changes are not committed: apply them yourself after review. " +
				"Text such as `alt` and labels is a suggestion and needs a human check._",
		);
	}

	lines.push(
		"",
		"---",
		"<sub>Automated checks (axe-core) catch only part of the accessibility problems; " +
			"a clean result does not mean the page is accessible." +
			(opts.runUrl ? ` [Workflow run and screenshots](${opts.runUrl}).` : "") +
			"</sub>",
	);

	const body = lines.join("\n");
	return body.length <= MAX_COMMENT_CHARS ? body : renderCompact(issues, opts);
}

/** Fallback for very large reports: counts and a table, no diffs. */
function renderCompact(issues: Issue[], opts: RenderOptions): string {
	const rows = issues.map(
		(i) => `| ${cell(OUTCOME_LABEL[i.outcome])} | \`${i.ruleId}\` | ${i.impact ?? ""} | \`${cell(i.target.join(" ")).slice(0, 80)}\` |`,
	);
	const table = ["| Outcome | Rule | Impact | Element |", "| --- | --- | --- | --- |", ...rows];
	const kept: string[] = [];
	let size = 0;
	for (const row of table) {
		size += row.length + 1;
		if (size > MAX_COMMENT_CHARS - 2000) {
			kept.push(`... and ${table.length - kept.length} more row(s)`);
			break;
		}
		kept.push(row);
	}
	return [
		MARKER,
		"## CurbFix accessibility report",
		"",
		`${issues.length} issues found; the report is too large to show diffs here.` +
			(opts.runUrl ? ` See the [workflow run](${opts.runUrl}).` : ""),
		"",
		...kept,
	].join("\n");
}

/** True when the first scan found nothing, so a first-time comment would only be noise. */
export function isQuiet(data: RunData, status: Status): boolean {
	return status !== "error" && (data.initial?.length ?? 0) === 0 && data.rounds.length === 0;
}
