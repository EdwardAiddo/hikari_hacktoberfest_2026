// Which files fix.ts may read and edit. The deny list is a security control:
// files that run during the next build must never receive LLM output.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CANDIDATE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".html", ".vue", ".svelte", ".css"];

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
]);

const DENIED_DIRS = new Set([".github", "node_modules", "dist"]);

/** True when `child` is `parent` or inside it. Both must be absolute. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Pure path check. `absPath` and `appDir` are absolute. Returns a reason when
 * the file must not be edited, or null when it may be.
 */
export function denyReason(absPath: string, appDir: string): string | null {
  if (!isInside(appDir, absPath) || absPath === appDir) return "outside the app directory";
  const name = basename(absPath);
  const parts = relative(appDir, absPath).split(sep);
  if (parts.some((p) => DENIED_DIRS.has(p))) return "inside a protected directory";
  if (name === "package.json") return "package.json is protected";
  if (LOCKFILES.has(name)) return "lockfiles are protected";
  if (/^tsconfig.*\.json$/.test(name)) return "tsconfig files are protected";
  if (name.includes(".config.")) return "config files are protected";
  if (!CANDIDATE_EXTENSIONS.some((ext) => name.endsWith(ext))) return "extension not allowed";
  return null;
}

export async function gitRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

/**
 * Candidate files: added or modified by the PR inside the app, allowed by the
 * deny list, and not a symlink escaping the app. Returns absolute real paths
 * (symlinks in the repo location resolved, as git reports them), sorted.
 */
export async function listCandidateFiles(opts: { base: string; appDir: string; cwd: string }): Promise<string[]> {
  const root = await gitRoot(opts.cwd);
  const appDir = await realpath(resolve(opts.cwd, opts.appDir));
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", "-z", `${opts.base}...HEAD`, "--", relative(root, appDir) || "."],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  const out: string[] = [];
  for (const name of stdout.split("\0").filter(Boolean)) {
    const abs = resolve(root, name);
    if (denyReason(abs, appDir)) continue;
    // A symlink inside the app could point at a protected file.
    const real = await realpath(abs).catch(() => null);
    if (!real || denyReason(real, appDir)) continue;
    out.push(abs);
  }
  return out.sort();
}
