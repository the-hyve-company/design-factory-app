import { streamOllama, ollamaOnce, fetchOllamaStatus } from "@/lib/ollama-bridge";
import type { LLMProvider } from "./types";

// Ollama adapter — talks to a local Ollama server (default :11434) for fully
// local inference. No CLI spawn, no API key, no cloud. Tools/MCP/skills are
// all false: Ollama is plain chat completion. The /tweaks skill, slash menu,
// and other tool-calling features won't reach this provider.

export const ollamaProvider: LLMProvider = {
  meta: {
    id: "ollama",
    label: "Ollama",
    blurb: "Local weights — Llama, Qwen, Mistral, Hermes. Free, fully local, no accounts.",
    binary: "ollama",
  },
  capabilities: {
    tools: false,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: false,
    // local Ollama is plain chat completion. Runtime parses
    // `<artifact>` and writes via the daemon.
    fileWrite: "artifact",
    // Ollama is plain chat completion — no native session resume. 
    // 3B always sends the canonical handoff preamble for this provider.
    supportsResume: false,
  },
  stream: streamOllama,
  once: ollamaOnce,
  async status() {
    // Ollama isn't a CLI we shell out to — it's a server. Probe via the
    // daemon (which tries 127.0.0.1 / localhost / [::1] in order). The
    // detail message distinguishes the three real failure modes so the
    // user knows what to fix instead of just seeing "not installed":
    //
    //   - server offline → "Server não respondeu em <hosts>. Abra o
    //     Ollama desktop ou rode `ollama serve`."
    //   - server up, no models → "Server respondendo mas sem modelos.
    //     Rode `ollama pull llama3.2` (ou outro modelo)."
    //   - server up, with models → connected.
    //
    // Pre-fix: founder reported "ollama aberto no pc e nao funciona" —
    // hit the IPv6 vs IPv4 silent failure on Windows; daemon now tries
    // IPv4 first so this surface should rarely show the unreachable
    // branch, but when it does the message is actionable.
    const s = await fetchOllamaStatus();
    if (s.models.length > 0) {
      const suffix = s.host ? ` · ${s.host}` : "";
      return {
        status: "connected",
        version: `${s.models.length} model${s.models.length === 1 ? "" : "s"}${suffix}`,
      };
    }
    if (s.error) {
      const triedNote = s.triedHosts.length
        ? `Tentei: ${s.triedHosts.join(", ")}. `
        : "";
      return {
        status: "not-installed",
        version: null,
        detail: `Ollama não respondeu. ${triedNote}Abra o Ollama desktop ou rode \`ollama serve\`. (${s.error})`,
      };
    }
    return {
      status: "not-installed",
      version: null,
      detail: "Ollama respondeu mas sem modelos. Rode `ollama pull llama3.2` (ou outro modelo) primeiro.",
    };
  },
};
