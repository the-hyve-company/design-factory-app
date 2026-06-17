// TaxonomyManager.tsx — premium split-panel manager for any list-of-items
// taxonomy in Settings (Canvas / Formats / Rules).
//
// user: "quero rules, formats e canvas com
// gerenciamento premium em settings, bem pensados pra melhor experiencia de
// personalização, criação, edição e aprimoramento dos insumos por projeto".
//
// Anatomy (canonical, do NOT vary):
//   ┌─ SkeuHero (sm) ─────────────────────────────────────────────────────┐
//   │ kicker · title · count badge │
//   └─────────────────────────────────────────────────────────────────────┘
//   ┌──────── 320px ───────┬─────────── 1fr ────────────────────────────┐
//   │ search input │ detail / edit panel for selected item │
//   │ + Novo button │ (or empty state when nothing selected) │
//   │ ─ list rows ─ │ │
//   │ [drag] icon name │ rendered by `renderDetail({item, ...})` │
//   │ [drag] icon name │ │
//   │ [drag] icon name │ │
//   │ ──────────────── │ │
//   │ bulk actions footer │ │
//   └──────────────────────┴─────────────────────────────────────────────┘
//
// Skeu DNA:
//   · SkeuHero on top (size sm) — visual signature consistent across tabs
//   · List card surface = bezel raised, hover lift, selected = bezel pressed
//   · Detail panel = bezel raised plate
//   · Inputs = bezel recessed bowls, focus accent ring
//   · Buttons = df-tactile with LED dot for primary
//   · Drag handle = 3-dot vertical grip pattern
//
// Drag-and-drop: native HTML5 (no libs). Vertical reorder only.
// Bulk: ctrl-click / shift-click for multi-select; bulk delete + duplicate.
// Search: case-insensitive substring on title + description.
// Group-by: optional renderer to break list into category sections.
// Keyboard: ↑↓ navigate, Enter open, Del delete, Cmd+N new.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SkeuHero } from "@/components/SkeuHero";
import { useT } from "@/i18n";
import "@/styles/skeu-hero.css";
import "@/styles/settings-taxonomy.css";

// ─── Types ────────────────────────────────────────────────────────────

export interface TaxonomyItem {
  /** Stable id. */
  id: string;
  /** Display title shown in row. */
  title: string;
  /** Optional secondary line shown under the title. */
  subtitle?: string;
  /** True when item is part of the framework defaults (cannot be deleted). */
  builtin?: boolean;
  /** Whether the item is enabled (toggle off = hidden in pickers). */
  enabled?: boolean;
  /** True when a builtin has been edited (overrides applied). */
  edited?: boolean;
  /** Group label — when present, list breaks into sub-sections. */
  group?: string;
  /** Group sort key (number or string). Falls back to insertion order. */
  groupOrder?: number;
}

export interface TaxonomyGroup {
  id: string;
  label: string;
  hint?: string;
}

export interface TaxonomyManagerProps<T extends TaxonomyItem> {
  /** Eyebrow above the hero title (mono uppercase). */
  kicker: string;
  /** Hero title. */
  title: string;
  /** Subtitle prose shown under the hero, before the split panel. */
  description?: ReactNode;
  /** All items (builtin + custom + edited overlays merged). */
  items: T[];
  /** Optional group definitions — when provided list groups by item.group. */
  groups?: TaxonomyGroup[];
  /** When supplied, the right panel shows this for the selected item. */
  renderDetail: (ctx: { item: T; close: () => void }) => ReactNode;
  /** When supplied, replaces the default row content (right of drag/toggle). */
  renderRow?: (item: T) => ReactNode;
  /** Search placeholder. */
  searchPlaceholder: string;
  /** Empty state copy when no items match the search. */
  emptyTitle: string;
  emptyBody?: string;
  /** Empty state copy when the manager is fresh (no custom items yet). */
  emptyAllTitle?: string;
  emptyAllBody?: string;
  /** Triggered when the user clicks "+ New". */
  onCreate: () => void;
  /** Triggered when user toggles enabled state on a row. */
  onToggleEnabled?: (id: string, enabled: boolean) => void;
  /** Triggered when user duplicates one or more items. */
  onDuplicate?: (ids: string[]) => void;
  /** Triggered when user deletes one or more items. */
  onDelete?: (ids: string[]) => void;
  /** Triggered when user reorders items. New order array of ids. */
  onReorder?: (ids: string[]) => void;
  /** Optional preview of an item, rendered above the row title. */
  renderRowPreview?: (item: T) => ReactNode;
  /** Optional badge cluster on the right of the row (custom/edited tags). */
  renderRowBadges?: (item: T) => ReactNode;
  /** Optional bulk actions extra slot in the bulk bar. */
  renderBulkExtras?: (ids: string[]) => ReactNode;
  /** Filter by group key. When set, only that group is shown. */
  groupFilter?: string | null;
  onGroupFilterChange?: (next: string | null) => void;
  /** Total item count to show in the hero badge. */
  countLabel?: string;
  /** Localized create button label override. */
  createLabel?: string;
  /** when set, render a "Manage categories" button next to filter pills. */
  onManageCategories?: () => void;
  /** Localized label for the manage-categories CTA. */
  manageCategoriesLabel?: string;
  /** suppress the SkeuHero header (when manager is rendered inside an
   *  outer container that already provides the title — Settings · Padrões). */
  hideHero?: boolean;
  /** when set, every row shows a left-edge checkbox for multi-select. */
  showSelectCheckboxes?: boolean;
  /** slot above the search input (Import / Export / Reset toolbar). */
  toolbarTopSlot?: ReactNode;
  /** bulk handler: enable/disable selected ids. */
  onBulkToggleEnabled?: (ids: string[], enable: boolean) => void;
  /** bulk handler: hide selected builtins (permanent — distinct from
   *  the soft-hide toggle). Receives all builtin ids in selection. */
  onBulkHideBuiltins?: (ids: string[]) => void;
  /** bulk handler: move selected items to a target category id. When
   *  defined, a "Mover pra…" dropdown shows in the bulk bar with the groups
   *  list as options. */
  onBulkMoveCategory?: (ids: string[], targetCategoryId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────

export function TaxonomyManager<T extends TaxonomyItem>({
  kicker,
  title,
  description,
  items,
  groups,
  renderDetail,
  renderRow,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  emptyAllTitle,
  emptyAllBody,
  onCreate,
  onToggleEnabled,
  onDuplicate,
  onDelete,
  onReorder,
  renderRowPreview,
  renderRowBadges,
  renderBulkExtras,
  groupFilter,
  onGroupFilterChange,
  countLabel,
  createLabel,
  onManageCategories,
  manageCategoriesLabel,
  hideHero = false,
  showSelectCheckboxes = false,
  toolbarTopSlot,
  onBulkToggleEnabled,
  onBulkHideBuiltins,
  onBulkMoveCategory,
}: TaxonomyManagerProps<T>) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ─── Filter ─────────────────────────────────────────────────────────
  const filtered = useMemo<T[]>(() => {
    const q = query.trim().toLowerCase();
    let out = items;
    if (groupFilter) out = out.filter((i) => i.group === groupFilter);
    if (!q) return out;
    return out.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q),
    );
  }, [items, query, groupFilter]);

  // ─── Group ──────────────────────────────────────────────────────────
  const grouped = useMemo<Array<{ group: TaxonomyGroup | null; rows: T[] }>>(() => {
    if (!groups || groups.length === 0) return [{ group: null, rows: filtered }];
    const byGroup = new Map<string, T[]>();
    const ungrouped: T[] = [];
    for (const item of filtered) {
      if (item.group && groups.some((g) => g.id === item.group)) {
        const arr = byGroup.get(item.group) ?? [];
        arr.push(item);
        byGroup.set(item.group, arr);
      } else {
        ungrouped.push(item);
      }
    }
    const out: Array<{ group: TaxonomyGroup | null; rows: T[] }> = [];
    for (const g of groups) {
      const rows = byGroup.get(g.id);
      if (rows && rows.length > 0) out.push({ group: g, rows });
    }
    if (ungrouped.length > 0) out.push({ group: null, rows: ungrouped });
    return out;
  }, [filtered, groups]);

  // ─── Selection helpers ──────────────────────────────────────────────
  const selectedItem = useMemo<T | null>(() => {
    if (!selectedId) return null;
    return items.find((i) => i.id === selectedId) ?? null;
  }, [items, selectedId]);

  const handleRowClick = useCallback((id: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle in multi-select
      setMultiSelect((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelectedId(id);
    setMultiSelect(new Set());
  }, []);

  // toggle a row in multi-select via the dedicated checkbox (without
  // disturbing the selectedId/edit pane).
  const toggleRowCheck = useCallback((id: string) => {
    setMultiSelect((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Keyboard navigation ────────────────────────────────────────────
  const visibleIds = useMemo(() => filtered.map((i) => i.id), [filtered]);
  const handleListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (visibleIds.length === 0) return;
      const idx = selectedId ? visibleIds.indexOf(selectedId) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.min(idx + 1, visibleIds.length - 1);
        setSelectedId(visibleIds[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = idx <= 0 ? 0 : idx - 1;
        setSelectedId(visibleIds[next]);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedItem || selectedItem.builtin) return;
        e.preventDefault();
        onDelete?.([selectedItem.id]);
        setSelectedId(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onCreate();
      } else if (e.key === "Escape") {
        setMultiSelect(new Set());
      }
    },
    [visibleIds, selectedId, selectedItem, onDelete, onCreate],
  );

  // ─── Drag-and-drop ──────────────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => {
    setDragId(id);
  }, []);
  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  }, []);
  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);
  const handleDrop = useCallback(
    (targetId: string, e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = dragId;
      setDragId(null);
      setDragOverId(null);
      if (!sourceId || sourceId === targetId || !onReorder) return;
      const order = items.map((i) => i.id);
      const fromIdx = order.indexOf(sourceId);
      const toIdx = order.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, sourceId);
      onReorder(order);
    },
    [dragId, items, onReorder],
  );

  // ─── Bulk actions ───────────────────────────────────────────────────
  const bulkIds = useMemo(() => [...multiSelect], [multiSelect]);
  const bulkCount = bulkIds.length;
  const bulkBuiltinIds = useMemo(
    () => bulkIds.filter((id) => items.find((i) => i.id === id)?.builtin),
    [bulkIds, items],
  );
  const bulkCustomIds = useMemo(
    () =>
      bulkIds.filter((id) => {
        const it = items.find((i) => i.id === id);
        return it && !it.builtin;
      }),
    [bulkIds, items],
  );
  const handleBulkDelete = useCallback(() => {
    if (!onDelete || bulkCustomIds.length === 0) return;
    onDelete(bulkCustomIds);
    setMultiSelect(new Set());
  }, [onDelete, bulkCustomIds]);
  const handleBulkDuplicate = useCallback(() => {
    if (!onDuplicate || bulkIds.length === 0) return;
    onDuplicate(bulkIds);
    setMultiSelect(new Set());
  }, [onDuplicate, bulkIds]);
  const handleBulkEnable = useCallback(
    (enable: boolean) => {
      if (!onBulkToggleEnabled || bulkIds.length === 0) return;
      onBulkToggleEnabled(bulkIds, enable);
      // keep selection — user may want to toggle again on the same set
    },
    [onBulkToggleEnabled, bulkIds],
  );
  const handleBulkHideBuiltins = useCallback(() => {
    if (!onBulkHideBuiltins || bulkBuiltinIds.length === 0) return;
    onBulkHideBuiltins(bulkBuiltinIds);
    setMultiSelect(new Set());
  }, [onBulkHideBuiltins, bulkBuiltinIds]);
  const handleBulkMove = useCallback(
    (targetCategoryId: string) => {
      if (!onBulkMoveCategory || bulkCustomIds.length === 0) return;
      if (!targetCategoryId) return;
      onBulkMoveCategory(bulkCustomIds, targetCategoryId);
      setMultiSelect(new Set());
    },
    [onBulkMoveCategory, bulkCustomIds],
  );
  const handleSelectAllVisible = useCallback(() => {
    setMultiSelect((prev) => {
      const allIds = filtered.map((i) => i.id);
      const allChecked = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allChecked) {
        // De-select visible rows — clear those ids only.
        const next = new Set(prev);
        for (const id of allIds) next.delete(id);
        return next;
      }
      // Otherwise add all visible to the selection.
      const next = new Set(prev);
      for (const id of allIds) next.add(id);
      return next;
    });
  }, [filtered]);

  // ─── Empty / Hero count ─────────────────────────────────────────────
  const total = items.length;
  const builtinCount = items.filter((i) => i.builtin).length;
  const customCount = total - builtinCount;
  const heroKickerSuffix = countLabel ?? `${total} ${total === 1 ? t("tax.item") : t("tax.items")}`;
  const showEmptyAll = total === 0 && filtered.length === 0;
  const showEmptySearch = !showEmptyAll && filtered.length === 0;

  // Auto-select first item when nothing selected and items present.
  useEffect(() => {
    if (!selectedId && filtered.length > 0 && bulkCount === 0) {
      // No-op: keep selection optional so the empty-detail state is the
      // first impression. User picks intentionally.
    }
  }, [selectedId, filtered, bulkCount]);

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <section className="tx-mgr" aria-label={title}>
      {!hideHero && (
        <SkeuHero
          kicker={`${kicker} · ${heroKickerSuffix}`}
          title={title}
          size="sm"
          showAscii
          showMark={false}
        />
      )}

      {hideHero && (
        <div className="tx-mgr-count-line" aria-label={title}>
          <span>{heroKickerSuffix}</span>
        </div>
      )}

      {description && !hideHero && <div className="tx-mgr-desc">{description}</div>}

      {((groups && groups.length > 1 && onGroupFilterChange) || onManageCategories) && (
        <div className="padroes-cats-toolbar">
          {groups && groups.length > 1 && onGroupFilterChange ? (
            <div className="tx-mgr-group-pills" role="tablist" aria-label={t("tax.filter.aria")}>
              <button
                type="button"
                className={`tx-mgr-group-pill${!groupFilter ? " is-active" : ""}`}
                aria-selected={!groupFilter}
                onClick={() => onGroupFilterChange(null)}
              >
                {t("tax.filter.all")} <span className="tx-mgr-group-pill-count">{total}</span>
              </button>
              {groups.map((g) => {
                const count = items.filter((i) => i.group === g.id).length;
                if (count === 0) return null;
                const active = groupFilter === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`tx-mgr-group-pill${active ? " is-active" : ""}`}
                    aria-selected={active}
                    onClick={() => onGroupFilterChange(active ? null : g.id)}
                    title={g.hint}
                  >
                    {g.label} <span className="tx-mgr-group-pill-count">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span aria-hidden style={{ flex: 1 }} />
          )}
          {onManageCategories && (
            <button
              type="button"
              className="padroes-cats-manage-btn"
              onClick={onManageCategories}
              title={manageCategoriesLabel ?? "Manage categories"}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="14" y2="18" />
              </svg>
              <span>{manageCategoriesLabel ?? "Manage"}</span>
            </button>
          )}
        </div>
      )}

      {toolbarTopSlot && <div className="tx-mgr-toolbar-top">{toolbarTopSlot}</div>}

      <div className="tx-mgr-split">
        {/* ──── LEFT — search + list ──── */}
        <aside className="tx-mgr-left">
          <div className="tx-mgr-search">
            <span className="tx-mgr-search-icon" aria-hidden>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              type="search"
              className="tx-mgr-search-input"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={searchPlaceholder}
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="tx-mgr-search-clear"
                onClick={() => setQuery("")}
                aria-label={t("tax.search.clear")}
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            className="tx-mgr-create df-tactile df-tactile--sm"
            onClick={onCreate}
            title={`${createLabel ?? t("tax.create")} (⌘N)`}
          >
            <span className="tx-mgr-create-icon" aria-hidden>
              +
            </span>
            <span>{createLabel ?? t("tax.create")}</span>
          </button>

          <div
            className="tx-mgr-list"
            ref={listRef}
            tabIndex={0}
            onKeyDown={handleListKeyDown}
            role="listbox"
            aria-label={title}
          >
            {showEmptyAll ? (
              <div className="tx-mgr-empty">
                <div className="tx-mgr-empty-title">
                  {emptyAllTitle ?? t("tax.empty.all.title")}
                </div>
                {emptyAllBody && <div className="tx-mgr-empty-body">{emptyAllBody}</div>}
                <button
                  type="button"
                  className="tx-mgr-empty-cta df-tactile df-tactile--sm"
                  onClick={onCreate}
                >
                  + {createLabel ?? t("tax.create")}
                </button>
              </div>
            ) : showEmptySearch ? (
              <div className="tx-mgr-empty">
                <div className="tx-mgr-empty-title">{emptyTitle}</div>
                {emptyBody && <div className="tx-mgr-empty-body">{emptyBody}</div>}
                <button
                  type="button"
                  className="tx-mgr-empty-cta df-tactile df-tactile--sm"
                  onClick={() => setQuery("")}
                >
                  {t("tax.search.clear.label")}
                </button>
              </div>
            ) : (
              grouped.map(({ group, rows }) => (
                <div key={group?.id ?? "_ungrouped"} className="tx-mgr-section">
                  {group && (
                    <div className="tx-mgr-section-head">
                      <span className="tx-mgr-section-label">{group.label}</span>
                      <span className="tx-mgr-section-count">{rows.length}</span>
                    </div>
                  )}
                  {rows.map((item) => {
                    const isSelected = selectedId === item.id;
                    const isMulti = multiSelect.has(item.id);
                    const isDragOver = dragOverId === item.id;
                    const enabled = item.enabled !== false;
                    return (
                      <div
                        key={item.id}
                        className={[
                          "tx-mgr-row",
                          isSelected && "is-selected",
                          isMulti && "is-multi",
                          isDragOver && "is-drag-over",
                          !enabled && "is-disabled",
                          item.builtin && "is-builtin",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={(e) => handleRowClick(item.id, e)}
                        role="option"
                        aria-selected={isSelected}
                        draggable={Boolean(onReorder)}
                        onDragStart={() => handleDragStart(item.id)}
                        onDragOver={(e) => handleDragOver(item.id, e)}
                        onDragEnd={handleDragEnd}
                        onDrop={(e) => handleDrop(item.id, e)}
                      >
                        {showSelectCheckboxes && (
                          <span
                            className="tx-mgr-row-check"
                            role="checkbox"
                            aria-checked={isMulti}
                            aria-label={t("tax.row.select")}
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRowCheck(item.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleRowCheck(item.id);
                              }
                            }}
                          />
                        )}
                        {onReorder && (
                          <span className="tx-mgr-grip" aria-hidden>
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                          </span>
                        )}
                        {onToggleEnabled && (
                          <button
                            type="button"
                            className={`tx-mgr-toggle${enabled ? " is-on" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleEnabled(item.id, !enabled);
                            }}
                            aria-pressed={enabled}
                            aria-label={enabled ? t("tax.row.disable") : t("tax.row.enable")}
                          >
                            <span className="tx-mgr-toggle-thumb" />
                          </button>
                        )}
                        <div className="tx-mgr-row-body">
                          {renderRowPreview && (
                            <div className="tx-mgr-row-preview">{renderRowPreview(item)}</div>
                          )}
                          {renderRow ? (
                            renderRow(item)
                          ) : (
                            <div className="tx-mgr-row-text">
                              <span className="tx-mgr-row-title">{item.title}</span>
                              {item.subtitle && (
                                <span className="tx-mgr-row-sub">{item.subtitle}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="tx-mgr-row-badges">
                          {item.builtin && (
                            <span
                              className="tx-mgr-badge tx-mgr-badge--builtin"
                              title={t("tax.badge.builtin.hint")}
                            >
                              {t("tax.badge.builtin")}
                            </span>
                          )}
                          {!item.builtin && (
                            <span
                              className="tx-mgr-badge tx-mgr-badge--custom"
                              title={t("tax.badge.custom.hint")}
                            >
                              {t("tax.badge.custom")}
                            </span>
                          )}
                          {item.edited && (
                            <span
                              className="tx-mgr-badge tx-mgr-badge--edited"
                              title={t("tax.badge.edited.hint")}
                            >
                              {t("tax.badge.edited")}
                            </span>
                          )}
                          {renderRowBadges && renderRowBadges(item)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {bulkCount > 0 && (
            <div className="tx-mgr-bulk" role="region" aria-label={t("tax.bulk.aria")}>
              <span className="tx-mgr-bulk-count">
                {bulkCount === 1
                  ? t("tax.bulk.count.one")
                  : t("tax.bulk.count.many").replace("{0}", String(bulkCount))}
              </span>
              <div className="tx-mgr-bulk-actions">
                {onDuplicate && (
                  <button type="button" className="tx-mgr-bulk-btn" onClick={handleBulkDuplicate}>
                    {t("tax.bulk.duplicate")}
                  </button>
                )}
                {onBulkToggleEnabled && (
                  <>
                    <button
                      type="button"
                      className="tx-mgr-bulk-btn"
                      onClick={() => handleBulkEnable(true)}
                    >
                      {t("tax.bulk.enable")}
                    </button>
                    <button
                      type="button"
                      className="tx-mgr-bulk-btn"
                      onClick={() => handleBulkEnable(false)}
                    >
                      {t("tax.bulk.disable")}
                    </button>
                  </>
                )}
                {onBulkMoveCategory && groups && groups.length > 0 && bulkCustomIds.length > 0 && (
                  <select
                    className="tx-mgr-bulk-extra-select"
                    aria-label={t("tax.bulk.move.target.placeholder")}
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) handleBulkMove(v);
                      e.target.value = "";
                    }}
                  >
                    <option value="" disabled>
                      {t("tax.bulk.move.cat")}
                    </option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                )}
                {onDelete && bulkCustomIds.length > 0 && (
                  <button
                    type="button"
                    className="tx-mgr-bulk-btn tx-mgr-bulk-btn--danger"
                    onClick={handleBulkDelete}
                    title={`${t("tax.bulk.delete")} (${bulkCustomIds.length})`}
                  >
                    {t("tax.bulk.delete")}
                    {bulkCustomIds.length !== bulkCount && ` (${bulkCustomIds.length})`}
                  </button>
                )}
                {onBulkHideBuiltins && bulkBuiltinIds.length > 0 && (
                  <button
                    type="button"
                    className="tx-mgr-bulk-btn tx-mgr-bulk-btn--danger"
                    onClick={handleBulkHideBuiltins}
                    title={`${t("tax.bulk.delete.builtin")} (${bulkBuiltinIds.length})`}
                  >
                    {t("tax.bulk.delete.builtin")} ({bulkBuiltinIds.length})
                  </button>
                )}
                {renderBulkExtras && renderBulkExtras(bulkIds)}
                <button type="button" className="tx-mgr-bulk-btn" onClick={handleSelectAllVisible}>
                  {t("tax.bulk.select.all")}
                </button>
                <button
                  type="button"
                  className="tx-mgr-bulk-btn"
                  onClick={() => setMultiSelect(new Set())}
                >
                  {t("tax.bulk.clear")}
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* ──── RIGHT — detail panel ──── */}
        <main className="tx-mgr-detail">
          {selectedItem ? (
            <div className="tx-mgr-detail-card">
              {renderDetail({ item: selectedItem, close: () => setSelectedId(null) })}
            </div>
          ) : (
            <div className="tx-mgr-detail-empty">
              <div className="tx-mgr-detail-empty-mark" aria-hidden>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <div className="tx-mgr-detail-empty-title">{t("tax.detail.empty.title")}</div>
              <div className="tx-mgr-detail-empty-body">
                {t("tax.detail.empty.body")
                  .replace("{0}", String(customCount))
                  .replace("{1}", String(builtinCount))}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
