// craft-checks.test.ts — the deterministic craft net (PR 3a).

import { describe, expect, it } from "vitest";
import { runCraftChecks, summarizeCraftChecks, DEFERRED_CHECKS } from "./craft-checks";

const html = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><style>${head}</style></head><body>${body}</body></html>`;

/** A deliberately well-crafted document that trips none of the checks. */
const CLEAN = `<!doctype html><html lang="en"><head><style>
:root{--ink:#1a1a1a;--paper:#faf9f6}
body{font-family:"Spectral",Georgia,serif;color:var(--ink);background:var(--paper)}
.btn{transition:transform .2s ease}
@media (prefers-reduced-motion: reduce){*{transition:none}}
button:focus-visible{outline:2px solid var(--ink)}
</style></head><body><h1>Hello</h1><img src="a.png" alt="a logo"><button>Go</button></body></html>`;

function ruleIds(content: string, type = "html"): string[] {
  return runCraftChecks({ content, type }).findings.map((f) => f.ruleId);
}

describe("runCraftChecks — clean", () => {
  it("a well-crafted document trips nothing", () => {
    const r = runCraftChecks({ content: CLEAN, type: "html" });
    expect(r.status).toBe("clean");
    expect(r.findings).toEqual([]);
    expect(r.checked.length).toBeGreaterThan(10);
    expect(r.deferred.length).toBe(DEFERRED_CHECKS.length);
  });

  it("non-HTML artifacts are not inspected but still list deferred checks", () => {
    const r = runCraftChecks({ content: "# Title\n\nbody", type: "markdown" });
    expect(r.status).toBe("clean");
    expect(r.checked).toEqual([]);
    expect(r.deferred.length).toBe(DEFERRED_CHECKS.length);
  });
});

describe("runCraftChecks — individual tells", () => {
  it("flags pure black / white", () => {
    expect(ruleIds(html("", "body{color:#000}"))).toContain("co-no-raw-black");
    expect(ruleIds(html("", "body{background:#FFFFFF}"))).toContain("co-no-raw-black");
    // near-black is fine
    expect(ruleIds(html("", "body{color:#0f0f0f}"))).not.toContain("co-no-raw-black");
  });

  it("flags the default Tailwind indigo ramp", () => {
    expect(ruleIds(html("", "a{color:#6366f1}"))).toContain("co-no-tailwind-indigo");
  });

  it("flags the generic violet→cyan AI gradient", () => {
    const g = html("", "h1{background:linear-gradient(135deg,#8b5cf6,#06b6d4)}");
    expect(ruleIds(g)).toContain("as-no-generic-ai-gradient");
  });

  it("flags gradient-clipped text", () => {
    const g = html("", "h1{background:linear-gradient(90deg,#a,#b);-webkit-background-clip:text}");
    expect(ruleIds(g)).toContain("as-no-gradient-text");
  });

  it("flags decorative emojis", () => {
    expect(ruleIds(html("<button>🚀 Launch</button>"))).toContain("as-no-decorative-emojis");
    expect(ruleIds(html("<p>Plain text</p>"))).not.toContain("as-no-decorative-emojis");
  });

  it("flags default system fonts as the primary face", () => {
    expect(ruleIds(html("", "body{font-family:Inter,sans-serif}"))).toContain(
      "ty-no-default-fonts",
    );
    expect(ruleIds(html("", 'body{font-family:"Spectral",serif}'))).not.toContain(
      "ty-no-default-fonts",
    );
  });

  it("flags em-dash / ellipsis in copy but not inside CSS/JS", () => {
    expect(ruleIds(html("<p>Fast — really fast</p>"))).toContain("cp-no-em-dash-tell");
    // em-dash inside <style> must not false-positive
    expect(ruleIds(html("<p>ok</p>", "a::before{content:'—'}"))).not.toContain(
      "cp-no-em-dash-tell",
    );
  });

  it("flags transition: all", () => {
    expect(ruleIds(html("", ".x{transition:all .2s}"))).toContain("mo-no-transition-all");
  });

  it("flags animating layout properties", () => {
    expect(ruleIds(html("", ".x{transition:width .3s}"))).toContain("mo-gpu-only-props");
    expect(ruleIds(html("", ".x{transition:transform .3s}"))).not.toContain("mo-gpu-only-props");
  });

  it("flags animation without a reduced-motion fallback", () => {
    const noFallback = html(
      "",
      "@keyframes spin{to{transform:rotate(1turn)}} .x{animation:spin 2s}",
    );
    expect(ruleIds(noFallback)).toContain("mo-honor-reduced-motion");
    const withFallback = noFallback.replace(
      "</style>",
      "@media (prefers-reduced-motion:reduce){.x{animation:none}}</style>",
    );
    expect(ruleIds(withFallback)).not.toContain("mo-honor-reduced-motion");
  });

  it("flags will-change: all", () => {
    expect(ruleIds(html("", ".x{will-change:all}"))).toContain("mo-will-change-sparingly");
  });

  it("flags glassmorphism overuse (3+ surfaces)", () => {
    const css =
      ".a{backdrop-filter:blur(8px)}.b{backdrop-filter:blur(8px)}.c{backdrop-filter:blur(8px)}";
    expect(ruleIds(html("", css))).toContain("as-no-default-glassmorphism");
    // a single glass surface is fine
    expect(ruleIds(html("", ".a{backdrop-filter:blur(8px)}"))).not.toContain(
      "as-no-default-glassmorphism",
    );
  });

  it("flags aurora/mesh backgrounds (3+ radial gradients)", () => {
    const css = "body{background:radial-gradient(a),radial-gradient(b),radial-gradient(c)}";
    expect(ruleIds(html("", css))).toContain("as-no-aurora-bg");
  });

  it("flags a missing html lang", () => {
    const noLang = "<!doctype html><html><head></head><body><p>hi</p></body></html>";
    expect(ruleIds(noLang)).toContain("a11y-html-lang");
  });

  it("flags images without alt", () => {
    expect(ruleIds(html('<img src="x.png">'))).toContain("a11y-alt-text");
    expect(ruleIds(html('<img src="x.png" alt="">'))).not.toContain("a11y-alt-text");
  });

  it("flags outline:none without :focus-visible", () => {
    expect(ruleIds(html("", "button{outline:none}"))).toContain("a11y-focus-visible");
    expect(
      ruleIds(html("", "button{outline:none}button:focus-visible{outline:2px}")),
    ).not.toContain("a11y-focus-visible");
  });
});

describe("runCraftChecks — aggregation", () => {
  it("returns warn and sorts findings P0 before P1/P2", () => {
    // mixes a P0 (raw black) and a P1 (default font)
    const r = runCraftChecks({
      content: html("", "body{color:#000;font-family:Inter,sans-serif}"),
      type: "html",
    });
    expect(r.status).toBe("warn");
    const tiers = r.findings.map((f) => f.tier);
    // P0 must come before any P1
    const firstP1 = tiers.indexOf("P1");
    const lastP0 = tiers.lastIndexOf("P0");
    if (firstP1 !== -1) expect(lastP0).toBeLessThan(firstP1);
  });

  it("summarizeCraftChecks reads clean vs warn", () => {
    expect(summarizeCraftChecks(runCraftChecks({ content: CLEAN, type: "html" }))).toBe(
      "✓ no craft tells",
    );
    const warn = runCraftChecks({ content: html("", "body{color:#000}"), type: "html" });
    expect(summarizeCraftChecks(warn)).toContain("craft tell");
  });
});
