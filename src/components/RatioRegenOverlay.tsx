/**
 * RatioRegenOverlay — progress overlay anchored over the editor canvas
 * while a regen stream is in flight. Approved-plan §4.3.
 *
 * Stays scoped to the canvas region so the chat panel and topbar remain
 * usable. Shows aggregated tokens count (not raw stream — avoids the
 * flickering anti-pattern called out in §4.3) plus a cancel button.
 */

import { useEffect, useState } from "react";
import type { RatioId } from "@/runtime/hyperframes-invoker";

interface Props {
  visible: boolean;
  targetRatio: RatioId;
  tokensCount: number;
  startedAt: number;
  onCancel: () => void;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RatioRegenOverlay({
  visible,
  targetRatio,
  tokensCount,
  startedAt,
  onCancel,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const elapsed = formatElapsed(now - startedAt);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 18,
        backdropFilter: "blur(2px)",
      }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className="statusbar-dot"
        data-state="streaming"
        style={{ width: 12, height: 12 }}
        aria-hidden="true"
      />
      <div
        style={{
          fontFamily: "var(--df-font-mono)",
          fontSize: "var(--df-text-sm)",
          color: "#fff",
          letterSpacing: "0.04em",
        }}
      >
        Adaptando layout para {targetRatio}…
      </div>
      <div
        style={{
          display: "flex",
          gap: 18,
          fontFamily: "var(--df-font-mono)",
          fontSize: 11,
          color: "rgba(255,255,255,0.65)",
          letterSpacing: "0.04em",
        }}
      >
        <span>{tokensCount.toLocaleString("pt-BR")} tokens gerados</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{elapsed}</span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        style={{
          marginTop: 8,
          padding: "8px 16px",
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.22)",
          color: "#fff",
          fontFamily: "var(--df-font-mono)",
          fontSize: "var(--df-text-xs)",
          borderRadius: "var(--df-r-md)",
          cursor: "pointer",
        }}
      >
        Cancelar
      </button>
    </div>
  );
}
