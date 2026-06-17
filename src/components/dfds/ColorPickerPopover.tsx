// ColorPickerPopover — DF's color picker. Native <input type="color"> is
// banned (user rule).
//
// Anatomy:
//   - Trigger: skeu-shadowed pill with a swatch + hex code + chevron.
//   - Popover: 8 preset swatches + hex text input + Apply button.
//
// Same primitive used in Settings → Components → Color picker.

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** Override the default 8 swatches. */
  presets?: string[];
  /** Custom trigger width — defaults to auto. */
  width?: number | string;
  /** Optional reset handler — adds a "Reset" button under Apply. */
  onReset?: () => void;
  title?: string;
}

const DEFAULT_PRESETS = [
  "#c7955a",
  "#8ab06b",
  "#7c8aa6",
  "#a87d8e",
  "#9b7a52",
  "#5faa54",
  "#f0a500",
  "#ff6b6b",
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorPickerPopover({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  width,
  onReset,
  title,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const commit = (hex: string) => {
    if (HEX.test(hex)) {
      onChange(hex);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle(open)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: value,
            border: "1px solid var(--df-border-subtle)",
            flex: "none",
          }}
        />
        <span
          style={{ flex: 1, textAlign: "left", fontFamily: "var(--df-font-mono)", fontSize: 11 }}
        >
          {value}
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
      {open && (
        <div style={popoverStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 22px)", gap: 6 }}>
            {presets.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setDraft(c);
                  onChange(c);
                  setOpen(false);
                }}
                title={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: c,
                  border:
                    c === value
                      ? "2px solid var(--df-text-primary)"
                      : "1px solid var(--df-border-subtle)",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(draft);
              }}
              placeholder="#rrggbb"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => commit(draft)}
              disabled={!HEX.test(draft) || draft.toLowerCase() === value.toLowerCase()}
              style={applyBtnStyle(HEX.test(draft) && draft.toLowerCase() !== value.toLowerCase())}
            >
              Apply
            </button>
          </div>
          {onReset && (
            <button
              type="button"
              onClick={() => {
                onReset();
                setOpen(false);
              }}
              style={resetBtnStyle}
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function triggerStyle(open: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 140,
    padding: "5px 10px",
    background: "var(--df-surface-raised)",
    border: "1px solid var(--df-border-subtle)",
    borderRadius: 6,
    color: "var(--df-text-primary)",
    cursor: "pointer",
    boxShadow: open
      ? "inset 0 1px 2px rgba(0,0,0,0.32), 0 0 0 2px var(--df-border-focus)"
      : "inset 0 1px 0 var(--df-skeu-top-light), 0 1px 2px rgba(0,0,0,0.28)",
    transition: "box-shadow 120ms ease",
  };
}

const popoverStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  background: "var(--df-surface-elevated)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 8,
  boxShadow: "var(--df-shadow-card)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  zIndex: 1000,
  isolation: "isolate",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  background: "var(--df-bg-base)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 6,
  color: "var(--df-text-primary)",
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.28)",
};

function applyBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: active ? "var(--df-accent-user, #c7955a)" : "var(--df-surface-raised)",
    border: "1px solid var(--df-border-subtle)",
    borderRadius: 6,
    color: active ? "var(--df-text-inverse, #161613)" : "var(--df-text-faint)",
    fontFamily: "var(--df-font-sans)",
    fontSize: 11,
    fontWeight: 600,
    cursor: active ? "pointer" : "not-allowed",
    boxShadow: active
      ? "inset 0 1px 0 var(--df-skeu-top-light), 0 1px 2px rgba(0,0,0,0.18)"
      : "none",
  };
}

const resetBtnStyle: React.CSSProperties = {
  padding: "6px 0",
  background: "transparent",
  border: 0,
  color: "var(--df-text-muted)",
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  cursor: "pointer",
};
