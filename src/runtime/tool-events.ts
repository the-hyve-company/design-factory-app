// runtime/tool-events.ts — canonical tool event normalization.
//
// Why this module exists:
// Each provider emits tool activity in a different wire format:
//   - Claude Code CLI (stream-json): `tool_use` content blocks with id/name/input,
//     followed by user-turn `tool_result` blocks with tool_use_id/content/is_error.
//   - Anthropic API (raw HTTP/SSE): identical wire format to Claude (no tool
//     calls in our current daemon impl, but mappers stay symmetrical for when
//     it lands).
//   - Codex CLI (`exec --json`): `command_execution` items at item.started /
//     item.completed (Bash only — no Read/Edit/Write).
//   - Gemini CLI (stream-json): tool calls vary by model; daemon currently
//     emits text-only. Mapper supports the shape Gemini *will* emit when
//     daemon integrates `--tools`.
//   - Ollama / OpenRouter / opencode: text only — no tool events ever.
//
// The dev bridge (apps/daemon/src/index.mjs) already translates per-provider
// stream events into a common SSE vocabulary: `tool_call` and `tool_result`
// frames carrying `{ id, name, input }` and `{ id, isError, content }`.
// The frontend receives those via `StreamCallbacks.onToolCall` /
// `onToolResult` (see claude-bridge.ts).
//
// What adds on top:
//   1. Canonical `NormalizedToolEvent` envelope tagged with provider +
//      timestamp so downstream code (UI, logging, persistence) is fully
//      provider-agnostic — no more switching on `m.role === "claude"` in
//      ChatMessage.
//   2. `normalizeToolEvent()` — per-provider mapper that accepts a raw
//      event in the bridge's vocabulary and returns the canonical envelope
//      (or null when the provider doesn't emit tools / event isn't
//      recognised). Graceful degrade: malformed events return null, never
//      throw.
//   3. Migration path for legacy chat history (see migrations.ts).
//
// Failure mode (spec §): "Provider emite tool_call não normalizada
// → fallback como text_delta + warning estruturado". `normalizeToolEvent`
// returns null for unrecognised shapes; the caller (streamProviderResponse)
// keeps the prose stream intact. The bag still carries the legacy
// `ToolUseLite[]` ledger for ChatMessage's existing renderer, so even
// unmapped events still surface (as the legacy ToolSummary chip).

import type { ProviderId } from "@/providers/types";
import type { ToolCall, ToolResult } from "@/lib/claude-bridge";

// ─── Canonical envelope ──────────────────────────────────────────────────

export type NormalizedToolEvent =
  | NormalizedToolCallEvent
  | NormalizedToolResultEvent
  | NormalizedToolErrorEvent;

export interface NormalizedToolCallEvent {
  type: "tool_call";
  /** Stable per-call id. The provider's own id when available; falls back
   *  to a synthetic `${provider}-${timestamp}` when the bridge couldn't
   *  thread an id through (rare — Codex always emits item.id). */
  id: string;
  /** Canonical tool name. We coerce provider-specific names to the
   *  Claude vocabulary because that's what skills + UI grew up speaking:
   *  "Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebSearch",
   *  "WebFetch". Unknown names pass through unchanged. */
  name: string;
  /** Tool-call arguments. Shape varies per tool — Bash carries `command`,
   *  Read/Edit/Write carry `file_path`, etc. */
  input: Record<string, unknown>;
  /** Provider that emitted the call. Drives the badge in ToolEventBubble. */
  provider: ProviderId;
  /** ISO 8601 stamp. Set at normalization time when the raw event lacks
   *  one — every provider we wrap today omits a timestamp. */
  timestamp: string;
}

export interface NormalizedToolResultEvent {
  type: "tool_result";
  /** Links back to the originating call's id. */
  toolCallId: string;
  /** True when the tool succeeded. False when it errored. */
  ok: boolean;
  /** Output text. Truncated by the UI (ToolEventBubble) but kept full here
   *  so logging / done-report can persist the complete payload. */
  output: string;
  provider: ProviderId;
  timestamp: string;
}

export interface NormalizedToolErrorEvent {
  type: "tool_error";
  toolCallId: string;
  reason: string;
  provider: ProviderId;
  timestamp: string;
}

// ─── Raw event envelope ──────────────────────────────────────────────────

/**
 * Raw events handed to the normalizer. The frontend receives these via
 * `StreamCallbacks.onToolCall` / `onToolResult` (claude-bridge.ts).
 *
 * Why a discriminated union with `kind`: the bridge already converted the
 * provider's wire format into the Claude shape (`ToolCall` / `ToolResult`).
 * The mapper still needs to know whether the raw payload is a "call" or
 * a "result" — content_block alone doesn't tell us. The kind tag keeps
 * the call sites obvious.
 */
export type RawToolEvent =
  | { provider: ProviderId; kind: "tool_call"; raw: unknown }
  | { provider: ProviderId; kind: "tool_result"; raw: unknown };

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Normalize a raw tool event into the canonical envelope. Returns null
 * when the provider doesn't emit tools (Ollama/OpenRouter/opencode), when
 * the event shape isn't recognised, or when a required field is missing.
 *
 * The function NEVER throws — malformed input is a debug signal, not a
 * crash vector. Callers that care about diagnostic warnings should log
 * when they receive null for a provider that *should* emit tools (e.g.
 * Codex returning null on a `command_execution`).
 *
 * Idempotent: calling with the same `raw` always yields the same output
 * (modulo `timestamp` which is wall-clock at normalization time — pass
 * `opts.now` for deterministic tests).
 */
export function normalizeToolEvent(
  event: RawToolEvent,
  opts: { now?: () => string } = {},
): NormalizedToolEvent | null {
  const now = opts.now ?? defaultNow;

  switch (event.provider) {
    case "claude":
    case "anthropic":
      return mapClaudeFamily(event, now);
    case "codex":
      return mapCodex(event, now);
    case "gemini":
      return mapGemini(event, now);
    case "ollama":
    case "openrouter":
    case "opencode":
    // Text-only providers — openai/gemini-api/kimi/anthropic API
    // adapters are all OpenAI-compatible (or text-completion) chat
    // shape. None expose structured tool events to the runtime.
    case "openai":
    case "gemini-api":
    case "kimi":
      // Providers without native tool events. Daemon never emits
      // tool_call/tool_result frames for these; defensive null in case
      // a future capability bump leaks one through.
      return null;
    default:
      return null;
  }
}

/**
 * Convenience helper for stream-provider-response: take a `ToolCall` (the
 * bridge's already-shaped object) and emit a `NormalizedToolCallEvent`
 * tagged with the provider. Saves call sites from constructing a
 * `RawToolEvent` envelope manually.
 */
export function fromBridgeToolCall(
  call: ToolCall,
  provider: ProviderId,
  opts: { now?: () => string } = {},
): NormalizedToolCallEvent | null {
  const ev = normalizeToolEvent({ provider, kind: "tool_call", raw: call }, opts);
  return ev && ev.type === "tool_call" ? ev : null;
}

/**
 * Same idea for tool results. Returns either a `tool_result` (ok=true) or
 * a `tool_error` (ok=false) envelope depending on `result.isError`.
 */
export function fromBridgeToolResult(
  result: ToolResult,
  provider: ProviderId,
  opts: { now?: () => string } = {},
): NormalizedToolResultEvent | NormalizedToolErrorEvent | null {
  const ev = normalizeToolEvent({ provider, kind: "tool_result", raw: result }, opts);
  return ev && (ev.type === "tool_result" || ev.type === "tool_error") ? ev : null;
}

// ─── Per-provider mappers ────────────────────────────────────────────────

function mapClaudeFamily(event: RawToolEvent, now: () => string): NormalizedToolEvent | null {
  if (event.kind === "tool_call") {
    const tc = asToolCall(event.raw);
    if (!tc) return null;
    return {
      type: "tool_call",
      id: tc.id,
      name: canonicalToolName(tc.name),
      input: tc.input,
      provider: event.provider,
      timestamp: now(),
    };
  }
  // tool_result
  const tr = asToolResult(event.raw);
  if (!tr) return null;
  if (tr.isError) {
    return {
      type: "tool_error",
      toolCallId: tr.id,
      reason: tr.content || "tool error",
      provider: event.provider,
      timestamp: now(),
    };
  }
  return {
    type: "tool_result",
    toolCallId: tr.id,
    ok: true,
    output: tr.content,
    provider: event.provider,
    timestamp: now(),
  };
}

function mapCodex(event: RawToolEvent, now: () => string): NormalizedToolEvent | null {
  // The daemon already coerces Codex `command_execution` into the
  // bridge's `ToolCall` shape with name="Bash" and input={command, cwd?}.
  // We accept both the coerced shape (preferred) and the raw Codex
  // item.started shape (defensive — in case a future daemon bypass
  // forwards untranslated events).

  if (event.kind === "tool_call") {
    const tc = asToolCall(event.raw);
    if (tc) {
      return {
        type: "tool_call",
        id: tc.id,
        name: canonicalToolName(tc.name || "Bash"),
        input: tc.input,
        provider: "codex",
        timestamp: now(),
      };
    }
    // Defensive: raw Codex `command_execution` item shape.
    const raw = event.raw as Record<string, unknown> | undefined;
    if (raw && typeof raw === "object" && raw.type === "command_execution") {
      const id = typeof raw.id === "string" ? raw.id : `codex-${Date.now()}`;
      const command = typeof raw.command === "string" ? raw.command : "";
      const cwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
      return {
        type: "tool_call",
        id,
        name: "Bash",
        input: { command, ...(cwd ? { cwd } : {}) },
        provider: "codex",
        timestamp: now(),
      };
    }
    return null;
  }

  // tool_result
  const tr = asToolResult(event.raw);
  if (!tr) return null;
  if (tr.isError) {
    return {
      type: "tool_error",
      toolCallId: tr.id,
      reason: tr.content || "command failed",
      provider: "codex",
      timestamp: now(),
    };
  }
  return {
    type: "tool_result",
    toolCallId: tr.id,
    ok: true,
    output: tr.content,
    provider: "codex",
    timestamp: now(),
  };
}

function mapGemini(event: RawToolEvent, now: () => string): NormalizedToolEvent | null {
  // Gemini today (daemon's wireGeminiJson) emits text-only — it never
  // forwards tool events. When the daemon adds `--tools` support, the
  // SSE will follow the same `tool_call` / `tool_result` vocabulary as
  // Claude/Codex (that's the daemon's design contract). We map exactly
  // like the Claude family because the on-the-wire shape is identical.
  //
  // If/when Gemini emits a non-Claude-shape tool event (e.g. function
  // calls with `args` instead of `input`), we coerce to the canonical
  // shape best-effort and return null when nothing makes sense.

  if (event.kind === "tool_call") {
    const tc = asToolCall(event.raw);
    if (tc) {
      return {
        type: "tool_call",
        id: tc.id,
        name: canonicalToolName(tc.name),
        input: tc.input,
        provider: "gemini",
        timestamp: now(),
      };
    }
    // Best-effort Gemini-native shape: { name, args } (function calling).
    const raw = event.raw as Record<string, unknown> | undefined;
    if (raw && typeof raw === "object" && typeof raw.name === "string") {
      const args =
        raw.args && typeof raw.args === "object" ? (raw.args as Record<string, unknown>) : {};
      const id = typeof raw.id === "string" ? raw.id : `gemini-${Date.now()}`;
      return {
        type: "tool_call",
        id,
        name: canonicalToolName(raw.name),
        input: args,
        provider: "gemini",
        timestamp: now(),
      };
    }
    return null;
  }

  const tr = asToolResult(event.raw);
  if (!tr) return null;
  if (tr.isError) {
    return {
      type: "tool_error",
      toolCallId: tr.id,
      reason: tr.content || "tool error",
      provider: "gemini",
      timestamp: now(),
    };
  }
  return {
    type: "tool_result",
    toolCallId: tr.id,
    ok: true,
    output: tr.content,
    provider: "gemini",
    timestamp: now(),
  };
}

// ─── Type guards ─────────────────────────────────────────────────────────

function asToolCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string" || !r.name) return null;
  const input = r.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    // Bridge coerces input to {} when the provider sends nothing — accept
    // that as valid (empty input). But a missing field should bail.
    if (input === undefined) return null;
    return null;
  }
  return { id: r.id, name: r.name, input: input as Record<string, unknown> };
}

function asToolResult(raw: unknown): ToolResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  // isError is a boolean in the canonical shape; we coerce truthy-falsy
  // values defensively (some daemons emit "true"/"false" strings).
  const isError = r.isError === true || r.isError === "true";
  const content = typeof r.content === "string" ? r.content : "";
  return { id: r.id, isError, content };
}

// ─── Tool name canonicalisation ──────────────────────────────────────────

/**
 * Coerce provider-specific tool names to the canonical Claude vocabulary
 * the UI + skills speak. This keeps ChatMessage's name-based dispatch
 * (and the fileWrites/fileEdits classification in ToolSummary) provider-
 * agnostic without per-provider conditionals.
 *
 * Unknown names pass through unchanged so future tools (e.g. NotebookEdit)
 * surface as-is rather than mis-mapped.
 */
export function canonicalToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  // Codex's `command_execution` is already mapped to "Bash" at the
  // daemon — but we double-coerce here in case a different surface
  // forwards the raw name.
  if (trimmed === "command_execution") return "Bash";
  // Some providers prefix with module names: "anthropic.Bash" or
  // "tools.bash". Strip leading `module.` prefix only when the rest is
  // a known canonical name.
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx > 0 && dotIdx < trimmed.length - 1) {
    const tail = trimmed.slice(dotIdx + 1);
    if (CANONICAL_TOOL_NAMES.has(tail)) return tail;
    // Title-case fallback — "tools.bash" → "Bash"
    const titled = tail.charAt(0).toUpperCase() + tail.slice(1);
    if (CANONICAL_TOOL_NAMES.has(titled)) return titled;
  }
  // Bare name normalisation: lower-case "bash" → "Bash" when it matches a
  // canonical entry case-insensitively.
  const titled = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (CANONICAL_TOOL_NAMES.has(titled)) return titled;
  return trimmed;
}

const CANONICAL_TOOL_NAMES = new Set([
  "Bash",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "TodoWrite",
]);

function defaultNow(): string {
  return new Date().toISOString();
}
