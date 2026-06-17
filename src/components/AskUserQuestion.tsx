import { useState } from "react";

export interface ParsedQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  /** The full raw block so consumers can strip it from the surrounding text. */
  raw: string;
}

/**
 * Parse every `::question ... ::` block in Claude's message text. Returns the
 * parsed questions in order of appearance. The caller should strip the raw
 * blocks from the text before rendering prose.
 *
 * Grammar (canonical, documented in workspaceContextPreamble):
 *
 *   ::question
 *   header: <1-3 word label>
 *   question: <the full question>
 *   - label: <option label> | description: <one-liner>
 *   - label: <option label> | description: <one-liner>
 *   ::
 */
export function parseQuestions(text: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  const blockRe = /::question\s*\n([\s\S]*?)\n::/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const raw = m[0];
    const body = m[1];
    const header = (body.match(/^header:\s*(.+)$/m)?.[1] ?? "").trim();
    const question = (body.match(/^question:\s*(.+)$/m)?.[1] ?? "").trim();
    const optionLines = body.match(/^-\s*label:\s*.+$/gm) ?? [];
    const options = optionLines
      .map((line) => {
        const match = line.match(/^-\s*label:\s*(.+?)(?:\s*\|\s*description:\s*(.+))?$/);
        return {
          label: (match?.[1] ?? "").trim(),
          description: match?.[2]?.trim(),
        };
      })
      .filter((o) => o.label);
    if (question && options.length > 0) {
      out.push({ header, question, options, raw });
    }
  }
  return out;
}

export interface AskUserQuestionProps {
  question: ParsedQuestion;
  onPick: (label: string) => void;
  /** Previously-picked answer (disables buttons, highlights selection). */
  answered?: string;
}

export function AskUserQuestion({ question, onPick, answered }: AskUserQuestionProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      style={{
        margin: "12px 0",
        padding: "14px 16px",
        background: "var(--df-surface-raised)",
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-md)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {question.header && (
        <div
          style={{
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            color: "var(--df-text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {question.header}
        </div>
      )}
      <div
        style={{
          fontSize: "var(--df-text-sm)",
          color: "var(--df-text-primary)",
          lineHeight: 1.55,
        }}
      >
        {question.question}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
        {question.options.map((opt) => {
          const isPicked = answered === opt.label;
          const isDim = answered && !isPicked;
          return (
            <button
              key={opt.label}
              type="button"
              disabled={!!answered}
              onClick={() => onPick(opt.label)}
              onMouseEnter={() => setHovered(opt.label)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "10px 12px",
                background: isPicked
                  ? "var(--df-interactive-selected)"
                  : hovered === opt.label && !answered
                    ? "var(--df-interactive-hover)"
                    : "var(--df-bg-section)",
                border: isPicked
                  ? "1px solid var(--df-border-focus)"
                  : "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-sm)",
                color: isDim ? "var(--df-text-faint)" : "var(--df-text-primary)",
                cursor: answered ? "default" : "pointer",
                textAlign: "left",
                transition:
                  "background var(--df-motion-quick) var(--df-ease-out), border-color var(--df-motion-quick) var(--df-ease-out)",
                opacity: isDim ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  fontSize: "var(--df-text-sm)",
                  fontWeight: isPicked ? 500 : 400,
                  minWidth: 0,
                }}
              >
                {opt.label}
              </span>
              {opt.description && (
                <span
                  style={{
                    fontSize: "var(--df-text-xs)",
                    color: isDim ? "var(--df-text-faint)" : "var(--df-text-muted)",
                    fontFamily: "var(--df-font-sans)",
                  }}
                >
                  {opt.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {answered && (
        <div
          style={{
            fontSize: 10,
            color: "var(--df-text-faint)",
            fontFamily: "var(--df-font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Answered · {answered}
        </div>
      )}
    </div>
  );
}

/** Strip every `::question ... ::` block from text. Used before rendering
 *  prose so the raw block doesn't appear as literal text above the UI. */
export function stripQuestionBlocks(text: string): string {
  return text.replace(/::question\s*\n[\s\S]*?\n::/g, "").trim();
}
