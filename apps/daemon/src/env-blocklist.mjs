// env-blocklist.mjs — guard list for env vars passed to spawned CLIs.
//
// When the runtime allows clients to inject env vars into spawned CLIs
// (e.g. provider handoff layer with `agent.customEnv`), some keys must
// never be overridable: process boot vars (NODE_OPTIONS, LD_PRELOAD),
// auth tokens (GH_TOKEN, OPENAI_API_KEY), and DF-internal contracts
// (DF_*).
//
// Rule: validate before merging into the spawn env. Block silently
// with a structured warning, never crash the request.

const BLOCKED_PREFIXES = [
  "DF_",                    // DF internal config
  "NODE_",                  // node runtime (NODE_OPTIONS, NODE_PATH, NODE_AUTH_TOKEN, etc.)
  "LD_",                    // Linux loader (LD_PRELOAD, LD_LIBRARY_PATH)
  "DYLD_",                  // macOS loader
];

const BLOCKED_EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "USERPROFILE",
  "SHELL",
  "PWD",
  "TMPDIR",
  "TMP",
  "TEMP",
  // Auth tokens — should never come from client config
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_TOKEN_LAB_GROUP",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  // Codex / Claude internal
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CODEX_HOME",
]);

export function isBlockedEnvKey(key) {
  if (typeof key !== "string" || key.length === 0) return true;
  if (BLOCKED_EXACT.has(key)) return true;
  for (const prefix of BLOCKED_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

// Returns { safe: { key: value }, blocked: [keys] }. Use this when
// merging client-supplied env into spawn env.
export function filterEnv(envCandidate) {
  const safe = {};
  const blocked = [];
  if (envCandidate && typeof envCandidate === "object") {
    for (const [key, value] of Object.entries(envCandidate)) {
      if (isBlockedEnvKey(key)) {
        blocked.push(key);
        continue;
      }
      if (typeof value !== "string") continue;
      safe[key] = value;
    }
  }
  return { safe, blocked };
}
