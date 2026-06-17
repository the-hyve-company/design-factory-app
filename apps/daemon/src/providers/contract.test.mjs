// 1 stabilize — final-event normalization contract test.
//
// User direction (2026-05-07): every provider adapter MUST emit
// EXACTLY ONE terminal event per turn — `event: done` (success),
// `event: error` (real error or empty completion). Never silence.
//
// Pre-fix audit found 11 adapter close paths that emitted
// `event: done\ndata: {"content":""}` for empty completions, leading to
// the user-reported "respostas do assistente estao sumindo" bug:
// the chat persisted text:"" and the sanitizer's `[empty response]`
// marker was a band-aid over the real silence.
//
// Post-fix: each adapter explicitly branches on `full ? done : error`.
// This test reads each adapter source and asserts the close-path
// pattern is present — a static guard so future edits can't silently
// reintroduce the silence regression.
//
// We can't easily spawn real CLIs / hit live APIs here (no daemon
// runtime, no Anthropic token). Instead we encode the rule as a
// source-level grep: each adapter MUST contain a "completed without
// text or artifact" sentinel string in its close/end path.
//
// Reference: docs/agent-contract.md §10 — Reporting errors.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Adapters that handle their own SSE termination (close handler /
// stream-loop / pipe). Each MUST have at least one empty-completion
// guard — phrased "completed without text or artifact" by convention.
//
// Adapters listed here participate in the contract. Adapters NOT
// listed (e.g., types.mjs, index.mjs) either have no terminal-event
// surface or are tested via their own test file.
const ADAPTERS_WITH_TERMINAL = [
  "openrouter.mjs",
  "openai.mjs",
  "gemini-api.mjs",
  "ollama.mjs",
  "opencode.mjs",
];

// claude.mjs / codex.mjs / gemini.mjs delegate termination to the
// shared wirers in index.mjs (wireStreamJson / wireCodexJson /
// wireGeminiJson); the wirers themselves carry the contract guard.
// anthropic.mjs delegates to pipeAnthropicStream in index.mjs.
const DELEGATED_ADAPTERS = ["claude.mjs", "codex.mjs", "gemini.mjs", "anthropic.mjs"];

// Source paths for the shared wirers + pipeAnthropicStream.
const SHARED_WIRER_SOURCE = join(__dirname, "..", "index.mjs");

const EMPTY_COMPLETION_RX = /completed without text or artifact/;

describe("provider adapter contract — release readiness", () => {
  it("every registered provider declares a readiness value", async () => {
    const { PROVIDERS } = await import("./index.mjs");
    const ALLOWED = new Set(["stable", "beta", "experimental"]);
    const offenders = [];
    for (const [id, p] of Object.entries(PROVIDERS)) {
      if (!ALLOWED.has(p.readiness)) {
        offenders.push(`${id}: ${p.readiness ?? "(missing)"}`);
      }
    }
    expect(offenders, `Adapters missing readiness: ${offenders.join(", ")}`).toEqual([]);
  });

  it("describeProvider exposes readiness in the public shape", async () => {
    const { listProviders, describeProvider } = await import("./index.mjs");
    const sample = listProviders()[0];
    const desc = describeProvider(sample);
    expect(desc).toHaveProperty("readiness");
    expect(["stable", "beta", "experimental"]).toContain(desc.readiness);
  });

  it("describeProvider falls back to 'experimental' when adapter omits readiness", async () => {
    const { describeProvider } = await import("./index.mjs");
    const fake = {
      id: "fake",
      label: "Fake",
      capabilities: {
        streaming: true,
        tools: false,
        multimodal: false,
        sessions: false,
        mcp: false,
        fileWrite: "artifact",
      },
      stream: async () => {},
      once: async () => {},
    };
    const desc = describeProvider(fake);
    expect(desc.readiness).toBe("experimental");
  });
});

describe("provider adapter contract — final event normalization", () => {
  it("every direct-terminal adapter has an empty-completion error guard", () => {
    const dir = __dirname;
    const present = new Set(readdirSync(dir).filter((f) => f.endsWith(".mjs")));
    const missing = [];
    for (const file of ADAPTERS_WITH_TERMINAL) {
      if (!present.has(file)) {
        missing.push(`${file} (file not found in providers/)`);
        continue;
      }
      const src = readFileSync(join(dir, file), "utf8");
      if (!EMPTY_COMPLETION_RX.test(src)) {
        missing.push(file);
      }
    }
    expect(missing, `Adapters missing empty-completion guard: ${missing.join(", ")}`).toEqual([]);
  });

  it("delegated adapters route through the shared wirers (sanity)", () => {
    // claude → wireStreamJson, codex → wireCodexJson, gemini →
    // wireGeminiJson, anthropic → pipeAnthropicStream. The presence of
    // the wirer name is the contract anchor.
    const dir = __dirname;
    const expectations = {
      "claude.mjs": "wireStreamJson",
      "codex.mjs": "wireCodexJson",
      "gemini.mjs": "wireGeminiJson",
      "anthropic.mjs": "pipeAnthropicStream",
    };
    for (const [file, wirer] of Object.entries(expectations)) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, `${file} should reference ${wirer}`).toMatch(new RegExp(wirer));
    }
    // No-op assertion to keep the list tracked even if loop drains
    expect(DELEGATED_ADAPTERS).toContain("claude.mjs");
  });

  it("shared wirers + pipeAnthropicStream each carry the empty-completion guard", () => {
    // wireStreamJson, wireCodexJson, wireGeminiJson, pipeAnthropicStream
    // all live in apps/daemon/src/index.mjs. We don't grep per-function
    // (too brittle — the close handlers are defined inline) — just
    // assert the sentinel string appears at least 4 times in index.mjs,
    // which means each of the 4 close paths normalizes empty completion.
    const src = readFileSync(SHARED_WIRER_SOURCE, "utf8");
    const matches = src.match(/completed without text or artifact/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("no adapter emits a silent done({content: ''}) — sanity grep", () => {
    // Defensive grep: the literal string `done\ndata: ${...content: full})`
    // bare (without a `if (full)` guard upstream) would re-introduce the
    // silence bug. We allow done emission only when wrapped in a guard.
    //
    // This is a heuristic — a malicious refactor could bypass it. But it
    // catches the most common regression: copy/paste of an old branch.
    const dir = __dirname;
    const offenders = [];
    for (const file of ADAPTERS_WITH_TERMINAL) {
      const src = readFileSync(join(dir, file), "utf8");
      // Look for `event: done` lines that are NOT preceded within ~400
      // chars by either `if (full)` or `if (full && ...)`. This is rough
      // but flags the obvious regression pattern. Window widened from 200
      // → 400 once `event: result` (F-fix) started landing between the
      // guard and the done call alongside the pre-existing `event: usage`.
      const doneIdx = [...src.matchAll(/event: done\\n/g)].map((m) => m.index ?? 0);
      for (const idx of doneIdx) {
        const window = src.slice(Math.max(0, idx - 400), idx);
        const hasGuard =
          /if\s*\(\s*full(\s|\)|&&)/.test(window) || /\?\s*\`event:\s*done/.test(window);
        if (!hasGuard) offenders.push(`${file}@~${idx}`);
      }
    }
    expect(offenders, `Unguarded done emissions: ${offenders.join(", ")}`).toEqual([]);
  });
});
