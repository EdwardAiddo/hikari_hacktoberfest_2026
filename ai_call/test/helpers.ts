import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/**
 * A git repo with `base` files committed on main, then `head` files committed
 * on a branch, mimicking a PR checkout.
 */
export async function makeRepo(base: Record<string, string>, head: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "curbfix-repo-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "config", "commit.gpgsign", "false");
  await writeFiles(root, base);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base", "--allow-empty");
  git(root, "checkout", "-q", "-b", "pr");
  await writeFiles(root, head);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "head", "--allow-empty");
  return root;
}
