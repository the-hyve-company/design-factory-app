// Hyperframes invoker — frontend façade for the bridge's
// `/hyperframes/*` endpoints. Mirrors the cli-spawner pattern: thin
// wrapper that owns the SSE connection + maps bridge events to typed
// callbacks, never spawns a child process directly.
//
// State machine (matches step 3.6 of anime-hyperframes-poc.md):
//   idle → linting → rendering → encoding → done
//                                          → error
//
// Lifecycle:
//   1. Caller assembles an ExportConfig (from VideoTab inspector) plus the
//      composition HTML.
//   2. Calls renderVideo({ html, config }, callbacks). Returns an
//      AbortController; calling .abort() cancels the in-flight render.
//   3. Bridge emits SSE events as it spawns `npx hyperframes`, parses
//      stdout, and runs FFmpeg to encode the final MP4.
//   4. On done, callbacks.onDone fires with the on-disk MP4 path.

import { BRIDGE_URL } from "@/lib/claude-bridge";

/** Render config for a Hyperframes export. Built up by the Video Tab's
 *  inspector and passed verbatim to the bridge. */
export type RatioId = "16:9" | "9:16" | "1:1" | "4k";
export interface ExportConfig {
  ratio: RatioId;
  /** Absolute path to the audio file the user attached, or null. */
  audioPath: string | null;
  /** Seconds. Inferred from the timeline parser. */
  durationSec: number;
}

export type HyperframesPhase = "linting" | "rendering" | "encoding" | "done" | "error";

export interface HyperframesCallbacks {
  /** Phase changed. UI swaps the state card. */
  onPhase?: (phase: HyperframesPhase) => void;
  /** Determinate progress [0..1]. Fires during `rendering` and `encoding`.
   *  `linting` is indeterminate (no progress events). */
  onProgress?: (
    frac: number,
    detail?: { frame?: number; totalFrames?: number; fps?: number },
  ) => void;
  /** Soft warning surfaced by the linter. Render continues but the UI
   *  shows them above the progress card. */
  onWarning?: (text: string) => void;
  /** Terminal: success. */
  onDone?: (result: { mp4Path: string; durationMs: number; sizeBytes: number }) => void;
  /** Terminal: failure. `kind` lets the UI pick the right error card
   *  (lint/render/constraint). */
  onError?: (err: { kind: "lint" | "render" | "constraint" | "spawn"; message: string }) => void;
}

export interface RenderRequest {
  /** Slug of the project — bridge resolves it under projects/{slug}/. */
  slug: string;
  /** Inline HTML of the composition at the moment of export. The bridge
   *  writes a temp copy so we don't pollute the project's index. */
  html: string;
  config: ExportConfig;
}

export function renderVideo(req: RenderRequest, cb: HyperframesCallbacks): AbortController {
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/hyperframes/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        cb.onError?.({ kind: "spawn", message: `bridge HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.trim()) continue;
          let event = "message";
          let dataStr = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          let data: unknown;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          const d = data as Record<string, unknown>;
          if (event === "phase") cb.onPhase?.(String(d.phase) as HyperframesPhase);
          else if (event === "progress")
            cb.onProgress?.(
              Number(d.frac ?? 0),
              d as { frame?: number; totalFrames?: number; fps?: number },
            );
          else if (event === "warning") cb.onWarning?.(String(d.text ?? ""));
          else if (event === "done")
            cb.onDone?.({
              mp4Path: String(d.mp4Path ?? ""),
              durationMs: Number(d.durationMs ?? 0),
              sizeBytes: Number(d.sizeBytes ?? 0),
            });
          else if (event === "error")
            cb.onError?.({
              kind: (d.kind as "lint" | "render" | "constraint" | "spawn") || "render",
              message: String(d.message ?? "render failed"),
            });
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      cb.onError?.({ kind: "spawn", message: String(e) });
    }
  })();
  return controller;
}

// Static analyzer (step 3.7) — reads the composition HTML and flags
// constructs that break determinism. Run before the actual render so
// the modal can show warnings inline. The same checks run server-side
// during the lint phase, so this is best-effort UX, not a gate.
export interface DeterminismIssue {
  kind: "setTimeout" | "setInterval" | "Math.random" | "scroll-listener" | "intersection-observer";
  /** 1-based line in the HTML. */
  line: number;
  excerpt: string;
}

export function detectDeterminismIssues(html: string): DeterminismIssue[] {
  const issues: DeterminismIssue[] = [];
  // We only scan the contents of <script> blocks. CSS animations are
  // deterministic and don't need this check.
  const scriptBlocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of scriptBlocks) {
    const code = block[1];
    const blockStart = block.index ?? 0;
    const lines = code.split("\n");
    let lineOffset = 0;
    // Compute the line number where this script block STARTS in the
    // overall HTML so issues map to the right HTML line.
    for (let i = 0; i < blockStart; i++) {
      if (html[i] === "\n") lineOffset++;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const num = lineOffset + i + 1;
      const push = (kind: DeterminismIssue["kind"]) => {
        issues.push({ kind, line: num, excerpt: line.trim().slice(0, 120) });
      };
      // Patterns that break headless render frame stability.
      if (/\bsetTimeout\s*\(/.test(line)) push("setTimeout");
      if (/\bsetInterval\s*\(/.test(line)) push("setInterval");
      // Math.random without a seedrandom() set up earlier in the same
      // block — naive heuristic, false positives ok (warning, not gate).
      if (/\bMath\.random\s*\(/.test(line) && !/seedrandom/.test(code)) push("Math.random");
      if (/addEventListener\s*\(\s*["']scroll["']/.test(line)) push("scroll-listener");
      if (/new\s+IntersectionObserver/.test(line)) push("intersection-observer");
    }
  }
  return issues;
}
