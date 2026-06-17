// static-p0.test.mjs — Server-side Static P0 (spec v0.3.4
// §deliverable 1). Mirrors the TypeScript test surface in
// `src/runtime/static-p0.test.ts` so both implementations of the same
// rule set stay in sync.

import { describe, it, expect } from "vitest";
import { validateArtifactStaticP0Full, DEFAULT_BYTE_FLOOR } from "./static-p0.mjs";

const HTML_BIG =
  "<!DOCTYPE html><html><head><title>x</title></head><body><h1>Hello</h1>" +
  "<p>" +
  "x".repeat(220) +
  "</p></body></html>";

describe("validateArtifactStaticP0Full — HTML", () => {
  it("passes for a well-formed document above the floor", () => {
    const r = validateArtifactStaticP0Full({ type: "text/html", content: HTML_BIG });
    expect(r.ok).toBe(true);
    expect(r.checks).toContain("byte-floor");
    expect(r.checks).toContain("body-content");
  });

  it("fails below-min-bytes for too-short HTML", () => {
    const r = validateArtifactStaticP0Full({
      type: "text/html",
      content: "<!DOCTYPE html><html><body>x</body></html>",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("below-min-bytes");
    expect(r.details).toContain(`floor is ${DEFAULT_BYTE_FLOOR}`);
  });

  it("fails invalid-html-prelude when content starts with prose", () => {
    const prose = "Here is your HTML, sure! " + "x".repeat(220);
    const r = validateArtifactStaticP0Full({ type: "text/html", content: prose });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-html-prelude");
  });

  it("fails empty-body when body is empty after comment strip", () => {
    const html =
      "<!DOCTYPE html><html><head><title>x</title></head><body><!-- " +
      "x".repeat(220) +
      " --></body></html>";
    const r = validateArtifactStaticP0Full({ type: "text/html", content: html });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty-body");
  });

  it("fails duplicate-id when two elements share an id", () => {
    const html =
      "<!DOCTYPE html><html><body>" +
      `<div id="root">${"x".repeat(120)}</div><div id="root">y</div>` +
      "</body></html>";
    const r = validateArtifactStaticP0Full({ type: "text/html", content: html });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("duplicate-id");
    expect(r.details).toContain('id="root"');
  });

  it("ignores ids inside <script> body when checking duplicates", () => {
    const html =
      '<!DOCTYPE html><html><body><div id="root">' +
      "x".repeat(120) +
      "</div>" +
      `<script>const tag='id="root"';</script>` +
      "</body></html>";
    const r = validateArtifactStaticP0Full({ type: "text/html", content: html });
    expect(r.ok).toBe(true);
  });

  it("fails unbalanced-tags when <script> never closes", () => {
    const html =
      "<!DOCTYPE html><html><body><h1>x</h1><script>boom(" + "x".repeat(220) + "</body></html>";
    const r = validateArtifactStaticP0Full({ type: "text/html", content: html });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unbalanced-tags");
  });

  it("respects byteFloor override", () => {
    const small = "<!DOCTYPE html><html><body><p>hi</p></body></html>";
    const r = validateArtifactStaticP0Full({ type: "text/html", content: small, byteFloor: 10 });
    expect(r.ok).toBe(true);
  });
});

describe("validateArtifactStaticP0Full — SVG", () => {
  it("passes for a real SVG document", () => {
    const svg =
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">` +
      `<rect width="400" height="400" fill="#fafafa"/>` +
      `<text x="20" y="40">${"x".repeat(80)}</text>` +
      `</svg>`;
    const r = validateArtifactStaticP0Full({ type: "image/svg+xml", content: svg });
    expect(r.ok).toBe(true);
  });

  it("fails when payload doesn't begin with <svg>", () => {
    const notSvg = "<html>" + "x".repeat(220) + "</html>";
    const r = validateArtifactStaticP0Full({ type: "image/svg+xml", content: notSvg });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-svg");
  });

  it("fails on missing </svg>", () => {
    const broken =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/>` + "x".repeat(220);
    const r = validateArtifactStaticP0Full({ type: "image/svg+xml", content: broken });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-svg");
  });
});

describe("validateArtifactStaticP0Full — markdown / text", () => {
  it("passes for real markdown above the floor", () => {
    const md = "# Heading\n\nParagraph " + "x".repeat(220) + "\n";
    const r = validateArtifactStaticP0Full({ type: "text/markdown", content: md });
    expect(r.ok).toBe(true);
  });

  it("fails empty-body when content is whitespace only", () => {
    const md = " ".repeat(220);
    const r = validateArtifactStaticP0Full({ type: "text/markdown", content: md });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty-body");
  });
});

describe("validateArtifactStaticP0Full — JSON", () => {
  it("passes on tiny valid JSON object", () => {
    const r = validateArtifactStaticP0Full({ type: "application/json", content: "{}" });
    expect(r.ok).toBe(true);
  });

  it("fails invalid-json on syntax error", () => {
    const r = validateArtifactStaticP0Full({
      type: "application/json",
      content: "{ not: real json }",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-json");
  });
});

describe("validateArtifactStaticP0Full — CSS", () => {
  it("passes on balanced CSS", () => {
    const css = "body { color: red; } " + "/* " + "x".repeat(200) + " */";
    const r = validateArtifactStaticP0Full({ type: "text/css", content: css });
    expect(r.ok).toBe(true);
  });

  it("fails invalid-css on unbalanced braces", () => {
    const css = ".x { color: red; " + "x".repeat(200);
    const r = validateArtifactStaticP0Full({ type: "text/css", content: css });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-css");
  });

  it("ignores braces inside strings/comments", () => {
    const css =
      `.x { content: "}"; } /* } } */ .y { color: red; }` + " /* " + "x".repeat(200) + " */";
    const r = validateArtifactStaticP0Full({ type: "text/css", content: css });
    expect(r.ok).toBe(true);
  });
});

describe("validateArtifactStaticP0Full — JavaScript", () => {
  it("passes for valid JS above the floor", () => {
    const js = "const greet = (n) => `hi, ${n}`;\n// " + "x".repeat(220) + "\n";
    const r = validateArtifactStaticP0Full({ type: "application/javascript", content: js });
    expect(r.ok).toBe(true);
  });

  it("fails invalid-js on syntax error", () => {
    const js = "const x = ((( ; " + "x".repeat(220);
    const r = validateArtifactStaticP0Full({ type: "application/javascript", content: js });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-js");
  });
});

describe("validateArtifactStaticP0Full — binary types", () => {
  it("passes binary content at byte floor", () => {
    const blob = "x".repeat(32);
    const r = validateArtifactStaticP0Full({ type: "image/png", content: blob });
    expect(r.ok).toBe(true);
  });

  it("fails below-min-bytes on near-empty binary payloads", () => {
    const r = validateArtifactStaticP0Full({ type: "image/png", content: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("below-min-bytes");
  });
});

describe("validateArtifactStaticP0Full — unknown types", () => {
  it("rejects unknown MIME types", () => {
    const r = validateArtifactStaticP0Full({
      type: "application/x-custom-thing",
      content: "x".repeat(300),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("type-not-supported");
  });
});
