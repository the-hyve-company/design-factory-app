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

const DEFAULT_HOSTS = [
  "http://127.0.0.1:11434",
  "http://localhost:11434",
  "http://[::1]:11434",
];

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
