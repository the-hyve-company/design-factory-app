import { useState } from "react";
import { PickerKey } from "design-factory";

// Unified picker trigger key (Canvas / Format / Rules). One skeu bezel, one
// accent-dot LED — empty when idle, filled with --df-accent when configured.
function Row({ theme = "dark" }: { theme?: "dark" | "light" }) {
  const [a, setA] = useState(true);
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: 300,
      }}
    >
      <PickerKey label="16 : 9 · 1080p" active={a} onClick={() => setA((v) => !v)} />
      <PickerKey label="Choose a format…" active={false} onClick={() => {}} />
      <PickerKey label="Locked" active onClick={() => {}} disabled />
    </div>
  );
}

export function ActiveAndIdle() {
  return <Row />;
}

export function LightTheme() {
  return <Row theme="light" />;
}
