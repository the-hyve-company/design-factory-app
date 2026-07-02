import { makeProviderBridge } from "@/lib/provider-bridge-factory";
import { fetchAgents } from "@/lib/agent-registry";
import type { LLMProvider } from "./types";

// Kimi Code CLI adapter — spawns the `kimi` binary in print mode
// (canonical headless flow documented at
// moonshotai.github.io/kimi-cli/en/customization/print-mode.html).
//
// status() routes through /agents/list so Settings → Providers reflects
// whether the `kimi` binary is on PATH and what version (mirrors the
// pattern used by claude / codex / gemini / opencode adapters).
//
// Auth is handled by the kimi CLI itself: run `kimi` interactively
// once and `/login` (OAuth via browser), or set `MOONSHOT_API_KEY`
// before spawning. DF does not store the credential.

const bridge = makeProviderBridge("kimi");

export const kimiProvider: LLMProvider = {
  meta: {
    id: "kimi",
    label: "Kimi Code CLI",
    blurb: "Moonshot AI's open-source coding CLI. Native tools, OAuth, kimi-k2 family.",
    binary: "kimi",
    transport: "cli",
    needsToken: true,
  },
  capabilities: {
    // kimi-cli executes Bash/Edit/Write via its native tool layer.
    tools: true,
    // Reconciled with the daemon matrix (audit WS3
    // `capability-parity-test`): kimi-cli can load MCP servers from its
    // own config, but DF's spawn doesn't wire any MCP config through —
    // the daemon declares the conservative false and the front now
    // matches. Flip BOTH sides together if the adapter ever forwards
    // .mcp.json.
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    // Print mode emits stream-json (JSONL events on stdout).
    streamJson: true,
    // Tool-driven file writes — runtime observes write events from
    // the JSONL stream, no <artifact> contract required.
    fileWrite: "tool",
    // kimi-cli supports `--continue` / `-S <id>` resume; pipeline
    // wiring still pending so we declare false until validated.
    supportsResume: false,
  },
  stream: bridge.stream,
  once: bridge.once,
  async status() {
    const agents = await fetchAgents().catch(() => []);
    const kimi = agents.find((a) => a.id === "kimi");
    if (!kimi || !kimi.available) {
      return {
        status: "not-installed",
        version: null,
        detail: "Install: curl -LsSf https://code.kimi.com/install.sh | bash",
      };
    }
    return { status: "connected", version: kimi.version ?? null };
  },
};
