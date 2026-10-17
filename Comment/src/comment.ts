// Tool 3: turn the loop's output files into one PR comment that is updated on every run.
//
//   npx tsx src/comment.ts --dir curbfix-out --status clean --pr 12
//   npx tsx src/comment.ts --dir curbfix-out --status unverified --dry-run
//
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name) unless --dry-run is used.
// Exit codes: 0 = comment posted/updated or intentionally skipped, 1 = error.
import { parseArgs } from "node:util";
import { isQuiet, MARKER, renderComment } from "./format.js";
import { findComment, upsertComment, type GithubTarget } from "./github.js";
import { loadRunData } from "./load.js";
import type { Status } from "./types.js";

const USAGE = `Usage: comment --dir <curbfix-out> --status <clean|unverified|error> --pr <number> [--dry-run]

  --dir      folder written by the detect/fix loop             (default: curbfix-out)
  --status   outcome of the loop                               (default: clean)
  --pr       pull request number                               (required unless --dry-run)
  --dry-run  print the comment instead of posting it
  --help     show this message`;

const STATUSES: Status[] = ["clean", "unverified", "error"];

function fail(message: string): number {
	console.error(`comment: ${message}`);
	return 1;
}

function runUrl(): string | undefined {
	const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
	return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
		? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
		: undefined;
}

async function main(): Promise<number> {
	let values;
	try {
		({ values } = parseArgs({
			options: {
				dir: { type: "string", default: "curbfix-out" },
				status: { type: "string", default: "clean" },
				pr: { type: "string" },
				"dry-run": { type: "boolean", default: false },
				help: { type: "boolean", short: "h" },
			},
		}));
	} catch (err) {
		console.error(USAGE);
		return fail((err as Error).message);
	}

	if (values.help) {
		console.log(USAGE);
		return 0;
	}
	if (!STATUSES.includes(values.status as Status)) {
		return fail(`--status must be one of: ${STATUSES.join(", ")}`);
	}
	const status = values.status as Status;
	const dryRun = values["dry-run"]!;

	let target: GithubTarget | null = null;
	if (!dryRun) {
		const pr = Number(values.pr);
		const repo = process.env.GITHUB_REPOSITORY;
		const token = process.env.GITHUB_TOKEN;
		if (!Number.isInteger(pr) || pr <= 0) return fail("missing or invalid --pr");
		if (!repo) return fail("GITHUB_REPOSITORY is not set");
		if (!token) return fail("GITHUB_TOKEN is not set");
		target = { repo, pr, token };
	}

	let data;
	try {
		data = await loadRunData(values.dir!);
	} catch (err) {
		if (status !== "error") return fail((err as Error).message);
		// the loop already failed; still tell the PR instead of going silent
		data = { initial: null, remaining: null, rounds: [] };
		console.error(`comment: ${(err as Error).message}`);
	}

	const body = renderComment(data, { status, runUrl: runUrl() });

	if (dryRun) {
		console.log(body);
		return 0;
	}

	// Nothing found and nothing posted before: stay quiet. If an earlier run
	// left a comment, update it so it does not claim problems that are gone.
	if (isQuiet(data, status) && (await findComment(target!, MARKER)) === null) {
		console.log("No violations and no earlier comment: nothing to post.");
		return 0;
	}

	const id = await upsertComment(target!, MARKER, body);
	console.log(`CurbFix comment ${id} updated on PR #${target!.pr}.`);
	return 0;
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
