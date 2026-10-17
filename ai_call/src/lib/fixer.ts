// One fix round: decide what is in scope, group violations by source file,
// make one LLM call per file, apply the validated edits, and record an outcome
// for every violating node. No CLI, env or git here, so it is testable.
import type { StructuredOutput } from "./config.ts";
import { normaliseRel, planEdits, revertFiles, writePlan } from "./edits.ts";
import { failedRounds, shouldGiveUp, MAX_FAILED_ROUNDS, type History } from "./history.ts";
import { LlmBudgetError, LlmFatalError, type LlmClient } from "./llm.ts";
import type { Logger } from "./log.ts";
import { isPageLevel, locateByRoute, locateNode, relatedCss, type SourceFile } from "./mapping.ts";
import { buildFixPrompt, type PromptViolation } from "./prompts.ts";
import { proposeEdits } from "./propose.ts";
import type { Edit, FixRecord, OutOfScopeEntry, Violation, ViolationNode, ViolationsFile } from "./schema.ts";
import type { TypecheckResult } from "./syntax.ts";

/** Files larger than this are not sent to the model. */
export const MAX_FILE_CHARS = 100_000;

export interface RoundInput {
  violations: ViolationsFile;
  /** Candidate files with their current contents. Updated in place as edits land. */
  candidates: SourceFile[];
  history: History;
  /** Fingerprints recorded as out of scope by earlier rounds. */
  knownOutOfScope: Set<string>;
  /** null when no API key is configured; needing it is then a config error. */
  client: LlmClient | null;
  mode: StructuredOutput;
  /** Project-wide type check, run after each file group when available. */
  typecheck: (() => Promise<TypecheckResult | null>) | null;
  log: Logger;
}

export interface RoundOutput {
  records: FixRecord[];
  newOutOfScope: OutOfScopeEntry[];
  /** Files whose content changed during the round, with their content before it. */
  changed: { file: SourceFile; before: string }[];
  /** Set when the round stopped on a real error. Records so far are valid. */
  fatal: Error | null;
}

interface Item {
  violation: Violation;
  node: ViolationNode;
  /** Set when a page-level rule was mapped to the page component for this URL. */
  pageUrl?: string;
}

function record(item: Item, status: FixRecord["status"], reason: string, file: string | null = null, edits: Edit[] = []): FixRecord {
  return {
    fingerprint: item.node.fingerprint,
    ruleId: item.violation.ruleId,
    impact: item.violation.impact,
    target: item.node.target,
    status,
    reason,
    file,
    edits,
  };
}

interface Group {
  file: SourceFile;
  related: Set<SourceFile>;
  items: Item[];
}

export async function runRound(input: RoundInput): Promise<RoundOutput> {
  const { log } = input;
  const records: FixRecord[] = [];
  const newOutOfScope: OutOfScopeEntry[] = [];
  const original = new Map(input.candidates.map((f) => [f, f.content]));

  // 1. Scope decisions that need no model.
  const groups = new Map<SourceFile, Group>();
  const seen = new Set<string>();
  for (const violation of input.violations.violations) {
    for (const node of violation.nodes) {
      if (seen.has(node.fingerprint)) continue;
      seen.add(node.fingerprint);
      const item = { violation, node };

      if (node.outOfScope || input.knownOutOfScope.has(node.fingerprint)) {
        records.push(record(item, "out_of_scope", "marked out of scope in an earlier round"));
        continue;
      }
      const attempts = input.history.get(node.fingerprint);
      if (shouldGiveUp(attempts)) {
        const rounds = failedRounds(attempts).map((a) => a.round).join(", ");
        records.push(record(item, "failed", `still failing after ${MAX_FAILED_ROUNDS} attempts (rounds ${rounds}); not retried`));
        continue;
      }
      let located = locateNode(node, input.candidates);
      let pageLevel = false;
      if (!located.file && isPageLevel(node)) {
        const page = locateByRoute(node.url, input.candidates);
        if (page) {
          located = { file: page, score: 0, matched: ["route"], related: relatedCss(page, [], input.candidates) };
          pageLevel = true;
        }
      }
      if (!located.file) {
        records.push(record(item, "out_of_scope", located.reason));
        newOutOfScope.push({ fingerprint: node.fingerprint, ruleId: violation.ruleId, reason: located.reason });
        continue;
      }
      const group = groups.get(located.file) ?? { file: located.file, related: new Set(), items: [] };
      for (const r of located.related) group.related.add(r);
      group.items.push(pageLevel ? { ...item, pageUrl: node.url } : item);
      groups.set(located.file, group);
    }
  }

  // 2. One LLM call per source file.
  let baseline: TypecheckResult | null | undefined;
  let stop: { status: "skipped"; reason: string } | null = null;
  let fatal: Error | null = null;
  const ordered = [...groups.values()].sort((a, b) => a.file.rel.localeCompare(b.file.rel));

  for (const group of ordered) {
    if (stop) {
      for (const item of group.items) records.push(record(item, stop.status, stop.reason, group.file.rel));
      continue;
    }
    if (!input.client) {
      fatal = new LlmFatalError("GEMINI_API_KEY is not set, but there are violations to fix");
      stop = { status: "skipped", reason: "not attempted: fix.ts stopped on a configuration error" };
      for (const item of group.items) records.push(record(item, stop.status, stop.reason, group.file.rel));
      continue;
    }
    if (input.typecheck && baseline === undefined) baseline = await input.typecheck();

    try {
      records.push(...(await fixGroup(group, input.client, input, baseline ?? null)));
    } catch (err) {
      if (err instanceof LlmBudgetError) {
        log.warn(err.message);
        stop = { status: "skipped", reason: err.message };
      } else {
        fatal = err as Error;
        stop = { status: "skipped", reason: `not attempted: fix.ts stopped on an error (${(err as Error).message})` };
      }
      for (const item of group.items) records.push(record(item, stop.status, stop.reason, group.file.rel));
    }
  }

  const changed = [...original]
    .filter(([file, before]) => file.content !== before)
    .map(([file, before]) => ({ file, before }));
  records.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  newOutOfScope.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return { records, newOutOfScope, changed, fatal };
}

async function fixGroup(group: Group, client: LlmClient, input: RoundInput, baseline: TypecheckResult | null): Promise<FixRecord[]> {
  const { log } = input;
  const files = [group.file, ...[...group.related].filter((f) => f !== group.file).sort((a, b) => a.rel.localeCompare(b.rel))];
  const rel = group.file.rel;

  const tooLarge = files.find((f) => f.content.length > MAX_FILE_CHARS);
  if (tooLarge) {
    const reason = `${tooLarge.rel} is too large to send to the model (${tooLarge.content.length} > ${MAX_FILE_CHARS} characters)`;
    return group.items.map((item) => record(item, "failed", reason, rel));
  }

  const ids = new Map<string, Item>();
  const promptViolations: PromptViolation[] = group.items.map((item, i) => {
    const id = `v${i + 1}`;
    ids.set(id, item);
    return {
      id,
      ruleId: item.violation.ruleId,
      impact: item.violation.impact,
      help: item.violation.help,
      helpUrl: item.violation.helpUrl,
      target: item.node.target,
      html: item.node.html,
      failureSummary: item.node.failureSummary,
      data: item.node.data,
      pageUrl: item.pageUrl,
      attempts: failedRounds(input.history.get(item.node.fingerprint)),
    };
  });

  log.info(`curbfix: asking ${client.model} to fix ${group.items.length} violation(s) in ${rel}`);
  const prompt = buildFixPrompt({ violations: promptViolations, files, mode: input.mode });
  const result = await proposeEdits(client, prompt, input.mode);
  if (!result.ok) {
    log.warn(`${rel}: ${result.error}`);
    return group.items.map((item) => record(item, "failed", result.error, rel));
  }

  // Attribute each edit to the violations it claims to fix.
  const editsFor = new Map<Item, Edit[]>(group.items.map((item) => [item, []]));
  const attributed: Edit[] = [];
  for (const edit of result.args.edits) {
    const byId = edit.violationId ? ids.get(edit.violationId) : undefined;
    const targets = byId ? [byId] : group.items.filter((item) => item.violation.ruleId === edit.ruleId);
    if (targets.length === 0) {
      log.warn(`${rel}: dropped an edit for ${edit.ruleId}, which is not a listed violation`);
      continue;
    }
    for (const t of targets) editsFor.get(t)!.push(edit);
    attributed.push(edit);
  }

  const plan = planEdits(attributed, files);
  const before = files.map((file) => ({ file, previous: file.content }));
  await writePlan(plan);

  const fileErrors = new Map<string, string>();
  for (const fp of plan.files) if (fp.error) fileErrors.set(fp.file.rel, fp.error);
  for (const d of plan.disallowed) fileErrors.set(normaliseRel(d.edit.file), d.reason);
  for (const [file, error] of fileErrors) log.warn(`${file}: edits rejected: ${error}`);

  // Project-wide check: never leave the tree with more type errors than before.
  const touched = plan.files.some((fp) => fp.content !== null);
  if (touched && input.typecheck) {
    const after = await input.typecheck();
    if (after !== null && after.errors > (baseline?.errors ?? 0)) {
      await revertFiles(before);
      const reason = `edits reverted: tsc reported ${after.errors} error(s), ${baseline?.errors ?? 0} before`;
      log.warn(`${rel}: ${reason}`);
      log.group(`tsc output after edits to ${rel}`, after.output.slice(0, 20_000));
      return group.items.map((item) => record(item, "failed", reason, rel, editsFor.get(item)));
    }
  }

  const skipped = new Map(result.args.skipped.map((s) => [s.violationId, s.reason]));
  return group.items.map((item) => {
    const edits = editsFor.get(item)!;
    const id = [...ids].find(([, it]) => it === item)![0];
    if (edits.length === 0) {
      return record(item, "skipped", skipped.get(id) ?? "the model proposed no edit", rel);
    }
    const errors = [...new Set(edits.map((e) => fileErrors.get(normaliseRel(e.file))).filter((e): e is string => !!e))];
    if (errors.length > 0) return record(item, "failed", `edits rejected: ${errors.join("; ")}`, rel, edits);
    return record(item, "applied", edits.map((e) => e.rationale).join(" "), rel, edits);
  });
}
