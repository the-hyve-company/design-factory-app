// CanvasModal.tsx — Aspect ratio / viewport picker.
//
// "Responsive" is not one of three exclusive sections. The user picks
// an aspect-ratio BASE (preset OR custom WxH) and OPTIONALLY marks a
// "Responsivo" checkbox in the footer that adapts the base to the
// viewport. Selection schema lives in data/canvas-presets.ts.
//
// Selected state uses the unified "dot accent" pattern: each row has a
// `.dmv2-row-check` bowl with a `.dmv2-row-check-dot` that scales 0→1
// when picked. Same shape across Canvas / Format / Rules modals.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DfModal } from "@/components/DfModal";
import {
  getEffectiveCanvasPresets,
  formatCanvasMeta,
  type CanvasPreset,
  type CanvasSelection,
} from "@/data/canvas-presets";
import { useT } from "@/i18n";
import { canvasLabel, canvasHint } from "@/i18n/builtin-labels";

interface CanvasModalProps {
  open: boolean;
  initial: CanvasSelection | null;
  onClose: () => void;
  onApply: (next: CanvasSelection | null) => void;
}

export function CanvasModal({ open, initial, onClose, onApply }: CanvasModalProps) {
  const { t, lang } = useT();
  const [draft, setDraft] = useState<CanvasSelection | null>(initial);
  const [customW, setCustomW] = useState<string>("");
  const [customH, setCustomH] = useState<string>("");
  const [responsive, setResponsive] = useState<boolean>(false);
  // Memoize so the effect deps below don't churn on every render. Same
  // bug-class FormatModal had pre-v6 (the cause of "categoria não
  // colapsa"). The catalog is stable for the modal's lifecycle.
  const presets: CanvasPreset[] = useMemo(() => getEffectiveCanvasPresets(), []);

  // Hydrate draft when modal opens. Custom inputs hydrate too so
  // re-opening keeps last typed values visible. Responsive flag hydrates
  // separately because it's a layer on top of the base.
  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setResponsive(Boolean(initial?.responsive));
    if (initial?.kind === "custom") {
      setCustomW(initial.width ? String(initial.width) : "");
      setCustomH(initial.height ? String(initial.height) : "");
    } else {
      setCustomW("");
      setCustomH("");
    }
  }, [open, initial]);

  const pickPreset = useCallback((preset: CanvasPreset) => {
    setDraft((prev) => ({
      kind: "preset",
      presetId: preset.id,
      responsive: prev?.responsive ?? false,
    }));
  }, []);

  const commitCustom = useCallback(() => {
    const w = parseInt(customW, 10);
    const h = parseInt(customH, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    setDraft((prev) => ({
      kind: "custom",
      width: w,
      height: h,
      responsive: prev?.responsive ?? false,
    }));
  }, [customW, customH]);

  const apply = useCallback(() => {
    // Stitch the responsive flag onto the draft on apply. We avoid mutating
    // draft on every checkbox toggle so tests can read the flag direct off
    // the local state.
    if (!draft) {
      onApply(null);
    } else {
      onApply({ ...draft, responsive });
    }
    onClose();
  }, [draft, responsive, onApply, onClose]);

  const clear = useCallback(() => {
    setDraft(null);
    setResponsive(false);
  }, []);

  const isPicked = (preset: CanvasPreset): boolean =>
    draft?.kind === "preset" && draft.presetId === preset.id;

  const customPicked = draft?.kind === "custom";

  return (
    <DfModal
      open={open}
      onClose={onClose}
      size="lg"
      className="cnv-modal"
      head={
        <header className="dmv2-head">
          <div className="dmv2-head-text">
            <span className="dmv2-eyebrow">{t("canvas.modal.eyebrow")}</span>
            <h2 className="dmv2-title">{t("canvas.modal.title")}</h2>
            <p className="dmv2-subtitle">{t("canvas.modal.subtitle")}</p>
          </div>
          <button
            type="button"
            className="dmv2-close"
            aria-label={t("modal.close")}
            onClick={onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
      }
      foot={
        <div className="dmv2-foot">
          <div className="dmv2-foot-left">
            <span className="dmv2-foot-stat">
              {draft
                ? draft.kind === "custom"
                  ? draft.width && draft.height
                    ? `${t("canvas.row.custom")} · ${draft.width}×${draft.height}${responsive ? ` · ${t("canvas.responsive.suffix")}` : ""}`
                    : t("canvas.foot.custom.empty")
                  : `${(() => {
                      const p = presets.find((pp) => pp.id === draft.presetId);
                      return p ? canvasLabel(p, lang) : "—";
                    })()}${responsive ? ` · ${t("canvas.responsive.suffix")}` : ""}`
                : t("canvas.foot.empty")}
            </span>

            {/* v28: Responsivo moves into the footer-left slot as a
             * compact pill so it doesn't crowd the action buttons. Same
             * tactile bowl/dot vocabulary as before. */}
            <label className="cnv-responsive-toggle" data-on={responsive ? "true" : "false"}>
              <input
                type="checkbox"
                checked={responsive}
                onChange={(e) => setResponsive(e.target.checked)}
                aria-label={t("canvas.responsive.aria")}
              />
              <span className="cnv-responsive-bowl" aria-hidden>
                <span className="cnv-responsive-dot" />
              </span>
              <span className="cnv-responsive-label">{t("canvas.responsive.label")}</span>
            </label>
          </div>

          <div className="dmv2-foot-actions">
            <button type="button" className="dmv2-btn-text" onClick={clear} disabled={!draft}>
              {t("modal.clear")}
            </button>
            <button type="button" className="dmv2-btn-primary" onClick={apply}>
              {t("modal.apply")}
            </button>
          </div>
        </div>
      }
    >
      {/* v28: single unified section — presets + Personalizado as last
       * row with W × H inputs inline. Rationale: 8 presets + custom is
       * one decision, not two. The previous split section made the
       * modal feel disconnected. */}
      <section className="dmv2-section">
        <header className="dmv2-cat-head dmv2-cat-head--static">
          <span className="dmv2-cat-label">{t("canvas.section.presets")}</span>
          <span className="dmv2-cat-count">{presets.length + 1}</span>
        </header>
        <div className="dmv2-rows">
          {presets.map((preset) => {
            const on = isPicked(preset);
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`dmv2-row${on ? " is-on" : ""}`}
                onClick={() => pickPreset(preset)}
              >
                <span className="dmv2-row-check" aria-hidden>
                  <span className="dmv2-row-check-dot" />
                </span>
                <span className="dmv2-row-label">{canvasLabel(preset, lang)}</span>
                <span className="dmv2-row-desc">
                  {formatCanvasMeta(preset, canvasHint(preset, lang))}
                </span>
              </button>
            );
          })}

          {/* Personalizado row — inline W × H always visible, no separate
           * section header. Click anywhere on the row commits the values. */}
          <div
            className={`dmv2-row dmv2-row--custom${customPicked ? " is-on" : ""}`}
            role="radio"
            aria-checked={customPicked}
            tabIndex={0}
            onClick={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                commitCustom();
              }
            }}
          >
            <span className="dmv2-row-check" aria-hidden>
              <span className="dmv2-row-check-dot" />
            </span>
            <span className="dmv2-row-label">{t("canvas.row.custom")}</span>
            <div className="cnv-custom-inputs" onClick={(e) => e.stopPropagation()}>
              <input
                className="cnv-custom-input"
                type="number"
                min={1}
                max={10000}
                placeholder={t("canvas.input.width")}
                value={customW}
                onChange={(e) => setCustomW(e.target.value)}
                onBlur={commitCustom}
                aria-label={t("canvas.input.width")}
              />
              <span className="cnv-custom-x" aria-hidden>
                ×
              </span>
              <input
                className="cnv-custom-input"
                type="number"
                min={1}
                max={10000}
                placeholder={t("canvas.input.height")}
                value={customH}
                onChange={(e) => setCustomH(e.target.value)}
                onBlur={commitCustom}
                aria-label={t("canvas.input.height")}
              />
              <span className="cnv-custom-unit">px</span>
            </div>
          </div>
        </div>
      </section>
    </DfModal>
  );
}
