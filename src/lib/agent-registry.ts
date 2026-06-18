// Agent registry — fetches the list of CLI agents detected on PATH from the
// daemon's GET /agents/list endpoint. Used by the agent picker UI to show
// which CLIs are installed (and which would need installing).
//
// The daemon caches its scan for 30s. We cache the response in memory for the
// same window so flipping screens doesn't hammer the endpoint.

import { BRIDGE_URL } from "@/lib/claude-bridge";

// V1 beta CLI roster. Mirrors AGENT_DEFS in apps/daemon/src/index.mjs.
export type AgentId = "claude" | "codex" | "gemini" | "opencode" | "kimi";

export interface DetectedAgent {
  id: AgentId;
  label: string;
  bin: string;
  /** Resolved absolute path. Only present when `available: true`. */
  resolved?: string;
  /** Whether the CLI was found on PATH. */
  available: boolean;
  /** Version string parsed from `--version`, or null if probe failed. */
  version?: string | null;
}

let cache: { agents: DetectedAgent[]; at: number } | null = null;
const CACHE_MS = 30_000;

export async function fetchAgents(opts: { force?: boolean } = {}): Promise<DetectedAgent[]> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_MS) {
    return cache.agents;
  }
  const url = `${BRIDGE_URL}/agents/list${opts.force ? "?force=1" : ""}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bridge ${res.status}`);
    const body = (await res.json()) as { agents: DetectedAgent[] };
    cache = { agents: body.agents ?? [], at: now };
    return cache.agents;
  } catch (err) {
    console.warn("[agent-registry] fetch failed:", err);
    return cache?.agents ?? [];
  }
}

/**
 * "Point to my CLI" — persist an explicit path to a CLI binary when auto-detect
 * (PATH) can't find it (common under a GUI/desktop launch). The daemon validates
 * the file exists, persists it, applies it live and re-detects. Empty path clears
 * the override. Returns the fresh agent list on success.
 */
export async function setAgentBin(id: string, path: string): Promise<DetectedAgent[]> {
  const res = await fetch(`${BRIDGE_URL}/agents/bins`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, path }),
  });
  const body = (await res.json().catch(() => ({}))) as { agents?: DetectedAgent[]; error?: string };
  if (!res.ok) throw new Error(body.error || `bridge ${res.status}`);
  cache = null; // invalidate so the next fetchAgents re-reads
  return body.agents ?? [];
}

export interface AgentDiagnostics {
  platform: string;
  pathDirs: string[];
  overrides: Record<string, string>;
  agents: Array<DetectedAgent & { resolved?: string | null; source?: string | null }>;
}

/** Read why CLI detection (didn't) work: the PATH the daemon sees + per-agent resolution. */
export async function fetchAgentDiagnostics(): Promise<AgentDiagnostics | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/agents/diagnostics`);
    if (!res.ok) throw new Error(`bridge ${res.status}`);
    return (await res.json()) as AgentDiagnostics;
  } catch (err) {
    console.warn("[agent-registry] diagnostics failed:", err);
    return null;
  }
}

/** Stable label for the active-CLI badge — "Claude Code · 1.0.84". */
export function formatAgent(agent: DetectedAgent | null): string {
  if (!agent) return "no agent";
  if (!agent.available) return `${agent.label} · not installed`;
  return agent.version ? `${agent.label} · ${agent.version}` : agent.label;
}
