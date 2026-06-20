import { ModalClose } from "design-factory";

// ModalClose is the 26px (X) that sits top-right of a modal header. Shown
// in its real context: a header bar with a title.
function Header({ theme = "dark" }: { theme?: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      style={{ background: "var(--df-bg-base)", padding: 28, width: 360 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "var(--df-surface-elevated)",
          border: "1px solid var(--df-border-subtle)",
          borderRadius: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--df-font-sans)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--df-text-primary)",
          }}
        >
          Project settings
        </span>
        <ModalClose onClick={() => {}} />
      </div>
    </div>
  );
}

export function InHeader() {
  return <Header />;
}

export function LightTheme() {
  return <Header theme="light" />;
}
