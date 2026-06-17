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
  it("ships exactly 30 canonical builtin rules", () => {
    // User reset 2026-05-21: replaced the 5 HYVE-internal rules
    // with 30 globally-useful rules in DF v1 OSS prep. Each is
    // written as "problem to avoid + concrete substitute".
    expect(DEFAULT_BUILTIN_RULES.length).toBe(30);
  });

  it("all builtins have builtin: true and well-formed ids", () => {
    for (const r of DEFAULT_BUILTIN_RULES) {
      expect(r.builtin).toBe(true);
      expect(r.id).toMatch(/^[a-z]{2}-/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.category.length).toBeGreaterThan(0);
    }
  });

  it("anti-slop category covers the 8 anti-slop rules", () => {
    const as = DEFAULT_BUILTIN_RULES.filter((r) => r.category === "anti-slop");
    expect(as.length).toBe(8);
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

  it("each builtin description is a full instruction (not a 1-line chip)", () => {
    // The 5 canonical rules carry their full instruction text in
    // `description`, which gets concatenated into the system prompt
    // when selected. Sanity-check the migration didn't leave any
    // builtin with the old short-form descriptor (< 60 chars).
    for (const r of DEFAULT_BUILTIN_RULES) {
      expect(r.description, `rule ${r.id} missing description`).toBeDefined();
      expect(r.description!.length, `rule ${r.id} description too short`).toBeGreaterThan(60);
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
    expect(findRule("as-no-decorative-emojis")?.title).toBe("No decorative emojis");
  });

  it("findRule returns null for unknown id", () => {
    expect(findRule("nope-zzz")).toBeNull();
  });

  it("describeRuleSelection in pt-BR", () => {
    expect(describeRuleSelection([])).toBe("Nenhuma regra");
    expect(describeRuleSelection(["as-no-decorative-emojis"])).toBe("No decorative emojis");
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
