// NewProjectModal — full-screen skeu modal that hosts the canonical
// New Project form.
//
// Surface invariants:
//   · The faceplate title is an editable INPUT (not static text).
//     Engraved typography is preserved (mono uppercase,
//     letter-spacing 0.14em, text-shadow) with an accent caret. The
//     user edits the project name directly on the chrome strip, which
//     frees the inner form from a dedicated name zone.
//   · NewProjectFormSkeu is rendered without `.cnp-zone--name`. The
//     modal owns the name state and passes it via a `name` prop plus
//     `onNameChange` so the form's payload assembly keeps working.
//   · The faceplate logo glow tracks name length via .is-active.
//
// Why a custom modal (not DfModal): the form needs an explicit
// "mechanical machine" feel — thick bezel chrome, top sheen, deep
// surrounding shadow, header that reads as a control-panel faceplate.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@/components/Logo";
import { NewProjectFormSkeu, type NewProjectFormPayload } from "@/components/NewProjectFormSkeu";
import { useT } from "@/i18n";

// Friendly suggested name so the Begin button is never blocked by an
// empty field on first paint. The user almost always replaces it.
// User direction 2026-05-15: keep it simple — just "Untitled".
function makeSuggestedName(): string {
  return "Untitled";
}
import "@/styles/np-modal.css";
import "@/styles/np-v8.css";
// apply canonical SkeuHero DNA (ascii grain backdrop) to .np-modal-stage.
// User spec 2026-05-05: "esse hero eh a ref principal" — extends the
// hero pattern to wrap the entire modal body so the form lives "inside the hero".
import "@/styles/skeu-hero.css";

export type { NewProjectFormPayload } from "@/components/NewProjectFormSkeu";

export interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** Forwarded to <NewProjectFormSkeu />. May be async. */
  onCreate: (payload: NewProjectFormPayload) => void | Promise<void>;
}

export function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps) {
  const { t } = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  // v8: lift the name into the modal so the faceplate input edits it AND
  // the form gets it via a prop. Bumped key on close still resets.
  const formKeyRef = useRef(0);
  const [name, setName] = useState(() => makeSuggestedName());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const nameTouched = name.length > 0;

  // ESC handler — document-level so it works even when focus is inside
  // a nested input. Skips when a nested DfModal is open.
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inNestedModal = (e.target as Element)?.closest?.(".df-modal-backdrop");
      if (inNestedModal && !cardRef.current?.contains(e.target as Node)) return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKey]);

  // When the modal goes from open → closed, bump the key so the next
  // mount is clean. Doing it on close (not open) avoids a flash of
  // empty form during the close animation.
  useEffect(() => {
    if (!open) {
      formKeyRef.current += 1;
      // Re-seed with a fresh suggested name so the next open is never
      // empty. User-typed names are discarded with the modal close.
      setName(makeSuggestedName());
    }
  }, [open]);

  // Select the suggested name on mount so a single keypress replaces
  // it — the user gets the convenience of a default without the
  // friction of deleting it manually.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      titleInputRef.current?.select();
    }, 80);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="np-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="np-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-modal-title"
      >
        {/* Faceplate — sheen on top, engraved title (editable input),
         * key-style close. Rivets are intentionally absent so the
         * topbar reads as a clean nameplate; the sheen sweep
         * keyframe and the logo glow stay. */}
        <header className="np-modal-face">
          <span className="np-modal-face-sheen" aria-hidden="true" />

          {/* Logo glow — flips when name is non-empty (v6 behavior preserved). */}
          <div className={`np-modal-face-mark${nameTouched ? " is-active" : ""}`}>
            <Logo size={22} />
          </div>

          {/* The title slot hosts the editable input; the kicker
           * stays static above it. */}
          <div className="np-modal-face-title-slot">
            <div className="np-modal-face-kicker">{t("newproject.kicker")}</div>
            <input
              ref={titleInputRef}
              id="np-modal-title"
              className="np-modal-face-title-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("newproject.title.placeholder")}
              aria-label={t("newproject.title.inline.aria")}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <button
            type="button"
            className="np-modal-close"
            onClick={onClose}
            aria-label={t("newproject.close.label")}
          >
            <span className="np-modal-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>

        {/* Body — skeu form on a recessed inner stage. v8: name lives on
         * the faceplate, so the form starts at the prompt (no zone--name). */}
        <div className="np-modal-stage">
          <NewProjectFormSkeu
            key={formKeyRef.current}
            showHero={false}
            controlledName={name}
            onCreate={onCreate}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
