// ImportExportControls.tsx — shared toolbar for Settings · Padrões editors.
//
// user spec:
//   "edicao de formatos, regras e canvas ta incompleta, nao tem opcao de
//    apagar itens, melhore os paineis de edicao e gerenciamento"
//
// Wraps the top-of-editor row that exposes:
//   · Exportar — download JSON snapshot of customs + overrides + hidden
//   · Importar — file picker + preview modal (mesclar / substituir)
//   · Resetar tudo — confirm modal, then clear everything back to defaults
//
// Editorial-skin (Padrões scope) — flat surfaces, mono uppercase labels,
// no skeu density. Lives ABOVE the TaxonomyManager search input.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";
import { useT } from "@/i18n";

// ─── Types ────────────────────────────────────────────────────────────

export interface ImportPreview {
  /** Items the import payload would add. Free-form rendered list. */
  added: string[];
  /** Items in the existing slot that would be REPLACED on overwrite. */
  replaced: string[];
  /** Items that would be DELETED on full replace (in-state, not in import). */
  removed: string[];
}

export interface ImportExportControlsProps<TPayload> {
  /** Build the export payload from current in-memory state. */
  onExport: () => TPayload;
  /** Suggested filename (no extension; .json appended). */
  filename: string;
  /** Parse + validate raw JSON into the typed payload. Throws on invalid. */
  onParseImport: (raw: unknown) => TPayload;
  /** Compute preview diff for the import modal — informs the user. */
  onPreviewImport: (payload: TPayload) => ImportPreview;
  /** Apply import: "merge" preserves existing, "replace" wipes first. */
  onApplyImport: (payload: TPayload, mode: "merge" | "replace") => Promise<void>;
  /** Reset all customs + overrides + hidden to defaults. Destructive. */
  onResetAll: () => Promise<void>;
  /** Localized reset confirm body — explains what gets wiped. */
  resetConfirmBody: string;
  /** Optional extras shown to the right of the controls (e.g. counts). */
  extras?: ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────

export function ImportExportControls<TPayload>({
  onExport,
  filename,
  onParseImport,
  onPreviewImport,
  onApplyImport,
  onResetAll,
  resetConfirmBody,
  extras,
}: ImportExportControlsProps<TPayload>) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportFlash, setExportFlash] = useState(false);
  const [importPayload, setImportPayload] = useState<TPayload | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // ─── Export ────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    try {
      const payload = onExport();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after short delay to ensure download dispatched.
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setExportFlash(true);
      window.setTimeout(() => setExportFlash(false), 1800);
    } catch (err) {
      // Defensive — export shouldn't fail in practice.
      console.error("[ImportExportControls] export failed", err);
    }
  }, [filename, onExport]);

  // ─── Import (file pick → preview) ──────────────────────────────────
  const handleFileChosen = useCallback(
    async (file: File) => {
      setImportError(null);
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const payload = onParseImport(raw);
        const preview = onPreviewImport(payload);
        setImportPayload(payload);
        setImportPreview(preview);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setImportError(msg);
      }
    },
    [onParseImport, onPreviewImport],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleApplyImport = useCallback(
    async (mode: "merge" | "replace") => {
      if (!importPayload) return;
      await onApplyImport(importPayload, mode);
      setImportPayload(null);
      setImportPreview(null);
    },
    [importPayload, onApplyImport],
  );

  const closeImportModal = useCallback(() => {
    setImportPayload(null);
    setImportPreview(null);
    setImportError(null);
  }, []);

  // ─── Reset all ─────────────────────────────────────────────────────
  const handleResetConfirm = useCallback(async () => {
    setConfirmReset(false);
    await onResetAll();
  }, [onResetAll]);

  return (
    <>
      <div className="ie-controls" role="toolbar" aria-label={t("ie.controls.aria")}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileChosen(f);
            // Reset so same file can be picked twice.
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />

        <button
          type="button"
          className="ie-controls-btn"
          onClick={handleExport}
          title={t("ie.export.hint")}
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
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{t(exportFlash ? "ie.export.done" : "ie.export.label")}</span>
        </button>

        <button
          type="button"
          className="ie-controls-btn"
          onClick={handleImportClick}
          title={t("ie.import.hint")}
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
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{t("ie.import.label")}</span>
        </button>

        <span aria-hidden style={{ flex: 1 }} />

        {extras}

        <button
          type="button"
          className="ie-controls-btn ie-controls-btn--danger"
          onClick={() => setConfirmReset(true)}
          title={t("ie.reset.hint")}
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
            aria-hidden
          >
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 9 8 9" />
          </svg>
          <span>{t("ie.reset.label")}</span>
        </button>
      </div>

      {/* ─── Import preview / error modal ─────────────────────────── */}
      {importError && (
        <PadroesConfirmModal
          open={Boolean(importError)}
          title={t("ie.import.error.title")}
          body={importError}
          confirmLabel={t("ie.import.error.confirm")}
          tone="neutral"
          onConfirm={() => setImportError(null)}
          onClose={() => setImportError(null)}
        />
      )}

      {importPreview && importPayload && !importError && (
        <ImportPreviewModal
          preview={importPreview}
          onMerge={() => void handleApplyImport("merge")}
          onReplace={() => void handleApplyImport("replace")}
          onClose={closeImportModal}
        />
      )}

      {/* ─── Reset all confirm ────────────────────────────────────── */}
      <PadroesConfirmModal
        open={confirmReset}
        title={t("ie.reset.confirm.title")}
        body={resetConfirmBody}
        confirmLabel={t("ie.reset.confirm.cta")}
        tone="danger"
        onConfirm={() => void handleResetConfirm()}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}

// ─── Preview modal (inline, kept private) ─────────────────────────────

interface ImportPreviewModalProps {
  preview: ImportPreview;
  onMerge: () => void;
  onReplace: () => void;
  onClose: () => void;
}

function ImportPreviewModal({ preview, onMerge, onReplace, onClose }: ImportPreviewModalProps) {
  const { t } = useT();
  const empty =
    preview.added.length === 0 && preview.replaced.length === 0 && preview.removed.length === 0;

  return (
    <div
      className="padroes-confirm-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="padroes-confirm-card ie-import-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ie-import-title"
      >
        <h3 id="ie-import-title" className="padroes-confirm-title">
          {t("ie.import.preview.title")}
        </h3>
        <p className="padroes-confirm-body">
          {empty ? t("ie.import.preview.empty") : t("ie.import.preview.body")}
        </p>

        {!empty && (
          <div className="ie-import-diff">
            {preview.added.length > 0 && (
              <div className="ie-import-diff-section">
                <div className="ie-import-diff-label ie-import-diff-label--add">
                  {t("ie.import.preview.added").replace("{0}", String(preview.added.length))}
                </div>
                <ul className="ie-import-diff-list">
                  {preview.added.slice(0, 10).map((label, i) => (
                    <li key={i}>{label}</li>
                  ))}
                  {preview.added.length > 10 && (
                    <li className="ie-import-diff-more">+{preview.added.length - 10}</li>
                  )}
                </ul>
              </div>
            )}
            {preview.replaced.length > 0 && (
              <div className="ie-import-diff-section">
                <div className="ie-import-diff-label ie-import-diff-label--replace">
                  {t("ie.import.preview.replaced").replace("{0}", String(preview.replaced.length))}
                </div>
                <ul className="ie-import-diff-list">
                  {preview.replaced.slice(0, 10).map((label, i) => (
                    <li key={i}>{label}</li>
                  ))}
                  {preview.replaced.length > 10 && (
                    <li className="ie-import-diff-more">+{preview.replaced.length - 10}</li>
                  )}
                </ul>
              </div>
            )}
            {preview.removed.length > 0 && (
              <div className="ie-import-diff-section">
                <div className="ie-import-diff-label ie-import-diff-label--remove">
                  {t("ie.import.preview.removed").replace("{0}", String(preview.removed.length))}
                </div>
                <ul className="ie-import-diff-list">
                  {preview.removed.slice(0, 10).map((label, i) => (
                    <li key={i}>{label}</li>
                  ))}
                  {preview.removed.length > 10 && (
                    <li className="ie-import-diff-more">+{preview.removed.length - 10}</li>
                  )}
                </ul>
                <div className="ie-import-diff-note">{t("ie.import.preview.removed.note")}</div>
              </div>
            )}
          </div>
        )}

        <div className="padroes-confirm-actions ie-import-actions">
          <button
            type="button"
            className="padroes-confirm-btn padroes-confirm-btn--cancel"
            onClick={onClose}
          >
            {t("padroes.confirm.cancel")}
          </button>
          {!empty && (
            <button
              type="button"
              className="padroes-confirm-btn padroes-confirm-btn--neutral"
              onClick={onReplace}
            >
              {t("ie.import.action.replace")}
            </button>
          )}
          {!empty && (
            <button
              type="button"
              className="padroes-confirm-btn padroes-confirm-btn--danger"
              onClick={onMerge}
              autoFocus
            >
              {t("ie.import.action.merge")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
