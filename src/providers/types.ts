type UnlistenFn = () => void;
import type { ClaudeConfig, StreamCallbacks } from "@/lib/claude-bridge";

// Provider-adapter layer. Keeps the existing Claude shellout wrapped in a
// single-interface so future adapters (Codex, Gemini, Ollama) drop in without
// the chat/runtime callers knowing which CLI they are talking to.

// V1 beta provider roster (10 entries). CLI providers spawn locally;
// API providers consume BYOK HTTP; ollama is a local server.
// Removed in v1 beta cleanup 2026-05-15: cursor, copilot, qwen, deepseek.
export type ProviderId =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "kimi"
  | "anthropic"
  | "openai"
  | "gemini-api"
  | "openrouter"
  | "ollama";

export type ProviderStatus =
  | "connected" // binary found + ready to stream
  | "needs-auth" // binary found but not logged in
  | "not-installed" // binary missing
  | "unknown" // probe failed or adapter not implemented
  | "error"; // binary errored out

// release readiness signal returned by GET /providers.
// Mirrors apps/daemon/src/providers/types.mjs ProviderReadiness — keep
// in sync.
//   - "stable"       reference path, validated end-to-end
//   - "beta"         core flow validated, edges untested
//   - "experimental" wired but unverified against live target
export type ProviderReadiness = "stable" | "beta" | "experimental";

// Capability flags drive the dispatch matrix (skill `requires:` vs provider
// support) and the Settings > Providers capability grid.
//
// collapsed Path A/B branching into a single
// capability-driven flow. The runtime no longer asks "is this Path B?" —
// it asks `capabilities.fileWrite === "artifact"`. See `src/runtime/turn-
// stages/process-artifacts.ts` and `build-provider-payload.ts` for the
// new uniform parser entry. Removed fields:
//   - `requiresArtifactWrap` → replaced by `fileWrite === "artifact"`
//   - `artifactStrategy`     → folded into `fileWrite` semantics
//   - `toolEventFormat`      → daemon normalization makes this internal
export interface ProviderCapabilities {
  /** Provider executes skill bodies via native tools (Bash, Read, Edit, etc). */
  tools: boolean;
  /** Provider honours MCP servers. */
  mcp: boolean;
  /** CLI resolves harness-native skill folders (`.claude/skills`,
   *  built-in slash commands) at the binary layer. DF's universal
   *  `/skills/` registry is provider-agnostic — bodies are expanded into
   *  the system prompt before any provider sees them, regardless of
   *  this flag. */
  nativeSkills: boolean;
  /** CLI resolves `.claude/agents` via a --agent flag. */
  nativeAgents: boolean;
  /** Provider emits stream-json events (vs plain text). */
  streamJson: boolean;
  /** Whether the provider can resume a native session (--resume <id> or
   *  equivalent). Used by the Provider Handoff Layer to decide between
   *  cold start (full L1+L2+L3+L4) vs warm switch (delta only).
   *  Defaults to false when omitted — the handoff builder treats absent
   *  flags as stateless. */
  supportsResume?: boolean;
  /** how this provider materializes file output:
   *
   *    - `"tool"`     → provider chains native Write/Edit/Read tool calls;
   *                     the runtime observes via the daemon's tool-event
   *                     stream and never parses an `<artifact>` block.
   *                     The runtime does NOT inject an OUTPUT-CONTRACT
   *                     prompt block for these providers.
   *    - `"artifact"` → provider streams text only; it must end its turn
   *                     with one `<artifact identifier=… type=… title=…>
   *                     …full document…</artifact>` block. The runtime
   *                     parser extracts the body and writes via the
   *                     daemon's `/fs/write/artifact` endpoint, AND the
   *                     prompt builder appends the OUTPUT-CONTRACT block
   *                     so the model knows the shape.
   *
   *  Replaces `requiresArtifactWrap` / `pathA` / `artifactStrategy`. The
   *  field is canonical — there is no feature flag. Defaults to
   *  `"artifact"` when omitted (the safest baseline for a brand-new
   *  provider that hasn't proven a tool-driven path).
   */
  fileWrite: "tool" | "artifact";
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** One-line positioning for the provider grid. */
  blurb: string;
  /** Optional resolved version string, populated by status(). */
  version?: string | null;
  /** Optional extra note (e.g. "requires login"). */
  hint?: string;
  /** Label for the underlying CLI/binary, shown in Settings. */
  binary: string;
}

export interface ProviderStatusReport {
  status: ProviderStatus;
  version?: string | null;
  detail?: string;
}

export interface LLMProvider {
  meta: ProviderMeta;
  capabilities: ProviderCapabilities;
  stream(prompt: string, config: ClaudeConfig, callbacks: StreamCallbacks): Promise<UnlistenFn>;
  once(prompt: string, config?: ClaudeConfig): Promise<string>;
  status(): Promise<ProviderStatusReport>;
}

export const CAPABILITY_LABELS: { key: keyof ProviderCapabilities; label: string; note: string }[] =
  [
    { key: "tools", label: "Tools", note: "Bash, Read, Edit, Grep native" },
    { key: "mcp", label: "MCP", note: "Honours .mcp.json servers" },
    { key: "nativeSkills", label: "Slash skills", note: "Resolves .claude/skills/* natively" },
    { key: "nativeAgents", label: "Agents", note: "Accepts --agent {alias}" },
    { key: "streamJson", label: "Stream-JSON", note: "Structured stream events" },
  ];
