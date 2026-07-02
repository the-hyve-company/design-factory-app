// static-p0.ts — Static P0 type-aware validation (client wrapper).
//
// Runs BEFORE the daemon renames the temp artifact to its final path.
// A static fail NEVER substitutes the current file — the daemon
// preserves the previous good artifact, and the agent gets a
// structured diagnostic so the next turn can self-repair.
//
// Since the WS1 `craft-net-shared-core` refactor the RULE SET lives in
// ONE place: `apps/daemon/src/lib/static-p0-core.mjs` (DOM-free, plain
// JS so the daemon can import it natively; Vite bundles it into the
// client at build time). This wrapper:
//   1. runs the shared core — identical verdicts to the daemon gate,
//      locked by static-p0-parity.test.ts;
//   2. layers the strictly-ADDITIVE DOM extras only the browser/test
//      environment can do: DOMParser parse-error detection for HTML and
//      real XML parsing for SVG. These only make the client STRICTER —
//      they never pass something the core failed.
//
// Type-aware (Amendment v0.3.4 table):
//   text/html             → byte-floor, prelude, balanced tags, body has
//                          renderable content, no duplicate ids
//                          (+ DOM extra: DOMParser parse).
//   image/svg+xml         → byte-floor, <svg> root, </svg> close
//                          (+ DOM extra: parses as XML).
//   text/markdown         → byte-floor, valid UTF-8, ≥1 non-whitespace char.
//   text/plain            → byte-floor, valid charset.
//   application/json      → byte-floor (relaxed to 0), JSON.parse without throw.
//   text/css              → byte-floor, balanced { } pairs (PostCSS-lite).
//   application/javascript → byte-floor, goal-aware parse (script/module —
//                          see `parseJsGoalAware` in the core).
//   image/png|jpeg|webp,
//   font/woff2|ttf        → binary; byte-floor only.
//   anything else         → `type-not-supported` fail.
//
// This module returns synchronously — every check is pure CPU on a
// string buffer.

import {
  validateArtifactStaticP0Core,
  DEFAULT_BYTE_FLOOR,
  JSON_BYTE_FLOOR,
  BINARY_BYTE_FLOOR,
} from "../../apps/daemon/src/lib/static-p0-core.mjs";

export { DEFAULT_BYTE_FLOOR, JSON_BYTE_FLOOR, BINARY_BYTE_FLOOR };

export type StaticP0Status = "pass" | "fail";

export type StaticP0FailReason =
  | "below-min-bytes"
  | "invalid-html-prelude"
  | "domparser-error"
  | "empty-body"
  | "duplicate-id"
  | "unbalanced-tags"
  | "invalid-svg"
  | "invalid-json"
  | "invalid-css"
  | "invalid-js"
  | "invalid-utf8"
  | "type-not-supported";

export interface StaticP0Input {
  /** Final path the artifact will land at (purely informational here — the
   *  daemon owns the realpath/scope check). Included so failure diagnostics
   *  can name the file the agent meant to write. */
  finalPath: string;
  /** Raw artifact body. */
  content: string;
  /** Hint hash from the parser. The daemon recalculates server-side
   *  (D28); we keep it so test fixtures can stay deterministic. */
  contentHash: string;
  /** MIME type from the `<artifact>` open tag. */
  type: string;
  /** Optional override of the default byte floor (skill-specific). */
  byteFloor?: number;
}

export interface StaticP0Pass {
  status: "pass";
  /** Names of the checks that ran (useful for done report introspection). */
  checks: string[];
}

export interface StaticP0Fail {
  status: "fail";
  reason: StaticP0FailReason;
  details: string;
  /** Checks that fired (last entry is the one that caused the fail). */
  failedChecks: string[];
}

export type StaticP0Result = StaticP0Pass | StaticP0Fail;

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const SVG_TYPES = new Set(["image/svg+xml"]);

// ─── Public entry ────────────────────────────────────────────────────────

/**
 * validateArtifactStaticP0 — pure synchronous Static P0 gate.
 *
 * Returns `{ status: "pass", checks }` on success or
 * `{ status: "fail", reason, details, failedChecks }` on the first hard fail.
 * The daemon should treat any non-`pass` result as Static P0 fail and
 * preserve the previous good artifact (Amendment v0.3.2).
 */
export function validateArtifactStaticP0(input: StaticP0Input): StaticP0Result {
  const core = validateArtifactStaticP0Core({
    type: input.type,
    content: input.content,
    ...(input.byteFloor !== undefined ? { byteFloor: input.byteFloor } : {}),
  });
  if (!core.ok) {
    return {
      status: "fail",
      reason: core.reason as StaticP0FailReason,
      details: core.details,
      failedChecks: core.failedChecks,
    };
  }

  // DOM extras — additive strictness only (the shared verdict already
  // passed). Both use the environment's DOMParser; when it's missing
  // (plain Node without a DOM lib) the extras are skipped, matching the
  // daemon's behavior exactly.
  const checks = [...core.checks];
  if (HTML_TYPES.has(input.type)) {
    const extra = htmlDomExtras(input.content, checks);
    if (extra) return extra;
  } else if (SVG_TYPES.has(input.type)) {
    const extra = svgDomExtras(input.content, checks);
    if (extra) return extra;
  }

  return { status: "pass", checks };
}

// ─── DOM extras ──────────────────────────────────────────────────────────

function htmlDomExtras(content: string, checks: string[]): StaticP0Fail | null {
  if (!hasDomParser()) return null;
  checks.push("dom-parse");
  const parsed = tryDomParse(content, "text/html");
  if (!parsed.ok) {
    return {
      status: "fail",
      reason: "domparser-error",
      details: parsed.error,
      failedChecks: checks,
    };
  }

  // Strict body emptiness — the DOM knows what the forgiving parser
  // actually moved into <body>, so it catches exotic cases the core's
  // regex heuristic can't (e.g. content the parser relocates into head).
  checks.push("dom-body-content");
  const body = parsed.doc.body;
  const hasBody =
    !!body && (body.children.length > 0 || (body.textContent || "").trim().length > 0);
  if (!hasBody) {
    return {
      status: "fail",
      reason: "empty-body",
      details:
        "Document <body> has no children and no non-whitespace text. The runtime would render a blank screen.",
      failedChecks: checks,
    };
  }
  return null;
}

function svgDomExtras(content: string, checks: string[]): StaticP0Fail | null {
  if (!hasDomParser()) return null;
  checks.push("xml-parse");
  const parsed = tryDomParse(content, "application/xml" as DOMParserSupportedType);
  if (!parsed.ok) {
    return {
      status: "fail",
      reason: "invalid-svg",
      details: parsed.error,
      failedChecks: checks,
    };
  }
  // Most SVG syntax errors surface as <parsererror> nodes. We surface them
  // explicitly so the agent gets a useful diagnostic.
  const root = parsed.doc.documentElement;
  if (!root || root.localName.toLowerCase() === "parsererror") {
    return {
      status: "fail",
      reason: "invalid-svg",
      details: "XML parser rejected the SVG document.",
      failedChecks: checks,
    };
  }
  return null;
}

// ─── DOM parsing helpers ────────────────────────────────────────────────

interface ParseOk {
  ok: true;
  doc: Document;
}
interface ParseErr {
  ok: false;
  error: string;
}

function hasDomParser(): boolean {
  return typeof (globalThis as { DOMParser?: typeof DOMParser }).DOMParser === "function";
}

function tryDomParse(content: string, mime: DOMParserSupportedType): ParseOk | ParseErr {
  // happy-dom (test env) and browsers expose DOMParser globally.
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) {
    return {
      ok: false,
      error: "DOMParser not available in this environment (Node without a DOM library).",
    };
  }
  let doc: Document;
  try {
    doc = new Parser().parseFromString(content, mime);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // For text/html DOMParser is forgiving and returns even on errors. For
  // application/xml it embeds <parsererror> nodes — happy-dom names that
  // element `parsererror` too.
  const errEl = doc.querySelector("parsererror");
  if (errEl) {
    return { ok: false, error: errEl.textContent || "DOMParser flagged a parser error." };
  }
  return { ok: true, doc };
}
