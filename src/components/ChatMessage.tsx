import { useMemo, useState } from "react";
import { marked } from "marked";
import { renderMarkdownSafe, sanitizeHtml } from "@/lib/safe-markdown";
import { VerbShader } from "@/components/VerbShaders";
import { ProviderBadge } from "@/components/ProviderBadge";
import { parseQuestions, stripQuestionBlocks, AskUserQuestion } from "@/components/AskUserQuestion";
import { DoneReportPanel } from "@/components/DoneReportPanel";
// ToolEventStream is the canonical per-event ledger (provider tag,
// timestamp, full input/output). It rendered redundantly next to
// ToolSummary for providers that surface a `tools` ledger, so we hide it
// then. But for providers that only emit `toolEvents` (no `tools` summary),
// removing it leaves the user with nothing — restore the compact rendering
// in that fallback case.
import { ToolEventStream } from "@/components/ToolEventBubble";
import type { NormalizedToolEvent } from "@/runtime/tool-events";
import {
  isEmptyResponseMarker,
  isInterruptedResponseMarker,
  isTruncatedResponseMarker,
} from "@/lib/chat-sanitizer";
import { useT } from "@/i18n";
import hljs from "highlight.js/lib/core";
// Common-only pack — keeps bundle reasonable. ~15 languages covers 99% of
// what Claude emits in chat (ts/tsx/jsx/js/html/css/json/bash/py/rust/md/yaml/sql).
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("svg", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("go", go);
hljs.registerLanguage("golang", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("docker", dockerfile);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("patch", diff);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);

export interface ToolUseRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: string; isError: boolean };
  /** F2.2 — Wall-clock ms when the tool_call event arrived. Set by the
   *  V2 pipeline's onToolCall side-channel (Date.now()). Compared against
   *  the parent assistant message's ts to render a relative t+X.Xs chip
   *  beside each tool in the ledger. Optional so legacy records without
   *  it continue to render (just without the timestamp). */
  startedAt?: number;
}

export interface VerbState {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  modifiesHtml?: boolean;
  elapsedMs?: number;
  errorMsg?: string;
  /** Drives which shader plays inside the card while running. Each
   *  category gets a distinct visual so successive verbs feel different. */
  category?: "evaluate" | "refine" | "direction" | "enhance" | "fix" | "export";
}

interface Props {
  role: "user" | "assistant";
  /** Provider that produced this message. Used for the per-message
   *  badge (Provider Handoff Layer v1+). Undefined on user msgs and
   *  on legacy assistant msgs migrated from role:"claude". */
  provider?: import("@/lib/schemas").ProviderIdValue;
  text: string;
  /** Attachments for this user turn, rendered as a chip row below the
   *  prose. Optional/undefined for legacy messages and for assistant
   *  turns. When present, the user bubble shows clean prose plus one
   *  chip per file (instead of the older inline raw markdown). */
  attachments?: import("@/lib/schemas").ChatAttachment[];
  isDesign?: boolean;
  tools?: ToolUseRecord[];
  /** Stream is still active for this message — keep working indicator on. */
  streaming?: boolean;
  /** F2.2 — Wall-clock ms when the parent turn started (assistant
   *  message `ts`). When set together with per-tool startedAt, each
   *  chip renders a relative t+X.Xs label so the user can see the
   *  cadence of the agent's work. */
  turnStartedAt?: number;
  /** Model id used for this turn — surfaced in the empty placeholder so
   *  the user knows which model is "thinking" while no text yet arrives.
   *  User ask 2026-05-20: "queria ver tempo, tokens, processamento". */
  model?: string;
  /** Fires when the user picks an option from an embedded ::question block. */
  onAnswerQuestion?: (answer: string) => void;
  /** Answers already chosen (keyed by question raw text). */
  answeredQuestions?: Record<string, string>;
  /** When set, this message is an editorial verb dispatch (`/polish`,
   *  `/bolder` etc) — render as a shimmer card instead of plain text. */
  verb?: VerbState;
  /** Auto-checkpoint id for this message — when present, the chat shows a
   *  Restore button that reverts the iframe to this turn's HTML state. */
  versionId?: string;
  /** Fires when the user clicks Restore on this message's checkpoint. */
  onRestore?: (versionId: string) => void;
  /** Open Settings → Providers tab. Used by error bubble CTAs when the error
   *  matches install/auth patterns and the user needs to fix configuration. */
  onOpenSettings?: () => void;
  /** Re-send the last user prompt. Used by error bubble Retry CTA for transient
   *  failures (network glitch, timeout). */
  onRetry?: () => void;
  /** Whether at least one other provider is connected — drives whether the
   *  Switch provider CTA is shown on error bubbles. */
  hasAlternativeProvider?: boolean;
  /** turn-pipeline runtime gate report — when present, render
   *  the inline panel below the message body. */
  doneReport?: import("@/runtime/done-report").DoneReport;
  /** Persistence outcome for this user turn. Renders a small inline
   *  badge under the bubble so a save failure or local recovery is
   *  visible to the user instead of disappearing silently (Audit
   *  Fase 1 #1). "saved" renders nothing — clean chat is the implicit
   *  "all good"; only non-default states get a badge. Hydrated turns
   *  leave this undefined. */
  persistStatus?: "saving" | "saved" | "recovered" | "failed";
  /** — canonical tool events for this message. When present
   *  AND non-empty, renders the provider-agnostic ToolEventStream below
   *  the legacy ToolSummary (the two coexist during the migration so
   *  no existing surface regresses). Undefined / empty falls back to
   *  the legacy `tools` ledger only. */
  toolEvents?: NormalizedToolEvent[];
  /** F1.1 — Per-message stats. Renders a permanent footer below the
   *  assistant bubble: provider · model · duration · in/out tokens · cost.
   *  All optional; when none provided the footer hides itself (legacy
   *  turns, in-flight streams, error bubbles). */
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  ttftMs?: number;
}

// Basic, safe-ish markdown rendering. We're rendering Claude's text (trusted-ish
// source) inside our own app shell, so we skip a full sanitizer for MVP. The
// iframe renders user designs — chat is separate surface.
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Custom renderer: highlight fenced code blocks via highlight.js. Falls back to
// auto-detect when the fence has no language, or plaintext when the language
// isn't registered. Produces `<pre><code class="hljs language-X">…</code></pre>`
// — the chat-prose CSS then styles the .hljs-* classes.
const codeRenderer = new marked.Renderer();
codeRenderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = (lang || "").trim().toLowerCase();
  let highlighted = "";
  try {
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } else if (!language) {
      highlighted = hljs.highlightAuto(text).value;
    } else {
      highlighted = escapeHtml(text);
    }
  } catch {
    highlighted = escapeHtml(text);
  }
  const cls = language ? `hljs language-${language}` : "hljs";
  return `<pre><code class="${cls}">${highlighted}</code></pre>`;
};
marked.use({ renderer: codeRenderer });

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export function ChatMessage({
  role,
  provider,
  text,
  attachments,
  isDesign,
  tools,
  streaming,
  model,
  onAnswerQuestion,
  answeredQuestions,
  verb,
  versionId,
  onRestore,
  onOpenSettings,
  onRetry,
  hasAlternativeProvider,
  doneReport,
  toolEvents,
  persistStatus,
  durationMs,
  tokensIn,
  tokensOut,
  costUsd,
  ttftMs,
  turnStartedAt,
}: Props) {
  const { t, tf } = useT();
  // v39b (user bug): "Rendered more hooks than during the previous render"
  // — the two early-return guards (verb dispatch + empty placeholder) used
  // to live above the useMemo/useState calls below. When a message's role
  // / verb / streaming-content state flipped between renders (very common
  // during streaming + verb dispatch resolution), React saw a different
  // hook count per pass and crashed the editor.
  // Fix: compute the early-return CONDITIONS up here, but apply them AFTER
  // all hooks have been called. Hooks order is now stable across renders.
  const isVerbCard = !!verb;
  const isEmptyPlaceholder = role === "assistant" && !isDesign && !text?.trim() && !tools?.length;
  const questions = useMemo(() => (role === "assistant" ? parseQuestions(text) : []), [role, text]);
  const proseText = useMemo(
    () => (questions.length > 0 ? stripQuestionBlocks(text) : text),
    [questions.length, text],
  );
  // Subagent surrogate: Claude Sonnet often delegates the actual work to a
  // sub-agent via the `Agent` tool and returns ZERO parent text — leaving
  // the chat bubble eerily blank (the agent worked but said nothing).
  // When the parent text is empty but an Agent tool result is present, use
  // the subagent's last message as the bubble copy. Seen in a repro
  // where a turn had text_len=0 with a single Agent tool call.
  const effectiveProse = useMemo(() => {
    if (proseText && proseText.trim().length > 0) return proseText;
    if (role !== "assistant" || !tools || tools.length === 0) return proseText;
    const agentTool = tools.find((t) => t.name === "Agent" && t.result && !t.result.isError);
    if (!agentTool || !agentTool.result) return proseText;
    const subagentOutput = agentTool.result.content.trim();
    if (!subagentOutput) return proseText;
    // Take the LAST paragraph (subagent's final answer). Strip enclosing
    // JSON envelope if the daemon serialised the result as a structured
    // record — we want the readable surface only.
    const last =
      subagentOutput
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .pop() ?? subagentOutput;
    return last.length > 1500 ? last.slice(0, 1500) + "…" : last;
  }, [proseText, role, tools]);
  // Code-leak detection — recurring Project Agent bug where the agent
  // streams raw HTML/JS as chat prose instead of routing it through a
  // Write tool. Classic symptom: 17KB of file content spills into the
  // chat panel for a full minute while streaming. File itself may land
  // fine (if a Write was also issued), but the chat becomes unreadable.
  //
  // 2026-04-29 fix — false positives during normal streaming. User
  // reported the warning appearing on every "Generating" even when the
  // chat was clean. Three tightenings:
  //   1. Don't run while streaming. Mid-stream the chunk often has an
  //      open ``` fence that hasn't closed yet, so the strip-fence regex
  //      can't see it and the DOCTYPE inside the partial fence leaks
  //      into "unfenced" as a phantom signal. Wait for the turn to
  //      finalise, then judge.
  //   2. Bail when the prose ends inside an unclosed fence — that's a
  //      well-formed (fenced) code block, not a leak.
  //   3. Tighter signals: drop the loose CSS-rule regex (matched any
  //      JSON/TS object literal) and require >=3 unambiguous markers.
  const codeLeak = useMemo(() => {
    if (role !== "assistant") return null;
    if (streaming) return null;
    if (proseText.length < 1500) return null;
    // Bail if the message contains an unclosed code fence — the leak
    // detector's strip-fence regex only matches paired ``` … ``` so an
    // unterminated fence leaves the entire fenced body in `unfenced`,
    // producing massive false positives on legitimate code blocks.
    const fenceCount = (proseText.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) return null;
    const unfenced = proseText.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
    const signals = [
      /<!DOCTYPE\s+html/i.test(unfenced),
      /<html[\s>]/i.test(unfenced),
      /<\/html>/i.test(unfenced),
      /<script[\s>][\s\S]*?<\/script>/i.test(unfenced),
      /<style[\s>][\s\S]*?<\/style>/i.test(unfenced),
      /@keyframes\s+\w+\s*\{/i.test(unfenced),
      /<section\s+data-scene/i.test(unfenced),
    ];
    const count = signals.filter(Boolean).length;
    if (count < 3) return null;
    return { preview: proseText.slice(0, 400), fullLength: proseText.length, signals: count };
  }, [role, streaming, proseText]);
  const [showFullLeak, setShowFullLeak] = useState(false);
  const displayText = codeLeak && !showFullLeak ? codeLeak.preview + "\n\n…" : effectiveProse;
  const html = useMemo(() => {
    if (role !== "assistant") return "";
    return renderMarkdownSafe(displayText);
  }, [role, displayText]);
  const emptyResponseHtml = useMemo(
    () => sanitizeHtml(`<em style='color:var(--df-text-faint)'>${t("chat.no.response")}</em>`),
    [],
  );

  // Early returns after all hooks (Rules of Hooks compliance). See note
  // at top of function for context.
  if (isVerbCard) return <VerbCard verb={verb!} />;
  if (isEmptyPlaceholder) {
    // Empty in-flight assistant turns are represented by EditorScreen's
    // single global processing bar above the composer. Rendering a second
    // "thinking" bubble here duplicates status, elapsed time, provider/model,
    // and STOP controls.
    return null;
  }

  if (isDesign) {
    return (
      <div>
        <div className="chat-msg-author" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{t("chat.assistant")}</span>
          <ProviderBadge provider={provider} size="sm" />
        </div>
        <div
          className="chat-msg-body"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--df-sp-2)",
            color: "var(--df-text-secondary)",
            fontSize: "var(--df-text-sm)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("chat.design.generated")}
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="chat-msg chat-msg--user">
        {text && (
          <div className="chat-msg-body chat-msg-body--user" style={{ whiteSpace: "pre-wrap" }}>
            {text}
          </div>
        )}
        {attachments && attachments.length > 0 && <ChatAttachmentChips attachments={attachments} />}
        {persistStatus === "saving" && (
          <span className="chat-msg-persist chat-msg-persist--saving" aria-live="polite">
            salvando…
          </span>
        )}
        {persistStatus === "recovered" && (
          <span
            className="chat-msg-persist chat-msg-persist--recovered"
            title="A escrita no daemon falhou ou demorou demais. Mensagem salva localmente; será sincronizada quando possível."
          >
            salvo localmente
          </span>
        )}
        {persistStatus === "failed" && (
          <span
            className="chat-msg-persist chat-msg-persist--failed"
            title="Não foi possível salvar este turno em disco nem no recovery local."
          >
            falha ao salvar
          </span>
        )}
      </div>
    );
  }

  // Live working indicators are intentionally not rendered inside the
  // assistant bubble. EditorScreen owns the single in-flight processing bar;
  // finalized turns can still render tool summaries and stats below.

  // Error detection — `[error] ${msg}` is the canonical error format
  // pushed by EditorScreen when a stream fails. Render a structured
  // bubble with contextual CTAs and a designer-friendly title instead
  // of leaking raw stack traces. The categories below (install, auth,
  // rate-limit, file-missing, timeout, empty-completion) drive the
  // humanized title and the action buttons.
  //
  // Backwards-compat sniff (user repro 2026-05-15): older Kimi
  // failures saved the stderr resume hint as the assistant body
  // without the `[error]` prefix (the parser bug from commit ecb01e4
  // didn't wrap them). Detect the literal "To resume this session:
  // kimi -r <uuid>" tail in legacy persisted messages and promote
  // them to the structured-error path so the user gets a Retry CTA
  // instead of a permanently-poisoned bubble.
  const KIMI_RESUME_HINT_RX = /To resume this session:\s*kimi\s+-r\s+[a-f0-9-]+/i;
  const isLegacyKimiFailure = !streaming && !!text && KIMI_RESUME_HINT_RX.test(text);
  // Surface `[error] …` payloads IMMEDIATELY, even while streaming === true.
  // The daemon writes this marker only on terminal failures (no recovery
  // path), so waiting for !streaming just delays an error the user can act
  // on. User repro 2026-05-20: Gemini turn finished with "[error]
  // TypeError: network error" but chat bubble kept showing the breathing
  // "Pensando no design…" placeholder because every error branch was
  // gated on !streaming.
  const errorMatch = text
    ? (text.match(/^\s*\[error\]\s*([\s\S]*)$/) ??
      (isLegacyKimiFailure ? (["", text.trim()] as unknown as RegExpMatchArray) : null))
    : null;
  // Provider returned no text + wrote no artifact. Sanitizer keeps the
  // turn visible with EMPTY_RESPONSE_MARKER so the message doesn't
  // disappear; we promote it to a structured error with a Retry CTA.
  // Helper lives in chat-sanitizer.ts so both ends stay in sync.
  const isEmptyCompletion = !streaming && isEmptyResponseMarker(text);
  // Stream Lifecycle audit (PR #120): two new markers for the watchdog
  // outcomes — interrupted (idle 90s+ → terminated by client) and
  // truncated (provider sent `done` with thin payload). Same error-bubble
  // path as empty completion, with distinct titles + Retry CTA.
  const isInterrupted = !streaming && isInterruptedResponseMarker(text);
  const isTruncated = !streaming && isTruncatedResponseMarker(text);
  const errorBody = errorMatch?.[1]?.trim() ?? "";
  const isInstallError = /\b(command not found|cannot find|ENOENT.*command|not installed)\b/i.test(
    errorBody,
  );
  const isAuthError =
    /\b(unauthor|forbidden|401|403|invalid.*key|auth\s*(failed|expired)|please\s*(login|log\s*in))\b/i.test(
      errorBody,
    );
  const isRateLimit =
    /\b(429|quota|rate.?limit|too\s*many\s*requests|weekly\s*limit|hit\s+your\s+(weekly|daily|monthly))\b/i.test(
      errorBody,
    );
  const isFileMissing =
    /\b(ENOENT|no such file|not\s*found:\s*.+\.\w+)\b/i.test(errorBody) && !isInstallError;
  const isTimeout = /\b(timed?\s*out|timeout|ETIMEDOUT|operation\s*took\s*too\s*long)\b/i.test(
    errorBody,
  );
  const errorIsActionable =
    !!errorMatch &&
    (isInstallError || isAuthError || isRateLimit || isFileMissing || isTimeout || !!onRetry);
  const showStructuredError =
    (errorMatch && errorIsActionable) || isEmptyCompletion || isInterrupted || isTruncated;

  // Humanized title — appears above the body so designer reads "Não consegui
  // me conectar" before the technical detail. Empty fallback keeps the
  // generic message intact.
  let errorTitle = "";
  if (isInterrupted) {
    errorTitle = "Resposta interrompida";
  } else if (isTruncated) {
    errorTitle = "Resposta possivelmente cortada";
  } else if (isEmptyCompletion) {
    errorTitle = t("chat.error.title.empty");
  } else if (errorMatch) {
    if (isAuthError) errorTitle = t("chat.error.title.auth");
    else if (isInstallError) errorTitle = t("chat.error.title.install");
    else if (isRateLimit) errorTitle = t("chat.error.title.ratelimit");
    else if (isFileMissing) errorTitle = t("chat.error.title.file");
    else if (isTimeout) errorTitle = t("chat.error.title.timeout");
    else errorTitle = t("chat.error.title.generic");
  }
  const structuredErrorBody = isInterrupted
    ? "O agente parou de responder por mais de 90 segundos. A conversa foi salva — pode tentar de novo ou continuar."
    : isTruncated
      ? "O agente terminou com uma resposta muito curta sem aplicar nenhuma mudança. Provavelmente o stream foi cortado pelo provedor — tentar de novo costuma resolver."
      : isEmptyCompletion
        ? t("chat.error.empty.body")
        : errorBody || t("chat.error.generic");

  return (
    <div className="chat-msg chat-msg--claude">
      <div className="chat-msg-author" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>{t("chat.assistant")}</span>
        <ProviderBadge provider={provider} size="sm" />
      </div>
      {tools && tools.length > 0 && !streaming && (
        <ToolSummary tools={tools} streaming={false} turnStartedAt={turnStartedAt} />
      )}
      {!streaming && (!tools || tools.length === 0) && toolEvents && toolEvents.length > 0 && (
        // Fallback: provider didn't surface a Claude-style `tools` summary
        // (e.g. providers that emit raw tool events but no per-turn ledger).
        // Compact <details> keeps the visual weight low while preserving
        // observability — collapsed by default, click to expand.
        <details style={{ marginBottom: 6 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 10,
              color: "var(--df-text-faint)",
              fontFamily: "var(--df-font-mono)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {tf("chat.canonical.events", toolEvents.length)}
          </summary>
          <ToolEventStream events={toolEvents} />
        </details>
      )}
      {showStructuredError && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "10px 12px",
            marginBottom: 6,
            background: "rgba(239, 93, 59, 0.06)",
            border: "1px solid rgba(239, 93, 59, 0.28)",
            borderRadius: "var(--df-r-md)",
            fontSize: "var(--df-text-sm)",
            color: "var(--df-text-primary)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef5d3b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 3 }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
              {errorTitle && (
                <div style={{ fontWeight: 500, marginBottom: 3, color: "var(--df-text-primary)" }}>
                  {errorTitle}
                </div>
              )}
              <div
                style={{
                  color: errorTitle ? "var(--df-text-secondary)" : "var(--df-text-primary)",
                  fontSize: errorTitle ? "var(--df-text-xs)" : "var(--df-text-sm)",
                  lineHeight: 1.5,
                }}
              >
                {structuredErrorBody}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(isInstallError || isAuthError) && onOpenSettings && (
              <button type="button" onClick={onOpenSettings} className="df-btn df-btn--sm">
                {t("chat.error.fix.settings")}
              </button>
            )}
            {hasAlternativeProvider && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="df-btn df-btn--sm df-btn--ghost"
              >
                {t("chat.error.switch.provider")}
              </button>
            )}
            {onRetry && !isInstallError && !isAuthError && (
              <button type="button" onClick={onRetry} className="df-btn df-btn--sm df-btn--ghost">
                {isRateLimit
                  ? t("chat.error.try.again")
                  : isEmptyCompletion
                    ? t("chat.error.retry")
                    : t("chat.error.retry")}
              </button>
            )}
          </div>
        </div>
      )}
      {codeLeak && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 10px",
            marginBottom: 6,
            background: "rgba(240, 165, 0, 0.06)",
            border: "1px solid rgba(240, 165, 0, 0.22)",
            borderRadius: "var(--df-r-sm)",
            fontSize: "var(--df-text-xs)",
            color: "var(--df-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f0a500"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--df-text-primary)", fontWeight: 500, marginBottom: 2 }}>
              {tf("chat.codeleak.title", Math.round(codeLeak.fullLength / 4).toLocaleString())}
            </div>
            <div>{t("chat.codeleak.body")}</div>
            <button
              type="button"
              onClick={() => setShowFullLeak((v) => !v)}
              style={{
                marginTop: 6,
                padding: "2px 8px",
                background: "transparent",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-sm)",
                color: "var(--df-text-secondary)",
                fontFamily: "var(--df-font-mono)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {showFullLeak ? t("chat.codeleak.collapse") : t("chat.codeleak.show")}
            </button>
          </div>
        </div>
      )}
      {effectiveProse && !showStructuredError && (
        <div className="chat-msg-body chat-prose" style={{ position: "relative" }}>
          <span dangerouslySetInnerHTML={{ __html: html || emptyResponseHtml }} />
          {/* F3.6 — Streaming cursor for CLI feel. Renders a blinking
              block character right after the streaming text so the
              user sees the agent actively writing. Hidden once the
              turn finalizes (streaming flips false) and on error
              bubbles (showStructuredError carries the failure UX). */}
          {streaming && effectiveProse.trim().length > 0 && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "0.55em",
                marginLeft: 2,
                color: "var(--df-text-secondary)",
                fontFamily: "var(--df-font-mono)",
                animation: "df-cli-cursor 900ms steps(2, end) infinite",
                verticalAlign: "baseline",
                opacity: 0.85,
              }}
            >
              ▌
            </span>
          )}
          <style>{`
            @keyframes df-cli-cursor {
              0%, 50% { opacity: 0.9; }
              51%, 100% { opacity: 0; }
            }
          `}</style>
        </div>
      )}
      {doneReport && <DoneReportPanel report={doneReport} />}
      {/* F1.1 — Permanent stats footer below each finalized assistant
          bubble. Sourced from StreamResult at V2 finalize and persisted
          with the turn so reload renders it immediately. Hidden while
          streaming, on error bubbles, and on legacy turns lacking any
          stat (provider/model/duration/tokens/cost). */}
      {!streaming &&
        !showStructuredError &&
        (model ||
          provider ||
          typeof durationMs === "number" ||
          typeof tokensIn === "number" ||
          typeof tokensOut === "number" ||
          typeof costUsd === "number") && (
          <MessageStatsFooter
            provider={provider}
            model={model}
            durationMs={durationMs}
            tokensIn={tokensIn}
            tokensOut={tokensOut}
            costUsd={costUsd}
            ttftMs={ttftMs}
          />
        )}
      {questions.map((q, i) => (
        <AskUserQuestion
          key={`${q.header}-${i}`}
          question={q}
          answered={answeredQuestions?.[q.raw]}
          onPick={(label) => onAnswerQuestion?.(label)}
        />
      ))}
      {versionId && onRestore && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => onRestore(versionId)}
            title={t("chat.restore.title")}
            style={{
              padding: "3px 9px",
              background: "transparent",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-sm)",
              color: "var(--df-text-secondary)",
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--df-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--df-text-secondary)")}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
            </svg>
            {t("chat.restore")}
          </button>
        </div>
      )}
    </div>
  );
}

export function ToolChip({ tool, turnStartedAt }: { tool: ToolUseRecord; turnStartedAt?: number }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  // F2.2 — Relative timestamp chip. Renders `t+X.Xs` (seconds.tenths) so
  // the user can see the cadence of the tool calls without needing
  // absolute wall-clock. Hidden when either anchor is missing — legacy
  // turns rehydrated from disk simply omit it.
  const relMs =
    typeof tool.startedAt === "number" && typeof turnStartedAt === "number"
      ? Math.max(0, tool.startedAt - turnStartedAt)
      : null;
  const relLabel = relMs != null ? `t+${(relMs / 1000).toFixed(1)}s` : null;
  const summary = summarizeInput(tool.name, tool.input);
  const hasResult = !!tool.result;
  const isError = !!tool.result?.isError;
  return (
    <div
      style={{
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-sm)",
        background: "var(--df-bg-section)",
        overflow: "hidden",
        fontSize: 11,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          color: "var(--df-text-secondary)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--df-font-mono)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            flexShrink: 0,
            background: hasResult ? (isError ? "#ef5d3b" : "#5faa54") : "var(--df-text-faint)",
          }}
        />
        <span style={{ color: "var(--df-text-primary)", fontWeight: 500 }}>{tool.name}</span>
        <span
          style={{
            color: "var(--df-text-faint)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        {relLabel && (
          <span
            title="Tempo decorrido desde o início do turno"
            style={{
              color: "var(--df-text-faint)",
              fontSize: 9,
              opacity: 0.75,
              fontFamily: "var(--df-font-mono)",
              flexShrink: 0,
            }}
          >
            {relLabel}
          </span>
        )}
        <span style={{ color: "var(--df-text-faint)", fontSize: 10 }}>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            borderTop: "1px solid var(--df-border-subtle)",
            background: "var(--df-bg-base)",
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            color: "var(--df-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          <div
            style={{
              color: "var(--df-text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 9,
              marginBottom: 4,
            }}
          >
            {t("chat.tool.input")}
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(tool.input, null, 2)}
          </pre>
          {hasResult && (
            <>
              <div
                style={{
                  color: "var(--df-text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontSize: 9,
                  marginTop: 8,
                  marginBottom: 4,
                }}
              >
                {t("chat.tool.result")}{" "}
                {isError && <span style={{ color: "#ef5d3b" }}>{t("chat.tool.error")}</span>}
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: isError ? "#ff8b8b" : "var(--df-text-secondary)",
                }}
              >
                {tool.result!.content.slice(0, 1500)}
                {tool.result!.content.length > 1500 ? "\n…" : ""}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Compact summary of N tool uses. The copy is humanized for designers
// — instead of cryptic dev shorthand like "Read('index.html')" or
// "Wrote index.html", the verbs read editorially ("Lendo
// index.html", "Escrevendo index.html") via i18n
// (`chat.tool.verb.*`).
//
// Click expands into the original ToolChip ledger so the dev-leaning
// detail is one click away when raw provenance is needed.
// Self-ticking elapsed counter used inside the empty-placeholder author
// row so the user sees the turn is alive even before any text/tool
// arrives. Component lives here (not lifted to a shared util) because
// it's only useful inside the placeholder — once the real bubble takes
// over the global status banner above the chat already shows time.
// F1.1 — Permanent footer below each finalized assistant bubble.
// Renders provider · model · duration · in/out tokens · cost on a
// single mono line in muted color so it never competes with the
// message body. All segments are optional — missing fields collapse
// silently. Format matches the transient banner above the chat
// (formatDuration + LocaleString) so the user sees the same shape
// before AND after the turn finishes.
function MessageStatsFooter({
  provider,
  model,
  durationMs,
  tokensIn,
  tokensOut,
  costUsd,
  ttftMs,
}: {
  provider?: string;
  model?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  ttftMs?: number;
}) {
  const segments: string[] = [];
  if (model) segments.push(model);
  else if (provider) segments.push(provider);
  if (typeof durationMs === "number" && durationMs > 0) {
    const total = Math.floor(durationMs / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    segments.push(m > 0 ? `${m}m ${s}s` : `${s}s`);
  }
  if (typeof ttftMs === "number" && ttftMs > 0) {
    segments.push(`ttft ${(ttftMs / 1000).toFixed(2)}s`);
  }
  if (typeof tokensIn === "number" && typeof tokensOut === "number") {
    segments.push(`${tokensIn.toLocaleString()} in / ${tokensOut.toLocaleString()} out`);
  } else if (typeof tokensOut === "number") {
    segments.push(`${tokensOut.toLocaleString()} out`);
  }
  if (typeof costUsd === "number" && costUsd > 0) {
    segments.push(`$${costUsd.toFixed(4)}`);
  }
  if (segments.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        fontFamily: "var(--df-font-mono)",
        fontSize: 10,
        color: "var(--df-text-faint)",
        letterSpacing: "0.03em",
        opacity: 0.85,
        lineHeight: 1.5,
      }}
    >
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span style={{ opacity: 0.5, marginRight: 6 }}>·</span>}
          {seg}
        </span>
      ))}
    </div>
  );
}

export function ToolSummary({
  tools,
  streaming,
  turnStartedAt,
}: {
  tools: ToolUseRecord[];
  streaming?: boolean;
  turnStartedAt?: number;
}) {
  const { t, tf } = useT();
  // Auto-expand while the turn is streaming so the user sees tool calls
  // land live. Collapse when streaming finishes so the chat doesn't bloat
  // with the full ledger post-completion. User QA 2026-05-18 — "isso aqui
  // ta aparecendo so no final … queria ver live".
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded !== null ? userExpanded : !!streaming;
  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    setUserExpanded((prev) => (typeof next === "function" ? next(prev ?? !!streaming) : next));
  };

  // Filter out provider-internal tools that don't reflect productive work.
  // Gemini emits `update_topic` and `list_directory`; Codex emits `apply_patch`
  // variants; etc. Showing these as chip rows pollutes the chat with CLI-
  // specific noise. We keep only the canonical action verbs (Read / Write /
  // Edit / Bash / Search / Fetch / Agent / MultiEdit) — anything else is
  // swallowed so the chat stays consistent across providers. User ask
  // 2026-05-20: "consolidar o visual do chat, não quero status diferentes
  // por provider".
  const CANONICAL_TOOLS = new Set([
    "read",
    "readfile",
    "write",
    "writefile",
    "edit",
    "multiedit",
    "applypatch",
    "apply_patch",
    "bash",
    "shell",
    "glob",
    "grep",
    "search",
    "webfetch",
    "web_fetch",
    "fetch",
    "agent",
  ]);
  const visibleTools = tools.filter((tool) => CANONICAL_TOOLS.has(tool.name.toLowerCase()));

  // Nothing canonical to show — bail rather than render an empty chip row.
  // The parent ChatMessage's prose / file outputs already convey progress.
  if (visibleTools.length === 0) return null;

  // Group by tool name so we can render Write/Edit/Read with file lists and
  // everything else as a count. Read joins the file-list group post- so
  // designers see "Lendo X" instead of a generic "Read × 3" tally.
  const fileWrites: string[] = [];
  const fileEdits: string[] = [];
  const fileReads: string[] = [];
  const otherCounts = new Map<string, number>();
  let anyError = false;
  for (const tool of visibleTools) {
    if (tool.result?.isError) anyError = true;
    const filePath = (tool.input?.file_path ?? tool.input?.path) as string | undefined;
    if (tool.name === "Write" && filePath) fileWrites.push(filePath.split("/").pop() || filePath);
    else if (tool.name === "Edit" && filePath)
      fileEdits.push(filePath.split("/").pop() || filePath);
    else if (tool.name === "Read" && filePath)
      fileReads.push(filePath.split("/").pop() || filePath);
    else otherCounts.set(tool.name, (otherCounts.get(tool.name) ?? 0) + 1);
  }

  // Join file lists into a single human label using the i18n verb keys.
  // For 1 file: "Escrevendo index.html". For >1: "Escrevendo 3 arquivos:
  // a, b, c". Fallback to original dev wording if i18n key is missing.
  const joinList = (files: string[]): string => {
    return `${files.slice(0, 3).join(", ")}${files.length > 3 ? `, +${files.length - 3}` : ""}`;
  };
  const parts: string[] = [];
  if (fileWrites.length === 1) parts.push(tf("chat.tool.verb.write.one", fileWrites[0]));
  else if (fileWrites.length > 1)
    parts.push(tf("chat.tool.verb.write.many", fileWrites.length, joinList(fileWrites)));
  if (fileEdits.length === 1) parts.push(tf("chat.tool.verb.edit.one", fileEdits[0]));
  else if (fileEdits.length > 1)
    parts.push(tf("chat.tool.verb.edit.many", fileEdits.length, joinList(fileEdits)));
  if (fileReads.length === 1) parts.push(tf("chat.tool.verb.read.one", fileReads[0]));
  else if (fileReads.length > 1)
    parts.push(tf("chat.tool.verb.read.many", fileReads.length, joinList(fileReads)));
  for (const [name, count] of otherCounts.entries()) {
    const lower = name.toLowerCase();
    // Map well-known tool names to humanized verbs. Anything unknown falls
    // back to "Executando {name}" (count) so the line still reads natural.
    let label: string;
    if (lower === "bash")
      label = count === 1 ? t("chat.tool.verb.bash.one") : tf("chat.tool.verb.bash.many", count);
    else if (lower === "webfetch" || lower === "web_fetch")
      label = count === 1 ? t("chat.tool.verb.fetch.one") : tf("chat.tool.verb.fetch.many", count);
    else if (lower === "glob" || lower === "grep")
      label =
        count === 1 ? t("chat.tool.verb.search.one") : tf("chat.tool.verb.search.many", count);
    else
      label =
        count === 1
          ? tf("chat.tool.verb.generic.one", name)
          : tf("chat.tool.verb.generic.many", name, count);
    parts.push(label);
  }
  const summary = parts.join(" · ");

  return (
    <div
      style={{
        borderRadius: "var(--df-r-sm)",
        background: "var(--df-bg-section)",
        border: "1px solid var(--df-border-subtle)",
        overflow: "hidden",
        fontSize: 11,
        marginBottom: 10,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          color: "var(--df-text-secondary)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--df-font-mono)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            flexShrink: 0,
            background: anyError ? "#ef5d3b" : "#5faa54",
          }}
        />
        <span
          style={{
            color: "var(--df-text-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--df-font-sans)",
          }}
        >
          {summary || tf("chat.tool.verb.generic.many", t("chat.tool.action"), visibleTools.length)}
        </span>
        <span style={{ color: "var(--df-text-faint)", fontSize: 10 }}>
          {expanded ? "−" : `+${visibleTools.length > 1 ? ` ${visibleTools.length}` : ""}`}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            borderTop: "1px solid var(--df-border-subtle)",
            background: "var(--df-bg-base)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {visibleTools.map((t) => (
            <ToolChip key={t.id} tool={t} turnStartedAt={turnStartedAt} />
          ))}
        </div>
      )}
    </div>
  );
}

function VerbCard({ verb }: { verb: VerbState }) {
  const isRunning = verb.status === "running";
  const isDone = verb.status === "done";
  const isFailed = verb.status === "failed";

  const accent = isFailed
    ? "rgba(215, 122, 90, 0.55)"
    : isDone
      ? "rgba(140, 175, 140, 0.50)"
      : "var(--df-border-subtle)";

  return (
    <div className="chat-msg chat-msg--verb" style={{ position: "relative" }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 14px 11px 12px",
          minHeight: 64,
          background: "var(--df-surface-elevated)",
          borderRadius: "var(--df-r-md, 10px)",
          boxShadow: `
            inset 0 1px 0 var(--df-skeu-top-light),
            inset 0 0 0 1px ${accent},
            0 1px 2px var(--df-skeu-near),
            0 4px 14px -4px var(--df-skeu-deep-near)
          `,
          fontSize: "var(--df-text-sm)",
          color: "var(--df-text-primary)",
          overflow: "hidden",
        }}
      >
        {/* Per-category shader — different visual per verb family so a
            sequence of /polish /bolder /charm doesn't feel monotonous. */}
        {isRunning && <VerbShader category={verb.category ?? "refine"} />}

        {/* Status indicator */}
        <span
          aria-hidden
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            flexShrink: 0,
          }}
        >
          {isRunning && (
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "var(--df-text-primary)",
                boxShadow: "0 0 0 4px color-mix(in srgb, var(--df-text-primary) 14%, transparent)",
                animation: "df-verb-pill-breath 1400ms ease-in-out infinite",
              }}
            />
          )}
          {isDone && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "rgba(140, 175, 140, 1)" }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {isFailed && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "rgba(215, 122, 90, 1)" }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </span>

        {/* Verb label */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontWeight: "var(--df-fw-semibold, 600)",
              letterSpacing: "var(--df-tracking-tight)",
              fontSize: "var(--df-text-sm)",
            }}
          >
            /{verb.id}
            <span style={{ marginLeft: 8, color: "var(--df-text-secondary)", fontWeight: 400 }}>
              {verb.label}
            </span>
          </span>
          <span
            style={{
              color: isFailed ? "rgba(215, 122, 90, 0.95)" : "var(--df-text-muted)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {isRunning && (
              <>
                running
                <span className="df-verb-dots" aria-hidden>
                  ...
                </span>
              </>
            )}
            {isDone && (
              <>
                done
                {typeof verb.elapsedMs === "number" && verb.elapsedMs > 0 && (
                  <span style={{ marginLeft: 6 }}>· {(verb.elapsedMs / 1000).toFixed(1)}s</span>
                )}
              </>
            )}
            {isFailed && (verb.errorMsg ? verb.errorMsg.slice(0, 80) : "failed")}
          </span>
        </div>
      </div>
    </div>
  );
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  // Common shorthand renderings — fall back to the first string field
  const low = name.toLowerCase();
  if (low === "bash" && typeof input.command === "string") return input.command as string;
  if (low === "read" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "edit" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "write" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "glob" && typeof input.pattern === "string") return input.pattern as string;
  if (low === "grep" && typeof input.pattern === "string") return input.pattern as string;
  for (const k of ["command", "query", "pattern", "file_path", "url", "content"]) {
    if (typeof input[k] === "string") return (input[k] as string).slice(0, 140);
  }
  const first = Object.values(input).find((v) => typeof v === "string");
  return typeof first === "string" ? first.slice(0, 140) : "";
}

// ─── — chat attachment chips ──────────────────────────────────────
//
// Renders below user prose when message.attachments is non-empty. Replaces
// the pre- behavior where attachment markdown was prepended to
// message.text and leaked raw HTML/code into the chat bubble. User
// feedback 2026-05-06: "se coloco um attatchment ele deveria aparecer no
// chat como anexo nao escrever todo inline".
//
// One chip per attachment, mirroring NewProject AttachmentChips DNA so
// the user gets a consistent visual across composer + chat. Chips here
// are read-only (no remove / no reorder) — the attachment is already part
// of a finalized turn, mutation isn't meaningful.

type ChatAttachmentLike = NonNullable<import("@/lib/schemas").ChatAttachment>;

function attachmentGlyph(att: ChatAttachmentLike): string {
  if (att.kind === "html") return "▤";
  if (att.kind === "image") return "▦";
  if (att.kind === "text") return "≡";
  return "◇";
}

function fmtAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

export function ChatAttachmentChips({
  attachments,
  onRemove,
  align = "end",
}: {
  attachments: ChatAttachmentLike[];
  /** When provided, each chip renders an `×` button calling onRemove(idx). */
  onRemove?: (idx: number) => void;
  /** "end" matches user-bubble right-anchor; "start" left-aligns for the
   *  composer chip row above the textarea. */
  align?: "start" | "end";
}) {
  return (
    <div
      role="list"
      aria-label="attachments"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 6,
        justifyContent: align === "end" ? "flex-end" : "flex-start",
      }}
    >
      {attachments.map((att, idx) => (
        <span
          key={`${att.name}-${idx}`}
          role="listitem"
          title={att.path ?? att.name}
          data-kind={att.kind}
          data-testid="chat-attachment-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px 3px 8px",
            background: "var(--df-surface-raised)",
            border: "1px solid var(--df-border-subtle)",
            borderRadius: "var(--df-r-sm)",
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            color: "var(--df-text-secondary)",
            maxWidth: 240,
            lineHeight: 1.4,
          }}
        >
          {att.kind === "image" && att.preview ? (
            <img
              src={att.preview}
              alt=""
              aria-hidden
              style={{
                width: 24,
                height: 24,
                objectFit: "cover",
                borderRadius: 4,
                border: "1px solid var(--df-border-subtle)",
                flexShrink: 0,
              }}
            />
          ) : (
            <span aria-hidden style={{ color: "var(--df-text-faint)", fontSize: 11 }}>
              {attachmentGlyph(att)}
            </span>
          )}
          <span
            style={{
              color: "var(--df-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 160,
            }}
          >
            {att.name}
          </span>
          <span style={{ color: "var(--df-text-faint)" }}>{fmtAttachmentSize(att.size)}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(idx)}
              aria-label="remove attachment"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--df-text-faint)",
                fontSize: 11,
                cursor: "pointer",
                padding: "0 2px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
