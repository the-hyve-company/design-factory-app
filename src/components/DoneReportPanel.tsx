// DoneReportPanel.tsx — turn pipeline UI surface for the done report.
//
// Compact panel rendered below the assistant message when a
// `DoneReport` is present on the ChatMessage. Shows a one-line summary
// plus a "ver detalhes" toggle that expands to the structured JSON.
//
// Why a dedicated component (not inline JSX): the report shape will
// grow (session-resume audit fields, sandbox telemetry). Keeping the
// render code isolated lets the panel evolve without touching
// ChatMessage.tsx.

import { useState } from "react";
import { summarizeDoneReport, type DoneReport } from "@/runtime/done-report";

export interface DoneReportPanelProps {
  report: DoneReport;
  /** When true, default expanded. Useful for catastrophic outcomes. */
  defaultExpanded?: boolean;
}

export function DoneReportPanel({ report, defaultExpanded }: DoneReportPanelProps) {
  // Auto-expand on catastrophic so the user sees the diagnostic immediately.
  const initial = defaultExpanded ?? report.overall === "catastrophic";
  const [expanded, setExpanded] = useState<boolean>(Boolean(initial));

  const summary = summarizeDoneReport(report);
  const tone = toneFromOverall(report.overall);

  return (
    <div
      className="done-report"
      data-overall={report.overall}
      style={{
        marginTop: 6,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        fontSize: 11,
        lineHeight: 1.4,
        color: tone.fg,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: `1px solid ${tone.border}`,
            color: tone.fg,
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 3,
            cursor: "pointer",
            opacity: 0.85,
          }}
          aria-expanded={expanded}
        >
          {expanded ? "ocultar" : "ver detalhes"}
        </button>
      </div>
      {expanded ? (
        <pre
          style={{
            margin: "6px 0 0",
            padding: "6px 8px",
            background: "rgba(0,0,0,0.04)",
            borderRadius: 4,
            fontSize: 10,
            lineHeight: 1.4,
            overflow: "auto",
            maxHeight: 320,
          }}
        >
          {JSON.stringify(report, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

interface ToneSpec {
  fg: string;
  bg: string;
  border: string;
}

function toneFromOverall(overall: DoneReport["overall"]): ToneSpec {
  switch (overall) {
    case "pass":
      return { fg: "#15803d", bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.25)" };
    case "fail":
      return { fg: "#b45309", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.28)" };
    case "catastrophic":
      return { fg: "#b91c1c", bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.28)" };
    case "static-fail":
      return { fg: "#b91c1c", bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.28)" };
  }
}
