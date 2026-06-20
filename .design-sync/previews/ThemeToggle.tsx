import { useState } from "react";
import { ThemeToggle } from "design-factory";

// Icon-only theme switch that drops into a topbar. Sun when dark (→ light),
// moon when light (→ dark). The surrounding strip mimics the app topbar so
// the ghost-icon button blends as intended.
function Topbar({ start }: { start: "dark" | "light" }) {
  const [theme, setTheme] = useState<"dark" | "light">(start);
  return (
    <div data-theme={theme} style={{ background: "var(--df-bg-base)", padding: 24, width: 320 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "var(--df-bg-section)",
          border: "1px solid var(--df-border-subtle)",
          borderRadius: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--df-font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--df-text-muted)",
          }}
        >
          {theme} theme
        </span>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </div>
    </div>
  );
}

export function DarkActive() {
  return <Topbar start="dark" />;
}

export function LightActive() {
  return <Topbar start="light" />;
}
