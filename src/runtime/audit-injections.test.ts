// audit-injections.test.ts — P1 audit minimum-tests.
//
// External auditor (2026-05-17) called for 6 "minimum tests" to gate
// regressions in the v1 audit response work. This file ships 5 of the
// 6 (skills registry test is skipped pending user's manual upload).
// Each `it` block targets a specific contract that, if broken silently,
// would degrade the agent's adherence in production:
//
//   1. Artifact contract block — non-empty for artifact-channel
//      providers, empty for tool-channel providers, contains the
//      required identifier/type/title attributes literally.
//   2. Canonical+ summary injection — buildCanonicalPlusSummary emits
//      a Direction line when format is set, a Constraints line when
//      rules are non-empty, and a Taste line when at least one dial is
//      off neutral.
//   3. Rules taxonomy non-empty — 5+ rules ship by default.
//   4. Format taxonomy non-empty — 12+ items across categories.
//   5. Verb registry — at least 9 verbs registered (P0-B activation).
//
// Skills test deferred to user upload (P1 audit, deferred 2026-05-18).

import { describe, it, expect } from "vitest";
import { DEFAULT_BUILTIN_RULES, getEffectiveRules } from "@/data/rules-taxonomy";
import { DEFAULT_FORMAT_TAXONOMY, getEffectiveFormatTaxonomy } from "@/data/format-taxonomy";
import { buildCanonicalPlusSummary, type CanonicalPlusInput } from "./canonical-plus-prompt";
import { buildArtifactContractBlock, shouldAppendArtifactContract } from "./output-contract";
import { loadBuiltinVerbs } from "./verbs/registry";

describe("audit P1 / artifact contract", () => {
  it("emits the full attribute spec for artifact-channel providers", () => {
    const block = buildArtifactContractBlock({
      fileWrite: "artifact",
      filePath: "projects/test/test.html",
      projectName: "test",
    });
    expect(block).toContain('identifier="projects/test/test.html"');
    expect(block).toContain('type="text/html"');
    expect(block).toContain('title="test"');
    // The block must explicitly forbid markdown fences — the most
    // common BYOK regression path on edits.
    expect(block).toContain("Do NOT paste the file contents into a markdown code fence");
    // Single-artifact rule — multi-artifact emits get rejected.
    expect(block).toContain("EXACTLY ONE <artifact> block");
  });

  it("returns empty string for tool-channel providers", () => {
    const block = buildArtifactContractBlock({
      fileWrite: "tool",
      filePath: "projects/test/test.html",
    });
    expect(block).toBe("");
  });

  it("shouldAppendArtifactContract gates correctly by capability", () => {
    expect(shouldAppendArtifactContract({ capabilities: { fileWrite: "artifact" } as never })).toBe(
      true,
    );
    expect(shouldAppendArtifactContract({ capabilities: { fileWrite: "tool" } as never })).toBe(
      false,
    );
  });
});

describe("audit P1 / canonical+ summary injection", () => {
  it("returns empty when nothing was picked", () => {
    const input: CanonicalPlusInput = {};
    expect(buildCanonicalPlusSummary(input)).toBe("");
  });

  it("emits a Direction line when format is set", () => {
    const input: CanonicalPlusInput = {
      format: { categoryId: "interface", itemId: "landing" },
    };
    const summary = buildCanonicalPlusSummary(input);
    expect(summary).toContain("Direction:");
    expect(summary).toContain("Landing page");
  });

  it("emits a Constraints line when rules are present", () => {
    // Pick a real rule id from the builtin set so the lookup hits.
    const builtin = DEFAULT_BUILTIN_RULES[0];
    expect(builtin, "builtin rules must not be empty").toBeTruthy();
    const input: CanonicalPlusInput = { rules: [builtin.id] };
    const summary = buildCanonicalPlusSummary(input);
    expect(summary).toContain("Constraints:");
    expect(summary).toContain(builtin.id);
  });

  it("emits a Taste line when at least one dial is off-neutral", () => {
    const input: CanonicalPlusInput = {
      taste: { density: 85, motion: 50, contrast: 50 },
    };
    const summary = buildCanonicalPlusSummary(input);
    expect(summary).toContain("Taste:");
    // density 85 → softHigh stop → adjective "layered"
    expect(summary).toContain("layered");
    // Neutral dials must NOT appear in the summary.
    expect(summary).not.toMatch(/motion|contrast/);
  });

  it("starts with the Project Direction Summary header", () => {
    const input: CanonicalPlusInput = {
      format: { categoryId: "interface", itemId: "landing" },
    };
    expect(buildCanonicalPlusSummary(input).startsWith("Project Direction Summary")).toBe(true);
  });
});

describe("audit P1 / rules taxonomy", () => {
  it("ships at least 5 builtin rules", () => {
    expect(DEFAULT_BUILTIN_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("every builtin rule has a non-empty id, title, and description", () => {
    for (const r of DEFAULT_BUILTIN_RULES) {
      expect(r.id, `rule.id must be non-empty: ${JSON.stringify(r)}`).toBeTruthy();
      expect(r.title, `rule.title must be non-empty: ${r.id}`).toBeTruthy();
      expect(r.description, `rule.description must be non-empty: ${r.id}`).toBeTruthy();
    }
  });

  it("getEffectiveRules returns at least the builtins (overrides only widen)", () => {
    expect(getEffectiveRules().length).toBeGreaterThanOrEqual(DEFAULT_BUILTIN_RULES.length);
  });
});

describe("audit P1 / format taxonomy", () => {
  it("ships at least 12 items across categories (P0-D Rota A migration)", () => {
    const total = DEFAULT_FORMAT_TAXONOMY.reduce((acc, c) => acc + c.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it("includes the 4 P0-D priority categories: interface, social, video, print", () => {
    const ids = DEFAULT_FORMAT_TAXONOMY.map((c) => c.id);
    expect(ids).toContain("interface");
    expect(ids).toContain("social");
    expect(ids).toContain("video");
    expect(ids).toContain("print");
  });

  it("every item has a non-empty prompt body (no descriptor-only placeholders)", () => {
    for (const cat of DEFAULT_FORMAT_TAXONOMY) {
      for (const item of cat.items) {
        expect(
          item.prompt && item.prompt.length > 0,
          `format ${cat.id}/${item.id} must have a non-empty prompt`,
        ).toBe(true);
      }
    }
  });

  it("getEffectiveFormatTaxonomy preserves all builtin categories", () => {
    const effective = getEffectiveFormatTaxonomy();
    expect(effective.length).toBe(DEFAULT_FORMAT_TAXONOMY.length);
  });
});

describe("audit P1 / verb registry", () => {
  it("ships at least 9 builtin verbs (P0-B activation: review, polish, rewrite + 6)", () => {
    const verbs = loadBuiltinVerbs();
    expect(verbs.length).toBeGreaterThanOrEqual(9);
  });

  it("includes the 6 newly-activated verbs from P0-B", () => {
    const verbs = loadBuiltinVerbs();
    const ids = new Set(verbs.map((v) => v.id));
    for (const id of ["check", "animate", "type", "color", "simplify", "reinforce"]) {
      expect(ids.has(id), `verb ${id} must be registered`).toBe(true);
    }
  });

  it("every verb carries a non-empty systemPrompt body", () => {
    for (const v of loadBuiltinVerbs()) {
      expect(v.systemPrompt.length, `verb ${v.id} body must be non-empty`).toBeGreaterThan(0);
    }
  });

  it("every verb declares a valid category from CATEGORY_ORDER", () => {
    const valid = new Set(["evaluate", "refine", "direction", "enhance", "fix", "export"]);
    for (const v of loadBuiltinVerbs()) {
      expect(valid.has(v.category), `verb ${v.id} category invalid: ${v.category}`).toBe(true);
    }
  });
});

// Skills registry test deferred — user will upload skills manually
// after this PR lands. When skills/ ships content, add:
//
//   describe("audit P1 / skills registry", () => {
//     it("ships at least 5 builtin skills", () => {
//       // expect(builtinSkills.length).toBeGreaterThanOrEqual(5);
//     });
//   });
