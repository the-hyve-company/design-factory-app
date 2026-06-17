// Turn-based chat schema. Each user prompt + AI response is one record on
// disk (one JSONL line). Replaces the per-message format where each line
// was a single role's bubble — that schema couldn't represent tool-only
// AI turns, lost verb metadata, and stripped tool chips on reload, leaving
// the user with chats that read "as if Claude never executed" after a
// page refresh.

export interface ToolUseRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: string; isError: boolean };
  /** F2.2 — Wall-clock ms when the tool_call landed. Used by the chat UI
   *  to render a relative t+X.Xs chip on each tool. Persisted with the
   *  turn so reload preserves the timeline. Optional for legacy turns. */
  startedAt?: number;
}

export interface VerbRef {
  id: string;
  label: string;
  category: string;
  modifiesHtml: boolean;
}

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  /** Discriminator that drives the chip glyph and chip behavior.
   *  Optional for legacy attachments without `kind` — older turns
   *  persisted only the fields above. */
  kind?: "image" | "text" | "html" | "binary";
  /** Absolute on-disk path for files written to attachments/ — opaque to UI. */
  path?: string;
  /** Inline content for text/html attachments (kept under 500kb). Omitted
   *  for image attachments (path is canonical). */
  content?: string;
}

// AiStatus — the canonical lifecycle of an AI turn. Kept in lockstep
// with TurnAiSchema status enum in src/lib/schemas.ts; a parity gate
// in chat-journal-gate.test.ts asserts both lists match. "interrupted"
// is reserved for the stream-lifecycle audit (idle-watchdog) — it
// distinguishes a stream we forcibly terminated (via timeout / user
// cancel of UI) from a stream the user explicitly cancelled
// ("cancelled") or the provider returned an error on ("error").
export type AiStatus = "running" | "done" | "error" | "cancelled" | "interrupted";

export interface Turn {
  id: string;
  ts: number;
  user: {
    text: string;
    verb?: VerbRef | null;
    attachments?: Attachment[];
  };
  /** null while user just sent and the AI side hasn't materialized yet. */
  ai: {
    text: string;
    tools: ToolUseRecord[];
    /** — canonical tool events (provider-tagged). Optional on
     * disk so earlier turns still parse; backfilled at read-time
     *  by `migrateLegacyToolEvents` from the legacy `tools` ledger when
     *  missing. New turns written after carry both. */
    toolEvents?: import("@/runtime/tool-events").NormalizedToolEvent[];
    /** Provider Handoff Layer v1: which model produced this turn.
     *  Optional so older turns on disk (pre-v1) still parse. */
    provider?: import("./schemas").ProviderIdValue;
    /** Specific model id within the provider (e.g. "claude-opus-4-7"). */
    model?: string;
    /** Hash / id linking to the version history snapshot taken at the end
     *  of this turn. Lets the chat "Restore this state" action revert the
     *  iframe to exactly what the design looked like right after this turn. */
    html_snapshot_id?: string;
    duration_ms?: number;
    tokens?: { in?: number; out?: number };
    cost_usd?: number;
    /** F1.1 — Time-to-first-token (ms). Optional; older turns and
     *  providers without TTFT telemetry leave this undefined. */
    ttft_ms?: number;
    /** Marker for the "Design generated" terminal — the iframe was updated
     *  by this turn. UI shows a "Design updated" affordance when true. */
    is_design?: boolean;
    status: AiStatus;
    /** When the turn was created via "Restore from turn X" action. */
    error?: string;
  } | null;
  /** Set when this turn is a no-op marker created by the Restore action.
   *  UI renders these as a thin "rolled back to turn X" line, not a card. */
  restored_from?: string;
}

/** Type-narrowing helper for raw lines — accepts either the new turn shape
 *  or the legacy `{role, text, ts, is_design?}` shape. */
type RawLine =
  | (Partial<Turn> & { id?: string; user?: unknown; ai?: unknown })
  // Accept both modern ("assistant") and legacy ("claude") roles. The
  // assistant branch in legacyLinesToTurns auto-handles both because old
  // disk lines get migrated to "assistant" before parsing (see
  // migrateLegacyChatMessage).
  | {
      role?: "user" | "assistant" | "claude";
      text?: string;
      ts?: number;
      is_design?: boolean;
      parts_json?: string;
    };

/** Detect whether a parsed JSONL line is in the new turn format. */
export function isTurnLine(raw: unknown): raw is Turn {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.user === "object" && r.user !== null;
}

/** Convert a stream of legacy `{role, text}` lines into Turn records. Pairs
 *  consecutive `user → claude` messages into one turn. Unpaired user lines
 *  (no following claude) become a turn with `ai = null`. Multiple claude
 *  lines following a user collapse into a single ai with the last line's
 *  text + is_design flag.
 *
 *  Stable-ish ts: the turn's ts is the user's ts; the ai's duration is
 *  derived as (last_claude_ts - user_ts) when both exist.
 */
export function legacyLinesToTurns(lines: ReadonlyArray<RawLine>): Turn[] {
  const turns: Turn[] = [];
  let pending: Turn | null = null;
  for (const raw of lines) {
    if (!raw) continue;
    if ("role" in raw && raw.role === "user") {
      // Flush any pending unfinalized turn (no ai yet) before opening a new one.
      if (pending) turns.push(pending);
      pending = {
        id: `legacy-${raw.ts ?? Date.now()}-${turns.length}`,
        ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
        user: { text: typeof raw.text === "string" ? raw.text : "" },
        ai: null,
      };
      continue;
    }
    if ("role" in raw && (raw.role === "assistant" || raw.role === "claude")) {
      if (!pending) {
        // Orphan assistant (no preceding user) — wrap it in a turn with empty
        // user text. Rare but possible in legacy logs.
        pending = {
          id: `legacy-orphan-${raw.ts ?? Date.now()}-${turns.length}`,
          ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
          user: { text: "" },
          ai: null,
        };
      }
      const claudeText = typeof raw.text === "string" ? raw.text : "";
      const isDesign = !!raw.is_design;
      const claudeTs = typeof raw.ts === "number" ? raw.ts : pending.ts;
      // Append to existing ai if present, else create.
      if (pending.ai) {
        pending.ai.text = pending.ai.text ? `${pending.ai.text}\n\n${claudeText}` : claudeText;
        if (isDesign) pending.ai.is_design = true;
      } else {
        pending.ai = {
          text: claudeText,
          tools: [],
          is_design: isDesign,
          status: "done",
          duration_ms: claudeTs - pending.ts,
        };
      }
    }
  }
  if (pending) turns.push(pending);
  return turns;
}

/** Normalize raw lines (mixed legacy + turn) into Turn[]. */
export function parseChatJsonl(rawLines: ReadonlyArray<unknown>): Turn[] {
  // Bucket into runs of new-format vs legacy. We don't expect interleaving
  // in practice (a file is either one format or the other after migration),
  // but handle it defensively.
  const out: Turn[] = [];
  let legacyBuffer: RawLine[] = [];
  const flushLegacy = () => {
    if (legacyBuffer.length === 0) return;
    out.push(...legacyLinesToTurns(legacyBuffer));
    legacyBuffer = [];
  };
  for (const raw of rawLines) {
    if (isTurnLine(raw)) {
      flushLegacy();
      out.push(raw);
    } else if (raw && typeof raw === "object") {
      legacyBuffer.push(raw as RawLine);
    }
  }
  flushLegacy();
  // Dedupe by id — keep the LAST occurrence so an end-of-stream write
  // overrides the start-of-turn placeholder. Map preserves first-seen
  // insertion order, so chronological order of turns is unchanged.
  // Required by the journal-first persistence contract (audit verdict
  // 2026-05-08): handleSend writes a turn with ai:null when the user
  // sends, then the same id is appended again with ai:{status:done}
  // when the stream finishes. Without dedup the chat would render two
  // bubbles per turn.
  const byId = new Map<string, Turn>();
  for (const t of out) byId.set(t.id, t);
  return Array.from(byId.values());
}

/** Cheap uuid v4-ish — no `crypto.randomUUID` dep so it works in older Tauri
 *  + bare Node bridge contexts. Good enough for chat turn ids. */
export function turnId(): string {
  // 8-4-4-4-12 hex
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(8)}${hex(4)}`;
}
