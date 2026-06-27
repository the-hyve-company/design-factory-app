// done-report.ts — Runtime Completion Gate, done report.
//
// Composes the result of Static P0 + Runtime P0 + (optional) auto-fix
// loop into the persistent record the chat UI renders and the
// next-turn handoff can grep. Field shape:
//
//   {
//     "artifactHash": "sha256:...",
//     "checkVersion": "p0-v1",
//     "provider": "codex",
//     "model": "default",
//     "duration_ms": 3245,
//     "fixRounds": 1,
//     "staticP0": {...},
//     "runtimeP0": {...},
//     "catastrophic": null
//   }
//
// We deliberately keep this structurally separate from `process-artifacts.ts`
// so that:
//   - the JSON shape is testable in isolation,
//   - the pipeline can construct a done report even when no
//     write happened (e.g. Static P0 fail returned 422),
//   - the done report can be persisted to `.df/chat/{thread}.jsonl` later
//     without dragging the daemon coupling along.

import type { StaticP0Result } from "./static-p0";
import type { RuntimeP0Result, CatastrophicReason } from "./runtime-p0";
import { detectCatastrophicRuntimeFail } from "./runtime-p0";
import type { AutoFixOutcome } from "./auto-fix-loop";
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
  /**
   * Runtime P0 result. Absent when Static P0 failed (we never run Runtime
   * over an artifact that didn't make it to disk). For non-previewable
   * types (markdown/JSON/CSS/JS), Runtime returns `{ status: "skipped" }`.
   */
  runtimeP0?: RuntimeP0Result;
  /** Auto-fix loop outcome, if the loop ran. Absent on first-pass success. */
  autoFix?: AutoFixOutcome;
  /** Deterministic craft net result (taste tells). Signals, never blocks —
   *  does not affect `overall`. Absent when no HTML artifact was checked. */
  craftCheck?: CraftCheckResult;
}

export interface DoneReport {
  artifactHash: string;
  checkVersion: typeof CHECK_VERSION;
  provider: string;
  model: string;
  duration_ms: number;
  /** Number of fix rounds the auto-fix loop consumed. 0 when first-pass. */
  fixRounds: number;
  staticP0: StaticP0Result;
  runtimeP0: RuntimeP0Result | null;
  /** When non-null, the daemon must roll back (or empty-state for first
   *  artifacts). When null, the artifact is the canonical state. */
  catastrophic: CatastrophicReason | null;
  /** Coarse outcome the chat UI renders as a single ✓/✗/⚠. Derived from
   *  the other fields for convenience. Craft tells do NOT affect this — a
   *  pass with craft warnings is still `pass`. */
  overall: "pass" | "fail" | "catastrophic" | "static-fail";
  /** Deterministic craft net result. Null when no HTML artifact was
   *  checked. Surfaced separately from `overall` (warns, never blocks). */
  craftCheck: CraftCheckResult | null;
}

/**
 * Compose a `DoneReport` from the gate results. Pure transform — no I/O.
 *
 * Decision tree for `overall`:
 *   1. Static P0 failed → `static-fail` (no runtime ran).
 *   2. Catastrophic runtime → `catastrophic` (rollback expected).
 *   3. Auto-fix passed → `pass` (runtime succeeded after retry).
 *   4. Runtime fail (with or without auto-fix exhaustion) → `fail`.
 *   5. Otherwise → `pass`.
 */
export function composeDoneReport(input: DoneReportInput): DoneReport {
  const fixRounds = countFixRounds(input.autoFix);
  const effectiveRuntime = pickEffectiveRuntime(input.runtimeP0, input.autoFix);
  const catastrophic = effectiveRuntime ? detectCatastrophicRuntimeFail(effectiveRuntime) : null;

  let overall: DoneReport["overall"];
  if (input.staticP0.status === "fail") {
    overall = "static-fail";
  } else if (catastrophic) {
    overall = "catastrophic";
  } else if (input.autoFix?.status === "pass-after-fix") {
    overall = "pass";
  } else if (effectiveRuntime && effectiveRuntime.status === "fail") {
    overall = "fail";
  } else {
    overall = "pass";
  }

  return {
    artifactHash: input.artifactHash,
    checkVersion: CHECK_VERSION,
    provider: input.provider,
    model: input.model,
    duration_ms: input.duration_ms,
    fixRounds,
    staticP0: input.staticP0,
    runtimeP0: effectiveRuntime ?? null,
    catastrophic,
    overall,
    craftCheck: input.craftCheck ?? null,
  };
}

function countFixRounds(autoFix: AutoFixOutcome | undefined): number {
  if (!autoFix) return 0;
  if (autoFix.status === "provider-error") return autoFix.rounds;
  return autoFix.rounds;
}

/**
 * The auto-fix loop, if present, owns the final runtime result for the
 * turn. We surface IT as the canonical runtime status so the done report
 * reflects the post-fix reality.
 */
function pickEffectiveRuntime(
  initial: RuntimeP0Result | undefined,
  autoFix: AutoFixOutcome | undefined,
): RuntimeP0Result | undefined {
  if (!autoFix) return initial;
  switch (autoFix.status) {
    case "pass-after-fix":
      return { status: "pass", metrics: autoFix.finalMetrics };
    case "fail-exceeded-rounds":
      return autoFix.lastResult;
    case "catastrophic-on-fix":
      return autoFix.lastResult;
    case "static-fail-on-fix":
      // The latest gate signal is the static fail — runtime didn't run on
      // the fix attempt. Surface the original initial result.
      return initial;
    case "provider-error":
      return initial;
  }
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
      return `✓ Runtime gate pass · ${report.provider}/${report.model} · ${report.duration_ms}ms${report.fixRounds ? ` · ${report.fixRounds} fix round(s)` : ""}`;
    case "fail":
      return `⚠ Runtime fail · ${report.provider}/${report.model} · ${describeRuntimeFail(report.runtimeP0)} · ${report.fixRounds} fix round(s)`;
    case "catastrophic":
      return `✗ Catastrophic · ${report.provider}/${report.model} · ${report.catastrophic ?? "unknown"} · rolling back`;
    case "static-fail":
      return `✗ Static P0 fail · ${report.provider}/${report.model} · ${describeStaticFail(report.staticP0)} · file not replaced`;
  }
}

function describeRuntimeFail(rt: RuntimeP0Result | null): string {
  if (!rt) return "no runtime result";
  if (rt.status === "fail") return rt.reason;
  if (rt.status === "catastrophic") return rt.reason;
  return rt.status;
}

function describeStaticFail(sr: StaticP0Result): string {
  if (sr.status === "pass") return "—";
  return sr.reason;
}
