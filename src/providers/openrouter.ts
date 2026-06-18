import {
  streamOpenrouter,
  openrouterOnce,
  getOpenrouterTokenStatus,
} from "@/lib/openrouter-bridge";
import type { LLMProvider } from "./types";

// OpenRouter adapter — proxy to 200+ open-weights and paid models with one
// API key. OpenAI-compatible chat completions. Default model is Llama 3.3
// 70B (free tier). Tools/MCP/skills are all false: this is plain chat
// completion routed through the OpenRouter API.

export const openrouterProvider: LLMProvider = {
  meta: {
    id: "openrouter",
    label: "OpenRouter API",
    blurb: "200+ models behind one key. Llama 3.3 70B free + paid options.",
    binary: "openrouter",
  },
  capabilities: {
    tools: false,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: false,
    // OpenRouter is a stateless chat-completion proxy. Runtime
    // parses `<artifact>` from the response and writes via the daemon.
    fileWrite: "artifact",
    // OpenRouter is a stateless proxy — no session resume.
    // always sends the canonical handoff preamble for this provider.
    supportsResume: false,
  },
  stream: streamOpenrouter,
  once: openrouterOnce,
  async status() {
    try {
      const cfg = await getOpenrouterTokenStatus();
      if (!cfg.tokenSet)
        return {
          status: "needs-auth",
          version: null,
          detail: "Set OPENROUTER_API_KEY or paste it in Settings → Tokens",
        };
      return { status: "connected", version: cfg.source === "env" ? "env key" : "disk key" };
    } catch (e) {
      return { status: "error", version: null, detail: String(e) };
    }
  },
};
