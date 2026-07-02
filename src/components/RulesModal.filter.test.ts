// RulesModal.filter.test.ts — pure logic behind the 132-rule scale UX:
// filter pills (ruleMatchesFilter), filter+search composition
// (filterGroups) and the row badge descriptors (ruleBadges).

import { describe, expect, it } from "vitest";
import { filterGroups, ruleBadges, ruleMatchesFilter } from "@/components/RulesModal";
import type { Rule, RuleCategoryMeta } from "@/data/rules-taxonomy";

const rule = (over: Partial<Rule> & Pick<Rule, "id" | "title" | "category">): Rule => ({
  builtin: true,
  ...over,
});

const R_P0_CORE = rule({
  id: "a-p0-core",
  title: "No generic gradient",
  category: "anti-slop",
  tier: "P0",
  core: true,
  checkable: true,
});
const R_P1 = rule({
  id: "b-p1",
  title: "Limited type scale",
  category: "typography",
  tier: "P1",
  description: "use few sizes",
});
const R_P2 = rule({ id: "c-p2", title: "Polish shadows", category: "depth", tier: "P2" });
const R_USER = rule({
  id: "usr-custom-1",
  title: "My house rule",
  category: "custom",
  builtin: false,
});

const META: Record<string, RuleCategoryMeta> = {
  "anti-slop": { id: "anti-slop", label: "Anti-slop" },
  typography: { id: "typography", label: "Typography" },
  depth: { id: "depth", label: "Depth" },
  custom: { id: "custom", label: "Custom" },
};

const GROUPS = [
  { meta: META["anti-slop"], rules: [R_P0_CORE] },
  { meta: META.typography, rules: [R_P1] },
  { meta: META.depth, rules: [R_P2] },
  { meta: META.custom, rules: [R_USER] },
];

const NONE = new Set<string>();

describe("ruleMatchesFilter", () => {
  it('"all" matches everything', () => {
    for (const r of [R_P0_CORE, R_P1, R_P2, R_USER]) {
      expect(ruleMatchesFilter(r, "all", NONE)).toBe(true);
    }
  });

  it('"core" matches only core rules', () => {
    expect(ruleMatchesFilter(R_P0_CORE, "core", NONE)).toBe(true);
    expect(ruleMatchesFilter(R_P1, "core", NONE)).toBe(false);
    expect(ruleMatchesFilter(R_USER, "core", NONE)).toBe(false);
  });

  it('"selected" matches the current draft only', () => {
    const draft = new Set([R_USER.id]);
    expect(ruleMatchesFilter(R_USER, "selected", draft)).toBe(true);
    expect(ruleMatchesFilter(R_P0_CORE, "selected", draft)).toBe(false);
  });

  it("tier filters match exactly their tier (untiered user rules excluded)", () => {
    expect(ruleMatchesFilter(R_P0_CORE, "P0", NONE)).toBe(true);
    expect(ruleMatchesFilter(R_P1, "P0", NONE)).toBe(false);
    expect(ruleMatchesFilter(R_P1, "P1", NONE)).toBe(true);
    expect(ruleMatchesFilter(R_P2, "P2", NONE)).toBe(true);
    expect(ruleMatchesFilter(R_USER, "P2", NONE)).toBe(false);
  });
});

describe("filterGroups — filter + search composition", () => {
  it("no query + no filter returns groups untouched", () => {
    const { filtered, matched } = filterGroups(GROUPS, "", "en");
    expect(filtered).toEqual(GROUPS);
    expect(matched.size).toBe(0);
  });

  it("an active filter drops non-matching groups and marks matches for expansion", () => {
    const { filtered, matched } = filterGroups(GROUPS, "", "en", "P1", NONE);
    expect(filtered.map((g) => g.meta.id)).toEqual(["typography"]);
    expect([...matched]).toEqual(["typography"]);
  });

  it('"selected" filter follows the draft set', () => {
    const draft = new Set([R_P2.id, R_USER.id]);
    const { filtered } = filterGroups(GROUPS, "", "en", "selected", draft);
    expect(filtered.map((g) => g.meta.id)).toEqual(["depth", "custom"]);
  });

  it("query composes with the filter (intersection, not union)", () => {
    // "scale" matches R_P1's title, but the P0 filter excludes it.
    const p0 = filterGroups(GROUPS, "scale", "en", "P0", NONE);
    expect(p0.filtered).toEqual([]);
    // Same query under the matching tier passes.
    const p1 = filterGroups(GROUPS, "scale", "en", "P1", NONE);
    expect(p1.filtered.map((g) => g.meta.id)).toEqual(["typography"]);
  });
});

describe("ruleBadges", () => {
  it("emits tier + core + auto for a fully-flagged rule, in order", () => {
    const badges = ruleBadges(R_P0_CORE);
    expect(badges.map((b) => b.kind)).toEqual(["tier", "core", "auto"]);
    expect(badges[0].label).toBe("P0");
    expect(badges[0].className).toContain("dmv2-row-badge--p0");
    expect(badges[1].label).toBe("rules.badge.core");
    expect(badges[2].label).toBe("rules.badge.auto");
  });

  it("emits only the tier badge for a plain tiered rule", () => {
    const badges = ruleBadges(R_P1);
    expect(badges.map((b) => b.kind)).toEqual(["tier"]);
    expect(badges[0].className).toContain("dmv2-row-badge--p1");
  });

  it("emits no badges for an unflagged user rule", () => {
    expect(ruleBadges(R_USER)).toEqual([]);
  });
});
