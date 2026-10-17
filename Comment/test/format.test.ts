import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIssues, isQuiet, MARKER, renderComment } from "../src/format.js";
import { parseFindings } from "../src/load.js";
import type { Finding, FixesFile, RunData } from "../src/types.js";

const img: Finding = { ruleId: "image-alt", impact: "critical", help: "Images need alt", target: ["img.hero"] };
const btn: Finding = { ruleId: "button-name", impact: "serious", help: "Buttons need a name", target: ["button.menu"] };
const link: Finding = { ruleId: "link-name", impact: "serious", help: "Links need text", target: ["footer a"] };

const round1: FixesFile = {
	round: 1,
	model: "gemma-4-31b-it",
	records: [
		{
			ruleId: "image-alt",
			impact: "critical",
			target: ["img.hero"],
			status: "applied",
			reason: "",
			file: "src/Hero.tsx",
			edits: [
				{
					file: "src/Hero.tsx",
					oldStr: '<img src="/hero.png" />',
					newStr: '<img src="/hero.png" alt="Team photo" />',
					rationale: "Added alt text.",
				},
			],
		},
		{
			ruleId: "button-name",
			impact: "serious",
			target: ["button.menu"],
			status: "applied",
			reason: "",
			file: "src/Nav.tsx",
			edits: [{ file: "src/Nav.tsx", oldStr: "<button>", newStr: '<button aria-label="Menu">', rationale: "" }],
		},
		{ ruleId: "link-name", impact: "serious", target: ["footer a"], status: "out_of_scope", reason: "Not in this PR", file: null, edits: [] },
	],
};

const data = (over: Partial<RunData>): RunData => ({ initial: [img, btn, link], remaining: [btn, link], rounds: [round1], ...over });

test("a fix is verified only when the re-scan no longer reports it", () => {
	const byRule = Object.fromEntries(buildIssues(data({})).map((i) => [i.ruleId, i.outcome]));
	assert.equal(byRule["image-alt"], "verified");
	assert.equal(byRule["button-name"], "unverified");
	assert.equal(byRule["link-name"], "out_of_scope");
});

test("issues are ordered by impact", () => {
	assert.deepEqual(buildIssues(data({})).map((i) => i.ruleId), ["image-alt", "button-name", "link-name"]);
});

test("comment carries the marker, counts and a diff", () => {
	const md = renderComment(data({}), { status: "unverified" });
	assert.ok(md.startsWith(MARKER));
	assert.match(md, /\*\*1\*\* of \*\*3\*\* detected issues fixed and verified/);
	assert.match(md, /\+ <img src="\/hero.png" alt="Team photo" \/>/);
});

test("all fixed -> success headline", () => {
	const md = renderComment(data({ initial: [img], remaining: [] }), { status: "clean" });
	assert.match(md, /All \*\*1\*\* detected issue fixed and \*\*verified\*\*/);
});

test("no initial violations -> quiet, and a clean message if it must be shown", () => {
	const empty = data({ initial: [], remaining: [], rounds: [] });
	assert.equal(isQuiet(empty, "clean"), true);
	assert.equal(isQuiet(empty, "error"), false);
	assert.match(renderComment(empty, { status: "clean" }), /No accessibility violations detected/);
});

test("error with no data still produces a comment", () => {
	const md = renderComment({ initial: null, remaining: null, rounds: [] }, { status: "error", runUrl: "https://x/run/1" });
	assert.match(md, /could not finish/);
	assert.match(md, /https:\/\/x\/run\/1/);
});

test("parseFindings reads both the flat and the grouped violation shapes", () => {
	const flat = parseFindings({ violations: [{ ruleId: "a", impact: "minor", help: "h", target: ["x"] }] });
	const grouped = parseFindings({ violations: [{ ruleId: "a", impact: "minor", help: "h", nodes: [{ target: ["x"] }, { target: ["y"] }] }] });
	assert.deepEqual(flat.map((f) => f.target), [["x"]]);
	assert.deepEqual(grouped.map((f) => f.target), [["x"], ["y"]]);
});

test("a huge report falls back to the compact table", () => {
	const many = Array.from({ length: 400 }, (_, i): Finding => ({ ...img, target: [`img.n${i}`] }));
	const bigRound: FixesFile = {
		round: 1,
		model: "m",
		records: many.map((f) => ({ ...f, status: "applied" as const, reason: "", file: "a.tsx", edits: [{ file: "a.tsx", oldStr: "x".repeat(500), newStr: "y".repeat(500), rationale: "" }] })),
	};
	const md = renderComment({ initial: many, remaining: [], rounds: [bigRound] }, { status: "clean" });
	assert.ok(md.length < 65_000);
	assert.ok(md.includes(MARKER));
});
