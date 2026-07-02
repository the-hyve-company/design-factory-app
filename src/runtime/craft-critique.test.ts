// craft-critique.test.ts — /critique verb core (audit WS1
// `critique-command`): deterministic, read-only, no model call.

import { describe, expect, it } from "vitest";
import { runCraftCritique } from "./craft-critique";

const DIRTY =
  `<!doctype html><html><head><style>` +
  `body{color:#000;background:#fff}` +
  `a{color:#6366f1;transition:all .2s}` +
  `</style></head><body><h1>🚀 Launch</h1><p>${"copy ".repeat(60)}</p></body></html>`;

const CLEAN =
  `<!doctype html><html lang="en"><head><style>` +
  `:root{--ink:#1a1a1a;--paper:#faf9f6}` +
  `body{font-family:"Spectral",serif;color:var(--ink);background:var(--paper)}` +
  `</style></head><body><h1>Hello</h1><p>${"copy ".repeat(60)}</p></body></html>`;

describe("runCraftCritique", () => {
  it("reports findings P0-first with rule ids, fixes and snippets", () => {
    const { report, craft, staticP0 } = runCraftCritique({ content: DIRTY });
    expect(staticP0.status).toBe("pass");
    expect(craft.status).toBe("warn");
    expect(report).toContain("Craft critique");
    expect(report).toContain("co-no-raw-black");
    expect(report).toContain("co-no-tailwind-indigo");
    expect(report).toContain("mo-no-transition-all");
    // Read-only affordance + the explicit fix path.
    expect(report).toContain("nothing was changed");
    expect(report).toContain("/polish");
  });

  it("reports a clean bill without inventing findings", () => {
    const { report, craft } = runCraftCritique({ content: CLEAN, fileName: "landing.html" });
    expect(craft.status).toBe("clean");
    expect(report).toContain("landing.html");
    expect(report).toContain("no craft tells");
    expect(report).not.toContain("### Findings");
  });

  it("always discloses what the deterministic pass can't see (deferred)", () => {
    const { report } = runCraftCritique({ content: CLEAN });
    expect(report).toContain("Not covered here");
    expect(report).toContain("a11y-contrast-aa");
  });

  it("surfaces a Static P0 structural failure", () => {
    const broken = `<!doctype html><html><body><script>boom(</body></html>` + "x".repeat(200);
    const { report, staticP0 } = runCraftCritique({ content: broken });
    expect(staticP0.status).toBe("fail");
    expect(report).toContain("✗ fail");
  });

  it("honours the DS allowlist (anti-FP) like the pipeline net does", () => {
    const { craft } = runCraftCritique({
      content: DIRTY,
      designSystemMarkdown: "- ink: #000000\n- paper: #ffffff\n- accent: #6366f1",
    });
    const ids = craft.findings.map((f) => f.ruleId);
    expect(ids).not.toContain("co-no-raw-black");
    expect(ids).not.toContain("co-no-tailwind-indigo");
    // Non-color tells still fire.
    expect(ids).toContain("mo-no-transition-all");
  });

  it("is read-only by construction — the input string is untouched", () => {
    const content = DIRTY;
    runCraftCritique({ content });
    expect(content).toBe(DIRTY);
  });
});
