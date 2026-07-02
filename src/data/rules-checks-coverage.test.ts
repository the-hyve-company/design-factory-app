// rules-checks-coverage.test.ts — locks the mapping between the 132-rule
// taxonomy and the deterministic craft detectors (audit WS1
// `rules-checks-coverage-test`), so the two can't drift silently.
//
// Invariants:
//   1. Every detector maps to a real taxonomy rule marked checkable.
//   2. Every DEFERRED entry maps to a real taxonomy rule marked checkable.
//   3. A rule id is never both detected and deferred, and no two
//      detectors claim the same rule.
//   4. Detector tier === rule tier (severity shown in the UI must match
//      what the net reports).
//   5. Every `checkable: true` rule resolves somewhere: detector,
//      deferred, or the EXPLICIT backlog ledger below. Marking a new
//      rule checkable without wiring a detector (or consciously adding
//      it here) fails this test — that's the point.
//   6. The ledger holds no stale entries (implemented rules must leave
//      it) and nothing that isn't a checkable taxonomy rule.

import { describe, expect, it } from "vitest";
import { CRAFT_CHECK_INDEX, DEFERRED_CHECKS } from "@/runtime/craft-checks";
import { DEFAULT_BUILTIN_RULES } from "@/data/rules-taxonomy";

/**
 * Declared-checkable rules whose deterministic detector is NOT written
 * yet — the acknowledged backlog, snapshotted 2026-07-02 (40 ids). Each
 * is grep-able in principle (that's why they carry `checkable: true`)
 * but has no detector in craft-checks.ts nor a DEFERRED entry. Implement
 * a detector → REMOVE the id here, or the test fails on invariant 6.
 */
const DETECTOR_BACKLOG: ReadonlySet<string> = new Set([
  "as-no-shadcn-default",
  "as-no-unprompted-glow",
  "as-no-decorative-bg-pattern",
  "ly-spacing-scale",
  "ly-padding-ratio",
  "ly-concentric-radius",
  "ty-weight-for-hierarchy",
  "ty-body-min-16",
  "ty-line-height",
  "ty-display-font-on-headings",
  "ty-text-wrap",
  "ty-smart-quotes",
  "ty-tabular-nums",
  "ty-no-hover-type-shift",
  "ty-underline-links-only",
  "ty-no-bold-italic-stack",
  "co-accent-sparingly",
  "co-semantic-token-names",
  "co-dark-translucent-borders",
  "co-state-by-token",
  "de-consistent-radius",
  "de-no-shadow-dark",
  "mo-duration-by-type",
  "mo-micro-under-500",
  "mo-m3-easing",
  "mo-press-scale",
  "mo-linear-only-loops",
  "im-no-stock-cdn",
  "im-aspect-ratio",
  "im-no-distortion",
  "ic-monoline-stroke",
  "ic-currentcolor",
  "fo-label-every-input",
  "fo-correct-input-types",
  "st-focus-visible",
  "a11y-native-elements",
  "a11y-landmarks",
  "cp-no-fake-metrics",
  "cp-no-filler",
  "i18n-logical-properties",
]);

const rulesById = new Map(DEFAULT_BUILTIN_RULES.map((r) => [r.id, r]));
const detectedRuleIds = new Set(CRAFT_CHECK_INDEX.map((c) => c.ruleId));
const deferredRuleIds = new Set(DEFERRED_CHECKS.map((d) => d.ruleId));

describe("rules ↔ checks coverage", () => {
  it("every detector maps to a real, checkable taxonomy rule", () => {
    for (const check of CRAFT_CHECK_INDEX) {
      const rule = rulesById.get(check.ruleId);
      expect(rule, `detector "${check.id}" points at unknown rule "${check.ruleId}"`).toBeDefined();
      expect(
        rule!.checkable,
        `rule "${check.ruleId}" has a detector but isn't marked checkable`,
      ).toBe(true);
    }
  });

  it("every deferred entry maps to a real, checkable taxonomy rule", () => {
    for (const d of DEFERRED_CHECKS) {
      const rule = rulesById.get(d.ruleId);
      expect(rule, `deferred entry points at unknown rule "${d.ruleId}"`).toBeDefined();
      expect(rule!.checkable, `deferred rule "${d.ruleId}" isn't marked checkable`).toBe(true);
    }
  });

  it("no rule is claimed twice (two detectors, or detected AND deferred)", () => {
    expect(detectedRuleIds.size).toBe(CRAFT_CHECK_INDEX.length);
    for (const id of detectedRuleIds) {
      expect(deferredRuleIds.has(id), `rule "${id}" is both detected and deferred`).toBe(false);
    }
  });

  it("detector tier matches the rule's declared tier", () => {
    for (const check of CRAFT_CHECK_INDEX) {
      const rule = rulesById.get(check.ruleId);
      if (rule?.tier) {
        expect(
          check.tier,
          `tier drift on "${check.ruleId}": detector says ${check.tier}, taxonomy says ${rule.tier}`,
        ).toBe(rule.tier);
      }
    }
  });

  it("every checkable rule resolves: detector, deferred, or the explicit backlog", () => {
    const unaccounted = DEFAULT_BUILTIN_RULES.filter(
      (r) =>
        r.checkable === true &&
        !detectedRuleIds.has(r.id) &&
        !deferredRuleIds.has(r.id) &&
        !DETECTOR_BACKLOG.has(r.id),
    ).map((r) => r.id);
    expect(
      unaccounted,
      "checkable rules with no detector, no deferred entry, and no backlog entry — " +
        "wire a detector in craft-checks.ts or add the id to DETECTOR_BACKLOG deliberately",
    ).toEqual([]);
  });

  it("the backlog ledger holds no stale or bogus entries", () => {
    for (const id of DETECTOR_BACKLOG) {
      const rule = rulesById.get(id);
      expect(rule, `backlog entry "${id}" is not a taxonomy rule`).toBeDefined();
      expect(rule!.checkable, `backlog entry "${id}" is not marked checkable`).toBe(true);
      expect(
        detectedRuleIds.has(id) || deferredRuleIds.has(id),
        `backlog entry "${id}" is now implemented — remove it from DETECTOR_BACKLOG`,
      ).toBe(false);
    }
  });
});
