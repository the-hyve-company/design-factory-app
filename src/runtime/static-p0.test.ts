import { describe, it, expect } from "vitest";
import { validateArtifactStaticP0, DEFAULT_BYTE_FLOOR, type StaticP0Input } from "./static-p0";

const HASH = "deadbeef".repeat(8);

function input(
  overrides: Partial<StaticP0Input> & Pick<StaticP0Input, "type" | "content">,
): StaticP0Input {
  return {
    finalPath: "/abs/projects/x/x.html",
    contentHash: HASH,
    ...overrides,
  };
}

const VALID_HTML =
  "<!DOCTYPE html><html><head><title>x</title></head><body><h1>Hello</h1>" +
  "<p>" +
  "x".repeat(220) +
  "</p></body></html>";

describe("validateArtifactStaticP0 — HTML", () => {
  it("passes for a well-formed document above the floor", () => {
    const r = validateArtifactStaticP0(input({ type: "text/html", content: VALID_HTML }));
    expect(r.status).toBe("pass");
    if (r.status === "pass") {
      expect(r.checks).toContain("byte-floor");
      expect(r.checks).toContain("dom-parse");
      expect(r.checks).toContain("body-content");
    }
  });

  it("fails below-min-bytes when content is too short", () => {
    const r = validateArtifactStaticP0(
      input({ type: "text/html", content: "<!DOCTYPE html><html><body>x</body></html>" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") {
      expect(r.reason).toBe("below-min-bytes");
      expect(r.details).toContain(`floor is ${DEFAULT_BYTE_FLOOR}`);
    }
  });

  it("respects byteFloor override (skill-specific)", () => {
    const small = "<!DOCTYPE html><html><body><p>hi</p></body></html>";
    const r = validateArtifactStaticP0(input({ type: "text/html", content: small, byteFloor: 10 }));
    expect(r.status).toBe("pass");
  });

  it("fails invalid-html-prelude when content starts with prose", () => {
    const prose = "Sure! Here's the HTML:" + " text".repeat(120);
    const r = validateArtifactStaticP0(input({ type: "text/html", content: prose }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-html-prelude");
  });

  it("fails empty-body when body has no children and no text", () => {
    const html =
      "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>" +
      // Push above byte floor without putting anything in <body>.
      "<!--" +
      "x".repeat(200) +
      "-->";
    const r = validateArtifactStaticP0(input({ type: "text/html", content: html }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("empty-body");
  });

  it("fails duplicate-id when two elements share an id", () => {
    const html =
      "<!DOCTYPE html><html><body>" +
      `<div id="root">${"x".repeat(120)}</div>` +
      `<div id="root">y</div>` +
      "</body></html>";
    const r = validateArtifactStaticP0(input({ type: "text/html", content: html }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") {
      expect(r.reason).toBe("duplicate-id");
      expect(r.details).toContain('id="root"');
    }
  });

  it("fails unbalanced-tags when <script> never closes", () => {
    const html =
      "<!DOCTYPE html><html><body><h1>x</h1>" +
      "<script>console.log('hi')" +
      "x".repeat(200) +
      "</body></html>";
    const r = validateArtifactStaticP0(input({ type: "text/html", content: html }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("unbalanced-tags");
  });

  it("fails unbalanced-tags when <body> appears twice", () => {
    const html =
      "<!DOCTYPE html><html><body><p>" + "x".repeat(220) + "</p></body><body>oops</body></html>";
    const r = validateArtifactStaticP0(input({ type: "text/html", content: html }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("unbalanced-tags");
  });
});

describe("validateArtifactStaticP0 — SVG", () => {
  it("passes for a real SVG document", () => {
    const svg =
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">` +
      `<rect width="400" height="400" fill="${"#fafafa"}" />` +
      `<text x="20" y="40">${"x".repeat(80)}</text>` +
      `</svg>`;
    const r = validateArtifactStaticP0(
      input({ type: "image/svg+xml", content: svg, finalPath: "/x.svg" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails when payload doesn't begin with <svg>", () => {
    const notSvg = "<html>" + "x".repeat(220) + "</html>";
    const r = validateArtifactStaticP0(
      input({ type: "image/svg+xml", content: notSvg, finalPath: "/x.svg" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-svg");
  });
});

describe("validateArtifactStaticP0 — markdown / text", () => {
  it("passes for a real markdown document", () => {
    const md = "# Heading\n\nParagraph " + "x".repeat(220) + "\n";
    const r = validateArtifactStaticP0(
      input({ type: "text/markdown", content: md, finalPath: "/x.md" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails empty-body when content is whitespace only above the floor", () => {
    const md = " ".repeat(220);
    const r = validateArtifactStaticP0(
      input({ type: "text/markdown", content: md, finalPath: "/x.md" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("empty-body");
  });

  it("fails invalid-utf8 on lone surrogate", () => {
    const bad = "header\n" + String.fromCharCode(0xd800) + " body " + "x".repeat(220);
    const r = validateArtifactStaticP0(
      input({ type: "text/markdown", content: bad, finalPath: "/x.md" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-utf8");
  });
});

describe("validateArtifactStaticP0 — JSON", () => {
  it("passes on a tiny valid JSON object (relaxed floor)", () => {
    const r = validateArtifactStaticP0(
      input({ type: "application/json", content: "{}", finalPath: "/x.json" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails invalid-json on syntax error", () => {
    const r = validateArtifactStaticP0(
      input({ type: "application/json", content: "{ not: real json }", finalPath: "/x.json" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-json");
  });
});

describe("validateArtifactStaticP0 — CSS", () => {
  it("passes on balanced CSS", () => {
    const css = "body { color: red; } " + "/* " + "x".repeat(200) + " */";
    const r = validateArtifactStaticP0(
      input({ type: "text/css", content: css, finalPath: "/x.css" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails invalid-css on unbalanced braces", () => {
    const css = ".x { color: red; " + "x".repeat(200);
    const r = validateArtifactStaticP0(
      input({ type: "text/css", content: css, finalPath: "/x.css" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-css");
  });

  it("ignores braces inside strings/comments when counting", () => {
    const css =
      `.x { content: "}"; } ` +
      `/* } } } */ ` +
      `.y { color: ${"red"}; } ` +
      "/* " +
      "x".repeat(200) +
      " */";
    const r = validateArtifactStaticP0(
      input({ type: "text/css", content: css, finalPath: "/x.css" }),
    );
    expect(r.status).toBe("pass");
  });
});

describe("validateArtifactStaticP0 — JavaScript", () => {
  it("passes for valid JS above the floor", () => {
    const js = "const greet = (n) => `hi, ${n}`;\n" + "// " + "x".repeat(220) + "\n";
    const r = validateArtifactStaticP0(
      input({ type: "application/javascript", content: js, finalPath: "/x.js" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails invalid-js on syntax error", () => {
    const js = "const x = ((( ; " + "x".repeat(220);
    const r = validateArtifactStaticP0(
      input({ type: "application/javascript", content: js, finalPath: "/x.js" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("invalid-js");
  });
});

describe("validateArtifactStaticP0 — binary types", () => {
  it("passes binary content at byte floor (skip introspection)", () => {
    // 32 bytes of "binary-ish" content — Static P0 only checks size for
    // binary; the runtime is what tells us if the asset actually decodes.
    const blob = "x".repeat(32);
    const r = validateArtifactStaticP0(
      input({ type: "image/png", content: blob, finalPath: "/x.png" }),
    );
    expect(r.status).toBe("pass");
  });

  it("fails below-min-bytes on near-empty binary payloads", () => {
    const r = validateArtifactStaticP0(
      input({ type: "image/png", content: "x", finalPath: "/x.png" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("below-min-bytes");
  });
});

describe("validateArtifactStaticP0 — unknown types", () => {
  it("rejects unknown MIME types", () => {
    const r = validateArtifactStaticP0(
      input({ type: "application/x-custom-thing", content: "x".repeat(300), finalPath: "/x" }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") {
      expect(r.reason).toBe("type-not-supported");
      expect(r.details).toContain("application/x-custom-thing");
    }
  });

  it("rejects non-string content with structured failure", () => {
    const r = validateArtifactStaticP0({
      finalPath: "/x.html",
      contentHash: HASH,
      type: "text/html",
      content: 123 as unknown as string,
    });
    expect(r.status).toBe("fail");
  });
});
