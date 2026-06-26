// Regression tests — sanitizedSpawnEnv: stop the daemon's launch-time
// provider keys / GitHub tokens from auto-flowing into spawned CLIs.
// Each CLI may only see the secret(s) its own provider legitimately reads.

import { describe, it, expect } from "vitest";
import { sanitizedSpawnEnv, SECRET_ENV_KEYS } from "./env-blocklist.mjs";

const BASE = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/u",
  SHELL: "/bin/bash",
  CODEX_HOME: "/home/u/.codex",
  FOO: "bar",
  GH_TOKEN: "ghp_secret",
  GITHUB_TOKEN: "ght_secret",
  OPENAI_API_KEY: "sk-openai",
  ANTHROPIC_API_KEY: "sk-anthropic",
  GEMINI_API_KEY: "g-gemini",
  GOOGLE_API_KEY: "g-google",
  OPENROUTER_API_KEY: "or-key",
  KIMI_API_KEY: "kimi-key",
  MOONSHOT_API_KEY: "moon-key",
};

function secretsLeft(env) {
  return [...SECRET_ENV_KEYS].filter((k) => k in env);
}

describe("sanitizedSpawnEnv — per-provider secret allow-lists", () => {
  it("always preserves non-secret env (PATH/HOME/SHELL/CODEX_HOME/custom)", () => {
    for (const ctx of ["claude", "codex", "gemini", "kimi", "opencode", "terminal"]) {
      const env = sanitizedSpawnEnv(ctx, BASE);
      expect(env.PATH).toBe("/usr/bin:/bin");
      expect(env.HOME).toBe("/home/u");
      expect(env.SHELL).toBe("/bin/bash");
      expect(env.CODEX_HOME).toBe("/home/u/.codex"); // codex needs auth.json dir
      expect(env.FOO).toBe("bar");
    }
  });

  it("claude (OAuth) gets NO provider keys and NO GitHub tokens", () => {
    const env = sanitizedSpawnEnv("claude", BASE);
    expect(secretsLeft(env)).toEqual([]);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("codex keeps only OPENAI_API_KEY", () => {
    const env = sanitizedSpawnEnv("codex", BASE);
    expect(secretsLeft(env)).toEqual(["OPENAI_API_KEY"]);
  });

  it("gemini keeps only GEMINI_API_KEY + GOOGLE_API_KEY", () => {
    const env = sanitizedSpawnEnv("gemini", BASE);
    expect(secretsLeft(env).sort()).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  });

  it("kimi keeps only MOONSHOT_API_KEY + KIMI_API_KEY", () => {
    const env = sanitizedSpawnEnv("kimi", BASE);
    expect(secretsLeft(env).sort()).toEqual(["KIMI_API_KEY", "MOONSHOT_API_KEY"]);
  });

  it("opencode keeps the LLM keys but never GitHub tokens / kimi keys", () => {
    const env = sanitizedSpawnEnv("opencode", BASE);
    const left = secretsLeft(env).sort();
    expect(left).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
      ].sort(),
    );
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.KIMI_API_KEY).toBeUndefined();
    expect(env.MOONSHOT_API_KEY).toBeUndefined();
  });

  it("terminal strips every secret (user rc re-exports their own)", () => {
    const env = sanitizedSpawnEnv("terminal", BASE);
    expect(secretsLeft(env)).toEqual([]);
  });

  it("unknown context strips every secret (fail closed)", () => {
    const env = sanitizedSpawnEnv("totally-unknown", BASE);
    expect(secretsLeft(env)).toEqual([]);
  });

  it("does not mutate the base env object", () => {
    const snapshot = { ...BASE };
    sanitizedSpawnEnv("claude", BASE);
    expect(BASE).toEqual(snapshot);
  });
});
