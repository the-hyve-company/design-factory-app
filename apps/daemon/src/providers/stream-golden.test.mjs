// stream-golden.test.mjs — audit WS3 `provider-stream-golden-fixtures`.
//
// One native stream fixture per provider → real parser → normalized DF
// SSE events. Before this suite, the only per-provider "parser test" was
// contract.test.mjs's source grep — nothing executed the parsers.
//
// Fixture provenance (honesty note): the fixtures are REPRESENTATIVE
// reconstructions of the native shapes, assembled from the event
// vocabularies the adapters were verified against live (per-adapter
// source comments: kimi-cli 1.41.0 · opencode 1.15.0 · codex exec
// --json thread/turn/item envelope · gemini stream-json · claude
// stream-json with --include-partial-messages · Anthropic Messages SSE ·
// OpenAI chat.completion.chunk · Ollama /api/chat NDJSON). They are not
// raw byte captures — no live CLI/API credentials exist in CI. When a
// live capture diverges from a fixture, update the fixture AND the
// parser together.
//
// Parser entry points:
//   claude / codex / gemini  → stream-wirers.mjs (fake child process)
//   anthropic                → adapter + real pipeAnthropicStream (fetch stub)
//   openai/openrouter/gemini-api → adapter (fetch stub)
//   ollama                   → adapter (fetch stub incl. host/caps probes)
//   kimi / opencode          → adapter (deps.spawn fake child)

import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  wireStreamJson,
  wireCodexJson,
  wireGeminiJson,
  pipeAnthropicStream,
} from "../stream-wirers.mjs";
import anthropic from "./anthropic.mjs";
import openai from "./openai.mjs";
import openrouter from "./openrouter.mjs";
import geminiApi from "./gemini-api.mjs";
import ollama from "./ollama.mjs";
import kimi from "./kimi.mjs";
import opencode from "./opencode.mjs";
import { _resetOllamaHostCache, _resetModelCapsCache } from "./ollama-host.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "__fixtures__", "streams");

function fixture(name) {
  return readFileSync(join(FIXTURES, name), "utf8");
}

// ─── Harness fakes ───────────────────────────────────────────────────────

/** Minimal child-process double the wirers/adapters consume. */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = { write() {}, end() {} };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

/** Feed an NDJSON/JSONL fixture through stdout in uneven chunks (exercises
 *  the line-buffering), then close the child. */
function feedChild(child, ndjson, exitCode = 0) {
  const mid = Math.floor(ndjson.length / 3) || 1;
  child.stdout.emit("data", ndjson.slice(0, mid));
  child.stdout.emit("data", ndjson.slice(mid));
  child.emit("close", exitCode);
}

/** Collects the SSE the parser writes and resolves when the stream ends. */
function makeFakeRes() {
  let buffer = "";
  let resolveEnd;
  const ended = new Promise((r) => {
    resolveEnd = r;
  });
  return {
    headersSent: false,
    writeHead() {
      this.headersSent = true;
    },
    flushHeaders() {},
    write(chunk) {
      buffer += chunk;
      return true;
    },
    end() {
      resolveEnd();
    },
    ended,
    frames() {
      return buffer
        .split("\n\n")
        .filter((f) => f.trim())
        .map((f) => {
          let event = "message";
          let dataStr = "";
          for (const line of f.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          return { event, data: dataStr ? JSON.parse(dataStr) : null };
        });
    },
  };
}

function makeFakeReq() {
  return new EventEmitter();
}

/** deps bag for adapter-level runs. */
function makeDeps(body, extra = {}) {
  return {
    readJson: async () => body,
    imagePathInScope: () => false,
    ...extra,
  };
}

function eventsOf(frames, type) {
  return frames.filter((f) => f.event === type);
}
function textOf(frames) {
  return eventsOf(frames, "text")
    .map((f) => f.data.content)
    .join("");
}
/** Every parser must end with EXACTLY one terminal event (done | error). */
function expectSingleTerminal(frames, kind = "done") {
  const terminals = frames.filter((f) => f.event === "done" || f.event === "error");
  expect(terminals).toHaveLength(1);
  expect(terminals[0].event).toBe(kind);
  expect(frames[frames.length - 1].event).toBe(kind);
  return terminals[0];
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _resetOllamaHostCache();
  _resetModelCapsCache();
});

// ─── CLI wirers (claude / codex / gemini) ────────────────────────────────

describe("golden: claude — wireStreamJson", () => {
  it("normalizes session/meta/text/tool_call/tool_result/usage/result/done", async () => {
    const child = makeFakeChild();
    const res = makeFakeRes();
    wireStreamJson(child, res);
    feedChild(child, fixture("claude.stream-json.ndjson"));
    await res.ended;
    const frames = res.frames();

    expect(eventsOf(frames, "session")[0].data).toEqual({ sessionId: "sess-claude-001" });
    expect(eventsOf(frames, "meta")[0].data.model).toBe("claude-opus-4-8");
    // Deltas streamed once — the final assistant wrapper must NOT re-emit
    // (the dedup that motivated currentStreamMessageId).
    expect(textOf(frames)).toBe("Building the page now.");
    const calls = eventsOf(frames, "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toMatchObject({
      id: "toolu_01",
      name: "Write",
      input: { file_path: "projects/demo/index.html" },
    });
    expect(eventsOf(frames, "tool_result")[0].data).toMatchObject({
      id: "toolu_01",
      isError: false,
      content: "File written",
    });
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({ outputTokens: 450 });
    expect(eventsOf(frames, "result")[0].data).toMatchObject({
      durationMs: 5000,
      costUsd: 0.12,
    });
    expectSingleTerminal(frames);
  });
});

describe("golden: codex — wireCodexJson", () => {
  it("normalizes session(thread_id)/meta/Bash/file_change/text/usage/done", async () => {
    const child = makeFakeChild();
    const res = makeFakeRes();
    wireCodexJson(child, res);
    feedChild(child, fixture("codex.exec-json.ndjson"));
    await res.ended;
    const frames = res.frames();

    // Resume parity: thread_id surfaces as the canonical session event.
    expect(eventsOf(frames, "session")[0].data).toEqual({
      sessionId: "0197a1b2-c3d4-4e5f-8a9b-codexthread1",
    });
    expect(eventsOf(frames, "meta")[0].data.model).toBe("gpt-5.5");
    const calls = eventsOf(frames, "tool_call");
    expect(calls.map((c) => c.data.name)).toEqual(["Bash", "Edit"]);
    expect(calls[1].data.input).toEqual({ file_path: "projects/demo/index.html" });
    const results = eventsOf(frames, "tool_result");
    expect(results[0].data).toMatchObject({ id: "item_0", isError: false, content: "index.html" });
    expect(results[1].data).toMatchObject({ id: "item_1", isError: false });
    expect(textOf(frames)).toBe("Página atualizada com a nova paleta.");
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      inputTokens: 900,
      outputTokens: 300,
      cacheReadTokens: 100,
    });
    expectSingleTerminal(frames);
  });
});

describe("golden: gemini — wireGeminiJson", () => {
  it("normalizes session(init)/meta/text/write_file→Write/usage/done", async () => {
    const child = makeFakeChild();
    const res = makeFakeRes();
    wireGeminiJson(child, res);
    feedChild(child, fixture("gemini.stream-json.ndjson"));
    await res.ended;
    const frames = res.frames();

    expect(eventsOf(frames, "session")[0].data).toEqual({ sessionId: "gem-sess-42" });
    expect(eventsOf(frames, "meta")[0].data.model).toBe("gemini-3.5-flash");
    expect(textOf(frames)).toBe("Aqui está o layout. Arquivo gravado.");
    expect(eventsOf(frames, "tool_call")[0].data).toMatchObject({
      id: "g-tool-1",
      name: "Write",
      input: { file_path: "projects/demo/index.html" },
    });
    expect(eventsOf(frames, "tool_result")[0].data).toMatchObject({
      id: "g-tool-1",
      isError: false,
      content: "ok",
    });
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      inputTokens: 700,
      outputTokens: 250,
      cacheReadTokens: 50,
    });
    expectSingleTerminal(frames);
  });
});

// ─── API adapters (fetch stub) ───────────────────────────────────────────

async function runFetchAdapter(adapter, body, deps, fetchImpl) {
  globalThis.fetch = fetchImpl;
  const req = makeFakeReq();
  const res = makeFakeRes();
  await adapter.stream(req, res, deps);
  await res.ended;
  return res.frames();
}

describe("golden: anthropic — adapter + pipeAnthropicStream", () => {
  it("normalizes Messages-API SSE into meta/text/usage/done", async () => {
    const frames = await runFetchAdapter(
      anthropic,
      { prompt: "build it", systemPrompt: "sys", model: "claude-sonnet-4-6" },
      makeDeps(
        { prompt: "build it", systemPrompt: "sys", model: "claude-sonnet-4-6" },
        { getAnthropicToken: async () => "sk-ant-test", pipeAnthropicStream },
      ),
      async () => new Response(fixture("anthropic.sse.txt"), { status: 200 }),
    );
    expect(eventsOf(frames, "meta")[0].data.model).toBe("claude-sonnet-4-6");
    expect(textOf(frames)).toContain("Feito. ");
    expect(textOf(frames)).toContain('<artifact identifier="projects/demo/index.html"');
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      inputTokens: 2000,
      outputTokens: 420,
      stopReason: "end_turn",
    });
    const done = expectSingleTerminal(frames);
    expect(done.data.content).toContain("</artifact>");
  });
});

const OPENAI_COMPAT = [
  {
    name: "openai",
    adapter: openai,
    fixtureFile: "openai.sse.txt",
    model: "gpt-5.5",
    deps: { getOpenaiToken: async () => "sk-test" },
    text: "Pronto. ",
    usage: { inputTokens: 1500, outputTokens: 380 },
  },
  {
    name: "openrouter",
    adapter: openrouter,
    fixtureFile: "openrouter.sse.txt",
    model: "google/gemini-2.5-flash",
    deps: { getOpenrouterToken: async () => "sk-or-test" },
    text: "Segue o design. ",
    usage: { inputTokens: 1100, outputTokens: 290 },
  },
  {
    name: "gemini-api",
    adapter: geminiApi,
    fixtureFile: "gemini-api.sse.txt",
    model: "gemini-3.5-flash",
    deps: { getGeminiApiToken: async () => "AIza-test" },
    text: "Layout pronto. ",
    usage: { inputTokens: 950, outputTokens: 260 },
  },
];

for (const p of OPENAI_COMPAT) {
  describe(`golden: ${p.name} — OpenAI-compatible SSE adapter`, () => {
    it("normalizes chunk deltas into meta/text/usage/result/done", async () => {
      const body = { prompt: "build it", systemPrompt: "sys", model: p.model };
      const frames = await runFetchAdapter(
        p.adapter,
        body,
        makeDeps(body, p.deps),
        async () => new Response(fixture(p.fixtureFile), { status: 200 }),
      );
      expect(eventsOf(frames, "meta")[0].data.model).toBe(p.model);
      expect(textOf(frames)).toContain(p.text);
      expect(textOf(frames)).toContain('<artifact identifier="projects/demo/index.html"');
      expect(eventsOf(frames, "usage")[0].data).toMatchObject(p.usage);
      expect(eventsOf(frames, "result")).toHaveLength(1);
      const done = expectSingleTerminal(frames);
      expect(done.data.content).toContain("</artifact>");
    });
  });
}

describe("golden: ollama — NDJSON chat adapter", () => {
  it("normalizes /api/chat NDJSON into text/usage/done", async () => {
    const body = { prompt: "build it", systemPrompt: "sys", model: "llama3.2" };
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), { status: 200 });
      }
      if (u.endsWith("/api/show")) {
        return new Response(
          JSON.stringify({
            capabilities: ["completion"],
            model_info: { "llama.context_length": 8192 },
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/chat")) {
        return new Response(fixture("ollama.chat.ndjson"), { status: 200 });
      }
      throw new Error(`unexpected fetch in ollama golden test: ${u}`);
    };
    const frames = await runFetchAdapter(ollama, body, makeDeps(body), fetchImpl);
    expect(textOf(frames)).toContain("Aqui vai. ");
    expect(textOf(frames)).toContain('<artifact identifier="projects/demo/index.html"');
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      prompt_tokens: 50,
      completion_tokens: 120,
      total_tokens: 170,
    });
    const done = expectSingleTerminal(frames);
    expect(done.data.content).toContain("</artifact>");
  });
});

// ─── CLI adapters that parse inline (deps.spawn fake) ────────────────────

describe("golden: kimi — stream-json JSONL adapter", () => {
  it("normalizes text blocks + tool_calls variant B + role:tool results", async () => {
    const child = makeFakeChild();
    const body = { prompt: "build it", systemPrompt: "sys", model: "kimi-k2.6" };
    const req = makeFakeReq();
    const res = makeFakeRes();
    await kimi.stream(req, res, makeDeps(body, { spawn: () => child }));
    feedChild(child, fixture("kimi.stream-json.jsonl"));
    await res.ended;
    const frames = res.frames();

    expect(eventsOf(frames, "meta")[0].data.model).toBe("kimi-k2.6");
    // think blocks stay out of the chat; text blocks concatenate.
    expect(textOf(frames)).toBe("Criando o arquivo. Feito.");
    expect(eventsOf(frames, "tool_call")[0].data).toMatchObject({
      provider: "kimi",
      id: "kimi-call-1",
      name: "Write",
      input: { path: "projects/demo/index.html", file_path: "projects/demo/index.html" },
    });
    expect(eventsOf(frames, "tool_result")[0].data).toMatchObject({
      provider: "kimi",
      id: "kimi-call-1",
      isError: false,
      content: "ok",
    });
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      inputTokens: 800,
      outputTokens: 200,
    });
    expect(eventsOf(frames, "result")).toHaveLength(1);
    expectSingleTerminal(frames);
  });
});

describe("golden: opencode — --format json adapter", () => {
  it("normalizes text/tool_use(write→Write + synthetic result)/step_finish", async () => {
    const child = makeFakeChild();
    const body = { prompt: "build it", systemPrompt: "sys", model: "openai/gpt-5.4-mini-fast" };
    const req = makeFakeReq();
    const res = makeFakeRes();
    await opencode.stream(req, res, makeDeps(body, { spawn: () => child }));
    feedChild(child, fixture("opencode.jsonl"));
    await res.ended;
    const frames = res.frames();

    expect(textOf(frames)).toBe("Gerando. Feito.");
    expect(eventsOf(frames, "tool_call")[0].data).toMatchObject({
      provider: "opencode",
      id: "oc-call-1",
      name: "Write",
      input: { file_path: "projects/demo/index.html" },
    });
    // state.status === "completed" → synthetic tool_result so the UI's
    // iframe-reload gate fires.
    expect(eventsOf(frames, "tool_result")[0].data).toMatchObject({
      provider: "opencode",
      id: "oc-call-1",
      isError: false,
      content: "written",
    });
    expect(eventsOf(frames, "usage")[0].data).toMatchObject({
      prompt_tokens: 600,
      completion_tokens: 150,
      total_tokens: 750,
    });
    expectSingleTerminal(frames);
  });
});

// ─── Cross-provider invariant ────────────────────────────────────────────

describe("golden invariant: every stream ends with exactly one terminal event", () => {
  it("is asserted inside each provider case above (sanity marker)", () => {
    // The per-provider cases call expectSingleTerminal(); this marker
    // exists so a future case that forgets the terminal assertion is
    // caught in review — the invariant is the WHOLE point of the
    // final-event normalization contract (contract.test.mjs).
    expect(typeof expectSingleTerminal).toBe("function");
  });
});
