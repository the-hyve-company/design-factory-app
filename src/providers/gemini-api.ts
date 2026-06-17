import { streamGeminiApi, geminiApiOnce, getGeminiApiTokenStatus } from "@/lib/gemini-api-bridge";
import type { LLMProvider } from "./types";

// Gemini API BYOK adapter — direct Google AI Studio Chat Completions
// via the OpenAI-compatible endpoint. Distinct from the `gemini` CLI
// which uses OAuth via the gemini binary.

export const geminiApiProvider: LLMProvider = {
  meta: {
    id: "gemini-api",
    label: "Gemini API",
    blurb: "Direct API. Bring your own key, default gemini-2.0-flash.",
    binary: "gemini-api",
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
  stream: streamGeminiApi,
  once: geminiApiOnce,
  async status() {
    try {
      const cfg = await getGeminiApiTokenStatus();
      if (!cfg.tokenSet)
        return {
          status: "needs-auth",
          version: null,
          detail: "Set GEMINI_API_KEY or paste it in Settings → Tokens",
        };
      return { status: "connected", version: cfg.source === "env" ? "env key" : "disk key" };
    } catch (e) {
      return { status: "error", version: null, detail: String(e) };
    }
  },
};
