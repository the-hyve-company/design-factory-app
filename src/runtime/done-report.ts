// done-report.ts — Completion Gate done report.
//
// Composes the result of Static P0 (+ the deterministic craft net) into
// the persistent record the chat UI renders and the next-turn handoff can
// grep. Field shape:
//
//   {
//     "artifactHash": "sha256:...",
//     "checkVersion": "p0-v1",
//     "provider": "codex",
//     "model": "default",
//     "duration_ms": 3245,
//     "staticP0": {...},
//     "craftCheck": {...} | null,
//     "channel": "artifact" | "tool",
//     "overall": "pass" | "static-fail"
//   }
//
// The runtime probe + auto-fix loop were retired when the pipeline was
// simplified to a single post-stream Static P0 gate (their modules are
// gone), so `overall` is now just pass / static-fail. Git history holds
// the old machinery if iframe runtime validation is ever revived.
//
// We deliberately keep this structurally separate from `process-artifacts.ts`
// so that:
//   - the JSON shape is testable in isolation,
//   - the pipeline can construct a done report even when no
//     write happened (e.g. Static P0 fail returned 422),
//   - the done report can be persisted to `.df/chat/{thread}.jsonl` later
//     without dragging the daemon coupling along.

import type { StaticP0Result } from "./static-p0";
import type { CraftCheckResult } from "./craft-checks";
import { summarizeCraftChecks } from "./craft-checks";

/** Bumped on every breaking change to the field shape. Users grep for
 *  `checkVersion` in archived chats to know which schema applies. */
export const CHECK_VERSION = "p0-v1";

export interface DoneReportInput {
  /** sha256 hex of the artifact body (recalculated server-side per D28). */
  artifactHash: string;
  /** Provider that produced the artifact (`claude`, `codex`, `gemini`, ...). */
  provider: string;
  /** Model name reported by the adapter (free-form). */
  model: string;
  /** Wall-clock duration of the entire turn (ms). */
  duration_ms: number;
  /** Static P0 result. Always present (the gate is type-aware but always
   *  runs). */
  staticP0: StaticP0Result;
  /** Deterministic craft net result (taste tells). Signals, never blocks —
   *  does not affect `overall`. Absent when no HTML artifact was checked. */
  craftCheck?: CraftCheckResult;
  /** Which channel produced the artifact: `artifact` (the model emitted an
   *  <artifact> block the gate parsed) or `tool` (a CLI provider wrote via
   *  its native Write tool; the gate ran post-hoc on what it wrote).
   *  Defaults to `artifact`. */
  channel?: "artifact" | "tool";
}

export interface DoneReport {
  artifactHash: string;
  checkVersion: typeof CHECK_VERSION;
  provider: string;
  model: string;
  duration_ms: number;
  staticP0: StaticP0Result;
  /** Coarse outcome the chat UI renders as a single ✓/✗. Derived from
   *  Static P0. Craft tells do NOT affect this — a pass with craft warnings
   *  is still `pass`. */
  overall: "pass" | "static-fail";
  /** Deterministic craft net result. Null when no HTML artifact was
   *  checked. Surfaced separately from `overall` (warns, never blocks). */
  craftCheck: CraftCheckResult | null;
  /** Channel that produced the artifact (`artifact` gate-parsed, or `tool`
   *  CLI native-write validated post-hoc). */
  channel: "artifact" | "tool";
}

/**
 * Compose a `DoneReport` from the gate result. Pure transform — no I/O.
 *
 * `overall` is `static-fail` when Static P0 failed (no write happened),
 * otherwise `pass`. Craft tells are surfaced separately and never change it.
 */
export function composeDoneReport(input: DoneReportInput): DoneReport {
  const overall: DoneReport["overall"] = input.staticP0.status === "fail" ? "static-fail" : "pass";

  return {
    artifactHash: input.artifactHash,
    checkVersion: CHECK_VERSION,
    provider: input.provider,
    model: input.model,
    duration_ms: input.duration_ms,
    staticP0: input.staticP0,
    overall,
    craftCheck: input.craftCheck ?? null,
    channel: input.channel ?? "artifact",
  };
}

/**
 * Format a one-paragraph human summary the chat UI can render verbatim.
 * The structured `DoneReport` is the source of truth for tooling; this
 * helper exists so the user sees a useful sentence immediately without
 * the UI having to learn every shape.
 */
export function summarizeDoneReport(report: DoneReport): string {
  const base = baseSummary(report);
  // Craft tells are additive — appended to whatever the hard gate said.
  if (report.craftCheck && report.craftCheck.status === "warn") {
    return `${base} · ${summarizeCraftChecks(report.craftCheck)}`;
  }
  return base;
}

function baseSummary(report: DoneReport): string {
  switch (report.overall) {
    case "pass":
      return `✓ Runtime gate pass · ${report.provider}/${report.model} · ${report.duration_ms}ms`;
    case "static-fail":
      // Artifact channel: the gate blocked the write. Tool channel: the CLI
      // already wrote the file, so this is a post-hoc diagnostic, not a block.
      return `✗ Static P0 fail · ${report.provider}/${report.model} · ${describeStaticFail(report.staticP0)} · ${
        report.channel === "tool" ? "written file has errors" : "file not replaced"
      }`;
  }
}

function describeStaticFail(sr: StaticP0Result): string {
  if (sr.status === "pass") return "—";
  return sr.reason;
}
