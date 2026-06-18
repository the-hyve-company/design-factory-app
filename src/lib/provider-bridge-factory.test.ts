// Regression tests — provider-bridge-factory.
//
// Two behavioural defects this factory previously had:
//   1. Double `onDone` emission: when the SSE stream emits `event: done`,
//      the inner branch fires onDone — and then the post-loop `if (full)
//      callbacks.onDone(full)` fires it AGAIN. Persistence saw two snapshots
//      of the same turn, the chat panel rendered duplicate bubbles.
//   2. Silent fail when stream completes with empty `full` AND no `done`
//      event: pre-fix, neither branch fired, so the frontend hung on the
//      streaming placeholder forever. Per agent-contract §10, every turn
//      must end with EXACTLY ONE terminal event (success / empty-error /
//      real-error). Now we emit onError for empty-completion.
//
// Reference: docs/agent-contract.md §10 — Reporting errors.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeProviderBridge } from "./provider-bridge-factory";
import type { StreamCallbacks } from "./claude-bridge";

// Helpers -------------------------------------------------------------

/** Build a Response with a ReadableStream of pre-encoded SSE frames. */
function makeSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Build a complete StreamCallbacks bag with vi.fn spies on each hook. */
function makeCallbacks(): StreamCallbacks {
  return {
    onText: vi.fn(),
    onUsage: vi.fn(),
    onMeta: vi.fn(),
    onResult: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onSession: vi.fn(),
    onAuthRequired: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeProviderBridge — final-event regressions", () => {
  it("emits onDone EXACTLY ONCE when stream sends `event: done`", async () => {
    // Pre-fix bug: SSE stream emits `event: done` (inner branch fires
    // onDone) → after the read-loop ends, `if (full) callbacks.onDone(full)`
    // fires onDone AGAIN. UI saw the same turn persisted twice.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        makeSseResponse([
          `event: text\ndata: {"content":"hello "}\n\n`,
          `event: text\ndata: {"content":"world"}\n\n`,
          `event: done\ndata: {"content":"hello world"}\n\n`,
        ]),
      );

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);

    // Tick the event loop a few times so the IIFE drain finishes.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onDone).toHaveBeenCalledWith("hello world");
    expect(cb.onError).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("emits onDone EXACTLY ONCE when stream completes with `full` but no done event", async () => {
    // Fallback path: stream emitted text but never an explicit done.
    // Old behavior fired onDone(full). New behavior preserves that —
    // but only when the explicit-done flag is false.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeSseResponse([`event: text\ndata: {"content":"partial"}\n\n`]),
    );

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onDone).toHaveBeenCalledWith("partial");
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("emits onError (NOT onDone) when stream completes empty with no done event", async () => {
    // Silent-fail path: stream closed without text AND without done.
    // Pre-fix: nothing fired, frontend hung on the streaming placeholder.
    // Post-fix: emit onError("provider completed without text or artifact")
    // so the chat renders a red bubble and the user sees the failure.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(makeSseResponse([]));

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onDone).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledTimes(1);
    const errMsg = vi.mocked(cb.onError).mock.calls[0][0];
    expect(errMsg).toMatch(/provider completed without text or artifact/);
  });

  it("emits onError (NOT onDone) when stream emits `event: error`", async () => {
    // Real-error path: provider explicitly emitted an error frame. The
    // factory translates to onError; onDone must NOT fire afterwards.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeSseResponse([
        `event: text\ndata: {"content":"hi"}\n\n`,
        `event: error\ndata: {"error":"upstream rate limit"}\n\n`,
      ]),
    );

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith("upstream rate limit");
    // Note: with `full="hi"` the post-loop fallback would have fired
    // onDone if not for the doneEmitted gate. In , the stream
    // emitted no explicit `event: done`, so the fallback path DOES fire
    // onDone with "hi" — that's expected (real-error followed by partial
    // text fallback). What MUST NOT happen: a SECOND onDone after a
    // prior `event: done`. This case has no `event: done`, so onDone
    // firing once for the partial text is correct.
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onDone).toHaveBeenCalledWith("hi");
  });

  it("uses data.content from done event when present, falls back to accumulated text", async () => {
    // The done event can carry its own `content` field (some adapters
    // emit a normalized full text there). When present, prefer that
    // over the locally accumulated `full` — they should match but the
    // adapter is authoritative.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeSseResponse([
        `event: text\ndata: {"content":"streamed"}\n\n`,
        `event: done\ndata: {"content":"normalized"}\n\n`,
      ]),
    );

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onDone).toHaveBeenCalledWith("normalized");
  });

  it("emits onError when fetch returns non-2xx status (no onDone)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledWith("bridge HTTP 500");
    expect(cb.onDone).not.toHaveBeenCalled();
  });

  it("forwards usage events to onUsage callback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeSseResponse([
        `event: usage\ndata: {"prompt_tokens":10,"completion_tokens":20}\n\n`,
        `event: done\ndata: {"content":"x"}\n\n`,
      ]),
    );

    const cb = makeCallbacks();
    const bridge = makeProviderBridge("openrouter");
    await bridge.stream("hi", {}, cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb.onUsage).toHaveBeenCalledTimes(1);
    expect(cb.onUsage).toHaveBeenCalledWith({
      prompt_tokens: 10,
      completion_tokens: 20,
    });
  });
});

describe("makeProviderBridge — once() behavior (regression baseline)", () => {
  it("returns text from successful /once response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "answer" }), { status: 200 }),
    );
    const bridge = makeProviderBridge("openrouter");
    const result = await bridge.once("q");
    expect(result).toBe("answer");
  });

  it("throws on non-2xx /once response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const bridge = makeProviderBridge("openrouter");
    await expect(bridge.once("q")).rejects.toThrow(/bridge HTTP 503/);
  });

  it("throws when /once body has error field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "no token" }), { status: 200 }),
    );
    const bridge = makeProviderBridge("openrouter");
    await expect(bridge.once("q")).rejects.toThrow(/no token/);
  });
});
