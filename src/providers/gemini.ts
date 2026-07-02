import { streamGemini, geminiOnce } from "@/lib/gemini-bridge";
import { fetchAgents } from "@/lib/agent-registry";
import type { LLMProvider } from "./types";

// Gemini adapter — wraps the daemon's /gemini/* endpoints. The Gemini CLI
// emits streaming JSON only when called with --output-format stream-json,
// and reads the prompt from stdin (which sidesteps Windows ENAMETOOLONG
// for long composed prompts). No native skills/agents/MCP support; tools
// are advertised as false here even though the CLI can shell out, because
// it doesn't honor the same Bash/Read/Edit shape Claude does.

export const geminiProvider: LLMProvider = {
  meta: {
    id: "gemini",
    label: "Gemini CLI",
    blurb: "Google's CLI. Generous free tier on Flash; stream-json output.",
    binary: "gemini",
    transport: "cli",
    needsToken: false,
  },
  capabilities: {
    tools: false,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: true,
    // Gemini CLI emits stream-json text only with no compatible
    // Write tool. The runtime parses an `<artifact>` block from the final
    // text and writes via the daemon. Artifact-driven channel.
    fileWrite: "artifact",
    // Gemini CLI supports `gemini --resume <id>` (POC v1.1 confirmed).
    // threads the sessionId through; the gemini bridge maps to
    // --resume. Falls back to canonical handoff on failure.
    supportsResume: true,
  },
  stream: streamGemini,
  once: geminiOnce,
  async status() {
    const agents = await fetchAgents().catch(() => []);
    const gemini = agents.find((a) => a.id === "gemini");
    if (!gemini || !gemini.available) return { status: "not-installed", version: null };
    return { status: "connected", version: gemini.version ?? null };
  },
};
