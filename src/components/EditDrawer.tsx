import { useEffect, useRef, useState } from "react";
import { CustomSelect, ColorPickerPopover } from "@/components/dfds";

// Global page-level edit controls. Unlike Tweaks (which Claude generates
// per-design with custom CSS vars), these are ALWAYS-ON universal knobs
// that apply to any HTML via high-specificity !important overrides.

export type EditOverrides = {
  bg?: string; // body background
  fg?: string; // body color
  pad?: number; // body padding (px)
  maxW?: number; // main content max-width (px, 0 = none)
  baseFs?: number; // html font-size (px) — affects rem
  font?: string; // font-family stack
  radius?: number; // global border-radius scale (px)
  shadow?: number; // shadow opacity (0-1)
};

export const EDIT_PRESETS: Array<{ id: string; label: string; values: EditOverrides }> = [
  { id: "reset", label: "Reset", values: {} },
  { id: "dark", label: "Dark", values: { bg: "#0b0b0a", fg: "#f5f5f2", baseFs: 16 } },
  { id: "light", label: "Light", values: { bg: "#fafafa", fg: "#1a1a1a", baseFs: 16 } },
  {
    id: "paper",
    label: "Paper",
    values: { bg: "#f4f1ea", fg: "#1a1a17", font: "'Iowan Old Style', Georgia, serif", baseFs: 17 },
  },
  {
    id: "cyber",
    label: "Cyber",
    values: {
      bg: "#050816",
      fg: "#c5ffee",
      font: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      radius: 0,
    },
  },
  {
    id: "pastel",
    label: "Pastel",
    values: { bg: "#fff8f0", fg: "#3a2c1f", radius: 20, shadow: 0.08 },
  },
  {
    id: "mono",
    label: "Mono",
    values: {
      bg: "#fff",
      fg: "#000",
      font: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      radius: 0,
    },
  },
  { id: "roomy", label: "Roomy", values: { pad: 80, maxW: 960, baseFs: 17 } },
  { id: "compact", label: "Compact", values: { pad: 12, baseFs: 14 } },
];

export const FONT_OPTIONS: Array<{ id: string; label: string; stack: string }> = [
  { id: "inherit", label: "Design default", stack: "" },
  {
    id: "system",
    label: "System sans",
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  { id: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace", stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  { id: "display", label: "Display", stack: "'Playfair Display', Georgia, serif" },
  { id: "humanist", label: "Humanist", stack: "'Iowan Old Style', Georgia, serif" },
];

interface EditDrawerProps {
  values: EditOverrides;
  onChange: (next: EditOverrides) => void;
  onClose: () => void;
  onReset: () => void;
}

export function EditDrawer({ values, onChange, onClose, onReset }: EditDrawerProps) {
  const [local, setLocal] = useState<EditOverrides>(values);
  const scheduled = useRef<number | null>(null);

  useEffect(() => {
    setLocal(values);
  }, [values]);

  const update = (patch: Partial<EditOverrides>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    if (scheduled.current) window.cancelAnimationFrame(scheduled.current);
    scheduled.current = window.requestAnimationFrame(() => onChange(next));
  };

  return (
    <div
      className="edit-drawer"
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 300,
        background: "var(--df-surface-elevated)",
        boxShadow: "var(--df-shadow-card), inset 1px 0 0 var(--df-border-subtle)",
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--df-border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--df-font-mono)",
              color: "var(--df-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Edit · global
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close"
          style={{
            padding: "2px 6px",
            color: "var(--df-text-faint)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontFamily: "var(--df-font-mono)",
              color: "var(--df-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Presets
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {EDIT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setLocal(preset.values);
                  onChange(preset.values);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  fontFamily: "var(--df-font-mono)",
                  background: "var(--df-surface-raised)",
                  border: "1px solid var(--df-border-subtle)",
                  borderRadius: "var(--df-r-sm)",
                  color: "var(--df-text-secondary)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--df-interactive-hover)";
                  e.currentTarget.style.color = "var(--df-text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--df-surface-raised)";
                  e.currentTarget.style.color = "var(--df-text-secondary)";
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--df-border-subtle)", margin: "2px 0" }} />

        <Row label="Background" value={local.bg ?? ""}>
          <ColorBinding
            value={local.bg ?? ""}
            onChange={(v) => update({ bg: v || undefined })}
            placeholder="inherit"
          />
        </Row>

        <Row label="Text color" value={local.fg ?? ""}>
          <ColorBinding
            value={local.fg ?? ""}
            onChange={(v) => update({ fg: v || undefined })}
            placeholder="inherit"
          />
        </Row>

        <Row label="Page padding" value={local.pad !== undefined ? `${local.pad}px` : ""}>
          <Slider
            min={0}
            max={120}
            step={2}
            value={local.pad ?? 0}
            onChange={(v) => update({ pad: v })}
          />
        </Row>

        <Row label="Max content width" value={local.maxW ? `${local.maxW}px` : "none"}>
          <Slider
            min={0}
            max={1600}
            step={20}
            value={local.maxW ?? 0}
            onChange={(v) => update({ maxW: v || undefined })}
          />
        </Row>

        <Row label="Base font size" value={local.baseFs ? `${local.baseFs}px` : "16px"}>
          <Slider
            min={10}
            max={22}
            step={1}
            value={local.baseFs ?? 16}
            onChange={(v) => update({ baseFs: v })}
          />
        </Row>

        <Row label="Font family" value="">
          <CustomSelect
            value={local.font ?? "inherit"}
            onChange={(v) => update({ font: v === "inherit" ? undefined : v })}
            options={FONT_OPTIONS.map((f) => ({ value: f.stack || "inherit", label: f.label }))}
          />
        </Row>

        <Row label="Border radius" value={local.radius !== undefined ? `${local.radius}px` : ""}>
          <Slider
            min={0}
            max={32}
            step={1}
            value={local.radius ?? 0}
            onChange={(v) => update({ radius: v })}
          />
        </Row>

        <Row label="Shadow" value={local.shadow !== undefined ? local.shadow.toFixed(2) : ""}>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={local.shadow ?? 0}
            onChange={(v) => update({ shadow: v })}
          />
        </Row>
      </div>

      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--df-border-subtle)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button
          onClick={onReset}
          style={{
            fontSize: 11,
            fontFamily: "var(--df-font-mono)",
            color: "var(--df-text-faint)",
            padding: "4px 10px",
            background: "transparent",
            border: "1px solid var(--df-border-subtle)",
            borderRadius: "var(--df-r-sm)",
            cursor: "pointer",
          }}
        >
          Reset all
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "var(--df-text-secondary)" }}>{label}</span>
        {value && (
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: "var(--df-text-faint)",
            }}
          >
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%", accentColor: "var(--df-text-primary)", height: 18 }}
    />
  );
}

function ColorBinding({
  value,
  onChange,
  placeholder: _placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const safeValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <ColorPickerPopover
        value={safeValue}
        onChange={onChange}
        onReset={value ? () => onChange("") : undefined}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          title="Clear"
          style={{
            color: "var(--df-text-faint)",
            fontSize: 11,
            padding: "0 4px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Build the override <style> block injected into the iframe.
export function buildEditCss(v: EditOverrides): string {
  const parts: string[] = [];
  if (v.bg) parts.push(`html, body { background: ${v.bg} !important; }`);
  if (v.fg) parts.push(`body { color: ${v.fg} !important; }`);
  if (v.pad !== undefined) parts.push(`body { padding: ${v.pad}px !important; }`);
  if (v.maxW) {
    parts.push(
      `body > * { max-width: ${v.maxW}px; margin-left: auto !important; margin-right: auto !important; }`,
    );
  }
  if (v.baseFs) parts.push(`html { font-size: ${v.baseFs}px !important; }`);
  if (v.font)
    parts.push(
      `html, body, button, input, textarea, select { font-family: ${v.font} !important; }`,
    );
  if (v.radius !== undefined) {
    parts.push(`:root { --df-edit-radius: ${v.radius}px; }`);
    parts.push(
      `button, input, textarea, select, img, video, .card, [class*="card"], [class*="btn"] { border-radius: ${v.radius}px !important; }`,
    );
  }
  if (v.shadow !== undefined) {
    const op = v.shadow.toFixed(2);
    parts.push(
      `[class*="card"], [class*="shadow"], .card { box-shadow: 0 8px 24px rgba(0,0,0,${op}) !important; }`,
    );
  }
  return parts.join("\n");
}
