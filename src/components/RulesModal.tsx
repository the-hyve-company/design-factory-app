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

import { useEffect, useMemo, useRef, useState } from "react";
import { DfModal } from "@/components/DfModal";
import { RuleCreateModal } from "@/components/RuleCreateModal";
import {
  groupRulesByCategory,
  getEffectiveRules,
  type Rule,
  type RuleCategoryMeta,
} from "@/data/rules-taxonomy";
import { useT, t as tFn, tf } from "@/i18n";
import type { Lang } from "@/i18n";
import { ruleTitle, ruleDescription } from "@/i18n/builtin-labels";

/** Localized category label/hint with fallback to the meta-provided string.
 *  Builtin categories (anti-slop, tone, motion, color, language, voice,
 *  layout, custom) have keys in strings.ts; user-added categories (no key)
 *  fall back to the rendered label as-is. */
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
  onCreateRule?: (rule: Rule) => Promise<void> | void;
}

interface FilteredGroup {
  meta: RuleCategoryMeta;
  rules: Rule[];
}

function filterGroups(
  groups: Array<{ meta: RuleCategoryMeta; rules: Rule[] }>,
  query: string,
  lang: Lang,
): { filtered: FilteredGroup[]; matched: Set<string> } {
  const q = query.trim().toLowerCase();
  if (!q) return { filtered: groups, matched: new Set() };
  const matched = new Set<string>();
  const filtered = groups
    .map((g) => {
      // Match on canonical (en) AND localized title/description so query
      // works equally well in pt and en — user typing "emoji" or
      // "emojis" hits the same row regardless of UI language.
      const catLocalized = localizedCatLabel(g.meta).toLowerCase();
      const rules = g.rules.filter((r) => {
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
}: RulesModalProps) {
  const { t, lang } = useT();
  // Recompute groups whenever the catalog version bumps (e.g., user
  // created a rule via the inline modal). Without this dep the modal
  // would show a stale list until the next mount.
  const groups = useMemo(() => groupRulesByCategory(), [catalogVersion, open]);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(initial));
  const [query, setQuery] = useState("");
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
    () => filterGroups(groups, query, lang),
    [groups, query, lang],
  );
  const visibleGroups = filtered;
  const isExpanded = (catId: string): boolean =>
    query.trim() ? matched.has(catId) : expanded.has(catId);

  const totalCount = useMemo(() => getEffectiveRules().length, [groups]);

  const toggleCategory = (id: string) => {
    if (query.trim()) return;
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

  const handleRuleCreated = async (rule: Rule) => {
    // Auto-select the newly-created rule for this project. Persistence is
    // the host's responsibility (onCreateRule callback).
    if (onCreateRule) {
      await onCreateRule(rule);
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

function RuleRow({ rule, checked, lang, onToggle }: RuleRowProps) {
  const title = ruleTitle(rule, lang);
  const desc = ruleDescription(rule, lang);
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
      {desc && <span className="dmv2-row-desc">{desc}</span>}
    </button>
  );
}
