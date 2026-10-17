// Turn one LLM exchange into validated edits. Preferred path: the model calls
// propose_edits. Fallback: JSON in the text. Either way, one repair retry.
import { z } from "zod";
import type { FunctionSpec, LlmClient } from "./llm.ts";
import type { StructuredOutput } from "./config.ts";
import { Edit } from "./schema.ts";

export const ProposeEditsArgs = z.object({
  edits: z.array(Edit).describe("Search/replace edits. Empty when nothing can be fixed safely."),
  skipped: z
    .array(
      z.object({
        violationId: z.string().describe("Id of the violation, e.g. v2."),
        reason: z.string().describe("Why it was not fixed."),
      }),
    )
    .default([])
    .describe("Violations left unfixed, with a reason."),
});
export type ProposeEditsArgs = z.infer<typeof ProposeEditsArgs>;

/**
 * Drop keywords the Gemini API does not list as supported for JSON Schema
 * (`$schema`, `default`); the defaults are applied by zod on our side.
 */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "$schema" && key !== "default")
      .map(([key, value]) => [key, geminiSchema(value)]),
  );
}

export const PROPOSE_EDITS: FunctionSpec = {
  name: "propose_edits",
  description: "Propose minimal search/replace edits that fix the listed accessibility violations.",
  parameters: geminiSchema(z.toJSONSchema(ProposeEditsArgs, { target: "draft-7", io: "input" })),
};

/** JSON Schema text for prompts that ask for JSON in the reply. */
export const PROPOSE_EDITS_SCHEMA_TEXT = JSON.stringify(PROPOSE_EDITS.parameters, null, 2);

export type ProposeResult = { ok: true; args: ProposeEditsArgs } | { ok: false; error: string };

/** Extract a JSON object from model text: fenced block first, else the outermost braces. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

function validate(raw: unknown): ProposeResult {
  const parsed = ProposeEditsArgs.safeParse(raw);
  return parsed.success ? { ok: true, args: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) };
}

function fromText(text: string): ProposeResult {
  if (!text.trim()) return { ok: false, error: "empty reply" };
  try {
    return validate(extractJson(text));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface ProposeRequest {
  system: string;
  user: string;
  /** Builds the repair prompt from the validation error and the previous reply. */
  repair: (error: string, previous: string) => string;
}

/**
 * Throws only what the client throws (budget, fatal). Invalid output after the
 * repair retry is returned as `{ ok: false }` so the caller can mark the
 * file's violations failed and continue.
 */
export async function proposeEdits(client: LlmClient, req: ProposeRequest, mode: StructuredOutput): Promise<ProposeResult> {
  const first = await client.generate({
    system: req.system,
    user: req.user,
    fn: mode === "function" ? PROPOSE_EDITS : undefined,
  });

  let result: ProposeResult;
  let previous: string;
  if (first.functionArgs) {
    result = validate(first.functionArgs);
    previous = JSON.stringify(first.functionArgs);
  } else {
    result = fromText(first.text);
    previous = first.text;
  }
  if (result.ok) return result;

  // The repair asks for plain JSON: if function calling misbehaved once, don't rely on it again.
  const repaired = await client.generate({ system: req.system, user: req.repair(result.error, previous) });
  const second = repaired.functionArgs ? validate(repaired.functionArgs) : fromText(repaired.text);
  return second.ok ? second : { ok: false, error: `invalid model output after repair: ${second.error}` };
}
