/**
 * error-surface.ts — Central error reporting.
 *
 * Replaces silent `.catch(() => {})` on critical paths with
 * `.catch((e) => surfaceError(e, "context"))`. The error gets:
 *   1. Logged with context (so devtools console shows where it came from)
 *   2. Forwarded to a global listener that can render a toast (mounted
 *      by App.tsx)
 *   3. Counted (so we can surface "12 silent errors in this session"
 *      if we ever want to)
 *
 * Use it for any failure that:
 *   - The user can't see the consequence of (silent persist fail, etc)
 *   - Could indicate corrupted data
 *   - Affects state we expect to be reliable
 *
 * Don't use it for errors that already have UI feedback (chat error
 * messages, generation failures rendered in the bubble, etc).
 */

export type ErrorSeverity = "info" | "warn" | "error";

export interface SurfacedError {
  ts: number;
  context: string;
  severity: ErrorSeverity;
  message: string;
  detail?: unknown;
}

type Listener = (err: SurfacedError) => void;

const listeners = new Set<Listener>();
const recent: SurfacedError[] = [];
const RECENT_CAP = 50;

function pushRecent(err: SurfacedError) {
  recent.push(err);
  if (recent.length > RECENT_CAP) recent.shift();
}

/**
 * Subscribe to surfaced errors. Returns an unsubscriber. Used by the
 * toast component (or any future telemetry hook) to render or report.
 */
export function onSurfacedError(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Last N surfaced errors. Useful for a diagnostics drawer. */
export function getRecentErrors(): SurfacedError[] {
  return [...recent];
}

/**
 * Surface an error. Logs to console + notifies listeners + records.
 * Pass `context` describing where it happened ("appendChatTurn",
 * "writeProjectMeta", etc) — that's what the user sees in the toast.
 */
export function surfaceError(e: unknown, context: string, severity: ErrorSeverity = "error"): void {
  const message = extractMessage(e);
  const entry: SurfacedError = {
    ts: Date.now(),
    context,
    severity,
    message,
    detail: e,
  };
  pushRecent(entry);
  // Always log — devtools is the first stop for debugging.
  if (severity === "error") {
    console.error(`[surfacedError] ${context}:`, message, e);
  } else if (severity === "warn") {
    console.warn(`[surfacedError] ${context}:`, message, e);
  } else {
    console.log(`[surfacedError] ${context}:`, message);
  }
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* listener bug shouldn't kill the chain */
    }
  }
}

/**
 * Wrap a Promise so any rejection is surfaced (and the original error
 * is re-thrown). Convenience for one-liners:
 *
 *   await trace(appendChatTurn(...), "appendChatTurn");
 */
export async function trace<T>(p: Promise<T>, context: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    surfaceError(e, context);
    throw e;
  }
}

/**
 * Wrap a Promise; on rejection, surface AND return the fallback. Used
 * when we want to keep going (the previous `.catch(() => {})` patterns)
 * but also want the failure visible.
 *
 *   const ok = await traceOr(appendChatTurn(...), false, "appendChatTurn");
 */
export async function traceOr<T>(p: Promise<T>, fallback: T, context: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    surfaceError(e, context);
    return fallback;
  }
}

/**
 * Catch handler factory for fire-and-forget persistence writes — replaces
 * the `.catch(() => {})` pattern the audit Fase 1 #2 verdict flagged as
 * silent data loss. `warn(ctx)` returns a handler for `.catch(...)` that
 * surfaces the failure with severity "warn" (toast + devtools log)
 * without re-throwing, so the calling code keeps its fire-and-forget
 * shape:
 *
 *   db.setSetting("model", m).catch(warn("setSetting:model"));
 *
 * Use this wherever the failure is non-fatal (cache writes, settings
 * updates, history snapshots) but must not vanish from the operator's
 * view. For fatal writes use `surfaceError` directly with severity
 * "error" so the toast carries the right visual weight.
 */
export function warn(context: string): (e: unknown) => void {
  return (e: unknown) => surfaceError(e, context, "warn");
}

function extractMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
