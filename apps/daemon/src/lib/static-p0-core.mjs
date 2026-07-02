// static-p0-core.mjs — the ONE DOM-free Static P0 rule set (audit WS1
// `craft-net-shared-core`).
//
// Before this module there were two hand-mirrored implementations of the
// same gate: `src/runtime/static-p0.ts` (client, DOMParser-backed) and
// `apps/daemon/src/static-p0.mjs` (daemon, regex-only). Their header
// claimed parity but they had drifted: the daemon skipped the UTF-8
// well-formedness check on text artifacts, and an HTML document with no
// `<body>` tag (head-only — renders a blank screen) passed the daemon
// while failing the client. Every future edit had the same drift risk.
//
// Now BOTH sides consume this core:
//   · apps/daemon/src/static-p0.mjs — delegates entirely (the daemon has
//     no DOM library by design; the core is DOM-free).
//   · src/runtime/static-p0.ts — runs the core first, then layers the
//     strictly-ADDITIVE DOM extras (DOMParser parse error, strict body
//     emptiness) that only the browser/test environment can do.
// Verdict parity on the shared rule set is locked by the fixture-driven
// test `src/runtime/static-p0-parity.test.ts`.
//
// The core lives inside apps/daemon (not src/) so the daemon package
// stays self-contained if it's ever packed standalone; the client import
// crosses the workspace and Vite bundles it into the app at build time.
//
// Result shape: `{ ok: true, checks }` on pass, or
// `{ ok: false, reason, details, failedChecks }` on the first hard fail.
// Reason strings are shared verbatim with the client's
// `StaticP0FailReason` union — keep them in sync.

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
 * @typedef {Object} StaticP0CoreInput
 * @property {string} type MIME type from the `<artifact>` open tag.
 * @property {string} content Raw artifact body.
 * @property {number} [byteFloor] Optional per-call floor override.
 *
 * @typedef {{ ok: true, checks: string[] }} StaticP0CorePass
 * @typedef {{ ok: false, reason: string, details: string, failedChecks: string[] }} StaticP0CoreFail
 * @typedef {StaticP0CorePass | StaticP0CoreFail} StaticP0CoreResult
 */

/**
 * validateArtifactStaticP0Core — pure synchronous, DOM-free Static P0.
 *
 * @param {StaticP0CoreInput} input
 * @returns {StaticP0CoreResult}
 */
export function validateArtifactStaticP0Core({ type, content, byteFloor }) {
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
  return fail(
    "type-not-supported",
    `Static P0 does not know how to validate type "${type}". Add it to the type table or emit a supported type.`,
    ["type-table"],
  );
}

// ─── HTML ────────────────────────────────────────────────────────────────

function validateHtml(content, byteFloor) {
  const checks = [];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);
  checks.push("byte-floor");
  if (bytes < floor) return failBelowMin(bytes, floor, checks);

  checks.push("prelude");
  const trimmed = stripBom(content).replace(/^\s+/, "");
  if (!/^(<!doctype\b|<html\b|<svg\b|<\?xml\b)/i.test(trimmed)) {
    return fail(
      "invalid-html-prelude",
      "HTML must begin with <!DOCTYPE html>, <html>, <svg>, or <?xml. Got: " + snippet(trimmed),
      checks,
    );
  }

  checks.push("balanced-tags");
  const balance = checkBalancedHtmlTags(content);
  if (!balance.ok) return fail("unbalanced-tags", balance.detail, checks);

  checks.push("body-content");
  if (!hasRenderableBody(content)) {
    return fail(
      "empty-body",
      "Document has no renderable body content. The runtime would render a blank screen.",
      checks,
    );
  }

  checks.push("duplicate-ids");
  const dupId = findFirstDuplicateId(content);
  if (dupId) {
    return fail(
      "duplicate-id",
      `Duplicate id="${dupId}" — selectors and accessibility break.`,
      checks,
    );
  }

  return pass(checks);
}

/**
 * DOM-free body-content check. Two branches:
 *   1. Explicit `<body>` — inner content (comments stripped) must be
 *      non-empty. Same as both legacy implementations.
 *   2. NO `<body>` tag — emulate the HTML parser's implicit body: strip
 *      the doctype, comments, the `<head>` block, head-only metadata
 *      elements and the html/head/body wrapper tags themselves; whatever
 *      remains (any element, including `<script>`, or non-whitespace
 *      text) would be moved into the implicit body. A head-only document
 *      (`<html><head>…</head></html>`) renders a blank screen and FAILS —
 *      this is the parity fix: the old daemon regex silently passed it.
 */
function hasRenderableBody(content) {
  const noComments = content.replace(/<!--[\s\S]*?-->/g, "");
  const bodyMatch = noComments.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bodyMatch) return bodyMatch[1].trim().length > 0;
  const rest = stripBom(noComments)
    .replace(/<!doctype\b[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
    // Head-only metadata that the parser hoists into <head> even without
    // an explicit head block. <script> is NOT stripped — a script in the
    // implicit body is body content (it can document.write / mount an app).
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<(?:meta|link|base)\b[^>]*\/?>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  return rest.trim().length > 0;
}

// ─── SVG ─────────────────────────────────────────────────────────────────

function validateSvg(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("svg-root");
  const trimmed = stripBom(content).replace(/^\s+/, "");
  if (!/^(<\?xml\b[^>]*\?>\s*)?<svg\b/i.test(trimmed)) {
    return fail(
      "invalid-svg",
      "SVG must start with <svg> (optional <?xml> prolog allowed). Got: " + snippet(trimmed),
      checks,
    );
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
  const bytes = byteLength(content);
  if (bytes < floor) return failBelowMin(bytes, floor, checks);

  // Parity fix: the old daemon implementation skipped this check, so a
  // markdown artifact with a lone surrogate passed the daemon gate and
  // failed the client one.
  checks.push("utf8-roundtrip");
  if (!isWellFormedUtf8(content)) {
    return fail(
      "invalid-utf8",
      "Content contains lone surrogates or invalid UTF-8 sequences.",
      checks,
    );
  }

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
  const bytes = byteLength(content);
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
  const bytes = byteLength(content);
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  checks.push("balanced-braces");
  const balance = checkBalancedBraces(content);
  if (!balance.ok) return fail("invalid-css", balance.detail, checks);
  return pass(checks);
}

// ─── JS (goal-aware — audit WS1 `js-module-vs-script-fix`) ──────────────
//
// The old check was `new Function(content)`, which parses the content as
// a FUNCTION BODY — the wrong goal symbol both ways:
//   · false FAIL on ESM (`export const x` → SyntaxError even though the
//     artifact is a perfectly valid module);
//   · false PASS on top-level `return` (legal in a function body, illegal
//     at script/module top level — the artifact would crash on load).
//
// Neither browsers nor Node expose a synchronous parse-only API with the
// correct Script/Module goal (eval executes; vm.SourceTextModule needs a
// flag and doesn't exist in the browser), and a real parser (acorn) is
// not a dependency of this repo — so this is the robust heuristic built
// from the parsers we DO have:
//
//   1. Script goal: `new Function(content)` (parse-only, never called).
//   2. Top-level-return probe: re-parse inside a `class { static { … } }`
//      block — static initialization blocks REJECT `return` at their own
//      level while still allowing it inside nested functions, which is
//      exactly the script/module top-level rule. (Known trade-off: a
//      sloppy-mode script referencing bare `arguments` at top level would
//      also trip the block — we sniff the error message for "return" so
//      only genuine return-failures fail the gate.)
//   3. Module goal (top-level `import`/`export` detected): neutralize the
//      module-only syntax (strip static imports, rewrite `export` heads,
//      alias `import.meta`) and parse the result as an ASYNC function
//      body so top-level `await` — valid in modules — still parses.
//
// Trade-offs documented in static-p0.test.ts: exotic module syntax
// (string import aliases like `import { "x" as y }`) may still false-fail;
// a module using BOTH top-level await and top-level return may false-pass
// (the return probe is skipped when `await` is present because static
// blocks reject await).

const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor;

function validateJs(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? DEFAULT_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) return failBelowMin(bytes, floor, checks);

  checks.push("js-parse");
  const verdict = parseJsGoalAware(content);
  if (!verdict.ok) {
    return fail("invalid-js", verdict.error, checks);
  }
  return pass(checks);
}

/**
 * Goal-aware parse. Exported for direct unit testing.
 * @param {string} content
 * @returns {{ ok: true, goal: "script" | "module" } | { ok: false, error: string }}
 */
export function parseJsGoalAware(content) {
  // 1. Script goal.
  let scriptError = null;
  try {
    // eslint-disable-next-line no-new-func
    new Function(content);
  } catch (err) {
    scriptError = err && err.message ? err.message : String(err);
  }

  if (scriptError === null) {
    // Parses as a function body. Catch the top-level-return false pass:
    // a class static block rejects `return` at its own nesting level.
    if (/\breturn\b/.test(content)) {
      try {
        // eslint-disable-next-line no-new-func
        new Function(`class __DfProbe { static { ${content} \n } }`);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (/return/i.test(msg)) {
          return { ok: false, error: `Illegal top-level return statement: ${msg}` };
        }
        // Any other static-block-only complaint (e.g. bare `arguments`)
        // is not a script error — accept the plain parse.
      }
    }
    return { ok: true, goal: "script" };
  }

  // 2. Module goal — only when the source actually looks like a module.
  if (looksLikeModuleSource(content)) {
    const transformed = neutralizeModuleSyntax(content);
    try {
      new AsyncFunctionCtor(transformed);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      return { ok: false, error: `Module parse failed after import/export rewrite: ${msg}` };
    }
    // Top-level return is illegal in modules too. The static-block probe
    // rejects `await`, so it only runs when the module has none.
    if (/\breturn\b/.test(transformed) && !/\bawait\b/.test(transformed)) {
      try {
        // eslint-disable-next-line no-new-func
        new Function(`class __DfProbe { static { ${transformed} \n } }`);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (/return/i.test(msg)) {
          return { ok: false, error: `Illegal top-level return statement: ${msg}` };
        }
      }
    }
    return { ok: true, goal: "module" };
  }

  return { ok: false, error: scriptError };
}

/** Crude comment/string removal — good enough for GOAL DETECTION only
 *  (never used to produce parseable output). */
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** True when the source has top-level `import`/`export` STATEMENTS
 *  (dynamic `import(…)` doesn't count — it's valid in scripts). */
function looksLikeModuleSource(src) {
  const scan = stripCommentsAndStrings(src);
  if (
    /(^|[;{}\n])\s*export\s+(default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)/.test(
      scan,
    )
  ) {
    return true;
  }
  if (/(^|[;{}\n])\s*import\s+(?!\()/.test(scan) || /(^|[;{}\n])\s*import\s*["']/.test(scan)) {
    return true;
  }
  if (/\bimport\s*\.\s*meta\b/.test(scan)) return true;
  return false;
}

/** Rewrite module-only syntax into script-parseable equivalents.
 *  Parse-only transform — the output is never executed. */
function neutralizeModuleSyntax(src) {
  return (
    src
      // import.meta.url → __dfImportMeta__.url (identifier access parses).
      .replace(/\bimport\s*\.\s*meta\b/g, "__dfImportMeta__")
      // Static import declarations (incl. multi-line named imports): from
      // the `import` keyword non-greedily through the module-specifier
      // string literal + optional semicolon.
      .replace(/(^|[\n;{}()])(\s*)import\b(?![\s]*\()[\s\S]*?(["'][^"'\n]*["'])\s*;?/g, "$1$2;")
      // export { a, b } [from "x"];  /  export * from "x";
      .replace(/(^|[\n;{}])(\s*)export\s*\{[^}]*\}(\s*from\s*["'][^"'\n]*["'])?\s*;?/g, "$1$2;")
      .replace(/(^|[\n;{}])(\s*)export\s*\*[^;\n]*;?/g, "$1$2;")
      // export default <expr/decl> → void <expr/decl> (function/class
      // declarations become expressions after `void` — still parse).
      .replace(/(^|[\n;{}])(\s*)export\s+default\s+/g, "$1$2void ")
      // export const/let/var/function/class/async → drop the keyword.
      .replace(/(^|[\n;{}])(\s*)export\s+(?=(async\s+)?(function|class|const|let|var)\b)/g, "$1$2")
  );
}

// ─── Binary ──────────────────────────────────────────────────────────────

function validateBinary(content, byteFloor) {
  const checks = ["byte-floor"];
  const floor = byteFloor ?? BINARY_BYTE_FLOOR;
  const bytes = byteLength(content);
  if (bytes < floor) return failBelowMin(bytes, floor, checks);
  return pass(checks);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function byteLength(s) {
  // TextEncoder exists in browsers, workers, happy-dom AND Node ≥ 11 —
  // one code path for both consumers (Buffer would be daemon-only).
  return new TextEncoder().encode(s).byteLength;
}

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

function isWellFormedUtf8(s) {
  if (typeof s.isWellFormed === "function") return s.isWellFormed();
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

/**
 * Heuristic balance check for HTML major tags. Catches the common failure
 * modes the agent emits when it truncates a script or opens body twice.
 * NOT a real parser — the client's DOMParser extra is.
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
      return {
        ok: false,
        detail: `Multiple <${tag}> tags found (open=${opens}, close=${closes}).`,
      };
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
 * Find the first duplicate id="…" in the document. Regex over quoted AND
 * unquoted id attributes, ignoring <script>/<style> bodies and comments so
 * an embedded JS string `"id=root"` doesn't false-positive. Unquoted
 * support (`id=root`) is part of the parity fix: the client's old
 * DOM-based detector saw those, the daemon's quoted-only regex didn't.
 */
function findFirstDuplicateId(content) {
  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const re = /\sid\s*=\s*("([^"]+)"|'([^']+)'|([^\s"'>/]+))/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const id = m[2] || m[3] || m[4] || "";
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * CSS brace balance, ignoring strings and comments.
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
