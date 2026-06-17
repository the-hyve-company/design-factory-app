// CustomSelect — DF's only dropdown primitive. Native <select> is banned.
//
// Anatomy:
//   - Trigger: skeu-shadowed pill with optional dot indicator + chevron
//     that rotates on open.
//   - Menu: portal-style popover with click-outside dismiss, options
//     show optional dot + value + sub label + check on the active row.
//
// Use anywhere a single value is picked from a finite list. Mirrors the
// reference page in Settings → Components → Dropdowns.

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  /** Optional display label. Defaults to value when omitted. */
  label?: string;
  /** Optional secondary line under the label. */
  sub?: string;
  /** Optional 8px circle drawn before the label. */
  dot?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  /** Trigger width. Defaults to 100% of the parent. */
  width?: number | string;
  /** Optional placeholder when value is empty. */
  placeholder?: string;
  disabled?: boolean;
  title?: string;
}

export function CustomSelect({
  value,
  options,
  onChange,
  width,
  placeholder,
  disabled,
  title,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const cur = options.find((o) => o.value === value);
  const triggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    width: width ?? "100%",
    padding: "7px 11px",
    background: "var(--df-surface-raised)",
    border: "1px solid var(--df-border-subtle)",
    borderRadius: 6,
    fontFamily: "var(--df-font-sans)",
    fontSize: 12,
    color: disabled ? "var(--df-text-faint)" : "var(--df-text-primary)",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: open
      ? "inset 0 1px 2px rgba(0,0,0,0.32), 0 0 0 2px var(--df-border-focus)"
      : "inset 0 1px 0 var(--df-skeu-top-light), 0 1px 2px rgba(0,0,0,0.28)",
    transition: "box-shadow 120ms ease",
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-flex", width: width ?? "100%" }}
    >
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        style={triggerStyle}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {cur?.dot && (
          <span
            style={{ width: 8, height: 8, borderRadius: "50%", background: cur.dot, flex: "none" }}
          />
        )}
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: cur ? "inherit" : "var(--df-text-faint)",
          }}
        >
          {cur ? (cur.label ?? cur.value) : (placeholder ?? value)}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            opacity: 0.6,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms ease",
            flex: "none",
          }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && !disabled && (
        <div role="listbox" style={menuStyle}>
          {options.map((o) => {
            const isOn = o.value === value;
            return (
              <button
                key={o.value}
                role="option"
                aria-selected={isOn}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={optionStyle(isOn)}
                onMouseEnter={(e) => {
                  if (!isOn) e.currentTarget.style.background = "var(--df-interactive-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isOn) e.currentTarget.style.background = "transparent";
                }}
              >
                {o.dot && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: o.dot,
                      flex: "none",
                    }}
                  />
                )}
                <span style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontFamily: "var(--df-font-sans)", fontSize: 13 }}>
                    {o.label ?? o.value}
                  </div>
                  {o.sub && (
                    <div
                      style={{
                        fontFamily: "var(--df-font-mono)",
                        fontSize: 10,
                        color: "var(--df-text-faint)",
                        marginTop: 2,
                      }}
                    >
                      {o.sub}
                    </div>
                  )}
                </span>
                {isOn && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--df-accent-ok, #5faa54)" }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  minWidth: "100%",
  background: "var(--df-surface-elevated)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 8,
  boxShadow: "var(--df-shadow-card)",
  padding: "4px 0",
  zIndex: 1000,
  isolation: "isolate",
  maxHeight: 320,
  overflow: "auto",
};

function optionStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    background: active ? "var(--df-interactive-selected)" : "transparent",
    border: "none",
    color: "var(--df-text-primary)",
    cursor: "pointer",
    textAlign: "left",
  };
}
