import { PreviewSandboxBadge } from "design-factory";

// Sandbox-posture pill that overlays the preview iframe (absolute top-right).
// Shown on a faux preview frame: strict (green) and permissive (warn tone).
function Frame({
  theme = "dark",
  sandbox,
  warn,
}: {
  theme?: "dark" | "light";
  sandbox: string;
  warn?: boolean;
}) {
  return (
    <div data-theme={theme} style={{ background: "var(--df-bg-base)", padding: 28 }}>
      <div
        style={{
          position: "relative",
          width: 320,
          height: 180,
          borderRadius: 10,
          border: "1px solid var(--df-border-subtle)",
          background: "var(--df-bg-section)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <span style={{ fontFamily: "var(--df-font-mono)", fontSize: 11, color: "var(--df-text-faint)" }}>
          preview
        </span>
        <PreviewSandboxBadge sandbox={sandbox} warnIfPermissive={warn} />
      </div>
    </div>
  );
}

export function Strict() {
  return <Frame sandbox="allow-scripts" />;
}

export function Permissive() {
  return <Frame sandbox="allow-scripts allow-same-origin" warn />;
}

export function LightTheme() {
  return <Frame theme="light" sandbox="allow-scripts" />;
}
