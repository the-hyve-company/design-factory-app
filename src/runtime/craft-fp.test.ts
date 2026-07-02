// craft-fp.test.ts — anti-false-positive hardening (audit WS1
// `fp-hardening-port`): token-block strip, global-theme scoping,
// theme-aware var() resolution, DS color allowlist.

import { describe, expect, it } from "vitest";
import {
  buildCraftFpContext,
  collectGlobalThemeVars,
  extractDsColors,
  isDsColor,
  normalizeColor,
  resolveCssVars,
  stripTokenDeclarations,
} from "./craft-fp";

const doc = (css: string, body = "<h1>x</h1>") =>
  `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;

describe("stripTokenDeclarations", () => {
  it("removes custom-property declaration values, keeps usages", () => {
    const out = stripTokenDeclarations(
      ":root { --accent: #6366f1; } .btn { color: var(--accent); }",
    );
    expect(out).not.toContain("#6366f1");
    expect(out).toContain("var(--accent)");
  });

  it("also strips declarations in inline style attributes", () => {
    const out = stripTokenDeclarations('<div style="--brand: #7c3aed; color: var(--brand)">');
    expect(out).not.toContain("#7c3aed");
  });
});

describe("collectGlobalThemeVars", () => {
  it("collects :root / html / body declarations", () => {
    const vars = collectGlobalThemeVars(
      doc(":root { --bg: #000; }\nbody { --fg: #fff; }\n.card { --local: #123456; }"),
    );
    expect(vars.get("--bg")).toBe("#000");
    expect(vars.get("--fg")).toBe("#fff");
    // Component-scoped custom props don't enter the GLOBAL map.
    expect(vars.has("--local")).toBe(false);
  });

  it("excludes alternate-theme scopes (data-theme, .dark, prefers-color-scheme)", () => {
    const vars = collectGlobalThemeVars(
      doc(
        [
          ':root { --bg: #fafafa; } [data-theme="dark"] { --bg: #000; }',
          ".dark { --panel: #000; }",
          "@media (prefers-color-scheme: dark) { :root { --ink: #000; } }",
        ].join("\n"),
      ),
    );
    expect(vars.get("--bg")).toBe("#fafafa"); // global wins, themed ignored
    expect(vars.has("--panel")).toBe(false);
    expect(vars.has("--ink")).toBe(false);
  });

  it("keeps :root inside a NON-theme at-rule wrapper", () => {
    const vars = collectGlobalThemeVars(doc("@media (min-width: 600px) { :root { --gap: 8px; } }"));
    expect(vars.get("--gap")).toBe("8px");
  });
});

describe("resolveCssVars", () => {
  const vars = new Map([
    ["--bg", "#000"],
    ["--a", "var(--b)"],
    ["--b", "#6366f1"],
  ]);

  it("substitutes known vars", () => {
    expect(resolveCssVars("background: var(--bg);", vars)).toBe("background: #000;");
  });

  it("resolves chains with bounded depth", () => {
    expect(resolveCssVars("color: var(--a);", vars)).toBe("color: #6366f1;");
  });

  it("uses the literal fallback for unknown vars", () => {
    expect(resolveCssVars("color: var(--nope, #fff);", vars)).toBe("color: #fff;");
  });

  it("leaves unknown vars without fallback untouched", () => {
    expect(resolveCssVars("color: var(--nope);", vars)).toBe("color: var(--nope);");
  });

  it("survives circular definitions", () => {
    const cyc = new Map([
      ["--x", "var(--y)"],
      ["--y", "var(--x)"],
    ]);
    expect(() => resolveCssVars("color: var(--x);", cyc)).not.toThrow();
  });
});

describe("extractDsColors / isDsColor / normalizeColor", () => {
  it("extracts hex and rgb() literals from DS markdown", () => {
    const colors = extractDsColors(
      "## Palette\n- accent: `#6366F1`\n- ink: `#0F0F0F`\n- alt: rgb(255, 255, 255)\n",
    );
    expect(colors.has("#6366f1")).toBe(true);
    expect(colors.has("#0f0f0f")).toBe(true);
    expect(colors.has("#ffffff")).toBe(true);
  });

  it("matches short-hex against long-hex forms", () => {
    const colors = extractDsColors("bg: #000000");
    expect(isDsColor("#000", colors)).toBe(true);
    expect(isDsColor("rgb(0,0,0)", colors)).toBe(true);
    expect(isDsColor("#111", colors)).toBe(false);
  });

  it("normalizeColor handles 3/4/6/8-digit hex and rgb()", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("#abcd")).toBe("#aabbcc");
    expect(normalizeColor("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeColor("#a1b2c3ff")).toBe("#a1b2c3");
    expect(normalizeColor("rgb(0, 0, 0)")).toBe("#000000");
    expect(normalizeColor("oklch(0.7 0.1 250)")).toBeNull();
  });
});

describe("buildCraftFpContext — the three moves together", () => {
  it("unresolved text drops token declarations but keeps var() usages", () => {
    const ctx = buildCraftFpContext(
      doc(":root { --accent: #6366f1; } .btn { color: var(--accent); }"),
    );
    expect(ctx.scanTextUnresolved).not.toContain("#6366f1");
    expect(ctx.scanTextUnresolved).toContain("var(--accent)");
  });

  it("resolved text substitutes global-theme values into usages", () => {
    const ctx = buildCraftFpContext(doc(":root { --bg: #000; } body { background: var(--bg); }"));
    expect(ctx.scanTextResolved).toContain("background: #000");
  });

  it("themed-only values never leak into the resolved global scan", () => {
    const ctx = buildCraftFpContext(
      doc('[data-theme="oled"] { --bg: #000; } body { background: var(--bg); }'),
    );
    expect(ctx.scanTextResolved).toContain("background: var(--bg)");
    expect(ctx.scanTextResolved).not.toContain("background: #000");
  });
});
