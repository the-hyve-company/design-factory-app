import { streamOpencode, opencodeOnce } from "@/lib/opencode-bridge";
import { fetchAgents } from "@/lib/agent-registry";
import type { LLMProvider } from "./types";

// opencode adapter — sst.dev open-source agent CLI (MIT). Capabilities are
// declared honestly: opencode supports tool use natively but does NOT
// honor harness-native skill resolution (DF expands skill bodies into the
// system prompt — see /skills/ and prompt-invoker), .claude/agents, or
// .claude session resume. The daemon spawns `opencode run --print` and
// forwards stdout chunks as text events.

export const opencodeProvider: LLMProvider = {
  meta: {
    id: "opencode",
    label: "Opencode CLI",
    blurb: "sst.dev open-source agent CLI. MIT-licensed alternative to Claude Code.",
    binary: "opencode",
    transport: "cli",
    needsToken: false,
  },
  capabilities: {
    tools: true,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: false,
    // opencode CLI runs with native tools (Bash/Write/Read) inside
    // `run --print`. The agent writes files itself; runtime treats this
    // as tool-driven even though the bridge surface is text-only. No
    // <artifact> block parsing.
    fileWrite: "tool",
    // opencode does not expose a session resume flag in its `run --print`
    // mode (sst.dev). always sends the canonical handoff
    // preamble for this provider.
    supportsResume: false,
  },
  stream: streamOpencode,
  once: opencodeOnce,
  async status() {
    const agents = await fetchAgents().catch(() => []);
    const oc = agents.find((a) => a.id === "opencode");
    if (!oc || !oc.available) return { status: "not-installed", version: null };
    return { status: "connected", version: oc.version ?? null };
  },
};
