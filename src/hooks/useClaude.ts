import { useState, useCallback, useRef, useEffect } from "react";
type UnlistenFn = () => void;
import {
  invokeApplyStyle,
  invokeEditorialVerb,
  type ProjectContext,
  type EditorialVerbInvocation,
} from "@/runtime/prompt-invoker";
import type { SubAgentState } from "@/runtime/stream-parser";
import type { StreamUsage, StreamResult, ToolCall, ToolResult } from "@/lib/claude-bridge";
import type { ToolUseRecord } from "@/components/ChatMessage";
import { createIdleWatchdog, isSuspiciousDone, type IdleWatchdog } from "@/lib/stream-lifecycle";
import { record as recordTurn } from "@/lib/turn-recorder";

// "interrupted" — Stream Lifecycle audit (post-#118 review). Emitted
// when the idle watchdog terminates a stream that went silent past
// STREAM_IDLE_TIMEOUT_MS. Distinct from "error" (provider explicitly
// rejected) and "done" (provider signalled completion). The chat
// surface renders a "resposta interrompida" banner with Retry.
export type GenerationStatus = "idle" | "streaming" | "done" | "error" | "interrupted";

// Phase milestones removed 2026-04-27. They were a regex-over-streamed-text
// heuristic from the legacy era when the model emitted raw HTML as prose
// — `<style[\s>]` matching would flip the label to "Writing styles" mid-
// stream. With the modern Write-tool flow that text is the actual file
// content being leaked into prose (a model-behavior failure), so the
// "progress" the regex inferred was misleading: the user saw "Writing
// styles 3m 26s" while the design wasn't actually being written. Label
// now stays at the simple state machine (starting → generating | working
// → done).

export interface StreamSideChannels {
  /**
   * Fires once per stream when the CLI emits its init event with a session id.
   * Caller should persist against the project (`db.setProjectSession`) so the
   * next turn can pass `--resume <id>` in ClaudeConfig. Claude-only — other
   * providers never emit this.
   */
  onSession?: (sessionId: string) => void;
  /**
   * Fires once per stream when stderr matches an auth-failure pattern. Caller
   * should surface a "Run `claude login`" banner.
   */
  onAuthRequired?: (detail: string) => void;
  /**
   * Fires for every Claude tool_call event. Use to react to specific tools
   * (e.g. open the file in a tab when Claude writes one, refresh the iframe
   * preview when Claude writes the project's HTML file). The internal hook
   * still updates its own tools[] state — this is purely additive notification.
   */
  onToolCall?: (call: ToolCall) => void;
  /**
   * Stream Lifecycle audit (post-#118). Fires once when the idle
   * watchdog terminates a stream that went silent past
   * STREAM_IDLE_TIMEOUT_MS. Caller surfaces a "resposta interrompida"
   * banner so the user doesn't keep waiting on a hung stream.
   */
  onInterrupted?: (idleMs: number) => void;
  /**
   * Stream Lifecycle audit (post-#118). Fires when the stream signals
   * `done` but the response is suspiciously thin (user repro: 4-char
   * "Você" with zero tools on a long prompt). Caller surfaces a
   * "resposta possivelmente cortada" banner with Retry. Does NOT fire
   * for legitimately short replies (single-token prompts, tool-only
   * turns).
   */
  onSuspiciousDone?: (info: { text: string; toolCount: number }) => void;
}

export interface UseClaudeReturn {
  output: string;
  status: GenerationStatus;
  error: string | null;
  subAgents: SubAgentState[];
  streamLabel: string;
  // Telemetry
  elapsedMs: number;
  ttftMs: number | null;
  /** Output tokens streamed so far. Sourced from message_delta usage when
   *  available, falls back to output.length / 4 estimate while early. */
  tokens: number;
  modelName: string | null;
  usage: StreamUsage | null;
  result: StreamResult | null;
  tools: ToolUseRecord[];
  // Actions — each accepts optional sideChannels so the caller can persist
  // session_id / surface auth failures without subscribing to the full hook
  // state.
  applyStyle: (
    instruction: string,
    ctx: ProjectContext,
    sideChannels?: StreamSideChannels,
  ) => Promise<void>;
  runVerb: (
    verb: EditorialVerbInvocation,
    ctx: ProjectContext,
    sideChannels?: StreamSideChannels,
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export type { ProjectContext };

// Internal hook — sets up every piece of stream state. Exported so
// `<ClaudeStreamProvider>` can host it once at the App level. App-
// level callers should use `useClaude()` below, which reads from
// the Context so navigation doesn't unmount the stream.
export function useClaudeState(): UseClaudeReturn {
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgentState[]>([]);
  const [streamLabel, setStreamLabel] = useState("thinking...");
  const [tokens, setTokens] = useState(0);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [usage, setUsage] = useState<StreamUsage | null>(null);
  const [result, setResult] = useState<StreamResult | null>(null);
  const [tools, setTools] = useState<ToolUseRecord[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const accumulatedRef = useRef<string>("");
  // Stream Lifecycle audit (post-#118 review): the watchdog tracks the
  // current stream's silence window. Bumped on every observable event
  // (text / tool_call / tool_result / meta / usage); fires once when
  // the silence exceeds STREAM_IDLE_TIMEOUT_MS, terminating the
  // stream and flipping status to "interrupted". One instance per
  // stream — the previous one is stopped at runStream start.
  const watchdogRef = useRef<IdleWatchdog | null>(null);
  // Captures the prompt text + tool count for the suspicious-done
  // detector at end-of-stream. Reset at runStream start.
  const promptForRunRef = useRef<string>("");
  const toolCountRef = useRef<number>(0);
  // Tracks whether the current stream has produced ANY observable event
  // (text or tool_call). Reset at runStream start. Used by the label
  // transition so it doesn't depend on closure-captured state — set the
  // ref to true on first event, flip the label, done. No drift possible.
  const firstEventSeenRef = useRef(false);

  // Mount-only reset. If the user reloads (full page or HMR) mid-stream,
  // the SSE connection dies but React-Refresh / state preservation may keep
  // status="streaming" + streamLabel="starting..." in memory, leaving a
  // ghost pill that never finishes. The actual stream is gone, so we wipe
  // those values once on mount. Real in-flight streams started by the
  // current component instance will set status back to "streaming" via
  // runStream — this reset does not race them because runStream is only
  // called by user actions, never on mount.
  useEffect(() => {
    if (unlistenRef.current === null) {
      setStatus("idle");
      setStreamLabel("thinking...");
    }
    // Empty deps: mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live elapsed timer while streaming
  useEffect(() => {
    if (status !== "streaming" || startedAt === null) return;
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [status, startedAt]);

  const cancel = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    // Stop the watchdog so a cancel-during-streaming path can't fire
    // a delayed "interrupted" status after the user explicitly aborted.
    watchdogRef.current?.stop();
    watchdogRef.current = null;
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    cancel();
    setOutput("");
    setError(null);
    setSubAgents([]);
    setStreamLabel("thinking...");
    setStatus("idle");
    accumulatedRef.current = "";
    setTokens(0);
    setTtftMs(null);
    setModelName(null);
    setUsage(null);
    setResult(null);
    setTools([]);
    setStartedAt(null);
    setElapsedMs(0);
  }, [cancel]);

  const runStream = useCallback(
    async (
      invoker: (callbacks: Parameters<typeof invokeApplyStyle>[2]) => Promise<UnlistenFn>,
      sideChannels?: StreamSideChannels,
      /** Original user prompt — passed in so the end-of-stream suspicious-
       *  done detector can decide whether a 4-char reply is legitimate
       *  (trivial prompt) or a truncation. Empty by default; entry points
       *  (generate/applyStyle/etc) populate it from their first arg. */
      promptText?: string,
    ) => {
      if (status === "streaming") cancel();
      setOutput("");
      setError(null);
      setSubAgents([]);
      promptForRunRef.current = promptText ?? "";
      toolCountRef.current = 0;
      // Label progression — we want the wait to FEEL accurate. On Opus with
      // extended thinking, first visible output can take 1-5 min. Keeping
      // "starting..." up the whole time looks broken. Instead:
      //   iniciando agente...   → spawn CLI, auth, cwd
      //   pensando (thinking)…  → after 6s with no output (Opus extended
      //                            thinking mode kicks in)
      //   gerando código...     → first text event (CLI started writing)
      //   trabalhando...        → first tool_call (Write/Edit fired)
      setStreamLabel("starting agent...");
      setStatus("streaming");
      accumulatedRef.current = "";
      firstEventSeenRef.current = false;
      setTokens(0);
      setTtftMs(null);
      setModelName(null);
      setUsage(null);
      setResult(null);
      setTools([]);
      const start = Date.now();
      setStartedAt(start);
      setElapsedMs(0);

      // Auto-transition to a single short label after 6s. Opus extended
      // thinking is silent for tens of seconds before the first event —
      // staring at "iniciando agente..." misleads. Keep label terse; the
      // elapsed counter beside it carries the wait info.
      const thinkingTimer = window.setTimeout(() => {
        if (!firstEventSeenRef.current) {
          setStreamLabel("generating...");
        }
      }, 6000);

      // Stream Lifecycle audit (post-#118): arm the idle watchdog. The
      // first stream activity (text / tool_call / etc) bumps it; if the
      // stream goes silent for STREAM_IDLE_TIMEOUT_MS the watchdog
      // terminates the stream and flips status to "interrupted".
      watchdogRef.current?.stop();
      const watchdogStart = Date.now();
      watchdogRef.current = createIdleWatchdog(() => {
        const idleMs = Date.now() - watchdogStart;
        // Cancel the in-flight transport (closes the SSE connection).
        unlistenRef.current?.();
        unlistenRef.current = null;
        window.clearTimeout(thinkingTimer);
        setStreamLabel("interrupted");
        setStatus("interrupted");
        sideChannels?.onInterrupted?.(idleMs);
      });

      let accumulated = "";

      const unlisten = await invoker({
        onText: (text) => {
          watchdogRef.current?.bump();
          accumulated += text;
          accumulatedRef.current = accumulated;
          setOutput(accumulated);
          setTtftMs((cur) => (cur === null ? Date.now() - start : cur));
          setTokens((cur) => Math.max(cur, Math.round(accumulated.length / 4)));
          // Single ref-based gate: first event flips the label, that's it.
          // No closure check. No live-state read. Bulletproof.
          if (!firstEventSeenRef.current) {
            firstEventSeenRef.current = true;
            window.clearTimeout(thinkingTimer);
            setStreamLabel("generating...");
          }
        },
        onMeta: (m) => {
          watchdogRef.current?.bump();
          if (m.model) setModelName(m.model);
          if (typeof m.ttftMs === "number") setTtftMs(m.ttftMs);
        },
        onUsage: (u) => {
          watchdogRef.current?.bump();
          setUsage(u);
          // Live token count from the API. This is the authoritative source
          // (replaces the chars/4 estimate). message_delta usage events fire
          // periodically during streaming.
          if (typeof u.outputTokens === "number") {
            setTokens((cur) => Math.max(cur, u.outputTokens!));
          }
        },
        onResult: (r) => setResult(r),
        onToolCall: (call: ToolCall) => {
          watchdogRef.current?.bump();
          recordTurn("tool", "tool_call", {
            id: call.id,
            name: call.name,
            file_path: (call.input?.file_path ?? call.input?.path) as string | undefined,
            via: "useClaude",
          });
          // Dedup por id — se o mesmo tool_call fires 2× (content_block_stop +
          // terminal message), não dupla o chip. Fix de duplicação 2026-04-23.
          setTools((prev) => {
            const existing = prev.findIndex((t) => t.id === call.id);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = { ...next[existing], name: call.name, input: call.input };
              return next;
            }
            toolCountRef.current = prev.length + 1;
            return [...prev, { id: call.id, name: call.name, input: call.input }];
          });
          // Same ref-based gate as onText — first event flips the label.
          if (!firstEventSeenRef.current) {
            firstEventSeenRef.current = true;
            window.clearTimeout(thinkingTimer);
            setStreamLabel("working...");
          }
          // Forward to the caller so EditorScreen can react to Write/Edit on the
          // project's HTML file (open the tab, refresh the iframe). Without this,
          // first-prompt generation (which uses Write tool) writes to disk but
          // the iframe never picks it up — user reported "preciso abrir folder
          // e clicar no html". Fix 2026-04-27.
          sideChannels?.onToolCall?.(call);
        },
        onToolResult: (tr: ToolResult) => {
          watchdogRef.current?.bump();
          recordTurn("tool", "tool_result", {
            id: tr.id,
            isError: tr.isError,
            content_len: typeof tr.content === "string" ? tr.content.length : 0,
            via: "useClaude",
          });
          setTools((prev) =>
            prev.map((t) =>
              t.id === tr.id ? { ...t, result: { content: tr.content, isError: tr.isError } } : t,
            ),
          );
        },
        onSession: (sid: string) => {
          sideChannels?.onSession?.(sid);
        },
        onAuthRequired: (detail: string) => {
          sideChannels?.onAuthRequired?.(detail);
        },
        onDone: (fullText) => {
          window.clearTimeout(thinkingTimer);
          watchdogRef.current?.stop();
          watchdogRef.current = null;
          const finalText = fullText || accumulated;
          recordTurn("client", "onDone", {
            text_len: finalText?.length ?? 0,
            tool_count: toolCountRef.current,
            via: "useClaude",
          });
          setOutput(finalText);
          setStreamLabel("done");
          setStatus("done");
          unlistenRef.current = null;
          // Stream Lifecycle audit (post-#118): catch the case where the
          // provider signals `done` but the response is suspiciously thin
          // — 4-char "Você" with zero tools on a long prompt. Fires the
          // sideChannel so EditorScreen can render a "resposta cortada"
          // banner; we never auto-retry (auditor explicit ask).
          if (
            isSuspiciousDone({
              text: finalText,
              toolCount: toolCountRef.current,
              promptText: promptForRunRef.current,
            })
          ) {
            sideChannels?.onSuspiciousDone?.({
              text: finalText,
              toolCount: toolCountRef.current,
            });
          }
        },
        onError: (err) => {
          window.clearTimeout(thinkingTimer);
          watchdogRef.current?.stop();
          watchdogRef.current = null;
          setError(err);
          setStatus("error");
          unlistenRef.current = null;
        },
      });

      unlistenRef.current = unlisten;
      // ttftMs and streamLabel are no longer read inside; their reads were
      // closure-stale across turns, which is why label transitions were
      // broken. Both are now updated via functional setState above.
    },
    [status, cancel],
  );

  const applyStyle = useCallback(
    async (instruction: string, ctx: ProjectContext, sideChannels?: StreamSideChannels) => {
      await runStream((cbs) => invokeApplyStyle(instruction, ctx, cbs), sideChannels, instruction);
    },
    [runStream],
  );

  const runVerb = useCallback(
    async (
      verb: EditorialVerbInvocation,
      ctx: ProjectContext,
      sideChannels?: StreamSideChannels,
    ) => {
      await runStream(
        (cbs) => invokeEditorialVerb(verb, ctx, cbs),
        sideChannels,
        `/${verb.id} ${verb.args}`.trim(),
      );
    },
    [runStream],
  );

  return {
    output,
    status,
    error,
    subAgents,
    streamLabel,
    elapsedMs,
    ttftMs,
    tokens,
    modelName,
    usage,
    result,
    tools,
    applyStyle,
    runVerb,
    cancel,
    reset,
  };
}

// Re-export the Context reader under the original `useClaude` name so
// existing call sites (EditorScreen + StatusPill imports type) don't
// have to change. The Context Provider lives at App level — see
// `src/contexts/ClaudeStreamContext.tsx`.
export { useClaudeStream as useClaude } from "@/contexts/ClaudeStreamContext";
