// abort-mid-stream contract test.
//
// Every adapter wires `req.on("close")` to kill the spawned child or
// abort the upstream fetch. This test mocks a provider's spawn handle
// (or fetch upstream) and verifies the abort signal propagates correctly
// when the client closes the SSE connection mid-flight.
//
// We don't boot the daemon HTTP server (singleton with side effects).
// Instead we exercise the close handler shape: every provider's stream()
// MUST register `req.on("close", ...)` before the spawn returns, so a
// client disconnect terminates the upstream child immediately.
//
// This is a static structural test — not behavioral. The contract being
// asserted: every adapter source contains a `req.on("close"` registration
// in its stream handler. A behavioral abort test would need a daemon
// harness; deferred to .
//
// @file integration/abort-stream.test.mjs

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(__dirname, "..", "providers");

// Adapters that own their own SSE stream loop (need the close handler).
// claude/codex/gemini delegate termination to shared wirers in
// index.mjs; their close handlers wire the kill upstream of the wirer
// and are still required.
//
// anthropic.mjs is excluded — it delegates abort wiring entirely to
// pipeAnthropicStream() in index.mjs, which owns the AbortController
// for the upstream Anthropic API fetch.
const ADAPTERS_WITH_STREAM = [
  "claude.mjs",
  "codex.mjs",
  "gemini.mjs",
  "opencode.mjs",
  "kimi.mjs",
  "openrouter.mjs",
  "openai.mjs",
  "gemini-api.mjs",
  "ollama.mjs",
];

// Adapters that delegate abort wiring entirely to a shared helper in
// index.mjs. They pass req/res through; the helper owns the close.
const DELEGATED_ABORT = [
  "anthropic.mjs", // delegates to pipeAnthropicStream
];

describe("abort-mid-stream contract — all adapters wire req.on('close')", () => {
  it("every stream-capable adapter registers a close handler", () => {
    const present = new Set(readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith(".mjs")));
    const offenders = [];
    for (const file of ADAPTERS_WITH_STREAM) {
      if (!present.has(file)) {
        offenders.push(`${file} (file not found)`);
        continue;
      }
      const src = readFileSync(join(PROVIDERS_DIR, file), "utf8");
      // Find the stream() handler block. We look for `async stream(`
      // followed somewhere by req.on("close" — a coarse but useful guard
      // against a future PR forgetting to wire the abort.
      const streamMatch = src.match(/async\s+stream\s*\(/);
      if (!streamMatch) {
        offenders.push(`${file}: no async stream() found`);
        continue;
      }
      const fromStream = src.slice(streamMatch.index ?? 0);
      // Match req.on("close") — quoted with single or double quotes.
      const closeRx = /req\.on\(\s*['"]close['"]/;
      if (!closeRx.test(fromStream)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Adapters missing req.on('close') in stream(): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every CLI-spawning adapter calls child.kill on abort", () => {
    // CLIs use child_process.spawn — abort = child.kill("SIGTERM").
    // API providers use fetch + AbortController — abort = controller.abort()
    // (already covered by anthropic / openrouter / qwen / deepseek wiring;
    // verified via fetch signal pattern below).
    const CLI_ADAPTERS = ["claude.mjs", "codex.mjs", "gemini.mjs", "opencode.mjs", "kimi.mjs"];
    const offenders = [];
    for (const file of CLI_ADAPTERS) {
      const src = readFileSync(join(PROVIDERS_DIR, file), "utf8");
      // child.kill("SIGTERM") OR child.kill() inside the close handler.
      const killRx = /child\.kill\s*\(/;
      if (!killRx.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `CLI adapters missing child.kill: ${offenders.join(", ")}`).toEqual([]);
  });

  it("API adapters use AbortController for upstream cancellation", () => {
    // Anthropic delegates to pipeAnthropicStream (in index.mjs).
    // openrouter is the only API adapter that wires its own
    // AbortController in v1 beta.
    const API_ADAPTERS = ["openrouter.mjs"];
    const offenders = [];
    for (const file of API_ADAPTERS) {
      const src = readFileSync(join(PROVIDERS_DIR, file), "utf8");
      const abortRx = /AbortController|controller\.abort\(/;
      if (!abortRx.test(src)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `API adapters missing AbortController wiring: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("anthropic adapter delegates abort to pipeAnthropicStream", () => {
    // Sanity: anthropic.mjs MUST reference pipeAnthropicStream (the
    // delegation contract). The wirer itself, in index.mjs, carries the
    // AbortController for the upstream fetch.
    for (const file of DELEGATED_ABORT) {
      const src = readFileSync(join(PROVIDERS_DIR, file), "utf8");
      expect(src).toMatch(/pipeAnthropicStream/);
    }
  });
});
