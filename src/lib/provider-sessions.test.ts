// provider-sessions.test.ts — simplified sticky session storage.
//
// dropped the v3 multi-file aware canonical state. These tests
// cover only the v1 surface: read/write/upsert/clear of the per-provider
// `sessionId` map. Network mocked via `fetch`.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ProviderSessions } from "@/lib/schemas";
import {
  EMPTY_PROVIDER_SESSIONS,
  readProviderSessions,
  writeProviderSessions,
  upsertProviderSession,
  clearProviderSession,
  resumeSessionIdFor,
} from "@/lib/provider-sessions";

let lastWritten: unknown = null;

beforeEach(() => {
  lastWritten = null;
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (init?.method === "POST" && url.includes("/fs/provider-sessions")) {
      const payload = JSON.parse(init.body);
      lastWritten = payload.sessions;
      return new Response("ok", { status: 200 });
    }
    if (url.includes("/fs/provider-sessions")) {
      return new Response(JSON.stringify({ sessions: lastWritten }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readProviderSessions", () => {
  it("returns EMPTY when no file exists", async () => {
    const r = await readProviderSessions("smoke");
    expect(r).toEqual(EMPTY_PROVIDER_SESSIONS);
  });

  it("round-trips a v1 payload", async () => {
    const sessions: ProviderSessions = {
      version: 1,
      sessions: {
        claude: {
          sessionId: "abc-123",
          created_at: 1700000000000,
          last_used_at: 1700000001000,
          artifact_version_seen: 0,
        },
      },
    };
    await writeProviderSessions("smoke", sessions);
    const r = await readProviderSessions("smoke");
    expect(r.sessions.claude?.sessionId).toBe("abc-123");
  });

  it("tolerates orphan v3-shaped data without crashing", async () => {
    // Simulate a v3 file written by an older build. reads it via
    // the v1 schema, which expects keys to be provider ids — the v3
    // keys (`provider:slug:thread`) get silently dropped or the
    // schema returns the EMPTY default.
    lastWritten = {
      version: 3,
      sessions: {
        "claude:smoke:main": {
          providerId: "claude",
          projectId: "smoke",
          threadId: "main",
          workdir: "/tmp",
          sessionId: "v3-orphan",
          primaryFile: "index.html",
          activeFile: "index.html",
          lastTouchedFiles: [],
          lastPreviewedFile: null,
          updatedAt: "2026-05-07T00:00:00.000Z",
        },
      },
    };
    const r = await readProviderSessions("smoke");
    // The v3 entry under a non-provider key shouldn't surface as a
    // provider session. We don't assert exact structure — just that
    // there's no `claude` v1 entry derived from the v3 garbage.
    expect(r.sessions.claude).toBeUndefined();
  });
});

describe("upsertProviderSession", () => {
  it("creates a fresh entry when none exists", async () => {
    const r = await upsertProviderSession("smoke", "claude", { sessionId: "new-id" });
    expect(r.sessions.claude?.sessionId).toBe("new-id");
    expect(typeof r.sessions.claude?.created_at).toBe("number");
    expect(typeof r.sessions.claude?.last_used_at).toBe("number");
  });

  it("updates last_used_at while preserving created_at", async () => {
    const first = await upsertProviderSession("smoke", "claude", { sessionId: "id-1" });
    const createdAt = first.sessions.claude?.created_at;
    // Wait a tick so last_used_at differs.
    await new Promise((res) => setTimeout(res, 5));
    const second = await upsertProviderSession("smoke", "claude", { sessionId: "id-2" });
    expect(second.sessions.claude?.created_at).toBe(createdAt);
    expect(second.sessions.claude?.last_used_at).toBeGreaterThanOrEqual(createdAt!);
    expect(second.sessions.claude?.sessionId).toBe("id-2");
  });

  it("preserves existing sessionId when patch omits it", async () => {
    await upsertProviderSession("smoke", "claude", { sessionId: "kept" });
    const r = await upsertProviderSession("smoke", "claude", {});
    expect(r.sessions.claude?.sessionId).toBe("kept");
  });
});

describe("clearProviderSession", () => {
  it("removes the entry for that provider", async () => {
    await upsertProviderSession("smoke", "claude", { sessionId: "to-drop" });
    await upsertProviderSession("smoke", "codex", { sessionId: "to-keep" });
    const r = await clearProviderSession("smoke", "claude");
    expect(r.sessions.claude).toBeUndefined();
    expect(r.sessions.codex?.sessionId).toBe("to-keep");
  });

  it("is a no-op when the provider has no entry", async () => {
    const r = await clearProviderSession("smoke", "claude");
    expect(r).toEqual(EMPTY_PROVIDER_SESSIONS);
  });
});

// ─── resumeSessionIdFor — audit WS3 resume-parity-all-capable ─────────────

describe("resumeSessionIdFor (capability-gated resume)", () => {
  function sessionsWith(entries: Record<string, string>): ProviderSessions {
    const now = Date.now();
    const sessions: ProviderSessions["sessions"] = {};
    for (const [provider, sessionId] of Object.entries(entries)) {
      sessions[provider as keyof ProviderSessions["sessions"]] = {
        sessionId,
        created_at: now,
        last_used_at: now,
        artifact_version_seen: 0,
      };
    }
    return { version: 1, sessions };
  }

  it("returns the provider's own session for every resume-capable provider", () => {
    const sessions = sessionsWith({
      claude: "sess-claude",
      codex: "sess-codex",
      gemini: "sess-gemini",
    });
    expect(resumeSessionIdFor("claude", sessions)).toBe("sess-claude");
    expect(resumeSessionIdFor("codex", sessions)).toBe("sess-codex");
    expect(resumeSessionIdFor("gemini", sessions)).toBe("sess-gemini");
  });

  it("returns null for providers that don't declare supportsResume — even with a stored session", () => {
    const sessions = sessionsWith({
      kimi: "sess-kimi",
      opencode: "sess-oc",
      anthropic: "sess-api",
      openai: "sess-oai",
      "gemini-api": "sess-gapi",
      openrouter: "sess-or",
      ollama: "sess-ol",
    });
    for (const provider of [
      "kimi",
      "opencode",
      "anthropic",
      "openai",
      "gemini-api",
      "openrouter",
      "ollama",
    ] as const) {
      expect(resumeSessionIdFor(provider, sessions), provider).toBeNull();
    }
  });

  it("never leaks another provider's session id", () => {
    // A codex UUID must not ride into `claude --resume` (and vice versa).
    const sessions = sessionsWith({ codex: "codex-uuid-1" });
    expect(resumeSessionIdFor("claude", sessions)).toBeNull();
    expect(resumeSessionIdFor("gemini", sessions)).toBeNull();
    expect(resumeSessionIdFor("codex", sessions)).toBe("codex-uuid-1");
  });

  it("falls back to the legacy claude-only column for claude ONLY", () => {
    const empty = EMPTY_PROVIDER_SESSIONS;
    expect(resumeSessionIdFor("claude", empty, "legacy-claude-id")).toBe("legacy-claude-id");
    expect(resumeSessionIdFor("codex", empty, "legacy-claude-id")).toBeNull();
    expect(resumeSessionIdFor("gemini", empty, "legacy-claude-id")).toBeNull();
  });

  it("prefers the per-provider map over the legacy column", () => {
    const sessions = sessionsWith({ claude: "map-wins" });
    expect(resumeSessionIdFor("claude", sessions, "legacy-loses")).toBe("map-wins");
  });

  it("returns null on cold start (no sessions anywhere)", () => {
    expect(resumeSessionIdFor("claude", EMPTY_PROVIDER_SESSIONS)).toBeNull();
    expect(resumeSessionIdFor("codex", EMPTY_PROVIDER_SESSIONS, null)).toBeNull();
  });
});
