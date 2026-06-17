// turn-pipeline.ts — simplified turn pipeline that replaces the
// previous 7-stage `src/runtime/turn-stages/*` modules.
//
// What this module does:
//   - PREPARE — resolves provider, capabilities, model + composes the
//     user prompt and system prompt. Pure (no I/O beyond a
//     `getProvider()` registry lookup). Sticky session resume from the
//     wrapper's external context is forwarded as-is; there is no
//     separate handoff-layer step.
//   - STREAM — calls the provider, accumulates fullText + tool events
//     + sessionId, and normalizes tool events into the canonical
//     envelope.
//   - FINALIZE — processes the artifact (capability-driven dispatch),
//     runs the lightweight validation pass (Static P0 + done report —
//     NO runtime-probe iframe blocking, NO auto-fix loop), and
//     composes the AssistantMessage + the canonical TurnResult.
//
// Why 3 stages and not 7: the previous 7-stage pipeline was
// over-engineered for problems that didn't materialize. The flow is
// fundamentally `prepare → call provider → finalize`. The fan-out
// stages (build-payload, validate-runtime, persist, emit-ui) collapse
// back into helpers called inside finalize, where they belong.
//
// `sendUserTurn()` preserves the public surface (UserTurnInput,
// TurnResult, etc.) so callers like EditorScreen don't change — the
// internal restructure is invisible from the wrapper's perspective.

import { getProvider } from "@/providers/registry";
import { spawnStream, type PromptCategory } from "@/runtime/cli-spawner";
import { workspaceContextPreamble, type ProjectContext } from "@/runtime/prompt-invoker";
import { buildArtifactContractBlock } from "@/runtime/output-contract";
import {
  dispatchParseResult,
  type ProcessArtifactsOptions,
  type ProcessArtifactsOutcome,
} from "@/runtime/process-artifacts";
import { parseArtifact } from "@/runtime/artifact-processor";
import { validateArtifactStaticP0 } from "@/runtime/static-p0";
import { composeDoneReport } from "@/runtime/done-report";
import {
  fromBridgeToolCall,
  fromBridgeToolResult,
  type NormalizedToolEvent,
} from "@/runtime/tool-events";
import { upsertProviderSession } from "@/lib/provider-sessions";
import type { ProviderId, ProviderCapabilities } from "@/providers/types";
import type {
  StreamCallbacks,
  StreamMeta,
  StreamResult,
  StreamUsage,
  ToolCall,
  ToolResult,
} from "@/lib/claude-bridge";
import type { DoneReport } from "@/runtime/done-report";

// ─── Public types ────────────────────────────────────────────────────────

/**
 * Mode determines which prompt strategy applies. Mirrors the legacy
 * invoke* matrix. keeps the type for backward-compat; only `chat`
 * and `ask` are exercised end-to-end today.
 */
export type TurnMode = "chat" | "ask" | "verb" | "add-component" | "apply-style" | "search-replace";

export interface TurnAttachment {
  content: string;
  name: string;
  mime: string;
  size: number;
}

export interface TurnExternalContext {
  projectPath?: string;
  primaryFile?: string;
  workspaceRoot?: string;
  iframeHtml?: string;
  designSystem?: { name?: string; path?: string; markdown?: string };
  model?: string;
  /** Forwarded into provider config. Honoured by Claude only today.
   *  drops the persistent v3 session state lookup entirely — sticky
   *  session tracking is whatever React state the wrapper holds. */
  sessionId?: string | null;
  /** Conversation history slice. Pipeline does not recompute history — the
   *  wrapper owns it. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface UserTurnInput {
  userMessage: string;
  providerId: ProviderId;
  projectId: string;
  /** Logical thread within the project. Default `"main"`. keeps this
   *  for forward-compat with multi-thread chat — the pipeline itself
   *  ignores it. */
  threadId: string;
  mode?: TurnMode;
  attachments?: TurnAttachment[];
  signal?: AbortSignal;
  context?: TurnExternalContext;
}

/** Compact tool ledger — same shape ChatMessage.tools uses. */
export interface ToolUseLite {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: string; isError: boolean };
}

export interface AssistantMessage {
  role: "assistant";
  provider: ProviderId;
  model?: string;
  text: string;
  tools?: ToolUseLite[];
  toolEvents?: NormalizedToolEvent[];
  doneReport?: DoneReport;
  artifactPath?: string;
  rolledBackToEmpty?: boolean;
  turnId: string;
  usage?: StreamResult;
}

export type TurnStatus = "ok" | "static-fail" | "cancelled" | "error";

export interface TurnError {
  code: string;
  message: string;
  stage: "prepare" | "stream" | "finalize";
}

export interface TurnResult {
  status: TurnStatus;
  artifacts: ProcessArtifactsOutcome[];
  doneReport: DoneReport | null;
  messages: AssistantMessage[];
  toolEvents?: NormalizedToolEvent[];
  error?: TurnError;
  duration_ms: number;
  sessionId?: string | null;
}

export interface TurnSideChannels {
  onText?: (chunk: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onSessionId?: (id: string) => void;
  onAuthRequired?: (detail: string) => void;
  onMeta?: (meta: StreamMeta) => void;
  onUsage?: (usage: StreamUsage) => void;
  onResult?: (result: StreamResult) => void;
}

// ─── Internal carry-bag between stages ──────────────────────────────────

/** What `prepare()` produces and `stream()` + `finalize()` consume. Pure
 *  data — no React state. */
export interface TurnContext {
  input: UserTurnInput;
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  model?: string;
  startedAt: number;
  turnId: string;
  /** Composed prompt (attachments + user text). */
  prompt: string;
  /** Composed system prompt (preamble + project context + contract block). */
  systemPrompt: string;
  /** Provider options bundled for the spawnStream call. */
  providerOptions: {
    model?: string;
    cwd?: string;
    sessionId?: string | null;
    agent?: string;
  };
}

/** What `stream()` produces. Source of truth for `finalize()`. */
export interface TurnStream {
  fullText: string;
  tools: ToolUseLite[];
  toolEvents: NormalizedToolEvent[];
  sessionId: string | null;
  meta: StreamMeta | null;
  result: StreamResult | null;
  errored: boolean;
  errorMessage?: string;
  aborted: boolean;
  authRequired?: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────

export class TurnAbortError extends Error {
  readonly code = "ABORTED";
  constructor() {
    super("turn cancelled by abort signal");
    this.name = "TurnAbortError";
  }
}

export class TurnPrepareError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TurnPrepareError";
  }
}

// ─── Stage 1 — PREPARE ───────────────────────────────────────────────────
//
// Resolves provider + capabilities + model + system prompt + user prompt.
// Pure aside from `getProvider` lookup. dropped the v3 session
// state read (`readProviderSessionState`) and the canonical handoff
// preamble — the wrapper's external sessionId is forwarded as-is when
// the provider supports resume; otherwise the provider gets a fresh
// CLI session and reconstructs context from the prompt + history block
// the wrapper passes via `context.history`.

export interface PrepareOptions {
  now?: () => number;
  turnId?: string;
  /** Override the system prompt entirely. Used by ask-mode / verb dispatch
   *  where the caller has a hand-tuned prompt. */
  systemPromptOverride?: string;
  /** Optional pre-resolved skill body / preamble extras. */
  preambleExtras?: string;
  /** Optional agent alias — Claude only. */
  agent?: string;
}

export function prepare(input: UserTurnInput, opts: PrepareOptions = {}): TurnContext {
  if (input.signal?.aborted) {
    throw new TurnAbortError();
  }

  const provider = getProvider(input.providerId);
  if (!provider) {
    throw new TurnPrepareError(
      "UNKNOWN_PROVIDER",
      `Unknown providerId "${input.providerId}". Registered providers: see src/providers/registry.ts`,
    );
  }

  const capabilities = provider.capabilities;
  const now = opts.now ? opts.now() : Date.now();
  const turnId = opts.turnId ?? `t${now}`;
  const external = input.context ?? {};

  // Compose project context for the preamble.
  const projectCtx: ProjectContext = {
    projectId: input.projectId,
    projectPath: external.projectPath ?? "~/design-factory/projeto",
    primaryFile: external.primaryFile ?? "index.html",
    mode: "hifi",
    conversationHistory: external.history ?? [],
    hasDesignSystem: Boolean(external.designSystem?.path),
    cwd: external.workspaceRoot ?? undefined,
    ...(external.designSystem?.path !== undefined
      ? { designSystemPath: external.designSystem.path }
      : {}),
    ...(external.designSystem?.name !== undefined
      ? { designSystemName: external.designSystem.name }
      : {}),
    ...(external.designSystem?.markdown !== undefined
      ? { designSystemMarkdown: external.designSystem.markdown }
      : {}),
    ...(external.iframeHtml !== undefined ? { currentHtml: external.iframeHtml } : {}),
    ...(external.model !== undefined ? { model: external.model } : {}),
  };

  // System prompt: override → use it. Else: preamble + extras + current
  // file block.
  let systemPrompt: string;
  if (opts.systemPromptOverride !== undefined) {
    systemPrompt = opts.systemPromptOverride;
  } else {
    const preamble = workspaceContextPreamble(projectCtx);
    const extras = opts.preambleExtras ? `\n\n${opts.preambleExtras}` : "";
    const currentFileBlock = external.iframeHtml
      ? `\n\n## Current ${projectCtx.primaryFile} content\n\n\`\`\`html\n${external.iframeHtml}\n\`\`\`\n`
      : "";
    systemPrompt = `${preamble}${extras}${currentFileBlock}`;
  }

  // append OUTPUT-CONTRACT block when provider materializes via
  // artifact channel. Tool-driven providers (Claude/Codex/etc) get a
  // clean prompt because they write via native Write/Edit calls.
  // F3.2 — When the turn ships with existing iframeHtml, the model is
  // refining an existing file. Pass isEdit so the contract gets the
  // "emit the WHOLE file even for tiny changes" reminder; otherwise
  // OpenRouter/Gemini cheap models return prose explaining the diff
  // and trip the "completed without text or artifact" rejection.
  const filePath = `${projectCtx.projectPath?.replace(/^~\/?/, "") ?? "projects/default"}/${projectCtx.primaryFile ?? "index.html"}`;
  const contractBlock = buildArtifactContractBlock({
    fileWrite: capabilities.fileWrite,
    filePath,
    ...(input.projectId ? { projectName: input.projectId } : {}),
    ...(external.iframeHtml ? { isEdit: true } : {}),
  });
  if (contractBlock) {
    systemPrompt = `${systemPrompt}${contractBlock}`;
  }

  // User block: attachments first, then user text.
  const prompt = composeUserPrompt(input.userMessage, input.attachments);

  // Provider options. Forward sessionId only when present + provider
  // supports resume — otherwise the bridge cold-starts naturally and
  // picks context from the prompt.
  const providerOptions: TurnContext["providerOptions"] = {};
  if (external.model !== undefined) providerOptions.model = external.model;
  if (external.workspaceRoot !== undefined) providerOptions.cwd = external.workspaceRoot;
  if (
    capabilities.supportsResume === true &&
    typeof external.sessionId === "string" &&
    external.sessionId.length > 0
  ) {
    providerOptions.sessionId = external.sessionId;
  }
  if (opts.agent !== undefined) providerOptions.agent = opts.agent;

  const ctx: TurnContext = {
    input,
    providerId: input.providerId,
    capabilities,
    startedAt: now,
    turnId,
    prompt,
    systemPrompt,
    providerOptions,
  };
  if (external.model !== undefined) ctx.model = external.model;
  return ctx;
}

export interface TurnPreviewBlock {
  id: string;
  label: string;
  content: string;
}

/**
 * Returns the prompt as the labeled blocks the engine assembles, for the
 * PromptConsole inspector. MUST stay in sync with prepare() above — same
 * builders, same order — so the inspector shows exactly what gets sent
 * (preamble → project direction → current file → contract → user message).
 * Preview-only: it never touches the send path, so drift at worst shows a
 * slightly-off preview, never a broken turn.
 */
export function assembleTurnBlocks(
  input: UserTurnInput,
  opts: PrepareOptions = {},
): TurnPreviewBlock[] {
  const provider = getProvider(input.providerId);
  const capabilities = provider?.capabilities ?? { fileWrite: "artifact" as const };
  const external = input.context ?? {};
  const projectCtx: ProjectContext = {
    projectId: input.projectId,
    projectPath: external.projectPath ?? "~/design-factory/projeto",
    primaryFile: external.primaryFile ?? "index.html",
    mode: "hifi",
    conversationHistory: external.history ?? [],
    hasDesignSystem: Boolean(external.designSystem?.path),
    cwd: external.workspaceRoot ?? undefined,
    ...(external.designSystem?.path !== undefined
      ? { designSystemPath: external.designSystem.path }
      : {}),
    ...(external.designSystem?.name !== undefined
      ? { designSystemName: external.designSystem.name }
      : {}),
    ...(external.designSystem?.markdown !== undefined
      ? { designSystemMarkdown: external.designSystem.markdown }
      : {}),
    ...(external.iframeHtml !== undefined ? { currentHtml: external.iframeHtml } : {}),
    ...(external.model !== undefined ? { model: external.model } : {}),
  };

  const blocks: TurnPreviewBlock[] = [];
  if (opts.systemPromptOverride !== undefined) {
    blocks.push({
      id: "system",
      label: "System prompt (override)",
      content: opts.systemPromptOverride,
    });
  } else {
    blocks.push({
      id: "preamble",
      label: "Workspace preamble · output contract · design system",
      content: workspaceContextPreamble(projectCtx),
    });
    if (opts.preambleExtras) {
      blocks.push({
        id: "direction",
        label: "Project direction · Format / Rules / Taste",
        content: opts.preambleExtras,
      });
    }
    if (external.iframeHtml) {
      blocks.push({
        id: "current-file",
        label: `Current ${projectCtx.primaryFile} content`,
        content: external.iframeHtml,
      });
    }
  }
  const filePath = `${projectCtx.projectPath?.replace(/^~\/?/, "") ?? "projects/default"}/${projectCtx.primaryFile ?? "index.html"}`;
  const contractBlock = buildArtifactContractBlock({
    fileWrite: capabilities.fileWrite,
    filePath,
    ...(input.projectId ? { projectName: input.projectId } : {}),
    ...(external.iframeHtml ? { isEdit: true } : {}),
  });
  if (contractBlock) {
    blocks.push({
      id: "contract",
      label: "Artifact output contract (API providers)",
      content: contractBlock.trim(),
    });
  }
  blocks.push({
    id: "user",
    label: "User message",
    content: composeUserPrompt(input.userMessage, input.attachments),
  });
  return blocks;
}

/**
 * Compose attachments + user text. Mirrors EditorScreen.handleSend's
 * approach (image-as-path block + text concat) so the resulting prompt is
 * indistinguishable from the legacy path.
 */
export function composeUserPrompt(userMessage: string, attachments?: TurnAttachment[]): string {
  if (!attachments || attachments.length === 0) return userMessage;
  const attachBlock = attachments
    .map((f) => {
      if (f.mime.startsWith("image/")) {
        // Cross-platform absolute-path detection — see EditorScreen.tsx for the
        // sibling check. Windows paths (`C:\...`) were misclassified as data URLs
        // and the agent received garbage.
        const isAbsPath = /^[A-Za-z]:[\\/]|^[\\/]/.test(f.content) || f.content.startsWith("~");
        if (isAbsPath) {
          return `[attached image: ${f.content}]`;
        }
        return `[image: ${f.name} (${(f.size / 1024).toFixed(0)}kb) attached as data URL]\n${f.content}`;
      }
      return `--- ${f.name} (${(f.size / 1024).toFixed(0)}kb) ---\n${f.content}\n--- end of ${f.name} ---`;
    })
    .join("\n\n");
  return `${attachBlock}\n\n${userMessage}`;
}

// ─── Stage 2 — STREAM ────────────────────────────────────────────────────
//
// Calls the provider, accumulates the stream, normalizes tool events.
// Side-channel callbacks fire live so the wrapper can stream to React
// state. The bag is the source of truth for `finalize()`.

export interface StreamOptions {
  category?: PromptCategory;
  sideChannels?: TurnSideChannels;
}

export async function stream(ctx: TurnContext, opts: StreamOptions = {}): Promise<TurnStream> {
  if (ctx.input.signal?.aborted) throw new TurnAbortError();

  const bag: TurnStream = {
    fullText: "",
    tools: [],
    toolEvents: [],
    sessionId: null,
    meta: null,
    result: null,
    errored: false,
    aborted: false,
  };

  const category: PromptCategory =
    opts.category ?? (ctx.input.mode === "ask" ? "consult" : "generate");
  const sideChannels = opts.sideChannels ?? {};
  const liveTools = bag.tools;
  const liveToolEvents = bag.toolEvents;

  let unlisten: (() => void) | null = null;
  let abortListener: (() => void) | null = null;

  const callbacks: StreamCallbacks = {
    onText: (chunk) => {
      bag.fullText += chunk;
      if (sideChannels.onText) {
        try {
          sideChannels.onText(chunk);
        } catch {
          /* swallow */
        }
      }
    },
    onDone: (full) => {
      // Some providers buffer onDone with a fuller text than per-chunk
      // accumulation. Prefer the larger.
      if (full && full.length > bag.fullText.length) {
        bag.fullText = full;
      }
    },
    onError: (err) => {
      bag.errored = true;
      bag.errorMessage = String(err);
    },
    onMeta: (meta) => {
      bag.meta = meta;
      if (sideChannels.onMeta) {
        try {
          sideChannels.onMeta(meta);
        } catch {
          /* swallow */
        }
      }
    },
    onUsage: (usage) => {
      if (sideChannels.onUsage) {
        try {
          sideChannels.onUsage(usage);
        } catch {
          /* swallow */
        }
      }
    },
    onResult: (result) => {
      bag.result = result;
      if (sideChannels.onResult) {
        try {
          sideChannels.onResult(result);
        } catch {
          /* swallow */
        }
      }
    },
    onToolCall: (call) => {
      // Dedup by id — bridge sometimes emits the same tool_call twice.
      const idx = liveTools.findIndex((t) => t.id === call.id);
      if (idx >= 0) {
        liveTools[idx] = { ...liveTools[idx], name: call.name, input: call.input };
      } else {
        liveTools.push({ id: call.id, name: call.name, input: call.input });
      }
      const normalized = fromBridgeToolCall(call, ctx.providerId);
      if (normalized) {
        const evIdx = liveToolEvents.findIndex(
          (e) => e.type === "tool_call" && e.id === normalized.id,
        );
        if (evIdx >= 0) {
          liveToolEvents[evIdx] = normalized;
        } else {
          liveToolEvents.push(normalized);
        }
      }
      if (sideChannels.onToolCall) {
        try {
          sideChannels.onToolCall(call);
        } catch {
          /* swallow */
        }
      }
    },
    onToolResult: (tr) => {
      const idx = liveTools.findIndex((t) => t.id === tr.id);
      if (idx >= 0) {
        liveTools[idx] = {
          ...liveTools[idx],
          result: { content: tr.content, isError: tr.isError },
        };
      }
      const normalizedResult = fromBridgeToolResult(tr, ctx.providerId);
      if (normalizedResult) {
        liveToolEvents.push(normalizedResult);
      }
      if (sideChannels.onToolResult) {
        try {
          sideChannels.onToolResult(tr);
        } catch {
          /* swallow */
        }
      }
    },
    onSession: (id) => {
      bag.sessionId = id;
      if (sideChannels.onSessionId) {
        try {
          sideChannels.onSessionId(id);
        } catch {
          /* swallow */
        }
      }
    },
    onAuthRequired: (detail) => {
      bag.authRequired = detail;
      if (sideChannels.onAuthRequired) {
        try {
          sideChannels.onAuthRequired(detail);
        } catch {
          /* swallow */
        }
      }
    },
  };

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (abortListener && ctx.input.signal) {
        try {
          ctx.input.signal.removeEventListener("abort", abortListener);
        } catch {
          /* swallow */
        }
      }
      resolve();
    };

    const wrapped: StreamCallbacks = {
      ...callbacks,
      onDone: (full) => {
        callbacks.onDone(full);
        finish();
      },
      onError: (err) => {
        callbacks.onError(err);
        finish();
      },
    };

    void (async () => {
      try {
        unlisten = await spawnStream(category, ctx.prompt, ctx.systemPrompt, wrapped, {
          providerId: ctx.providerId,
          ...(ctx.providerOptions.model ? { model: ctx.providerOptions.model } : {}),
          ...(ctx.providerOptions.cwd !== undefined ? { cwd: ctx.providerOptions.cwd } : {}),
          ...(ctx.providerOptions.agent ? { agent: ctx.providerOptions.agent } : {}),
          ...(ctx.providerOptions.sessionId ? { sessionId: ctx.providerOptions.sessionId } : {}),
        });
      } catch (err) {
        bag.errored = true;
        bag.errorMessage = err instanceof Error ? err.message : String(err);
        finish();
      }
    })();

    if (ctx.input.signal) {
      abortListener = () => {
        bag.aborted = true;
        if (unlisten) {
          try {
            unlisten();
          } catch {
            /* swallow */
          }
        }
        finish();
      };
      ctx.input.signal.addEventListener("abort", abortListener, { once: true });
      if (ctx.input.signal.aborted) abortListener();
    }
  });

  return bag;
}

// ─── Stage 3 — FINALIZE ─────────────────────────────────────────────────
//
// Processes the artifact (capability-driven), runs lightweight
// validation (Static P0 only — no runtime probe iframe blocking, no
// auto-fix loop), composes the AssistantMessage and TurnResult.
// Persists sticky session id (if emitted) on best-effort basis.
//
// simplification: the runtime probe + auto-fix loop are GONE.
// `validateTurnOutput` runs a lightweight Static P0 check post-stream.
// If render-time errors occur, the UI handles them via try/catch + an
// error bubble. The pipeline is no longer a blocking gate.

export interface FinalizeOptions {
  procOpts?: ProcessArtifactsOptions;
  /** When false, skip provider session upsert (tests / smoke runs). */
  persistProviderSession?: boolean;
}

export async function finalize(
  ctx: TurnContext,
  s: TurnStream,
  opts: FinalizeOptions = {},
): Promise<TurnResult> {
  if (ctx.input.signal?.aborted) throw new TurnAbortError();

  // Step 1 — process artifact (capability-driven dispatch).
  const artifactOutcome = await processArtifactStage(ctx, s, opts.procOpts ?? {});

  // Step 2 — lightweight validation. Only when an artifact actually
  // wrote AND the artifact is parseable. Pure Static P0; no Runtime P0
  // probe iframe, no auto-fix loop.
  const validation = await validateTurnOutput(ctx, s, artifactOutcome);

  // Step 3 — compose AssistantMessage.
  const assistantMessage = composeAssistantMessage(ctx, s, artifactOutcome, validation);

  // Step 4 — best-effort sticky session persistence (v1 shape only —
  // dropped the v3 multi-file aware persistence layer).
  const shouldPersistSession =
    (opts.persistProviderSession ?? true) &&
    ctx.input.projectId.length > 0 &&
    typeof s.sessionId === "string" &&
    s.sessionId.length > 0;
  if (shouldPersistSession && s.sessionId) {
    try {
      // 2s timeout net — `upsertProviderSession` opens fetches to the
      // bridge; if those ever hang (which they did when the URL pointed
      // at a wrong port held by another process), don't block the user
      // from seeing the assistant reply. The session id is also cached
      // client-side via sideChannels.onSession, so a missed disk write
      // here only affects cross-reload --resume.
      await Promise.race([
        upsertProviderSession(ctx.input.projectId, ctx.providerId, { sessionId: s.sessionId }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("upsertProviderSession timeout 2s")), 2000),
        ),
      ]);
    } catch {
      // Best-effort.
    }
  }

  // Step 5 — derive status from outcomes.
  const status = derivePipelineStatus(s, artifactOutcome, validation);
  const duration_ms = Date.now() - ctx.startedAt;

  return {
    status,
    artifacts: [artifactOutcome],
    doneReport: validation.doneReport,
    messages: [assistantMessage],
    toolEvents: assistantMessage.toolEvents ?? [],
    duration_ms,
    sessionId: s.sessionId ?? ctx.input.context?.sessionId ?? null,
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────

/** Capability-driven artifact dispatch.
 *
 *  - Tool-driven providers (`fileWrite === "tool"`) — Claude Code,
 *    Codex CLI, Opencode, Kimi — already wrote bytes via native tool
 *    calls. Surface `provider-uses-write`.
 *  - Artifact providers (`fileWrite === "artifact"`) — Gemini CLI,
 *    Anthropic API, OpenAI API, Gemini API, OpenRouter API, Ollama —
 *    emit text ending in an `<artifact>` block. Hand off to
 *    `parseArtifact()` + `dispatchParseResult` (existing helpers).
 */
async function processArtifactStage(
  ctx: TurnContext,
  s: TurnStream,
  procOpts: ProcessArtifactsOptions,
): Promise<ProcessArtifactsOutcome> {
  if (s.errored || s.aborted || s.fullText.length === 0) {
    return {
      status: "skipped",
      reason: "no-artifact",
      cleanedText: s.fullText,
    };
  }
  if (ctx.capabilities.fileWrite === "tool") {
    return {
      status: "skipped",
      reason: "provider-uses-write",
      cleanedText: s.fullText,
    };
  }
  const parsed = await parseArtifact(s.fullText, { maxBytes: procOpts.maxBytes });
  if (parsed.status === "none") {
    return { status: "skipped", reason: "no-artifact", cleanedText: parsed.cleanedText };
  }
  if (parsed.status === "rejected") {
    return { status: "rejected", reason: parsed.reason, cleanedText: parsed.cleanedText };
  }
  return await dispatchParseResult(parsed, procOpts);
}

/**
 * lightweight validation outcome. Replaces 's
 * `runRuntimeCompletionGate()` blocking gate.
 *
 * Strategy:
 *   - When the artifact actually wrote, run client-side Static P0 to
 *     populate the done report with a clean diagnostic.
 *   - When Static P0 passes, the report status is `ok` (no runtime
 *     probe blocking).
 *   - When Static P0 fails, the report flags it but the file is ALREADY
 *     on disk (the daemon's minimal Static P0 passed). UI render-time
 *     error handling is what catches catastrophic failures now.
 *   - When no artifact wrote, return `{ ok: true, doneReport: null }`.
 *
 * No runtime probe iframe. No auto-fix loop. The wrapper renders the
 * artifact in its iframe; if it fails to render, an error bubble is
 * shown. Validation is INFORMATIONAL post-stream, not blocking.
 */
export interface TurnValidation {
  /** Whether the lightweight Static P0 check passed (or was skipped
   *  because there was no artifact). UI uses this to decide whether to
   *  show a warning chip. Never blocks rendering. */
  ok: boolean;
  /** Reason when `ok: false`. Surface as a warning, not a blocker. */
  reason?: string;
  /** Done report when an artifact wrote. `null` when no artifact OR
   *  when the dispatch surfaced a non-terminal outcome. */
  doneReport: DoneReport | null;
}

export async function validateTurnOutput(
  ctx: TurnContext,
  s: TurnStream,
  artifactOutcome: ProcessArtifactsOutcome,
): Promise<TurnValidation> {
  // No artifact (skipped/rejected/write-failed) → nothing to validate.
  // We treat all of these as `ok: true` because the failure modes
  // surface elsewhere (rejected/write-failed land in the assistant
  // message text via composeAssistantMessage).
  if (artifactOutcome.status !== "written") {
    return { ok: true, doneReport: null };
  }

  // Re-parse to access the artifact body (the cleaned text strips it).
  // dispatchParseResult already wrote the file; we only need the body
  // for Static P0. Re-running parseArtifact is cheap and idempotent.
  const parsed = await parseArtifact(s.fullText, {});
  if (parsed.status !== "artifact") {
    // Highly unlikely (we just wrote successfully) but be defensive.
    return { ok: true, doneReport: null };
  }
  const artifact = parsed.artifact;

  // Lightweight Static P0 — populates the done report's static
  // diagnostic. No runtime probe.
  const staticP0 = validateArtifactStaticP0({
    finalPath: artifact.identifier,
    content: artifact.content,
    contentHash: artifact.contentHash,
    type: artifact.type,
  });

  const doneReport = composeDoneReport({
    artifactHash: artifact.contentHash,
    provider: ctx.providerId,
    model: ctx.model ?? "(unknown)",
    duration_ms: Date.now() - ctx.startedAt,
    staticP0,
  });

  if (staticP0.status === "fail") {
    return {
      ok: false,
      reason: `static-p0: ${staticP0.reason}`,
      doneReport,
    };
  }

  return { ok: true, doneReport };
}

function composeAssistantMessage(
  ctx: TurnContext,
  s: TurnStream,
  artifactOutcome: ProcessArtifactsOutcome,
  validation: TurnValidation,
): AssistantMessage {
  const cleanedText = artifactOutcome.cleanedText;

  let text: string;
  if (s.aborted) {
    text = "[cancelled]";
  } else if (s.errored) {
    text = `[error] ${s.errorMessage ?? "unknown stream error"}`;
  } else {
    text = cleanedText.length > 0 ? cleanedText : "(no response)";
  }

  // Surface artifact-level diagnostics. keeps these inline so the
  // user still sees what happened — they're informational, not
  // pipeline-blocking.
  if (artifactOutcome.status === "rejected") {
    text = `${text}\n\n[artifact rejected] ${artifactOutcome.reason}`;
  }
  if (artifactOutcome.status === "write-failed") {
    text = `${text}\n\n[write failed] HTTP ${artifactOutcome.httpStatus}: ${artifactOutcome.error}`;
  }
  if (!validation.ok && validation.reason) {
    text = `${text}\n\n[validation] ${validation.reason}`;
  }

  const msg: AssistantMessage = {
    role: "assistant",
    provider: ctx.providerId,
    text,
    turnId: ctx.turnId,
  };
  // F-fix: prefer the model NAME the daemon surfaced via `event: meta`
  // over the picker value. The picker often says "default" for
  // BYOK providers where the daemon resolves the actual model — without
  // this, the F1.1 footer renders the literal "default" instead of
  // e.g. "kimi-default" / "gemini-2.5-flash-lite" / "gpt-4o-mini".
  const resolvedModel = s.meta?.model ?? ctx.model;
  if (resolvedModel !== undefined) msg.model = resolvedModel;
  if (s.tools.length > 0) msg.tools = s.tools;
  if (s.toolEvents.length > 0) msg.toolEvents = s.toolEvents;
  if (validation.doneReport) msg.doneReport = validation.doneReport;
  if (artifactOutcome.status === "written") {
    msg.artifactPath = artifactOutcome.finalPath;
  }
  if (s.result) msg.usage = s.result;
  return msg;
}

function derivePipelineStatus(
  s: TurnStream,
  artifactOutcome: ProcessArtifactsOutcome,
  validation: TurnValidation,
): TurnStatus {
  if (s.aborted) return "cancelled";
  if (s.errored) return "error";
  if (!validation.ok) return "static-fail";
  switch (artifactOutcome.status) {
    case "written":
      return "ok";
    case "skipped":
      return "ok";
    case "rejected":
      return "error";
    case "write-failed":
      return "error";
  }
}

// ─── Public entrypoint ──────────────────────────────────────────────────

/**
 * `DF_ENABLE_TURN_PIPELINE_V2` feature flag (kept for backward-compat
 * with the wrapper that still gates on it). Pipeline V2 has been the
 * default since v0.4 was abandoned — makes the simplified pipeline
 * the only path. The flag returns `true` unconditionally.
 */
export function isTurnPipelineV2Enabled(): boolean {
  // pipeline simplified. The legacy fragmented paths are gone.
  // The flag remains exported so EditorScreen's existing gate keeps
  // type-checking, but it's a no-op — the new pipeline IS the path.
  return true;
}

export interface SendUserTurnOptions {
  prepare?: PrepareOptions;
  stream?: StreamOptions;
  finalize?: FinalizeOptions;
  /** Convenience top-level — merged into `stream.sideChannels`. */
  sideChannels?: TurnSideChannels;
}

/**
 * Sole public entrypoint. Composes prepare → stream → finalize.
 * Surfaces the unified `TurnResult` regardless of which stage produced
 * the failure. Backward-compatible API surface — callers (EditorScreen)
 * don't change.
 */
export async function sendUserTurn(
  input: UserTurnInput,
  options: SendUserTurnOptions = {},
): Promise<TurnResult> {
  const startedAt = Date.now();
  let ctx: TurnContext | null = null;

  const streamOpts: StreamOptions = {
    ...(options.stream ?? {}),
    sideChannels: {
      ...(options.stream?.sideChannels ?? {}),
      ...(options.sideChannels ?? {}),
    },
  };

  try {
    ctx = prepare(input, options.prepare ?? {});
    const s = await stream(ctx, streamOpts);
    return await finalize(ctx, s, options.finalize ?? {});
  } catch (err) {
    if (err instanceof TurnAbortError) {
      const tur: TurnError = {
        code: "ABORTED",
        message: err.message,
        stage: stageOfError(err, ctx),
      };
      return buildErrorResult(input, ctx, startedAt, tur);
    }
    if (err instanceof TurnPrepareError) {
      const tur: TurnError = {
        code: err.code,
        message: err.message,
        stage: "prepare",
      };
      return buildErrorResult(input, ctx, startedAt, tur);
    }
    const tur: TurnError = {
      code: "PIPELINE_ERROR",
      message: err instanceof Error ? err.message : String(err),
      stage: stageOfError(err, ctx),
    };
    return buildErrorResult(input, ctx, startedAt, tur);
  }
}

function stageOfError(err: unknown, ctx: TurnContext | null): TurnError["stage"] {
  if (!ctx) return "prepare";
  const msg = err instanceof Error ? err.message : String(err);
  if (/payload|prompt|preamble/i.test(msg)) return "prepare";
  if (/persist|session|artifact|parser/i.test(msg)) return "finalize";
  return "stream";
}

function buildErrorResult(
  input: UserTurnInput,
  ctx: TurnContext | null,
  startedAt: number,
  err: TurnError,
): TurnResult {
  const duration_ms = Date.now() - startedAt;
  const turnId = ctx?.turnId ?? `t${startedAt}`;
  const provider = ctx?.providerId ?? input.providerId;
  return {
    status: err.code === "ABORTED" ? "cancelled" : "error",
    artifacts: [],
    doneReport: null,
    messages: ctx
      ? [
          {
            role: "assistant",
            provider,
            text: err.code === "ABORTED" ? "[cancelled]" : `[error] ${err.message}`,
            turnId,
            ...(ctx.model !== undefined ? { model: ctx.model } : {}),
          },
        ]
      : [],
    toolEvents: [],
    error: err,
    duration_ms,
    sessionId: input.context?.sessionId ?? null,
  };
}
