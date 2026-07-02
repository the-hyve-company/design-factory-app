// RulesModal.tsx — Unified Rules picker (replaces DirectionModalV2).
//
// Behavior carries forward from DirectionModalV2:
//   - ONE row pattern across ALL rules (.dmv2-row).
//   - Categories collapsable, multi-select within and across categories.
//   - Per-category "select all" key.
//   - Search filters everything live (title + description + category).
//
// Schema and surfaces specific to this picker:
//   - Schema is FLAT (Rule[]) — categories are computed at runtime.
//   - "+ New rule" trigger in the footer opens RuleCreateModal inline.
//   - Newly-created rules land immediately under their chosen category
//     and are flagged is-on (selected for the current project).
//
// Scale-132 affordances (the catalog grew ~50 → 132 rules):
//   - Tier (P0/P1/P2), core and auto-checked badges per row.
//   - Filter pills (core / selected / per-tier) compose with search;
//     an active filter force-expands matching categories like search.
//   - "Restaurar padrão" resets the draft to the member's saved default
//     set (`default_rule_ids`), falling back to the factory core set.

import { useEffect, useMemo, useRef, useState } from "react";
import { DfModal } from "@/components/DfModal";
import { RuleCreateModal, type RuleCreateOptions } from "@/components/RuleCreateModal";
import {
  groupRulesByCategory,
  getCoreRuleIds,
  getEffectiveRules,
  type Rule,
  type RuleCategoryMeta,
} from "@/data/rules-taxonomy";
import { useT, t as tFn, tf } from "@/i18n";
import type { Lang } from "@/i18n";
import { ruleTitle, ruleDescription } from "@/i18n/builtin-labels";

/** Localized category label/hint with fallback to the meta-provided string.
 *  Builtin categories (anti-slop, layout, typography, color, depth, motion,
 *  imagery, icons, forms, states, custom) have keys in strings.ts;
 *  user-added categories (no key) fall back to the rendered label as-is. */
function localizedCatLabel(meta: RuleCategoryMeta): string {
  const key = `rules.cat.${meta.id}`;
  const v = tFn(key);
  return v === key ? meta.label : v;
}
function localizedCatHint(meta: RuleCategoryMeta): string | null {
  const key = `rules.cat.${meta.id}.hint`;
  const v = tFn(key);
  if (v !== key) return v;
  return meta.hint ?? null;
}

interface RulesModalProps {
  open: boolean;
  initial: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
  /** Tick when the underlying catalog changes (e.g., user adds a rule). */
  catalogVersion?: number;
  /** Called when a new rule is created from the inline "+ New rule" trigger. */
  onCreateRule?: (rule: Rule, opts: RuleCreateOptions) => Promise<void> | void;
  /** The member's saved default set (`default_rule_ids`) — target of the
   *  "Restaurar padrão" footer action. Absent/empty → factory core set. */
  defaultIds?: string[];
}

interface FilteredGroup {
  meta: RuleCategoryMeta;
  rules: Rule[];
}

/** Quick-filter axis for the 132-rule catalog. "all" = no filter. */
export type RuleFilter = "all" | "core" | "selected" | "P0" | "P1" | "P2";

/** Pure predicate — one rule against one filter pill. Exported for tests. */
export function ruleMatchesFilter(
  rule: Rule,
  filter: RuleFilter,
  selected: ReadonlySet<string>,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "core":
      return rule.core === true;
    case "selected":
      return selected.has(rule.id);
    default:
      return rule.tier === filter;
  }
}

/** Filter + search composition over the category groups. Exported for
 *  tests. `matched` drives forced expansion while a query OR a filter
 *  pill is active. */
export function filterGroups(
  groups: Array<{ meta: RuleCategoryMeta; rules: Rule[] }>,
  query: string,
  lang: Lang,
  filter: RuleFilter = "all",
  selected: ReadonlySet<string> = new Set<string>(),
): { filtered: FilteredGroup[]; matched: Set<string> } {
  const q = query.trim().toLowerCase();
  if (!q && filter === "all") return { filtered: groups, matched: new Set() };
  const matched = new Set<string>();
  const filtered = groups
    .map((g) => {
      // Match on canonical (en) AND localized title/description so query
      // works equally well in pt and en — user typing "emoji" or
      // "emojis" hits the same row regardless of UI language.
      const catLocalized = localizedCatLabel(g.meta).toLowerCase();
      const rules = g.rules.filter((r) => {
        if (!ruleMatchesFilter(r, filter, selected)) return false;
        if (!q) return true;
        const localizedTitle = ruleTitle(r, lang).toLowerCase();
        const localizedDesc = ruleDescription(r, lang).toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          localizedTitle.includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          localizedDesc.includes(q) ||
          g.meta.label.toLowerCase().includes(q) ||
          catLocalized.includes(q) ||
          r.category.toLowerCase().includes(q)
        );
      });
      if (rules.length > 0) matched.add(g.meta.id);
      return { meta: g.meta, rules };
    })
    .filter((g) => g.rules.length > 0);
  return { filtered, matched };
}

export function RulesModal({
  open,
  initial,
  onClose,
  onApply,
  catalogVersion = 0,
  onCreateRule,
  defaultIds,
}: RulesModalProps) {
  const { t, lang } = useT();
  // Recompute groups whenever the catalog version bumps (e.g., user
  // created a rule via the inline modal). Without this dep the modal
  // would show a stale list until the next mount.
  const groups = useMemo(() => groupRulesByCategory(), [catalogVersion, open]);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(initial));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RuleFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (g.rules.some((r) => initial.includes(r.id))) set.add(g.meta.id);
    }
    if (set.size === 0 && groups.length > 0) set.add(groups[0].meta.id);
    return set;
  });
  const [createOpen, setCreateOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Hydrate when modal opens.
  useEffect(() => {
    if (!open) return;
    setDraft(new Set(initial));
    setQuery("");
    setFilter("all");
    const next = new Set<string>();
    for (const g of groups) {
      if (g.rules.some((r) => initial.includes(r.id))) next.add(g.meta.id);
    }
    if (next.size === 0 && groups.length > 0) next.add(groups[0].meta.id);
    setExpanded(next);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, [open, initial, groups]);

  const { filtered, matched } = useMemo(
    () => filterGroups(groups, query, lang, filter, draft),
    [groups, query, lang, filter, draft],
  );
  const visibleGroups = filtered;
  // A live query OR an active filter pill locks categories expanded so
  // every match is visible (same affordance search always had).
  const filtersActive = Boolean(query.trim()) || filter !== "all";
  const isExpanded = (catId: string): boolean =>
    filtersActive ? matched.has(catId) : expanded.has(catId);

  const totalCount = useMemo(() => getEffectiveRules().length, [groups]);

  const toggleCategory = (id: string) => {
    if (filtersActive) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInCategory = (rules: Rule[]) => {
    setDraft((prev) => {
      const next = new Set(prev);
      const allOn = rules.every((r) => next.has(r.id));
      if (allOn) {
        for (const r of rules) next.delete(r.id);
      } else {
        for (const r of rules) next.add(r.id);
      }
      return next;
    });
  };

  const clear = () => setDraft(new Set());

  // "Restaurar padrão" — reset the draft to the member's saved default
  // set; when none is saved yet, the factory core set (14 rules).
  const restoreDefault = () => {
    setDraft(new Set(defaultIds && defaultIds.length > 0 ? defaultIds : getCoreRuleIds()));
  };

  const apply = () => {
    onApply([...draft]);
    onClose();
  };

  const countInGroup = (rules: Rule[]): number => rules.filter((r) => draft.has(r.id)).length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setDraft((prev) => {
        const next = new Set(prev);
        for (const g of visibleGroups) {
          for (const r of g.rules) next.add(r.id);
        }
        return next;
      });
    }
  };

  const totalSelected = draft.size;

  const handleRuleCreated = async (rule: Rule, opts: RuleCreateOptions) => {
    // Auto-select the newly-created rule for this project. Persistence is
    // the host's responsibility (onCreateRule callback) — including the
    // opt-in "include in my default" flag.
    if (onCreateRule) {
      await onCreateRule(rule, opts);
    }
    setDraft((prev) => {
      const next = new Set(prev);
      next.add(rule.id);
      return next;
    });
    // Force expansion of the (possibly new) category so the row is visible.
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(rule.category);
      return next;
    });
    setCreateOpen(false);
  };

  return (
    <>
      <DfModal
        open={open}
        onClose={onClose}
        size="xl"
        className="dmv2-modal"
        head={
          <>
            <header className="dmv2-head">
              <div className="dmv2-head-text">
                <span className="dmv2-eyebrow">{t("rules.modal.eyebrow")}</span>
                <h2 className="dmv2-title">{t("rules.modal.title")}</h2>
                <p className="dmv2-subtitle">{t("rules.modal.subtitle")}</p>
              </div>
              <button
                type="button"
                className="dmv2-close"
                aria-label={t("modal.close")}
                onClick={onClose}
              >
                <span aria-hidden>×</span>
              </button>
            </header>
            <div className="dmv2-search-wrap">
              <span className="dmv2-search-glyph" aria-hidden>
                ⌕
              </span>
              <input
                ref={searchRef}
                className="dmv2-search-input"
                type="search"
                placeholder={tf("rules.search.placeholder", totalCount)}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t("rules.search.aria")}
              />
              {query && (
                <button
                  type="button"
                  className="dmv2-search-clear"
                  onClick={() => setQuery("")}
                  aria-label={t("rules.search.clear.aria")}
                >
                  ×
                </button>
              )}
            </div>
            <div className="dmv2-filter-row" role="group" aria-label={t("rules.filter.aria")}>
              {(
                [
                  { id: "core" as const, label: t("rules.filter.core") },
                  {
                    id: "selected" as const,
                    label:
                      totalSelected > 0
                        ? `${t("rules.filter.selected")} · ${totalSelected}`
                        : t("rules.filter.selected"),
                  },
                  { id: "P0" as const, label: "P0" },
                  { id: "P1" as const, label: "P1" },
                  { id: "P2" as const, label: "P2" },
                ] satisfies Array<{ id: RuleFilter; label: string }>
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  className={`dmv2-filter-pill${filter === pill.id ? " is-on" : ""}`}
                  aria-pressed={filter === pill.id}
                  onClick={() => setFilter((curr) => (curr === pill.id ? "all" : pill.id))}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </>
        }
        foot={
          <div className="dmv2-foot">
            <span className="dmv2-foot-stat">
              {totalSelected === 0
                ? t("rules.foot.none")
                : tf(
                    totalSelected === 1 ? "rules.foot.count" : "rules.foot.count.plural",
                    totalSelected,
                  )}
            </span>
            <div className="dmv2-foot-actions">
              <button
                type="button"
                className="dmv2-btn-text dmv2-btn-text--accent"
                onClick={() => setCreateOpen(true)}
                aria-label={t("rules.create.aria")}
              >
                {t("rules.create.label")}
              </button>
              <button
                type="button"
                className="dmv2-btn-text"
                onClick={restoreDefault}
                title={t("rules.restore.default.title")}
              >
                {t("rules.restore.default")}
              </button>
              <button
                type="button"
                className="dmv2-btn-text"
                onClick={clear}
                disabled={totalSelected === 0}
              >
                {t("modal.clearall")}
              </button>
              <button type="button" className="dmv2-btn-primary" onClick={apply}>
                {t("modal.apply")}
              </button>
            </div>
          </div>
        }
      >
        <div className="dmv2-cats" onKeyDown={handleKeyDown}>
          {visibleGroups.length === 0 && (
            <div className="dmv2-empty">
              <span>{tf("rules.empty.search", query)}</span>
              <button type="button" className="dmv2-btn-text" onClick={() => setQuery("")}>
                {t("rules.empty.clear")}
              </button>
            </div>
          )}
          {visibleGroups.map((g) => {
            const catOpen = isExpanded(g.meta.id);
            const count = countInGroup(g.rules);
            const allOn = g.rules.length > 0 && g.rules.every((r) => draft.has(r.id));
            return (
              <RuleCategorySection
                key={g.meta.id}
                meta={g.meta}
                rules={g.rules}
                open={catOpen}
                count={count}
                allOn={allOn}
                draft={draft}
                searchActive={!!query.trim()}
                lang={lang}
                onToggleCategory={() => toggleCategory(g.meta.id)}
                onToggleItem={toggleItem}
                onSelectAll={() => selectAllInCategory(g.rules)}
              />
            );
          })}
        </div>
      </DfModal>

      <RuleCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleRuleCreated}
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

interface RuleCategorySectionProps {
  meta: RuleCategoryMeta;
  rules: Rule[];
  open: boolean;
  count: number;
  allOn: boolean;
  draft: Set<string>;
  searchActive: boolean;
  lang: Lang;
  onToggleCategory: () => void;
  onToggleItem: (id: string) => void;
  onSelectAll: () => void;
}

function RuleCategorySection({
  meta,
  rules,
  open,
  count,
  allOn,
  draft,
  searchActive,
  lang,
  onToggleCategory,
  onToggleItem,
  onSelectAll,
}: RuleCategorySectionProps) {
  const catLabel = localizedCatLabel(meta);
  const catHint = localizedCatHint(meta);
  return (
    <section className={`dmv2-cat${open ? " is-open" : ""}${count > 0 ? " has-selected" : ""}`}>
      <div className="dmv2-cat-head">
        <button
          type="button"
          className="dmv2-cat-head-main"
          onClick={onToggleCategory}
          aria-expanded={open}
          disabled={searchActive}
        >
          <span className="dmv2-cat-label">{catLabel}</span>
          {catHint && <span className="dmv2-cat-hint">{catHint}</span>}
          <span className="dmv2-cat-count">
            {count > 0 ? `${count} / ${rules.length}` : `${rules.length}`}
          </span>
          <span className="dmv2-cat-caret" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
        <button
          type="button"
          className={`dmv2-cat-selectall${allOn ? " is-on" : ""}`}
          onClick={onSelectAll}
          aria-label={
            allOn
              ? `${tFn("rules.selectall.deselect")} ${catLabel}`
              : `${tFn("rules.selectall.select")} ${catLabel}`
          }
          title={
            allOn ? tFn("rules.selectall.deselect.short") : tFn("rules.selectall.select.short")
          }
        >
          {allOn ? "−" : "+"}
        </button>
      </div>
      {open && (
        <div className="dmv2-rows" role="group" aria-label={catLabel}>
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              checked={draft.has(rule.id)}
              lang={lang}
              onToggle={() => onToggleItem(rule.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface RuleRowProps {
  rule: Rule;
  checked: boolean;
  lang: Lang;
  onToggle: () => void;
}

/** Ordered badge descriptors for a rule row. Pure — exported for tests.
 *  `label`/`title` are i18n KEYS except tier (literal P0/P1/P2). */
export function ruleBadges(
  rule: Rule,
): Array<{ kind: "tier" | "core" | "auto"; className: string; label: string; titleKey: string }> {
  const out: Array<{
    kind: "tier" | "core" | "auto";
    className: string;
    label: string;
    titleKey: string;
  }> = [];
  if (rule.tier) {
    out.push({
      kind: "tier",
      className: `dmv2-row-badge dmv2-row-badge--${rule.tier.toLowerCase()}`,
      label: rule.tier,
      titleKey: `rules.badge.tier.${rule.tier.toLowerCase()}.title`,
    });
  }
  if (rule.core) {
    out.push({
      kind: "core",
      className: "dmv2-row-badge dmv2-row-badge--core",
      label: "rules.badge.core",
      titleKey: "rules.badge.core.title",
    });
  }
  if (rule.checkable) {
    out.push({
      kind: "auto",
      className: "dmv2-row-badge dmv2-row-badge--auto",
      label: "rules.badge.auto",
      titleKey: "rules.badge.auto.title",
    });
  }
  return out;
}

function RuleRow({ rule, checked, lang, onToggle }: RuleRowProps) {
  const title = ruleTitle(rule, lang);
  const desc = ruleDescription(rule, lang);
  const badges = ruleBadges(rule);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`dmv2-row${checked ? " is-on" : ""}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="dmv2-row-check" aria-hidden>
        <span className="dmv2-row-check-dot" />
      </span>
      <span className="dmv2-row-label">{title}</span>
      {/* Metadata column: tier/core/auto badges sit right-aligned before
       * the desc so 132 rows scan as a consistent table. */}
      {badges.map((b) => (
        <span key={b.kind} className={b.className} title={tFn(b.titleKey)}>
          {b.kind === "tier" ? b.label : tFn(b.label)}
        </span>
      ))}
      {desc && <span className="dmv2-row-desc">{desc}</span>}
    </button>
  );
}
