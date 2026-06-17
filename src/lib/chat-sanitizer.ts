// Chat snapshot sanitizer — extracted from EditorScreen so the
// invariants can be tested in isolation.
//
// The function is run at chat-load time on persisted message arrays.
// Three sweeps (in order):
//   1. EMPTY assistant messages — drop if no signal at all, OR keep
//      with "[empty response]" marker if provider/model metadata exists.
//      (regression report): some providers complete
//      without firing onText or Write — the persisted turn.ai ends up
//      text:"". Old behavior dropped those entirely → user saw their own
//      message but no assistant reply. New behavior: keep the turn
//      visible with a marker IF metadata proves the turn actually
//      happened.
//
//      1 stabilize (regression report follow-up): the daemon
//      now emits `event: error` instead of silent done({content: ""}) for
//      empty completions, so newly-persisted turns enter as `[error] ...`
//      bubbles directly. The "[empty response]" marker remains as a
//      backstop for LEGACY persisted records (pre-) that already
//      have text:"" on disk — sanitizer keeps them visible so reload
//      doesn't silently drop them.
//   2. DEDUP by (turn_id, role, first 60 chars of text). Kills the
//      double-submit duplicates user hit on reels2.
//   3. LEAKED HTML COLLAPSE — assistant messages > 8KB that start with
//      doctype/html/```html are the "AI streamed file content as prose
//      instead of using Write" pattern. Replace with a placeholder so
//      the chat panel stays readable.

// Marker text used when an assistant turn finished without producing
// content but had provider/model metadata proving the call happened.
// Exported as a constant so call sites (ChatMessage error-bubble matcher)
// don't duplicate the literal — keeps both ends in sync if we ever change
// the wording.
export const EMPTY_RESPONSE_MARKER = "[empty response]";

/**
 * Stable check for assistant turns sanitized to the empty-response marker.
 * Trims to tolerate stray whitespace from rehydration paths but keeps the
 * comparison strict (case-sensitive, no fuzzy matching).
 */
export function isEmptyResponseMarker(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim() === EMPTY_RESPONSE_MARKER;
}

// Stream Lifecycle audit (PR #120): markers used when the idle watchdog
// terminates a stream (INTERRUPTED) or when the provider sends `done`
// with a suspiciously thin payload (TRUNCATED). Both render through the
// same error-bubble path as EMPTY_RESPONSE_MARKER, with distinct title
// + retry CTA copy.
export const INTERRUPTED_RESPONSE_MARKER = "[response interrupted]";
export const TRUNCATED_RESPONSE_MARKER = "[response truncated]";

export function isInterruptedResponseMarker(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim() === INTERRUPTED_RESPONSE_MARKER;
}
export function isTruncatedResponseMarker(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim() === TRUNCATED_RESPONSE_MARKER;
}

// Minimal shape — the real ChatMessage carries more fields but this is
// all the sanitizer reads. Kept structural (no index signature) so call
// sites can pass their concrete ChatMessage type without the index
// signature compatibility check biting.
export interface SanitizableChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: unknown[];
  isDesign?: boolean;
  provider?: string;
  model?: string;
  turn_id?: string;
}

export function sanitizeMessages<T extends SanitizableChatMessage>(
  msgs: ReadonlyArray<T>,
): { messages: T[]; cleaned: number } {
  const out: T[] = [];
  const seen = new Set<string>();
  let cleaned = 0;
  for (const m of msgs) {
    const text = (m.text ?? "").trim();
    const tools = m.tools ?? [];
    if (m.role === "assistant" && !text && tools.length === 0 && !m.isDesign) {
      // : keep the turn visible if metadata proves it happened.
      if (m.provider || m.model) {
        out.push({ ...m, text: EMPTY_RESPONSE_MARKER });
        continue;
      }
      cleaned++;
      continue;
    }
    const key = `${m.turn_id ?? ""}|${m.role}|${text.slice(0, 60)}`;
    if (seen.has(key)) {
      cleaned++;
      continue;
    }
    seen.add(key);
    if (m.role === "assistant" && text.length > 8000) {
      const head = text.slice(0, 200);
      const looksLikeHtml =
        /^<!doctype/i.test(head) || /^<html/i.test(head) || /^```html/i.test(head);
      if (looksLikeHtml) {
        cleaned++;
        out.push({
          ...m,
          text: `[Leaked HTML output collapsed — ${(text.length / 1024).toFixed(0)}KB. The Write tool wasn't used. File on disk is canonical.]`,
        });
        continue;
      }
    }
    out.push(m);
  }
  return { messages: out, cleaned };
}
