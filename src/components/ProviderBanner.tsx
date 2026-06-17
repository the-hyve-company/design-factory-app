// ProviderBanner — zero-state hint + "point to my CLI" escape hatch.
//
// Shows when the bridge is up but no provider is available (no CLI detected,
// no BYOK key). Auto-detection walks PATH, which a GUI/desktop launch often
// can't see fully — so besides "Open Settings", this lets the user point the
// app straight at their CLI binary (persisted via the daemon, used for both
// detection and execution). Auto-dismisses once any provider reports connected.
//
// NOTE: functional/minimal UI (Wave 1). Branding (Geist, DF tokens, logo,
// voice) lands in Wave 2's onboarding redesign.

import { useEffect, useState } from "react";
import { fetchAgents, setAgentBin } from "@/lib/agent-registry";
import { refreshBridgeStatus } from "@/lib/claude-bridge";

interface Props {
  onOpenSettings: (section?: string) => void;
}

const CLI_AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "Opencode CLI" },
  { id: "kimi", label: "Kimi Code CLI" },
];

export function ProviderBanner({ onOpenSettings }: Props) {
  // Three-state: null = still probing (don't flash banner before we know),
  // true = some provider connected, false = zero providers.
  const [hasConnected, setHasConnected] = useState<boolean | null>(null);
  const [bridgeOffline, setBridgeOffline] = useState(false);
  const [showPoint, setShowPoint] = useState(false);
  const [pointId, setPointId] = useState("claude");
  const [pointPath, setPointPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const bridge = await refreshBridgeStatus();
      if (cancelled) return;
      if (!bridge.available) {
        setBridgeOffline(true);
        setHasConnected(false);
        return;
      }
      setBridgeOffline(false);
      const agents = await fetchAgents();
      if (cancelled) return;
      setHasConnected(agents.some((a) => a.available));
    };
    void probe();
    const id = window.setInterval(probe, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const agents = await setAgentBin(pointId, pointPath.trim());
      if (agents.some((a) => a.available)) setHasConnected(true);
      else setErr("Salvo, mas ainda não detectou — confira o caminho.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "falhou");
    } finally {
      setSaving(false);
    }
  }

  // Hide while probing AND once any provider is connected.
  if (hasConnected !== false) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: "12px 16px 0",
        padding: "10px 12px",
        background: "var(--df-surface-raised)",
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-md)",
        fontSize: "var(--df-text-sm)",
        color: "var(--df-text-secondary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--df-accent-warn, #d6a043)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span style={{ flex: 1, minWidth: 0 }}>
          {bridgeOffline
            ? "O motor (daemon) não está respondendo — veja ~/design-factory-daemon.log."
            : "Nenhuma CLI detectada. Aponte o caminho dela ou abra os ajustes."}
        </span>
        <button type="button" onClick={() => setShowPoint((v) => !v)} className="df-btn df-btn--sm">
          Apontar minha CLI
        </button>
        <button
          type="button"
          onClick={() => onOpenSettings("providers")}
          className="df-btn df-btn--sm"
        >
          Abrir Ajustes
        </button>
      </div>

      {showPoint && (
        <div
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}
        >
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} aria-label="CLI">
            {CLI_AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={pointPath}
            onChange={(e) => setPointPath(e.target.value)}
            placeholder="caminho do executável (ex: C:\\Users\\voce\\.local\\bin\\claude.exe)"
            spellCheck={false}
            style={{ flex: 1, minWidth: 240, fontFamily: "var(--df-font-mono, monospace)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pointPath.trim() && !saving) void handleSave();
            }}
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !pointPath.trim()}
            className="df-btn df-btn--sm"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
          {err && (
            <span style={{ width: "100%", color: "var(--df-accent-warn, #d6a043)" }}>{err}</span>
          )}
          <span style={{ width: "100%", fontSize: "var(--df-text-xs, 12px)", opacity: 0.7 }}>
            Dica: no terminal, <code>where claude</code> (Windows) ou <code>which claude</code>{" "}
            (Mac/Linux) mostra o caminho.
          </span>
        </div>
      )}
    </div>
  );
}
