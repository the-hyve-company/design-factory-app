// static-p0.mjs — daemon-side Static P0 gate.
//
// The SERVER half of the type-aware Static P0 gate. The TypeScript
// canonical version lives at `src/runtime/static-p0.ts` and is used
// by the client pipeline and tests. This .mjs companion runs inside
// the daemon's `writeArtifactSafely()` BEFORE the atomic rename, so
// a broken artifact never replaces a working one.
//
// Why two implementations of the same rules:
//   - apps/daemon has zero DOM deps (no linkedom, no jsdom, no happy-dom).
//     Adding one would bloat the install footprint of a binary that
//     already has to bind to localhost:1421 fast.
//   - the client side has a real DOMParser via happy-dom (test) and the
//     browser (prod), so it can do strict parse + duplicate-id detection.
//   - the server side does what it can with regex/state-machine checks
//     against the SAME rule set: byte-floor, prelude, balanced major
//     tags, JSON.parse, balanced braces, `new Function` parse.
//
// Both implementations agree on `failureReason` strings so the done
// report is consistent regardless of which gate fired first.
//
// Returns `{ ok: true, checks: [...] }` on pass, or
// `{ ok: false, reason, details, failedChecks: [...] }` on fail.

import { Buffer } from "node:buffer";

export const DEFAULT_BYTE_FLOOR = 200;
export const JSON_BYTE_FLOOR = 2;
export const BINARY_BYTE_FLOOR = 16;

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

/**
 * @typedef {Object} StaticP0Input
 * @property {string} type
 * @property {string} content
 * @property {number} [byteFloor]
 *
 * @typedef {Object} StaticP0Pass
 * @property {true} ok
 * @property {string[]} checks
 *
 * @typedef {Object} StaticP0Fail
 * @property {false} ok
 * @property {string} reason
 * @property {string} details
 * @property {string[]} failedChecks
 *
 * @returns {StaticP0Pass|StaticP0Fail}
 */
export function validateArtifactStaticP0Full({ type, content, byteFloor }) {
  if (typeof content !== "string") {
    return fail("below-min-bytes", "content must be a string", ["content-type"]);
  }
  if (HTML_TYPES.has(type)) return validateHtml(content, byteFloor);
  if (SVG_TYPES.has(type)) return validateSvg(content, byteFloor);
  if (JSON_TYPES.has(type)) return validateJson(content, byteFloor);
  if (CSS_TYPES.has(type)) return validateCss(content, byteFloor);
  if (JS_TYPES.has(type)) return validateJs(content, byteFloor);
  if (TEXT_TYPES.has(type)) return validateText(content, byteFloor);
  if (BINARY_TYPES.has(type)) return validateBinary(content, byteFloor);
  return fail("type-not-supported", `Static P0 does not know how to validate type "${type}".`, [
    "type-table",
  ]);
}

// ─── HTML ────────────────────────────────────────────────────────────────

function validateHtml(content, byteFloor) {
  const checks = [];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  checks.push("byte-floor");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);

  checks.push("prelude");
  const trimmed = stripBom(content).replace(/^\s+/, "");
  if (!/^(<!doctype\b|<html\b|<svg\b|<\?xml\b)/i.test(trimmed)) {
    return fail("invalid-html-prelude", `Got: ${snippet(trimmed)}`, checks);
  }

  checks.push("balanced-tags");
  const balance = checkBalancedHtmlTags(content);
  if (!balance.ok) return fail("unbalanced-tags", balance.detail, checks);

  checks.push("body-content");
  // No DOMParser server-side — heuristic: there must be SOMETHING between
  // <body> and </body> after stripping comments and whitespace. Client-side
  // Static P0 does the strict check via DOMParser.body.children.length.
  const bodyMatch = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bodyMatch) {
    const inner = bodyMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();
    if (inner.length === 0) {
      return fail("empty-body", "Document <body> is empty after comment strip.", checks);
    }
  }

  checks.push("duplicate-ids");
  const dupId = findFirstDuplicateId(content);
  if (dupId) {
    return fail("duplicate-id", `Duplicate id="${dupId}".`, checks);
  }

  return pass(checks);
}

// ─── SVG ─────────────────────────────────────────────────────────────────

function validateSvg(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("svg-root");
  const trimmed = stripBom(content).replace(/^\s+/, "");
  if (!/^(<\?xml\b[^>]*\?>\s*)?<svg\b/i.test(trimmed)) {
    return fail("invalid-svg", `Got: ${snippet(trimmed)}`, checks);
  }
  checks.push("svg-close");
  if (!/<\/svg\s*>/i.test(content)) {
    return fail("invalid-svg", "Missing </svg> close tag.", checks);
  }
  return pass(checks);
}

// ─── Markdown / Plain text ──────────────────────────────────────────────

function validateText(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("non-whitespace");
  if (content.trim().length === 0) {
    return fail("empty-body", "Document is whitespace-only.", checks);
  }
  return pass(checks);
}

// ─── JSON ────────────────────────────────────────────────────────────────

function validateJson(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? JSON_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("json-parse");
  try {
    JSON.parse(content);
  } catch (err) {
    return fail("invalid-json", err && err.message ? err.message : String(err), checks);
  }
  return pass(checks);
}

// ─── CSS ─────────────────────────────────────────────────────────────────

function validateCss(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("balanced-braces");
  const balance = checkBalancedBraces(content);
  if (!balance.ok) return fail("invalid-css", balance.detail, checks);
  return pass(checks);
}

// ─── JS ──────────────────────────────────────────────────────────────────

function validateJs(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("function-parse");
  try {
    // eslint-disable-next-line no-new-func
    new Function(content);
  } catch (err) {
    return fail("invalid-js", err && err.message ? err.message : String(err), checks);
  }
  return pass(checks);
}

// ─── Binary ──────────────────────────────────────────────────────────────

function validateBinary(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? BINARY_BYTE_FLOOR;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  return pass(checks);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function stripBom(s) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function snippet(s) {
  return String(s).slice(0, 80).replace(/\s+/g, " ");
}

function pass(checks) {
  return { ok: true, checks };
}

function fail(reason, details, failedChecks) {
  return { ok: false, reason, details, failedChecks };
}

function failBelowMin(bytes, floor, checks) {
  return fail("below-min-bytes", `Content is ${bytes} bytes; floor is ${floor}.`, checks);
}

/**
 * Heuristic balance check for HTML major tags. Catches the common failure
 * modes the agent emits when it truncates a script or opens body twice.
 * NOT a real parser — DOMParser on the client is.
 */
function checkBalancedHtmlTags(content) {
  for (const tag of ["script", "style"]) {
    const opens = countTagOpenings(content, tag);
    const closes = countTagClosings(content, tag);
    if (opens !== closes) {
      return { ok: false, detail: `Unbalanced <${tag}>: ${opens} open vs ${closes} close.` };
    }
  }
  for (const tag of ["html", "head", "body"]) {
    const opens = countTagOpenings(content, tag);
    const closes = countTagClosings(content, tag);
    if (opens > 1 || closes > 1) {
      return { ok: false, detail: `Multiple <${tag}> tags (open=${opens}, close=${closes}).` };
    }
    if (opens > 0 && closes === 0) {
      return { ok: false, detail: `<${tag}> opened but never closed.` };
    }
  }
  return { ok: true };
}

function countTagOpenings(content, tag) {
  const re = new RegExp(`<${tag}(?:[\\s>/])`, "gi");
  return (content.match(re) || []).length;
}

function countTagClosings(content, tag) {
  const re = new RegExp(`</${tag}\\s*>`, "gi");
  return (content.match(re) || []).length;
}

/**
 * Find the first duplicate id="..." in the document. We use a regex over
 * `id="..."` / `id='...'` and ignore ids inside <script>/<style> bodies so
 * an embedded JS string `"id=root"` doesn't false-positive.
 */
function findFirstDuplicateId(content) {
  // Strip script and style bodies (regex-only since we don't parse).
  const stripped = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const re = /\sid\s*=\s*("([^"]+)"|'([^']+)')/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const id = m[2] || m[3] || "";
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * CSS brace balance, ignoring strings and /* … *\/ comments.
 */
function checkBalancedBraces(content) {
  let opens = 0,
    closes = 0,
    i = 0;
  let inComment = false;
  let inString = null;
  while (i < content.length) {
    const ch = content[i];
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
      if (ch === inString) inString = null;
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
