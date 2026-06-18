// DsModalLab — design-lab host for the Design System modal redesign.
// Rendered instead of DsSetupModal when ?modalLab=1 (dev only). Owns the
// New Project faceplate shell (backdrop + card + engraved face + recessed
// stage) and a direction switcher; each direction supplies only the stage
// content so A/B stay visually comparable. These are high-fidelity design
// presentations — the real generation logic is re-wired onto whichever
// direction wins.

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { DsDirectionA } from "@/components/lab/DsDirectionA";
import type { DsEntry } from "@/types/ds";
import "@/styles/np-modal.css";
import "@/styles/np-v8.css";
import "@/styles/skeu-hero.css";
import "@/styles/ds-modal-lab.css";

export interface DsModalLabProps {
  open: boolean;
  onClose: () => void;
  /** Called after the DS is persisted. The second arg lets the DS lab
   *  signal intent: when the user saved with "Gerar preview visual" ON,
   *  the caller can route the user to the DS detail Preview tab so the
   *  in-flight generation has somewhere to surface (vs. the modal
   *  closing into a silent grid card while the daemon runs for ~minute). */
  onSaved: (entry: DsEntry, opts?: { openPreview?: boolean }) => void;
}

export function DsModalLab({ open, onClose, onSaved }: DsModalLabProps) {
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
        className="np-modal-card dsl-card"
        role="dialog"
        aria-modal="true"
        aria-label="Design system"
      >
        <header className="np-modal-face">
          <span className="np-modal-face-sheen" aria-hidden="true" />
          <div className="np-modal-face-mark is-active">
            <Logo size={22} />
          </div>
          <div className="np-modal-face-title-slot">
            <div className="np-modal-face-kicker">design system</div>
            <div className="np-modal-face-title-input" style={{ pointerEvents: "none" }}>
              Forjar um design system
            </div>
          </div>
          <button type="button" className="np-modal-close" onClick={onClose} aria-label="Fechar">
            <span className="np-modal-close-glyph" aria-hidden="true">
              <X size={16} strokeWidth={2} />
            </span>
          </button>
        </header>

        <div className="np-modal-stage">
          <DsDirectionA onClose={onClose} onSaved={onSaved} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
