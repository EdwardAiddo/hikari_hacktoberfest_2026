// OWNER: person A (branch feature/detect-cli)
// CLI part of Tool 1: parse args, call scanPage, write violations.json, set exit code.
//
//   npx tsx src/detect.ts --url http://localhost:4173 --out curbfix-out/violations.json \
//     --screenshot curbfix-out/iteration-1.png
//
// Exit codes (the workflow depends on them): 0 = clean, 2 = violations found, 1 = error.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { scanPage } from "./scan.js";
import { EXIT_CLEAN, EXIT_VIOLATIONS, type DetectOutput } from "./types.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      out: { type: "string", default: "curbfix-out/violations.json" },
      screenshot: { type: "string" },
    },
  });

  if (!values.url) {
    console.error("Missing --url");
    return 1;
  }

  const result = await scanPage(values.url, { screenshotPath: values.screenshot });

  const output: DetectOutput = {
    url: result.url,
    scannedAt: new Date().toISOString(),
    violations: result.violations,
  };
  await mkdir(dirname(values.out!), { recursive: true });
  await writeFile(values.out!, JSON.stringify(output, null, 2));

  console.log(`Found ${output.violations.length} violation(s) on ${output.url}`);
  return output.violations.length === 0 ? EXIT_CLEAN : EXIT_VIOLATIONS;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
