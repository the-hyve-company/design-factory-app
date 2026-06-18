// chat-recovery.ts — localStorage fallback for chat turns.
//
// Audit verdict 2026-05-08 Fase 1 #5: when the daemon write fails or
// times out, the turn must still survive a page reload so the user
// doesn't lose the conversation. We mirror the turn into localStorage
// under a per-(projectId, threadId) key and let `persistOrRecoverTurn`
// upstream surface a "recovered" badge to the UI.
//
// Storage shape (one key per project/thread combo):
//
//   key:   df:recovery-chat:{projectId|"none"}:{threadId}
//   value: JSON.stringify({ ts, turns: RecoveryEntry[] })
//
// Each entry carries the full Turn payload so a reconciliation pass on
// next mount can re-attempt the daemon write and, on success, clear the
// entry. The reconciliation worker is Fase 2 — for now we just persist.
//
// We keep the storage limit conservative (200 turns per key, FIFO) so a
// daemon outage on a long-running session can't blow past the 5 MB
// localStorage budget.

import type { Turn } from "./chat-turns";

export type RecoveryReason = "timeout" | "http-fail" | "no-slug" | "exception" | "no-storage";

export interface RecoveryEntry {
  turn: Turn;
  reason: RecoveryReason;
  savedAt: number;
  /** Bridge slug for the project this turn belongs to. Stored alongside
   *  the turn so the Fase 2 sync worker can replay the write to the
   *  daemon without an extra projectId→slug lookup. Older entries
   *  written before Fase 2 may not carry it; the sync worker treats
   *  null/undefined as "skip — not enough info to flush". */
  slug?: string | null;
}

interface RecoveryRecord {
  ts: number;
  turns: RecoveryEntry[];
}

const KEY_PREFIX = "df:recovery-chat";
const MAX_ENTRIES_PER_KEY = 200;

export function recoveryKey(projectId: string | null | undefined, threadId: string): string {
  return `${KEY_PREFIX}:${projectId || "none"}:${threadId}`;
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Probe in case the iframe sandbox blocks writes.
    const probe = `${KEY_PREFIX}:probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function readRaw(s: Storage, key: string): RecoveryRecord {
  const raw = s.getItem(key);
  if (!raw) return { ts: 0, turns: [] };
  try {
    const parsed = JSON.parse(raw) as RecoveryRecord;
    if (!parsed || !Array.isArray(parsed.turns)) return { ts: 0, turns: [] };
    return parsed;
  } catch {
    return { ts: 0, turns: [] };
  }
}

/**
 * Save a turn to the recovery layer. Returns true if the write landed,
 * false if storage is unavailable. Caller decides what status to surface
 * (recovered vs failed) based on the boolean. The `slug` is stored
 * alongside the turn so the Fase 2 sync worker can replay it directly
 * to the daemon without a separate projectId→slug lookup.
 */
export function saveRecovery(
  projectId: string | null | undefined,
  threadId: string,
  slug: string | null | undefined,
  turn: Turn,
  reason: RecoveryReason,
): boolean {
  const s = safeStorage();
  if (!s) return false;
  const key = recoveryKey(projectId, threadId);
  const record = readRaw(s, key);
  // Replace any prior entry for the same turn id (placeholder vs terminal
  // share an id; we keep only the latest write so reconcile flushes one
  // canonical version).
  const filtered = record.turns.filter((e) => e.turn.id !== turn.id);
  filtered.push({ turn, reason, savedAt: Date.now(), slug: slug ?? null });
  // Trim FIFO to stay under the per-key budget.
  const trimmed =
    filtered.length > MAX_ENTRIES_PER_KEY
      ? filtered.slice(filtered.length - MAX_ENTRIES_PER_KEY)
      : filtered;
  try {
    s.setItem(key, JSON.stringify({ ts: Date.now(), turns: trimmed }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Iterate over every recovery entry currently stored under the
 * df:recovery-chat:* namespace. Returns a flat list with key composition
 * preserved so the sync worker can call `clearRecovery` once the daemon
 * accepts the replay. Used by Fase 2 reconcile — Fase 1 callers stay on
 * `readRecovery(projectId, threadId)`.
 */
export interface PendingRecoveryEntry extends RecoveryEntry {
  /** projectId portion of the storage key — may be the literal "none"
   *  for entries saved while no project was active. */
  projectId: string;
  threadId: string;
}

export function listAllPendingRecovery(): PendingRecoveryEntry[] {
  const s = safeStorage();
  if (!s) return [];
  const out: PendingRecoveryEntry[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(`${KEY_PREFIX}:`)) continue;
    // Format: df:recovery-chat:{projectId}:{threadId}
    const tail = key.slice(KEY_PREFIX.length + 1);
    const sep = tail.indexOf(":");
    if (sep < 0) continue;
    const projectId = tail.slice(0, sep);
    const threadId = tail.slice(sep + 1);
    if (!threadId) continue;
    const record = readRaw(s, key);
    for (const entry of record.turns) {
      out.push({ ...entry, projectId, threadId });
    }
  }
  return out;
}

/** Read all pending recovery entries for a project/thread. */
export function readRecovery(
  projectId: string | null | undefined,
  threadId: string,
): RecoveryEntry[] {
  const s = safeStorage();
  if (!s) return [];
  const key = recoveryKey(projectId, threadId);
  return readRaw(s, key).turns;
}

/** Clear a specific turn entry after a successful sync. */
export function clearRecovery(
  projectId: string | null | undefined,
  threadId: string,
  turnId: string,
): void {
  const s = safeStorage();
  if (!s) return;
  const key = recoveryKey(projectId, threadId);
  const record = readRaw(s, key);
  const next = record.turns.filter((e) => e.turn.id !== turnId);
  if (next.length === 0) {
    s.removeItem(key);
    return;
  }
  s.setItem(key, JSON.stringify({ ts: Date.now(), turns: next }));
}

/** Clear every entry for a project/thread (used after full reconcile). */
export function clearAllRecovery(projectId: string | null | undefined, threadId: string): void {
  const s = safeStorage();
  if (!s) return;
  s.removeItem(recoveryKey(projectId, threadId));
}

/** Probe — used by upstream callers that want to render "no-storage"
 *  warnings without each one re-implementing the try/catch. */
export function isRecoveryStorageAvailable(): boolean {
  return safeStorage() !== null;
}
