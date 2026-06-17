import { useState, type ReactNode, type CSSProperties } from "react";

// Skeumorphic tactile primitives used across the app's chrome (file manager
// toolbar, terminal header, etc.). Hover lifts the shadow stack; press inverts
// it so the button looks recessed. Disabled flattens the surface and dims it.
//
// Design tokens canonical: src/styles/tokens.css
//   --df-bg-button-tactile / --df-bg-button-tactile-hover
//   --df-shadow-button-tactile / -hover / -pressed
//   --df-skeu-recess (icon-only pressed state)

interface TactileBtnProps {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
}

export function TactileBtn({ onClick, children, disabled = false, title, style }: TactileBtnProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => {
        setPressed(false);
        setHover(false);
      }}
      onMouseEnter={() => setHover(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: disabled ? "var(--df-bg-section)" : "var(--df-bg-button-tactile)",
        border: "none",
        borderRadius: "var(--df-r-sm)",
        // text-on-tactile (not text-primary) because the button bg is always
        // dark in both themes — text-primary flips dark in light theme and
        // breaks contrast. text-on-tactile is locked warm-light always.
        color: disabled ? "var(--df-text-faint)" : "var(--df-text-on-tactile)",
        fontFamily: "var(--df-font-display)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "var(--df-tracking-tight)",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled
          ? "inset 0 0 0 1px var(--df-border-subtle)"
          : pressed
            ? "var(--df-shadow-button-tactile-pressed)"
            : hover
              ? "var(--df-shadow-button-tactile-hover)"
              : "var(--df-shadow-button-tactile)",
        transition: "box-shadow var(--df-motion-quick) var(--df-ease-out)",
        userSelect: "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface TactileIconBtnProps {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  size?: number;
}

export function TactileIconBtn({ onClick, children, title, size = 24 }: TactileIconBtnProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => {
        setPressed(false);
        setHover(false);
      }}
      onMouseEnter={() => setHover(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        background: "transparent",
        border: "none",
        borderRadius: "var(--df-r-sm)",
        color: hover ? "var(--df-text-primary)" : "var(--df-text-muted)",
        cursor: "pointer",
        boxShadow: pressed
          ? "var(--df-skeu-recess)"
          : hover
            ? "inset 0 0 0 1px var(--df-border-hover)"
            : "none",
        transition:
          "box-shadow var(--df-motion-quick) var(--df-ease-out), color var(--df-motion-quick) var(--df-ease-out)",
      }}
    >
      {children}
    </button>
  );
}
