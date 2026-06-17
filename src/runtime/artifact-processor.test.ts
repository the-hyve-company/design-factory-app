import { describe, it, expect } from "vitest";
import { parseArtifact, sha256Hex, DEFAULT_MAX_ARTIFACT_BYTES } from "./artifact-processor";

// Spec coverage: src/runtime/artifact-processor.ts.
//
// Each `it` block targets one of the artifact-parser edge cases:
//
//   - simple valid <artifact>
//   - quoted attributes / escape entities
//   - </artifact> literal inside JS string in <script> body
//   - </script> escape inside JS string
//   - multiple <artifact> in one turn → reject ALL
//   - truncated (start without end) → unclosed-artifact
//   - oversize (> maxBytes) → oversize
//   - no artifact at all → status none
//
// Plus an extra batch on prose stripping, hash idempotence, attribute
// boundary parsing, and unknown-content-type acceptance (parser is
// type-agnostic by design — daemon enforces type policy).

describe("parseArtifact — happy paths", () => {
  it("returns status:none when no artifact tag is present", async () => {
    const out = await parseArtifact("just chat prose, nothing structured");
    expect(out.status).toBe("none");
    if (out.status === "none") {
      expect(out.cleanedText).toBe("just chat prose, nothing structured");
    }
  });

  it("extracts a simple, well-formed HTML artifact", async () => {
    const html = "<!DOCTYPE html><html><body>hello</body></html>";
    const stream = `Sure!\n\n<artifact identifier="projects/gooey/index.html" type="text/html" title="Gooey">${html}</artifact>\n\nDone.`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.identifier).toBe("projects/gooey/index.html");
      expect(out.artifact.type).toBe("text/html");
      expect(out.artifact.title).toBe("Gooey");
      expect(out.artifact.content).toBe(html);
      expect(out.artifact.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(out.cleanedText).toContain("Sure!");
      expect(out.cleanedText).toContain("Done.");
      expect(out.cleanedText).not.toContain("<artifact");
    }
  });

  it("accepts single-quoted attribute values", async () => {
    const stream = "<artifact identifier='projects/x/x.html' type='text/html'>body</artifact>";
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.identifier).toBe("projects/x/x.html");
      expect(out.artifact.content).toBe("body");
    }
  });

  it("decodes HTML entity escapes in attribute values", async () => {
    // title contains &quot; which decodes to a literal " inside the value.
    const stream = `<artifact identifier="projects/x/x.html" type="text/html" title="quoted &quot;phrase&quot;">x</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.title).toBe('quoted "phrase"');
    }
  });

  it("recovers `&amp;`, `&lt;`, `&gt;`, numeric entities", async () => {
    const stream = `<artifact identifier="projects/x/x.html" type="text/html" title="A &amp; B &lt;tag&gt; &#65;">x</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.title).toBe("A & B <tag> A");
    }
  });

  it("accepts a self-closing-style `/>` close on the start tag", async () => {
    // /> is unusual but the scanner should treat it as the same as `>`.
    const stream = `<artifact identifier="projects/x/x.md" type="text/markdown"/>body</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe("body");
      expect(out.artifact.type).toBe("text/markdown");
    }
  });

  it("treats unknown content-types as opaque (parser is type-agnostic)", async () => {
    // The parser's job is extraction. Type policy lives in the daemon.
    const stream = `<artifact identifier="x.bin" type="application/octet-stream">payload</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.type).toBe("application/octet-stream");
    }
  });
});

describe("parseArtifact — escape / quote awareness", () => {
  it("ignores </artifact> literal inside a JS string in a <script> block", async () => {
    // The script body contains the substring `</artifact>` as a JS string
    // value. Naive `indexOf("</artifact>")` would close prematurely.
    const html = `<!DOCTYPE html><html><body><script>const tag = "</artifact>"; console.log(tag);</script></body></html>`;
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(html);
    }
  });

  it("respects </script> inside a JS string when scanning for </artifact>", async () => {
    // `</script>` literal inside a JS string must not prematurely end the
    // script block — which would expose a real `</artifact>` for matching.
    const html = `<script>var s = "</script>"; var x = "</artifact>";</script><p>hello</p>`;
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(html);
    }
  });

  it("ignores </artifact> inside a <style> block string-ish content", async () => {
    const html = `<style>.x::before { content: "</artifact>"; }</style><div>after</div>`;
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(html);
    }
  });

  it("handles backtick-template literals in <script>", async () => {
    const html = "<script>const t = `</artifact>`; doStuff(t);</script>";
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(html);
    }
  });

  it("respects backslash escape inside JS string", async () => {
    const html = `<script>const t = "\\"</artifact>";</script>`;
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(html);
    }
  });
});

describe("parseArtifact — rejection cases", () => {
  it("rejects multiple artifacts in one turn (D23)", async () => {
    const stream =
      `<artifact identifier="a.html" type="text/html">A</artifact>` +
      `<artifact identifier="b.html" type="text/html">B</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("multiple-artifacts");
    }
  });

  it("rejects 3 artifacts the same way (any count >1 fails)", async () => {
    const stream =
      `<artifact identifier="a.html" type="text/html">A</artifact>\n` +
      `prose between\n` +
      `<artifact identifier="b.html" type="text/html">B</artifact>\n` +
      `<artifact identifier="c.html" type="text/html">C</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("multiple-artifacts");
    }
  });

  it("rejects unclosed artifact (truncated mid-stream)", async () => {
    const stream = `<artifact identifier="x" type="text/html">incomplete content with no closing tag`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("unclosed-artifact");
      expect(out.partial?.content).toContain("incomplete content");
      expect(out.partial?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("rejects oversize content above maxBytes", async () => {
    const big = "x".repeat(200);
    const stream = `<artifact identifier="x" type="text/html">${big}</artifact>`;
    const out = await parseArtifact(stream, { maxBytes: 100 });
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("oversize");
    }
  });

  it("rejects start-tag with missing identifier", async () => {
    const stream = `<artifact type="text/html">x</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("invalid-attributes");
    }
  });

  it("rejects start-tag with missing type", async () => {
    const stream = `<artifact identifier="x">x</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("invalid-attributes");
    }
  });

  it("rejects start-tag with truncated attribute (no closing quote)", async () => {
    const stream = `<artifact identifier="x" type="text/html`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      // Either invalid-attributes (malformed start tag) or unclosed —
      // both signal "do not write". Implementation chose invalid-attributes
      // because the start tag itself never terminates.
      expect(["invalid-attributes", "unclosed-artifact"]).toContain(out.reason);
    }
  });

  it("does not match `<artifact-foo>` (must be word-bounded)", async () => {
    const stream = `chat about <artifact-foo identifier="nope" type="x">stuff</artifact-foo>`;
    const out = await parseArtifact(stream);
    // No real `<artifact ...>` open tag exists (only `<artifact-foo`), so
    // we expect status:none.
    expect(out.status).toBe("none");
  });
});

describe("parseArtifact — defensive", () => {
  it("handles non-string input gracefully", async () => {
    // @ts-expect-error — runtime guard for callers passing wrong type.
    const out = await parseArtifact(null);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") {
      expect(out.reason).toBe("invalid-attributes");
    }
  });

  it("returns deterministic hash for identical content", async () => {
    const html = "<!DOCTYPE html><body>x</body>";
    const stream = `<artifact identifier="x" type="text/html">${html}</artifact>`;
    const a = await parseArtifact(stream);
    const b = await parseArtifact(stream);
    if (a.status === "artifact" && b.status === "artifact") {
      expect(a.artifact.contentHash).toBe(b.artifact.contentHash);
    }
  });

  it("DEFAULT_MAX_ARTIFACT_BYTES is 5 MiB", () => {
    expect(DEFAULT_MAX_ARTIFACT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("sha256Hex matches a known vector", async () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const h = await sha256Hex("abc");
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("preserves prose around the artifact when stripping (1 newline each side)", async () => {
    const stream =
      "before line\n" +
      `<artifact identifier="x" type="text/html">body</artifact>\n` +
      "after line";
    const out = await parseArtifact(stream);
    if (out.status === "artifact") {
      expect(out.cleanedText).toContain("before line");
      expect(out.cleanedText).toContain("after line");
      expect(out.cleanedText).not.toContain("<artifact");
    }
  });

  it("handles markdown content as opaque", async () => {
    const md = "# Title\n\nSome **bold** text and a [link](https://x.com).";
    const stream = `<artifact identifier="x.md" type="text/markdown">${md}</artifact>`;
    const out = await parseArtifact(stream);
    expect(out.status).toBe("artifact");
    if (out.status === "artifact") {
      expect(out.artifact.content).toBe(md);
      expect(out.artifact.type).toBe("text/markdown");
    }
  });
});
