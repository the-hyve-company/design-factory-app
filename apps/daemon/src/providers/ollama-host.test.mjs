// ollama-host.test.mjs — shared host resolution for detection + chat.
//
// Guards the 2026-05-29 fix: detection probed 127.0.0.1 → localhost → [::1]
// while the chat path hard-coded 127.0.0.1, so on IPv6-only / localhost-only
// setups the picker listed models but generation "fetch failed". Both paths
// now derive their host candidates from this one helper.

import { describe, expect, it, afterEach, vi } from "vitest";
import {
  ollamaHostCandidates,
  getModelCapabilities,
  extractMaxContext,
  resolveNumCtx,
  parseEnvThink,
  _resetModelCapsCache,
} from "./ollama-host.mjs";
import ollamaAdapter from "./ollama.mjs";

const ORIG = process.env.DF_OLLAMA_HOST;
afterEach(() => {
  if (ORIG === undefined) delete process.env.DF_OLLAMA_HOST;
  else process.env.DF_OLLAMA_HOST = ORIG;
  _resetModelCapsCache();
  vi.restoreAllMocks();
});

describe("ollamaHostCandidates", () => {
  it("defaults to IPv4, then localhost, then IPv6 (covers Windows/WSL/Docker splits)", () => {
    delete process.env.DF_OLLAMA_HOST;
    expect(ollamaHostCandidates()).toEqual([
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://[::1]:11434",
    ]);
  });

  it("collapses to a single host when DF_OLLAMA_HOST is set", () => {
    process.env.DF_OLLAMA_HOST = "http://my-box:11434";
    expect(ollamaHostCandidates()).toEqual(["http://my-box:11434"]);
  });
});

describe("ollama adapter import chain", () => {
  it("loads and wires the shared host resolver without error", () => {
    expect(ollamaAdapter.id).toBe("ollama");
    expect(typeof ollamaAdapter.stream).toBe("function");
    expect(typeof ollamaAdapter.once).toBe("function");
  });
});

describe("extractMaxContext", () => {
  it("reads <family>.context_length regardless of family key", () => {
    expect(extractMaxContext({ "qwen3.context_length": 40960, "general.foo": 1 })).toBe(40960);
    expect(extractMaxContext({ "llama.context_length": 8192 })).toBe(8192);
  });
  it("returns null when absent or malformed", () => {
    expect(extractMaxContext(null)).toBeNull();
    expect(extractMaxContext({})).toBeNull();
    expect(extractMaxContext({ "x.context_length": "nope" })).toBeNull();
  });
});

describe("getModelCapabilities", () => {
  it("maps /api/show capabilities + context_length", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        capabilities: ["completion", "tools", "thinking"],
        model_info: { "qwen3.context_length": 40960 },
      }),
    }));
    const caps = await getModelCapabilities("http://h", "qwen3:32b", 1000);
    expect(caps).toEqual({ chat: true, thinking: true, maxContext: 40960 });
  });

  it("flags an embedding model as non-chat", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ capabilities: ["embedding"], model_info: { "bert.context_length": 8192 } }),
    }));
    const caps = await getModelCapabilities("http://h", "bge-m3:latest", 1000);
    expect(caps.chat).toBe(false);
    expect(caps.thinking).toBe(false);
  });

  it("returns the permissive fallback on fetch failure", async () => {
    global.fetch = vi.fn(async () => { throw new Error("boom"); });
    const caps = await getModelCapabilities("http://h", "x", 1000);
    expect(caps).toEqual({ chat: true, thinking: false, maxContext: null });
  });

  it("caches per (host, model) within the TTL", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, json: async () => ({ capabilities: ["completion"], model_info: {} }) };
    });
    await getModelCapabilities("http://h", "m", 1000);
    await getModelCapabilities("http://h", "m", 1000 + 5_000); // within 60s TTL
    expect(calls).toBe(1);
  });
});

describe("resolveNumCtx", () => {
  it("defaults to 16384 with no env and no model max", () => {
    expect(resolveNumCtx(null, undefined)).toBe(16384);
  });
  it("clamps the default to the model's max", () => {
    expect(resolveNumCtx(8192, undefined)).toBe(8192);
  });
  it("honours DF_OLLAMA_NUM_CTX, still clamped to the model max", () => {
    expect(resolveNumCtx(40960, "32768")).toBe(32768);
    expect(resolveNumCtx(8192, "32768")).toBe(8192);
  });
  it("ignores junk env values and falls back to the default", () => {
    expect(resolveNumCtx(null, "abc")).toBe(16384);
    expect(resolveNumCtx(null, "0")).toBe(16384);
  });
});

describe("parseEnvThink", () => {
  it("defaults to on (auto) when unset", () => {
    expect(parseEnvThink(undefined)).toBe(true);
    expect(parseEnvThink("auto")).toBe(true);
  });
  it("turns off for explicit falsy values", () => {
    for (const v of ["0", "false", "off", "no", "FALSE"]) {
      expect(parseEnvThink(v)).toBe(false);
    }
  });
  it("stays on for truthy values", () => {
    for (const v of ["1", "true", "on"]) {
      expect(parseEnvThink(v)).toBe(true);
    }
  });
});
