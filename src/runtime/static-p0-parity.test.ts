// static-p0-parity.test.ts — fixture-driven proof that the client gate
// (src/runtime/static-p0.ts) and the daemon gate
// (apps/daemon/src/static-p0.mjs) return the IDENTICAL verdict + reason
// for the shared rule set (audit WS1 `craft-net-shared-core`).
//
// Both sides now delegate to apps/daemon/src/lib/static-p0-core.mjs, so
// parity holds by construction — this test is the regression lock that
// keeps it true if either side is ever re-forked. Fixtures deliberately
// include the two divergences that motivated the refactor:
//   · UTF-8 lone surrogate in markdown (old daemon PASSED, client failed);
//   · head-only HTML with no <body> tag (old daemon PASSED, client failed).
//
// The client layers DOM extras (DOMParser parse) ON TOP of the core —
// those are strictly additive strictness and are exercised by fixtures
// where the DOM verdict agrees with the core's. Client-only strictness
// beyond the shared set (e.g. XML-malformed SVG that the daemon's regex
// can't see) is covered in static-p0.test.ts, not here.

import { describe, expect, it } from "vitest";
import { validateArtifactStaticP0 } from "./static-p0";
import { validateArtifactStaticP0Full } from "../../apps/daemon/src/static-p0.mjs";

interface ParityFixture {
  name: string;
  type: string;
  content: string;
  byteFloor?: number;
  expect: { ok: true } | { ok: false; reason: string };
}

const PAD = "x".repeat(220);

const FIXTURES: ParityFixture[] = [
  // ── HTML ──────────────────────────────────────────────────────────────
  {
    name: "html: well-formed document passes",
    type: "text/html",
    content: `<!DOCTYPE html><html><head><title>t</title></head><body><h1>Hi</h1><p>${PAD}</p></body></html>`,
    expect: { ok: true },
  },
  {
    name: "html: below byte floor",
    type: "text/html",
    content: "<!DOCTYPE html><html><body>x</body></html>",
    expect: { ok: false, reason: "below-min-bytes" },
  },
  {
    name: "html: prose prelude",
    type: "text/html",
    content: "Sure! Here's your page: " + PAD,
    expect: { ok: false, reason: "invalid-html-prelude" },
  },
  {
    name: "html: unclosed script",
    type: "text/html",
    content: `<!DOCTYPE html><html><body><h1>x</h1><script>boom(${PAD}</body></html>`,
    expect: { ok: false, reason: "unbalanced-tags" },
  },
  {
    name: "html: explicit empty body (comment only)",
    type: "text/html",
    content: `<!DOCTYPE html><html><head><title>x</title></head><body><!-- ${PAD} --></body></html>`,
    expect: { ok: false, reason: "empty-body" },
  },
  {
    // THE parity fix: head-only document, no <body> tag at all. The old
    // daemon regex only checked inside <body>…</body> and passed this.
    name: "html: head-only document with no <body> tag",
    type: "text/html",
    content: `<!DOCTYPE html><html><head><title>x</title><style>body{color:#111}${PAD}</style></head></html>`,
    expect: { ok: false, reason: "empty-body" },
  },
  {
    name: "html: implicit body content without <body> tag passes",
    type: "text/html",
    content: `<!DOCTYPE html><html><head><title>x</title></head><div><p>${PAD}</p></div></html>`,
    expect: { ok: true },
  },
  {
    name: "html: duplicate quoted ids",
    type: "text/html",
    content: `<!DOCTYPE html><html><body><div id="root">${PAD}</div><div id="root">y</div></body></html>`,
    expect: { ok: false, reason: "duplicate-id" },
  },
  {
    // Unquoted-id parity: the client's old DOM detector caught these, the
    // daemon's quoted-only regex didn't. The core regex covers both.
    name: "html: duplicate unquoted ids",
    type: "text/html",
    content: `<!DOCTYPE html><html><body><div id=root>${PAD}</div><div id=root>y</div></body></html>`,
    expect: { ok: false, reason: "duplicate-id" },
  },
  {
    name: "html: id strings inside <script> don't count",
    type: "text/html",
    content: `<!DOCTYPE html><html><body><div id="root">${PAD}</div><script>const t='id="root"';</script></body></html>`,
    expect: { ok: true },
  },
  // ── SVG ───────────────────────────────────────────────────────────────
  {
    name: "svg: valid document passes",
    type: "image/svg+xml",
    content: `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#fafafa"/><text x="20" y="40">${"y".repeat(80)}</text></svg>`,
    expect: { ok: true },
  },
  {
    name: "svg: not an svg root",
    type: "image/svg+xml",
    content: `<html>${PAD}</html>`,
    expect: { ok: false, reason: "invalid-svg" },
  },
  {
    name: "svg: missing </svg> close",
    type: "image/svg+xml",
    content: `<svg xmlns="http://www.w3.org/2000/svg"><rect/>${PAD}`,
    expect: { ok: false, reason: "invalid-svg" },
  },
  // ── Markdown / text ───────────────────────────────────────────────────
  {
    name: "markdown: real document passes",
    type: "text/markdown",
    content: `# Title\n\nBody ${PAD}\n`,
    expect: { ok: true },
  },
  {
    name: "markdown: whitespace-only",
    type: "text/markdown",
    content: " ".repeat(220),
    expect: { ok: false, reason: "empty-body" },
  },
  {
    // THE other parity fix: the old daemon skipped UTF-8 well-formedness.
    name: "markdown: lone surrogate fails on both sides",
    type: "text/markdown",
    content: `# Title\n\nbroken: ${"\ud800"} ${PAD}`,
    expect: { ok: false, reason: "invalid-utf8" },
  },
  // ── JSON ──────────────────────────────────────────────────────────────
  {
    name: "json: tiny valid object passes (relaxed floor)",
    type: "application/json",
    content: "{}",
    expect: { ok: true },
  },
  {
    name: "json: syntax error",
    type: "application/json",
    content: "{ not: real json }",
    expect: { ok: false, reason: "invalid-json" },
  },
  // ── CSS ───────────────────────────────────────────────────────────────
  {
    name: "css: balanced passes",
    type: "text/css",
    content: `body { color: #111; } /* ${PAD} */`,
    expect: { ok: true },
  },
  {
    name: "css: unbalanced braces",
    type: "text/css",
    content: `.x { color: red; ${PAD}`,
    expect: { ok: false, reason: "invalid-css" },
  },
  // ── JS (goal-aware — see js-module-vs-script-fix fixtures) ───────────
  {
    name: "js: valid script passes",
    type: "application/javascript",
    content: `const greet = (n) => "hi " + n;\n// ${PAD}\n`,
    expect: { ok: true },
  },
  {
    name: "js: ESM export passes on both sides",
    type: "application/javascript",
    content: `export const answer = 42;\nexport default function main() { return answer; }\n// ${PAD}\n`,
    expect: { ok: true },
  },
  {
    name: "js: top-level return fails on both sides",
    type: "application/javascript",
    content: `const x = 1;\nif (x) return;\nconsole.log(x);\n// ${PAD}\n`,
    expect: { ok: false, reason: "invalid-js" },
  },
  {
    name: "js: syntax error",
    type: "application/javascript",
    content: `const x = ((( ; ${PAD}`,
    expect: { ok: false, reason: "invalid-js" },
  },
  // ── Binary / unknown ──────────────────────────────────────────────────
  {
    name: "binary: png above floor passes",
    type: "image/png",
    content: "x".repeat(32),
    expect: { ok: true },
  },
  {
    name: "binary: near-empty fails",
    type: "image/png",
    content: "x",
    expect: { ok: false, reason: "below-min-bytes" },
  },
  {
    name: "unknown type rejected",
    type: "application/x-custom-thing",
    content: "x".repeat(300),
    expect: { ok: false, reason: "type-not-supported" },
  },
  // ── byteFloor override travels identically ───────────────────────────
  {
    name: "html: byteFloor override respected",
    type: "text/html",
    content: "<!DOCTYPE html><html><body><p>hi</p></body></html>",
    byteFloor: 10,
    expect: { ok: true },
  },
];

describe("static-p0 parity — client and daemon agree on the shared rule set", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const client = validateArtifactStaticP0({
        finalPath: "projects/parity/index.html",
        contentHash: "sha256:test",
        type: f.type,
        content: f.content,
        ...(f.byteFloor !== undefined ? { byteFloor: f.byteFloor } : {}),
      });
      const daemon = validateArtifactStaticP0Full({
        type: f.type,
        content: f.content,
        ...(f.byteFloor !== undefined ? { byteFloor: f.byteFloor } : {}),
      });

      // 1. The two sides agree with each other…
      expect(client.status === "pass").toBe(daemon.ok);
      if (client.status === "fail" && daemon.ok === false) {
        expect(client.reason).toBe(daemon.reason);
      }

      // 2. …and with the fixture's expectation.
      expect(daemon.ok).toBe(f.expect.ok);
      if (f.expect.ok === false && daemon.ok === false) {
        expect(daemon.reason).toBe(f.expect.reason);
      }
    });
  }
});
