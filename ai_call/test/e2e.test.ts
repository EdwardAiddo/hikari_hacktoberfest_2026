// Runs the real fix.ts CLI and the real @google/genai SDK against a local stub
// of the Gemini REST API (the SDK honours GOOGLE_GEMINI_BASE_URL). No network.
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FixesFile, OutOfScopeFile, toJson, type DetectOutput } from "../src/lib/schema.ts";
import { makeRepo } from "./helpers.ts";

const BOT = resolve(import.meta.dirname, "..");
const TSX = join(BOT, "node_modules", ".bin", "tsx");

const APP_TSX = `export function App() {
  return (
    <main>
      <img src="/hero.png" className="hero-image" />
      <h1>Welcome to Acme</h1>
    </main>
  );
}
`;

// Exactly what Detect/src/detect.ts writes (DetectOutput in Detect/src/types.ts).
const violations: DetectOutput = {
  url: "http://localhost:4173/",
  scannedAt: "2026-10-17T12:00:00.000Z",
  violations: [
    {
      ruleId: "image-alt",
      impact: "critical",
      help: "Images must have alternate text",
      html: '<img src="/hero.png" class="hero-image">',
      target: ["img.hero-image"],
      failureSummary: "no alt",
    },
    {
      ruleId: "link-name",
      impact: "serious",
      help: "Links must have discernible text",
      html: '<a class="social" href="https://x.example"></a>',
      target: ["footer a.social"],
      failureSummary: "no text",
    },
  ],
};

interface Stub {
  server: Server;
  url: string;
  requests: { path: string; headers: IncomingMessage["headers"]; body: any }[];
}

async function startStub(handler: (body: any, res: ServerResponse) => void): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : null;
      requests.push({ path: req.url ?? "", headers: req.headers, body });
      handler(body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, requests };
}

let stub: Stub | null = null;
afterEach(() => {
  stub?.server.close();
  stub = null;
});

function runFix(cwd: string, env: Record<string, string>) {
  return new Promise<{ code: number; stderr: string }>((done) => {
    execFile(
      TSX,
      [join(BOT, "src", "fix.ts"), "--violations", "out/violations.json", "--history", "out/history", "--base", "main", "--app", "app", "--out", "out/fixes-1.json"],
      { cwd, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } },
      (err, _stdout, stderr) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stderr }),
    );
  });
}

async function prepare() {
  const repo = await makeRepo({ "app/src/App.tsx": "export function App() { return null; }\n" }, { "app/src/App.tsx": APP_TSX });
  await mkdir(join(repo, "out", "history"), { recursive: true });
  await writeFile(join(repo, "out", "violations.json"), toJson(violations));
  return repo;
}

describe("fix.ts end to end", () => {
  test("applies a fix through the real SDK and writes all outputs", async () => {
    stub = await startStub((_body, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "propose_edits",
                      args: {
                        edits: [
                          {
                            file: "app/src/App.tsx",
                            oldStr: 'className="hero-image" />',
                            newStr: 'className="hero-image" alt="" />',
                            ruleId: "image-alt",
                            violationId: "v1",
                            rationale: "The hero image is decorative.",
                          },
                        ],
                        skipped: [],
                      },
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
      );
    });
    const repo = await prepare();
    const summary = join(repo, "out", "summary.md");
    const result = await runFix(repo, {
      GEMINI_API_KEY: "test-key-not-real",
      GOOGLE_GEMINI_BASE_URL: stub.url,
      OUT_DIR: join(repo, "out"),
      GITHUB_STEP_SUMMARY: summary,
    });

    expect(result.stderr).not.toContain("test-key-not-real");
    expect(result.code).toBe(0);

    // Request shape as sent by the SDK.
    expect(stub.requests).toHaveLength(1);
    const req = stub.requests[0]!;
    expect(req.path).toMatch(/models\/gemma-4-31b-it:generateContent/);
    expect(req.body.tools[0].functionDeclarations[0].name).toBe("propose_edits");
    expect(req.body.toolConfig.functionCallingConfig.mode).toBe("ANY");
    expect(req.body.generationConfig.temperature).toBe(0.1);
    expect(req.body.generationConfig.thinkingConfig.thinkingLevel).toBe("MINIMAL");
    expect(JSON.stringify(req.body.contents)).toContain("hero-image");

    // Working tree edited in place, nothing committed.
    expect(await readFile(join(repo, "app/src/App.tsx"), "utf8")).toContain('alt=""');

    const fixes = FixesFile.parse(JSON.parse(await readFile(join(repo, "out", "fixes-1.json"), "utf8")));
    expect(fixes.round).toBe(1);
    expect(fixes.llmCalls).toBe(1);
    expect(fixes.records.map((r) => [r.fingerprint, r.status])).toEqual([
      ["image-alt|img.hero-image", "applied"],
      ["link-name|footer a.social", "out_of_scope"],
    ]);

    const oos = OutOfScopeFile.parse(JSON.parse(await readFile(join(repo, "out", "out-of-scope.json"), "utf8")));
    expect(oos.fingerprints.map((f) => f.fingerprint)).toEqual(["link-name|footer a.social"]);

    expect(result.stderr).toContain("::group::curbfix round 1 diff (1 file(s))");
    expect(result.stderr).toContain('+      <img src="/hero.png" className="hero-image" alt="" />');
    expect(await readFile(summary, "utf8")).toContain("### curbfix fix round 1");
  }, 30_000);

  test("exits 1 on a non-retryable API error and still writes fixes-N.json", async () => {
    stub = await startStub((_body, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" } }));
    });
    const repo = await prepare();
    const result = await runFix(repo, { GEMINI_API_KEY: "bad", GOOGLE_GEMINI_BASE_URL: stub.url });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/::error::curbfix fix round 1 stopped: Gemini API request failed: HTTP 400/);
    const fixes = FixesFile.parse(JSON.parse(await readFile(join(repo, "out", "fixes-1.json"), "utf8")));
    expect(fixes.error).toMatch(/HTTP 400/);
    expect(await readFile(join(repo, "app/src/App.tsx"), "utf8")).toBe(APP_TSX);
  }, 30_000);

  test("exits 1 on bad configuration", async () => {
    const repo = await prepare();
    const result = await runFix(repo, { CURBFIX_TEMPERATURE: "0.9" });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/invalid configuration/);
  }, 30_000);
});
