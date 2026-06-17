import { describe, it, expect } from "vitest";
import {
  normalizeToolEvent,
  fromBridgeToolCall,
  fromBridgeToolResult,
  canonicalToolName,
} from "./tool-events";

const fixedNow = () => "2026-05-04T12:00:00.000Z";

describe("normalizeToolEvent — Claude family", () => {
  it("maps a Claude tool_call to a NormalizedToolCallEvent", () => {
    const ev = normalizeToolEvent(
      {
        provider: "claude",
        kind: "tool_call",
        raw: {
          id: "toolu_01",
          name: "Write",
          input: { file_path: "/a/b.html", content: "<html/>" },
        },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_call",
      id: "toolu_01",
      name: "Write",
      input: { file_path: "/a/b.html", content: "<html/>" },
      provider: "claude",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("maps a Claude tool_result (ok) to a NormalizedToolResultEvent", () => {
    const ev = normalizeToolEvent(
      {
        provider: "claude",
        kind: "tool_result",
        raw: { id: "toolu_01", isError: false, content: "ok" },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_result",
      toolCallId: "toolu_01",
      ok: true,
      output: "ok",
      provider: "claude",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("maps a Claude tool_result (error) to a NormalizedToolErrorEvent", () => {
    const ev = normalizeToolEvent(
      {
        provider: "claude",
        kind: "tool_result",
        raw: { id: "toolu_02", isError: true, content: "EACCES" },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_error",
      toolCallId: "toolu_02",
      reason: "EACCES",
      provider: "claude",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("uses Anthropic API as a synonym for Claude wire shape", () => {
    const ev = normalizeToolEvent(
      {
        provider: "anthropic",
        kind: "tool_call",
        raw: { id: "toolu_03", name: "Bash", input: { command: "ls" } },
      },
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_call");
    if (ev?.type === "tool_call") {
      expect(ev.provider).toBe("anthropic");
      expect(ev.name).toBe("Bash");
    }
  });
});

describe("normalizeToolEvent — Codex", () => {
  it("maps the daemon-coerced ToolCall shape (name=Bash)", () => {
    const ev = normalizeToolEvent(
      {
        provider: "codex",
        kind: "tool_call",
        raw: { id: "exec_1", name: "Bash", input: { command: "echo hello" } },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_call",
      id: "exec_1",
      name: "Bash",
      input: { command: "echo hello" },
      provider: "codex",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("maps a defensive raw command_execution shape (no daemon coercion)", () => {
    const ev = normalizeToolEvent(
      {
        provider: "codex",
        kind: "tool_call",
        raw: { type: "command_execution", id: "exec_2", command: "cat foo.txt", cwd: "/tmp" },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_call",
      id: "exec_2",
      name: "Bash",
      input: { command: "cat foo.txt", cwd: "/tmp" },
      provider: "codex",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("maps Codex tool_result (error) to tool_error", () => {
    const ev = normalizeToolEvent(
      {
        provider: "codex",
        kind: "tool_result",
        raw: { id: "exec_3", isError: true, content: "exit 127" },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_error",
      toolCallId: "exec_3",
      reason: "exit 127",
      provider: "codex",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("falls back to a synthetic id when the raw shape lacks one", () => {
    const ev = normalizeToolEvent(
      {
        provider: "codex",
        kind: "tool_call",
        raw: { type: "command_execution", command: "pwd" },
      },
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_call");
    if (ev?.type === "tool_call") {
      expect(ev.id).toMatch(/^codex-\d+$/);
      expect(ev.input).toEqual({ command: "pwd" });
    }
  });
});

describe("normalizeToolEvent — Gemini", () => {
  it("maps the bridge-coerced ToolCall shape", () => {
    const ev = normalizeToolEvent(
      {
        provider: "gemini",
        kind: "tool_call",
        raw: { id: "gem_1", name: "Bash", input: { command: "ls" } },
      },
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_call");
    if (ev?.type === "tool_call") {
      expect(ev.provider).toBe("gemini");
    }
  });

  it("maps a raw Gemini function-calling shape ({ name, args })", () => {
    const ev = normalizeToolEvent(
      {
        provider: "gemini",
        kind: "tool_call",
        raw: { name: "bash", args: { command: "echo gemini" } },
      },
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_call");
    if (ev?.type === "tool_call") {
      expect(ev.name).toBe("Bash");
      expect(ev.input).toEqual({ command: "echo gemini" });
      expect(ev.id).toMatch(/^gemini-\d+$/);
    }
  });

  it("returns null for unrecognised Gemini shapes", () => {
    const ev = normalizeToolEvent(
      {
        provider: "gemini",
        kind: "tool_call",
        raw: { totally: "alien" },
      },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });
});

describe("normalizeToolEvent — providers without tool support", () => {
  it.each(["ollama", "openrouter", "opencode"] as const)("returns null for %s", (provider) => {
    const ev = normalizeToolEvent(
      {
        provider,
        kind: "tool_call",
        raw: { id: "x", name: "Bash", input: { command: "ls" } },
      },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });
});

describe("normalizeToolEvent — malformed input (graceful degrade)", () => {
  it("returns null for null raw", () => {
    const ev = normalizeToolEvent(
      { provider: "claude", kind: "tool_call", raw: null },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });

  it("returns null when id is missing on a tool_call", () => {
    const ev = normalizeToolEvent(
      { provider: "claude", kind: "tool_call", raw: { name: "Bash", input: {} } },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });

  it("returns null when name is missing on a tool_call", () => {
    const ev = normalizeToolEvent(
      { provider: "claude", kind: "tool_call", raw: { id: "x", input: {} } },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });

  it("returns null when input is wrong type (array)", () => {
    const ev = normalizeToolEvent(
      { provider: "claude", kind: "tool_call", raw: { id: "x", name: "Bash", input: [1, 2] } },
      { now: fixedNow },
    );
    expect(ev).toBeNull();
  });

  it("does not throw on a wildly malformed raw payload", () => {
    expect(() =>
      normalizeToolEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          provider: "claude",
          kind: "tool_call",
          raw: { id: 123, name: { weird: true }, input: "not-an-object" } as any,
        },
        { now: fixedNow },
      ),
    ).not.toThrow();
  });

  it("falls back to default reason text when error content is empty", () => {
    const ev = normalizeToolEvent(
      {
        provider: "claude",
        kind: "tool_result",
        raw: { id: "toolu_x", isError: true, content: "" },
      },
      { now: fixedNow },
    );
    expect(ev).toEqual({
      type: "tool_error",
      toolCallId: "toolu_x",
      reason: "tool error",
      provider: "claude",
      timestamp: "2026-05-04T12:00:00.000Z",
    });
  });

  it("coerces stringy isError to boolean for daemons that double-stringify", () => {
    const ev = normalizeToolEvent(
      {
        provider: "claude",
        kind: "tool_result",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw: { id: "y", isError: "true", content: "boom" } as any,
      },
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_error");
  });
});

describe("fromBridgeToolCall / fromBridgeToolResult helpers", () => {
  it("fromBridgeToolCall returns the call envelope only", () => {
    const ev = fromBridgeToolCall(
      { id: "z", name: "Bash", input: { command: "uptime" } },
      "claude",
      { now: fixedNow },
    );
    expect(ev?.type).toBe("tool_call");
  });

  it("fromBridgeToolResult returns tool_result on success", () => {
    const ev = fromBridgeToolResult({ id: "z", isError: false, content: "ok" }, "codex", {
      now: fixedNow,
    });
    expect(ev?.type).toBe("tool_result");
  });

  it("fromBridgeToolResult returns tool_error on failure", () => {
    const ev = fromBridgeToolResult({ id: "z", isError: true, content: "kaboom" }, "codex", {
      now: fixedNow,
    });
    expect(ev?.type).toBe("tool_error");
  });

  it("fromBridgeToolCall returns null for providers without tool support", () => {
    const ev = fromBridgeToolCall({ id: "z", name: "Bash", input: {} }, "ollama", {
      now: fixedNow,
    });
    expect(ev).toBeNull();
  });
});

describe("canonicalToolName", () => {
  it("maps lower-case bash to Bash", () => {
    expect(canonicalToolName("bash")).toBe("Bash");
  });

  it("strips module prefixes — anthropic.Bash → Bash", () => {
    expect(canonicalToolName("anthropic.Bash")).toBe("Bash");
  });

  it("title-cases prefixed tail — tools.bash → Bash", () => {
    expect(canonicalToolName("tools.bash")).toBe("Bash");
  });

  it("passes through unknown tools unchanged", () => {
    expect(canonicalToolName("CustomMcpTool")).toBe("CustomMcpTool");
  });

  it("maps command_execution to Bash", () => {
    expect(canonicalToolName("command_execution")).toBe("Bash");
  });

  it("returns the original when input is empty", () => {
    expect(canonicalToolName("")).toBe("");
  });
});
