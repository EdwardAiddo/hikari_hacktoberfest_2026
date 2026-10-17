// The only module that talks to the Gemini API. Everything else depends on
// the LlmClient interface, so tests use FakeLlmClient with recorded responses.
import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import type { ThinkingSetting } from "./config.ts";

export interface FunctionSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: unknown;
}

export interface LlmRequest {
  system: string;
  user: string;
  /** When set, the model is required to call this function. */
  fn?: FunctionSpec;
}

export interface LlmResponse {
  /** Arguments of the call to `fn`, if the model made one. */
  functionArgs: Record<string, unknown> | null;
  /** Concatenated text parts (thoughts excluded). */
  text: string;
  finishReason: string | null;
}

export interface LlmClient {
  readonly model: string;
  /** HTTP attempts made so far, retries included. */
  readonly calls: number;
  generate(req: LlmRequest): Promise<LlmResponse>;
}

/** The per-run call cap was reached. Not fatal: remaining violations are skipped. */
export class LlmBudgetError extends Error {
  constructor(max: number) {
    super(`LLM call budget exhausted (CURBFIX_MAX_LLM_CALLS=${max})`);
    this.name = "LlmBudgetError";
  }
}

/** Bad configuration or API unreachable after retries. fix.ts exits non-zero. */
export class LlmFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmFatalError";
  }
}

/** The subset of the SDK that GeminiClient uses; lets tests inject a stub. */
export interface GenerateContentApi {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  temperature: number;
  thinking: ThinkingSetting;
  maxCalls: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  api?: GenerateContentApi;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const THINKING_LEVELS: Record<Exclude<ThinkingSetting, "off">, ThinkingLevel> = {
  high: ThinkingLevel.HIGH,
  minimal: ThinkingLevel.MINIMAL,
};

export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  // fetch failures (DNS, reset, timeout) surface as plain errors without a status.
  return err instanceof Error && !(err instanceof LlmFatalError) && !("status" in err);
}

/** Full jitter: uniform in [0, min(max, base * 2^attempt)]. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  return Math.round(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** Some models reject system instructions; detect the error so we can inline it instead. */
function rejectsSystemInstruction(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /system|developer instruction/i.test(err.message);
}

export class GeminiClient implements LlmClient {
  readonly model: string;
  #calls = 0;
  #inlineSystem = false;
  readonly #opts: Required<Omit<GeminiClientOptions, "api" | "apiKey">>;
  readonly #api: GenerateContentApi;

  constructor(opts: GeminiClientOptions) {
    this.model = opts.model;
    this.#api = opts.api ?? new GoogleGenAI({ apiKey: opts.apiKey }).models;
    this.#opts = {
      model: opts.model,
      temperature: opts.temperature,
      thinking: opts.thinking,
      maxCalls: opts.maxCalls,
      maxAttempts: opts.maxAttempts ?? 5,
      baseDelayMs: opts.baseDelayMs ?? 2_000,
      maxDelayMs: opts.maxDelayMs ?? 60_000,
      timeoutMs: opts.timeoutMs ?? 180_000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: opts.random ?? Math.random,
    };
  }

  get calls(): number {
    return this.#calls;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const o = this.#opts;
    let lastError: unknown;
    for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
      if (this.#calls >= o.maxCalls) throw new LlmBudgetError(o.maxCalls);
      this.#calls++;
      try {
        return toLlmResponse(await this.#api.generateContent(this.#params(req)), req.fn?.name);
      } catch (err) {
        lastError = err;
        if (!this.#inlineSystem && rejectsSystemInstruction(err)) {
          this.#inlineSystem = true;
          attempt--; // a configuration switch, not a failed attempt
          continue;
        }
        if (!isRetryable(err)) {
          throw new LlmFatalError(`Gemini API request failed: ${describe(err)}`);
        }
        if (attempt + 1 < o.maxAttempts) {
          const delay = backoffDelay(attempt, o.baseDelayMs, o.maxDelayMs, o.random);
          process.stderr.write(`::warning::Gemini API ${describe(err)}; retrying in ${delay} ms\n`);
          await o.sleep(delay);
        }
      }
    }
    throw new LlmFatalError(`Gemini API unreachable after ${o.maxAttempts} attempts: ${describe(lastError)}`);
  }

  #params(req: LlmRequest): GenerateContentParameters {
    const o = this.#opts;
    const config: GenerateContentConfig = {
      temperature: o.temperature,
      // Our own loop retries, so every HTTP attempt counts towards the budget.
      httpOptions: { timeout: o.timeoutMs, retryOptions: { attempts: 1 } },
    };
    if (o.thinking !== "off") config.thinkingConfig = { thinkingLevel: THINKING_LEVELS[o.thinking] };
    if (req.fn) {
      config.tools = [
        { functionDeclarations: [{ name: req.fn.name, description: req.fn.description, parametersJsonSchema: req.fn.parameters }] },
      ];
      config.toolConfig = {
        functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [req.fn.name] },
      };
    }
    let user = req.user;
    if (this.#inlineSystem) user = `${req.system}\n\n${req.user}`;
    else config.systemInstruction = req.system;
    return { model: o.model, contents: [{ role: "user", parts: [{ text: user }] }], config };
  }
}

export function toLlmResponse(res: GenerateContentResponse, fnName: string | undefined): LlmResponse {
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
  const call = fnName ? parts.find((p) => p.functionCall?.name === fnName)?.functionCall : undefined;
  return { functionArgs: call?.args ?? null, text, finishReason: candidate?.finishReason ?? null };
}

/** Error description safe to log: status and message only, never request data. */
function describe(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status}: ${err.message.slice(0, 300)}`;
  if (err instanceof Error) return err.message.slice(0, 300);
  return String(err);
}

/** Replays recorded responses in order. For tests and offline runs. */
export class FakeLlmClient implements LlmClient {
  readonly model = "fake";
  readonly requests: LlmRequest[] = [];
  #responses: (LlmResponse | Error)[];

  constructor(responses: (Partial<LlmResponse> | Error)[]) {
    this.#responses = responses.map((r) =>
      r instanceof Error ? r : { functionArgs: null, text: "", finishReason: "STOP", ...r },
    );
  }

  get calls(): number {
    return this.requests.length;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const next = this.#responses.shift();
    if (!next) throw new Error("FakeLlmClient: no recorded response left");
    if (next instanceof Error) throw next;
    return next;
  }
}
