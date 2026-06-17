// ToolEventBubble — provider-agnostic renderer for a SINGLE canonical
// NormalizedToolEvent.
//
// Why this component exists:
// ChatMessage already ships a ToolSummary + ToolChip pair (the legacy
// path) that consumes the `ToolUseRecord[]` ledger. Both renderers stay
// in place — they're battle-tested for the multi-tool grouping behaviour
// the user approved (single Wrote line collapsing 3 file writes).
//
// ToolEventBubble is the COMPLEMENTARY surface for callers that want
// per-event rendering (debug surfaces, log inspectors, future
// granular tool inspector). It speaks the canonical `NormalizedToolEvent`
// envelope so downstream code never needs to reach into per-provider
// vocabulary.
//
// Design choices:
//   - Inline (not block-wide) so it composes with the existing chat layout.
//   - Provider dot reuses the ProviderBadge palette so the visual language
//     stays consistent across surfaces.
//   - Output truncation at 1500 chars matches ToolChip — keeps long Bash
//     stdout from blowing the chat scroll while still letting expand
//     reveal the full payload.
//   - No emojis, no decorative color shifts. Status communicated via:
//       tool_call    → muted dot ("running")
//       tool_result  → green dot (#5faa54, same as ToolChip)
//       tool_error   → red dot (#ef5d3b, same as ToolChip)

import { useState } from "react";
import type {
  NormalizedToolEvent,
  NormalizedToolCallEvent,
  NormalizedToolResultEvent,
  NormalizedToolErrorEvent,
} from "@/runtime/tool-events";
import type { ProviderId } from "@/providers/types";

// Reuse the ProviderBadge palette (kept private to the badge component
// today; we duplicate the small slice we need here so this file doesn't
// import the badge — the badge has different sizing assumptions).
const PROVIDER_DOT: Record<ProviderId, string> = {
  claude: "#cf8a4a",
  codex: "#10a37f",
  gemini: "#4285f4",
  opencode: "#f97316",
  kimi: "#1c64f2",
  anthropic: "#cf8a4a",
  openai: "#10a37f",
  "gemini-api": "#4285f4",
  openrouter: "#a855f7",
  ollama: "#7b8794",
};

const STATUS_COLORS = {
  pending: "var(--df-text-faint, #888)",
  ok: "#5faa54",
  error: "#ef5d3b",
} as const;

const OUTPUT_TRUNCATE_LIMIT = 1500;

interface Props {
  event: NormalizedToolEvent;
  /** When true, the input/output panel starts expanded. Useful for
   *  debug surfaces that want full visibility by default. Defaults
   *  collapsed to match ToolChip behaviour. */
  defaultExpanded?: boolean;
  /** Optional click handler — receives the event so callers can route to
   *  a detail panel. Doesn't affect the inline expand/collapse. */
  onSelect?: (event: NormalizedToolEvent) => void;
}

export function ToolEventBubble({ event, defaultExpanded = false, onSelect }: Props) {
  switch (event.type) {
    case "tool_call":
      return <ToolCallBubble event={event} defaultExpanded={defaultExpanded} onSelect={onSelect} />;
    case "tool_result":
      return (
        <ToolResultBubble event={event} defaultExpanded={defaultExpanded} onSelect={onSelect} />
      );
    case "tool_error":
      return (
        <ToolErrorBubble event={event} defaultExpanded={defaultExpanded} onSelect={onSelect} />
      );
  }
}

function ToolCallBubble({
  event,
  defaultExpanded,
  onSelect,
}: {
  event: NormalizedToolCallEvent;
  defaultExpanded: boolean;
  onSelect?: (event: NormalizedToolEvent) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = summarizeInput(event.name, event.input);
  return (
    <Shell
      provider={event.provider}
      status="pending"
      label={event.name}
      summary={summary}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      onSelect={onSelect ? () => onSelect(event) : undefined}
    >
      <Section title="Input">
        <pre style={preStyle}>{JSON.stringify(event.input, null, 2)}</pre>
      </Section>
    </Shell>
  );
}

function ToolResultBubble({
  event,
  defaultExpanded,
  onSelect,
}: {
  event: NormalizedToolResultEvent;
  defaultExpanded: boolean;
  onSelect?: (event: NormalizedToolEvent) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const truncated = event.output.length > OUTPUT_TRUNCATE_LIMIT;
  const display = truncated ? `${event.output.slice(0, OUTPUT_TRUNCATE_LIMIT)}\n…` : event.output;
  const summary = collapseToOneLine(event.output, 140) || `result · ${event.toolCallId}`;
  return (
    <Shell
      provider={event.provider}
      status="ok"
      label="result"
      summary={summary}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      onSelect={onSelect ? () => onSelect(event) : undefined}
    >
      <Section title={`Result${truncated ? ` (truncated to ${OUTPUT_TRUNCATE_LIMIT} chars)` : ""}`}>
        <pre style={preStyle}>{display || "(empty output)"}</pre>
      </Section>
    </Shell>
  );
}

function ToolErrorBubble({
  event,
  defaultExpanded,
  onSelect,
}: {
  event: NormalizedToolErrorEvent;
  defaultExpanded: boolean;
  onSelect?: (event: NormalizedToolEvent) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Shell
      provider={event.provider}
      status="error"
      label="error"
      summary={collapseToOneLine(event.reason, 140) || "tool error"}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      onSelect={onSelect ? () => onSelect(event) : undefined}
    >
      <Section title="Reason">
        <pre style={{ ...preStyle, color: STATUS_COLORS.error }}>{event.reason}</pre>
      </Section>
    </Shell>
  );
}

// ─── Shared chrome ───────────────────────────────────────────────────────

function Shell(props: {
  provider: ProviderId;
  status: "pending" | "ok" | "error";
  label: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect?: () => void;
  children?: React.ReactNode;
}) {
  const { provider, status, label, summary, expanded, onToggle, onSelect, children } = props;
  const dot = STATUS_COLORS[status];
  return (
    <div
      data-tool-event-bubble
      data-provider={provider}
      data-status={status}
      style={{
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-sm)",
        background: "var(--df-bg-section)",
        overflow: "hidden",
        fontSize: 11,
        marginBottom: 6,
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          if (onSelect) {
            // Click on the chrome routes to onSelect; the caret toggles
            // expand independently below.
            onSelect();
          } else {
            onToggle();
          }
          e.currentTarget.blur();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          color: "var(--df-text-secondary)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--df-font-mono)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            flexShrink: 0,
            background: dot,
          }}
        />
        <ProviderDot provider={provider} />
        <span style={{ color: "var(--df-text-primary)", fontWeight: 500 }}>{label}</span>
        <span
          style={{
            color: "var(--df-text-faint)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <span
          aria-hidden
          // The caret is the dedicated expand control when onSelect is
          // routed to a different handler. Stop event so it doesn't
          // bubble into the parent's onSelect path.
          onClick={(e) => {
            if (onSelect) {
              e.stopPropagation();
              onToggle();
            }
          }}
          style={{ color: "var(--df-text-faint)", fontSize: 10 }}
        >
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            borderTop: "1px solid var(--df-border-subtle)",
            background: "var(--df-bg-base)",
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            color: "var(--df-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ProviderDot({ provider }: { provider: ProviderId }) {
  const color = PROVIDER_DOT[provider];
  return (
    <span
      aria-label={provider}
      title={provider}
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${color} 50%, transparent)`,
        flexShrink: 0,
      }}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          color: "var(--df-text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: 9,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </>
  );
}

// ─── Helpers (mirror ChatMessage.summarizeInput) ─────────────────────────

function summarizeInput(name: string, input: Record<string, unknown>): string {
  const low = name.toLowerCase();
  if (low === "bash" && typeof input.command === "string") return input.command as string;
  if (low === "read" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "edit" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "write" && typeof input.file_path === "string") return input.file_path as string;
  if (low === "glob" && typeof input.pattern === "string") return input.pattern as string;
  if (low === "grep" && typeof input.pattern === "string") return input.pattern as string;
  for (const k of ["command", "query", "pattern", "file_path", "url", "content"]) {
    if (typeof input[k] === "string") return (input[k] as string).slice(0, 140);
  }
  const first = Object.values(input).find((v) => typeof v === "string");
  return typeof first === "string" ? first.slice(0, 140) : "";
}

function collapseToOneLine(s: string, maxChars: number): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1)}…`;
}

const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

// ─── Convenience: list renderer for an array of events ───────────────────

export function ToolEventStream({
  events,
  defaultExpanded,
  onSelect,
}: {
  events: NormalizedToolEvent[];
  defaultExpanded?: boolean;
  onSelect?: (event: NormalizedToolEvent) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div data-tool-event-stream style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {events.map((ev, i) => (
        <ToolEventBubble
          key={`${ev.provider}-${ev.type === "tool_call" ? ev.id : ev.toolCallId}-${ev.type}-${i}`}
          event={ev}
          defaultExpanded={defaultExpanded}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
