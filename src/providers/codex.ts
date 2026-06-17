import { streamCodex, codexOnce } from "@/lib/codex-bridge";
import { fetchAgents } from "@/lib/agent-registry";
import type { LLMProvider } from "./types";

// Codex adapter — wraps the daemon's /codex/* endpoints. Capabilities are
// declared honestly: codex executes Bash but does NOT honor harness-native
// skill resolution (DF expands skill bodies into the system prompt before
// codex sees them — see /skills/ and prompt-invoker), .claude/agents, MCP,
// or .claude session resume. The daemon's stream parser translates Codex's
// `exec --json` events into the same SSE shape Claude uses so callbacks
// (onText, onToolCall, etc) stay agnostic.

export const codexProvider: LLMProvider = {
  meta: {
    id: "codex",
    label: "Codex CLI",
    blurb: "OpenAI's coding agent. GPT-5/o3/o4 family with reasoning effort knob.",
    binary: "codex",
  },
  capabilities: {
    tools: true, // command_execution / Bash
    mcp: false, // codex doesn't load MCP servers
    nativeSkills: false,
    nativeAgents: false,
    streamJson: true,
    // codex CLI exec mode runs Bash + writes files via tool calls.
    // The daemon's wireCodexStream coerces Codex's command_execution items
    // into normalized tool events; the runtime observes those, not an
    // <artifact> block. Tool-driven channel.
    fileWrite: "tool",
    // Codex CLI 1.1+ supports `codex resume <UUID> [PROMPT]` (POC v1.1
    // confirmed). 's prepare stage threads the sessionId through
    // when present; the codex bridge translates to the resume subcommand.
    supportsResume: true,
  },
  stream: streamCodex,
  once: codexOnce,
  async status() {
    const agents = await fetchAgents().catch(() => []);
    const codex = agents.find((a) => a.id === "codex");
    if (!codex || !codex.available) return { status: "not-installed", version: null };
    return { status: "connected", version: codex.version ?? null };
  },
};
