import { streamClaude, claudeOnce } from "@/lib/claude-bridge";
import { fetchAgents } from "@/lib/agent-registry";
import type { LLMProvider } from "./types";

// Claude adapter — thin wrapper over the existing claude-bridge stream/once.
// status() routes through the daemon's /agents/list endpoint (same source of
// truth as the AgentPicker dropdown) so Settings > Providers shows the real
// installed-or-not state instead of a stub.

export const claudeProvider: LLMProvider = {
  meta: {
    id: "claude",
    label: "Claude Code",
    blurb: "Anthropic's official CLI. Full native skills, agents, tools and MCP.",
    binary: "claude",
    transport: "cli",
    needsToken: false,
  },
  capabilities: {
    tools: true,
    mcp: true,
    nativeSkills: true,
    nativeAgents: true,
    streamJson: true,
    // tool-driven file writes via native Write/Edit. Runtime
    // observes tool calls via the daemon's tool-event stream; no
    // <artifact> parsing required.
    fileWrite: "tool",
    // Claude Code CLI supports `claude --resume <sessionId>` natively.
    // uses this to keep the user's context across sessions.
    supportsResume: true,
  },
  stream: streamClaude,
  once: claudeOnce,
  async status() {
    const agents = await fetchAgents().catch(() => []);
    const claude = agents.find((a) => a.id === "claude");
    if (!claude || !claude.available) return { status: "not-installed", version: null };
    return { status: "connected", version: claude.version ?? null };
  },
};
