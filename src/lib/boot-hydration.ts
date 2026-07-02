// boot-hydration.ts — single boot-time hydration routine for every
// global-config slot that feeds module-level catalog state.
//
// Before this module, hydration was split-brain: App.tsx bootstrapped a
// subset of slots (rules customs/overrides, format+direction overrides)
// while the rest — hidden builtin rules, canvas presets, format items —
// only hydrated inside each Settings editor's mount effect. Consequence:
// the FIRST project of a session generated with an incomplete config
// (e.g. a permanently-hidden builtin rule still reached the prompt)
// unless the user happened to visit Settings first.
//
// hydrateConfigSlots() is called once from App.tsx's boot effect and
// covers ALL slots. Resolution order per slot mirrors the editors'
// persistence layer: filesystem GlobalConfig field first (canonical,
// syncs between devices), db.getSetting fallback (offline / Tauri).
//
// The function takes the already-read config + a settings reader so it
// stays testable without a bridge.

import type { GlobalConfig } from "@/lib/claude-bridge";
import {
  setFormatOverrides,
  setDirectionOverrides,
  setDisabledFormatIds,
  setDisabledDirectionIds,
  setCustomFormats,
  setCustomDirections,
} from "@/data/direction-data";
import {
  RuleSchema,
  setUserRules,
  setBuiltinOverrides,
  setDisabledRuleIds,
  setHiddenBuiltinRuleIds,
  setHiddenBuiltinRuleCategoryIds,
  setCustomRuleCategories,
  setCategoryLabelOverrides,
  resolveDefaultRuleIds,
  type Rule,
} from "@/data/rules-taxonomy";
import {
  setCustomFormatCategories,
  setDisabledFormatItemIds,
  setHiddenBuiltinFormatItemIds,
  setHiddenBuiltinFormatCategoryIds,
} from "@/data/format-taxonomy";
import {
  CanvasPresetSchema,
  setCustomCanvasPresets,
  setDisabledCanvasPresetIds,
  setHiddenBuiltinCanvasIds,
  type CanvasPreset,
} from "@/data/canvas-presets";
import { primeDefaultRuleIdsCache } from "@/lib/default-rules";

/** Reader for the db fallback store. App.tsx passes
 *  `(k) => db.getSetting(k)`; tests pass an in-memory map. */
export type BootSettingReader = (key: string) => Promise<string | null>;

// ─── Per-slot readers ────────────────────────────────────────────────
// fs config value wins when present with the right shape; otherwise the
// db key is read and JSON-parsed. Corrupt/absent → null (slot untouched,
// keeps its factory default).

async function readListSlot(
  cfgValue: unknown,
  dbKey: string,
  getSetting: BootSettingReader,
): Promise<unknown[] | null> {
  if (Array.isArray(cfgValue)) return cfgValue;
  const raw = await getSetting(dbKey).catch(() => null);
  if (!raw) return null;
  try {
    const a: unknown = JSON.parse(raw);
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}

async function readMapSlot(
  cfgValue: unknown,
  dbKey: string,
  getSetting: BootSettingReader,
): Promise<Record<string, unknown> | null> {
  if (cfgValue && typeof cfgValue === "object" && !Array.isArray(cfgValue)) {
    return cfgValue as Record<string, unknown>;
  }
  const raw = await getSetting(dbKey).catch(() => null);
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asStringArray(arr: unknown[]): string[] {
  return arr.filter((v): v is string => typeof v === "string");
}

// ─── The routine ──────────────────────────────────────────────────────

/**
 * Hydrate every module-level config slot from the global config (+ db
 * fallback). Call once at boot, before the first picker/generation can
 * happen. Slots with no persisted value keep their factory defaults.
 */
export async function hydrateConfigSlots(
  cfg: GlobalConfig | null,
  getSetting: BootSettingReader,
): Promise<void> {
  // ── Formats + directions (legacy direction-data catalog) ─────────
  if (cfg?.format_overrides) setFormatOverrides(cfg.format_overrides);
  if (cfg?.direction_overrides) setDirectionOverrides(cfg.direction_overrides);
  const fmtDisabled = await readListSlot(undefined, "formats_disabled", getSetting);
  if (fmtDisabled) setDisabledFormatIds(asStringArray(fmtDisabled));
  const dirDisabled = await readListSlot(undefined, "directions_disabled", getSetting);
  if (dirDisabled) setDisabledDirectionIds(asStringArray(dirDisabled));
  if (Array.isArray(cfg?.custom_formats)) setCustomFormats(cfg!.custom_formats as never);
  if (Array.isArray(cfg?.custom_directions)) setCustomDirections(cfg!.custom_directions as never);

  // ── Rules catalog ─────────────────────────────────────────────────
  const customRules = await readListSlot(cfg?.custom_rules, "custom_rules", getSetting);
  if (customRules) {
    const parsed: Rule[] = [];
    for (const raw of customRules) {
      const r = RuleSchema.safeParse(raw);
      if (r.success) parsed.push(r.data);
    }
    setUserRules(parsed);
  }
  const ruleOverrides = await readMapSlot(
    cfg?.builtin_rule_overrides,
    "builtin_rule_overrides",
    getSetting,
  );
  if (ruleOverrides) setBuiltinOverrides(ruleOverrides as never);
  const rulesDisabled = await readListSlot(undefined, "rules_disabled", getSetting);
  if (rulesDisabled) setDisabledRuleIds(asStringArray(rulesDisabled));
  // Previously editor-mount-only: permanently-hidden builtin rules.
  const hiddenRules = await readListSlot(
    cfg?.hidden_builtin_rules,
    "rules_hidden_builtins",
    getSetting,
  );
  if (hiddenRules) setHiddenBuiltinRuleIds(asStringArray(hiddenRules));
  if (Array.isArray(cfg?.hidden_builtin_rule_categories)) {
    setHiddenBuiltinRuleCategoryIds(asStringArray(cfg!.hidden_builtin_rule_categories));
  }
  const ruleCats = await readListSlot(
    cfg?.custom_rule_categories,
    "custom_rule_categories",
    getSetting,
  );
  if (ruleCats) setCustomRuleCategories(ruleCats as never);
  const ruleCatOverrides = await readMapSlot(
    cfg?.rule_category_overrides,
    "rule_category_overrides",
    getSetting,
  );
  if (ruleCatOverrides) setCategoryLabelOverrides(ruleCatOverrides as Record<string, string>);

  // Personal default rule set — prime the sync cache so the first
  // picker mount starts from the user's default, not the factory core.
  const defaultRuleIds =
    cfg && Array.isArray(cfg.default_rule_ids)
      ? cfg.default_rule_ids
      : await getSetting("default_rule_ids").catch(() => null);
  primeDefaultRuleIdsCache(resolveDefaultRuleIds(defaultRuleIds));

  // ── Format taxonomy (picker items) ────────────────────────────────
  const fmtCats = await readListSlot(
    cfg?.custom_format_categories,
    "custom_format_categories",
    getSetting,
  );
  if (fmtCats) setCustomFormatCategories(fmtCats as never);
  // Previously editor-mount-only: disabled + hidden format items/cats.
  const fmtItemsDisabled = await readListSlot(undefined, "format_items_disabled", getSetting);
  if (fmtItemsDisabled) setDisabledFormatItemIds(asStringArray(fmtItemsDisabled));
  const fmtItemsHidden = await readListSlot(
    cfg?.hidden_builtin_format_items,
    "format_items_hidden_builtins",
    getSetting,
  );
  if (fmtItemsHidden) setHiddenBuiltinFormatItemIds(asStringArray(fmtItemsHidden));
  const fmtCatsHidden = await readListSlot(
    cfg?.hidden_builtin_format_categories,
    "format_cats_hidden_builtins",
    getSetting,
  );
  if (fmtCatsHidden) setHiddenBuiltinFormatCategoryIds(asStringArray(fmtCatsHidden));

  // ── Canvas presets ────────────────────────────────────────────────
  // Previously editor-mount-only: ALL canvas slots.
  const canvasCustoms = await readListSlot(
    cfg?.custom_canvas_presets,
    "custom_canvas_presets",
    getSetting,
  );
  if (canvasCustoms) {
    const parsed: CanvasPreset[] = [];
    for (const raw of canvasCustoms) {
      const r = CanvasPresetSchema.safeParse(raw);
      if (r.success) parsed.push(r.data);
    }
    setCustomCanvasPresets(parsed);
  }
  const canvasDisabled = await readListSlot(undefined, "canvas_presets_disabled", getSetting);
  if (canvasDisabled) setDisabledCanvasPresetIds(asStringArray(canvasDisabled));
  const canvasHidden = await readListSlot(
    cfg?.hidden_builtin_canvas_presets,
    "canvas_presets_hidden_builtins",
    getSetting,
  );
  if (canvasHidden) setHiddenBuiltinCanvasIds(asStringArray(canvasHidden));
}
