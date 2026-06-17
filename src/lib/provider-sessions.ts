// provider-sessions.ts — simplified sticky session storage.
//
// Reads/writes `.df/provider-sessions.json` for a project. dropped
// the entire Provider Handoff Layer v3 machinery (multi-file aware
// state, layered identity/project/artifact/conversation handoff,
// canonical preamble injection) — the user doesn't use those
// features and Anthropic API is stateless anyway.
//
// What remains: a tiny per-provider sessionId map that the wrapper uses
// to forward `--resume` to providers that support it (Claude). The
// "Fresh session" UI affordance still wipes it when the s.
//
// File shape (v1, the only shape reads/writes):
//   {
//     "version": 1,
//     "sessions": {
//       "claude": { sessionId, created_at, last_used_at, artifact_version_seen },
//       "codex": ...
//     }
//   }
//
// Backward-compat: older session files have the same outer
// envelope (`{ version, sessions }`). When reads a v3 file, the v3
// `sessions` keyed by `${provider}:${slug}:${thread}` are silently
// ignored — reads the v1 `sessions[provider]` shape only. A
// write replaces the file with v1 shape; the v3 keys become orphans
// (zero impact — no consumer reads them anymore).

import {
  ProviderSessionsSchema,
  ProviderSessionEntrySchema,
  type ProviderSessions,
  type ProviderSessionEntry,
  safeRead,
  safeWriteOrThrow,
  type ProviderIdValue,
} from "@/lib/schemas";

// Bridge URL is owned by claude-bridge — import it directly. A previous
// inline copy ignored `import.meta.env.VITE_BRIDGE_URL`, so every fetch
// defaulted to http://localhost:1421 even when dev-web reclaimed a
// different port — causing indefinite hangs when port 1421 was held by
// another process (e.g. VS Code) that doesn't speak HTTP. No import cycle:
// claude-bridge does not import provider-sessions.
import { BRIDGE_URL } from "@/lib/claude-bridge";

export const EMPTY_PROVIDER_SESSIONS: ProviderSessions = {
  version: 1,
  sessions: {},
};

/**
 * Read `.df/provider-sessions.json`. Tolerant of older files written by
 * older builds — when a v3 envelope is detected, the function returns
 * the v1 shape (empty `sessions` if the v3 file has no v1 entries).
 * The next write replaces the file with canonical v1 shape.
 */
export async function readProviderSessions(slug: string): Promise<ProviderSessions> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/provider-sessions?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return EMPTY_PROVIDER_SESSIONS;
    const data = (await r.json().catch(() => null)) as { sessions?: unknown } | null;
    if (!data?.sessions) return EMPTY_PROVIDER_SESSIONS;
    const v1 = safeRead(ProviderSessionsSchema, data.sessions, `readProviderSessions(${slug})`);
    return v1 ?? EMPTY_PROVIDER_SESSIONS;
  } catch {
    return EMPTY_PROVIDER_SESSIONS;
  }
}

/**
 * Write the v1 shape. Always writes v1 — has no v3 writer. Returns
 * true on HTTP 2xx; false on schema failure or network error.
 */
export async function writeProviderSessions(
  slug: string,
  sessions: ProviderSessions,
): Promise<boolean> {
  try {
    safeWriteOrThrow(ProviderSessionsSchema, sessions, `writeProviderSessions(${slug})`);
    const r = await fetch(`${BRIDGE_URL}/fs/provider-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, sessions }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Upsert a single provider's session entry. Touch-only — does not bump
 * artifact_version_seen unless caller sets it.
 */
export async function upsertProviderSession(
  slug: string,
  provider: ProviderIdValue,
  patch: Partial<Omit<ProviderSessionEntry, "created_at">> & {
    sessionId?: string | null;
  },
): Promise<ProviderSessions> {
  const current = await readProviderSessions(slug);
  const now = Date.now();
  const existing = current.sessions[provider];
  const next: ProviderSessionEntry = ProviderSessionEntrySchema.parse({
    sessionId: patch.sessionId ?? existing?.sessionId ?? null,
    created_at: existing?.created_at ?? now,
    last_used_at: now,
    artifact_version_seen: patch.artifact_version_seen ?? existing?.artifact_version_seen ?? 0,
  });
  const updated: ProviderSessions = {
    ...current,
    sessions: { ...current.sessions, [provider]: next },
  };
  await writeProviderSessions(slug, updated);
  return updated;
}

/**
 * Drop a provider's entry — used by the "Fresh session" UI affordance.
 * Next turn from that provider will be a cold start.
 */
export async function clearProviderSession(
  slug: string,
  provider: ProviderIdValue,
): Promise<ProviderSessions> {
  const current = await readProviderSessions(slug);
  if (!current.sessions[provider]) return current;
  const { [provider]: _dropped, ...rest } = current.sessions;
  const updated: ProviderSessions = { ...current, sessions: rest };
  await writeProviderSessions(slug, updated);
  return updated;
}
