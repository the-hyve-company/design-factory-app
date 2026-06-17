// CanvasPresetsEditor.tsx — Settings · Canvas.
//
// Affordances:
//   · DELETE is promoted to the TOP of the detail panel (visible
//     header action, not buried in the footer)
//   · BUILTINs can be deleted permanently ("Excluir permanentemente"
//     CTA — distinct from the "Ocultar do picker" toggle, which is a
//     soft hide)
//   · IMPORT / EXPORT JSON via the shared <ImportExportControls>
//   · RESET ALL — wipes customs + overrides + hidden, restores
//     defaults
//   · BULK select via always-visible checkboxes in TaxonomyManager
//   · INLINE VALIDATION — duplicate name, non-positive dims, ratio
//     mismatch
//
// Persistence: writeGlobalConfig + db.setSetting +
// canvas_presets_hidden_builtins.

import { useEffect, useMemo, useState } from "react";
import { db, writeGlobalConfig } from "@/lib/claude-bridge";
import { TaxonomyManager, type TaxonomyItem } from "@/components/TaxonomyManager";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";
import { ImportExportControls, type ImportPreview } from "@/components/ImportExportControls";
import { useT, type Lang } from "@/i18n";
import { canvasLabel, canvasHint } from "@/i18n/builtin-labels";
import {
  buildCanvasPresetsExport,
  DEFAULT_CANVAS_PRESETS,
  formatCanvasMeta,
  getCustomCanvasPresets,
  getHiddenBuiltinCanvasIds,
  parseCanvasPresetsImport,
  setCustomCanvasPresets,
  setDisabledCanvasPresetIds,
  setHiddenBuiltinCanvasIds,
  type CanvasPreset,
  type CanvasPresetsExportV1,
} from "@/data/canvas-presets";

// ─── Persistence helpers (kept identical to + new hidden slot) ────

async function loadDisabledPresets(): Promise<Set<string>> {
  const raw = await db.getSetting("canvas_presets_disabled").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
async function persistDisabled(s: Set<string>): Promise<void> {
  await db.setSetting("canvas_presets_disabled", JSON.stringify([...s])).catch(() => {});
}
async function persistCustoms(arr: CanvasPreset[]): Promise<void> {
  setCustomCanvasPresets(arr);
  await writeGlobalConfig({ custom_canvas_presets: arr as never }).catch(() => {});
  await db.setSetting("custom_canvas_presets", JSON.stringify(arr)).catch(() => {});
}
async function loadCustomOrder(): Promise<string[] | null> {
  const raw = await db.getSetting("custom_canvas_presets_order").catch(() => null);
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}
async function persistCustomOrder(ids: string[]): Promise<void> {
  await db.setSetting("custom_canvas_presets_order", JSON.stringify(ids)).catch(() => {});
}
// permanent hidden builtins.
async function loadHiddenBuiltins(): Promise<Set<string>> {
  const raw = await db.getSetting("canvas_presets_hidden_builtins").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
async function persistHiddenBuiltins(s: Set<string>): Promise<void> {
  setHiddenBuiltinCanvasIds([...s]);
  await writeGlobalConfig({ hidden_builtin_canvas_presets: [...s] as never }).catch(() => {});
  await db.setSetting("canvas_presets_hidden_builtins", JSON.stringify([...s])).catch(() => {});
}

// ─── Adapter — CanvasPreset → TaxonomyItem ────────────────────────────

interface CanvasItem extends TaxonomyItem {
  preset: CanvasPreset;
}

function toItem(preset: CanvasPreset, isCustom: boolean, enabled: boolean, lang: Lang): CanvasItem {
  return {
    id: preset.id,
    // use localized label + hint for builtins. Customs
    // (no entry in i18n table) fall through to preset.name as before.
    title: isCustom ? preset.name : canvasLabel(preset, lang),
    subtitle: isCustom
      ? formatCanvasMeta(preset)
      : formatCanvasMeta(preset, canvasHint(preset, lang)),
    builtin: !isCustom,
    enabled,
    preset,
  };
}

function newCustomPreset(): CanvasPreset {
  const id = `custom-canvas-${Date.now().toString(36)}`;
  return {
    id,
    name: "Novo canvas",
    ratio: "1:1",
    width: 1080,
    height: 1080,
  };
}

function cloneFromBuiltin(src: CanvasPreset): CanvasPreset {
  return {
    ...src,
    id: `custom-canvas-${Date.now().toString(36)}`,
    name: `${src.name} (custom)`,
  };
}

// ─── Validation helpers ─────────────────────────────────────────

interface CanvasValidation {
  /** Critical errors — block save. */
  errors: { name?: string; width?: string; height?: string };
  /** Soft warnings — show but allow save (e.g. ratio mismatch). */
  warnings: { ratio?: string };
}

function parseRatio(text: string): { w: number; h: number } | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

function validateCanvasDraft(
  draft: Partial<CanvasPreset>,
  context: { selfId: string; allItems: CanvasItem[]; t: (key: string) => string },
): CanvasValidation {
  const out: CanvasValidation = { errors: {}, warnings: {} };
  const name = (draft.name ?? "").trim();
  if (!name) {
    out.errors.name = context.t("settings.padroes.validation.empty.name");
  } else {
    const dup = context.allItems.find(
      (it) => it.id !== context.selfId && it.title.toLowerCase() === name.toLowerCase(),
    );
    if (dup) out.errors.name = context.t("settings.padroes.validation.duplicate");
  }
  // Width/Height: 0 is allowed only for the synthetic "free" preset.
  // For customs we require positive integers (or both zero for "free-like").
  const w = draft.width ?? 0;
  const h = draft.height ?? 0;
  const isFreeLike = w === 0 && h === 0;
  if (!isFreeLike) {
    if (w < 0) out.errors.width = context.t("settings.padroes.validation.invalid.dimensions");
    if (h < 0) out.errors.height = context.t("settings.padroes.validation.invalid.dimensions");
  }
  // Ratio soft warning.
  const ratio = (draft.ratio ?? "").trim();
  if (ratio && !isFreeLike && w > 0 && h > 0) {
    const parsed = parseRatio(ratio);
    if (parsed) {
      const target = parsed.w / parsed.h;
      const actual = w / h;
      // 2% slack tolerated (rounded sizes are common: 1200x630 ≠ 1.91:1).
      if (Math.abs(target - actual) / target > 0.02) {
        out.warnings.ratio = context.t("settings.padroes.validation.ratio.mismatch");
      }
    }
  }
  return out;
}

// ─── Aspect-ratio preview thumb ───────────────────────────────────────

function PresetThumb({ preset, max = 22 }: { preset: CanvasPreset; max?: number }) {
  if (!preset.width || !preset.height) {
    // "Free" canvas — render a dashed proxy to read as "any size".
    return (
      <div
        className="tx-mgr-preview-thumb tx-mgr-preview-thumb--free"
        style={{ width: max, height: max }}
        aria-hidden
      />
    );
  }
  const ratio = preset.width / preset.height;
  let w = max;
  let h = max;
  if (ratio >= 1) {
    w = max;
    h = Math.max(6, Math.round(max / ratio));
  } else {
    h = max;
    w = Math.max(6, Math.round(max * ratio));
  }
  return (
    <div className="tx-mgr-preview-thumb" style={{ width: w, height: h }} aria-hidden>
      <div className="tx-mgr-preview-thumb-fill" />
    </div>
  );
}

function PresetThumbLarge({ preset }: { preset: CanvasPreset }) {
  const { t } = useT();
  if (!preset.width || !preset.height) {
    return (
      <>
        <div className="tx-mgr-preview-large">
          <div
            className="tx-mgr-preview-thumb"
            style={{ width: 140, height: 100, opacity: 0.5 }}
            aria-hidden
          >
            <div className="tx-mgr-preview-thumb-fill" />
          </div>
        </div>
        <div className="tx-mgr-preview-meta">
          {t("settings.canvas.preview.label")} · {preset.ratio || "—"}
        </div>
      </>
    );
  }
  const ratio = preset.width / preset.height;
  const max = 220;
  let w = max;
  let h = max;
  if (ratio >= 1) {
    w = max;
    h = Math.max(40, Math.round(max / ratio));
  } else {
    h = max;
    w = Math.max(40, Math.round(max * ratio));
  }
  return (
    <>
      <div className="tx-mgr-preview-large">
        <div className="tx-mgr-preview-thumb" style={{ width: w, height: h }}>
          <div className="tx-mgr-preview-thumb-fill" />
        </div>
      </div>
      <div className="tx-mgr-preview-meta">{formatCanvasMeta(preset)}</div>
    </>
  );
}

// ─── Editor form (right panel) ────────────────────────────────────────

interface DetailFormProps {
  item: CanvasItem;
  allItems: CanvasItem[];
  onSave: (id: string, patch: Partial<CanvasPreset>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteBuiltinPermanent: (id: string) => Promise<void>;
  onDuplicate: (preset: CanvasPreset) => Promise<void>;
  onCloneBuiltin: (preset: CanvasPreset) => Promise<void>;
  onToggleEnabled: (id: string, next: boolean) => void;
}

function DetailForm({
  item,
  allItems,
  onSave,
  onDelete,
  onDeleteBuiltinPermanent,
  onDuplicate,
  onCloneBuiltin,
  onToggleEnabled,
}: DetailFormProps) {
  const { t, lang } = useT();
  const [draft, setDraft] = useState<Partial<CanvasPreset>>({});
  const [savedTick, setSavedTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePermanent, setConfirmDeletePermanent] = useState(false);

  // Hydrate draft when selected item changes.
  useEffect(() => {
    setDraft({
      name: item.preset.name,
      ratio: item.preset.ratio,
      width: item.preset.width,
      height: item.preset.height,
      hint: item.preset.hint ?? "",
    });
    setSavedTick(0);
  }, [item.id]);

  const isBuiltin = item.builtin;
  const previewPreset: CanvasPreset = useMemo(
    () => ({
      ...item.preset,
      name: draft.name ?? item.preset.name,
      ratio: draft.ratio ?? item.preset.ratio,
      width: draft.width ?? item.preset.width,
      height: draft.height ?? item.preset.height,
      hint: draft.hint ?? item.preset.hint,
    }),
    [draft, item.preset],
  );

  const validation = useMemo<CanvasValidation>(
    () => validateCanvasDraft(draft, { selfId: item.id, allItems, t }),
    [draft, item.id, allItems, t],
  );
  const hasErrors = Object.keys(validation.errors).length > 0;

  const handleSave = async () => {
    if (hasErrors) return;
    const patch: Partial<CanvasPreset> = {};
    if (draft.name && draft.name.trim() && draft.name !== item.preset.name)
      patch.name = draft.name.trim();
    if (draft.ratio && draft.ratio !== item.preset.ratio) patch.ratio = draft.ratio;
    if (draft.width !== undefined && draft.width !== item.preset.width) patch.width = draft.width;
    if (draft.height !== undefined && draft.height !== item.preset.height)
      patch.height = draft.height;
    if (draft.hint !== undefined && draft.hint !== (item.preset.hint ?? ""))
      patch.hint = draft.hint;
    await onSave(item.id, patch);
    setSavedTick((n) => n + 1);
    window.setTimeout(() => setSavedTick(0), 1500);
  };

  const enabled = item.enabled !== false;

  return (
    <>
      <div className="tx-mgr-detail-head">
        <div className="tx-mgr-detail-head-text">
          <span className="tx-mgr-detail-eyebrow">{t("settings.canvas.detail.eyebrow")}</span>
          <h3 className="tx-mgr-detail-title">
            {item.builtin ? canvasLabel(item.preset, lang) : item.preset.name}
          </h3>
        </div>
        <div className="tx-mgr-detail-actions">
          <button
            type="button"
            className="tx-mgr-detail-action"
            onClick={() => void onDuplicate(item.preset)}
            title={t("settings.canvas.action.duplicate")}
          >
            {t("settings.canvas.action.duplicate")}
          </button>
          {!isBuiltin && (
            <button
              type="button"
              className="tx-mgr-detail-action tx-mgr-detail-action--danger"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("settings.padroes.detail.delete.aria")}
            >
              {t("settings.canvas.action.delete")}
            </button>
          )}
          {isBuiltin && (
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

      <PresetThumbLarge preset={previewPreset} />

      {/* v19 — Builtin guidance + explicit Hide/Show action
       * Removed amber tip card. PADRÃO badge + actions suffice. */}
      {isBuiltin && (
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

      <div className="tx-mgr-form" aria-disabled={isBuiltin}>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`cv-name-${item.id}`}>
            {t("settings.canvas.field.name")}
          </label>
          <input
            id={`cv-name-${item.id}`}
            type="text"
            className={`tx-mgr-input${validation.errors.name ? " is-invalid" : ""}`}
            value={draft.name ?? ""}
            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            disabled={isBuiltin}
            aria-invalid={Boolean(validation.errors.name)}
          />
          {validation.errors.name && (
            <span className="tx-mgr-field-error" role="alert">
              {validation.errors.name}
            </span>
          )}
        </div>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`cv-ratio-${item.id}`}>
            {t("settings.canvas.field.ratio")}
          </label>
          <input
            id={`cv-ratio-${item.id}`}
            type="text"
            className="tx-mgr-input tx-mgr-input--mono"
            placeholder={t("settings.canvas.field.ratio.placeholder")}
            value={draft.ratio ?? ""}
            onChange={(e) => setDraft((p) => ({ ...p, ratio: e.target.value }))}
            disabled={isBuiltin}
          />
          {validation.warnings.ratio && (
            <span className="tx-mgr-field-warn">{validation.warnings.ratio}</span>
          )}
        </div>
        <div className="tx-mgr-field-row">
          <div className="tx-mgr-field">
            <label className="tx-mgr-field-label" htmlFor={`cv-w-${item.id}`}>
              {t("settings.canvas.field.width")}
            </label>
            <input
              id={`cv-w-${item.id}`}
              type="number"
              className={`tx-mgr-input tx-mgr-input--mono${validation.errors.width ? " is-invalid" : ""}`}
              value={draft.width ?? ""}
              onChange={(e) =>
                setDraft((p) => ({ ...p, width: parseInt(e.target.value, 10) || 0 }))
              }
              disabled={isBuiltin}
              min={0}
              aria-invalid={Boolean(validation.errors.width)}
            />
            {validation.errors.width && (
              <span className="tx-mgr-field-error" role="alert">
                {validation.errors.width}
              </span>
            )}
          </div>
          <div className="tx-mgr-field">
            <label className="tx-mgr-field-label" htmlFor={`cv-h-${item.id}`}>
              {t("settings.canvas.field.height")}
            </label>
            <input
              id={`cv-h-${item.id}`}
              type="number"
              className={`tx-mgr-input tx-mgr-input--mono${validation.errors.height ? " is-invalid" : ""}`}
              value={draft.height ?? ""}
              onChange={(e) =>
                setDraft((p) => ({ ...p, height: parseInt(e.target.value, 10) || 0 }))
              }
              disabled={isBuiltin}
              min={0}
              aria-invalid={Boolean(validation.errors.height)}
            />
            {validation.errors.height && (
              <span className="tx-mgr-field-error" role="alert">
                {validation.errors.height}
              </span>
            )}
          </div>
        </div>
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`cv-hint-${item.id}`}>
            {t("settings.canvas.field.hint")}
          </label>
          <input
            id={`cv-hint-${item.id}`}
            type="text"
            className="tx-mgr-input"
            placeholder={t("settings.canvas.field.hint.placeholder")}
            value={draft.hint ?? ""}
            onChange={(e) => setDraft((p) => ({ ...p, hint: e.target.value }))}
            disabled={isBuiltin}
          />
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
          {isBuiltin ? (
            <button
              type="button"
              className="df-btn df-btn--secondary df-btn--sm"
              onClick={() => void onCloneBuiltin(item.preset)}
              title={t("settings.canvas.action.duplicate")}
            >
              {t("settings.canvas.action.duplicate")}
            </button>
          ) : (
            <button
              type="button"
              className="df-btn df-btn--primary df-btn--sm"
              onClick={() => void handleSave()}
              disabled={hasErrors}
              title={hasErrors ? t("settings.padroes.validation.duplicate") : undefined}
            >
              {t("settings.canvas.action.save")}
            </button>
          )}
        </div>
      </div>

      <PadroesConfirmModal
        open={confirmDelete}
        title={item.preset.name}
        body={t("settings.canvas.action.delete.confirm").replace("{0}", item.preset.name)}
        tone="danger"
        confirmLabel={t("settings.canvas.action.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          void onDelete(item.id);
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <PadroesConfirmModal
        open={confirmDeletePermanent}
        title={item.preset.name}
        body={t("settings.padroes.builtin.action.delete.confirm").replace("{0}", item.preset.name)}
        tone="danger"
        confirmLabel={t("settings.padroes.builtin.action.delete")}
        onConfirm={() => {
          setConfirmDeletePermanent(false);
          void onDeleteBuiltinPermanent(item.id);
        }}
        onClose={() => setConfirmDeletePermanent(false)}
      />
    </>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────

export function CanvasPresetsEditor() {
  const { t, lang } = useT();
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(getHiddenBuiltinCanvasIds()));
  const [customs, setCustoms] = useState<CanvasPreset[]>(() => getCustomCanvasPresets());
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);

  useEffect(() => {
    void loadDisabledPresets().then((s) => setDisabled(s));
    void loadCustomOrder().then((o) => setCustomOrder(o));
    void loadHiddenBuiltins().then((s) => {
      setHidden(s);
      setHiddenBuiltinCanvasIds([...s]);
    });
  }, []);

  // Apply persisted order to customs (defaults always come first, then customs).
  const orderedCustoms = useMemo<CanvasPreset[]>(() => {
    if (!customOrder) return customs;
    const byId = new Map(customs.map((c) => [c.id, c]));
    const out: CanvasPreset[] = [];
    for (const id of customOrder) {
      const c = byId.get(id);
      if (c) {
        out.push(c);
        byId.delete(id);
      }
    }
    for (const remaining of byId.values()) out.push(remaining);
    return out;
  }, [customs, customOrder]);

  const items = useMemo<CanvasItem[]>(() => {
    const out: CanvasItem[] = [];
    // Builtins permanently hidden disappear from the list entirely.
    for (const p of DEFAULT_CANVAS_PRESETS) {
      if (hidden.has(p.id)) continue;
      out.push(toItem(p, false, !disabled.has(p.id), lang));
    }
    for (const p of orderedCustoms) out.push(toItem(p, true, !disabled.has(p.id), lang));
    return out;
  }, [disabled, hidden, orderedCustoms, lang]);

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleToggle = async (id: string, next: boolean) => {
    setDisabled((prev) => {
      const out = new Set(prev);
      if (next) out.delete(id);
      else out.add(id);
      setDisabledCanvasPresetIds([...out]);
      void persistDisabled(out);
      return out;
    });
  };

  const handleSave = async (id: string, patch: Partial<CanvasPreset>) => {
    if (Object.keys(patch).length === 0) return;
    const next = customs.map((p) => (p.id === id ? { ...p, ...patch } : p));
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleDelete = async (id: string) => {
    const next = customs.filter((p) => p.id !== id);
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleDeleteBuiltinPermanent = async (id: string) => {
    const out = new Set(hidden);
    out.add(id);
    setHidden(out);
    await persistHiddenBuiltins(out);
  };

  const handleBulkDelete = async (ids: string[]) => {
    const deletable = ids.filter((id) => customs.some((c) => c.id === id));
    if (deletable.length === 0) return;
    const next = customs.filter((p) => !deletable.includes(p.id));
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleBulkHideBuiltins = async (ids: string[]) => {
    const builtinIds = ids.filter((id) => DEFAULT_CANVAS_PRESETS.some((p) => p.id === id));
    if (builtinIds.length === 0) return;
    const out = new Set(hidden);
    for (const id of builtinIds) out.add(id);
    setHidden(out);
    await persistHiddenBuiltins(out);
  };

  const handleBulkToggleEnabled = async (ids: string[], enable: boolean) => {
    const out = new Set(disabled);
    for (const id of ids) {
      if (enable) out.delete(id);
      else out.add(id);
    }
    setDisabled(out);
    setDisabledCanvasPresetIds([...out]);
    await persistDisabled(out);
  };

  const handleCreate = async () => {
    const draft = newCustomPreset();
    const next = [...customs, draft];
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleDuplicate = async (src: CanvasPreset) => {
    const dup = cloneFromBuiltin(src);
    const next = [...customs, dup];
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleBulkDuplicate = async (ids: string[]) => {
    const newOnes: CanvasPreset[] = [];
    for (const id of ids) {
      const all = [...DEFAULT_CANVAS_PRESETS, ...customs];
      const src = all.find((p) => p.id === id);
      if (!src) continue;
      newOnes.push(cloneFromBuiltin(src));
    }
    if (newOnes.length === 0) return;
    const next = [...customs, ...newOnes];
    setCustoms(next);
    await persistCustoms(next);
  };

  const handleReorder = async (newIdsOrder: string[]) => {
    // Only reorder customs (defaults stay frozen at top).
    const customIds = newIdsOrder.filter((id) => customs.some((c) => c.id === id));
    setCustomOrder(customIds);
    await persistCustomOrder(customIds);
  };

  // ─── Import / Export / Reset ────────────────────────────────

  const previewImport = (payload: CanvasPresetsExportV1): ImportPreview => {
    const existingIds = new Set(customs.map((c) => c.id));
    const incomingIds = new Set(payload.customs.map((c) => c.id));
    const added: string[] = [];
    const replaced: string[] = [];
    const removed: string[] = [];
    for (const c of payload.customs) {
      if (existingIds.has(c.id)) replaced.push(c.name);
      else added.push(c.name);
    }
    for (const c of customs) {
      if (!incomingIds.has(c.id)) removed.push(c.name);
    }
    return { added, replaced, removed };
  };

  const applyImport = async (payload: CanvasPresetsExportV1, mode: "merge" | "replace") => {
    let nextCustoms: CanvasPreset[];
    if (mode === "replace") {
      nextCustoms = [...payload.customs];
    } else {
      // Merge: existing replaced by incoming on id collision; new ids appended.
      const byId = new Map(customs.map((c) => [c.id, c]));
      for (const c of payload.customs) byId.set(c.id, c);
      nextCustoms = [...byId.values()];
    }
    setCustoms(nextCustoms);
    await persistCustoms(nextCustoms);

    const nextDisabled = new Set(mode === "replace" ? [] : [...disabled]);
    for (const id of payload.disabledIds ?? []) nextDisabled.add(id);
    setDisabled(nextDisabled);
    setDisabledCanvasPresetIds([...nextDisabled]);
    await persistDisabled(nextDisabled);

    const nextHidden = new Set(mode === "replace" ? [] : [...hidden]);
    for (const id of payload.hiddenBuiltinIds ?? []) nextHidden.add(id);
    setHidden(nextHidden);
    await persistHiddenBuiltins(nextHidden);
  };

  const handleResetAll = async () => {
    setCustoms([]);
    await persistCustoms([]);
    const empty = new Set<string>();
    setDisabled(empty);
    setDisabledCanvasPresetIds([]);
    await persistDisabled(empty);
    setHidden(empty);
    await persistHiddenBuiltins(empty);
    setCustomOrder(null);
    await persistCustomOrder([]);
  };

  // ImportExportControls slot removed 2026-05-21 — handlers/exports
  // preserved for future surfaces. Silence TS6133 while they sit idle.
  void previewImport;
  void applyImport;
  void handleResetAll;
  void buildCanvasPresetsExport;
  void parseCanvasPresetsImport;
  void ImportExportControls;

  return (
    <TaxonomyManager<CanvasItem>
      kicker={t("settings.canvas.kicker")}
      title={t("settings.canvas.title")}
      description={t("settings.canvas.desc")}
      hideHero
      showSelectCheckboxes
      items={items}
      searchPlaceholder={t("settings.canvas.search")}
      createLabel={t("settings.canvas.create")}
      emptyTitle={t("settings.canvas.empty.search")}
      emptyBody={t("settings.canvas.empty.search.body")}
      emptyAllTitle={t("settings.canvas.empty.all.title")}
      emptyAllBody={t("settings.canvas.empty.all.body")}
      onCreate={() => void handleCreate()}
      onToggleEnabled={(id, on) => void handleToggle(id, on)}
      onDelete={(ids) => void handleBulkDelete(ids)}
      onDuplicate={(ids) => void handleBulkDuplicate(ids)}
      onReorder={(ids) => void handleReorder(ids)}
      onBulkToggleEnabled={(ids, enable) => void handleBulkToggleEnabled(ids, enable)}
      onBulkHideBuiltins={(ids) => void handleBulkHideBuiltins(ids)}
      renderRowPreview={(item) => <PresetThumb preset={item.preset} max={20} />}
      /* toolbarTopSlot removed 2026-05-21 — user ask: "remove
         Exportar / Importar / Resetar tudo". The export/import/reset
         payload functions are kept as exports in case we resurface
         these flows from a different surface. */
      renderDetail={({ item }) => (
        <DetailForm
          item={item}
          allItems={items}
          onSave={handleSave}
          onDelete={handleDelete}
          onDeleteBuiltinPermanent={handleDeleteBuiltinPermanent}
          onDuplicate={handleDuplicate}
          onCloneBuiltin={handleDuplicate}
          onToggleEnabled={(id, on) => void handleToggle(id, on)}
        />
      )}
    />
  );
}
