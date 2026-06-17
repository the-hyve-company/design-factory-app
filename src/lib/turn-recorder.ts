// turn-recorder.ts — per-turn observability buffer.
//
// Captures every SSE event + state transition + side-effect for the
// CURRENT turn so debug surfaces (TurnTimelinePanel, drawer dump,
// provider matrix runner) can render a complete timeline.
//
// Two-layer storage:
//   1. Active ring (in-memory, capped) — drives the live timeline panel.
//   2. Persisted log — when the turn ends, the whole ring flushes to
//      `.df/sessions/{turnId}.sse.jsonl` so it survives F5 + can be
//      attached to bug reports.
//
// Each entry is a tagged event:
//   ts      monotonic ms relative to turn start
//   scope   "sse" | "tool" | "iframe" | "persist" | "hydrate" | "artifact" | "client"
//   kind    short event name within the scope
//   detail  optional payload (kept small — we ring 500 entries max)

import { pushDiag, type DiagLevel } from "./diagnostics";

export type TurnRecScope =
  | "sse" // raw event from /{provider}/stream
  | "tool" // onToolCall / onToolResult / liveTools snapshot
  | "iframe" // hydrate attempts (toolResult retry, onDone sweep, safety effect)
  | "persist" // appendChatTurn / writeChatSnapshot / saveMessageStructured
  | "hydrate" // chat-load on boot
  | "artifact" // parseArtifact results
  | "client"; // UX-side state (handleSend, setIframeHtml, etc.)

export interface TurnRecEntry {
  /** Monotonic ms relative to recorder.start(). */
  ts: number;
  scope: TurnRecScope;
  kind: string;
  level: DiagLevel;
  detail?: Record<string, unknown>;
}

interface TurnRecord {
  turnId: string;
  provider: string | null;
  model: string | null;
  startedAt: number; // epoch ms
  entries: TurnRecEntry[];
  closed: boolean;
  closedAt?: number;
}

const MAX_ENTRIES_PER_TURN = 500;
const MAX_RECENT_TURNS = 5;

let current: TurnRecord | null = null;
const recent: TurnRecord[] = [];
const listeners = new Set<(turn: TurnRecord | null) => void>();

function notify() {
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* noop */
    }
  }
}

export function startTurn(
  turnId: string,
  opts: { provider?: string | null; model?: string | null } = {},
): void {
  // If a previous turn was left open, close it first so the ring rolls.
  if (current && !current.closed) {
    endTurn({ reason: "superseded" });
  }
  current = {
    turnId,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    startedAt: Date.now(),
    entries: [],
    closed: false,
  };
  notify();
}

export function record(
  scope: TurnRecScope,
  kind: string,
  detail?: Record<string, unknown>,
  opts: { level?: DiagLevel; turnId?: string } = {},
): void {
  // No active turn → swallow silently. Recorder is best-effort observability,
  // never blocks the call site. (We still mirror to diagnostics so the entry
  // shows up in the global drawer.)
  const level: DiagLevel = opts.level ?? "info";
  pushDiag(level, scope, kind, detail);
  if (!current) return;
  // turnId guard — if a stale handler tries to log against an old turn,
  // skip silently rather than polluting the active recording.
  if (opts.turnId && opts.turnId !== current.turnId) return;
  const entry: TurnRecEntry = {
    ts: Date.now() - current.startedAt,
    scope,
    kind,
    level,
    detail,
  };
  current.entries.push(entry);
  if (current.entries.length > MAX_ENTRIES_PER_TURN) {
    current.entries.splice(0, current.entries.length - MAX_ENTRIES_PER_TURN);
  }
  notify();
}

export function endTurn(opts: { reason?: string } = {}): TurnRecord | null {
  if (!current) return null;
  current.closed = true;
  current.closedAt = Date.now();
  if (opts.reason) {
    current.entries.push({
      ts: current.closedAt - current.startedAt,
      scope: "client",
      kind: `turn_end:${opts.reason}`,
      level: "info",
    });
  }
  // Push to recent ring + persist to disk (fire-and-forget; the recorder
  // never blocks the chat path).
  recent.unshift(current);
  if (recent.length > MAX_RECENT_TURNS) recent.pop();
  void persistTurn(current).catch(() => {
    /* swallow — observability never breaks */
  });
  const finished = current;
  current = null;
  notify();
  return finished;
}

export function getCurrentTurn(): TurnRecord | null {
  return current ? { ...current, entries: [...current.entries] } : null;
}

export function getRecentTurns(): TurnRecord[] {
  return recent.map((r) => ({ ...r, entries: [...r.entries] }));
}

export function subscribe(listener: (turn: TurnRecord | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Persistence ──────────────────────────────────────────────────────
// Writes the closed turn record to .df/sessions/{turnId}.sse.jsonl via
// the daemon's /fs/write endpoint. Bug reports can attach this file and
// the matrix runner can replay it offline. Best-effort only.

async function persistTurn(turn: TurnRecord): Promise<void> {
  if (typeof window === "undefined") return;
  // Lazily import to avoid circular dep on claude-bridge.
  const { BRIDGE_URL, writeFile, fetchWorkspaceInfo } = await import("@/lib/claude-bridge");
  if (!BRIDGE_URL) return;
  // Project slug comes from the active project context, which we don't
  // have here directly. The host (EditorScreen) calls attachProjectSlug()
  // when the recorder boots so we know where to write. If unset, drop
  // the persist step (in-memory ring still works for the live panel).
  if (!activeSlug) return;
  // OSS prep 2026-05-21: workspace root comes from the bridge so the
  // session file lands wherever the project lives, not at the literal
  // the absolute path used by a particular dev container.
  // The lookup is cheap (single GET, bridge memoizes) and falls back
  // to a relative path if the bridge can't answer.
  const info = await fetchWorkspaceInfo().catch(() => null);
  const projectsDir = info?.projectsDir ?? "projects";
  const path = `${projectsDir.replace(/\/$/, "")}/${activeSlug}/.df/sessions/${turn.turnId}.jsonl`;
  const body =
    turn.entries
      .map((e) =>
        JSON.stringify({
          ts: e.ts,
          scope: e.scope,
          kind: e.kind,
          level: e.level,
          detail: e.detail,
        }),
      )
      .join("\n") + "\n";
  await writeFile(path, body).catch(() => {
    /* swallow */
  });
}

let activeSlug: string | null = null;
export function attachProjectSlug(slug: string | null): void {
  activeSlug = slug;
}
