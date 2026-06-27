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
  "DF_", // DF internal config
  "MULTICA_", // reserved for future Multica-style daemon coords
  "AIOS_", // AIOS framework reserved
  "NODE_", // node runtime (NODE_OPTIONS, NODE_PATH, NODE_AUTH_TOKEN, etc.)
  "LD_", // Linux loader (LD_PRELOAD, LD_LIBRARY_PATH)
  "DYLD_", // macOS loader
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
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  // Codex / Claude internal
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CODEX_HOME",
]);

// Secret/token keys that must never auto-flow from the daemon's own
// environment into a spawned subprocess. These are the daemon's launch-time
// credentials — a spawned agent (running generated code / auto-approved
// tools under --dangerously-skip-permissions) or a hijacked terminal should
// only ever see the one key its own provider legitimately needs, never the
// full set. This is a STRICT SUBSET of BLOCKED_EXACT: it deliberately omits
// PATH/HOME/USER/SHELL/PWD/TMPDIR (needed to actually RUN the subprocess) and
// CODEX_HOME (codex needs it to find its auth.json).
export const SECRET_ENV_KEYS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_TOKEN_LAB_GROUP",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
]);

// Per-context allow-list: which secret keys each spawn target legitimately
// reads from env. Everything else in SECRET_ENV_KEYS is stripped.
//   - claude: OAuth login only (the BYOK path is the separate "anthropic"
//     provider) → needs none; ANTHROPIC_API_KEY is stripped on purpose.
//   - codex: ChatGPT OAuth, OPENAI_API_KEY as fallback.
//   - gemini: OAuth, GEMINI_API_KEY / GOOGLE_API_KEY as fallback.
//   - kimi: OAuth /login, MOONSHOT_API_KEY / KIMI_API_KEY as fallback.
//   - opencode: multi-provider (own auth store, env fallback) → keeps the
//     LLM keys but never GitHub tokens / cross-CLI keys.
//   - terminal: the user's interactive shell re-sources their own rc, so the
//     daemon's launch-time secrets are stripped (defense-in-depth against a
//     sandbox-escaped page reaching the WS terminal).
const SPAWN_ENV_ALLOW = {
  claude: [],
  codex: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  kimi: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  opencode: [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
  ],
  terminal: [],
};

// Build a spawn env from a base env (default: the daemon's process.env) with
// every SECRET_ENV_KEYS entry stripped EXCEPT the ones the given context is
// allow-listed for. Pass a provider id (claude/codex/gemini/kimi/opencode)
// or "terminal". Unknown contexts get the empty allow-list (strip all).
export function sanitizedSpawnEnv(contextId, baseEnv = process.env) {
  const env = { ...baseEnv };
  const allow = new Set(SPAWN_ENV_ALLOW[contextId] ?? []);
  for (const key of SECRET_ENV_KEYS) {
    if (!allow.has(key)) delete env[key];
  }
  return env;
}

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
