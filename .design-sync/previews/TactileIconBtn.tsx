import { TactileIconBtn } from "design-factory";

// Icon-only tactile button — recesses on press. Shown as a real toolbar of
// icons on the DS surface (this is why it must carry an icon child, not be
// rendered empty).
function Toolbar({ theme = "dark" }: { theme?: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}
    >
      <TactileIconBtn onClick={() => {}} title="Undo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      </TactileIconBtn>
      <TactileIconBtn onClick={() => {}} title="Redo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
      </TactileIconBtn>
      <TactileIconBtn onClick={() => {}} title="Copy">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </TactileIconBtn>
      <TactileIconBtn onClick={() => {}} title="Delete">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
        </svg>
      </TactileIconBtn>
    </div>
  );
}

export function IconToolbar() {
  return <Toolbar />;
}

export function LightTheme() {
  return <Toolbar theme="light" />;
}
