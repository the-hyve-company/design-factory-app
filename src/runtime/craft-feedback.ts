// craft-feedback.ts — turns deterministic craft findings into prompt
// blocks the model can act on. Two consumers, two audit items:
//
//   · `buildCraftFindingsBlock` — the /polish pass (audit WS1
//     `autofix-rewire-craft`). The old auto-fix-loop.ts was deleted with
//     the pipeline simplification; per craft decision #4 its replacement
//     is OPT-IN ONLY — nothing fires automatically. When the user
//     explicitly invokes /polish, the latest done report's craft
//     warnings ({tier, fix, snippet}) ride into the verb prompt so the
//     pass targets the exact deterministic findings instead of
//     free-styling.
//
//   · `buildCraftReminderBlock` — the next-turn reminder (audit WS1
//     `agent-reminder-self-correct`). The middle ground between a
//     passive warn and a full /polish pass: the previous turn's
//     warnings come back as a structured, P0-first system block on the
//     NEXT turn, so the model self-corrects while doing whatever the
//     user asked — no extra pass, no extra tokens spent on a dedicated
//     fix turn.
//
// Both builders are pure and deterministic — no I/O, no model calls.

import type { CraftFinding, CraftTier } from "@/runtime/craft-checks";
import type { DoneReport } from "@/runtime/done-report";

const TIER_ORDER: Record<CraftTier, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * The craft findings of the LATEST done report in a chat, or [] when the
 * latest report came back clean (a clean report supersedes older warns —
 * the file was rewritten since). Shared by the /polish wiring and the
 * next-turn reminder so both read the same source of truth.
 */
export function latestCraftFindings(
  messages: ReadonlyArray<{ role: string; doneReport?: DoneReport }>,
): CraftFinding[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const craft = m.doneReport?.craftCheck;
    if (!craft) continue;
    return craft.status === "warn" ? craft.findings : [];
  }
  return [];
}

/** P0 → P1 → P2, stable within each tier. */
export function sortFindings(findings: readonly CraftFinding[]): CraftFinding[] {
  return [...findings].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
}

function findingLine(f: CraftFinding): string {
  const snippet = f.sample ? ` · found: \`${f.sample}\`` : "";
  return `- [${f.tier}] ${f.ruleId} — ${f.title}. Fix: ${f.detail}${snippet}`;
}

export interface CraftFeedbackOptions {
  /** Cap on the findings listed (P0 first — the tail gets summarized).
   *  Keeps the block from flooding the prompt when a document trips
   *  many tells at once. */
  maxFindings?: number;
}

const DEFAULT_MAX_FINDINGS = 8;

function renderFindings(findings: readonly CraftFinding[], max: number): string[] {
  const sorted = sortFindings(findings);
  const shown = sorted.slice(0, max);
  const lines = shown.map(findingLine);
  const rest = sorted.length - shown.length;
  if (rest > 0) {
    lines.push(
      `- (+${rest} more lower-tier finding${rest === 1 ? "" : "s"} — fix the above first)`,
    );
  }
  return lines;
}

/**
 * The /polish payload. Appended to the verb's USER prompt (after the
 * HTML) when the user opts into a polish pass and the last turn's craft
 * net warned. Empty string when there's nothing to report — the caller
 * can append unconditionally.
 */
export function buildCraftFindingsBlock(
  findings: readonly CraftFinding[],
  opts: CraftFeedbackOptions = {},
): string {
  if (findings.length === 0) return "";
  const max = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;
  return [
    "## Deterministic craft findings (fix ALL of these in this pass)",
    "",
    "A deterministic post-generation check flagged the tells below,",
    "P0 first. They are grep-verified facts about the current file, not",
    "opinions — each one names the violated rule and the concrete move.",
    "Apply every fix while keeping the design's intent intact.",
    "",
    ...renderFindings(findings, max),
  ].join("\n");
}

/**
 * The next-turn self-correction reminder. Injected as a SYSTEM block by
 * the composer when the previous turn's craft net warned. Deliberately
 * softer than the /polish block: the user asked for something else this
 * turn — the findings are a rider, not the mission.
 */
export function buildCraftReminderBlock(
  findings: readonly CraftFinding[],
  opts: CraftFeedbackOptions = {},
): string {
  if (findings.length === 0) return "";
  const max = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;
  return [
    "## Craft reminder — tells from your previous output",
    "",
    "The deterministic craft check flagged these in the file you wrote",
    "last turn (P0 first). While fulfilling the user's request, correct",
    "any of them you touch — and don't introduce new ones:",
    "",
    ...renderFindings(findings, max),
  ].join("\n");
}
