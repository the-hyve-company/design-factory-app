// turn-pipeline.test.ts — simplified pipeline tests.
//
// Cover the 3 stages (prepare → stream → finalize) + the public
// `sendUserTurn()` entrypoint + the lightweight `validateTurnOutput()`.
// Mocks `spawnStream` (the network call) and `upsertProviderSession`
// (sticky session persistence). Pure-function helpers (composeUserPrompt,
// validateTurnOutput) get unit coverage too.

import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock spawnStream to deterministically replay a script (text + meta +
// done) so the stream stage resolves without hitting the daemon.
vi.mock("@/runtime/cli-spawner", () => ({
  spawnStream: vi.fn(),
}));

// Mock upsertProviderSession so the finalize stage doesn't try to fetch.
vi.mock("@/lib/provider-sessions", () => ({
  upsertProviderSession: vi.fn().mockResolvedValue({ version: 1, sessions: {} }),
}));

// Mock processArtifacts pieces — the finalize stage delegates to
// `parseArtifact` + `dispatchParseResult`. Default stub returns "no-artifact".
vi.mock("@/runtime/artifact-processor", async () => {
  const actual = await vi.importActual<typeof import("@/runtime/artifact-processor")>(
    "@/runtime/artifact-processor",
  );
  return {
    ...actual,
    parseArtifact: vi.fn().mockResolvedValue({ status: "none", cleanedText: "" }),
  };
});

vi.mock("@/runtime/process-artifacts", async () => {
  const actual = await vi.importActual<typeof import("@/runtime/process-artifacts")>(
    "@/runtime/process-artifacts",
  );
  return {
    ...actual,
    dispatchParseResult: vi.fn(),
  };
});

import { spawnStream } from "@/runtime/cli-spawner";
import { upsertProviderSession } from "@/lib/provider-sessions";
import { parseArtifact } from "@/runtime/artifact-processor";
import {
  prepare,
  stream,
  finalize,
  validateTurnOutput,
  sendUserTurn,
  composeUserPrompt,
  assembleTurnBlocks,
  isTurnPipelineV2Enabled,
  TurnPrepareError,
  type UserTurnInput,
  type TurnStream,
} from "@/runtime/turn-pipeline";

// Minimal viable input — exercised by most tests. Override per-test as needed.
const baseInput: UserTurnInput = {
  userMessage: "hello",
  providerId: "claude",
  projectId: "smoke",
  threadId: "main",
  context: {
    projectPath: "~/design-factory/smoke",
    primaryFile: "index.html",
    workspaceRoot: "/tmp/smoke",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default spawnStream — emits a chunk + done.
  vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
    callbacks.onText?.("hi back");
    callbacks.onDone?.("hi back");
    return () => {};
  });
});

// ─── isTurnPipelineV2Enabled ────────────────────────────────────────────

describe("isTurnPipelineV2Enabled", () => {
  it("returns true (simplified pipeline is the only path)", () => {
    expect(isTurnPipelineV2Enabled()).toBe(true);
  });
});

// ─── prepare ────────────────────────────────────────────────────────────

describe("prepare", () => {
  it("resolves provider + capabilities into TurnContext", () => {
    const ctx = prepare(baseInput);
    expect(ctx.providerId).toBe("claude");
    expect(ctx.capabilities.fileWrite).toBe("tool");
    expect(ctx.turnId).toMatch(/^t\d+$/);
    expect(ctx.prompt).toBe("hello");
    expect(ctx.systemPrompt.length).toBeGreaterThan(0);
  });

  it("throws TurnPrepareError on unknown provider", () => {
    const bad: UserTurnInput = {
      ...baseInput,
      providerId: "made-up-provider" as never,
    };
    expect(() => prepare(bad)).toThrow(TurnPrepareError);
  });

  it("forwards external sessionId only when provider supports resume", () => {
    const ctx = prepare({
      ...baseInput,
      context: { ...baseInput.context, sessionId: "sess-123" },
    });
    // claude has supportsResume: true.
    expect(ctx.providerOptions.sessionId).toBe("sess-123");
  });

  it("does NOT forward sessionId for providers without supportsResume", () => {
    const ctx = prepare({
      ...baseInput,
      providerId: "anthropic",
      context: { ...baseInput.context, sessionId: "sess-123" },
    });
    expect(ctx.providerOptions.sessionId).toBeUndefined();
  });

  it("appends OUTPUT-CONTRACT block for artifact-driven providers", () => {
    const ctx = prepare({ ...baseInput, providerId: "anthropic" });
    // anthropic has fileWrite: "artifact"
    expect(ctx.systemPrompt).toContain("artifact");
  });

  it("does NOT append OUTPUT-CONTRACT block for tool-driven providers", () => {
    const ctx = prepare({ ...baseInput, providerId: "claude" });
    // claude has fileWrite: "tool" — no contract block needed
    expect(ctx.systemPrompt).not.toMatch(/OUTPUT-CONTRACT|<artifact/);
  });

  it("honours systemPromptOverride", () => {
    const ctx = prepare(baseInput, { systemPromptOverride: "CUSTOM PROMPT" });
    // Override may still get a contract block appended, but the body
    // should start with the override.
    expect(ctx.systemPrompt.startsWith("CUSTOM PROMPT")).toBe(true);
  });

  it("honours opts.now + opts.turnId for deterministic tests", () => {
    const ctx = prepare(baseInput, { now: () => 1700, turnId: "t-fixed" });
    expect(ctx.startedAt).toBe(1700);
    expect(ctx.turnId).toBe("t-fixed");
  });

  it("injects the craft contract on a fresh write (no current file)", () => {
    // Regression: the craft floor used to be dead in the live path (only
    // the legacy invokeGenerateBase reached it). It must now land on every
    // fresh generation through prepare().
    const ctx = prepare(baseInput);
    expect(ctx.systemPrompt).toContain("## Craft contract");
    expect(ctx.systemPrompt).toContain("balances ( [ {");
  });

  it("does NOT inject the craft contract on a refine (current file present)", () => {
    const ctx = prepare({
      ...baseInput,
      context: { ...baseInput.context, iframeHtml: "<!doctype html><html></html>" },
    });
    expect(ctx.systemPrompt).not.toContain("## Craft contract");
  });

  it("does NOT inject the craft contract when systemPromptOverride is set", () => {
    const ctx = prepare(baseInput, { systemPromptOverride: "CUSTOM PROMPT" });
    expect(ctx.systemPrompt).not.toContain("## Craft contract");
  });
});

// ─── composeUserPrompt ──────────────────────────────────────────────────

describe("assembleTurnBlocks — inspector stays in sync with prepare", () => {
  it("includes a craft block on a fresh write", () => {
    const blocks = assembleTurnBlocks(baseInput);
    expect(blocks.some((b) => b.id === "craft")).toBe(true);
  });

  it("omits the craft block on a refine (current file present)", () => {
    const blocks = assembleTurnBlocks({
      ...baseInput,
      context: { ...baseInput.context, iframeHtml: "<!doctype html><html></html>" },
    });
    expect(blocks.some((b) => b.id === "craft")).toBe(false);
  });
});

describe("composeUserPrompt", () => {
  it("returns userMessage unchanged when no attachments", () => {
    expect(composeUserPrompt("hi")).toBe("hi");
  });

  it("renders attachments as fenced blocks before user message", () => {
    const r = composeUserPrompt("question", [
      { name: "a.md", mime: "text/markdown", size: 1024, content: "some md" },
    ]);
    expect(r).toContain("--- a.md");
    expect(r.endsWith("question")).toBe(true);
  });

  it("renders absolute-path images as a path reference", () => {
    const r = composeUserPrompt("look", [
      { name: "screenshot.png", mime: "image/png", size: 5000, content: "/abs/path.png" },
    ]);
    expect(r).toContain("[attached image: /abs/path.png]");
  });
});

// ─── stream ─────────────────────────────────────────────────────────────

describe("stream", () => {
  it("accumulates fullText from per-chunk callbacks", async () => {
    const ctx = prepare(baseInput);
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onText?.("hello ");
      callbacks.onText?.("world");
      callbacks.onDone?.("hello world");
      return () => {};
    });
    const s = await stream(ctx);
    expect(s.fullText).toBe("hello world");
    expect(s.errored).toBe(false);
    expect(s.aborted).toBe(false);
  });

  it("captures sessionId emitted by the provider", async () => {
    const ctx = prepare(baseInput);
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onSession?.("sess-emitted");
      callbacks.onDone?.("done");
      return () => {};
    });
    const s = await stream(ctx);
    expect(s.sessionId).toBe("sess-emitted");
  });

  it("flips errored when onError fires", async () => {
    const ctx = prepare(baseInput);
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onError?.("boom");
      return () => {};
    });
    const s = await stream(ctx);
    expect(s.errored).toBe(true);
    expect(s.errorMessage).toBe("boom");
  });

  it("forwards side-channel onText callback", async () => {
    const ctx = prepare(baseInput);
    const chunks: string[] = [];
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onText?.("a");
      callbacks.onText?.("b");
      callbacks.onDone?.("ab");
      return () => {};
    });
    await stream(ctx, { sideChannels: { onText: (c) => chunks.push(c) } });
    expect(chunks).toEqual(["a", "b"]);
  });

  it("dedups duplicate tool_call frames by id", async () => {
    const ctx = prepare(baseInput);
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onToolCall?.({ id: "tc-1", name: "Write", input: { file: "a.html" } });
      callbacks.onToolCall?.({ id: "tc-1", name: "Write", input: { file: "a.html" } });
      callbacks.onDone?.("done");
      return () => {};
    });
    const s = await stream(ctx);
    expect(s.tools.length).toBe(1);
  });

  it("respects pre-aborted signal", async () => {
    // Build a context first, then attach a fresh signal that is already
    // aborted. (We can't pass an aborted signal to prepare() — it would
    // throw before returning a context.)
    const ctx = prepare(baseInput);
    const ac = new AbortController();
    ac.abort();
    // Snapshot a copy of input with the aborted signal so the shared
    // baseInput stays clean for downstream tests.
    const newInput = { ...ctx.input, signal: ac.signal };
    await expect(stream({ ...ctx, input: newInput })).rejects.toThrow(/cancelled/);
  });
});

// ─── validateTurnOutput ─────────────────────────────────────────────────

describe("validateTurnOutput", () => {
  it("returns ok=true with null doneReport when no artifact wrote", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "",
      tools: [],
      toolEvents: [],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const v = await validateTurnOutput(ctx, s, {
      status: "skipped",
      reason: "no-artifact",
      cleanedText: "",
    });
    expect(v.ok).toBe(true);
    expect(v.doneReport).toBeNull();
  });

  it("returns ok=true when artifact wrote but parse not available", async () => {
    // parseArtifact returns "none" → defensive branch returns ok+null.
    vi.mocked(parseArtifact).mockResolvedValueOnce({ status: "none", cleanedText: "" } as never);
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "<artifact>...</artifact>",
      tools: [],
      toolEvents: [],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const v = await validateTurnOutput(ctx, s, {
      status: "written",
      finalPath: "/tmp/index.html",
      hash: "abc",
      backupPath: null,
      noop: false,
      cleanedText: "",
    });
    expect(v.ok).toBe(true);
    expect(v.doneReport).toBeNull();
  });

  it("runs the craft net on a tool-channel path-only write, read off disk (Codex)", async () => {
    const ctx = prepare(baseInput);
    const html =
      "<!doctype html><html><head><title>t</title></head><body>" +
      '<main style="color:#000000"><h1>Hello</h1><p>' +
      "lorem ipsum dolor sit amet ".repeat(20) +
      "</p></main></body></html>";
    const s: TurnStream = {
      fullText: "",
      tools: [],
      toolEvents: [
        {
          type: "tool_call",
          id: "codex-1",
          name: "Write",
          input: { file_path: "/proj/index.html" }, // path only, no content (Codex file_change)
          provider: "codex",
          timestamp: "2026-05-04T12:00:00.000Z",
        },
      ],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const fakeReader = async (p: string) => (p === "/proj/index.html" ? { content: html } : null);
    const v = await validateTurnOutput(
      ctx,
      s,
      { status: "skipped", reason: "provider-uses-write", cleanedText: "" },
      fakeReader,
    );
    expect(v.ok).toBe(true);
    expect(v.doneReport?.channel).toBe("tool");
    expect(v.doneReport?.craftCheck).not.toBeNull();
  });

  it("is fail-safe when a path-only write can't be read (no regression)", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "",
      tools: [],
      toolEvents: [
        {
          type: "tool_call",
          id: "codex-1",
          name: "Write",
          input: { file_path: "/proj/index.html" },
          provider: "codex",
          timestamp: "2026-05-04T12:00:00.000Z",
        },
      ],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const v = await validateTurnOutput(
      ctx,
      s,
      { status: "skipped", reason: "provider-uses-write", cleanedText: "" },
      async () => null, // read fails → no report, exactly as before
    );
    expect(v.ok).toBe(true);
    expect(v.doneReport).toBeNull();
  });
});

// ─── finalize ───────────────────────────────────────────────────────────

describe("finalize", () => {
  it("composes a TurnResult with one assistant message", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "hi",
      tools: [],
      toolEvents: [],
      sessionId: "sess",
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const r = await finalize(ctx, s, { persistProviderSession: false });
    expect(r.status).toBe("ok");
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].text).toBe("hi");
    expect(r.sessionId).toBe("sess");
  });

  it("flips status to cancelled when stream was aborted", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "",
      tools: [],
      toolEvents: [],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: true,
    };
    const r = await finalize(ctx, s, { persistProviderSession: false });
    expect(r.status).toBe("cancelled");
    expect(r.messages[0].text).toBe("[cancelled]");
  });

  it("flips status to error when stream errored", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "",
      tools: [],
      toolEvents: [],
      sessionId: null,
      meta: null,
      result: null,
      errored: true,
      errorMessage: "kaboom",
      aborted: false,
    };
    const r = await finalize(ctx, s, { persistProviderSession: false });
    expect(r.status).toBe("error");
    expect(r.messages[0].text).toContain("[error]");
  });

  it("persists sticky session when emitted", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "ok",
      tools: [],
      toolEvents: [],
      sessionId: "new-sess",
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    await finalize(ctx, s);
    expect(upsertProviderSession).toHaveBeenCalledWith("smoke", "claude", {
      sessionId: "new-sess",
    });
  });

  it("skips persistence when persistProviderSession=false", async () => {
    const ctx = prepare(baseInput);
    const s: TurnStream = {
      fullText: "ok",
      tools: [],
      toolEvents: [],
      sessionId: "sess",
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    await finalize(ctx, s, { persistProviderSession: false });
    expect(upsertProviderSession).not.toHaveBeenCalled();
  });

  it("skips artifact processing for tool-driven providers", async () => {
    const ctx = prepare({ ...baseInput, providerId: "claude" });
    const s: TurnStream = {
      fullText: "look at this <artifact>...</artifact>",
      tools: [],
      toolEvents: [],
      sessionId: null,
      meta: null,
      result: null,
      errored: false,
      aborted: false,
    };
    const r = await finalize(ctx, s, { persistProviderSession: false });
    expect(r.artifacts[0].status).toBe("skipped");
    if (r.artifacts[0].status === "skipped") {
      expect(r.artifacts[0].reason).toBe("provider-uses-write");
    }
    // parseArtifact should NOT have been called — short-circuit before parse.
    expect(parseArtifact).not.toHaveBeenCalled();
  });
});

// ─── sendUserTurn (integration) ─────────────────────────────────────────

describe("sendUserTurn", () => {
  it("end-to-end happy path returns ok with one message", async () => {
    const r = await sendUserTurn(baseInput, { finalize: { persistProviderSession: false } });
    expect(r.status).toBe("ok");
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].text).toBe("hi back");
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns error TurnResult on TurnPrepareError", async () => {
    const r = await sendUserTurn({ ...baseInput, providerId: "no-such" as never });
    expect(r.status).toBe("error");
    expect(r.error?.code).toBe("UNKNOWN_PROVIDER");
    expect(r.error?.stage).toBe("prepare");
  });

  it("returns cancelled status when input pre-aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await sendUserTurn({ ...baseInput, signal: ac.signal });
    expect(r.status).toBe("cancelled");
  });

  it("forwards top-level sideChannels into stream stage", async () => {
    const chunks: string[] = [];
    vi.mocked(spawnStream).mockImplementation(async (_cat, _prompt, _sys, callbacks) => {
      callbacks.onText?.("a");
      callbacks.onText?.("b");
      callbacks.onDone?.("ab");
      return () => {};
    });
    await sendUserTurn(baseInput, {
      finalize: { persistProviderSession: false },
      sideChannels: { onText: (c) => chunks.push(c) },
    });
    expect(chunks).toEqual(["a", "b"]);
  });
});
