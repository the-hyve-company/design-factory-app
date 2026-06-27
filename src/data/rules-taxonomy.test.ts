// rules-taxonomy.test.ts — sanity tests for unified rules catalog.

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_BUILTIN_RULES,
  RULE_CATEGORIES,
  RuleSchema,
  describeRuleSelection,
  findRule,
  generateUserRuleId,
  getEffectiveCategories,
  getEffectiveRules,
  groupRulesByCategory,
  setBuiltinOverrides,
  setDisabledRuleIds,
  setUserRules,
  totalRuleCount,
  type Rule,
} from "./rules-taxonomy";

beforeEach(() => {
  setBuiltinOverrides({});
  setUserRules([]);
  setDisabledRuleIds([]);
});

describe("rules-taxonomy defaults", () => {
  it("ships exactly 132 canonical builtin rules", () => {
    // 132 brand-agnostic craft defaults across 14 categories (the 10
    // visual ones plus a11y, copy, i18n/RTL and laws-of-ux). Ported from
    // docs/specs/df-rules-library.md. Each is "✗ avoid + ✓ do-instead".
    expect(DEFAULT_BUILTIN_RULES.length).toBe(132);
  });

  it("all builtins have builtin: true and well-formed ids", () => {
    for (const r of DEFAULT_BUILTIN_RULES) {
      expect(r.builtin).toBe(true);
      // category prefix can be alphanumeric (as-, ty-, a11y-, i18n-, lux-, …)
      expect(r.id).toMatch(/^[a-z0-9]+-/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.category.length).toBeGreaterThan(0);
    }
  });

  it("anti-slop category covers the 13 anti-slop rules", () => {
    const as = DEFAULT_BUILTIN_RULES.filter((r) => r.category === "anti-slop");
    expect(as.length).toBe(13);
    expect(as.every((r) => r.id.startsWith("as-"))).toBe(true);
  });

  it("RULE_CATEGORIES order leads with anti-slop and includes custom", () => {
    expect(RULE_CATEGORIES[0].id).toBe("anti-slop");
    expect(RULE_CATEGORIES.map((c) => c.id)).toContain("custom");
  });

  it("RuleSchema validates a builtin", () => {
    const parsed = RuleSchema.safeParse(DEFAULT_BUILTIN_RULES[0]);
    expect(parsed.success).toBe(true);
  });

  it("each builtin description is a full ✗/✓ instruction (not a 1-line chip)", () => {
    // Every rule carries a complete "✗ avoid / ✓ do-instead" pair in
    // `description`, concatenated into the system prompt when selected.
    // Sanity-check the port left no builtin with an old short-form chip.
    // The terse-but-complete library entries (e.g. lux-miller at 55) sit
    // around 50+, so >40 still flags a stray one-word descriptor.
    for (const r of DEFAULT_BUILTIN_RULES) {
      expect(r.description, `rule ${r.id} missing description`).toBeDefined();
      expect(r.description, `rule ${r.id} missing ✗`).toContain("✗");
      expect(r.description, `rule ${r.id} missing ✓`).toContain("✓");
      expect(r.description!.length, `rule ${r.id} description too short`).toBeGreaterThan(40);
    }
  });
});

describe("rules-taxonomy effective catalog", () => {
  it("totalRuleCount matches builtin count when no user rules", () => {
    expect(totalRuleCount()).toBe(DEFAULT_BUILTIN_RULES.length);
  });

  it("disabled builtins are filtered out of effective catalog", () => {
    setDisabledRuleIds(["as-no-decorative-emojis"]);
    const eff = getEffectiveRules();
    expect(eff.find((r) => r.id === "as-no-decorative-emojis")).toBeUndefined();
  });

  it("user rules append to effective catalog", () => {
    const u: Rule = {
      id: "usr-custom-x",
      title: "Custom rule X",
      category: "custom",
      builtin: false,
    };
    setUserRules([u]);
    const eff = getEffectiveRules();
    expect(eff.find((r) => r.id === "usr-custom-x")).toEqual(u);
    expect(totalRuleCount()).toBe(DEFAULT_BUILTIN_RULES.length + 1);
  });

  it("builtin overrides apply title/description without changing id", () => {
    setBuiltinOverrides({
      "as-no-decorative-emojis": { title: "Sem emojis (pt)", description: "nada" },
    });
    const r = findRule("as-no-decorative-emojis");
    expect(r?.title).toBe("Sem emojis (pt)");
    expect(r?.description).toBe("nada");
    expect(r?.builtin).toBe(true);
  });

  it("user rules with builtin: true get coerced to false on setUserRules", () => {
    setUserRules([{ id: "evil", title: "Evil", category: "custom", builtin: true } as Rule]);
    const eff = getEffectiveRules();
    const evil = eff.find((r) => r.id === "evil");
    expect(evil?.builtin).toBe(false);
  });
});

describe("rules-taxonomy grouping", () => {
  it("groupRulesByCategory returns categories in canonical order", () => {
    const groups = groupRulesByCategory();
    const ids = groups.map((g) => g.meta.id);
    // anti-slop must be first because RULE_CATEGORIES leads with it
    expect(ids[0]).toBe("anti-slop");
  });

  it("groupRulesByCategory introduces user-defined categories at the end", () => {
    setUserRules([
      { id: "usr-shading-soft", title: "Soft shading", category: "shading", builtin: false },
    ]);
    const cats = getEffectiveCategories();
    expect(cats.find((c) => c.id === "shading")).toBeDefined();
    const groups = groupRulesByCategory();
    const last = groups[groups.length - 1];
    expect(last.meta.id).toBe("shading");
    expect(last.rules.length).toBe(1);
  });

  it("empty categories are not emitted", () => {
    setDisabledRuleIds(DEFAULT_BUILTIN_RULES.map((r) => r.id));
    const groups = groupRulesByCategory();
    expect(groups.length).toBe(0);
  });
});

describe("rules-taxonomy selection helpers", () => {
  it("findRule locates by id", () => {
    expect(findRule("as-no-decorative-emojis")?.title).toBe("No emojis as icons");
  });

  it("findRule returns null for unknown id", () => {
    expect(findRule("nope-zzz")).toBeNull();
  });

  it("describeRuleSelection in pt-BR", () => {
    expect(describeRuleSelection([])).toBe("Nenhuma regra");
    expect(describeRuleSelection(["as-no-decorative-emojis"])).toBe("No emojis as icons");
    expect(describeRuleSelection(["as-no-decorative-emojis", "tn-skeu-premium-tier2"])).toBe(
      "2 regras",
    );
  });

  it("generateUserRuleId yields kebab-case usr- prefix", () => {
    const id = generateUserRuleId("my Cat");
    expect(id.startsWith("usr-my-cat-")).toBe(true);
  });

  it("generateUserRuleId tolerates empty / weird category", () => {
    const id = generateUserRuleId("");
    expect(id.startsWith("usr-custom-")).toBe(true);
  });
});
