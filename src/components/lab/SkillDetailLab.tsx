// SkillDetailLab — design-lab faceplate for viewing/editing an existing
// skill. Rendered instead of SkillDetailModal when ?modalLab=1. Matches the
// SkillsModalLab visual language (same faceplate shell + dsl-* vocabulary).
// Presentational: Save / Delete are stubbed (logs intent + closes); the real
// updateSkill / deleteSkill re-wire when this direction is approved.

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SkillDetailDirectionA } from "@/components/lab/SkillDetailDirectionA";
import type { Skill } from "@/lib/claude-bridge";
import "@/styles/np-modal.css";
import "@/styles/np-v8.css";
import "@/styles/skeu-hero.css";
import "@/styles/ds-modal-lab.css";

export interface SkillDetailLabProps {
  skill: Skill;
  onClose: () => void;
  onChanged: (next: Skill) => void;
  onDeleted: (id: string) => void;
}

export function SkillDetailLab({ skill, onClose, onChanged, onDeleted }: SkillDetailLabProps) {
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
        aria-label={`Skill ${skill.name}`}
      >
        <header className="np-modal-face">
          <span className="np-modal-face-sheen" aria-hidden="true" />
          <div className="np-modal-face-mark is-active">
            <Logo size={22} />
          </div>
          <div className="np-modal-face-title-slot">
            <div className="np-modal-face-kicker">skill</div>
            <div className="np-modal-face-title-input" style={{ pointerEvents: "none" }}>
              {skill.name}
            </div>
          </div>
          <button type="button" className="np-modal-close" onClick={onClose} aria-label="Fechar">
            <span className="np-modal-close-glyph" aria-hidden="true">
              <X size={16} strokeWidth={2} />
            </span>
          </button>
        </header>

        <div className="np-modal-stage">
          <SkillDetailDirectionA
            skill={skill}
            onClose={onClose}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
