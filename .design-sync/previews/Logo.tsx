import { Logo } from "design-factory";

// The DesignFactory 8× lattice mark. fill=currentColor, so it inherits the
// text color — shown at a range of sizes and on both themes.
function Stage({
  theme = "dark",
  color,
}: {
  theme?: "dark" | "light";
  color?: string;
}) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 36,
        display: "flex",
        gap: 28,
        alignItems: "center",
        color: color ?? "var(--df-text-primary)",
      }}
    >
      <Logo size={64} />
      <Logo size={40} />
      <Logo size={24} />
    </div>
  );
}

export function Sizes() {
  return <Stage />;
}

export function Accent() {
  return <Stage color="var(--df-accent-user, #c7955a)" />;
}

export function LightTheme() {
  return <Stage theme="light" />;
}
