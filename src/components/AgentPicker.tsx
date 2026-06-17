// AgentPicker — header dropdown showing which CLI agent is active and which
// alternatives are installed. Picking flips the global `default_provider`
// setting (via writeGlobalConfig) AND fires a `df:provider-change` event
// so the EditorScreen's chat-dispatch picks up the change live without a
// reload. API BYOK entries are included as virtual non-CLI rows.
//
// expanded from 7 → 13 providers to close the
// feature parity gap. The picker fetches /providers from the daemon
// and uses `available` to grey-out un-installed CLIs / un-tokened APIs.
// CLI detection still flows through /agents/list (cached 30s) so the
// version string is preserved.

import { useEffect, useRef, useState } from "react";
import { fetchAgents, type AgentId, type DetectedAgent } from "@/lib/agent-registry";
import { db, writeGlobalConfig, readGlobalConfig, BRIDGE_URL } from "@/lib/claude-bridge";

const STORAGE_KEY = "df_active_agent";

// Picker option ids: union of AgentId (CLI detection ids) plus the
// virtual API/local entries. V1 beta roster mirrors
// `apps/daemon/src/providers/index.mjs` PROVIDERS map.
type PickerId =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "kimi"
  | "anthropic"
  | "openai"
  | "gemini-api"
  | "openrouter"
  | "ollama";

const SUPPORTED_NOW: ReadonlySet<PickerId> = new Set<PickerId>([
  "claude",
  "codex",
  "gemini",
  "opencode",
  "kimi",
  "anthropic",
  "openai",
  "gemini-api",
  "openrouter",
  "ollama",
]);

type SupportedProviderId = PickerId;

// Map picker id → ProviderId saved in default_provider config.
// makes this an identity for every supported entry (parity reached).
function pickerToProvider(id: PickerId): SupportedProviderId | null {
  return SUPPORTED_NOW.has(id) ? id : null;
}

// Map AgentId (binary detection id) → PickerId (canonical provider id).
function agentToPicker(id: AgentId): PickerId {
  return id as PickerId;
}

interface Props {
  /** Optional callback fired when the user picks a different agent. */
  onChange?: (id: PickerId) => void;
}

const VALID_STORED_IDS = new Set<string>([
  "claude",
  "codex",
  "gemini",
  "opencode",
  "kimi",
  "anthropic",
  "openai",
  "gemini-api",
  "openrouter",
  "ollama",
]);

interface ProviderDescriptor {
  id: PickerId;
  label: string;
  available: boolean;
  version?: string | null;
}

function loadActive(): PickerId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_STORED_IDS.has(raw)) {
      return raw as PickerId;
    }
  } catch {}
  return "claude";
}

// Fetch /providers from the daemon. Returns descriptor list keyed by
// canonical PickerId. Falls back to an empty list on network failure
// — the picker degrades to detection-only data from /agents/list.
async function fetchProviders(): Promise<ProviderDescriptor[]> {
  try {
    const r = await fetch(`${BRIDGE_URL}/providers`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const body = (await r.json()) as {
      providers?: Array<{
        id: string;
        label: string;
        available?: boolean;
        version?: string | null;
      }>;
    };
    if (!Array.isArray(body.providers)) return [];
    return body.providers
      .filter((p) => SUPPORTED_NOW.has(p.id as PickerId))
      .map((p) => ({
        id: p.id as PickerId,
        label: p.label,
        available: p.available ?? false,
        version: p.version ?? null,
      }));
  } catch {
    return [];
  }
}

export function AgentPicker({ onChange }: Props) {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [active, setActive] = useState<PickerId>(loadActive());
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchAgents().then(setAgents);
    void fetchProviders().then(setProviders);
    // Hydrate active from saved global default_provider so picker matches
    // whatever EditorScreen will actually use on next chat send.
    void readGlobalConfig().then((cfg) => {
      const p = cfg?.default_provider as PickerId | undefined;
      if (p && SUPPORTED_NOW.has(p)) {
        setActive(p);
      }
    });
  }, []);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Synthesize the visible list. Source of truth is /providers (when
  // available) — gives us availability + canonical labels for all 13
  // entries. /agents/list still feeds version strings for installed
  // CLIs (the daemon /providers endpoint includes version too, but the
  // legacy fetchAgents() path stays as a fallback when /providers is
  // unreachable, e.g. older daemon).
  // User direction 2026-05-15: dropdown sublabel = provider type
  // only (CLI / API / local). No vendor-specific tags ("Moonshot",
  // "200+ models", etc) — keep the surface clean.
  const sublabelById: Partial<Record<PickerId, string>> = {
    claude: "CLI",
    codex: "CLI",
    gemini: "CLI",
    opencode: "CLI",
    kimi: "CLI",
    anthropic: "API",
    openai: "API",
    "gemini-api": "API",
    openrouter: "API",
    ollama: "local",
  };

  // Fallback derivation when /providers fetch failed (empty list):
  // synthesize from /agents/list + token state. This preserves picker
  // function on older daemons.
  const fallbackEntries: ProviderDescriptor[] = [
    ...agents
      .map((a) => ({
        id: agentToPicker(a.id),
        label: a.label,
        available: a.available,
        version: a.version ?? null,
      }))
      .filter((e) => SUPPORTED_NOW.has(e.id)),
    { id: "openrouter", label: "OpenRouter", available: true, version: null },
    { id: "ollama", label: "Ollama", available: true, version: null },
  ];

  const sourceList = providers.length > 0 ? providers : fallbackEntries;

  const visibleEntries: Array<ProviderDescriptor & { sublabel?: string }> = sourceList.map((p) => ({
    ...p,
    sublabel: sublabelById[p.id],
  }));

  const activeEntry = visibleEntries.find((e) => e.id === active) ?? null;
  const activeAgent = agents.find((a) => agentToPicker(a.id) === active) ?? null;
  const isApiOrLocal = active === "ollama" || active === "openrouter";
  const label = isApiOrLocal
    ? (activeEntry?.label ?? active)
    : activeAgent
      ? activeAgent.available
        ? activeAgent.label
        : `${activeAgent.label} · not installed`
      : (activeEntry?.label ?? "Claude Code");

  const pick = (id: PickerId) => {
    if (!SUPPORTED_NOW.has(id)) return;
    setActive(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    const providerId = pickerToProvider(id);
    if (providerId) {
      void writeGlobalConfig({ default_provider: providerId }).catch(() => {});
      void db.setSetting("default_provider", providerId).catch(() => {});
      // Notify EditorScreen + any other listener that the active provider
      // flipped. Detail carries the ProviderId so the listener doesn't
      // need to re-read global config.
      window.dispatchEvent(new CustomEvent("df:provider-change", { detail: { providerId } }));
    }
    onChange?.(id);
    setOpen(false);
  };

  const rescan = async () => {
    setRefreshing(true);
    const [nextAgents, nextProviders] = await Promise.all([
      fetchAgents({ force: true }),
      fetchProviders(),
    ]);
    setAgents(nextAgents);
    setProviders(nextProviders);
    setRefreshing(false);
  };

  return (
    <div ref={rootRef} className="agent-picker-root" style={rootStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="agent-picker-trigger"
        style={triggerStyle}
        title="Switch CLI agent"
      >
        <span style={dotStyle(activeEntry?.available ?? true)} />
        <span style={triggerLabelStyle}>{label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div role="listbox" style={menuStyle}>
          {[
            { title: "CLIs", ids: ["claude", "codex", "gemini", "opencode", "kimi"] as const },
            { title: "APIs", ids: ["anthropic", "openai", "gemini-api", "openrouter"] as const },
            { title: "Local", ids: ["ollama"] as const },
          ].map((group) => {
            // User direction 2026-05-15: dropdown shows ONLY
            // connected/available entries. Greyed-out "not installed"
            // and "needs auth" rows are hidden — users discover them in
            // Settings → Providers, which keeps the full roster.
            const items = visibleEntries.filter(
              (e) => (group.ids as readonly string[]).includes(e.id) && e.available,
            );
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                <div style={menuHeaderStyle}>{group.title}</div>
                {items.map((entry) => {
                  const supported = SUPPORTED_NOW.has(entry.id);
                  const isActive = entry.id === active;
                  const disabled = !entry.available || !supported;
                  const isVirtual = entry.id === "openrouter" || entry.id === "ollama";
                  const meta = isVirtual
                    ? (entry.sublabel ?? "")
                    : !entry.available
                      ? "not installed"
                      : (entry.sublabel ?? "");
                  const titleText =
                    entry.id === "ollama"
                      ? "Local Ollama server (open weights)"
                      : entry.id === "openrouter"
                        ? "OpenRouter — 200+ models, BYOK"
                        : !entry.available
                          ? `${entry.label} not found on PATH — install to enable`
                          : undefined;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => pick(entry.id)}
                      disabled={disabled}
                      style={itemStyle(isActive, disabled)}
                      title={titleText}
                    >
                      <span style={dotStyle(entry.available)} />
                      <span style={itemLabelStyle}>{entry.label}</span>
                      <span style={itemMetaStyle}>{meta}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <button
            type="button"
            onClick={rescan}
            disabled={refreshing}
            style={{
              ...rescanStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Reescanear PATH"
            aria-label="Reescanear PATH"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={refreshing ? { animation: "df-spin 0.8s linear infinite" } : undefined}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  // Sibling topbar gradient/scrim layers were stacking over the dropdown.
  // Pinning the picker root above them removes the cut.
  zIndex: 1100,
};

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 var(--df-sp-3)",
  height: "100%",
  background: "transparent",
  border: "none",
  borderLeft: "1px solid var(--df-border-subtle)",
  borderRight: "1px solid var(--df-border-subtle)",
  fontFamily: "var(--df-font-mono)",
  fontSize: "var(--df-text-xs)",
  color: "var(--df-text-secondary)",
  cursor: "pointer",
};

// width stability: fixed minWidth=maxWidth so longer/shorter
// provider labels share the same slot. This keeps the right cluster's
// overall footprint constant across provider switches, which keeps the
// feed-aligned tabs from shifting laterally. "tabs
// alinhadas ao feed + estaveis ao mudar provider". Reduced to 120 in
// to leave more room for tabs in the feed container.
const triggerLabelStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 100,
  maxWidth: 100,
  display: "inline-block",
};

function dotStyle(available: boolean): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flex: "none",
    background: available
      ? "var(--df-accent-user, var(--df-accent-ok, #5faa54))"
      : "var(--df-text-faint, #888)",
    // Skeu LED — same family as cnp-trigger-dot in the NP modal.
    // ON: flat accent + soft halo + tiny specular.
    // OFF: recessed bowl shadow inside the dot.
    boxShadow: available
      ? "0 0 4px 0 color-mix(in srgb, var(--df-accent-user, var(--df-accent-ok)) 55%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.3)"
      : "inset 0 1px 1px rgba(0, 0, 0, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.04)",
  };
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  minWidth: 280,
  background: "var(--df-surface-elevated)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: "var(--df-r-md, 8px)",
  boxShadow: "var(--df-shadow-card, 0 12px 32px rgba(0,0,0,0.32))",
  padding: "4px 0",
  // 1000+ to clear any topbar gradient overlay or sibling menu (export menu
  // uses 100, export overlay 200). 1100 puts us above all of them.
  zIndex: 1100,
  isolation: "isolate",
};

const menuHeaderStyle: React.CSSProperties = {
  padding: "8px 12px 6px",
  fontSize: 10,
  fontFamily: "var(--df-font-mono)",
  color: "var(--df-text-faint)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

function itemStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    background: active ? "var(--df-interactive-hover, rgba(255,255,255,0.04))" : "transparent",
    border: "none",
    color: disabled ? "var(--df-text-faint)" : "var(--df-text-primary)",
    fontFamily: "var(--df-font-mono)",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    textAlign: "left",
  };
}

const itemLabelStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const itemMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--df-text-faint)",
  flex: "none",
};

const rescanStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  marginTop: 4,
  borderTop: "1px solid var(--df-border-subtle)",
  background: "transparent",
  color: "var(--df-text-secondary)",
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  textAlign: "center",
  cursor: "pointer",
  border: "none",
};
