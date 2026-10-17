import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fingerprintOf, markOutOfScope, readOutOfScope } from "../src/outOfScope.js";
import type { Violation } from "../src/types.js";

const v = (ruleId: string, target: string[]): Violation => ({
	ruleId,
	impact: "serious",
	help: "",
	html: "<a>",
	target,
	failureSummary: "",
});

test("fingerprint matches fix.ts and Comment: rule plus selector, whitespace normalised", () => {
	assert.equal(fingerprintOf(v("link-name", ["footer  >\n a"])), "link-name|footer > a");
});

test("marks only listed violations", () => {
	const marked = markOutOfScope([v("link-name", ["a"]), v("image-alt", ["img"])], new Set(["link-name|a"]));
	assert.equal(marked[0]?.outOfScope, true);
	assert.equal(marked[1]?.outOfScope, undefined);
});

test("reads fix.ts's out-of-scope.json; a missing file means none", async () => {
	const dir = await mkdtemp(join(tmpdir(), "detect-"));
	const path = join(dir, "out-of-scope.json");
	assert.equal((await readOutOfScope(path)).size, 0);
	await writeFile(path, JSON.stringify({ fingerprints: [{ fingerprint: "link-name|a", ruleId: "link-name", reason: "x" }] }));
	assert.deepEqual([...(await readOutOfScope(path))], ["link-name|a"]);
});
