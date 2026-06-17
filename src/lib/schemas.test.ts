import { describe, expect, it, vi } from "vitest";
import {
  TurnSchema,
  GlobalConfigSchema,
  ProviderIdSchema,
  ProjectMetaSchema,
  ChatReadTurnsResponseSchema,
  CachedMessageSchema,
  CachedMessagesArraySchema,
  DirectionSelectionSchema,
  ProviderSessionsSchema,
  ProviderSessionEntrySchema,
  ArtifactStateSchema,
  safeRead,
  safeWriteOrThrow,
} from "./schemas";
import { migrateLegacyChatMessage, migrateLegacyChatMessages } from "./migrations";

describe("Turn schema", () => {
  it("accepts a complete user+ai turn", () => {
    const valid = {
      id: "t-1",
      ts: 1234567890,
      user: { text: "make it blue" },
      ai: { text: "Done.", tools: [], is_design: true, status: "done" },
    };
    expect(TurnSchema.parse(valid)).toMatchObject(valid);
  });

  it("accepts a turn with no ai (mid-stream snapshot)", () => {
    const valid = { id: "t-2", user: { text: "hi" } };
    const parsed = TurnSchema.parse(valid);
    expect(parsed.id).toBe("t-2");
  });

  it("accepts a verb-style user turn", () => {
    const valid = {
      id: "t-3",
      user: {
        text: "/polish",
        verb: { id: "polish", label: "Polish", category: "refine", modifiesHtml: true },
      },
      ai: null,
    };
    expect(() => TurnSchema.parse(valid)).not.toThrow();
  });

  it("rejects a turn missing id", () => {
    const r = TurnSchema.safeParse({ user: { text: "x" } });
    expect(r.success).toBe(false);
  });

  it("rejects an ai with bad status", () => {
    const r = TurnSchema.safeParse({
      id: "t-4",
      user: { text: "x" },
      ai: { text: "ok", status: "bogus-status" as never },
    });
    expect(r.success).toBe(false);
  });
});

describe("ChatReadTurnsResponseSchema", () => {
  it("parses a normal response", () => {
    const r = ChatReadTurnsResponseSchema.parse({
      turns: [{ id: "t-1", user: { text: "x" } }],
      migrated: false,
    });
    expect(r.turns).toHaveLength(1);
  });

  it("treats `migrated` as optional", () => {
    const r = ChatReadTurnsResponseSchema.parse({ turns: [] });
    expect(r.turns).toEqual([]);
  });
});

describe("CachedMessageSchema", () => {
  it("accepts a fully-typed user message", () => {
    const r = CachedMessageSchema.parse({
      role: "user",
      text: "hello",
      ts: 1,
      turn_id: "t-1",
    });
    expect(r.role).toBe("user");
  });

  it("accepts an assistant message with provider + model", () => {
    const r = CachedMessageSchema.parse({
      role: "assistant",
      provider: "codex",
      model: "gpt-5",
      text: "ok",
    });
    expect(r.role).toBe("assistant");
    expect(r.provider).toBe("codex");
    expect(r.model).toBe("gpt-5");
  });

  it("strips unknown extra fields gracefully (loose)", () => {
    const r = CachedMessageSchema.parse({
      role: "assistant",
      provider: "claude",
      text: "ok",
      verb: { id: "p", label: "P", garbage: true },
    });
    expect(r.role).toBe("assistant");
  });

  it("rejects legacy role:claude — needs migration first", () => {
    const r = CachedMessageSchema.safeParse({ role: "claude", text: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects bad role", () => {
    const r = CachedMessageSchema.safeParse({ role: "system", text: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown provider", () => {
    const r = CachedMessageSchema.safeParse({
      role: "assistant",
      provider: "local-llm",
      text: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("CachedMessagesArraySchema (cache restore)", () => {
  it("validates a list of modern messages", () => {
    const r = CachedMessagesArraySchema.parse([
      { role: "user", text: "hi" },
      { role: "assistant", provider: "claude", text: "yo", isDesign: true },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe("ProjectMetaSchema", () => {
  it("accepts the canonical shape", () => {
    const r = ProjectMetaSchema.parse({
      id: "abc",
      name: "Test",
      mode: "hifi",
      created_at: 1,
      updated_at: 2,
    });
    expect(r.mode).toBe("hifi");
  });

  it("coerces stringly-typed timestamps", () => {
    const r = ProjectMetaSchema.parse({
      id: "abc",
      name: "Test",
      mode: "wireframe",
      created_at: "1700000000000",
      updated_at: "1700000001000",
    });
    expect(r.created_at).toBe(1700000000000);
    expect(r.updated_at).toBe(1700000001000);
  });

  it("rejects bad mode", () => {
    const r = ProjectMetaSchema.safeParse({
      id: "x",
      name: "n",
      mode: "design",
      created_at: 0,
      updated_at: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("GlobalConfigSchema", () => {
  it("accepts minimal {}", () => {
    expect(GlobalConfigSchema.parse({})).toEqual({});
  });

  it("accepts full shape with overrides", () => {
    const r = GlobalConfigSchema.parse({
      theme: "dark",
      accent_color: "#abcdef",
      builtin_prompts: { generate: "..." },
      format_overrides: { "fmt-1": { nome: "X" } },
      direction_overrides: { "dir-1": { prompt_addon: "..." } },
    });
    expect(r.theme).toBe("dark");
  });

  it("rejects invalid theme", () => {
    const r = GlobalConfigSchema.safeParse({ theme: "neon" });
    expect(r.success).toBe(false);
  });

  // P0 bug fix (Provider Handoff Layer v0): default_provider used to be
  // z.literal("claude") which rejected codex/gemini/anthropic/etc and made
  // the parser silently fall back to {} → "config sumindo".
  it.each([
    "claude",
    "codex",
    "gemini",
    "opencode",
    "kimi",
    "anthropic",
    "openai",
    "gemini-api",
    "openrouter",
    "ollama",
  ] as const)("accepts default_provider = %s", (p) => {
    const r = GlobalConfigSchema.parse({ default_provider: p });
    expect(r.default_provider).toBe(p);
  });

  it("rejects unknown default_provider", () => {
    const r = GlobalConfigSchema.safeParse({ default_provider: "local-llm" });
    expect(r.success).toBe(false);
  });
});

describe("ProviderIdSchema", () => {
  it.each([
    "claude",
    "codex",
    "gemini",
    "opencode",
    "kimi",
    "anthropic",
    "openai",
    "gemini-api",
    "openrouter",
    "ollama",
  ] as const)("accepts %s", (p) => {
    expect(ProviderIdSchema.parse(p)).toBe(p);
  });

  it("rejects unknown provider", () => {
    expect(ProviderIdSchema.safeParse("local-llm").success).toBe(false);
  });
});

describe("migrateLegacyChatMessage", () => {
  it("rewrites role:claude → role:assistant + provider:claude", () => {
    const r = migrateLegacyChatMessage({ role: "claude", text: "hi" }) as Record<string, unknown>;
    expect(r.role).toBe("assistant");
    expect(r.provider).toBe("claude");
    expect(r.text).toBe("hi");
  });

  it("preserves modern messages unchanged", () => {
    const input = { role: "assistant", provider: "codex", text: "hi" };
    expect(migrateLegacyChatMessage(input)).toBe(input);
  });

  it("preserves user messages unchanged", () => {
    const input = { role: "user", text: "hi" };
    expect(migrateLegacyChatMessage(input)).toBe(input);
  });

  it("preserves provider when caller supplied a non-claude legacy provider", () => {
    const r = migrateLegacyChatMessage({ role: "claude", provider: "codex", text: "x" }) as Record<
      string,
      unknown
    >;
    expect(r.provider).toBe("codex");
  });

  it("returns input unchanged when not an object", () => {
    expect(migrateLegacyChatMessage(null)).toBe(null);
    expect(migrateLegacyChatMessage("not-a-msg")).toBe("not-a-msg");
  });
});

describe("migrateLegacyChatMessages (array)", () => {
  it("migrates mixed legacy + modern entries", () => {
    const out = migrateLegacyChatMessages([
      { role: "user", text: "hi" },
      { role: "claude", text: "yo" },
      { role: "assistant", provider: "codex", text: "ok" },
    ]) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(3);
    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("assistant");
    expect(out[1].provider).toBe("claude");
    expect(out[2].role).toBe("assistant");
    expect(out[2].provider).toBe("codex");
  });

  it("returns [] for non-array input", () => {
    expect(migrateLegacyChatMessages(null)).toEqual([]);
    expect(migrateLegacyChatMessages("not-an-array")).toEqual([]);
  });

  it("migrated messages then pass through CachedMessageSchema", () => {
    const migrated = migrateLegacyChatMessages([{ role: "claude", text: "yo" }]);
    const parsed = CachedMessagesArraySchema.parse(migrated);
    expect(parsed[0].role).toBe("assistant");
    expect(parsed[0].provider).toBe("claude");
  });
});

describe("DirectionSelectionSchema", () => {
  it("accepts modern shape", () => {
    const r = DirectionSelectionSchema.parse({
      formatoId: "explainer",
      directionIds: ["motion-clip-path-reveal"],
      enabledAntiSlop: ["No emoji"],
      customAntiSlop: ["Don't be lila"],
    });
    expect(r.formatoId).toBe("explainer");
  });

  it("supplies default arrays when missing", () => {
    const r = DirectionSelectionSchema.parse({
      formatoId: "logo-reveal",
      directionIds: [],
    });
    expect(r.enabledAntiSlop).toEqual([]);
    expect(r.customAntiSlop).toEqual([]);
  });

  it("rejects empty formatoId", () => {
    const r = DirectionSelectionSchema.safeParse({
      formatoId: "",
      directionIds: [],
      enabledAntiSlop: [],
      customAntiSlop: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("ProviderSessionsSchema", () => {
  it("accepts an empty sessions map", () => {
    const r = ProviderSessionsSchema.parse({ version: 1, sessions: {} });
    expect(r.version).toBe(1);
    expect(r.sessions).toEqual({});
  });

  it("accepts a fully populated entry", () => {
    const r = ProviderSessionsSchema.parse({
      version: 1,
      sessions: {
        claude: {
          sessionId: "abc-123",
          created_at: 1700000000000,
          last_used_at: 1700000001000,
          artifact_version_seen: 5,
        },
      },
    });
    expect(r.sessions.claude?.sessionId).toBe("abc-123");
    expect(r.sessions.claude?.artifact_version_seen).toBe(5);
  });

  it("accepts null sessionId (stateless providers)", () => {
    const r = ProviderSessionsSchema.parse({
      version: 1,
      sessions: {
        ollama: {
          sessionId: null,
          created_at: 1,
          last_used_at: 2,
          artifact_version_seen: 0,
        },
      },
    });
    expect(r.sessions.ollama?.sessionId).toBeNull();
  });

  it("defaults artifact_version_seen to 0", () => {
    const r = ProviderSessionEntrySchema.parse({
      sessionId: "x",
      created_at: 1,
      last_used_at: 2,
    });
    expect(r.artifact_version_seen).toBe(0);
  });

  it("silently drops unknown provider keys (forward-compat insurance)", () => {
    // The schema accepts but discards unknown providers so adding a new
    // provider in a future version doesn't blow up older sessions files.
    const r = ProviderSessionsSchema.parse({
      version: 1,
      sessions: {
        claude: { sessionId: "ok", created_at: 1, last_used_at: 2 },
        "local-llm": { sessionId: "x", created_at: 1, last_used_at: 2 },
      },
    });
    expect(r.sessions.claude?.sessionId).toBe("ok");
    expect("local-llm" in r.sessions).toBe(false);
  });

  it("rejects bad version literal", () => {
    const r = ProviderSessionsSchema.safeParse({ version: 2, sessions: {} });
    expect(r.success).toBe(false);
  });
});

describe("ArtifactStateSchema", () => {
  it("accepts the canonical shape", () => {
    const r = ArtifactStateSchema.parse({
      version: 1,
      primary_path: "index.html",
      secondary_paths: [],
      snapshot_version: 3,
      last_modified: 1700000000000,
      byte_size: 4321,
    });
    expect(r.primary_path).toBe("index.html");
  });

  it("supplies defaults for optional fields", () => {
    const r = ArtifactStateSchema.parse({
      version: 1,
      primary_path: "main.tsx",
      last_modified: 1,
    });
    expect(r.secondary_paths).toEqual([]);
    expect(r.snapshot_version).toBe(1);
    expect(r.byte_size).toBe(0);
  });

  it("rejects negative snapshot_version", () => {
    const r = ArtifactStateSchema.safeParse({
      version: 1,
      primary_path: "x",
      snapshot_version: -1,
      last_modified: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects bad version literal", () => {
    const r = ArtifactStateSchema.safeParse({
      version: 2,
      primary_path: "x",
      last_modified: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("safeRead", () => {
  it("returns parsed value on success", () => {
    const r = safeRead(TurnSchema, { id: "x", user: { text: "y" } }, "test");
    expect(r?.id).toBe("x");
  });

  it("returns null + warns on failure", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = safeRead(TurnSchema, { user: {} }, "test");
    expect(r).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("safeWriteOrThrow", () => {
  it("returns parsed value on success", () => {
    const r = safeWriteOrThrow(TurnSchema, { id: "x", user: { text: "y" } }, "test");
    expect(r.id).toBe("x");
  });

  it("throws on invalid input", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => safeWriteOrThrow(TurnSchema, { id: "" }, "test")).toThrow();
    spy.mockRestore();
  });
});
