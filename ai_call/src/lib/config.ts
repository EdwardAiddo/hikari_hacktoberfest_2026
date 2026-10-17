// Environment configuration for fix.ts. Invalid values are a real error (exit 1).
import { z } from "zod";

export const ThinkingSetting = z.enum(["high", "minimal", "off"]);
export type ThinkingSetting = z.infer<typeof ThinkingSetting>;

export const StructuredOutput = z.enum(["function", "json"]);
export type StructuredOutput = z.infer<typeof StructuredOutput>;

const Env = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMMA_MODEL: z.string().min(1).default("gemma-4-31b-it"),
  CURBFIX_MAX_LLM_CALLS: z.coerce.number().int().min(0).default(20),
  CURBFIX_TEMPERATURE: z.coerce.number().min(0).max(0.2).default(0.1),
  // Default is a guess until measured on the demo-app fixtures (see PROGRESS.md).
  CURBFIX_THINKING_LEVEL: ThinkingSetting.default("minimal"),
  CURBFIX_STRUCTURED_OUTPUT: StructuredOutput.default("function"),
  OUT_DIR: z.string().min(1).optional(),
  GITHUB_STEP_SUMMARY: z.string().min(1).optional(),
});

export interface FixConfig {
  apiKey: string | undefined;
  model: string;
  maxLlmCalls: number;
  temperature: number;
  thinking: ThinkingSetting;
  structuredOutput: StructuredOutput;
  outDir: string | undefined;
  stepSummary: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FixConfig {
  // Treat empty strings as unset, as GitHub Actions passes unset vars as "".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) throw new Error(`invalid configuration: ${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  return {
    apiKey: e.GEMINI_API_KEY,
    model: e.GEMMA_MODEL,
    maxLlmCalls: e.CURBFIX_MAX_LLM_CALLS,
    temperature: e.CURBFIX_TEMPERATURE,
    thinking: e.CURBFIX_THINKING_LEVEL,
    structuredOutput: e.CURBFIX_STRUCTURED_OUTPUT,
    outDir: e.OUT_DIR,
    stepSummary: e.GITHUB_STEP_SUMMARY,
  };
}
