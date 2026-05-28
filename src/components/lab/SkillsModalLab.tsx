// SkillsModalLab — design-lab host for the Skills modal redesign. Rendered
// instead of SkillCreateModal / SkillImportModal when ?modalLab=1. Unifies
// "create" and "import" into one faceplate flow with a mode toggle, matching
// the DS lab + New Project hardware language. Presentational; the real
// install/import logic re-wires onto this once the design is approved.

import { createPortal } from "react-dom";
import { Logo } from "@/components/Logo";
import { SkillsDirectionA } from "@/components/lab/SkillsDirectionA";
import "@/styles/np-modal.css";
import "@/styles/np-v8.css";
import "@/styles/skeu-hero.css";
import "@/styles/ds-modal-lab.css";

export interface SkillsModalLabProps {
  open: boolean;
  initialMode?: "create" | "import";
  onClose: () => void;
}

export function SkillsModalLab({ open, initialMode = "create", onClose }: SkillsModalLabProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="np-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="np-modal-card dsl-card" role="dialog" aria-modal="true" aria-label="Skills">
        <header className="np-modal-face">
          <span className="np-modal-face-sheen" aria-hidden="true" />
          <div className="np-modal-face-mark is-active"><Logo size={22} /></div>
          <div className="np-modal-face-title-slot">
            <div className="np-modal-face-kicker">skills</div>
            <div className="np-modal-face-title-input" style={{ pointerEvents: "none" }}>
              Nova skill
            </div>
          </div>
          <button type="button" className="np-modal-close" onClick={onClose} aria-label="Fechar">
            <span className="np-modal-close-glyph" aria-hidden="true">×</span>
          </button>
        </header>

        <div className="np-modal-stage">
          <SkillsDirectionA initialMode={initialMode} onClose={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
