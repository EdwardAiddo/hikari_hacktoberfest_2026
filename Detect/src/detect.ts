// Parse args, call scanPage, write violations.json, set the exit code.
//
//   npx tsx src/detect.ts --url http://localhost:4173 \
//     --out curbfix-out/violations.json --screenshot curbfix-out/iteration-1.png
//
// Exit codes (the workflow depends on them):
//   0 = clean (nothing to fix), 2 = violations found, 1 = error.
// Violations listed in out-of-scope.json (written by Tool 2 next to --out) are
// kept in the output with outOfScope: true but do not count for exit code 2.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { markOutOfScope, readOutOfScope } from "./outOfScope.js";
import { scanPage } from "./scan.js";
import { EXIT_CLEAN, EXIT_VIOLATIONS, type DetectOutput } from "./types.js";

const EXIT_ERROR = 1;

const USAGE = `Usage: detect --url <url> [--out <file>] [--screenshot <file>]

  --url         page to audit, e.g. http://localhost:4173   (required)
  --out         where to write the JSON result              (default: curbfix-out/violations.json)
  --screenshot  where to save a screenshot of the page      (optional)
  --help        show this message

Exit codes: 0 = clean, 2 = violations found, 1 = error`;

function fail(message: string): number {
	console.error(`detect: ${message}`);
	return EXIT_ERROR;
}

function parseUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

async function main(): Promise<number> {
	let values;
	try {
		({ values } = parseArgs({
			options: {
				url: { type: "string" },
				out: { type: "string", default: "curbfix-out/violations.json" },
				screenshot: { type: "string" },
				help: { type: "boolean", short: "h" },
			},
		}));
	} catch (err) {
		console.error(USAGE);
		return fail((err as Error).message);
	}

	if (values.help) {
		console.log(USAGE);
		return EXIT_CLEAN;
	}
	if (!values.url) {
		console.error(USAGE);
		return fail("missing --url");
	}
	const url = parseUrl(values.url);
	if (!url) return fail(`"${values.url}" is not a valid http(s) URL`);

	const out = values.out!;
	// Drop any result from a previous round so a failed scan can never be
	// mistaken for fresh data by the next tool in the loop.
	await rm(out, { force: true });

	let result;
	try {
		result = await scanPage(url, { screenshotPath: values.screenshot });
	} catch (err) {
		return fail(`scan of ${url} failed: ${(err as Error).message}`);
	}

	let outOfScope: Set<string>;
	try {
		outOfScope = await readOutOfScope(join(dirname(out), "out-of-scope.json"));
	} catch (err) {
		return fail(`cannot read out-of-scope.json: ${(err as Error).message}`);
	}

	const output: DetectOutput = {
		url: result.url,
		scannedAt: new Date().toISOString(),
		violations: markOutOfScope(result.violations, outOfScope),
	};
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, JSON.stringify(output, null, 2) + "\n");

	const inScope = output.violations.filter((v) => !v.outOfScope);
	const skipped = output.violations.length - inScope.length;
	const note = skipped ? ` (${skipped} more out of scope for this PR)` : "";
	if (inScope.length === 0) {
		console.log(`No violations to fix on ${output.url}${note}`);
		return EXIT_CLEAN;
	}

	const byRule = new Map<string, number>();
	for (const v of inScope)
		byRule.set(v.ruleId, (byRule.get(v.ruleId) ?? 0) + 1);
	console.log(`Found ${inScope.length} violation(s) on ${output.url}${note}:`);
	for (const [rule, n] of byRule) console.log(`  ${rule}: ${n}`);
	console.log(`Written to ${out}`);
	return EXIT_VIOLATIONS;
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error(err);
		process.exit(EXIT_ERROR);
	},
);
