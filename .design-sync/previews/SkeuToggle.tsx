import { useState } from "react";
import { SkeuToggle } from "design-factory";

// A framed DS surface so the toggle reads on the real background, with a
// visible row label (the component itself renders only the switch; the
// `label` prop is for assistive tech).
function Row({
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
        padding: "28px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        fontFamily: "var(--df-font-sans)",
        color: "var(--df-text-primary)",
        minWidth: 280,
      }}
    >
      {children}
    </div>
  );
}

function Setting({
  label,
  defaultOn,
  disabled,
}: {
  label: string;
  defaultOn: boolean;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        fontSize: 13,
        color: disabled ? "var(--df-text-faint)" : "var(--df-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span>{label}</span>
      <SkeuToggle on={on} onChange={setOn} label={label} disabled={disabled} />
    </label>
  );
}

export function OnAndOff() {
  return (
    <Row>
      <Setting label="Auto-save snapshots" defaultOn={true} />
      <Setting label="Stream tokens live" defaultOn={false} />
    </Row>
  );
}

export function Disabled() {
  return (
    <Row>
      <Setting label="Enterprise SSO (locked)" defaultOn={true} disabled />
      <Setting label="Telemetry (locked)" defaultOn={false} disabled />
    </Row>
  );
}

export function LightTheme() {
  return (
    <Row theme="light">
      <Setting label="Auto-save snapshots" defaultOn={true} />
      <Setting label="Stream tokens live" defaultOn={false} />
    </Row>
  );
}
