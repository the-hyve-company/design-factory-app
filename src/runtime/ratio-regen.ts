/**
 * ratio-regen.ts — orchestrate a Claude regeneration of a video project's
 * HTML when the user switches aspect ratio.
 *
 * Flow:
 *   1. gitSnapshot pre-stream (best-effort safety net)
 *   2. Backup the current HTML in memory (canonical restore source)
 *   3. Build the canonical regen prompt
 *   4. streamClaude — accumulate tokens, validate on done, write file
 *   5. Caller restores from backup on error/cancel
 *
 * The orchestrator is stateless. EditorScreen owns the RatioChangeState
 * machine; ratio-regen.ts only resolves the request or rejects it.
 */

import {
  streamClaude,
  gitSnapshot,
  writeFile,
  writeProjectMeta,
  readProjectMeta,
  type ClaudeConfig,
  type UnlistenFn,
} from "@/lib/claude-bridge";
import type { RatioId } from "@/runtime/hyperframes-invoker";

export type RatioDimsMap = Record<RatioId, { w: number; h: number; label: string }>;

export const RATIO_DIMS: RatioDimsMap = {
  "16:9": { w: 1920, h: 1080, label: "1920×1080" },
  "9:16": { w: 1080, h: 1920, label: "1080×1920" },
  "1:1": { w: 1080, h: 1080, label: "1080×1080" },
  "4k": { w: 3840, h: 2160, label: "3840×2160" },
};

/**
 * Build the canonical regen prompt. Verbatim from approved-plan §5.1.
 * Placeholder names (OLD_W / OLD_H) in the spec are resolved here from
 * RATIO_DIMS so the prompt carries concrete numbers, not template tokens.
 */
export function buildRegenPrompt(html: string, oldRatio: RatioId, newRatio: RatioId): string {
  const oldDims = RATIO_DIMS[oldRatio];
  const newDims = RATIO_DIMS[newRatio];
  return `You are reformatting an HTML video project to a new aspect ratio.

**Current ratio:** ${oldRatio} (${oldDims.label})
**Target ratio:** ${newRatio} (${newDims.label})

**Constraints:**
- Preserve ALL content: text, copy, fonts, colors, scenes, animations, keyframes, scene timing.
- Only change layout dimensions and width/height/position values that are aspect-locked.
- Replace any \`width: ${oldDims.w}px\` / \`height: ${oldDims.h}px\` on html/body/section with \`width: ${newDims.w}px\` / \`height: ${newDims.h}px\`.
- Adjust internal grids, absolute-positioned elements, and flex containers to fit the new aspect.
- Keep the same number of scenes, scene order, and animation keyframes.
- Do NOT change copy, fonts, colors, or design tokens.
- Output ONLY the full HTML document. No markdown fences. No explanation. No prose.

<input-html>
${html}
</input-html>`;
}

export interface RegenForRatioInput {
  slug: string;
  projectPath: string;
  html: string;
  oldRatio: RatioId;
  newRatio: RatioId;
  config: ClaudeConfig;
  /** Called after every onText with the cumulative token count. */
  onTokens?: (count: number) => void;
}

export interface RegenForRatioResult {
  /** The full HTML written to disk. */
  html: string;
  /** Stream/token telemetry for diagnostics. */
  tokensSeen: number;
}

export class RegenError extends Error {
  constructor(
    message: string,
    public readonly kind: "stream" | "invalid-html" | "cancelled" | "write-failed",
  ) {
    super(message);
    this.name = "RegenError";
  }
}

/**
 * Validate that a streamed string looks like a complete HTML document.
 * Heuristic per plan §5.2 step 6.
 */
function isValidHtml(text: string): boolean {
  if (!text || text.length < 500) return false;
  const lower = text.toLowerCase();
  const hasDoctypeOrHtml = lower.includes("<!doctype") || lower.includes("<html");
  const hasBody = lower.includes("<body");
  return hasDoctypeOrHtml && hasBody;
}

/**
 * Run the regen pipeline. Returns a tuple { promise, abort } so the caller
 * can wire the overlay's Cancel button into the same lifecycle.
 *
 * - promise resolves with { html, tokensSeen } on success.
 * - promise rejects with RegenError on stream error, invalid HTML, cancel,
 *   or write failure. Caller is responsible for restoring from its own
 *   in-memory backup; this orchestrator does NOT touch disk on failure.
 */
export function regenerateForRatio(input: RegenForRatioInput): {
  promise: Promise<RegenForRatioResult>;
  abort: () => void;
} {
  const { slug, projectPath, html, oldRatio, newRatio, config, onTokens } = input;
  const htmlPath = `${projectPath.replace(/\/$/, "")}/${slug}.html`;

  let unlistenFn: UnlistenFn | null = null;
  let cancelled = false;

  const abort = () => {
    cancelled = true;
    try {
      unlistenFn?.();
    } catch {}
  };

  const promise = new Promise<RegenForRatioResult>((resolve, reject) => {
    void (async () => {
      // Best-effort snapshot — do not block on errors.
      gitSnapshot(projectPath, "pre-ratio-regen").catch((e) => {
        console.warn("[ratio-regen] gitSnapshot failed (continuing):", e);
      });

      const prompt = buildRegenPrompt(html, oldRatio, newRatio);
      let buffer = "";
      let tokenCount = 0;

      try {
        unlistenFn = await streamClaude(prompt, config, {
          onText: (chunk: string) => {
            if (cancelled) return;
            buffer += chunk;
            // Rough token approximation (1 token ≈ 4 chars). Plan §4.3
            // explicitly wants an aggregated counter, not raw tokens.
            tokenCount = Math.round(buffer.length / 4);
            onTokens?.(tokenCount);
          },
          onDone: async (fullText: string) => {
            if (cancelled) {
              reject(new RegenError("user-cancelled", "cancelled"));
              return;
            }
            const finalText = fullText || buffer;
            if (!isValidHtml(finalText)) {
              reject(new RegenError("Modelo retornou conteúdo inválido", "invalid-html"));
              return;
            }
            try {
              await writeFile(htmlPath, finalText);
              const meta = await readProjectMeta(slug);
              if (meta) {
                await writeProjectMeta(slug, { ...meta, video_ratio: newRatio });
              }
              resolve({ html: finalText, tokensSeen: tokenCount });
            } catch (e) {
              reject(new RegenError(`Falha ao gravar HTML: ${String(e)}`, "write-failed"));
            }
          },
          onError: (err: string) => {
            if (cancelled) return; // already rejected via cancel path
            reject(new RegenError(err || "Stream falhou", "stream"));
          },
        });
      } catch (e) {
        reject(new RegenError(`Não consegui iniciar o stream: ${String(e)}`, "stream"));
      }
    })();
  });

  return { promise, abort };
}
