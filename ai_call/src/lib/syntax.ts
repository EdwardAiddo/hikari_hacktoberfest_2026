// Parse checks run after edits are applied. fix.ts must never leave the tree
// unbuildable, so any file that fails here is reverted.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { parse, type ParserOptions } from "@babel/parser";

const execFileAsync = promisify(execFile);

type Plugins = NonNullable<ParserOptions["plugins"]>;

const BABEL_PLUGINS: Record<string, Plugins> = {
  // No "jsx" for .ts: `<T>(x) => x` would be read as a JSX tag.
  ".ts": ["typescript"],
  ".tsx": ["jsx", "typescript"],
  ".js": ["jsx"],
  ".jsx": ["jsx"],
};

function checkScript(code: string, plugins: Plugins): string | null {
  try {
    parse(code, { sourceType: "module", plugins, errorRecovery: false });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** Unbalanced braces/parens, unterminated strings or comments. */
export function checkCss(css: string): string | null {
  const stack: string[] = [];
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return "unterminated comment";
      i = end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      if (css[j] !== c) return `unterminated string at offset ${i}`;
      i = j;
    } else if (c === "{" || c === "(" || c === "[") {
      stack.push(c);
    } else if (c in pairs) {
      if (stack.pop() !== pairs[c]) return `unexpected "${c}" at offset ${i}`;
    }
  }
  return stack.length ? `unclosed "${stack.at(-1)}"` : null;
}

/**
 * HTML is forgiving, so only catch what an edit typically breaks: tags with
 * unbalanced quotes, unclosed comments, and broken <script>/<style> contents.
 */
export function checkHtml(html: string): string | null {
  const opens = html.split("<!--").length - 1;
  const closes = html.split("-->").length - 1;
  if (opens !== closes) return "unbalanced HTML comment";
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = checkSfc(withoutComments);
  if (blocks) return blocks;
  // `a<b` inside a script is not a tag.
  const markup = withoutComments.replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, "$1$3");
  for (const m of markup.matchAll(/<(\/?[a-zA-Z][\w-]*)/g)) {
    const rest = markup.slice(m.index);
    if (!/^<\/?[a-zA-Z][\w-]*(?:[^>"']|"[^"]*"|'[^']*')*>/.test(rest)) {
      return `malformed tag <${m[1]} at offset ${m.index}`;
    }
  }
  return null;
}

function checkBlocks(source: string, scriptRe: RegExp, styleRe: RegExp): string | null {
  for (const m of source.matchAll(scriptRe)) {
    const attrs = m[1] ?? "";
    if (/\bsrc=/.test(attrs) || /type=["']?(application\/(ld\+)?json|importmap)/.test(attrs)) continue;
    const ts = /lang=["']?ts/.test(attrs);
    const err = checkScript(m[2] ?? "", ts ? ["typescript"] : ["jsx"]);
    if (err) return `<script>: ${err}`;
  }
  for (const m of source.matchAll(styleRe)) {
    const err = checkCss(m[1] ?? "");
    if (err) return `<style>: ${err}`;
  }
  return null;
}

/** Vue and Svelte: check the script and style blocks; the template is checked like HTML tags. */
function checkSfc(source: string): string | null {
  return checkBlocks(source, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, /<style\b[^>]*>([\s\S]*?)<\/style>/gi);
}

/** Returns an error message, or null when the file parses. */
export function checkSyntax(path: string, content: string): string | null {
  const ext = extname(path);
  const plugins = BABEL_PLUGINS[ext];
  if (plugins) return checkScript(content, plugins);
  if (ext === ".css") return checkCss(content);
  if (ext === ".html") return checkHtml(content);
  if (ext === ".vue" || ext === ".svelte") return checkSfc(content);
  return `no parser for ${ext}`;
}

export interface TypecheckResult {
  errors: number;
  output: string;
}

/**
 * `tsc --noEmit -p <app>` with the app's own TypeScript, if it has a tsconfig
 * and TypeScript installed. Returns null when unavailable. Never installs anything.
 * GEMINI_API_KEY is removed from the environment; that only stops casual
 * exposure, it is not isolation (see CLAUDE.md, Security).
 */
export async function typecheckApp(appDir: string): Promise<TypecheckResult | null> {
  const tsc = join(appDir, "node_modules", ".bin", "tsc");
  try {
    await access(join(appDir, "tsconfig.json"));
    await access(tsc);
  } catch {
    return null;
  }
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  try {
    const { stdout } = await execFileAsync(tsc, ["--noEmit", "-p", appDir], {
      cwd: appDir,
      env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5 * 60_000,
    });
    return { errors: 0, output: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: unknown };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const errors = (output.match(/error TS\d+/g) ?? []).length;
    // Exit without reported errors means tsc itself failed; treat as unavailable.
    return errors > 0 ? { errors, output } : null;
  }
}
