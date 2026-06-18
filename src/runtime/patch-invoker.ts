// Search-replace editing path.
//
// Onlook-style: instead of regenerating the whole HTML on each edit, we ask
// Claude for a minimal set of `{search, replace}` string patches. For small
// tweaks this is dramatically faster and preserves everything else exactly.
//
// Strategy when an edit instruction lands:
//   1. Invoke Claude with the PATCH_SYSTEM prompt (JSON-only output)
//   2. Parse `{ patches: [{search, replace}], summary? }`
//   3. Apply each patch as a direct `str.replace(search, replace)` (first
//      occurrence only — if the LLM wants a global change it should include
//      the patch N times with progressively different context)
//   4. If any `search` isn't present verbatim, the patch fails → caller falls
//      back to full-regeneration via invokeApplyStyle.

import { spawnOnce } from "./cli-spawner";
import { extractJsonPayload } from "./prompt-invoker";
import type { ProjectContext } from "./prompt-invoker";

export interface HtmlPatch {
  search: string;
  replace: string;
}

export interface PatchResponse {
  patches: HtmlPatch[];
  summary?: string;
}

export const PATCH_SYSTEM = [
  "You are a precise HTML editor. The user just asked for a small change",
  "to an existing document. Produce a minimal JSON patch.",
  "",
  "INPUT:",
  "1. The current HTML (full document)",
  "2. An edit instruction in natural language",
  "",
  "OUTPUT — JSON only, no markdown fences, no prose:",
  "",
  "{",
  '  "patches": [',
  '    { "search": "<literal substring from the HTML>", "replace": "<what to put there>" }',
  "  ],",
  '  "summary": "1-sentence description of what changed"',
  "}",
  "",
  "RULES:",
  "- `search` MUST be a verbatim substring of the current HTML — copy it",
  "  character-for-character, whitespace included. Do not paraphrase.",
  "- Keep each `search` small enough to be unique in the document — usually",
  "  one tag or attribute. If the literal appears more than once, include",
  "  enough surrounding context to make it unique.",
  "- Emit multiple patches to handle multiple spots. Each patch replaces the",
  "  FIRST occurrence of its `search`.",
  "- If the change is structural enough that patches would be larger than the",
  '  full file, return `{ "patches": [], "needsFullRewrite": true }` and the',
  "  caller will fall back to a full regeneration.",
  "- Never invent selectors or elements that aren't in the source HTML.",
  "- Preserve surrounding formatting/whitespace exactly.",
].join("\n");

/** Execute the patch invocation. Returns parsed patches or null on failure. */
export async function invokeSearchReplaceEdit(
  instruction: string,
  ctx: ProjectContext,
): Promise<PatchResponse | null> {
  if (!ctx.currentHtml) return null;
  const prompt = [`HTML atual:`, ctx.currentHtml, "", `Instrução: ${instruction}`].join("\n");
  // 1 stabilize (regression report): pass providerId so the
  // patch invocation actually goes to the picker-selected provider. Pre-fix,
  // ctx.providerId was silently dropped here — picker showed Codex/Gemini
  // but the patch path always defaulted to Claude (cli-spawner DEFAULT_PROVIDER_ID).
  // The same fingerprint that bit invokeApplyStyle/Consult/EditElement etc.
  const raw = await spawnOnce("refine", prompt, PATCH_SYSTEM, {
    providerId: ctx.providerId,
    model: ctx.model,
    cwd: ctx.cwd,
    agent: ctx.agent,
  });
  return parsePatchResponse(raw);
}

export function parsePatchResponse(raw: string): PatchResponse | null {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw));
    if (parsed?.needsFullRewrite) return { patches: [] };
    if (!Array.isArray(parsed?.patches)) return null;
    const patches: HtmlPatch[] = [];
    for (const p of parsed.patches) {
      if (typeof p?.search === "string" && typeof p?.replace === "string" && p.search.length > 0) {
        patches.push({ search: p.search, replace: p.replace });
      }
    }
    return {
      patches,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Apply a list of patches in order to the HTML.
 * - Returns { html, applied } on full success.
 * - Returns { html: null, failedAt, reason } if a patch's `search` isn't
 *   present verbatim, OR if it appears multiple times (ambiguous — Claude
 *   should have included more context).
 * Caller should fall back to full regeneration on failure.
 */
export function applyPatches(
  html: string,
  patches: HtmlPatch[],
):
  | { html: string; applied: number }
  | { html: null; failedAt: number; reason: "not-found" | "ambiguous" } {
  let out = html;
  for (let i = 0; i < patches.length; i++) {
    const { search, replace } = patches[i];
    const first = out.indexOf(search);
    if (first < 0) return { html: null, failedAt: i, reason: "not-found" };
    // Ambiguity guard: if the literal appears more than once in the CURRENT
    // state, replacing the first occurrence might hit the wrong spot. Reject
    // so the caller falls back to full regen — safer than silent bad edits.
    const second = out.indexOf(search, first + 1);
    if (second >= 0) return { html: null, failedAt: i, reason: "ambiguous" };
    out = out.slice(0, first) + replace + out.slice(first + search.length);
  }
  return { html: out, applied: patches.length };
}

// ============================================================================
// DOM in-place patches (persistent-canvas migration, 2026-04-27)
// ============================================================================
//
// Apply patches directly to the iframe's live DOM, preserving browser state
// (scroll position, form input values, animations, video playback). When the
// patch can't be applied safely via DOM mutation, returns a failure reason and
// the caller falls back to srcDoc replace + scroll preservation.
//
// Trade-off: slower than string replace (DOM walk) but preserves state. Used
// by the chat refine path; not used for full regen, version restore, or tweak
// panel injection (those go through srcDoc replace).

export type PatchFailureReason =
  | "no-document"
  | "not-found"
  | "ambiguous"
  | "spans-multiple-elements"
  | "patch-too-large";

export type DomPatchResult =
  | { applied: number }
  | { applied: number; failedAt: number; reason: PatchFailureReason };

// Patches larger than this fall back to srcDoc replace. Big patches usually
// indicate structural changes where DOM in-place would be unreliable anyway,
// and the DOM walk cost grows with the search string length.
const MAX_DOM_PATCH_SIZE = 2000;

/**
 * Apply patches directly to the iframe's live DOM, preserving state.
 * Returns { applied } on full success, or { applied, failedAt, reason } on
 * the first patch that couldn't be applied. Caller decides whether to fall
 * back (for the chat refine path: yes — call applyPatches() + setIframeHtml).
 *
 * Strategy per patch:
 * 1. Reject if `search` is too large (heuristic: probably structural change).
 * 2. Find smallest enclosing element whose outerHTML contains `search`.
 * 3. Replace that element's outerHTML with the patched version.
 * 4. Validate the result parses as HTML before swapping the DOM node.
 *
 * Edge cases (see plan §6):
 * - SVG/Canvas with internal JS state: state resets when element is replaced.
 *   Acceptable trade-off in v1 — designers don't typically chat-edit these.
 * - Multiple patches in sequence: applied in order; if patch #N fails the
 *   first N-1 stay applied (partial application). Caller logs + can offer
 *   reload to clean state.
 */
export function applyPatchesToDom(iframe: HTMLIFrameElement, patches: HtmlPatch[]): DomPatchResult {
  const doc = iframe.contentDocument;
  if (!doc) return { applied: 0, failedAt: 0, reason: "no-document" };

  const root = doc.documentElement;
  let appliedCount = 0;

  for (let i = 0; i < patches.length; i++) {
    const result = applySingleDomPatch(root, patches[i]);
    if (result.kind === "ok") {
      appliedCount++;
    } else {
      return { applied: appliedCount, failedAt: i, reason: result.reason };
    }
  }
  return { applied: appliedCount };
}

type SinglePatchOk = { kind: "ok" };
type SinglePatchFail = { kind: "fail"; reason: PatchFailureReason };
type SinglePatchResult = SinglePatchOk | SinglePatchFail;

function applySingleDomPatch(root: HTMLElement, patch: HtmlPatch): SinglePatchResult {
  if (patch.search.length > MAX_DOM_PATCH_SIZE) {
    return { kind: "fail", reason: "patch-too-large" };
  }

  // Ambiguity + presence check using the current serialized outerHTML. Mirrors
  // the string-based applyPatches() logic so DOM behavior matches the LLM's
  // mental model of where the patch lands.
  const html = root.outerHTML;
  const first = html.indexOf(patch.search);
  if (first < 0) return { kind: "fail", reason: "not-found" };
  const second = html.indexOf(patch.search, first + 1);
  if (second >= 0) return { kind: "fail", reason: "ambiguous" };

  // Walk DOM to find the smallest enclosing element. Recursive descent: an
  // element "encloses" the patch when its outerHTML contains `search` AND no
  // child does. This guarantees we replace the tightest scope possible.
  const target = findEnclosingElement(root, patch.search);
  if (!target) return { kind: "fail", reason: "not-found" };

  // Build the new outerHTML by replacing within the target's scope.
  const newOuter = target.outerHTML.replace(patch.search, patch.replace);
  if (newOuter === target.outerHTML) {
    // The patch's `search` straddled this element's boundary (e.g. covered
    // child text + parent tag close). Can't safely replace at this scope.
    return { kind: "fail", reason: "spans-multiple-elements" };
  }

  // Validate the replacement parses as a single root element. DOMParser is
  // lenient and never throws — we check structure manually.
  const parser = new DOMParser();
  const fragment = parser.parseFromString(newOuter, "text/html");

  // For html/head/body roots, the parser puts them back in the document tree.
  // For arbitrary elements, the parser drops them in body.firstElementChild.
  let newElement: Element | null = null;
  if (target === root) {
    newElement = fragment.documentElement;
  } else if (target.tagName === "HEAD") {
    newElement = fragment.head;
  } else if (target.tagName === "BODY") {
    newElement = fragment.body;
  } else {
    newElement = fragment.body.firstElementChild;
  }

  if (!newElement) return { kind: "fail", reason: "spans-multiple-elements" };

  // Import the parsed node so it's owned by the iframe document, then swap.
  // Without adoptNode/importNode, replaceWith may mismatch ownerDocument on
  // some browsers and reject the operation.
  const adopted = root.ownerDocument.importNode(newElement, true);
  target.replaceWith(adopted);
  return { kind: "ok" };
}

/**
 * Find the smallest enclosing element whose outerHTML contains `search`.
 * Recursive descent: returns the deepest element that still contains the
 * patch fully within itself. Caller has already verified `root.outerHTML`
 * contains the search and that it appears exactly once.
 */
function findEnclosingElement(root: Element, search: string): Element | null {
  if (!root.outerHTML.includes(search)) return null;
  for (const child of Array.from(root.children)) {
    const inChild = findEnclosingElement(child, search);
    if (inChild) return inChild;
  }
  // root contains the search but no child does → root is the smallest enclosing
  return root;
}
