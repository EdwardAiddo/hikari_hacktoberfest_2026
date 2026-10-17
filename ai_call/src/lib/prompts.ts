// Build prompts from the templates in src/prompts. PR content (source files,
// HTML snippets, axe messages) is wrapped in blocks delimited by a random
// nonce, so the content cannot close its own block and pose as instructions.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuredOutput } from "./config.ts";
import type { Attempt } from "./history.ts";
import type { SourceFile } from "./mapping.ts";
import { PROPOSE_EDITS_SCHEMA_TEXT } from "./propose.ts";
import type { Impact } from "./schema.ts";

const PROMPT_DIR = join(import.meta.dirname, "..", "prompts");
const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(join(PROMPT_DIR, `${name}.md`), "utf8");
    cache.set(name, text);
  }
  return text;
}

/**
 * Replace `{{key}}` placeholders in one pass, so placeholder-like text inside
 * substituted values is never expanded. Unknown placeholders are an error.
 */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt placeholder {{${key}}} has no value`);
    return value;
  });
}

export function newNonce(): string {
  return randomBytes(8).toString("hex");
}

/** A data block. `attrs` values are JSON-quoted so they cannot break the header line. */
export function dataBlock(nonce: string, kind: string, content: string, attrs: Record<string, string> = {}): string {
  const header = Object.entries(attrs)
    .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`)
    .join("");
  return `<<<DATA ${nonce} kind=${kind}${header}>>>\n${content}\n<<<END ${nonce}>>>`;
}

export interface PromptViolation {
  /** Short id scoped to one call: v1, v2… */
  id: string;
  ruleId: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  target: string[];
  html: string;
  failureSummary: string;
  /** axe check data; for color-contrast: fgColor, bgColor, contrastRatio, expectedContrastRatio. */
  data?: Record<string, unknown>;
  /** Set for page-level rules mapped to the page component that renders this URL. */
  pageUrl?: string;
  attempts: Attempt[];
}

const CONTRAST_KEYS = ["fgColor", "bgColor", "contrastRatio", "expectedContrastRatio", "fontSize", "fontWeight"];

/** Measured facts from axe, one per line. Only known scalar keys, so the block stays small. */
function renderData(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  return CONTRAST_KEYS.filter((k) => typeof data[k] === "string" || typeof data[k] === "number").map(
    (k) => `${k}: ${String(data[k])}`,
  );
}

function renderViolation(v: PromptViolation, nonce: string): string {
  const lines = [
    `### ${v.id}: ${v.ruleId} (${v.impact ?? "unknown impact"})`,
    "",
    `Rule: ${v.help} (${v.helpUrl})`,
    "",
    "Element selector, rendered HTML and axe failure summary:",
    "",
    ...(v.pageUrl
      ? [
          `This rule is about the whole page at ${v.pageUrl}. Its <html> element comes from a layout that this ` +
            "pull request did not change, so fix it inside the page component below (for example, make the " +
            "page's main title a real heading element).",
          "",
        ]
      : []),
    dataBlock(
      nonce,
      "element",
      [`selector: ${v.target.join(" >>> ")}`, `html: ${v.html}`, ...renderData(v.data), "", v.failureSummary].join("\n"),
    ),
  ];
  if (v.attempts.length > 0) {
    lines.push("", "Previous attempts that did not fix it (do not repeat them):", "");
    for (const a of v.attempts) {
      const edits = a.edits.length
        ? a.edits.map((e) => `- in ${e.file}: replaced ${JSON.stringify(e.oldStr)} with ${JSON.stringify(e.newStr)}`).join("\n")
        : "- no edit applied";
      lines.push(dataBlock(nonce, "previous-attempt", `round ${a.round}, ${a.status}: ${a.reason}\n${edits}`));
    }
  }
  return lines.join("\n");
}

function renderFiles(files: SourceFile[], nonce: string): string {
  return files.map((f) => `### ${f.rel}\n\n${dataBlock(nonce, "file", f.content, { path: f.rel })}`).join("\n\n");
}

export interface FixPrompt {
  system: string;
  user: string;
  /** Builds the repair prompt for proposeEdits. */
  repair: (error: string, previous: string) => string;
}

export function buildFixPrompt(opts: {
  violations: PromptViolation[];
  files: SourceFile[];
  mode: StructuredOutput;
  nonce?: string;
}): FixPrompt {
  const nonce = opts.nonce ?? newNonce();
  const violations = opts.violations.map((v) => renderViolation(v, nonce)).join("\n\n");
  const files = renderFiles(opts.files, nonce);
  const output =
    opts.mode === "function"
      ? loadPrompt("output-function")
      : render(loadPrompt("output-json"), { schema: PROPOSE_EDITS_SCHEMA_TEXT });

  const system = render(loadPrompt("system"), { nonce });
  const user = render(loadPrompt("fix-file"), { violations, files, output });
  const repair = (error: string, previous: string) =>
    render(loadPrompt("repair"), {
      request: render(loadPrompt("fix-file"), { violations, files, output: "See the end of this message." }),
      nonce,
      error,
      previous,
      schema: PROPOSE_EDITS_SCHEMA_TEXT,
    });
  return { system, user, repair };
}
