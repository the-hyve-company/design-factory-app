// stream-lifecycle.ts — idle watchdog + suspicious-done detection.
//
// Audit verdict 2026-05-08, post-#118 review (Stream Lifecycle audit).
// User repro on project 3d21:
//
//   turn t1778263371490 — assistant text "Você" (4 chars), status done,
//                         zero tools.
//                         → provider stream cut off after the first
//                           token but signalled `done`. UI marked the
//                           turn as complete; no Edit fired so the HTML
//                           never changed.
//
//   turn t1778267104005 — assistant text 1710 chars, streaming TRUE
//                         forever, 6 tools dispatched, 1 Edit.
//                         → stream stalled mid-response. UI showed
//                           Thinking… indefinitely.
//
// Two distinct failure modes, two complementary detectors:
//
//   * idle watchdog       — clock since last observable event
//                           (text / tool_call / tool_result / meta / usage).
//                           If the silence exceeds the threshold while
//                           status is "streaming", terminate the stream
//                           and surface `status: "interrupted"`.
//   * suspicious-done     — terminal `done` event whose payload is too
//                           thin to be a real answer. Surface a flag
//                           the chat surface can read to render a
//                           "resposta possivelmente cortada" banner
//                           with Retry.
//
// We do NOT auto-retry. The auditor explicitly flagged that as a
// follow-up — a watchdog that retries on its own can mask provider
// rate-limits or misconfiguration. The user gets the choice.

/** Default ceiling for stream silence before the watchdog fires.
 *  90 seconds covers normal model "thinking" pauses (Claude Opus
 *  extended thinking can sit silent 30-60s before the first token)
 *  with comfortable headroom. Overrideable per-call so tests can
 *  use 50ms and prod can ramp this up if needed. */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;

/** Heuristics for "this `done` looks suspicious". Calibrated against the
 *  3d21 repro: a 4-char response with zero tools is clearly a truncation,
 *  but legitimate short answers exist ("ok", "yes", "feito"). The thresholds
 *  below treat anything under 50 chars + zero tools as suspicious; longer
 *  answers, or any tool call, exempt the turn. The user can dismiss the
 *  banner if the short reply was intended. */
export const SUSPICIOUS_TEXT_CHAR_LIMIT = 50;

export interface SuspiciousDoneInput {
  /** Final text the model emitted. Empty string and undefined treated the
   *  same — both indicate truncation. */
  text: string | null | undefined;
  /** Number of tool_call events the stream produced. A turn that fired
   *  any tool is by definition not a one-token cutoff. */
  toolCount: number;
  /** Original prompt the user sent. We exempt trivial prompts (single
   *  word, "?") since the AI giving a short answer there is reasonable. */
  promptText?: string | null;
}

/**
 * Decide whether a terminal `done` event looks like a stream truncation
 * masquerading as a complete response. Heuristic — caller surfaces a
 * UI banner, never auto-retries.
 *
 *   isSuspiciousDone({ text: "Você", toolCount: 0,
 *                       promptText: "tem algo errado, …" })  → true
 *   isSuspiciousDone({ text: "ok", toolCount: 0,
 *                       promptText: "?" })                    → false
 *   isSuspiciousDone({ text: "x", toolCount: 1 })             → false
 */
export function isSuspiciousDone(input: SuspiciousDoneInput): boolean {
  const text = (input.text ?? "").trim();
  // Any tool call exempts — the turn produced concrete side effects.
  if (input.toolCount > 0) return false;
  // The text exceeds the truncation threshold.
  if (text.length >= SUSPICIOUS_TEXT_CHAR_LIMIT) return false;
  // Trivial prompts (less than ~5 chars or all whitespace/punct) get a
  // legitimate short reply — don't cry wolf.
  const prompt = (input.promptText ?? "").trim();
  if (prompt.length > 0 && prompt.length < 5) return false;
  if (prompt.length > 0 && /^[\?\!\.\s]+$/.test(prompt)) return false;
  return true;
}

/** Lifecycle state surfaced to the UI. Mirrors AiStatus from chat-turns
 *  but carries extra info the in-memory hook needs while a stream is
 *  live. The persisted journal still uses AiStatus values; this is just
 *  the runtime view. */
export type StreamLifecycleStatus = "idle" | "streaming" | "done" | "error" | "interrupted";

/** Watchdog state — caller (useClaude) keeps a single instance per
 *  active stream and resets it on each observable event. */
export interface IdleWatchdog {
  /** Touch the watchdog: extends the deadline by another timeout
   *  window. Called from every onText / onToolCall / etc. */
  bump: () => void;
  /** Stop the watchdog. Idempotent. Caller MUST invoke this on done /
   *  error / cancel paths so a finished stream can't fire interrupt. */
  stop: () => void;
}

/** Build an idle watchdog. The timeout fires once when the silence
 *  window elapses; subsequent silence does not re-fire (the caller is
 *  expected to terminate the stream on the first interrupt). */
export function createIdleWatchdog(
  onIdleTimeout: () => void,
  timeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): IdleWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      try {
        onIdleTimeout();
      } catch {
        /* swallow — caller decides */
      }
    }, timeoutMs);
  };

  arm();

  return {
    bump: arm,
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
