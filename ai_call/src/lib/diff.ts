// Unified diffs between two in-memory versions of a file, via `git diff --no-index`.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function unifiedDiff(rel: string, before: string, after: string): Promise<string> {
  if (before === after) return "";
  const dir = await mkdtemp(join(tmpdir(), "curbfix-diff-"));
  try {
    await writeFile(join(dir, "a"), before);
    await writeFile(join(dir, "b"), after);
    const args = ["diff", "--no-index", "--no-color", "--no-ext-diff", "a", "b"];
    // Exit code 1 means "differences found".
    const stdout = await execFileAsync("git", args, { cwd: dir, maxBuffer: 32 * 1024 * 1024 }).then(
      (r) => r.stdout,
      (err: { code?: number; stdout?: string }) => {
        if (err.code === 1 && err.stdout !== undefined) return err.stdout;
        throw err;
      },
    );
    return stdout
      .replace(/^diff --git a\/a b\/b$/m, `diff --git a/${rel} b/${rel}`)
      .replace(/^--- a\/a$/m, `--- a/${rel}`)
      .replace(/^\+\+\+ b\/b$/m, `+++ b/${rel}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
