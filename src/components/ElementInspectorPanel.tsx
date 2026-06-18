import { useEffect, useMemo, useState } from "react";
import {
  buildAgentPromptFromSelection,
  type ElementSelectedPayload,
} from "@/runtime/element-overlay";

// ElementInspectorPanel — deliverable 2 (UI half).
//
// Surfaces a selection coming back from the in-iframe element overlay.
// Shows the selector, tag, attributes, and bounding box; provides three
// user-facing actions:
//   - Copy selector to clipboard
//   - Send to agent (with a free-text intent box) — emits the canonical
//     agent prompt fragment built by `buildAgentPromptFromSelection`
//   - Close (clears the selection and exits select mode in the parent)
//
// The panel is a controlled component: the parent owns the current
// selection and the select-mode toggle. We don't store either internally
// because the user may select a new element while this panel is open.
//
// Layout follows the EditDrawer / TokensPanel idiom — fixed-width drawer
// docked to the right edge of the canvas, var(--df-surface-elevated)
// background, mono caps headers, no shadows-as-decoration.

interface ElementInspectorPanelProps {
  selection: ElementSelectedPayload;
  onClose: () => void;
  onSendToAgent: (prompt: string, selection: ElementSelectedPayload) => void;
  onCopy?: (text: string, label: string) => void;
}

export function ElementInspectorPanel({
  selection,
  onClose,
  onSendToAgent,
  onCopy,
}: ElementInspectorPanelProps) {
  const [intent, setIntent] = useState("");

  // Reset the intent textbox whenever the user picks a new element.
  // Without this, an unrelated request would leak across selections.
  useEffect(() => {
    setIntent("");
  }, [selection.selector, selection.outerHtml]);

  const attrEntries = useMemo(() => Object.entries(selection.attrs ?? {}), [selection.attrs]);

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    onCopy?.(text, label);
  };

  const handleSend = () => {
    const trimmed = intent.trim();
    if (!trimmed) return;
    const prompt = buildAgentPromptFromSelection(selection).replace("{{INTENT}}", trimmed);
    onSendToAgent(prompt, selection);
  };

  return (
    <aside
      data-df="element-inspector"
      className="element-inspector-panel"
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: "var(--df-surface-elevated)",
        boxShadow: "var(--df-shadow-card), inset 1px 0 0 var(--df-border-subtle)",
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--df-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--df-font-mono)",
            color: "var(--df-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Element · selected
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close element inspector"
          title="Close (Esc)"
          style={{
            padding: "2px 6px",
            color: "var(--df-text-faint)",
            fontSize: 14,
            cursor: "pointer",
            background: "none",
            border: "none",
          }}
        >
          ✕
        </button>
      </header>

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
        <Field label="Tag">
          <code
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              color: "var(--df-text-primary)",
            }}
          >
            &lt;{selection.tagName}&gt;
          </code>
        </Field>

        <Field label="Selector">
          <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
            <code
              style={{
                flex: 1,
                fontFamily: "var(--df-font-mono)",
                fontSize: 11,
                color: "var(--df-text-primary)",
                background: "var(--df-bg-input, var(--df-bg-base))",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-sm)",
                padding: "6px 8px",
                wordBreak: "break-all",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {selection.selector}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(selection.selector, "selector")}
              title="Copy selector"
              className="df-btn df-btn--secondary"
              style={{ fontSize: 11, padding: "0 10px" }}
            >
              Copy
            </button>
          </div>
        </Field>

        <Field label="Box">
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 11,
              color: "var(--df-text-muted)",
            }}
          >
            {selection.boundingBox.width} × {selection.boundingBox.height} px
            {" @ "}({selection.boundingBox.x}, {selection.boundingBox.y})
          </span>
        </Field>

        {attrEntries.length > 0 && (
          <Field label={`Attributes (${attrEntries.length})`}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "4px 10px",
                fontFamily: "var(--df-font-mono)",
                fontSize: 11,
                color: "var(--df-text-muted)",
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {attrEntries.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <code style={{ color: "var(--df-text-faint)" }}>{k}</code>
                  <code
                    style={{
                      color: "var(--df-text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={v}
                  >
                    {v}
                  </code>
                </div>
              ))}
            </div>
          </Field>
        )}

        {selection.textContent && (
          <Field label="Text">
            <div
              style={{
                fontSize: 12,
                color: "var(--df-text-primary)",
                background: "var(--df-bg-input, var(--df-bg-base))",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-sm)",
                padding: "6px 8px",
                maxHeight: 80,
                overflowY: "auto",
              }}
            >
              {selection.textContent}
            </div>
          </Field>
        )}

        <Field label="Edit this element">
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe the change. E.g. 'make this orange and bold'."
            style={{
              width: "100%",
              minHeight: 72,
              resize: "vertical",
              fontFamily: "var(--df-font-mono)",
              fontSize: 12,
              color: "var(--df-text-primary)",
              background: "var(--df-bg-input, var(--df-bg-base))",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-sm)",
              padding: "8px 10px",
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!intent.trim()}
            className="df-btn df-btn--primary"
            style={{ marginTop: 8, width: "100%", fontSize: 12 }}
          >
            Send to agent · {modifierLabel()}↵
          </button>
        </Field>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
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
        {label}
      </div>
      {children}
    </div>
  );
}

function modifierLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
