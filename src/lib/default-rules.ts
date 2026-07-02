// default-rules.ts — end-to-end slot for the personal default rule set
// (`default_rule_ids`): the ids that pre-fill the New Project rules picker.
//
// Storage mirrors `default_provider`:
//   · canonical: filesystem GlobalConfig (~/.design-factory/config.json)
//     via writeGlobalConfig — syncs between devices with the rest of the
//     config file.
//   · fallback:  db.setSetting("default_rule_ids", JSON string) — read
//     path when the bridge is offline / Tauri hasn't wired /config.
//
// Read resolution (loadDefaultRuleIds): filesystem first, db fallback,
// both piped through resolveDefaultRuleIds — unknown ids dropped,
// absent/empty/corrupt falls back to the 14-rule factory core set.
//
// A module-level cache (primed at boot by hydrateConfigSlots and on every
// load/save) lets synchronous consumers — the picker's useState
// initializer — start from the user's default instead of the factory
// core, so the first paint of the New Project modal already shows the
// personalized set.

import { db, readGlobalConfig, writeGlobalConfig } from "@/lib/claude-bridge";
import { findRule, getCoreRuleIds, resolveDefaultRuleIds } from "@/data/rules-taxonomy";

/** Fired on window whenever the default set is saved, so open surfaces
 *  (picker, editor) can re-sync without a remount. detail: { ids }. */
export const DEFAULT_RULES_CHANGE_EVENT = "df:default-rules-change";

let _cached: string[] | null = null;

/** Synchronous read of the last known default set. Falls back to the
 *  factory core set before the first load/prime. Returns a copy. */
export function getCachedDefaultRuleIds(): string[] {
  return _cached ? [..._cached] : getCoreRuleIds();
}

/** Prime the cache from boot hydration (hydrateConfigSlots) so the very
 *  first picker mount is synchronous-correct. */
export function primeDefaultRuleIdsCache(ids: string[]): void {
  _cached = [...ids];
}

/** Test-only: reset the module cache between cases. */
export function __resetDefaultRuleIdsCacheForTests(): void {
  _cached = null;
}

/** Normalize an id list before persisting: dedupe (order preserved) and
 *  drop ids that don't resolve to a rule in the effective catalog. */
export function normalizeDefaultRuleIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    if (findRule(id) === null) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Load the personal default rule set: filesystem config first, db
 *  fallback, resolved against the current catalog. Never rejects. */
export async function loadDefaultRuleIds(): Promise<string[]> {
  const cfg = await readGlobalConfig().catch(() => null);
  const raw =
    cfg && Array.isArray(cfg.default_rule_ids)
      ? cfg.default_rule_ids
      : await db.getSetting("default_rule_ids").catch(() => null);
  const resolved = resolveDefaultRuleIds(raw);
  _cached = [...resolved];
  return resolved;
}

/** Persist the personal default rule set to BOTH stores (filesystem
 *  canonical + db mirror), update the cache and notify open surfaces.
 *  Returns the normalized list actually saved. Note: saving [] is
 *  allowed at the storage layer, but resolveDefaultRuleIds treats an
 *  empty list as "unset" and falls back to the factory core set on the
 *  next read — per-project "start blank" stays a picker-level action. */
export async function saveDefaultRuleIds(ids: string[]): Promise<string[]> {
  const clean = normalizeDefaultRuleIds(ids);
  _cached = [...clean];
  await writeGlobalConfig({ default_rule_ids: clean }).catch(() => {});
  await db.setSetting("default_rule_ids", JSON.stringify(clean)).catch(() => {});
  try {
    window.dispatchEvent(
      new CustomEvent(DEFAULT_RULES_CHANGE_EVENT, { detail: { ids: [...clean] } }),
    );
  } catch {
    /* non-browser env (tests) — event is best-effort */
  }
  return clean;
}
