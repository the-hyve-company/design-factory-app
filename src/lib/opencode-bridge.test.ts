// opencode-bridge.test.ts — SSE parsing coverage for the opencode client
// bridge (audit WS1 `craft-net-10-10`).
//
// The daemon has emitted `tool_call`/`tool_result` frames for opencode
// since 2026-05-18 (ACP vocabulary coerced to canonical Write/Edit/Bash),
// but THIS parser only handled text/error/done — the tool frames were
// dropped on the floor, which is why opencode escaped the tool-channel
// craft net. These tests feed a scripted SSE stream through a mocked
// fetch and assert the callbacks now receive the tool events.

import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpencode } from "./opencode-bridge";
import type { StreamCallbacks, ToolCall, ToolResult } from "@/lib/claude-bridge";

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface Collected {
  texts: string[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  done: string[];
  errors: string[];
}

function collector(): { callbacks: StreamCallbacks; got: Collected; finished: Promise<void> } {
  const got: Collected = { texts: [], toolCalls: [], toolResults: [], done: [], errors: [] };
  let resolve!: () => void;
  const finished = new Promise<void>((r) => (resolve = r));
  const callbacks: StreamCallbacks = {
    onText: (t) => got.texts.push(t),
    onToolCall: (c) => got.toolCalls.push(c),
    onToolResult: (r) => got.toolResults.push(r),
    onDone: (full) => {
      got.done.push(full);
      resolve();
    },
    onError: (e) => {
      got.errors.push(String(e));
      resolve();
    },
  };
  return { callbacks, got, finished };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamOpencode — SSE tool frames", () => {
  it("forwards tool_call and tool_result frames to the callbacks", async () => {
    const frames = [
      frame("log", { level: "info", message: "opencode → model" }),
      frame("tool_call", {
        provider: "opencode",
        id: "call-1",
        name: "Write",
        input: { file_path: "/proj/index.html", patchText: "*** Begin Patch…" },
      }),
      frame("tool_result", { provider: "opencode", id: "call-1", content: "completed" }),
      frame("text", { content: "wrote the page" }),
      frame("done", { content: "wrote the page" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(frames)));

    const { callbacks, got, finished } = collector();
    await streamOpencode("build a page", {}, callbacks);
    await finished;

    expect(got.toolCalls).toHaveLength(1);
    expect(got.toolCalls[0]).toMatchObject({
      id: "call-1",
      name: "Write",
      input: { file_path: "/proj/index.html" },
    });
    expect(got.toolResults).toHaveLength(1);
    expect(got.toolResults[0]).toMatchObject({ id: "call-1", isError: false });
    expect(got.texts.join("")).toBe("wrote the page");
    expect(got.done[0]).toBe("wrote the page");
    expect(got.errors).toHaveLength(0);
  });

  it("synthesizes a stable id when the daemon emits a null callID", async () => {
    const frames = [
      frame("tool_call", {
        provider: "opencode",
        id: null,
        name: "Write",
        input: { file_path: "/proj/index.html" },
      }),
      frame("tool_call", {
        provider: "opencode",
        id: null,
        name: "Bash",
        input: { command: "ls" },
      }),
      frame("done", { content: "" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(frames)));

    const { callbacks, got, finished } = collector();
    await streamOpencode("x", {}, callbacks);
    await finished;

    expect(got.toolCalls.map((c) => c.id)).toEqual(["opencode-call-1", "opencode-call-2"]);
  });

  it("drops tool_result frames with no id (nothing to correlate) without crashing", async () => {
    const frames = [
      frame("tool_result", { provider: "opencode", id: null, content: "orphan" }),
      frame("text", { content: "ok" }),
      frame("done", { content: "ok" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(frames)));

    const { callbacks, got, finished } = collector();
    await streamOpencode("x", {}, callbacks);
    await finished;

    expect(got.toolResults).toHaveLength(0);
    expect(got.done[0]).toBe("ok");
  });
});
