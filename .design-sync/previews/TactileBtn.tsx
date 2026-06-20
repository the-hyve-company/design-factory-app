import { TactileBtn } from "design-factory";

// Skeumorphic pressed-key button used across the app chrome. Text, text +
// icon, and disabled — on the DS surface in both themes.
function Bar({
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
        gap: 12,
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}

const PlusIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function Default() {
  return (
    <Bar>
      <TactileBtn onClick={() => {}}>Run</TactileBtn>
      <TactileBtn onClick={() => {}}>{PlusIcon}New file</TactileBtn>
      <TactileBtn onClick={() => {}} disabled>
        Disabled
      </TactileBtn>
    </Bar>
  );
}

export function LightTheme() {
  return (
    <Bar theme="light">
      <TactileBtn onClick={() => {}}>Run</TactileBtn>
      <TactileBtn onClick={() => {}}>{PlusIcon}New file</TactileBtn>
    </Bar>
  );
}
