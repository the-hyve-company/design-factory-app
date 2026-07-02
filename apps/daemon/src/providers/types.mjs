// Provider adapter contract — one shape for every LLM backend.
//
// extracted 14 inline handlers from index.mjs into
// per-provider modules. Each module exports a default object that
// matches `ProviderAdapter` below.
//
// Why an interface over inline handlers:
//   1. Capabilities are now declarative (capabilities object), so the
//      runtime + UI can branch on streaming/tools/sessions/etc. without
//      hard-coding per-provider quirks.
//   2. Adding a new provider = drop one file in providers/ and add it
//      to the registry. No more 80-line inline blocks scattered across
//      a 5666-line index.mjs.
//   3. The registry powers /providers and /providers/:id introspection
//      endpoints — the UI can render a provider picker driven by the
//      same source of truth as the dispatch logic.
//
// JSDoc-only typedefs — daemon code is .mjs (Node, no ts-node). The
// interface is enforced by convention; tsc still type-checks via
// .mjs allowJs.
//
// @file providers/types.mjs

/**
 * Static capability flags. The UI / runtime read these to decide what
 * affordances to expose (e.g., session resume button, tool indicators).
 * False = unsupported, not "unknown" — be conservative when adding new
 * providers to avoid the runtime promising features the upstream API
 * can't actually deliver.
 *
 * replaced the boolean `pathA` with the canonical
 * `fileWrite: "tool" | "artifact"` capability. Tool-driven providers
 * write files via native tool calls (Write/Edit/Bash); artifact-driven
 * providers stream text and the runtime parses an `<artifact>` block.
 *
 * Vocabulary parity (audit WS3 `unify-capability-shape`): fields that
 * describe the SAME concept as the frontend matrix
 * (src/providers/types.ts) use the SAME name — `tools`, `mcp`,
 * `fileWrite`, `supportsResume` (renamed from the old `sessions`).
 * Side-specific fields are intentional: `streaming`/`multimodal` are
 * transport truths only the daemon knows; `nativeSkills`/
 * `nativeAgents`/`streamJson` are harness features only the front
 * consumes. capability-parity.test.ts locks the shared subset.
 *
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} streaming Server-sent events / incremental chunks
 * @property {boolean} tools Native function calling / tool use
 * @property {boolean} multimodal Image input support
 * @property {boolean} supportsResume Session resume (--resume / session_id)
 * @property {boolean} mcp MCP server protocol support
 * @property {"tool"|"artifact"} fileWrite How the provider materializes
 *           files. "tool" = native Write/Edit calls; "artifact" = `<artifact>`
 *           block parsed by the runtime.
 */

/**
 * Release readiness — honest signal about how thoroughly an adapter has
 * been exercised against real workloads. Surfaced in /providers responses
 * and used by the picker UI to badge providers + steer users toward
 * verified paths.
 *
 *   - "stable" — reference path, broad test coverage, known to ship
 *                      end-to-end including tools/sessions where claimed.
 *   - "beta" — adapter works for the core stream/once flow; some
 *                      capabilities (resume, multimodal, MCP) untested
 *                      against a real account/instance.
 *   - "experimental" — adapter compiles + emits the contract events but
 *                      is unverified against a live CLI/API. Use at your
 *                      own risk; expect rough edges.
 *
 * added at the request layer to keep the the current public surface release
 * matrix honest. 13 providers register; only Claude is "stable" today.
 *
 * @typedef {"stable"|"beta"|"experimental"} ProviderReadiness
 */

/**
 * Identity returned by `auth()` when the provider is logged in / has
 * a working token.
 *
 * @typedef {Object} ProviderProfile
 * @property {string} login Username / identity
 * @property {string} [email]
 * @property {string} [avatar]
 * @property {"cli"|"api"|"local"} type
 */

/**
 * Normalized SSE chunk shape. Per-provider parsers in adapter.stream()
 * convert native upstream events (claude-stream-json, ACP, OpenAI SSE,
 * Ollama NDJSON) into this shape. keeps backward-compat by emitting
 * the legacy event names too — may unify on `data: {type:...}`.
 *
 * @typedef {Object} StreamChunk
 * @property {"delta"|"tool_use"|"end"|"error"} type
 * @property {string} [text]
 * @property {Object} [tool]
 * @property {string} [error]
 */

/**
 * Shared helpers passed by the dispatcher. Adapters take these as deps
 * (rather than importing from index.mjs) to keep imports unidirectional
 * — index.mjs imports providers/, never the reverse.
 *
 * @typedef {Object} ProviderDeps
 * @property {(req: any) => Promise<any>} readJson
 * @property {(child: any, res: any, onDone?: Function) => void} wireStreamJson
 * @property {(child: any, res: any, onDone?: Function) => void} wireCodexJson
 * @property {(child: any, res: any, onDone?: Function) => void} wireGeminiJson
 * @property {(upstream: any, res: any) => Promise<void>} pipeAnthropicStream
 * @property {() => Promise<string|null>} getAnthropicToken
 * @property {() => Promise<string|null>} getOpenrouterToken
 * @property {Function} spawn
 * @property {string} CLAUDE_BIN
 */

/**
 * @typedef {Object} ProviderAdapter
 * @property {string} id "claude" | "codex" | "gemini" | "anthropic" | "openrouter" | "ollama" | "opencode" | …
 * @property {string} label Human-readable name
 * @property {ProviderCapabilities} capabilities
 * @property {ProviderReadiness} [readiness] — release readiness badge.
 *           Defaults to "experimental" when omitted (the safest baseline
 *           for a brand-new adapter).
 * @property {(req: any, res: any, deps: ProviderDeps) => Promise<void>} stream POST /<id>/stream handler
 * @property {(req: any, res: any, deps: ProviderDeps) => Promise<void>} once POST /<id>/once handler
 */

export {}; // ESM marker — typedefs only
