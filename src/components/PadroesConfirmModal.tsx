// PadroesConfirmModal.tsx — reusable confirm dialog for Settings · Padrões
// destructive actions (delete custom item, delete category, hide builtin).
//
// user spec:
//   "quero poder apagar itens tambem e essa questao de categorias tambem
//    poder gerenciar"
//
// Design:
//   · Editorial card — flat surface, generous padding, no skeu density
//   · Title + body + action row (Cancel + destructive Confirm)
//   · Esc closes; Enter confirms (focus auto-moves to confirm button)
//   · Backdrop click closes
//   · Editorial typography, NOT premium-skeu density (matches Padrões scope)
//
// Anti-skeu: lives in Settings/Padrões; NOT used in NewProject modal.

import { useEffect, useRef } from "react";
import { useT } from "@/i18n";

export type ConfirmTone = "danger" | "neutral";

export interface PadroesConfirmModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Modal title — short, imperative. */
  title: string;
  /** Body — 1-2 sentences in pt-BR/EN explaining consequence. */
  body: string;
  /** Label for the confirm button. Defaults to "Excluir"/"Delete". */
  confirmLabel?: string;
  /** Confirm tone. `danger` = red text on confirm. */
  tone?: ConfirmTone;
  /** Triggered when user confirms. */
  onConfirm: () => void;
  /** Triggered when modal dismissed (Esc, backdrop, Cancel). */
  onClose: () => void;
  /** When true, the confirm action is in flight — disables the confirm
   *  button + Enter so the user gets feedback and can't re-fire it. */
  busy?: boolean;
}

export function PadroesConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  tone = "danger",
  onConfirm,
  onClose,
  busy = false,
}: PadroesConfirmModalProps) {
  const { t } = useT();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // Focus confirm button on open + Esc/Enter handlers.
  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => confirmBtnRef.current?.focus(), 50);

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        // Only fire confirm when user is NOT typing inside an input.
        const target = e.target as HTMLElement | null;
        const isTyping =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (isTyping) return;
        e.preventDefault();
        if (!busy) onConfirm();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose, onConfirm, busy]);

  if (!open) return null;

  return (
    <div
      className="padroes-confirm-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="padroes-confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="padroes-confirm-title"
        aria-describedby="padroes-confirm-body"
      >
        <h3 id="padroes-confirm-title" className="padroes-confirm-title">
          {title}
        </h3>
        <p id="padroes-confirm-body" className="padroes-confirm-body">
          {body}
        </p>
        <div className="padroes-confirm-actions">
          <button
            type="button"
            className="padroes-confirm-btn padroes-confirm-btn--cancel"
            onClick={onClose}
          >
            {t("padroes.confirm.cancel")}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`padroes-confirm-btn padroes-confirm-btn--${tone}`}
            onClick={() => {
              if (!busy) onConfirm();
            }}
            disabled={busy}
            style={busy ? { opacity: 0.6, cursor: "progress" } : undefined}
          >
            {confirmLabel ??
              (tone === "danger" ? t("padroes.confirm.delete") : t("padroes.confirm.confirm"))}
          </button>
        </div>
      </div>
    </div>
  );
}
