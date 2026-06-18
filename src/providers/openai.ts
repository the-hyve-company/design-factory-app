import { streamOpenai, openaiOnce, getOpenaiTokenStatus } from "@/lib/openai-bridge";
import type { LLMProvider } from "./types";

// OpenAI BYOK adapter — direct OpenAI Chat Completions API via key.
// Distinct from the `codex` CLI which uses OAuth.

export const openaiProvider: LLMProvider = {
  meta: {
    id: "openai",
    label: "OpenAI API",
    blurb: "Direct API. Bring your own key, default gpt-4o-mini.",
    binary: "openai",
  },
  capabilities: {
    tools: false,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: false,
    fileWrite: "artifact",
    supportsResume: false,
  },
  stream: streamOpenai,
  once: openaiOnce,
  async status() {
    try {
      const cfg = await getOpenaiTokenStatus();
      if (!cfg.tokenSet)
        return {
          status: "needs-auth",
          version: null,
          detail: "Set OPENAI_API_KEY or paste it in Settings → Tokens",
        };
      return { status: "connected", version: cfg.source === "env" ? "env key" : "disk key" };
    } catch (e) {
      return { status: "error", version: null, detail: String(e) };
    }
  },
};
