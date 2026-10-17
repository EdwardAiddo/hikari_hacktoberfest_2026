// Parse args, call scanPage, write violations.json, set the exit code.
//
//   npx tsx src/detect.ts --url http://localhost:4173 \
//     --out curbfix-out/violations.json --screenshot curbfix-out/iteration-1.png
//
// Exit codes (the workflow depends on them):
//   0 = clean (nothing to fix), 2 = violations found, 1 = error.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
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
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
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

  const output: DetectOutput = {
    url: result.url,
    scannedAt: new Date().toISOString(),
    violations: result.violations,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(output, null, 2) + "\n");

  const count = output.violations.length;
  if (count === 0) {
    console.log(`No violations on ${output.url}`);
    return EXIT_CLEAN;
  }

  const byRule = new Map<string, number>();
  for (const v of output.violations) byRule.set(v.ruleId, (byRule.get(v.ruleId) ?? 0) + 1);
  console.log(`Found ${count} violation(s) on ${output.url}:`);
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
