import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { describe, expect, test, vi } from "vitest";
import { loadConfig } from "../src/lib/config.ts";
import {
  FakeLlmClient,
  GeminiClient,
  LlmBudgetError,
  LlmFatalError,
  backoffDelay,
  isRetryable,
  type GenerateContentApi,
} from "../src/lib/llm.ts";
import { PROPOSE_EDITS, extractJson, proposeEdits } from "../src/lib/propose.ts";

const response = (parts: object[], finishReason = "STOP") =>
  ({ candidates: [{ content: { role: "model", parts }, finishReason }] }) as unknown as GenerateContentResponse;

function stubApi(results: (GenerateContentResponse | Error)[]) {
  const calls: GenerateContentParameters[] = [];
  const api: GenerateContentApi = {
    async generateContent(params) {
      calls.push(params);
      const next = results.shift();
      if (!next) throw new Error("no stub result left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { api, calls };
}

const client = (api: GenerateContentApi, extra: Partial<ConstructorParameters<typeof GeminiClient>[0]> = {}) =>
  new GeminiClient({
    apiKey: "test",
    model: "gemma-4-31b-it",
    temperature: 0.1,
    thinking: "minimal",
    maxCalls: 20,
    api,
    sleep: async () => {},
    random: () => 0.5,
    ...extra,
  });

const validArgs = {
  edits: [{ file: "a.tsx", oldStr: "<img", newStr: '<img alt=""', ruleId: "image-alt", rationale: "r" }],
};

describe("GeminiClient", () => {
  test("sends function calling, thinking and temperature config", async () => {
    const { api, calls } = stubApi([response([{ functionCall: { name: "propose_edits", args: validArgs } }])]);
    const res = await client(api).generate({ system: "sys", user: "hello", fn: PROPOSE_EDITS });
    expect(res.functionArgs).toEqual(validArgs);
    const config = calls[0]!.config!;
    expect(calls[0]!.model).toBe("gemma-4-31b-it");
    expect(config.temperature).toBe(0.1);
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
    expect(config.systemInstruction).toBe("sys");
    expect(config.toolConfig?.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["propose_edits"] });
    expect(config.httpOptions?.retryOptions).toEqual({ attempts: 1 });
  });

  test("omits thinking config when off", async () => {
    const { api, calls } = stubApi([response([{ text: "x" }])]);
    await client(api, { thinking: "off" }).generate({ system: "s", user: "u" });
    expect(calls[0]!.config!.thinkingConfig).toBeUndefined();
    expect(calls[0]!.config!.tools).toBeUndefined();
  });

  test("ignores thought parts in text", async () => {
    const { api } = stubApi([response([{ text: "thinking...", thought: true }, { text: "answer" }])]);
    expect((await client(api).generate({ system: "s", user: "u" })).text).toBe("answer");
  });

  test("retries 429 and 5xx with backoff, counting every attempt", async () => {
    const sleep = vi.fn(async () => {});
    const { api } = stubApi([
      new ApiError({ message: "rate limited", status: 429 }),
      new ApiError({ message: "unavailable", status: 503 }),
      response([{ text: "ok" }]),
    ]);
    const c = client(api, { sleep });
    expect((await c.generate({ system: "s", user: "u" })).text).toBe("ok");
    expect(c.calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("gives up after maxAttempts with a fatal error", async () => {
    const err = () => new ApiError({ message: "unavailable", status: 503 });
    const { api } = stubApi([err(), err(), err()]);
    await expect(client(api, { maxAttempts: 3 }).generate({ system: "s", user: "u" })).rejects.toThrow(
      /unreachable after 3 attempts/,
    );
  });

  test("does not retry other 4xx errors", async () => {
    const { api, calls } = stubApi([new ApiError({ message: "API key not valid", status: 400 })]);
    await expect(client(api).generate({ system: "s", user: "u" })).rejects.toBeInstanceOf(LlmFatalError);
    expect(calls).toHaveLength(1);
  });

  test("inlines the system prompt when the model rejects system instructions", async () => {
    const { api, calls } = stubApi([
      new ApiError({ message: "Developer instruction is not enabled for this model", status: 400 }),
      response([{ text: "ok" }]),
      response([{ text: "again" }]),
    ]);
    const c = client(api);
    await c.generate({ system: "SYS", user: "USER" });
    await c.generate({ system: "SYS", user: "USER" });
    expect(calls[1]!.config!.systemInstruction).toBeUndefined();
    expect(JSON.stringify(calls[1]!.contents)).toContain("SYS\\n\\nUSER");
    expect(calls[2]!.config!.systemInstruction).toBeUndefined();
  });

  test("enforces the call budget, retries included", async () => {
    const { api } = stubApi([new ApiError({ message: "x", status: 500 }), response([{ text: "ok" }])]);
    const c = client(api, { maxCalls: 1 });
    await expect(c.generate({ system: "s", user: "u" })).rejects.toBeInstanceOf(LlmBudgetError);
  });
});

describe("retry helpers", () => {
  test("isRetryable", () => {
    expect(isRetryable(new ApiError({ message: "", status: 429 }))).toBe(true);
    expect(isRetryable(new ApiError({ message: "", status: 500 }))).toBe(true);
    expect(isRetryable(new ApiError({ message: "", status: 404 }))).toBe(false);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  test("backoffDelay grows exponentially and is capped", () => {
    expect(backoffDelay(0, 1000, 10_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 10_000, () => 1)).toBe(8000);
    expect(backoffDelay(10, 1000, 10_000, () => 1)).toBe(10_000);
    expect(backoffDelay(3, 1000, 10_000, () => 0)).toBe(0);
  });
});

describe("proposeEdits", () => {
  const req = { system: "s", user: "u", repair: (e: string, p: string) => `REPAIR ${e} ${p}` };

  test("accepts a valid function call", async () => {
    const fake = new FakeLlmClient([{ functionArgs: validArgs }]);
    const result = await proposeEdits(fake, req, "function");
    expect(result).toEqual({ ok: true, args: { ...validArgs, skipped: [] } });
    expect(fake.requests[0]?.fn?.name).toBe("propose_edits");
  });

  test("falls back to JSON in text when no function call is made", async () => {
    const fake = new FakeLlmClient([{ text: "Here you go:\n```json\n" + JSON.stringify(validArgs) + "\n```" }]);
    expect((await proposeEdits(fake, req, "function")).ok).toBe(true);
    expect(fake.calls).toBe(1);
  });

  test("repairs once, without tools, then succeeds", async () => {
    const fake = new FakeLlmClient([{ functionArgs: { edits: [{ file: "a.tsx" }] } }, { text: JSON.stringify(validArgs) }]);
    const result = await proposeEdits(fake, req, "function");
    expect(result.ok).toBe(true);
    expect(fake.requests[1]?.fn).toBeUndefined();
    expect(fake.requests[1]?.user).toMatch(/^REPAIR .*oldStr/s);
  });

  test("reports failure after one repair", async () => {
    const fake = new FakeLlmClient([{ text: "no idea" }, { text: "still no" }]);
    const result = await proposeEdits(fake, req, "json");
    expect(result).toEqual({ ok: false, error: "invalid model output after repair: no JSON object in the reply" });
    expect(fake.requests[0]?.fn).toBeUndefined();
  });

  test("propagates budget errors", async () => {
    const fake = new FakeLlmClient([new LlmBudgetError(0)]);
    await expect(proposeEdits(fake, req, "function")).rejects.toBeInstanceOf(LlmBudgetError);
  });

  test("extractJson finds the outer object", () => {
    expect(extractJson('sure: {"a": {"b": 1}} done')).toEqual({ a: { b: 1 } });
  });
});

describe("loadConfig", () => {
  test("defaults", () => {
    expect(loadConfig({})).toMatchObject({
      model: "gemma-4-31b-it",
      maxLlmCalls: 20,
      temperature: 0.1,
      thinking: "minimal",
      structuredOutput: "function",
    });
  });

  test("empty strings count as unset", () => {
    expect(loadConfig({ GEMMA_MODEL: "", CURBFIX_MAX_LLM_CALLS: "" }).model).toBe("gemma-4-31b-it");
  });

  test("rejects out-of-range temperature and unknown thinking level", () => {
    expect(() => loadConfig({ CURBFIX_TEMPERATURE: "0.7" })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ CURBFIX_THINKING_LEVEL: "max" })).toThrow(/invalid configuration/);
  });
});
