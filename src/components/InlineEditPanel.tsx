import { useEffect, useRef, useState } from "react";
import type { InlineEditSelectPayload, InlineEditStyles } from "@/runtime/inline-edit-bridge";

// InlineEditPanel — floating mini-toolbar anchored to the currently
// selected element in the iframe. Position is computed from the iframe
// rect + the in-iframe selection rect; we swing the panel to the
// opposite side of the element when it would overflow the viewport.
//
// History:
//   2026-05-11 — first ship: floating panel with Typography + Box.
//   2026-05-19 — converted to a fixed-right collapsible drawer
//                (Sprint A / Task #49). User rejected: lost spatial
//                anchoring, drawer felt heavy, fields were not
//                contextual to the element type.
//   2026-05-20 — revert to floating + keep #156's surface (T/R/B/L
//                expand, any-element selection, 2-click contentEditable
//                lives in the bridge) AND add element-type contextual
//                rendering (3 buckets: text / image / container).
//
// The panel is driven entirely by props from EditorScreen — it doesn't
// own the postMessage bridge or the selected element. Each input change
// fires `onApplyStyle` / `onApplyText` which the parent forwards to the
// iframe. Save/Cancel are also parent's responsibility — the panel only
// renders the affordance.

interface InlineEditPanelProps {
  /** The selection payload last received from the iframe. null when no
   *  element is selected (panel hidden). */
  selection: InlineEditSelectPayload | null;
  /** Bounding rect of the iframe in the viewport — needed to translate
   *  the iframe-local rect in `selection` into screen coordinates.
   *  null = iframe not yet measured; panel hides until measurement
   *  lands (a single rAF after mount). */
  iframeRect: DOMRect | null;
  /** Forward an inline-style patch to the iframe. The bridge IIFE
   *  applies it via `el.style.setProperty(prop, val, 'important')`. */
  onApplyStyle: (path: string, styles: InlineEditStyles) => void;
  /** Forward a text update to the iframe. The bridge IIFE replaces the
   *  element's direct text nodes (descendants survive). */
  onApplyText: (path: string, text: string) => void;
  /** Commit the current state of the iframe HTML to disk. The parent
   *  handles the get-html round-trip + writeFile + clear-selection
   *  bookkeeping. */
  onSave: () => void;
  /** Discard unsaved changes — parent reloads the iframe from disk. */
  onCancel: () => void;
  /** Whether at least one apply has happened since open / last save.
   *  Drives the Save button's enabled state. */
  dirty: boolean;
  /** Whether a save round-trip is in flight. Disables both buttons. */
  saving?: boolean;
}

/** Curated font stacks — keeps the dropdown shallow. "Inherit" leaves
 *  the cascade alone. Other entries are common web fonts that ship in
 *  almost every design we generate. */
const FONT_OPTIONS = [
  { label: "Inherit", value: "" },
  { label: "Geist", value: "'Geist', system-ui, sans-serif" },
  { label: "Geist Mono", value: "'Geist Mono', ui-monospace, monospace" },
  {
    label: "System sans",
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Humanist", value: "'Iowan Old Style', Georgia, serif" },
  { label: "Mono", value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

const WEIGHT_OPTIONS = [
  { label: "100 · Thin", value: "100" },
  { label: "200 · ExtraLight", value: "200" },
  { label: "300 · Light", value: "300" },
  { label: "400 · Regular", value: "400" },
  { label: "500 · Medium", value: "500" },
  { label: "600 · SemiBold", value: "600" },
  { label: "700 · Bold", value: "700" },
  { label: "800 · ExtraBold", value: "800" },
  { label: "900 · Black", value: "900" },
];

const ALIGN_OPTIONS = [
  { label: "Inherit", value: "" },
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
  { label: "Justify", value: "justify" },
];

const BORDER_STYLE_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Solid", value: "solid" },
  { label: "Dashed", value: "dashed" },
  { label: "Dotted", value: "dotted" },
];

export const PANEL_WIDTH = 290;
const PANEL_GAP = 12;
/** Approximate panel height used only for initial off-screen clamp —
 *  the real height settles after render. Tall enough to cover the
 *  worst case (text bucket with all sections expanded). */
const PANEL_APPROX_HEIGHT = 520;

// ────────────────────────────────────────────────────────────────────
// Element-type bucketing (Sprint B)
//
// The panel renders contextual fields based on the element type so the
// user doesn't see Typography on an <img> or Width/Height on a
// <span>. Three buckets cover the practical surface; everything we
// don't recognise as text or image falls into "container".
// ────────────────────────────────────────────────────────────────────

export type ElementBucket = "text" | "image" | "container";

const TEXT_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "a",
  "button",
  "label",
  "li",
  "strong",
  "em",
  "small",
  "blockquote",
]);

const IMAGE_TAGS = new Set(["img", "video", "picture", "svg"]);

/** Decide which bucket renders for the given tag. Empty / unknown tags
 *  default to "container" — that keeps Box/Size visible for any custom
 *  element the user selects (we'd rather over-render Box on an
 *  unknown text-ish tag than hide everything). */
export function getBucket(tagName: string): ElementBucket {
  const t = (tagName || "").toLowerCase();
  if (TEXT_TAGS.has(t)) return "text";
  if (IMAGE_TAGS.has(t)) return "image";
  return "container";
}

/** Extract the tag name from a structural path like "body[1] > div[2] >
 *  h1[1]" (or any subset). Falls back to "" when the path is malformed,
 *  which routes to the "container" bucket. */
export function extractTagFromPath(path: string): string {
  if (!path) return "";
  const last = path.split(">").pop();
  if (!last) return "";
  // Strip optional [nth-of-type] suffix.
  const m = last.trim().match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  return m ? m[1].toLowerCase() : "";
}

export function InlineEditPanel({
  selection,
  iframeRect,
  onApplyStyle,
  onApplyText,
  onSave,
  onCancel,
  dirty,
  saving = false,
}: InlineEditPanelProps) {
  // ── form state (hydrated from selection) ────────────────────────────
  const [text, setText] = useState("");
  // Typography
  const [fontFamily, setFontFamily] = useState("");
  const [fontWeight, setFontWeight] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [color, setColor] = useState("");
  const [textAlign, setTextAlign] = useState("");
  const [lineHeight, setLineHeight] = useState("");
  const [letterSpacing, setLetterSpacing] = useState("");
  // Size
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  // Box
  const [opacity, setOpacity] = useState("");
  const [padding, setPadding] = useState("");
  const [margin, setMargin] = useState("");
  const [borderWidth, setBorderWidth] = useState("");
  const [borderStyle, setBorderStyle] = useState("");
  const [borderColor, setBorderColor] = useState("");
  const [borderRadius, setBorderRadius] = useState("");

  // Apply rAF-throttling so dragging the size number doesn't fire 60
  // postMessages per second.
  const scheduled = useRef<number | null>(null);

  // Hydrate from selection. Computed values come back as strings already;
  // we keep them in state for two-way binding, only emitting on user-input.
  useEffect(() => {
    if (!selection) return;
    const s = selection.styles;
    setText(selection.text);
    setFontFamily(s.fontFamily ?? "");
    setFontWeight(s.fontWeight ?? "");
    setFontSize(s.fontSize ?? "");
    setColor(rgbToHex(s.color) ?? "");
    setTextAlign(s.textAlign ?? "");
    setLineHeight(s.lineHeight ?? "");
    setLetterSpacing(s.letterSpacing ?? "");
    setWidth(s.width ?? "");
    setHeight(s.height ?? "");
    setOpacity(opacityToPercent(s.opacity ?? ""));
    setPadding(s.padding ?? "");
    setMargin(s.margin ?? "");
    setBorderWidth(s.borderWidth ?? "");
    setBorderStyle(s.borderStyle ?? "");
    setBorderColor(rgbToHex(s.borderColor ?? "") ?? "");
    setBorderRadius(s.borderRadius ?? "");
  }, [selection]);

  if (!selection || !iframeRect) return null;

  const emitStyle = (patch: InlineEditStyles) => {
    if (scheduled.current) window.cancelAnimationFrame(scheduled.current);
    scheduled.current = window.requestAnimationFrame(() => {
      onApplyStyle(selection.path, patch);
    });
  };

  // ── Position the panel ─────────────────────────────────────────────
  // Translate the iframe-local rect into viewport coordinates. The
  // bridge already accounts for in-iframe scroll, so we just add the
  // iframe's own left/top.
  const elLeft = iframeRect.left + selection.rect.x;
  const elTop = iframeRect.top + selection.rect.y;
  const elWidth = selection.rect.width;
  // Prefer placing the panel to the right of the element; swing left
  // when it would overflow.
  let panelLeft = elLeft + elWidth + PANEL_GAP;
  if (panelLeft + PANEL_WIDTH > window.innerWidth) {
    panelLeft = Math.max(8, elLeft - PANEL_WIDTH - PANEL_GAP);
  }
  let panelTop = elTop;
  if (panelTop + PANEL_APPROX_HEIGHT > window.innerHeight) {
    panelTop = Math.max(8, window.innerHeight - PANEL_APPROX_HEIGHT - 8);
  }

  // ── Bucket ─────────────────────────────────────────────────────────
  const tagName = extractTagFromPath(selection.path);
  const bucket = getBucket(tagName);

  return (
    <div
      style={{
        position: "fixed",
        left: panelLeft,
        top: panelTop,
        width: PANEL_WIDTH,
        maxHeight: `calc(100vh - 16px)`,
        background: "var(--df-surface-elevated)",
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-xl, 12px)",
        boxShadow: "var(--df-skeu-shadow-xl, 0 12px 32px rgba(0,0,0,0.3))",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--df-font-mono)",
        fontSize: 12,
        color: "var(--df-text-primary)",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
      data-testid="inline-edit-panel"
      data-bucket={bucket}
      data-tag={tagName || "unknown"}
    >
      {/* ── Header ────────────────────────────────────────────────── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--df-border-subtle)",
          minHeight: 36,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--df-text-faint)",
            }}
          >
            Inline edit ·{" "}
            <span style={{ color: "var(--df-text-muted, var(--df-text-faint))" }}>
              {tagName || "?"}
            </span>
          </span>
          <span style={{ fontSize: 9, color: "var(--df-text-faint)", letterSpacing: 0.3 }}>
            {bucket}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            color: dirty ? "var(--df-accent-user, #ef5d3b)" : "var(--df-text-faint)",
          }}
        >
          {dirty ? "● unsaved" : "● synced"}
        </span>
      </header>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {bucket === "text" && (
          <Field label="Text">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                onApplyText(selection.path, e.target.value);
              }}
              rows={2}
              style={{ ...inputStyle, resize: "vertical", minHeight: 44 }}
            />
          </Field>
        )}

        {bucket === "text" && (
          <Section label="Typography">
            <Field label="Font">
              <select
                value={matchFontValue(fontFamily)}
                onChange={(e) => {
                  setFontFamily(e.target.value);
                  emitStyle({ fontFamily: e.target.value });
                }}
                style={inputStyle}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Row>
              <Field label="Weight">
                <select
                  value={normaliseWeight(fontWeight)}
                  onChange={(e) => {
                    setFontWeight(e.target.value);
                    emitStyle({ fontWeight: e.target.value });
                  }}
                  style={inputStyle}
                >
                  {WEIGHT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Size">
                <input
                  type="text"
                  value={fontSize}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFontSize(next);
                    emitStyle({ fontSize: pxifyLength(next) });
                  }}
                  placeholder="16px"
                  style={inputStyle}
                />
              </Field>
            </Row>

            <Field label="Color">
              <ColorInput
                value={color}
                onChange={(hex) => {
                  setColor(hex);
                  emitStyle({ color: hex });
                }}
              />
            </Field>

            <Row>
              <Field label="Align">
                <select
                  value={textAlign}
                  onChange={(e) => {
                    setTextAlign(e.target.value);
                    emitStyle({ textAlign: e.target.value });
                  }}
                  style={inputStyle}
                >
                  {ALIGN_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Line Height">
                <input
                  type="text"
                  value={lineHeight}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLineHeight(next);
                    // line-height accepts unitless multipliers (1.5)
                    // OR length values (24px / 1rem). Don't pxify.
                    emitStyle({ lineHeight: next });
                  }}
                  placeholder="1.5"
                  style={inputStyle}
                />
              </Field>
            </Row>

            <Field label="Tracking">
              <input
                type="text"
                value={letterSpacing}
                onChange={(e) => {
                  const next = e.target.value;
                  setLetterSpacing(next);
                  emitStyle({ letterSpacing: pxifyLength(next) });
                }}
                placeholder="0px"
                style={inputStyle}
              />
            </Field>
          </Section>
        )}

        {(bucket === "image" || bucket === "container") && (
          <Section label="Size">
            <Row>
              <Field label="Width">
                <input
                  type="text"
                  value={width}
                  onChange={(e) => {
                    const next = e.target.value;
                    setWidth(next);
                    emitStyle({ width: pxifyLength(next) });
                  }}
                  placeholder="auto"
                  style={inputStyle}
                />
              </Field>
              <Field label="Height">
                <input
                  type="text"
                  value={height}
                  onChange={(e) => {
                    const next = e.target.value;
                    setHeight(next);
                    emitStyle({ height: pxifyLength(next) });
                  }}
                  placeholder="auto"
                  style={inputStyle}
                />
              </Field>
            </Row>
          </Section>
        )}

        <Section label="Box">
          <Field label="Opacity">
            <input
              type="text"
              value={opacity}
              onChange={(e) => {
                const next = e.target.value;
                setOpacity(next);
                emitStyle({ opacity: percentToOpacity(next) });
              }}
              placeholder="100%"
              style={inputStyle}
            />
          </Field>

          {bucket !== "image" && (
            <BoxSidesField
              label="Padding"
              value={padding}
              onChange={(next) => {
                setPadding(next);
                emitStyle({ padding: next });
              }}
            />
          )}

          {bucket === "container" && (
            <BoxSidesField
              label="Margin"
              value={margin}
              onChange={(next) => {
                setMargin(next);
                emitStyle({ margin: next });
              }}
            />
          )}

          {bucket !== "text" && (
            <Field label="Border">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input
                  type="text"
                  value={borderWidth}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBorderWidth(next);
                    emitStyle({ borderWidth: pxifyLength(next) });
                  }}
                  placeholder="0px"
                  style={inputStyle}
                />
                <select
                  value={borderStyle}
                  onChange={(e) => {
                    setBorderStyle(e.target.value);
                    emitStyle({ borderStyle: e.target.value });
                  }}
                  style={inputStyle}
                >
                  {BORDER_STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: 6 }}>
                <ColorInput
                  value={borderColor}
                  onChange={(hex) => {
                    setBorderColor(hex);
                    emitStyle({ borderColor: hex });
                  }}
                />
              </div>
            </Field>
          )}

          {bucket !== "text" && (
            <Field label="Border Radius">
              <input
                type="text"
                value={borderRadius}
                onChange={(e) => {
                  const next = e.target.value;
                  setBorderRadius(next);
                  emitStyle({ borderRadius: pxifyLength(next) });
                }}
                placeholder="0px"
                style={inputStyle}
              />
            </Field>
          )}
        </Section>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          padding: "8px 12px",
          borderTop: "1px solid var(--df-border-subtle)",
          background: "var(--df-surface-raised, var(--df-surface-elevated))",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={saving || !dirty}
          style={btnStyle({ tone: "ghost", disabled: saving || !dirty })}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          style={btnStyle({ tone: "primary", disabled: !dirty || saving })}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </footer>
    </div>
  );
}

// ── tiny building blocks ────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: "var(--df-text-faint)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{children}</div>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3
        style={{
          margin: 0,
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--df-text-muted, var(--df-text-faint))",
          paddingBottom: 4,
          borderBottom: "1px solid var(--df-border-subtle)",
        }}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * Sides of a box-style shorthand (padding/margin). Stored as strings so
 * "auto" / "1rem" / "" round-trip cleanly. Empty string === inherit
 * (no inline override). Order matches CSS shorthand: T R B L.
 */
export interface BoxSides {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

/**
 * Parse a CSS box-style shorthand ("8px", "8px 16px", "8 16 8 16") into
 * its 4-sided form. Follows the canonical CSS shorthand rules:
 *   - 1 value  → all sides
 *   - 2 values → vertical, horizontal
 *   - 3 values → top, horizontal, bottom
 *   - 4 values → top, right, bottom, left
 * Bare numbers stay bare (no auto-pxify) — pxification happens at the
 * leaf inputs so users can still type "auto" or "1rem" per-side.
 * Empty/whitespace input → all-empty (means "no override").
 */
export function parseBoxSides(shorthand: string): BoxSides {
  const empty = { top: "", right: "", bottom: "", left: "" };
  if (!shorthand) return empty;
  const tokens = shorthand.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return empty;
  if (tokens.length === 1) {
    const v = tokens[0];
    return { top: v, right: v, bottom: v, left: v };
  }
  if (tokens.length === 2) {
    const [v, h] = tokens;
    return { top: v, right: h, bottom: v, left: h };
  }
  if (tokens.length === 3) {
    const [t, h, b] = tokens;
    return { top: t, right: h, bottom: b, left: h };
  }
  // 4+ → take first four, ignore the rest (browser does the same).
  const [t, r, b, l] = tokens;
  return { top: t, right: r, bottom: b, left: l };
}

/**
 * Recompose a 4-sided box into the shortest valid CSS shorthand.
 *  - All four empty → "" (clear the property).
 *  - All four equal → "X".
 *  - top === bottom && left === right → "V H".
 *  - top != bottom, left === right → "T H B".
 *  - otherwise → "T R B L".
 * Each individual value is pxified at write-time (so the user can drag
 * a number input and we still emit valid CSS). "auto" / "1rem" /
 * other strings pass through unchanged.
 */
export function formatBoxSides(sides: BoxSides): string {
  const t = pxifyLength(sides.top);
  const r = pxifyLength(sides.right);
  const b = pxifyLength(sides.bottom);
  const l = pxifyLength(sides.left);
  if (!t && !r && !b && !l) return "";
  // Treat missing sides as "0" so the shorthand stays valid even when
  // the user only filled some boxes (otherwise "8px 0px 0px 0px" is
  // what the browser sees anyway).
  const safe = (v: string) => (v ? v : "0");
  const T = safe(t),
    R = safe(r),
    B = safe(b),
    L = safe(l);
  if (T === R && R === B && B === L) return T;
  if (T === B && R === L) return `${T} ${R}`;
  if (R === L) return `${T} ${R} ${B}`;
  return `${T} ${R} ${B} ${L}`;
}

/**
 * Box-sides field — one row showing the current shorthand + a caret
 * that reveals 4 individual side inputs (T / R / B / L). The component
 * owns its own expansion state and side-by-side draft state; the parent
 * only sees the final shorthand string via `onChange`. This means
 * parent state stays `string` and never has to know about the 4-sided
 * structure — avoids the cascade-rewrite pitfall that crashed the
 * previous attempt at this feature (2026-05-19).
 */
function BoxSidesField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Sides mirror the parsed shorthand. We re-parse whenever the parent
  // shorthand changes (e.g. element re-selected) so the expanded view
  // doesn't go stale.
  const [sides, setSides] = useState<BoxSides>(() => parseBoxSides(value));
  useEffect(() => {
    setSides(parseBoxSides(value));
  }, [value]);

  const updateSide = (key: keyof BoxSides, next: string) => {
    const nextSides: BoxSides = { ...sides, [key]: next };
    setSides(nextSides);
    onChange(formatBoxSides(nextSides));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: "var(--df-text-faint)",
          }}
        >
          {label}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          aria-label={expanded ? `Collapse ${label} sides` : `Expand ${label} sides`}
          aria-expanded={expanded}
          title={expanded ? "Collapse sides" : "Expand to edit T/R/B/L"}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--df-text-faint)",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
          }}
        >
          <svg
            width={10}
            height={10}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              display: "block",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 140ms ease-out",
            }}
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(pxifyLength(e.target.value))}
        placeholder="0 0 0 0"
        style={inputStyle}
        aria-label={`${label} shorthand`}
      />
      {expanded ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginTop: 2,
            paddingTop: 6,
            borderTop: "1px dashed var(--df-border-subtle)",
          }}
          data-testid={`box-sides-${label.toLowerCase()}-expanded`}
        >
          <SideInput label="T" value={sides.top} onChange={(v) => updateSide("top", v)} />
          <SideInput label="R" value={sides.right} onChange={(v) => updateSide("right", v)} />
          <SideInput label="B" value={sides.bottom} onChange={(v) => updateSide("bottom", v)} />
          <SideInput label="L" value={sides.left} onChange={(v) => updateSide("left", v)} />
        </div>
      ) : null}
    </div>
  );
}

function SideInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          width: 12,
          color: "var(--df-text-faint)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        style={{ ...inputStyle, padding: "4px 6px", fontSize: 11 }}
      />
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  // Color picker only — the freeform hex text input was removed (user ask):
  // the swatch is the single source of truth.
  return (
    <input
      type="color"
      value={value || "#000000"}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 28,
        padding: 0,
        border: "1px solid var(--df-border-subtle)",
        borderRadius: 4,
        background: "transparent",
        cursor: "pointer",
      }}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  background: "var(--df-surface-sunken-1)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 4,
  color: "var(--df-text-primary)",
  fontFamily: "var(--df-font-mono)",
  fontSize: 12,
};

function btnStyle({
  tone,
  disabled,
}: {
  tone: "primary" | "ghost";
  disabled: boolean;
}): React.CSSProperties {
  return {
    padding: "6px 12px",
    border: "1px solid var(--df-border-subtle)",
    borderRadius: 6,
    background:
      tone === "primary"
        ? disabled
          ? "var(--df-surface-raised)"
          : "var(--df-accent-user, #ef5d3b)"
        : "transparent",
    color:
      tone === "primary" ? (disabled ? "var(--df-text-faint)" : "#fff") : "var(--df-text-primary)",
    fontFamily: "var(--df-font-mono)",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

/** Match a free-form font-family string back to one of our curated
 *  options. We compare on the first family name to keep the dropdown
 *  showing something useful even when the design declares a custom
 *  stack (we fall back to "Inherit" in that case). */
function matchFontValue(stack: string): string {
  if (!stack) return "";
  const head = stack.split(",")[0].trim().replace(/['"]/g, "").toLowerCase();
  for (const opt of FONT_OPTIONS) {
    if (!opt.value) continue;
    const optHead = opt.value.split(",")[0].trim().replace(/['"]/g, "").toLowerCase();
    if (optHead === head) return opt.value;
  }
  return "";
}

/** Computed font-weight comes back as a string ("400") OR a keyword
 *  ("normal", "bold"). Normalise to one of our 100..900 options. */
function normaliseWeight(w: string): string {
  if (!w) return "400";
  if (w === "normal") return "400";
  if (w === "bold") return "700";
  if (WEIGHT_OPTIONS.some((o) => o.value === w)) return w;
  return "400";
}

/** Auto-add `px` when the user typed only digits (or digits + ".").
 *  CSS silently ignores unit-less length values, so "20" used to no-op
 *  (user repro 2026-05-11). Empty string returns empty (means
 *  "clear"). Anything that already has letters / spaces / shorthand
 *  passes through unchanged so users can still type "1rem",
 *  "clamp(...)", or "8 16 8 16". */
export function pxifyLength(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
  return raw;
}

/** Convert "rgb(R, G, B)" or "rgba(R, G, B, A)" to "#RRGGBB". The native
 *  <input type="color"> requires hex. Returns the original string when
 *  parsing fails — caller can still type a value into the paired text
 *  input. */
export function rgbToHex(s: string): string {
  if (!s) return "";
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return s.startsWith("#") ? s : "";
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + toHex(+m[1]) + toHex(+m[2]) + toHex(+m[3]);
}

/** Display opacity as percent ("80%") in the input, even though the
 *  underlying CSS property is unitless 0..1. Computed style returns
 *  the unitless form. */
export function opacityToPercent(s: string): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (!trimmed) return "";
  // Already in percent → pass through
  if (trimmed.endsWith("%")) return trimmed;
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return s;
  // 0..1 → percent
  if (n <= 1) return `${Math.round(n * 100)}%`;
  return `${Math.round(n)}%`;
}

/** Convert user-typed opacity ("80%" or "80" or "0.8") to the CSS
 *  value the iframe expects (unitless 0..1). Empty string clears the
 *  property — same convention as pxifyLength. */
export function percentToOpacity(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const isPct = trimmed.endsWith("%");
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return raw;
  if (isPct) return String(Math.max(0, Math.min(100, n)) / 100);
  // raw number ≤ 1 → already unitless opacity, pass through
  if (n <= 1) return String(Math.max(0, Math.min(1, n)));
  // raw number > 1 → assume the user meant percent
  return String(Math.max(0, Math.min(100, n)) / 100);
}
