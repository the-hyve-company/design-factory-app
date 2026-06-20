import { useState } from "react";
import { ColorPickerPopover } from "design-factory";

// Resting trigger states (swatch + hex + chevron). The 8-swatch popover
// opens on click (internal state) — interaction-only, shown closed here.
function Surface({
  theme = "dark",
  children,
}: {
  theme?: "dark" | "light";
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: 280,
        fontFamily: "var(--df-font-sans)",
      }}
    >
      {children}
    </div>
  );
}

export function Default() {
  const [c, setC] = useState("#c7955a");
  return (
    <Surface>
      <ColorPickerPopover value={c} onChange={setC} />
    </Surface>
  );
}

export function WithReset() {
  const [c, setC] = useState("#5faa54");
  return (
    <Surface>
      <ColorPickerPopover value={c} onChange={setC} onReset={() => setC("#c7955a")} />
    </Surface>
  );
}

export function LightTheme() {
  const [c, setC] = useState("#a87d8e");
  return (
    <Surface theme="light">
      <ColorPickerPopover value={c} onChange={setC} />
    </Surface>
  );
}
