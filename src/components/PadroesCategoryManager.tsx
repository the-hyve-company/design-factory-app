// PadroesCategoryManager.tsx — generic category-management modal for
// Settings · Padrões · Formats and Rules tabs.
//
// user spec:
//   "essa questao de categorias tambem poder gerenciar"
//
// user spec:
//   "no gerenciar categorias quero poder deletar categorias, dai os q
//    usavam aquela categoria ficam como custom ate q eu realoque."
//
// Surface anatomy (editorial, NOT skeu-dense):
//   ┌─ header (title + close) ──────────────────────────────────────────┐
//   │ Categorias [×] │
//   │ subtitle: rename defaults, create customs, etc. │
//   ├─ create row ──────────────────────────────────────────────────────┤
//   │ [ name input ] [ + Criar ] │
//   ├─ list of categories ──────────────────────────────────────────────┤
//   │ • Builtin name [PADRÃO] [12 itens] [Renomear] │
//   │ • Custom name [vazia] [Renomear] [Excluir] │
//   │ • Custom name [4 itens] [Renomear] [Excluir] │
//   │ ... │
//   └────────────────────────────────────────────────────────────────────┘
//
// Inline rename: clicking [Renomear] switches the row to an input field
// with [Salvar]/[Cancelar]. Custom delete uses PadroesConfirmModal.
//
// Constraints (UX guards):
//   · Builtin categories: rename creates an override (Reset name resets it)
//   · Custom categories: full rename + delete
//   · : Custom categories with items CAN be deleted — items cascade to
//     "Sem categoria" (orphan bucket) where user can reassign them.
//     Confirm modal warns about cascade count when items > 0.
//   · Max 20 custom categories
//   · Duplicate names blocked

import { useState, useMemo } from "react";
import { useT } from "@/i18n";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";

const MAX_CUSTOM_CATEGORIES = 20;

export interface ManagedCategory {
  id: string;
  label: string;
  /** True for framework defaults. */
  builtin: boolean;
  /** Number of items currently in this category. */
  itemCount: number;
  /** True when builtin's label has been overridden. */
  hasOverride?: boolean;
}

export interface PadroesCategoryManagerProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Modal title — defaults to "Categorias". */
  title?: string;
  /** Subtitle prose under the title. */
  subtitle?: string;
  /** Categories to render — combination of builtin + custom. */
  categories: ManagedCategory[];
  /** Triggered when user creates a new category. */
  onCreate: (label: string) => void | Promise<void>;
  /** Triggered when user renames a category (builtin = override). */
  onRename: (id: string, nextLabel: string) => void | Promise<void>;
  /** Triggered when user resets a builtin name override. */
  onResetBuiltin?: (id: string) => void | Promise<void>;
  /** Triggered when user deletes a custom category. Builtins cannot delete. */
  onDelete: (id: string) => void | Promise<void>;
  /** Triggered when modal dismissed. */
  onClose: () => void;
}

export function PadroesCategoryManager({
  open,
  title,
  subtitle,
  categories,
  onCreate,
  onRename,
  onResetBuiltin,
  onDelete,
  onClose,
}: PadroesCategoryManagerProps) {
  const { t } = useT();
  const [createInput, setCreateInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const customCount = useMemo(() => categories.filter((c) => !c.builtin).length, [categories]);
  const atCapacity = customCount >= MAX_CUSTOM_CATEGORIES;

  const pendingDelete = useMemo(
    () => categories.find((c) => c.id === pendingDeleteId) ?? null,
    [categories, pendingDeleteId],
  );

  if (!open) return null;

  const handleCreate = async () => {
    const trimmed = createInput.trim();
    if (!trimmed) {
      setCreateError(t("settings.padroes.cats.empty.input"));
      return;
    }
    const exists = categories.some((c) => c.label.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setCreateError(t("settings.padroes.cats.duplicate"));
      return;
    }
    if (atCapacity) {
      setCreateError(t("settings.padroes.cats.duplicate"));
      return;
    }
    await onCreate(trimmed);
    setCreateInput("");
    setCreateError(null);
  };

  const handleStartRename = (cat: ManagedCategory) => {
    setRenameId(cat.id);
    setRenameDraft(cat.label);
  };

  const handleConfirmRename = async (cat: ManagedCategory) => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === cat.label) {
      setRenameId(null);
      return;
    }
    const collision = categories.some(
      (c) => c.id !== cat.id && c.label.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (collision) {
      // silent — keep input open with stale draft so user can adjust
      return;
    }
    await onRename(cat.id, trimmed);
    setRenameId(null);
  };

  const handleRequestDelete = (cat: ManagedCategory) => {
    // Allow deleting custom categories with items. Cascade is
    // surfaced in the confirm modal body so user knows what happens.
    if (cat.builtin) return;
    setPendingDeleteId(cat.id);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await onDelete(pendingDelete.id);
    setPendingDeleteId(null);
  };

  return (
    <>
      <div
        className="padroes-cat-modal-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="padroes-cat-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="padroes-cat-modal-title"
        >
          <header className="padroes-cat-modal-head">
            <div>
              <h3 id="padroes-cat-modal-title" className="padroes-cat-modal-title">
                {title ?? t("settings.padroes.cats.modal.title")}
              </h3>
              <p className="padroes-cat-modal-sub">
                {subtitle ?? t("settings.padroes.cats.modal.subtitle")}
              </p>
            </div>
            <button
              type="button"
              className="padroes-cat-modal-close"
              onClick={onClose}
              aria-label={t("settings.padroes.cats.close")}
            >
              ×
            </button>
          </header>

          {/* CREATE ROW */}
          <div className="padroes-cat-create">
            <input
              type="text"
              className="padroes-cat-create-input"
              placeholder={t("settings.padroes.cats.create.placeholder")}
              value={createInput}
              onChange={(e) => {
                setCreateInput(e.target.value);
                if (createError) setCreateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              disabled={atCapacity}
              maxLength={40}
              aria-label={t("settings.padroes.cats.create.placeholder")}
            />
            <button
              type="button"
              className="padroes-cat-create-cta"
              onClick={() => void handleCreate()}
              disabled={!createInput.trim() || atCapacity}
            >
              + {t("settings.padroes.cats.create.cta")}
            </button>
          </div>
          {createError && (
            <p className="padroes-cat-create-error" role="alert">
              {createError}
            </p>
          )}

          {/* LIST */}
          <ul className="padroes-cat-list" role="list">
            {categories.map((cat) => {
              const isRenaming = renameId === cat.id;
              const hasItems = cat.itemCount > 0;
              const itemLabel =
                cat.itemCount === 0
                  ? t("settings.padroes.cats.items.empty")
                  : cat.itemCount === 1
                    ? t("settings.padroes.cats.items.count.one")
                    : t("settings.padroes.cats.items.count").replace("{0}", String(cat.itemCount));

              return (
                <li key={cat.id} className="padroes-cat-row">
                  <div className="padroes-cat-row-main">
                    {isRenaming ? (
                      <input
                        type="text"
                        className="padroes-cat-rename-input"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleConfirmRename(cat);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenameId(null);
                          }
                        }}
                        onBlur={() => void handleConfirmRename(cat)}
                        autoFocus
                        maxLength={40}
                      />
                    ) : (
                      <span className="padroes-cat-row-label">{cat.label}</span>
                    )}
                    <div className="padroes-cat-row-meta">
                      {cat.builtin && (
                        <span className="padroes-cat-badge padroes-cat-badge--builtin">
                          {t("settings.padroes.cats.builtin.note")}
                        </span>
                      )}
                      {cat.builtin && cat.hasOverride && (
                        <span className="padroes-cat-badge padroes-cat-badge--edited">✎</span>
                      )}
                      <span className="padroes-cat-row-count">{itemLabel}</span>
                    </div>
                  </div>
                  <div className="padroes-cat-row-actions">
                    {!isRenaming && (
                      <button
                        type="button"
                        className="padroes-cat-row-action"
                        onClick={() => handleStartRename(cat)}
                      >
                        {t("settings.padroes.cats.action.rename")}
                      </button>
                    )}
                    {cat.builtin && cat.hasOverride && onResetBuiltin && (
                      <button
                        type="button"
                        className="padroes-cat-row-action"
                        onClick={() => void onResetBuiltin(cat.id)}
                      >
                        {t("settings.padroes.cats.action.reset")}
                      </button>
                    )}
                    {!cat.builtin && (
                      <button
                        type="button"
                        className="padroes-cat-row-action padroes-cat-row-action--danger"
                        onClick={() => handleRequestDelete(cat)}
                        title={
                          hasItems
                            ? t("settings.padroes.cats.delete.cascade.tip").replace(
                                "{0}",
                                String(cat.itemCount),
                              )
                            : undefined
                        }
                      >
                        {t("settings.padroes.cats.action.delete")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className="padroes-cat-modal-foot">
            <button type="button" className="padroes-cat-modal-foot-btn" onClick={onClose}>
              {t("settings.padroes.cats.close")}
            </button>
          </footer>
        </div>
      </div>

      {/* DELETE CONFIRM — cascade-aware body */}
      <PadroesConfirmModal
        open={Boolean(pendingDelete)}
        title={pendingDelete?.label ?? ""}
        body={
          pendingDelete
            ? pendingDelete.itemCount > 0
              ? t("settings.padroes.cats.delete.cascade.confirm")
                  .replace("{0}", pendingDelete.label)
                  .replace("{1}", String(pendingDelete.itemCount))
              : t("settings.padroes.cats.delete.empty.confirm").replace("{0}", pendingDelete.label)
            : ""
        }
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setPendingDeleteId(null)}
      />
    </>
  );
}
