/**
 * migrations.ts — Transparent migrations for legacy data shapes.
 *
 * As schemas evolve we sometimes need to translate older on-disk
 * representations into the current shape WITHOUT forcing the user to
 * delete or re-create anything. Each migrator below is pure: takes
 * `unknown`, returns the modern shape (or the input unchanged when
 * already modern). Apply BEFORE Zod parsing so safeRead never trips on
 * the legacy fields.
 */

import {
  fromBridgeToolCall,
  fromBridgeToolResult,
  type NormalizedToolEvent,
} from "@/runtime/tool-events";
import type { ProviderId } from "@/providers/types";

/**
 * Migrate legacy ChatMessage shapes to the schema with a provider field.
 *
 * Older entries used `role: "claude"` (the assistant was always
 * Claude). The role enum is now `"user" | "assistant"` and the
 * specific provider lives in a separate `provider` field.
 *
 * Legacy:  { role: "claude", text: "..." }
 * Modern:  { role: "assistant", provider: "claude", text: "..." }
 */
export function migrateLegacyChatMessage(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  if (m.role === "claude") {
    return {
      ...m,
      role: "assistant",
      // Preserve provider when callers already supplied it; default to
      // "claude" because that's what every legacy entry came from.
      provider: typeof m.provider === "string" ? m.provider : "claude",
    };
  }
  return m;
}

/**
 * Apply migrateLegacyChatMessage to a list of cached messages. Returns
 * the same array shape so callers can drop-in replace
 * `JSON.parse(raw)` with `migrateLegacyChatMessages(JSON.parse(raw))`.
 *
 * : also migrates legacy tool events on each message — backfills
 * the canonical `toolEvents` array from the legacy `tools` ledger when
 * the latter is present and the former is missing. See
 * `migrateLegacyToolEvents` below.
 */
export function migrateLegacyChatMessages(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  return input.map((m) => migrateLegacyToolEvents(migrateLegacyChatMessage(m)));
}

/**
 * Migrate legacy tool events into the canonical `toolEvents` envelope.
 *
 * Legacy chat snapshots (cached messages + Turn JSONL) carry `tools`
 * in the bridge's earlier vocabulary:
 *   { id, name, input, result?: { content, isError } }
 *
 * The canonical envelope is `toolEvents: NormalizedToolEvent[]`
 * tagged with provider + timestamp. This function backfills it at
 * read-time so existing chat history renders through the new
 * ToolEventBubble path without requiring the user to delete or
 * re-import anything.
 *
 * Pure and idempotent: a message that already has `toolEvents` is
 * returned unchanged; a message without `tools` is returned unchanged;
 * a message without an identifiable provider defaults to "claude"
 * (the only provider that existed when the legacy `tools` shape was
 * the only shape).
 *
 * Failure mode: malformed `tools` entries are silently dropped from
 * the generated `toolEvents` array — the migrator never throws, and
 * the original `tools` field is left intact so the legacy
 * ToolSummary renderer still works.
 */
export function migrateLegacyToolEvents(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  // Idempotent — already migrated.
  if (Array.isArray(m.toolEvents)) return m;
  // No legacy tools to migrate from.
  if (!Array.isArray(m.tools) || m.tools.length === 0) return m;
  // User messages don't have tools (defensive).
  if (m.role !== "assistant") return m;

  const provider = inferProvider(m);
  const events = buildLegacyToolEvents(m.tools, provider);
  if (events.length === 0) return m;

  return { ...m, toolEvents: events };
}

/**
 * Apply `migrateLegacyToolEvents` to a list. Convenience for call sites
 * that want only the tool-events backfill without the role:"claude"
 * coercion (e.g. Turn JSONL loaders that already speak the modern shape).
 */
export function migrateLegacyToolEventsList(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  return input.map(migrateLegacyToolEvents);
}

// ─── Internals ─────────────────────────────────────────────────────────

const KNOWN_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "claude",
  "codex",
  "gemini",
  "anthropic",
  "ollama",
  "openrouter",
  "opencode",
]);

function inferProvider(m: Record<string, unknown>): ProviderId {
  const raw = m.provider;
  if (typeof raw === "string" && (KNOWN_PROVIDERS as Set<string>).has(raw)) {
    return raw as ProviderId;
  }
  // Heuristic: when the legacy `tools` shape is present but no provider
  // tag, the message came from Claude (the only provider in scope when
  // chat history captured tools as a flat ledger). Spec §
  // failure-mode contract: legacy command_execution names get coerced
  // to "Bash" downstream by canonicalToolName — defaulting to Claude
  // here is safe even for Codex-origin entries because the wire shape
  // matches.
  return "claude";
}

/**
 * Build a canonical `NormalizedToolEvent[]` from a legacy `tools` array.
 * Each entry produces a tool_call envelope, optionally followed by a
 * tool_result/tool_error envelope when the legacy entry carries `result`.
 *
 * Synthetic timestamps are stamped with epoch zero so future re-migration
 * passes can tell the difference between live events (real ISO) and
 * backfilled ones (1970-01-01). UI doesn't surface timestamps yet so this
 * is purely an audit trail for diagnostics.
 */
function buildLegacyToolEvents(tools: unknown[], provider: ProviderId): NormalizedToolEvent[] {
  const out: NormalizedToolEvent[] = [];
  const stamp = () => "1970-01-01T00:00:00.000Z";
  for (const raw of tools) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.name !== "string") continue;
    const input =
      t.input && typeof t.input === "object" && !Array.isArray(t.input)
        ? (t.input as Record<string, unknown>)
        : {};
    const call = fromBridgeToolCall({ id: t.id, name: t.name, input }, provider, { now: stamp });
    if (call) out.push(call);

    const result = t.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      const isError = r.isError === true || r.isError === "true";
      const content = typeof r.content === "string" ? r.content : "";
      const resultEv = fromBridgeToolResult({ id: t.id, isError, content }, provider, {
        now: stamp,
      });
      if (resultEv) out.push(resultEv);
    }
  }
  return out;
}
