import { useState } from "react";
import { CustomSelect } from "design-factory";

// The popover opens on click (internal state) so a static card shows the
// trigger pill in its resting states — value, dotted options, placeholder,
// disabled. The open menu is interaction-only (skipped).
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
        width: 320,
        fontFamily: "var(--df-font-sans)",
      }}
    >
      {children}
    </div>
  );
}

const RATIOS = [
  { value: "16:9", label: "16 : 9", sub: "1920 × 1080" },
  { value: "9:16", label: "9 : 16", sub: "1080 × 1920" },
  { value: "1:1", label: "1 : 1", sub: "1080 × 1080" },
];

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic", dot: "#c7955a" },
  { value: "openai", label: "OpenAI", dot: "#5faa54" },
  { value: "google", label: "Google", dot: "#7c8aa6" },
];

export function WithValue() {
  const [v, setV] = useState("16:9");
  return (
    <Surface>
      <CustomSelect value={v} options={RATIOS} onChange={setV} />
    </Surface>
  );
}

export function WithDots() {
  const [v, setV] = useState("anthropic");
  return (
    <Surface>
      <CustomSelect value={v} options={PROVIDERS} onChange={setV} />
    </Surface>
  );
}

export function PlaceholderAndDisabled() {
  return (
    <Surface>
      <CustomSelect value="" options={RATIOS} onChange={() => {}} placeholder="Choose a ratio…" />
      <CustomSelect value="16:9" options={RATIOS} onChange={() => {}} disabled />
    </Surface>
  );
}

export function LightTheme() {
  const [v, setV] = useState("anthropic");
  return (
    <Surface theme="light">
      <CustomSelect value={v} options={PROVIDERS} onChange={setV} />
    </Surface>
  );
}
