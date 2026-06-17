import { describe, it, expect } from "vitest";
import {
  migrateLegacyChatMessage,
  migrateLegacyChatMessages,
  migrateLegacyToolEvents,
  migrateLegacyToolEventsList,
} from "./migrations";

describe("migrateLegacyChatMessage — Provider Handoff Layer v0", () => {
  it("converts role:'claude' to role:'assistant' + provider:'claude'", () => {
    const out = migrateLegacyChatMessage({ role: "claude", text: "hi" });
    expect(out).toEqual({ role: "assistant", text: "hi", provider: "claude" });
  });

  it("preserves an explicit provider field when present on legacy entry", () => {
    const out = migrateLegacyChatMessage({ role: "claude", provider: "codex", text: "hi" });
    expect(out).toEqual({ role: "assistant", provider: "codex", text: "hi" });
  });

  it("passes modern messages through unchanged", () => {
    const m = { role: "assistant", provider: "gemini", text: "ok" };
    expect(migrateLegacyChatMessage(m)).toEqual(m);
  });

  it("returns non-object input unchanged", () => {
    expect(migrateLegacyChatMessage(null)).toBeNull();
    expect(migrateLegacyChatMessage("string")).toBe("string");
  });
});

describe("migrateLegacyToolEvents — backfill", () => {
  it("backfills toolEvents from legacy tools (Write + result)", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      provider: "claude",
      text: "wrote it",
      tools: [
        {
          id: "tool_1",
          name: "Write",
          input: { file_path: "/tmp/x.html", content: "<html/>" },
          result: { content: "ok", isError: false },
        },
      ],
    }) as Record<string, unknown>;
    expect(Array.isArray(out.toolEvents)).toBe(true);
    const events = out.toolEvents as unknown[];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      id: "tool_1",
      name: "Write",
      provider: "claude",
    });
    expect(events[1]).toMatchObject({
      type: "tool_result",
      toolCallId: "tool_1",
      ok: true,
      output: "ok",
    });
  });

  it("backfills tool_error when legacy result.isError is true", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      provider: "claude",
      text: "tried",
      tools: [
        {
          id: "t1",
          name: "Bash",
          input: { command: "false" },
          result: { content: "exit 1", isError: true },
        },
      ],
    }) as Record<string, unknown>;
    const events = out.toolEvents as unknown[];
    expect(events[1]).toMatchObject({ type: "tool_error", toolCallId: "t1", reason: "exit 1" });
  });

  it("emits a tool_call envelope without a result when result is missing", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      provider: "claude",
      text: "calling",
      tools: [{ id: "t1", name: "Read", input: { file_path: "/x" } }],
    }) as Record<string, unknown>;
    const events = out.toolEvents as unknown[];
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).type).toBe("tool_call");
  });

  it("defaults provider to 'claude' when legacy entry lacks one", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      text: "no provider",
      tools: [{ id: "t1", name: "Bash", input: { command: "ls" } }],
    }) as Record<string, unknown>;
    const events = out.toolEvents as Array<Record<string, unknown>>;
    expect(events[0].provider).toBe("claude");
  });

  it("uses the explicit provider when present (e.g. codex)", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      provider: "codex",
      text: "ran",
      tools: [{ id: "t1", name: "Bash", input: { command: "ls" } }],
    }) as Record<string, unknown>;
    const events = out.toolEvents as Array<Record<string, unknown>>;
    expect(events[0].provider).toBe("codex");
  });

  it("returns null/non-object input unchanged", () => {
    expect(migrateLegacyToolEvents(null)).toBeNull();
    expect(migrateLegacyToolEvents(42)).toBe(42);
  });

  it("is idempotent — already-migrated message is returned unchanged", () => {
    const m = {
      role: "assistant",
      provider: "claude",
      text: "ok",
      tools: [{ id: "t1", name: "Bash", input: {} }],
      toolEvents: [
        {
          type: "tool_call",
          id: "t1",
          name: "Bash",
          input: {},
          provider: "claude",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const out = migrateLegacyToolEvents(m);
    expect(out).toBe(m); // exact same reference — nothing rebuilt
  });

  it("skips when no tools field (text-only message)", () => {
    const m = { role: "assistant", provider: "ollama", text: "just prose" };
    expect(migrateLegacyToolEvents(m)).toEqual(m);
  });

  it("skips user messages even with a stray tools field", () => {
    const m = { role: "user", text: "hi", tools: [{ id: "x", name: "Bash", input: {} }] };
    const out = migrateLegacyToolEvents(m) as Record<string, unknown>;
    expect(out.toolEvents).toBeUndefined();
  });

  it("safe-fails on malformed tools — drops bad entries silently", () => {
    const out = migrateLegacyToolEvents({
      role: "assistant",
      provider: "claude",
      text: "mixed",
      tools: [
        null,
        "string",
        { id: "good", name: "Bash", input: { command: "ls" } },
        { name: "no-id", input: {} },
        { id: "no-name", input: {} },
      ],
    }) as Record<string, unknown>;
    const events = out.toolEvents as unknown[];
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).id).toBe("good");
  });

  it("never throws on wildly malformed input", () => {
    expect(() =>
      migrateLegacyToolEvents({
        role: "assistant",
        provider: "claude",
        text: "x",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ id: 999, name: { weird: true }, input: "not-an-object" } as any],
      }),
    ).not.toThrow();
  });
});

describe("migrateLegacyChatMessages — list helper composes both migrations", () => {
  it("applies role coercion + tool-event backfill in a single pass", () => {
    const out = migrateLegacyChatMessages([
      { role: "user", text: "hi" },
      {
        role: "claude", // legacy role
        text: "wrote it",
        tools: [
          {
            id: "t1",
            name: "Write",
            input: { file_path: "/x.html" },
            result: { content: "ok", isError: false },
          },
        ],
      },
    ]) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    expect(out[0]?.role).toBe("user");
    expect(out[1]?.role).toBe("assistant");
    expect(out[1]?.provider).toBe("claude");
    expect(Array.isArray(out[1]?.toolEvents)).toBe(true);
  });

  it("returns [] when input is not an array", () => {
    expect(migrateLegacyChatMessages(null)).toEqual([]);
    expect(migrateLegacyChatMessages("oops")).toEqual([]);
  });
});

describe("migrateLegacyToolEventsList — tool-event-only backfill helper", () => {
  it("applies only the tool-event migration (skips role coercion)", () => {
    const out = migrateLegacyToolEventsList([
      { role: "claude", text: "legacy role intact", tools: [] },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]?.role).toBe("claude"); // role NOT coerced
  });

  it("returns [] for non-array input", () => {
    expect(migrateLegacyToolEventsList(undefined)).toEqual([]);
  });
});
