// FormatModal.tsx — Output category × subitem picker.
//
// Categories are collapsable accordions, each holding a vertical list
// of items. Single-select with radio behavior: click an item, modal
// closes (Apply is implicit on pick).
//
// Header pattern: <div class=dmv2-cat-head><button class=dmv2-cat-head-main>
// with caret rotation, matching RulesModal so the click target is the
// header label rather than the whole chrome container. First category
// (Video) defaults to open.
//
// Visual: same skeu vocabulary as DirectionModalV2 / RulesModal.
// Selected state uses the unified `dmv2-row-check-dot` accent dot
// pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { DfModal } from "@/components/DfModal";
import {
  getEffectiveFormatTaxonomy,
  type FormatCategory,
  type FormatItem,
  type FormatSelection,
} from "@/data/format-taxonomy";
import { useT, tf } from "@/i18n";
import type { Lang } from "@/i18n";
import {
  formatCategoryLabel,
  formatCategoryHint,
  formatItemLabel,
  formatItemDescriptor,
} from "@/i18n/builtin-labels";

interface FilteredFormatGroup {
  cat: FormatCategory;
  items: FormatItem[];
}

function filterFormatGroups(
  taxonomy: FormatCategory[],
  query: string,
  lang: Lang,
): { filtered: FilteredFormatGroup[]; matched: Set<string> } {
  const q = query.trim().toLowerCase();
  if (!q)
    return { filtered: taxonomy.map((c) => ({ cat: c, items: c.items })), matched: new Set() };
  const matched = new Set<string>();
  const filtered: FilteredFormatGroup[] = taxonomy
    .map((c) => {
      const catLabel = formatCategoryLabel(c, lang).toLowerCase();
      const items = c.items.filter((i) => {
        const localizedLabel = formatItemLabel(c.id, i, lang).toLowerCase();
        const localizedDesc = (formatItemDescriptor(c.id, i, lang) ?? "").toLowerCase();
        return (
          i.label.toLowerCase().includes(q) ||
          localizedLabel.includes(q) ||
          (i.descriptor ?? "").toLowerCase().includes(q) ||
          localizedDesc.includes(q) ||
          c.label.toLowerCase().includes(q) ||
          catLabel.includes(q)
        );
      });
      if (items.length > 0) matched.add(c.id);
      return { cat: c, items };
    })
    .filter((g) => g.items.length > 0);
  return { filtered, matched };
}

interface FormatModalProps {
  open: boolean;
  initial: FormatSelection | null;
  onClose: () => void;
  onApply: (next: FormatSelection | null) => void;
}

export function FormatModal({ open, initial, onClose, onApply }: FormatModalProps) {
  const { t, lang } = useT();
  // v6 bug-fix: memoize the taxonomy. Previous version read it inline at
  // every render, returning a new array reference, which caused the
  // useEffect dep `[open, initial, taxonomy]` to fire infinitely. The
  // effect reset `expanded` to default on every render — and that's why
  // the user reported "categoria não colapsa": clicks on the cat
  // header set expanded, but the effect immediately reverted it.
  const taxonomy: FormatCategory[] = useMemo(() => getEffectiveFormatTaxonomy(), []);
  const [draft, setDraft] = useState<FormatSelection | null>(initial);
  // search query — parity with RulesModal. Filters items live by
  // category label / item label / descriptor.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Track which categories are expanded. Default: the category of the
  // initial selection is open; if none, the first category is open.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    if (initial) {
      set.add(initial.categoryId);
    } else if (taxonomy.length > 0) {
      set.add(taxonomy[0].id);
    }
    return set;
  });

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setQuery("");
    const next = new Set<string>();
    if (initial) next.add(initial.categoryId);
    else if (taxonomy.length > 0) next.add(taxonomy[0].id);
    setExpanded(next);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    // We intentionally omit `taxonomy` from deps — it's frozen for the
    // life of the component (memoized above). Including it would re-run
    // this effect on every render and undo manual category toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const { filtered, matched } = useMemo(
    () => filterFormatGroups(taxonomy, query, lang),
    [taxonomy, query, lang],
  );

  const toggleCategory = (id: string) => {
    if (query.trim()) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isExpanded = (catId: string): boolean =>
    query.trim() ? matched.has(catId) : expanded.has(catId);

  const pickItem = (categoryId: string, itemId: string) => {
    const sel: FormatSelection = { categoryId, itemId };
    setDraft(sel);
    onApply(sel);
    onClose();
  };

  const clear = () => {
    setDraft(null);
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };

  const totalItems = taxonomy.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <DfModal
      open={open}
      onClose={onClose}
      size="lg"
      className="fmt-modal"
      head={
        <>
          <header className="dmv2-head">
            <div className="dmv2-head-text">
              <span className="dmv2-eyebrow">{t("format.modal.eyebrow")}</span>
              <h2 className="dmv2-title">{t("format.modal.title")}</h2>
              <p className="dmv2-subtitle">{t("format.modal.subtitle")}</p>
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
              placeholder={tf("format.search.placeholder", totalItems)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("format.search.aria")}
            />
            {query && (
              <button
                type="button"
                className="dmv2-search-clear"
                onClick={() => setQuery("")}
                aria-label={t("format.search.clear.aria")}
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
            {draft
              ? (() => {
                  const cat = taxonomy.find((c) => c.id === draft.categoryId);
                  const item = cat?.items.find((i) => i.id === draft.itemId);
                  return cat && item
                    ? `${formatCategoryLabel(cat, lang)} · ${formatItemLabel(cat.id, item, lang)}`
                    : "—";
                })()
              : tf("format.foot.empty", totalItems)}
          </span>
          <div className="dmv2-foot-actions">
            <button type="button" className="dmv2-btn-text" onClick={clear} disabled={!draft}>
              {t("modal.clear")}
            </button>
            <button type="button" className="dmv2-btn-primary" onClick={apply}>
              {t("modal.apply")}
            </button>
          </div>
        </div>
      }
    >
      <div className="dmv2-cats">
        {filtered.length === 0 && (
          <div className="dmv2-empty">
            <span>{tf("format.empty.search", query)}</span>
            <button type="button" className="dmv2-btn-text" onClick={() => setQuery("")}>
              {t("format.empty.clear")}
            </button>
          </div>
        )}
        {filtered.map(({ cat, items }) => {
          const isOpen = isExpanded(cat.id);
          const isPickedCat = draft?.categoryId === cat.id;
          const pickedInside = isPickedCat ? 1 : 0;
          const searchActive = !!query.trim();
          return (
            <section
              key={cat.id}
              className={`dmv2-cat${isOpen ? " is-open" : ""}${isPickedCat ? " has-selected" : ""}`}
            >
              {/* v6: split <div class=dmv2-cat-head> with inner <button
               * class=dmv2-cat-head-main> — same shape as RulesModal so
               * collapse behavior is unified across modals. */}
              <div className="dmv2-cat-head">
                <button
                  type="button"
                  className="dmv2-cat-head-main"
                  onClick={() => toggleCategory(cat.id)}
                  aria-expanded={isOpen}
                  disabled={searchActive}
                >
                  <span className="dmv2-cat-label">{formatCategoryLabel(cat, lang)}</span>
                  {formatCategoryHint(cat, lang) && (
                    <span className="dmv2-cat-hint">{formatCategoryHint(cat, lang)}</span>
                  )}
                  <span className="dmv2-cat-count">
                    {pickedInside > 0 ? `${pickedInside} / ${items.length}` : `${items.length}`}
                  </span>
                  <span className="dmv2-cat-caret" aria-hidden>
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>
              </div>
              {isOpen && (
                <div className="dmv2-rows">
                  {items.map((item) => {
                    const on = isPickedCat && draft?.itemId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`dmv2-row${on ? " is-on" : ""}`}
                        onClick={() => pickItem(cat.id, item.id)}
                      >
                        <span className="dmv2-row-check" aria-hidden>
                          <span className="dmv2-row-check-dot" />
                        </span>
                        <span className="dmv2-row-label">
                          {formatItemLabel(cat.id, item, lang)}
                        </span>
                        {formatItemDescriptor(cat.id, item, lang) && (
                          <span className="dmv2-row-desc">
                            {formatItemDescriptor(cat.id, item, lang)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </DfModal>
  );
}
