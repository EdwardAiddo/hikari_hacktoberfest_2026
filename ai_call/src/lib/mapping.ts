// Map an axe node (rendered DOM: selector + HTML snippet) back to the source
// file that most likely produced it.
//
// Strategy (CLAUDE.md "Mapping strategy"):
//   1. Extract distinctive tokens from the node's root tag, its text and its
//      target selector: id, data-testid, classes, aria/alt/title/placeholder
//      values, role, visible text. Elements with none of these still have weak
//      tokens: asset src, inline style declarations, short symbols such as "×",
//      and width/height. Each weak token is worth less than MIN_SCORE on its
//      own, so a match needs several of them.
//   2. Search the markup candidate files (not CSS: CSS holds selectors, not
//      elements) for each token. A token found in n files contributes weight/n
//      to each, so tokens shared by many files count for little.
//   3. The highest score at or above MIN_SCORE wins. Otherwise the node is
//      out of scope.
// CSS candidates that style the node (by class or id), or that the winning
// file imports, are attached as related files so contrast fixes can land there.
import { dirname, extname, resolve } from "node:path";

export interface SourceFile {
  /** Absolute path. */
  path: string;
  /** Path shown to the model and written to fixes-N.json (relative to the repo root). */
  rel: string;
  content: string;
}

export type TokenKind = "id" | "attr" | "class" | "role" | "text" | "tag" | "asset" | "style";

export interface Token {
  kind: TokenKind;
  value: string;
  weight: number;
  /** Returns true when the token occurs in the given source. */
  test: (source: string) => boolean;
}

export const MIN_SCORE = 3;

const MARKUP_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js", ".html", ".vue", ".svelte"]);
const DOCUMENT_TAGS = new Set(["html", "head", "body", "title"]);
// Attributes whose values are author-written strings likely to appear verbatim in source.
const STRING_ATTRS: Record<string, number> = {
  "data-testid": 8,
  "data-test": 8,
  "data-cy": 8,
  name: 5,
  for: 5,
  "aria-label": 6,
  "aria-labelledby": 5,
  "aria-describedby": 5,
  alt: 6,
  title: 5,
  placeholder: 6,
  href: 3,
};
const MIN_TEXT_LENGTH = 4;
const MAX_TEXT_TOKENS = 4;
const MAX_SYMBOL_LENGTH = 3;
const SIZE_ATTRS = new Set(["width", "height"]);
const ASSET_ATTRS = new Set(["src", "poster"]);
const WEIGHT = { asset: 4, assetName: 3, symbol: 2, style: 1.5, size: 1 };
// Named entities for the symbols most often used as icon text.
const SYMBOL_ENTITIES: Record<string, string> = {
  "×": "times",
  "…": "hellip",
  "→": "rarr",
  "←": "larr",
  "↑": "uarr",
  "↓": "darr",
  "«": "laquo",
  "»": "raquo",
  "♥": "hearts",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `value` inside a single, double or backtick quoted string. */
function quoted(value: string): (source: string) => boolean {
  const v = escapeRegExp(value);
  const re = new RegExp(`(["'\`])${v}\\1`);
  return (source) => re.test(source);
}

/** Matches `value` as a whole class-like word (letters, digits, - and _ act as word characters). */
function word(value: string): (source: string) => boolean {
  const re = new RegExp(`(?<![\\w-])${escapeRegExp(value)}(?![\\w-])`);
  return (source) => re.test(source);
}

/** Matches `value` literally, tolerating different whitespace and line breaks. */
function looseText(value: string): (source: string) => boolean {
  const re = new RegExp(value.split(/\s+/).map(escapeRegExp).join("\\s+"));
  return (source) => re.test(source);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface ParsedTag {
  tag: string;
  attrs: Map<string, string>;
}

/** Parse the first opening tag of an HTML snippet. */
export function parseRootTag(html: string): ParsedTag | null {
  const m = /^\s*<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/.exec(html);
  if (!m) return null;
  const attrs = new Map<string, string>();
  const attrRe = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const a of (m[2] ?? "").matchAll(attrRe)) {
    const name = a[1]!.toLowerCase();
    attrs.set(name, decodeEntities(a[2] ?? a[3] ?? a[4] ?? ""));
  }
  return { tag: m[1]!.toLowerCase(), attrs };
}

function rawChunks(html: string): string[] {
  // Replace with a tag, not a space: the text around an icon is separate in source.
  const withoutHidden = html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "<hidden>");
  return withoutHidden
    .split(/<[^>]*>/)
    .map((t) => decodeEntities(t).replace(/\s+/g, " ").trim())
    // axe truncates long snippets with "..."; a chunk ending there is partial.
    .map((t) => t.replace(/\.\.\.$/, "").trim());
}

/** Visible text chunks of an HTML snippet, longest first. */
export function textChunks(html: string): string[] {
  const chunks = rawChunks(html).filter((t) => t.length >= MIN_TEXT_LENGTH && /[a-zA-Z]/.test(t));
  return [...new Set(chunks)].sort((a, b) => b.length - a.length).slice(0, MAX_TEXT_TOKENS);
}

/** Short non-ASCII symbol text such as "×" or "→", used as icon labels. */
export function symbolChunks(html: string): string[] {
  const chunks = rawChunks(html).filter(
    (t) => t.length > 0 && [...t].length <= MAX_SYMBOL_LENGTH && !/[\p{L}\p{N}]/u.test(t) && /[^\x00-\x7f]/.test(t),
  );
  return [...new Set(chunks)];
}

/** Matches a symbol written literally, as an HTML entity, or as a JS escape. */
function symbol(value: string): (source: string) => boolean {
  const forms = [...value].map((ch) => {
    const cp = ch.codePointAt(0)!;
    const hex = cp.toString(16);
    const alts = [escapeRegExp(ch), `&#${cp};`, `&#x0*${hex};`, `\\u${hex.padStart(4, "0")}`, `\\u\\{${hex}\\}`];
    const named = SYMBOL_ENTITIES[ch];
    if (named) alts.push(`&${named};`);
    return `(?:${alts.join("|")})`;
  });
  const re = new RegExp(forms.join(""), "i");
  return (source) => re.test(source);
}

/** `width="24"`, `width='24'`, `width={24}` or `width={"24"}`, but not `width={240}`. */
function sizeAttr(name: string, value: string): (source: string) => boolean {
  const v = escapeRegExp(value);
  const re = new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"${v}"|'${v}'|\\{\\s*${v}\\s*\\}|\\{\\s*["'\`]${v}["'\`]\\s*\\})`);
  return (source) => re.test(source);
}

/** Inline style declarations of the root tag, as [property, value] pairs. */
export function styleDeclarations(style: string): [string, string][] {
  const out: [string, string][] = [];
  // Split on ";" outside parentheses: url(...) and rgb(...) may contain separators.
  for (const decl of style.split(/;(?![^(]*\))/)) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (/^[a-z-]+$/.test(prop) && !prop.startsWith("--") && value) out.push([prop, value]);
  }
  return out;
}

/** The ways a browser-serialised rgb() colour may be written in source. */
function colourPattern(rgb: string): string {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(rgb);
  const literal = escapeRegExp(rgb).replace(/,\s*/g, ",\\s*").replace(/\\\(\s*/, "\\(\\s*");
  if (!m || (m[4] !== undefined && Number(m[4]) !== 1)) return literal;
  const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0"));
  const alts = [literal, `#${hex.join("")}`];
  if (hex.every((h) => h[0] === h[1])) alts.push(`#${hex.map((h) => h[0]).join("")}(?![0-9a-f])`);
  return `(?:${alts.join("|")})`;
}

/**
 * Matches one declaration in a React style object (`fontSize: '20px'`,
 * `width: 40`) or an HTML/Vue style attribute (`font-size: 20px`).
 */
function styleDecl(prop: string, value: string): (source: string) => boolean {
  const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const words = value.match(/rgba?\([^)]*\)|\S+/gi) ?? [];
  let pattern = words.map((w) => (/^rgba?\(/i.test(w) ? colourPattern(w) : escapeRegExp(w))).join("\\s+");
  // React adds "px" to bare numbers.
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (px) pattern = `(?:${pattern}|${escapeRegExp(px[1]!)})`;
  const props = camel === prop ? escapeRegExp(prop) : `${escapeRegExp(prop)}|${camel}`;
  const re = new RegExp(`(?<![\\w-])(?:${props})\\s*:\\s*["'\`]?\\s*${pattern}\\s*(?:["'\`;,}]|$)`, "im");
  return (source) => re.test(source);
}

/**
 * Asset tokens from a src value: the value itself, and for bundler output
 * such as Vite's `/assets/logo-BdF3x9Qa.png`, the source file name `logo.png`.
 */
function assetTokens(value: string): { value: string; weight: number; test: (s: string) => boolean }[] {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return [];
  const out = [{ value, weight: WEIGHT.asset, test: quoted(value) }];
  const name = value.split(/[?#]/)[0]!.split("/").pop() ?? "";
  const unhashed = name.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/i, "$1");
  if (/^[\w.-]+\.[a-z0-9]+$/i.test(unhashed) && unhashed.length >= 5 && unhashed !== value) {
    out.push({ value: unhashed, weight: WEIGHT.assetName, test: word(unhashed) });
  }
  return out;
}

/** Ids, classes and attribute values from the last compound selector of an axe target. */
export function selectorParts(selector: string): { ids: string[]; classes: string[]; attrs: [string, string][] } {
  const last = selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
  const ids = [...last.matchAll(/#((?:\\.|[\w-])+)/g)].map((m) => m[1]!.replace(/\\/g, ""));
  const classes = [...last.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1]!.replace(/\\/g, ""));
  const attrs = [...last.matchAll(/\[([\w-]+)=["']?([^"'\]]+)["']?\]/g)].map(
    (m) => [m[1]!.toLowerCase(), m[2]!] as [string, string],
  );
  return { ids, classes, attrs };
}

export function extractTokens(node: { html: string; target: string[] }): Token[] {
  const tokens = new Map<string, Token>();
  const add = (kind: TokenKind, value: string, weight: number, test: (s: string) => boolean) => {
    const key = `${kind}:${value}`;
    const existing = tokens.get(key);
    if (!existing || existing.weight < weight) tokens.set(key, { kind, value, weight, test });
  };

  const root = parseRootTag(node.html);
  const fromSelector = selectorParts(node.target.at(-1) ?? "");

  const ids = new Set(fromSelector.ids);
  const classes = new Set(fromSelector.classes);
  const attrs: [string, string][] = [...fromSelector.attrs];
  if (root) {
    const id = root.attrs.get("id");
    if (id) ids.add(id);
    for (const c of (root.attrs.get("class") ?? "").split(/\s+/)) if (c) classes.add(c);
    attrs.push(...root.attrs.entries());
    if (DOCUMENT_TAGS.has(root.tag)) {
      const re = new RegExp(`<${root.tag}[\\s>]`, "i");
      add("tag", root.tag, 5, (s) => re.test(s));
    }
  }

  for (const id of ids) add("id", id, 10, quoted(id));
  for (const c of classes) add("class", c, 3, word(c));
  for (const [name, value] of attrs) {
    if (name === "role" && value) add("role", value, 1, quoted(value));
    if (SIZE_ATTRS.has(name) && /^\d+(\.\d+)?%?$/.test(value)) {
      add("attr", `${name}=${value}`, WEIGHT.size, sizeAttr(name, value));
    }
    if (ASSET_ATTRS.has(name)) for (const a of assetTokens(value)) add("asset", a.value, a.weight, a.test);
    const weight = STRING_ATTRS[name];
    if (!weight || value.length < 2 || value === "#") continue;
    // aria-labelledby/-describedby hold id lists.
    const values = name.endsWith("edby") ? value.split(/\s+/) : [value];
    for (const v of values) add("attr", v, weight, v.length >= MIN_TEXT_LENGTH ? looseText(v) : quoted(v));
  }
  for (const chunk of textChunks(node.html)) add("text", chunk, 6, looseText(chunk));
  for (const chunk of symbolChunks(node.html)) add("text", chunk, WEIGHT.symbol, symbol(chunk));
  for (const [prop, value] of styleDeclarations(root?.attrs.get("style") ?? "")) {
    add("style", `${prop}: ${value}`, WEIGHT.style, styleDecl(prop, value));
  }

  return [...tokens.values()].sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));
}

export interface Located {
  file: SourceFile;
  score: number;
  matched: string[];
  related: SourceFile[];
}

export interface Unlocated {
  file: null;
  reason: string;
}

export function isMarkup(path: string): boolean {
  return MARKUP_EXTENSIONS.has(extname(path));
}

/** Locate a node in the candidate files. Pure: all file contents are passed in. */
export function locateNode(node: { html: string; target: string[] }, files: SourceFile[]): Located | Unlocated {
  const markup = files.filter((f) => isMarkup(f.path));
  if (markup.length === 0) return { file: null, reason: "no markup files changed in this PR" };

  const tokens = extractTokens(node);
  if (tokens.length === 0) return { file: null, reason: "no distinctive tokens in the element's HTML" };

  const scores = new Map<SourceFile, { score: number; matched: string[] }>();
  for (const token of tokens) {
    const hits = markup.filter((f) => token.test(f.content));
    for (const f of hits) {
      const entry = scores.get(f) ?? { score: 0, matched: [] };
      entry.score += token.weight / hits.length;
      entry.matched.push(`${token.kind}:${token.value}`);
      scores.set(f, entry);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[0].rel.localeCompare(b[0].rel));
  const best = ranked[0];
  if (!best || best[1].score < MIN_SCORE) {
    const tried = tokens.map((t) => `${t.kind}:${t.value}`).join(", ");
    return { file: null, reason: `element not found in files changed by this PR (searched for ${tried})` };
  }

  return { file: best[0], score: best[1].score, matched: best[1].matched, related: relatedCss(best[0], tokens, files) };
}

/** CSS candidates that style the node's classes or ids, or that `file` imports. */
export function relatedCss(file: SourceFile, tokens: Token[], files: SourceFile[]): SourceFile[] {
  const css = files.filter((f) => extname(f.path) === ".css");
  if (css.length === 0) return [];
  const selectors = tokens
    .filter((t) => t.kind === "class" || t.kind === "id")
    .map((t) => new RegExp(`${t.kind === "class" ? "\\." : "#"}${escapeRegExp(t.value)}(?![\\w-])`));
  const imported = new Set(
    [...file.content.matchAll(/(?:import\s+|@import\s+|href=)["']([^"']+\.css)["']/g)].map((m) =>
      resolve(dirname(file.path), m[1]!),
    ),
  );
  return css
    .filter((f) => imported.has(f.path) || selectors.some((re) => re.test(f.content)))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}
