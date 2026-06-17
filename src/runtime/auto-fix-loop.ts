// auto-fix-loop.ts — Runtime Completion Gate, auto-fix wrapper.
//
// When Runtime P0 reports a NON-catastrophic fail (`fail` status), the
// gate marks the artifact as `runtime-failed` and enters this loop:
//
//   1. Build a prescriptive fix prompt from the failure metadata.
//   2. Hand the prompt to the caller-injected `callProvider` function.
//   3. Re-run Static P0 + Runtime P0 against the new content.
//   4. If still failing, repeat up to `maxRounds` (default 2 — spec calls
//      for 1..2). After the cap, return `fail-exceeded-rounds` with the
//      last result and let the done report surface it.
//
// We never trigger rollback from here. Catastrophic outcomes are detected
// upstream and routed to the rollback path before they reach this loop.
// If a fix attempt produces a catastrophic result, we return early with
// the catastrophic outcome so the daemon can roll back to the previous
// good artifact (or to empty state for first-artifact projects).
//
// The fix prompt is intentionally prescriptive — the agent gets a list of
// concrete failures with `current → fix` guidance, NOT abstract
// "make it better" prose. See `buildFixPrompt()`.
//
// Pure orchestration: this module never fetches, mounts iframes, or talks
// to the daemon directly. The caller (`processArtifacts` /
// pipeline) injects everything (`callProvider`, optional `staticGate`,
// `runtimeGate`).

import { validateArtifactStaticP0, type StaticP0Result } from "./static-p0";
import { runPreviewRuntimeP0, type RuntimeP0Result, type RuntimeMetrics } from "./runtime-p0";
import type { ArtifactBlock } from "./artifact-processor";

/** Default cap on fix rounds. Spec §step 4 calls for 1..2. */
export const DEFAULT_MAX_FIX_ROUNDS = 2;

export interface AutoFixInput {
  /** The artifact whose Runtime P0 failed. We re-prompt the agent with it. */
  artifact: ArtifactBlock;
  /** The failing result from the FIRST Runtime P0 run (round 0). The loop
   *  uses it to build the initial fix prompt. */
  runtimeResult: RuntimeP0Result;
  /**
   * Caller-injected entry point that re-prompts the provider with `prompt`
   * and returns the new artifact body. The caller is responsible for
   * extracting the artifact from the provider's full text (e.g. by
   * re-running `parseArtifact`) and producing just the inner content.
   *
   * Throwing from this function aborts the loop; the auto-fix outcome
   * surfaces as `fail-exceeded-rounds` with the error attached.
   */
  callProvider: (fixPrompt: string, round: number) => Promise<string>;
  /** Override the round cap. */
  maxRounds?: number;
  /**
   * Optional Static P0 override. Used by tests and by callers that want to
   * inject a pre-validated result. Defaults to the canonical
   * `validateArtifactStaticP0`.
   */
  staticGate?: (input: {
    content: string;
    type: string;
    finalPath: string;
    contentHash: string;
  }) => StaticP0Result;
  /**
   * Optional Runtime P0 override. Defaults to the canonical
   * `runPreviewRuntimeP0`. Tests substitute a deterministic stub.
   */
  runtimeGate?: (input: { type: string; srcdoc: string }) => Promise<RuntimeP0Result>;
}

export type AutoFixOutcome =
  | {
      status: "pass-after-fix";
      rounds: number;
      finalContent: string;
      finalMetrics: RuntimeMetrics;
    }
  | {
      status: "fail-exceeded-rounds";
      rounds: number;
      lastResult: RuntimeP0Result;
      lastContent: string;
    }
  | {
      status: "static-fail-on-fix";
      rounds: number;
      lastStaticResult: StaticP0Result;
      lastContent: string;
    }
  | {
      status: "catastrophic-on-fix";
      rounds: number;
      lastResult: RuntimeP0Result;
      lastContent: string;
    }
  | {
      status: "provider-error";
      rounds: number;
      error: string;
    };

/**
 * Run the auto-fix loop. Resolves with a structured outcome — never
 * rejects. Caller renders the result in the done report.
 */
export async function autoFixLoop(input: AutoFixInput): Promise<AutoFixOutcome> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_FIX_ROUNDS;
  const staticGate = input.staticGate ?? defaultStaticGate;
  const runtimeGate = input.runtimeGate ?? defaultRuntimeGate;

  let lastRuntimeResult = input.runtimeResult;
  let lastContent = input.artifact.content;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds++;
    const fixPrompt = buildFixPrompt({
      artifact: { ...input.artifact, content: lastContent },
      runtimeResult: lastRuntimeResult,
      round: rounds,
      maxRounds,
    });

    let nextContent: string;
    try {
      nextContent = await input.callProvider(fixPrompt, rounds);
    } catch (err) {
      return {
        status: "provider-error",
        rounds,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (typeof nextContent !== "string" || nextContent.length === 0) {
      return {
        status: "provider-error",
        rounds,
        error: "callProvider returned empty content",
      };
    }

    lastContent = nextContent;

    // Re-run Static P0. If the agent's fix is malformed (broke the HTML),
    // we bail out immediately — there's no point running Runtime on an
    // artifact that won't even parse statically.
    const staticResult = staticGate({
      content: nextContent,
      type: input.artifact.type,
      finalPath: input.artifact.identifier,
      contentHash: input.artifact.contentHash,
    });
    if (staticResult.status !== "pass") {
      return {
        status: "static-fail-on-fix",
        rounds,
        lastStaticResult: staticResult,
        lastContent: nextContent,
      };
    }

    // Re-run Runtime P0.
    const runtimeResult = await runtimeGate({
      type: input.artifact.type,
      srcdoc: nextContent,
    });

    // Catastrophic on fix: stop the loop and let the daemon rollback.
    if (runtimeResult.status === "catastrophic") {
      return {
        status: "catastrophic-on-fix",
        rounds,
        lastResult: runtimeResult,
        lastContent: nextContent,
      };
    }

    if (runtimeResult.status === "pass" || runtimeResult.status === "skipped") {
      // For type-not-previewable on round-1+ we count as pass — Static P0
      // already validated the structural change.
      const metrics = runtimeResult.status === "pass" ? runtimeResult.metrics : zeroMetrics();
      return {
        status: "pass-after-fix",
        rounds,
        finalContent: nextContent,
        finalMetrics: metrics,
      };
    }

    lastRuntimeResult = runtimeResult;
  }

  return {
    status: "fail-exceeded-rounds",
    rounds,
    lastResult: lastRuntimeResult,
    lastContent,
  };
}

// ─── Prompt construction ────────────────────────────────────────────────

interface BuildFixPromptInput {
  artifact: ArtifactBlock;
  runtimeResult: RuntimeP0Result;
  round: number;
  maxRounds: number;
}

/**
 * Build a prescriptive fix prompt. We list every observable fault and
 * include the relevant metric so the agent can self-diagnose. We do NOT
 * suggest abstract qualities ("make it pretty"). If the agent ignores the
 * prompt and re-emits the same broken artifact, the loop catches that on
 * round 2 and surfaces `fail-exceeded-rounds` to the done report.
 */
export function buildFixPrompt(input: BuildFixPromptInput): string {
  const { artifact, runtimeResult, round, maxRounds } = input;
  const lines: string[] = [];

  lines.push(`# Runtime fix request (round ${round}/${maxRounds})`);
  lines.push("");
  lines.push(
    `The artifact at \`${artifact.identifier}\` (type \`${artifact.type}\`) was written but Runtime P0 reported failures. Re-emit a SINGLE \`<artifact>\` block with the same identifier and type, fixing the issues below.`,
  );
  lines.push("");

  if (runtimeResult.status === "fail") {
    const m = runtimeResult.metrics;
    lines.push(`## Failure: ${runtimeResult.reason}`);
    lines.push("");
    if (runtimeResult.reason === "console-error-critical") {
      lines.push("Console errors captured inside the iframe:");
      for (const err of m.consoleErrors.slice(0, 8)) {
        lines.push(`- ${err}`);
      }
      lines.push("");
      lines.push("Fix: remove the cause of each error. Common cases:");
      lines.push("- `Uncaught ReferenceError: x is not defined` → declare or import the symbol.");
      lines.push("- `Failed to load module` → fix the import path or inline the module.");
      lines.push(
        "- `TypeError: Cannot read properties of null` → add a null check before the access.",
      );
    } else if (runtimeResult.reason === "asset-404-critical") {
      lines.push("Local assets returned 404:");
      for (const url of m.asset404s.slice(0, 8)) {
        lines.push(`- ${url}`);
      }
      lines.push("");
      lines.push(
        "Fix: either inline the asset (data: URI for small images, <style> for CSS) or remove the reference.",
      );
    } else if (runtimeResult.reason === "fonts-failed") {
      lines.push("`document.fonts.ready` resolved with failures.");
      lines.push("");
      lines.push(
        "Fix: either ship the @font-face block with a valid src, drop the custom font, or use a system fallback.",
      );
    }
  } else if (runtimeResult.status === "catastrophic") {
    // Catastrophic shouldn't normally enter the fix loop, but if a previous
    // round's fix made things worse we surface the reason explicitly.
    lines.push(`## Catastrophic: ${runtimeResult.reason}`);
    lines.push("");
    if (runtimeResult.reason === "blank-screen") {
      lines.push("The body had zero area and no visible children. Common causes:");
      lines.push("- All content inside `<head>` instead of `<body>`.");
      lines.push("- A root element with `display:none` or `height:0`.");
      lines.push("- Content rendered entirely via JS that never ran.");
    } else if (runtimeResult.reason === "syntax-error-pre-paint") {
      const errs = runtimeResult.metrics?.consoleErrors ?? [];
      if (errs.length) {
        lines.push("SyntaxError captured before first paint:");
        for (const err of errs.slice(0, 4)) lines.push(`- ${err}`);
      } else {
        lines.push("A SyntaxError stopped the page before it could paint.");
      }
      lines.push("Fix: balance every `(`, `{`, `[`, and quote in your scripts.");
    } else if (runtimeResult.reason === "body-invisible") {
      lines.push("Body has area but every child element computed to zero size. Common causes:");
      lines.push("- `body { display: none }` or `body { opacity: 0 }`.");
      lines.push("- Every child has `visibility: hidden` or `position: absolute; left: -99999px`.");
      lines.push("- Root container is set to `width: 0` or `height: 0`.");
    } else if (
      runtimeResult.reason === "iframe-timeout" ||
      runtimeResult.reason === "probe-no-payload"
    ) {
      lines.push("The runtime probe never reported. Common causes:");
      lines.push("- Synchronous infinite loop in a `<script>` tag.");
      lines.push("- Top-level `await` that never resolves.");
      lines.push("- Document body removed before the probe could attach.");
    }
  }

  lines.push("");
  lines.push(
    'Re-emit the FULL artifact (no diffs, no patches) as a single `<artifact identifier="' +
      artifact.identifier +
      '" type="' +
      artifact.type +
      '">…</artifact>` block at the very end of your response.',
  );

  return lines.join("\n");
}

// ─── Default gate adapters ──────────────────────────────────────────────

function defaultStaticGate(input: {
  content: string;
  type: string;
  finalPath: string;
  contentHash: string;
}): StaticP0Result {
  return validateArtifactStaticP0(input);
}

function defaultRuntimeGate(input: { type: string; srcdoc: string }): Promise<RuntimeP0Result> {
  return runPreviewRuntimeP0({ type: input.type, srcdoc: input.srcdoc });
}

function zeroMetrics(): RuntimeMetrics {
  return {
    bodyRect: { width: 0, height: 0 },
    visibleChildCount: 0,
    consoleErrors: [],
    fontsReady: true,
    asset404s: [],
    firstPaintMs: 0,
  };
}
