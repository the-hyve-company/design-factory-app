// FormatTaxonomyEditor.tsx — Settings · Formats.
//
// user spec:
//   "rules, formats e canvas com gerenciamento premium em settings".
//
// Anatomy (shared with Canvas + Rules):
//   <TaxonomyManager> with category groups (Video/Interface/Social/Print/
//   Other) + group filter pills. Format items live inside categories so the
//   manager renders them as collapsible sections.
//
// Persistence (unchanged): writeGlobalConfig + db.setSetting
// fallback. Builtin items are protected (delete blocked); user can add
// customs per category or hide builtins via the row toggle.

import { useEffect, useMemo, useState } from "react";
import { db, writeGlobalConfig } from "@/lib/claude-bridge";
import {
  TaxonomyManager,
  type TaxonomyItem,
  type TaxonomyGroup,
} from "@/components/TaxonomyManager";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";
import { PadroesCategoryManager, type ManagedCategory } from "@/components/PadroesCategoryManager";
import { ImportExportControls, type ImportPreview } from "@/components/ImportExportControls";
import { useT, type Lang } from "@/i18n";
import { formatItemLabel, formatItemDescriptor, formatCategoryLabel } from "@/i18n/builtin-labels";
import {
  buildFormatTaxonomyExport,
  DEFAULT_FORMAT_TAXONOMY,
  getCustomFormatCategories,
  getHiddenBuiltinFormatItemIds,
  parseFormatTaxonomyImport,
  setCustomFormatCategories,
  setDisabledFormatItemIds,
  setHiddenBuiltinFormatItemIds,
  setHiddenBuiltinFormatCategoryIds,
  getHiddenBuiltinFormatCategoryIds,
  type FormatCategory,
  type FormatItem,
  type FormatTaxonomyExportV1,
} from "@/data/format-taxonomy";

// ─── Orphan bucket ──────────────────────────────────────────────
//
// When a custom category is deleted with items still attached, those items
// cascade into a synthetic "Sem categoria" bucket so they don't disappear
// from the picker. User reassigns them later via the row's category
// dropdown. The bucket is a normal custom category id, just with a
// reserved id `_orphan` and a localized label.

const ORPHAN_CATEGORY_ID = "_orphan";
const ORPHAN_CATEGORY_LABEL = "Sem categoria";

// ─── Persistence ──────────────────────────────────────────────────────

async function loadDisabled(): Promise<Set<string>> {
  const raw = await db.getSetting("format_items_disabled").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
async function persistDisabled(s: Set<string>): Promise<void> {
  await db.setSetting("format_items_disabled", JSON.stringify([...s])).catch(() => {});
}
async function persistCustomCats(arr: FormatCategory[]): Promise<void> {
  setCustomFormatCategories(arr);
  await writeGlobalConfig({ custom_format_categories: arr as never }).catch(() => {});
  await db.setSetting("custom_format_categories", JSON.stringify(arr)).catch(() => {});
}
async function loadHiddenItems(): Promise<Set<string>> {
  const raw = await db.getSetting("format_items_hidden_builtins").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
async function persistHiddenItems(s: Set<string>): Promise<void> {
  setHiddenBuiltinFormatItemIds([...s]);
  await writeGlobalConfig({ hidden_builtin_format_items: [...s] as never }).catch(() => {});
  await db.setSetting("format_items_hidden_builtins", JSON.stringify([...s])).catch(() => {});
}
async function persistHiddenCats(s: Set<string>): Promise<void> {
  setHiddenBuiltinFormatCategoryIds([...s]);
  await writeGlobalConfig({ hidden_builtin_format_categories: [...s] as never }).catch(() => {});
  await db.setSetting("format_cats_hidden_builtins", JSON.stringify([...s])).catch(() => {});
}

// ─── Adapter — FormatItem → TaxonomyItem ──────────────────────────────
//
// Composite key: `${categoryId}/${itemId}` so the row id is stable across
// categories with the same item id.

interface FmtItem extends TaxonomyItem {
  categoryId: string;
  itemId: string;
  raw: FormatItem;
}

function makeKey(catId: string, itemId: string): string {
  return `${catId}/${itemId}`;
}

function toItem(
  category: FormatCategory,
  item: FormatItem,
  isCustomCat: boolean,
  isCustomItem: boolean,
  enabled: boolean,
  lang: Lang,
): FmtItem {
  // localize builtin labels/descriptors. Customs (no
  // entry in i18n table) fall through to item.label as before.
  const isBuiltin = !isCustomItem && !isCustomCat;
  return {
    id: makeKey(category.id, item.id),
    title: isBuiltin ? formatItemLabel(category.id, item, lang) : item.label,
    subtitle: isBuiltin ? formatItemDescriptor(category.id, item, lang) : item.descriptor,
    builtin: isBuiltin,
    enabled,
    group: category.id,
    categoryId: category.id,
    itemId: item.id,
    raw: item,
  };
}

function generateItemId(label: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe || "item"}-${Date.now().toString(36)}`;
}

// ─── Detail form ──────────────────────────────────────────────────────

interface DetailFormProps {
  item: FmtItem;
  allItems: FmtItem[];
  groups: TaxonomyGroup[];
  builtinCategoryIds: Set<string>;
  isItemBuiltin: boolean;
  onSave: (
    item: FmtItem,
    patch: { label?: string; descriptor?: string; prompt?: string; categoryId?: string },
  ) => Promise<void>;
  onDelete: (item: FmtItem) => Promise<void>;
  onDeleteBuiltinPermanent: (item: FmtItem) => Promise<void>;
  onDuplicate: (item: FmtItem) => Promise<void>;
  onToggleEnabled: (id: string, next: boolean) => void;
}

function DetailForm({
  item,
  allItems,
  groups,
  builtinCategoryIds,
  isItemBuiltin,
  onSave,
  onDelete,
  onDeleteBuiltinPermanent,
  onDuplicate,
  onToggleEnabled,
}: DetailFormProps) {
  const { t, lang } = useT();
  const [label, setLabel] = useState(item.raw.label);
  const [descriptor, setDescriptor] = useState(item.raw.descriptor ?? "");
  const [prompt, setPrompt] = useState(item.raw.prompt ?? "");
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [savedTick, setSavedTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePermanent, setConfirmDeletePermanent] = useState(false);

  useEffect(() => {
    setLabel(item.raw.label);
    setDescriptor(item.raw.descriptor ?? "");
    setPrompt(item.raw.prompt ?? "");
    setCategoryId(item.categoryId);
    setSavedTick(0);
  }, [item.id]);

  // validation: empty name + duplicate within target category.
  const validation = useMemo(() => {
    const errors: { label?: string } = {};
    const trimmed = label.trim();
    if (!trimmed) {
      errors.label = t("settings.padroes.validation.empty.name");
    } else {
      const dup = allItems.find(
        (it) =>
          it.id !== item.id &&
          it.categoryId === categoryId &&
          it.title.toLowerCase() === trimmed.toLowerCase(),
      );
      if (dup) errors.label = t("settings.padroes.validation.duplicate.in.cat");
    }
    return errors;
  }, [label, categoryId, allItems, item.id, t]);
  const hasErrors = Object.keys(validation).length > 0;

  const handleSave = async () => {
    if (hasErrors) return;
    const patch: { label?: string; descriptor?: string; prompt?: string; categoryId?: string } = {};
    if (label.trim() && label !== item.raw.label) patch.label = label.trim();
    if (descriptor !== (item.raw.descriptor ?? "")) patch.descriptor = descriptor.trim();
    if (prompt !== (item.raw.prompt ?? "")) patch.prompt = prompt;
    if (categoryId !== item.categoryId) patch.categoryId = categoryId;
    if (Object.keys(patch).length === 0) return;
    await onSave(item, patch);
    setSavedTick((n) => n + 1);
    window.setTimeout(() => setSavedTick(0), 1500);
  };

  const enabled = item.enabled !== false;

  return (
    <>
      <div className="tx-mgr-detail-head">
        <div className="tx-mgr-detail-head-text">
          <span className="tx-mgr-detail-eyebrow">{t("settings.formats.detail.eyebrow")}</span>
          <h3 className="tx-mgr-detail-title">
            {item.builtin ? formatItemLabel(item.categoryId, item.raw, lang) : item.raw.label}
          </h3>
        </div>
        <div className="tx-mgr-detail-actions">
          <button
            type="button"
            className="tx-mgr-detail-action"
            onClick={() => void onDuplicate(item)}
            title={t("tax.bulk.duplicate")}
          >
            {t("tax.bulk.duplicate")}
          </button>
          {!isItemBuiltin && (
            <button
              type="button"
              className="tx-mgr-detail-action tx-mgr-detail-action--danger"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("settings.padroes.detail.delete.aria")}
            >
              {t("settings.canvas.action.delete")}
            </button>
          )}
          {isItemBuiltin && (
            <button
              type="button"
              className="tx-mgr-detail-action tx-mgr-detail-action--danger"
              onClick={() => setConfirmDeletePermanent(true)}
              aria-label={t("settings.padroes.detail.delete.builtin.aria")}
              title={t("settings.padroes.builtin.action.delete")}
            >
              {t("settings.padroes.builtin.action.delete")}
            </button>
          )}
        </div>
      </div>

      {/* v19 — Builtin guidance + explicit Hide/Show action
       * Removed amber tip card. PADRÃO badge + action buttons suffice. */}
      {isItemBuiltin && (
        <>
          <div className="padroes-builtin-actions" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className="padroes-action-btn"
              onClick={() => onToggleEnabled(item.id, !enabled)}
            >
              {enabled
                ? t("settings.padroes.builtin.action.hide")
                : t("settings.padroes.builtin.action.show")}
            </button>
          </div>
        </>
      )}

      <div className="tx-mgr-form" aria-disabled={isItemBuiltin}>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`fmt-name-${item.id}`}>
            {t("settings.formats.field.label")}
          </label>
          <input
            id={`fmt-name-${item.id}`}
            type="text"
            className={`tx-mgr-input${validation.label ? " is-invalid" : ""}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={isItemBuiltin}
            aria-invalid={Boolean(validation.label)}
          />
          {validation.label && (
            <span className="tx-mgr-field-error" role="alert">
              {validation.label}
            </span>
          )}
        </div>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`fmt-desc-${item.id}`}>
            {t("settings.formats.field.descriptor")}
          </label>
          <input
            id={`fmt-desc-${item.id}`}
            type="text"
            className="tx-mgr-input tx-mgr-input--mono"
            placeholder={t("settings.formats.field.descriptor.placeholder")}
            value={descriptor}
            onChange={(e) => setDescriptor(e.target.value)}
            disabled={isItemBuiltin}
          />
        </div>
        {/* Prompt editor — long-form instruction text concatenated into
         * the system prompt when the format is picked. Editable for
         * BOTH builtins and customs (user ask 2026-05-11: "settings
         * de formato nao ta com prompt do formato, quero pdoer
         * editar"). When empty, the builder falls back to descriptor. */}
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`fmt-prompt-${item.id}`}>
            Prompt
          </label>
          <textarea
            id={`fmt-prompt-${item.id}`}
            className="tx-mgr-input tx-mgr-input--mono"
            placeholder="Long-form instruction text that gets concatenated into the system prompt when this format is selected. Empty = use descriptor."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            style={{ minHeight: 120, resize: "vertical", lineHeight: 1.4 }}
          />
          <span
            className="tx-mgr-field-hint"
            style={{ fontSize: 11, color: "var(--df-text-faint)", marginTop: 4, display: "block" }}
          >
            Editable for builtins too. Saved as user override, original ships in code.
          </span>
        </div>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`fmt-cat-${item.id}`}>
            {t("settings.formats.field.category")}
          </label>
          <select
            id={`fmt-cat-${item.id}`}
            className="tx-mgr-select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={isItemBuiltin}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
                {builtinCategoryIds.has(g.id) ? "" : " (custom)"}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            marginTop: 6,
          }}
        >
          <span className={`tx-mgr-status${savedTick > 0 ? " is-shown" : ""}`}>
            {t("settings.canvas.action.saved")}
          </span>
          {!isItemBuiltin && (
            <button
              type="button"
              className="df-btn df-btn--primary df-btn--sm"
              onClick={() => void handleSave()}
              disabled={hasErrors}
              title={hasErrors ? validation.label : undefined}
            >
              {t("settings.canvas.action.save")}
            </button>
          )}
        </div>
      </div>

      <PadroesConfirmModal
        open={confirmDelete}
        title={item.raw.label}
        body={t("settings.formats.action.delete.confirm").replace("{0}", item.raw.label)}
        tone="danger"
        confirmLabel={t("settings.canvas.action.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          void onDelete(item);
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <PadroesConfirmModal
        open={confirmDeletePermanent}
        title={item.raw.label}
        body={t("settings.padroes.builtin.action.delete.confirm").replace("{0}", item.raw.label)}
        tone="danger"
        confirmLabel={t("settings.padroes.builtin.action.delete")}
        onConfirm={() => {
          setConfirmDeletePermanent(false);
          void onDeleteBuiltinPermanent(item);
        }}
        onClose={() => setConfirmDeletePermanent(false)}
      />
    </>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────

export function FormatTaxonomyEditor() {
  const { t, lang } = useT();
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(
    () => new Set(getHiddenBuiltinFormatItemIds()),
  );
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(
    () => new Set(getHiddenBuiltinFormatCategoryIds()),
  );
  const [customCats, setCustomCats] = useState<FormatCategory[]>(() => getCustomFormatCategories());
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  useEffect(() => {
    void loadDisabled().then((s) => setDisabled(s));
    void loadHiddenItems().then((s) => {
      setHiddenItems(s);
      setHiddenBuiltinFormatItemIds([...s]);
    });
  }, []);

  // Effective categories = builtins (with custom item additions merged) +
  // any net-new categories the user invented. For each builtin category
  // we union the default items with the custom ones added under the same
  // category id.
  const effective = useMemo<FormatCategory[]>(() => {
    const customById = new Map(customCats.map((c) => [c.id, c]));
    const out: FormatCategory[] = [];
    for (const def of DEFAULT_FORMAT_TAXONOMY) {
      const custom = customById.get(def.id);
      if (custom) {
        // Custom overlay shadows default fully (legacy semantics).
        out.push(custom);
        customById.delete(def.id);
      } else {
        out.push(def);
      }
    }
    for (const c of customById.values()) out.push(c);
    return out;
  }, [customCats]);

  const builtinCategoryIds = useMemo<Set<string>>(
    () => new Set(DEFAULT_FORMAT_TAXONOMY.map((c) => c.id)),
    [],
  );

  const groups = useMemo<TaxonomyGroup[]>(
    () =>
      effective.map((c) => ({
        id: c.id,
        label: builtinCategoryIds.has(c.id) ? formatCategoryLabel(c, lang) : c.label,
        hint: c.hint,
      })),
    [effective, builtinCategoryIds, lang],
  );

  const items = useMemo<FmtItem[]>(() => {
    const out: FmtItem[] = [];
    for (const cat of effective) {
      const isCustomCat = !builtinCategoryIds.has(cat.id);
      const defaultItems = isCustomCat
        ? new Set<string>()
        : new Set(
            (DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === cat.id)?.items ?? []).map((i) => i.id),
          );
      for (const item of cat.items) {
        const compositeKey = makeKey(cat.id, item.id);
        // permanently-hidden builtins disappear from the list entirely.
        if (!isCustomCat && defaultItems.has(item.id) && hiddenItems.has(compositeKey)) {
          continue;
        }
        const isCustomItem = isCustomCat || !defaultItems.has(item.id);
        const enabled = !disabled.has(compositeKey);
        out.push(toItem(cat, item, isCustomCat, isCustomItem, enabled, lang));
      }
    }
    return out;
  }, [effective, disabled, hiddenItems, builtinCategoryIds, lang]);

  // ─── Mutators (operate on customs slot) ──────────────────────────────

  /** Ensure a category exists in customCats — clones from default if needed. */
  const ensureCustomCategory = (catId: string): FormatCategory[] => {
    const existing = customCats.find((c) => c.id === catId);
    if (existing) return customCats;
    const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === catId);
    if (!def) {
      // Net-new category — should never happen here; defensive.
      return [...customCats, { id: catId, label: titleCase(catId), items: [] }];
    }
    return [...customCats, { ...def, items: [...def.items] }];
  };

  const handleToggle = async (id: string, next: boolean) => {
    setDisabled((prev) => {
      const out = new Set(prev);
      if (next) out.delete(id);
      else out.add(id);
      setDisabledFormatItemIds([...out]);
      void persistDisabled(out);
      return out;
    });
  };

  const handleCreate = async () => {
    // Default new items into the first effective category — or the
    // currently-filtered group, if the user narrowed via pills.
    const targetCatId = groupFilter ?? effective[0]?.id ?? "other";
    const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === targetCatId);
    const label = def ? `${def.label} item ${Date.now().toString(36).slice(-3)}` : "New format";
    const newItem: FormatItem = {
      id: generateItemId(label),
      label,
      descriptor: "",
    };
    const baseline = ensureCustomCategory(targetCatId);
    const next = baseline.map((c) =>
      c.id === targetCatId ? { ...c, items: [...c.items, newItem] } : c,
    );
    setCustomCats(next);
    await persistCustomCats(next);
  };

  const handleSave = async (
    item: FmtItem,
    patch: { label?: string; descriptor?: string; prompt?: string; categoryId?: string },
  ) => {
    if (
      !patch.label &&
      patch.descriptor === undefined &&
      patch.prompt === undefined &&
      !patch.categoryId
    )
      return;
    const targetCatId = patch.categoryId ?? item.categoryId;
    let baseline = ensureCustomCategory(item.categoryId);
    if (targetCatId !== item.categoryId) baseline = ensureCustomCategory(targetCatId).map((c) => c);
    // Apply baseline shape (deduped).
    const seen = new Map(baseline.map((c) => [c.id, c]));
    if (!seen.has(targetCatId)) {
      const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === targetCatId);
      seen.set(
        targetCatId,
        def
          ? { ...def, items: [...def.items] }
          : { id: targetCatId, label: titleCase(targetCatId), items: [] },
      );
    }
    let next = [...seen.values()];
    if (patch.categoryId && patch.categoryId !== item.categoryId) {
      // Move item: remove from old, add to new.
      next = next.map((c) =>
        c.id === item.categoryId ? { ...c, items: c.items.filter((i) => i.id !== item.itemId) } : c,
      );
      const targetItem: FormatItem = {
        id: item.itemId,
        label: patch.label ?? item.raw.label,
        descriptor: patch.descriptor ?? item.raw.descriptor,
        ...(patch.prompt !== undefined
          ? { prompt: patch.prompt }
          : item.raw.prompt
            ? { prompt: item.raw.prompt }
            : {}),
      };
      next = next.map((c) =>
        c.id === targetCatId ? { ...c, items: [...c.items, targetItem] } : c,
      );
    } else {
      next = next.map((c) =>
        c.id === item.categoryId
          ? {
              ...c,
              items: c.items.map((it) =>
                it.id === item.itemId
                  ? {
                      ...it,
                      label: patch.label ?? it.label,
                      descriptor: patch.descriptor !== undefined ? patch.descriptor : it.descriptor,
                      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
                    }
                  : it,
              ),
            }
          : c,
      );
    }
    setCustomCats(next);
    await persistCustomCats(next);
  };

  const handleDelete = async (item: FmtItem) => {
    const baseline = ensureCustomCategory(item.categoryId);
    const next = baseline.map((c) =>
      c.id === item.categoryId ? { ...c, items: c.items.filter((i) => i.id !== item.itemId) } : c,
    );
    setCustomCats(next);
    await persistCustomCats(next);
  };

  const handleBulkDelete = async (ids: string[]) => {
    let working = customCats;
    for (const compositeId of ids) {
      const item = items.find((i) => i.id === compositeId);
      if (!item || item.builtin) continue;
      working = ensureFromArray(working, item.categoryId);
      working = working.map((c) =>
        c.id === item.categoryId ? { ...c, items: c.items.filter((i) => i.id !== item.itemId) } : c,
      );
    }
    setCustomCats(working);
    await persistCustomCats(working);
  };

  const handleDuplicate = async (item: FmtItem) => {
    const dup: FormatItem = {
      id: generateItemId(item.raw.label),
      label: `${item.raw.label} (custom)`,
      descriptor: item.raw.descriptor,
    };
    const baseline = ensureCustomCategory(item.categoryId);
    const next = baseline.map((c) =>
      c.id === item.categoryId ? { ...c, items: [...c.items, dup] } : c,
    );
    setCustomCats(next);
    await persistCustomCats(next);
  };

  const handleBulkDuplicate = async (ids: string[]) => {
    let working = customCats;
    for (const compositeId of ids) {
      const item = items.find((i) => i.id === compositeId);
      if (!item) continue;
      const dup: FormatItem = {
        id: generateItemId(item.raw.label),
        label: `${item.raw.label} (custom)`,
        descriptor: item.raw.descriptor,
      };
      working = ensureFromArray(working, item.categoryId);
      working = working.map((c) =>
        c.id === item.categoryId ? { ...c, items: [...c.items, dup] } : c,
      );
    }
    setCustomCats(working);
    await persistCustomCats(working);
  };

  const handleDeleteBuiltinPermanent = async (item: FmtItem) => {
    const out = new Set(hiddenItems);
    out.add(item.id); // composite key categoryId/itemId
    setHiddenItems(out);
    await persistHiddenItems(out);
  };

  const handleBulkHideBuiltins = async (ids: string[]) => {
    const builtinIds = ids.filter((id) => {
      const it = items.find((i) => i.id === id);
      return it && it.builtin;
    });
    if (builtinIds.length === 0) return;
    const out = new Set(hiddenItems);
    for (const id of builtinIds) out.add(id);
    setHiddenItems(out);
    await persistHiddenItems(out);
  };

  const handleBulkToggleEnabled = async (ids: string[], enable: boolean) => {
    const out = new Set(disabled);
    for (const id of ids) {
      if (enable) out.delete(id);
      else out.add(id);
    }
    setDisabled(out);
    setDisabledFormatItemIds([...out]);
    await persistDisabled(out);
  };

  const handleBulkMoveCategory = async (ids: string[], targetCategoryId: string) => {
    let working = customCats;
    for (const compositeId of ids) {
      const item = items.find((i) => i.id === compositeId);
      if (!item || item.builtin) continue;
      if (item.categoryId === targetCategoryId) continue;
      // Ensure both source + target exist as overlays
      working = ensureFromArray(working, item.categoryId);
      working = ensureFromArray(working, targetCategoryId);
      // Remove from source
      working = working.map((c) =>
        c.id === item.categoryId ? { ...c, items: c.items.filter((i) => i.id !== item.itemId) } : c,
      );
      // Append to target
      working = working.map((c) =>
        c.id === targetCategoryId
          ? {
              ...c,
              items: [
                ...c.items,
                { id: item.itemId, label: item.raw.label, descriptor: item.raw.descriptor },
              ],
            }
          : c,
      );
    }
    setCustomCats(working);
    await persistCustomCats(working);
  };

  const handleReorder = async (newOrderIds: string[]) => {
    // Group reorder: bucket items by category, preserve incoming order
    // within each bucket. We persist by writing an overlay category for
    // each touched category.
    const touchedCategories = new Map<string, string[]>();
    for (const id of newOrderIds) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      const arr = touchedCategories.get(item.categoryId) ?? [];
      arr.push(item.itemId);
      touchedCategories.set(item.categoryId, arr);
    }
    let working = customCats;
    for (const [catId, orderedIds] of touchedCategories) {
      working = ensureFromArray(working, catId);
      working = working.map((c) => {
        if (c.id !== catId) return c;
        const byId = new Map(c.items.map((i) => [i.id, i]));
        const reordered: FormatItem[] = [];
        for (const id of orderedIds) {
          const it = byId.get(id);
          if (it) {
            reordered.push(it);
            byId.delete(id);
          }
        }
        for (const remaining of byId.values()) reordered.push(remaining);
        return { ...c, items: reordered };
      });
    }
    setCustomCats(working);
    await persistCustomCats(working);
  };

  // ─── Category management ───────────────────────────────────
  // Effective category list for the modal: merge builtin defaults with
  // overlays (custom) and any net-new custom categories. `hasOverride`
  // tracks when a builtin's label was renamed.
  const managedCategories = useMemo<ManagedCategory[]>(() => {
    const out: ManagedCategory[] = [];
    const customById = new Map(customCats.map((c) => [c.id, c]));
    for (const def of DEFAULT_FORMAT_TAXONOMY) {
      const custom = customById.get(def.id);
      const label = custom?.label ?? def.label;
      const hasOverride = Boolean(custom && custom.label !== def.label);
      const itemCount = (custom?.items ?? def.items).filter(
        (it) => !disabled.has(makeKey(def.id, it.id)),
      ).length;
      out.push({ id: def.id, label, builtin: true, itemCount, hasOverride });
      customById.delete(def.id);
    }
    for (const c of customById.values()) {
      const itemCount = c.items.filter((it) => !disabled.has(makeKey(c.id, it.id))).length;
      out.push({ id: c.id, label: c.label, builtin: false, itemCount });
    }
    return out;
  }, [customCats, disabled]);

  const handleCatCreate = async (label: string) => {
    const id = `custom-cat-${Date.now().toString(36)}`;
    const next = [...customCats, { id, label, items: [] }];
    setCustomCats(next);
    await persistCustomCats(next);
  };

  const handleCatRename = async (id: string, nextLabel: string) => {
    const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === id);
    let working = customCats;
    const existing = working.find((c) => c.id === id);
    if (existing) {
      working = working.map((c) => (c.id === id ? { ...c, label: nextLabel } : c));
    } else if (def) {
      // Builtin rename — clone default to override slot with new label.
      working = [
        ...working,
        { id: def.id, label: nextLabel, hint: def.hint, items: [...def.items] },
      ];
    } else {
      // Net-new category renamed before items added — unusual, defensive.
      working = [...working, { id, label: nextLabel, items: [] }];
    }
    setCustomCats(working);
    await persistCustomCats(working);
  };

  const handleCatResetBuiltin = async (id: string) => {
    const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === id);
    if (!def) return;
    const existing = customCats.find((c) => c.id === id);
    if (!existing) return;
    // If the override only differs in label (items match defaults), drop
    // the override entirely. If items also changed, restore label only.
    const itemsMatchDefaults =
      existing.items.length === def.items.length &&
      existing.items.every((it, idx) => {
        const dItem = def.items[idx];
        return (
          dItem &&
          it.id === dItem.id &&
          it.label === dItem.label &&
          (it.descriptor ?? "") === (dItem.descriptor ?? "")
        );
      });
    let next: FormatCategory[];
    if (itemsMatchDefaults) {
      next = customCats.filter((c) => c.id !== id);
    } else {
      next = customCats.map((c) => (c.id === id ? { ...c, label: def.label } : c));
    }
    setCustomCats(next);
    await persistCustomCats(next);
  };

  // ─── Import / Export / Reset ────────────────────────────────

  const previewImport = (payload: FormatTaxonomyExportV1): ImportPreview => {
    const existingIds = new Set(customCats.map((c) => c.id));
    const incomingIds = new Set(payload.customCategories.map((c) => c.id));
    const added: string[] = [];
    const replaced: string[] = [];
    const removed: string[] = [];
    for (const c of payload.customCategories) {
      if (existingIds.has(c.id)) replaced.push(c.label);
      else added.push(c.label);
    }
    for (const c of customCats) {
      if (!incomingIds.has(c.id)) removed.push(c.label);
    }
    return { added, replaced, removed };
  };

  const applyImport = async (payload: FormatTaxonomyExportV1, mode: "merge" | "replace") => {
    let nextCustoms: FormatCategory[];
    if (mode === "replace") {
      nextCustoms = [...payload.customCategories];
    } else {
      const byId = new Map(customCats.map((c) => [c.id, c]));
      for (const c of payload.customCategories) byId.set(c.id, c);
      nextCustoms = [...byId.values()];
    }
    setCustomCats(nextCustoms);
    await persistCustomCats(nextCustoms);

    const nextDisabled = new Set(mode === "replace" ? [] : [...disabled]);
    for (const id of payload.disabledIds ?? []) nextDisabled.add(id);
    setDisabled(nextDisabled);
    setDisabledFormatItemIds([...nextDisabled]);
    await persistDisabled(nextDisabled);

    const nextHidden = new Set(mode === "replace" ? [] : [...hiddenItems]);
    for (const id of payload.hiddenBuiltinItemIds ?? []) nextHidden.add(id);
    setHiddenItems(nextHidden);
    await persistHiddenItems(nextHidden);
  };

  const handleResetAll = async () => {
    setCustomCats([]);
    await persistCustomCats([]);
    const empty = new Set<string>();
    setDisabled(empty);
    setDisabledFormatItemIds([]);
    await persistDisabled(empty);
    setHiddenItems(empty);
    await persistHiddenItems(empty);
  };

  const handleCatDelete = async (id: string) => {
    // Custom categories can be deleted even with items: items cascade
    // into the orphan bucket "_orphan" (label "Sem categoria"). User
    // reattaches them later via the row's category dropdown.
    // Builtin categories are also deletable (user 2026-05-17: "nao
    // quero q user seja barrado de deletar defaults") — handled by
    // adding the id to the persistent hiddenBuiltinCategoryIds set.
    // Items inside are individually preserved unless the user also
    // deletes them.
    const isBuiltin = DEFAULT_FORMAT_TAXONOMY.some((d) => d.id === id);
    if (isBuiltin) {
      const next = new Set([...hiddenCats, id]);
      setHiddenCats(next);
      setHiddenBuiltinFormatCategoryIds([...next]);
      await persistHiddenCats(next);
      return;
    }
    const cat = customCats.find((c) => c.id === id);
    const orphanItems = cat?.items ?? [];
    let next = customCats.filter((c) => c.id !== id);
    if (orphanItems.length > 0) {
      const existingOrphan = next.find((c) => c.id === ORPHAN_CATEGORY_ID);
      if (existingOrphan) {
        next = next.map((c) =>
          c.id === ORPHAN_CATEGORY_ID ? { ...c, items: [...c.items, ...orphanItems] } : c,
        );
      } else {
        next = [
          ...next,
          {
            id: ORPHAN_CATEGORY_ID,
            label: ORPHAN_CATEGORY_LABEL,
            items: orphanItems,
          },
        ];
      }
    }
    setCustomCats(next);
    await persistCustomCats(next);
  };

  // ImportExportControls slot removed 2026-05-21 — handlers/exports
  // preserved for future surfaces. Silence TS6133 while they sit idle.
  void previewImport;
  void applyImport;
  void handleResetAll;
  void buildFormatTaxonomyExport;
  void parseFormatTaxonomyImport;
  void ImportExportControls;

  return (
    <>
      <TaxonomyManager<FmtItem>
        kicker={t("settings.formats.kicker")}
        title={t("settings.formats.title")}
        description={t("settings.formats.desc")}
        hideHero
        showSelectCheckboxes
        items={items}
        groups={groups}
        groupFilter={groupFilter}
        onGroupFilterChange={setGroupFilter}
        searchPlaceholder={t("settings.formats.search")}
        createLabel={t("settings.formats.create")}
        emptyTitle={t("settings.formats.empty.search")}
        emptyBody={t("settings.formats.empty.search.body")}
        emptyAllTitle={t("settings.formats.empty.all.title")}
        emptyAllBody={t("settings.formats.empty.all.body")}
        onCreate={() => void handleCreate()}
        onToggleEnabled={(id, on) => void handleToggle(id, on)}
        onDelete={(ids) => void handleBulkDelete(ids)}
        onDuplicate={(ids) => void handleBulkDuplicate(ids)}
        onReorder={(ids) => void handleReorder(ids)}
        onBulkToggleEnabled={(ids, enable) => void handleBulkToggleEnabled(ids, enable)}
        onBulkHideBuiltins={(ids) => void handleBulkHideBuiltins(ids)}
        onBulkMoveCategory={(ids, target) => void handleBulkMoveCategory(ids, target)}
        onManageCategories={() => setCatManagerOpen(true)}
        manageCategoriesLabel={t("settings.padroes.cats.manage")}
        /* toolbarTopSlot removed 2026-05-21 — user ask: "remove
           Exportar / Importar / Resetar tudo". */
        renderDetail={({ item }) => (
          <DetailForm
            item={item}
            allItems={items}
            groups={groups}
            builtinCategoryIds={builtinCategoryIds}
            isItemBuiltin={item.builtin === true}
            onSave={handleSave}
            onDelete={handleDelete}
            onDeleteBuiltinPermanent={handleDeleteBuiltinPermanent}
            onDuplicate={handleDuplicate}
            onToggleEnabled={(id, on) => void handleToggle(id, on)}
          />
        )}
      />

      <PadroesCategoryManager
        open={catManagerOpen}
        categories={managedCategories}
        onCreate={handleCatCreate}
        onRename={handleCatRename}
        onResetBuiltin={handleCatResetBuiltin}
        onDelete={handleCatDelete}
        onClose={() => setCatManagerOpen(false)}
      />
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function ensureFromArray(arr: FormatCategory[], catId: string): FormatCategory[] {
  if (arr.some((c) => c.id === catId)) return arr;
  const def = DEFAULT_FORMAT_TAXONOMY.find((c) => c.id === catId);
  if (def) return [...arr, { ...def, items: [...def.items] }];
  return [...arr, { id: catId, label: titleCase(catId), items: [] }];
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
