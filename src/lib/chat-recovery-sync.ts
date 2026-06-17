// chat-recovery-sync.ts — Fase 2 of the audit verdict (2026-05-08).
//
// Closes the last gap that kept "chat persistence perfect" out of reach
// after PRs #108–#112: turns mirrored into localStorage during a daemon
// outage stayed there forever. This worker iterates every recovery
// entry, replays it through `appendChatTurn`, and clears the entry when
// the daemon accepts the write. Failures stay queued and get a fresh
// shot on the next trigger.
//
// Triggers (any of these fires a sync):
//   1. App boot — `startRecoverySync()` is called once from the App
//      mount. If the daemon was already up, the queue empties before
//      the user notices.
//   2. window focus — when the user tab-switches back, the daemon may
//      have come online in the interim.
//   3. window `online` event — browser-level network coming back.
//
// We don't poll. The triggers above cover the common reconnect cases;
// a polling loop would burn cycles and battery for the rare case of
// "daemon restarted while the user stared at the tab".
//
// Sync is throttled per call: at most one inflight pass at a time
// (re-entry returns immediately) and entries are flushed sequentially
// with a small delay between writes so a backlog doesn't hammer the
// daemon. The sequential write is intentional — appendChatTurn appends
// to a JSONL on disk and we want the on-disk order to match the queue
// order.

import { listAllPendingRecovery, clearRecovery } from "./chat-recovery";
import { appendChatTurn } from "./claude-bridge";
import { surfaceError } from "./error-surface";

let syncing = false;
let lastSyncAt = 0;
let lastResult: SyncReport | null = null;

export interface SyncReport {
  attempted: number;
  flushed: number;
  remaining: number;
  startedAt: number;
  finishedAt: number;
}

interface SyncOptions {
  /** Wait between writes when the queue has multiple entries. Keeps
   *  the daemon from getting hammered if a long outage left dozens
   *  of pending turns. Default 50ms (effectively off for a few entries,
   *  meaningful for backlogs). */
  delayBetweenMs?: number;
}

/**
 * Run one pass of the recovery queue. Returns a small report so callers
 * can surface "synced N turns" telemetry if they want. Re-entry while a
 * pass is already running returns the most recent report unchanged —
 * we never queue two concurrent passes against the same disk JSONL.
 */
export async function syncRecoveryQueue(opts: SyncOptions = {}): Promise<SyncReport> {
  if (syncing) {
    return (
      lastResult ?? {
        attempted: 0,
        flushed: 0,
        remaining: 0,
        startedAt: lastSyncAt,
        finishedAt: lastSyncAt,
      }
    );
  }
  syncing = true;
  const startedAt = Date.now();
  lastSyncAt = startedAt;
  let attempted = 0;
  let flushed = 0;

  try {
    const pending = listAllPendingRecovery();
    const delayMs = opts.delayBetweenMs ?? 50;
    for (const entry of pending) {
      // Entries written before Fase 2 may not carry slug — we can't
      // replay those without a projectId→slug lookup, so they stay
      // queued. They'll be flushed when the user revisits the project
      // (the chat-load path can clean them) or a future migration adds
      // slug backfill. For now: skip silently — they aren't lost, just
      // dormant.
      if (!entry.slug) continue;
      attempted++;
      try {
        const ok = await appendChatTurn(entry.slug, entry.threadId, entry.turn);
        if (ok) {
          // The recoveryKey uses projectId, not slug — clear by the
          // same key composition we used to write.
          const projectIdForKey = entry.projectId === "none" ? null : entry.projectId;
          clearRecovery(projectIdForKey, entry.threadId, entry.turn.id);
          flushed++;
        }
      } catch (e) {
        surfaceError(e, `syncRecoveryQueue(${entry.slug}/${entry.threadId})`, "warn");
      }
      if (delayMs > 0 && pending.length > 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const remaining = listAllPendingRecovery().length;
    const finishedAt = Date.now();
    const report: SyncReport = { attempted, flushed, remaining, startedAt, finishedAt };
    lastResult = report;
    return report;
  } finally {
    syncing = false;
  }
}

/**
 * Wire the three recovery triggers (boot, focus, online) and run an
 * immediate boot-time pass. Returns a teardown handler so callers
 * (App.tsx mount effect) can unwire on unmount. Calling more than once
 * stacks listeners — App should call exactly once at the root.
 */
export function startRecoverySync(): () => void {
  // Run the boot pass without awaiting — we don't want to block the
  // initial render on disk writes that may take a moment.
  void syncRecoveryQueue();

  const onFocus = () => {
    void syncRecoveryQueue();
  };
  const onOnline = () => {
    void syncRecoveryQueue();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    }
  };
}

/** Diagnostic — exposed for tests + a future "recovery status" UI panel. */
export function lastSyncReport(): SyncReport | null {
  return lastResult;
}
