// Shared Ollama host resolution.
//
// Detection (/ollama/models) and generation (/ollama/stream, /ollama/once)
// MUST agree on which host to talk to. Before this module, detection probed
// 127.0.0.1 → localhost → [::1] and listed models from whichever answered,
// while the chat path hard-coded 127.0.0.1. On setups where Ollama binds
// only IPv6 (::1) or only `localhost` (Windows / WSL / Docker), the picker
// listed models but generation failed with a bare "fetch failed". One probe,
// one cached result, both paths agree.
//
// @file providers/ollama-host.mjs

const DEFAULT_HOSTS = ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"];

/** Candidate hosts in probe order. A DF_OLLAMA_HOST override collapses the
 *  list to a single explicit host (no fallback — the user said where it is). */
export function ollamaHostCandidates() {
  const override = process.env.DF_OLLAMA_HOST;
  return override ? [override] : [...DEFAULT_HOSTS];
}

// Brief cache so detection + the immediately-following chat reuse the same
// resolved host without re-probing. Only successes are cached; a failed
// probe is never cached so a just-started server is picked up on the next call.
const TTL_MS = 30_000;
let _cache = null; // { at: number, result }

/** Probe candidate hosts for a live /api/tags and return the first that
 *  answers, with diagnostics. Shape: { ok, host, data, tried, error }. */
export async function probeOllamaHost(nowMs = Date.now()) {
  if (_cache && nowMs - _cache.at < TTL_MS) return _cache.result;
  const hosts = ollamaHostCandidates();
  const errors = [];
  for (const host of hosts) {
    try {
      const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        const result = { ok: true, host, data, tried: hosts, error: null };
        _cache = { at: nowMs, result };
        return result;
      }
      errors.push(`${host} → HTTP ${r.status}`);
    } catch (e) {
      errors.push(`${host} → ${(e && e.message) || String(e)}`);
    }
  }
  return { ok: false, host: null, data: null, tried: hosts, error: errors.join(" · ") };
}

/** Resolve just the working host string for a chat call. Falls back to the
 *  first candidate when no host answered, so the upstream call produces a
 *  structured connection error (handled by ollamaErrorMessage) rather than
 *  throwing on an undefined host. */
export async function resolveOllamaHost() {
  const probe = await probeOllamaHost();
  return probe.ok ? probe.host : ollamaHostCandidates()[0];
}

/** Test seam — drop the cached probe result. */
export function _resetOllamaHostCache() {
  _cache = null;
}

// ── Model capabilities ─────────────────────────────────────────────────────
//
// /api/show exposes a model's `capabilities` array and its max context length
// (`model_info["<family>.context_length"]`). The chat path needs all three
// signals it returns:
//   - chat:   does the model have a chat template? completion-only weights and
//             embedding models (bge, nomic, …) report no "completion" cap and
//             bounce /api/chat as `400 "<model>" does not support chat`. We
//             guard before calling /api/chat so the user sees an actionable
//             message instead of the cryptic 400.
//   - thinking: reasoning models (qwen3, deepseek-r1, gpt-oss) accept
//             `think:true`, which routes reasoning to `message.thinking` (kept
//             OUT of `message.content`). Only send think:true when supported.
//   - maxContext: clamp num_ctx so we never request more than the model can
//             hold (Ollama would error or silently degrade).

const CAP_TTL_MS = 60_000;
/** @type {Map<string, { at: number, caps: { chat: boolean, thinking: boolean, maxContext: number|null } }>} */
const _capCache = new Map();

/** Permissive fallback — when /api/show is unreachable or malformed we don't
 *  block the turn; the real /api/chat error path still catches a genuinely
 *  chat-incapable model via ollamaErrorMessage. */
const CAPS_FALLBACK = { chat: true, thinking: false, maxContext: null };

/** Pull the `<family>.context_length` out of /api/show's model_info, whatever
 *  the family key is (qwen3.context_length, llama.context_length, …). */
export function extractMaxContext(modelInfo) {
  if (!modelInfo || typeof modelInfo !== "object") return null;
  for (const [k, v] of Object.entries(modelInfo)) {
    if (k.endsWith(".context_length") && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Resolve a model's chat/thinking/maxContext capabilities via /api/show.
 * Cached per (host, model) for CAP_TTL_MS. Never throws — returns the
 * permissive fallback on any failure.
 *
 * @param {string} host
 * @param {string} model
 * @param {number} [nowMs]
 * @returns {Promise<{ chat: boolean, thinking: boolean, maxContext: number|null }>}
 */
export async function getModelCapabilities(host, model, nowMs = Date.now()) {
  const key = `${host}::${model}`;
  const hit = _capCache.get(key);
  if (hit && nowMs - hit.at < CAP_TTL_MS) return hit.caps;
  try {
    const r = await fetch(`${host}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return CAPS_FALLBACK;
    const data = await r.json().catch(() => null);
    const list = Array.isArray(data?.capabilities) ? data.capabilities : [];
    const caps = {
      // "completion" = has a chat/generate template. Its absence (embedding,
      // raw completion-only imports) is exactly the does-not-support-chat case.
      chat: list.includes("completion"),
      thinking: list.includes("thinking"),
      maxContext: extractMaxContext(data?.model_info),
    };
    _capCache.set(key, { at: nowMs, caps });
    return caps;
  } catch {
    return CAPS_FALLBACK;
  }
}

/** Test seam — drop cached capabilities. */
export function _resetModelCapsCache() {
  _capCache.clear();
}

// ── Chat-tuning knobs (pure, env-driven) ───────────────────────────────────

const DEFAULT_NUM_CTX = 16384;

/**
 * Resolve the num_ctx to request. Ollama defaults to 4096 when omitted, which
 * silently truncates the DF system-prompt stack (preamble + craft + output
 * contract + current file + history) — the model never sees the user's actual
 * ask. We request a generous window, clamped to the model's real maximum.
 *
 * `DF_OLLAMA_NUM_CTX` overrides the 16384 default (raise on a roomy GPU).
 *
 * @param {number|null} maxContext model's max, from getModelCapabilities
 * @param {string|undefined} envValue process.env.DF_OLLAMA_NUM_CTX
 * @returns {number}
 */
export function resolveNumCtx(maxContext, envValue) {
  const parsed = Number.parseInt(String(envValue ?? "").trim(), 10);
  const want = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NUM_CTX;
  if (Number.isFinite(maxContext) && maxContext > 0) return Math.min(want, maxContext);
  return want;
}

/**
 * Resolve whether to request thinking. Default "auto" = on when the model
 * supports it. `DF_OLLAMA_THINK` accepts 0/false/off to force-disable (faster,
 * lower quality) or 1/true/on to force the auto behaviour explicitly.
 *
 * Returns the desired intent; callers AND it with the model's `thinking` cap so
 * a non-reasoning model is never sent think:true.
 *
 * @param {string|undefined} envValue process.env.DF_OLLAMA_THINK
 * @returns {boolean} desired think intent (before capability gating)
 */
export function parseEnvThink(envValue) {
  const v = String(envValue ?? "")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  // "", "auto", "1", "true", "on", anything else → desire thinking
  return true;
}
