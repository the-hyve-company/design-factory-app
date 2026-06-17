// regression tests — covers the 4 bug fixes:
//   1. Comment patch duplication (regression report): when a patch
//      DOES match, applyPatches must NOT trigger full regen. Without the
//      ambiguity guard the search-and-replace would still bail and the
//      caller would dump a freshly generated HTML next to the existing one.
//   2. Patch ambiguity guard: same `search` substring appearing >1 time
//      should fail (so caller can fall back) rather than silently replace
//      only the first occurrence.
//   3. Multi-patch ordering: patches MUST be applied in order, on the
//      progressively-mutated string — not on the original snapshot.
//   4. Patch fallback signal: caller can detect ambiguous-vs-not-found and
//      decide whether to retry with narrower context or full regen.
//
// Reference: see also `docs/agent-contract.md` §3 — surgical-edit-first.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyPatches, parsePatchResponse, invokeSearchReplaceEdit } from "./patch-invoker";

// 1 stabilize: mock cli-spawner so we can assert that
// invokeSearchReplaceEdit forwards ctx.providerId. Pre-fix the spawnOnce
// call dropped providerId silently — the patch path always defaulted to
// Claude even when the picker said Codex/Gemini.
vi.mock("./cli-spawner", () => ({
  spawnOnce: vi.fn(async () => '{"patches":[]}'),
  spawnStream: vi.fn(),
}));
import { spawnOnce } from "./cli-spawner";

beforeEach(() => {
  vi.mocked(spawnOnce).mockClear();
});

describe("applyPatches — patch-edit regressions", () => {
  it("applies a single unique-match patch without falling back", () => {
    const html = "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>";
    const result = applyPatches(html, [{ search: "<h1>Hello</h1>", replace: "<h1>Bonjour</h1>" }]);

    expect(result).not.toBeNull();
    if (result.html === null) throw new Error("expected applied result");
    expect(result.html).toContain("<h1>Bonjour</h1>");
    expect(result.html).not.toContain("<h1>Hello</h1>");
    expect(result.applied).toBe(1);
  });

  it("rejects ambiguous patch (search matches twice) with reason=ambiguous", () => {
    // Bug 2 in the when a search string appears multiple
    // times, replacing the first occurrence would corrupt the file. The
    // guard returns reason=ambiguous so the caller can ask for a narrower
    // patch or fall back to full regen.
    const html = '<div class="x">a</div><div class="x">a</div>';
    const result = applyPatches(html, [
      { search: '<div class="x">a</div>', replace: '<div class="x">b</div>' },
    ]);

    if (result.html !== null) throw new Error("expected failure");
    expect(result.failedAt).toBe(0);
    expect(result.reason).toBe("ambiguous");
  });

  it("rejects not-found patch with reason=not-found (distinct from ambiguous)", () => {
    const html = "<div>a</div>";
    const result = applyPatches(html, [
      { search: "<span>nope</span>", replace: "<span>yes</span>" },
    ]);

    if (result.html !== null) throw new Error("expected failure");
    expect(result.failedAt).toBe(0);
    expect(result.reason).toBe("not-found");
  });

  it("applies patches sequentially — each sees the previous result", () => {
    // Without sequential application, the second patch could reference a
    // string that was just replaced in the first patch (silent bug).
    const html = "<p>one</p><p>two</p>";
    const result = applyPatches(html, [
      { search: "<p>one</p>", replace: "<p>uno</p>" },
      { search: "<p>two</p>", replace: "<p>dos</p>" },
    ]);

    if (result.html === null) throw new Error("expected applied result");
    expect(result.html).toBe("<p>uno</p><p>dos</p>");
    expect(result.applied).toBe(2);
  });

  it("fails partway and reports failedAt index", () => {
    // First patch applies, second fails — we report which index failed so
    // the caller can either retry that patch or fall back wholesale.
    const html = "<p>one</p>";
    const result = applyPatches(html, [
      { search: "<p>one</p>", replace: "<p>uno</p>" },
      { search: "<p>two</p>", replace: "<p>dos</p>" },
    ]);

    if (result.html !== null) throw new Error("expected failure on 2nd patch");
    expect(result.failedAt).toBe(1);
    expect(result.reason).toBe("not-found");
  });

  it("comment edit does NOT duplicate when patch fits", () => {
    // The recurring comment-duplication symptom: user asks to change a
    // comment, the LLM produces a precise patch, applyPatches succeeds,
    // and the file should contain ONLY the new comment — never a
    // concatenation of old + new.
    const html = "<!DOCTYPE html><html><head><!-- old comment --></head><body></body></html>";
    const result = applyPatches(html, [
      { search: "<!-- old comment -->", replace: "<!-- new comment -->" },
    ]);

    if (result.html === null) throw new Error("expected applied result");
    expect(result.html).toContain("<!-- new comment -->");
    expect(result.html).not.toContain("<!-- old comment -->");
    // Critical: the new HTML is exactly one document, not "old<>new"
    expect(result.html.match(/<!DOCTYPE/g)?.length).toBe(1);
    expect(result.html.match(/<\/html>/g)?.length).toBe(1);
  });
});

describe("parsePatchResponse — fallback signals", () => {
  it("parses needsFullRewrite=true into empty patches array", () => {
    // The LLM signals that the change is too structural for a patch.
    // Caller falls back to full regeneration.
    const raw = JSON.stringify({ needsFullRewrite: true });
    const parsed = parsePatchResponse(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.patches).toEqual([]);
  });

  it("parses a normal multi-patch response with summary", () => {
    const raw = JSON.stringify({
      patches: [
        { search: "old", replace: "new" },
        { search: "foo", replace: "bar" },
      ],
      summary: "swapped two strings",
    });
    const parsed = parsePatchResponse(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.patches).toHaveLength(2);
    expect(parsed!.summary).toBe("swapped two strings");
  });

  it("rejects malformed JSON cleanly (returns null, no throw)", () => {
    expect(parsePatchResponse("not json")).toBeNull();
    expect(parsePatchResponse("{ broken")).toBeNull();
  });

  it("invokeSearchReplaceEdit forwards ctx.providerId to spawnOnce", async () => {
    // Pre-, this call passed { model, cwd, agent } but DROPPED
    // providerId. cli-spawner then defaulted to "claude". The picker
    // showed Codex/Gemini but the patch path always hit Claude — and
    // when Claude was rate-limited, the user saw silent failures
    // with the wrong provider in the badge.
    vi.mocked(spawnOnce).mockClear();
    const ctx = {
      projectPath: "/p",
      primaryFile: "index.html",
      mode: "hifi" as const,
      conversationHistory: [],
      hasDesignSystem: false,
      currentHtml: "<html>old</html>",
      providerId: "codex" as const,
      model: "default",
      cwd: "/cwd",
      agent: "claude",
    };
    await invokeSearchReplaceEdit("change x to y", ctx);
    expect(spawnOnce).toHaveBeenCalledTimes(1);
    const overrides = vi.mocked(spawnOnce).mock.calls[0][3];
    expect(overrides).toBeDefined();
    expect((overrides as { providerId?: string }).providerId).toBe("codex");
  });

  it("invokeSearchReplaceEdit returns null when ctx.currentHtml is missing", async () => {
    // No HTML to patch → don't even spawn. Caller should fall back.
    vi.mocked(spawnOnce).mockClear();
    const ctx = {
      projectPath: "/p",
      primaryFile: "index.html",
      mode: "hifi" as const,
      conversationHistory: [],
      hasDesignSystem: false,
      providerId: "claude" as const,
    };
    const result = await invokeSearchReplaceEdit("anything", ctx);
    expect(result).toBeNull();
    expect(spawnOnce).not.toHaveBeenCalled();
  });

  it("filters patches missing search or replace fields", () => {
    const raw = JSON.stringify({
      patches: [
        { search: "good", replace: "fine" },
        { search: "" }, // missing replace
        { replace: "lonely" }, // missing search
        { search: "also-good", replace: "" }, // empty replace is OK (deletion)
      ],
    });
    const parsed = parsePatchResponse(raw);

    expect(parsed).not.toBeNull();
    // Patches with empty search ARE filtered (length > 0 guard)
    // Patches with non-string replace ARE filtered (typeof check)
    // Patches with missing search ARE filtered
    expect(parsed!.patches).toHaveLength(2);
    expect(parsed!.patches[0]).toEqual({ search: "good", replace: "fine" });
    expect(parsed!.patches[1]).toEqual({ search: "also-good", replace: "" });
  });
});
