// static-p0.ts — Static P0 type-aware validation.
//
// Runs BEFORE the daemon renames the temp artifact to its final path.
// A static fail NEVER substitutes the current file — the daemon
// preserves the previous good artifact, and the agent gets a
// structured diagnostic so the next turn can self-repair.
//
// Why a separate TS module from the daemon-side `.mjs`: the same
// ruleset has to be reachable from the client pipeline (early
// feedback before POST) and from the daemon (defense-in-depth before
// rename). To avoid drift the canonical rules live here, in
// TypeScript, with a thin JavaScript companion that mirrors the same
// checks for Node ≤ 22 without dragging a DOM library into
// apps/daemon.
//
// Type-aware (Amendment v0.3.4 table):
//   text/html             → byte-floor, prelude, DOMParser parse, body has
//                          content, no duplicate ids on critical elements,
//                          balanced html/head/body/script/style tags.
//   image/svg+xml         → byte-floor, parses as XML, contains <svg> root.
//   text/markdown         → byte-floor, valid UTF-8, ≥1 non-whitespace char.
//   text/plain            → byte-floor, valid charset.
//   application/json      → byte-floor (relaxed to 0), JSON.parse without throw.
//   text/css              → byte-floor, balanced { } pairs (PostCSS-lite).
//   application/javascript → byte-floor, `new Function(content)` parses.
//   image/png|jpeg|webp,
//   font/woff2|ttf        → binary; byte-floor only (Static P0 cannot
//                          meaningfully introspect them client-side).
//   anything else         → `type-not-supported` fail.
//
// Runtime P0 (probe + iframe) is owned by `runtime-p0.ts`. This module
// returns synchronously — every check here is pure CPU on a string buffer.

/** Default minimum byte floor for text artifacts. HTML "vazio" boilerplate
 *  is ~150 bytes; we want a real document. Skills can override per-call. */
export const DEFAULT_BYTE_FLOOR = 200;

/** Override floor for JSON payloads — empty `{}` is two bytes and totally
 *  valid. The structural check (`JSON.parse`) handles content quality. */
export const JSON_BYTE_FLOOR = 2;

/** Binary types skip almost every check; we still demand a non-trivial
 *  payload because zero-byte images crash every preview. */
export const BINARY_BYTE_FLOOR = 16;

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

// ─── Type categorisation ─────────────────────────────────────────────────

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

const SVG_TYPES = new Set(["image/svg+xml"]);

const TEXT_TYPES = new Set(["text/markdown", "text/x-markdown", "text/plain"]);

const JSON_TYPES = new Set(["application/json", "application/ld+json"]);

const CSS_TYPES = new Set(["text/css"]);

const JS_TYPES = new Set(["application/javascript", "text/javascript"]);

const BINARY_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
]);

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
  const { type, content } = input;

  if (typeof content !== "string") {
    return {
      status: "fail",
      reason: "below-min-bytes",
      details: "content must be a string",
      failedChecks: ["content-type"],
    };
  }

  if (HTML_TYPES.has(type)) return validateHtml(input);
  if (SVG_TYPES.has(type)) return validateSvg(input);
  if (JSON_TYPES.has(type)) return validateJson(input);
  if (CSS_TYPES.has(type)) return validateCss(input);
  if (JS_TYPES.has(type)) return validateJs(input);
  if (TEXT_TYPES.has(type)) return validateText(input);
  if (BINARY_TYPES.has(type)) return validateBinary(input);

  return {
    status: "fail",
    reason: "type-not-supported",
    details: `Static P0 does not know how to validate type "${type}". Add it to the type table or emit a supported type.`,
    failedChecks: ["type-table"],
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────

function validateHtml(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = [];
  const floor = input.byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);

  checks.push("byte-floor");
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  checks.push("prelude");
  const trimmed = stripBom(content).trimStart();
  // Accept DOCTYPE, <html, <svg (technically SVG-as-HTML for embedded snippets),
  // <?xml. We DO NOT accept arbitrary `<` here — the prelude is a high-signal
  // signal that the agent emitted a real document, not a prose fragment that
  // happens to start with a tag. (The minimal floor in the daemon is more
  // permissive; this is the canonical strict version.)
  if (!/^(<!doctype\b|<html\b|<svg\b|<\?xml\b)/i.test(trimmed)) {
    return {
      status: "fail",
      reason: "invalid-html-prelude",
      details:
        "HTML must begin with <!DOCTYPE html>, <html>, <svg>, or <?xml. Got: " + snippet(trimmed),
      failedChecks: checks,
    };
  }

  checks.push("balanced-tags");
  const balance = checkBalancedHtmlTags(content);
  if (!balance.ok) {
    return {
      status: "fail",
      reason: "unbalanced-tags",
      details: balance.detail,
      failedChecks: checks,
    };
  }

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

  checks.push("body-content");
  const body = parsed.doc.body;
  // happy-dom may produce a body that's `null` for malformed input; treat
  // missing body as empty-body since the runtime would crash on it anyway.
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

  checks.push("duplicate-ids");
  const dupId = findDuplicateId(parsed.doc);
  if (dupId) {
    return {
      status: "fail",
      reason: "duplicate-id",
      details: `Duplicate id="${dupId}" — selectors and accessibility break.`,
      failedChecks: checks,
    };
  }

  return { status: "pass", checks };
}

// ─── SVG ─────────────────────────────────────────────────────────────────

function validateSvg(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = [];
  const floor = input.byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);

  checks.push("byte-floor");
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  checks.push("svg-root");
  const trimmed = stripBom(content).trimStart();
  if (!/^(<\?xml\b[^>]*\?>\s*)?<svg\b/i.test(trimmed)) {
    return {
      status: "fail",
      reason: "invalid-svg",
      details:
        "SVG must start with <svg> (optional <?xml> prolog allowed). Got: " + snippet(trimmed),
      failedChecks: checks,
    };
  }

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

  return { status: "pass", checks };
}

// ─── Markdown / Plain text ──────────────────────────────────────────────

function validateText(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = [];
  const floor = input.byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);

  checks.push("byte-floor");
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  checks.push("utf8-roundtrip");
  if (!isWellFormedUtf8(content)) {
    return {
      status: "fail",
      reason: "invalid-utf8",
      details: "Content contains lone surrogates or invalid UTF-8 sequences.",
      failedChecks: checks,
    };
  }

  checks.push("non-whitespace");
  if (content.trim().length === 0) {
    return {
      status: "fail",
      reason: "empty-body",
      details: "Document is whitespace-only.",
      failedChecks: checks,
    };
  }

  return { status: "pass", checks };
}

// ─── JSON ────────────────────────────────────────────────────────────────

function validateJson(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = ["byte-floor"];
  const floor = input.byteFloor ?? JSON_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  checks.push("json-parse");
  try {
    JSON.parse(content);
  } catch (err) {
    return {
      status: "fail",
      reason: "invalid-json",
      details: err instanceof Error ? err.message : String(err),
      failedChecks: checks,
    };
  }
  return { status: "pass", checks };
}

// ─── CSS ─────────────────────────────────────────────────────────────────

function validateCss(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = ["byte-floor"];
  const floor = input.byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  checks.push("balanced-braces");
  const balance = checkBalancedBraces(content);
  if (!balance.ok) {
    return {
      status: "fail",
      reason: "invalid-css",
      details: balance.detail,
      failedChecks: checks,
    };
  }

  return { status: "pass", checks };
}

// ─── JS ──────────────────────────────────────────────────────────────────

function validateJs(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = ["byte-floor"];
  const floor = input.byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }

  // `new Function` parses without executing — it throws SyntaxError on bad
  // input, returns a Function on good. We never call the result.
  checks.push("function-parse");
  try {
    // eslint-disable-next-line no-new-func
    new Function(content);
  } catch (err) {
    return {
      status: "fail",
      reason: "invalid-js",
      details: err instanceof Error ? err.message : String(err),
      failedChecks: checks,
    };
  }
  return { status: "pass", checks };
}

// ─── Binary ──────────────────────────────────────────────────────────────

function validateBinary(input: StaticP0Input): StaticP0Result {
  const { content } = input;
  const checks: string[] = ["byte-floor"];
  const floor = input.byteFloor ?? BINARY_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) {
    return failBelowMinBytes(bytes, floor, checks);
  }
  return { status: "pass", checks };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function byteLength(s: string): number {
  // Browser/worker have TextEncoder; happy-dom test env has it too.
  return new TextEncoder().encode(s).byteLength;
}

function stripBom(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function snippet(s: string): string {
  return s.slice(0, 80).replace(/\s+/g, " ");
}

function failBelowMinBytes(bytes: number, floor: number, checks: string[]): StaticP0Fail {
  return {
    status: "fail",
    reason: "below-min-bytes",
    details: `Content is ${bytes} bytes; floor is ${floor}.`,
    failedChecks: checks,
  };
}

type BalanceResult = { ok: true } | { ok: false; detail: string };

/**
 * Lightweight check for paired major HTML tags. We do NOT try to be a real
 * parser — DOMParser does the heavy lifting. We pre-screen for the failure
 * mode where DOMParser silently auto-closes (HTML5 forgiving):
 *   - unclosed `<script>` / `<style>` (catastrophic at runtime).
 *   - `<html>` / `<head>` / `<body>` opened more than once.
 */
function checkBalancedHtmlTags(content: string): BalanceResult {
  for (const tag of ["script", "style"] as const) {
    const opens = countTagOpenings(content, tag);
    const closes = countTagClosings(content, tag);
    if (opens !== closes) {
      return {
        ok: false,
        detail: `Unbalanced <${tag}>: ${opens} open vs ${closes} close.`,
      };
    }
  }
  for (const tag of ["html", "head", "body"] as const) {
    const opens = countTagOpenings(content, tag);
    const closes = countTagClosings(content, tag);
    if (opens > 1 || closes > 1) {
      return {
        ok: false,
        detail: `Multiple <${tag}> tags found (open=${opens}, close=${closes}).`,
      };
    }
    if (opens > 0 && closes === 0) {
      return {
        ok: false,
        detail: `<${tag}> opened but never closed.`,
      };
    }
  }
  return { ok: true };
}

function countTagOpenings(content: string, tag: string): number {
  // <tag> or <tag attr=...> — boundary char after tag name.
  const re = new RegExp(`<${tag}(?:[\\s>/])`, "gi");
  return (content.match(re) || []).length;
}

function countTagClosings(content: string, tag: string): number {
  const re = new RegExp(`</${tag}\\s*>`, "gi");
  return (content.match(re) || []).length;
}

/**
 * Balanced-braces check for CSS — we count `{` vs `}` while ignoring those
 * inside string literals and comments. A real parser would also catch
 * `{prop: val` (missing `}`) on the inside, but most failure modes the
 * agent emits surface as raw imbalance.
 */
function checkBalancedBraces(content: string): BalanceResult {
  let opens = 0;
  let closes = 0;
  let i = 0;
  let inComment = false;
  let inString: '"' | "'" | null = null;
  while (i < content.length) {
    const ch = content[i]!;
    if (inComment) {
      if (ch === "*" && content[i + 1] === "/") {
        inComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\" && i + 1 < content.length) {
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      inComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "{") opens++;
    else if (ch === "}") closes++;
    i++;
  }
  if (opens !== closes) {
    return { ok: false, detail: `Unbalanced braces: ${opens} { vs ${closes} }.` };
  }
  return { ok: true };
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

function findDuplicateId(doc: Document): string | null {
  const seen = new Set<string>();
  // Use Array.from for happy-dom NodeList support without spread quirks.
  const all = Array.from(doc.querySelectorAll("[id]"));
  for (const el of all) {
    const id = (el as Element).getAttribute("id") || "";
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

// ─── UTF-8 sanity ───────────────────────────────────────────────────────

function isWellFormedUtf8(s: string): boolean {
  // ES2024 has String.prototype.isWellFormed; fall back to a manual check.
  type WF = (this: string) => boolean;
  const fn = (String.prototype as { isWellFormed?: WF }).isWellFormed;
  if (typeof fn === "function") {
    return fn.call(s);
  }
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
