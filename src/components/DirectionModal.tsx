// DirectionModal.tsx — Tabs-minimal modal for Category > Format > Directions > Anti-slop.
//
// 4 tabs at the top, one pane visible at a time. Tabs 03/04 are disabled
// until a format is picked. Selection is a local draft until Apply.
//
// Anti-slop semantics: opt-in. The format's preset list is shown
// unchecked; the user toggles each item to enable it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DfModal } from "@/components/DfModal";
import { useT } from "@/i18n";
import {
  CATEGORIAS,
  EIXOS,
  formatosByCategoria,
  directionsForFormato,
  getFormatoById,
  type CanvasOverrides,
  type CategoriaId,
  type Formato,
  type Direction,
  type DirectionSelection,
} from "@/data/direction-data";

type TabId = "01" | "02" | "03" | "04" | "05";

// ── Per-format canvas options ─────────────────────────────────────────
// Hard-coded per format: which fields to expose, what choices to show,
// what defaults to fall back to when the user doesn't customise. Kept
// in code (not YAML) because the choices are tied to render pipeline
// shapes — the dev-bridge supports specific ratios/viewports, can't
// freeform.

const RATIO_CHOICES_VIDEO = [
  { id: "16:9", name: "16:9", meta: "1920×1080" },
  { id: "9:16", name: "9:16", meta: "1080×1920" },
  { id: "1:1", name: "1:1", meta: "1080×1080" },
  { id: "4k", name: "4K", meta: "3840×2160" },
];
const FPS_CHOICES = [24, 30, 60];
const VIEWPORT_CHOICES_INTERFACE = [
  { id: "1920×1080", name: "Desktop", meta: "1920×1080" },
  { id: "1440×900", name: "Laptop", meta: "1440×900" },
  { id: "1024×768", name: "Tablet", meta: "1024×768" },
  { id: "390×844", name: "Mobile", meta: "390×844" },
];
const RATIO_CHOICES_SOCIAL = [
  { id: "1:1", name: "Square", meta: "1080×1080" },
  { id: "4:5", name: "Portrait", meta: "1080×1350" },
  { id: "9:16", name: "Story", meta: "1080×1920" },
];

interface CanvasFieldSpec {
  ratios?: typeof RATIO_CHOICES_VIDEO;
  fps?: boolean;
  duration?: boolean;
  viewports?: typeof VIEWPORT_CHOICES_INTERFACE;
  slides?: boolean;
}

function canvasSpecForFormat(f: Formato): CanvasFieldSpec {
  if (f.categoria === "video") {
    return { ratios: RATIO_CHOICES_VIDEO, fps: true, duration: true };
  }
  if (f.categoria === "interface") {
    // Landing/screen/slides: viewport size; ratio is implicit (16:9 work area).
    return { viewports: VIEWPORT_CHOICES_INTERFACE };
  }
  if (f.id === "carousel-square") {
    return { ratios: RATIO_CHOICES_SOCIAL, slides: true };
  }
  // og-image and others — fixed canvas.
  return {};
}

function specHasFields(spec: CanvasFieldSpec): boolean {
  return !!(spec.ratios || spec.fps || spec.duration || spec.viewports || spec.slides);
}

interface DirectionModalProps {
  open: boolean;
  initial: DirectionSelection | null;
  onClose: () => void;
  onApply: (next: DirectionSelection | null) => void;
}

// ─── Icons (SVG inline) ──────────────────────────────────────────────
const IconClose = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const IconCheck = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function CategoriaIcon({ id }: { id: CategoriaId }) {
  if (id === "video") {
    return (
      <svg className="dm-cat-ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    );
  }
  if (id === "interface") {
    return (
      <svg
        className="dm-cat-ico"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    );
  }
  return (
    <svg
      className="dm-cat-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <line x1="8.5" y1="7.5" x2="15.5" y2="7.5" />
      <line x1="8.5" y1="16.5" x2="15.5" y2="16.5" />
      <line x1="6" y1="9" x2="6" y2="15" />
      <line x1="18" y1="9" x2="18" y2="15" />
    </svg>
  );
}

// Migration helper: old projects stored `removedAntiSlop` (opt-out).
// New code uses `enabledAntiSlop` (opt-in). Treat legacy entries as if
// nothing is enabled — user re-enables what they want.
function normaliseSelection(raw: DirectionSelection | null): DirectionSelection | null {
  if (!raw) return null;
  if (Array.isArray(raw.enabledAntiSlop)) return raw;
  return {
    ...raw,
    enabledAntiSlop: [],
    customAntiSlop: raw.customAntiSlop ?? [],
  };
}

export function DirectionModal({ open, initial, onClose, onApply }: DirectionModalProps) {
  const { t, tf } = useT();
  const [draft, setDraft] = useState<DirectionSelection | null>(() => normaliseSelection(initial));
  const [activeCat, setActiveCat] = useState<CategoriaId>(() => {
    if (initial) {
      const f = getFormatoById(initial.formatoId);
      if (f) return f.categoria;
    }
    return "video";
  });
  const [activeTab, setActiveTab] = useState<TabId>(initial ? "03" : "01");
  const [customDraft, setCustomDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(normaliseSelection(initial));
    setCustomDraft("");
    if (initial) {
      const f = getFormatoById(initial.formatoId);
      if (f) {
        setActiveCat(f.categoria);
        // Re-open: jump straight to Directions (most common edit). Skip
        // Canvas unless user navigates back manually.
        setActiveTab("04");
      } else {
        setActiveTab("01");
      }
    } else {
      setActiveTab("01");
    }
  }, [open, initial]);

  const formato = draft ? getFormatoById(draft.formatoId) : null;
  const fmts = formatosByCategoria(activeCat);
  const eligible = formato ? directionsForFormato(formato) : [];
  const directionsByEixo = useMemo(() => {
    const m = new Map<string, Direction[]>();
    for (const e of EIXOS) m.set(e.id, []);
    for (const d of eligible) m.get(d.eixo)?.push(d);
    return m;
  }, [eligible]);

  const pickCat = (catId: CategoriaId) => {
    setActiveCat(catId);
    setActiveTab("02");
  };

  const pickFormato = (f: Formato) => {
    if (draft?.formatoId === f.id) {
      setActiveTab(specHasFields(canvasSpecForFormat(f)) ? "03" : "04");
      return;
    }
    setDraft({
      formatoId: f.id,
      directionIds: [],
      enabledAntiSlop: [],
      customAntiSlop: [],
    });
    // If the format exposes canvas fields, land on Canvas tab; otherwise
    // skip straight to Directions (fixed-canvas formats like og-image).
    setActiveTab(specHasFields(canvasSpecForFormat(f)) ? "03" : "04");
  };

  const updateCanvas = (patch: Partial<CanvasOverrides>) => {
    if (!draft) return;
    const next = { ...(draft.canvas ?? {}), ...patch };
    // Remove keys set back to defaults so meta.json stays clean.
    const f = getFormatoById(draft.formatoId);
    if (f) {
      if (next.ratio === f.canvas.ratio) delete next.ratio;
      if (next.duration === f.canvas.duration) delete next.duration;
      if (next.fps === 30) delete next.fps;
    }
    const isEmpty = Object.keys(next).length === 0;
    setDraft({ ...draft, canvas: isEmpty ? undefined : next });
  };

  const toggleDirection = (id: string) => {
    if (!draft) return;
    const has = draft.directionIds.includes(id);
    setDraft({
      ...draft,
      directionIds: has ? draft.directionIds.filter((x) => x !== id) : [...draft.directionIds, id],
    });
  };

  const toggleAntiSlop = (text: string) => {
    if (!draft) return;
    const on = draft.enabledAntiSlop.includes(text);
    setDraft({
      ...draft,
      enabledAntiSlop: on
        ? draft.enabledAntiSlop.filter((x) => x !== text)
        : [...draft.enabledAntiSlop, text],
    });
  };

  const addCustomAntiSlop = () => {
    const v = customDraft.trim();
    if (!v || !draft) return;
    setDraft({ ...draft, customAntiSlop: [...draft.customAntiSlop, v] });
    setCustomDraft("");
  };

  const removeCustomAntiSlop = (idx: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      customAntiSlop: draft.customAntiSlop.filter((_, i) => i !== idx),
    });
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };

  const reset = () => setDraft(null);

  const dirCount = draft?.directionIds.length ?? 0;
  const antiCount = (draft?.enabledAntiSlop.length ?? 0) + (draft?.customAntiSlop.length ?? 0);
  const canvasSpec = formato ? canvasSpecForFormat(formato) : null;
  const canvasHasFields = !!(canvasSpec && specHasFields(canvasSpec));
  const canvasOverrides = draft?.canvas ?? {};
  const canvasOverrideCount = Object.values(canvasOverrides).filter((v) => v !== undefined).length;
  const effectiveRatio = canvasOverrides.ratio ?? formato?.canvas.ratio;
  const effectiveDuration = canvasOverrides.duration ?? formato?.canvas.duration;

  // Anti-slop combined list = format presets + anti-slop directions
  const antiSlopDirections = directionsByEixo.get("anti-slop") || [];

  const tabs: Array<{
    id: TabId;
    name: string;
    state?: ReactNode;
    stateDone?: boolean;
    disabled?: boolean;
  }> = [
    {
      id: "01",
      name: t("dir.modal.tab.category"),
      state: formato && CATEGORIAS.find((c) => c.id === activeCat)?.nome.toLowerCase(),
      stateDone: !!formato,
    },
    {
      id: "02",
      name: t("dir.modal.tab.format"),
      state: formato?.nome.toLowerCase(),
      stateDone: !!formato,
    },
    {
      id: "03",
      name: t("dir.modal.tab.canvas"),
      state: formato
        ? canvasHasFields
          ? canvasOverrideCount > 0
            ? tf("dir.modal.tab.canvas.custom", canvasOverrideCount)
            : t("dir.modal.tab.canvas.defaults")
          : t("dir.modal.tab.canvas.fixed")
        : undefined,
      stateDone: !!formato && canvasOverrideCount > 0,
      disabled: !formato || !canvasHasFields,
    },
    {
      id: "04",
      name: t("dir.modal.tab.directions"),
      state: formato ? tf("dir.modal.tab.on", dirCount) : undefined,
      disabled: !formato,
    },
    {
      id: "05",
      name: t("dir.modal.tab.antislop"),
      state: formato ? tf("dir.modal.tab.on", antiCount) : undefined,
      disabled: !formato,
    },
  ];

  return (
    <DfModal
      open={open}
      onClose={onClose}
      size="xl"
      className="dm-modal"
      head={
        <>
          <div className="dm-head">
            <div className="dm-head-text">
              <div className="dm-eyebrow">{t("dir.modal.kicker.full")}</div>
              <h2 className="dm-title">{t("dir.modal.title.full")}</h2>
            </div>
            <button
              className="dm-close"
              type="button"
              aria-label={t("dir.modal.close")}
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
          <nav className="dm-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={[
                  "dm-tab",
                  activeTab === tab.id ? "is-on" : "",
                  tab.disabled ? "is-disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
              >
                <span className="dm-tab-num">{tab.id}</span>
                <span>{tab.name}</span>
                {tab.state && (
                  <span className={`dm-tab-state${tab.stateDone ? " is-done" : ""}`}>
                    {tab.state}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </>
      }
      foot={
        <div className="dm-foot">
          <div className="dm-foot-stats">
            {formato ? (
              <>
                <span className="dm-foot-stat">
                  <span className="dm-dot" />
                  <strong>{formato.nome}</strong>
                  <span className="dm-foot-sep">·</span>
                  {effectiveRatio}
                  {effectiveDuration && effectiveDuration > 0
                    ? ` · ${tf("dir.modal.format.duration", effectiveDuration)}`
                    : ""}
                  {canvasOverrideCount > 0 && (
                    <span className="dm-foot-pill">{t("dir.modal.foot.custom.pill")}</span>
                  )}
                </span>
                <span className="dm-foot-stat">
                  {dirCount}{" "}
                  {dirCount === 1
                    ? t("dir.modal.foot.dir.singular")
                    : t("dir.modal.foot.dir.plural")}
                </span>
                <span className="dm-foot-stat">
                  {antiCount} {t("dir.modal.antislop")}
                </span>
              </>
            ) : (
              <span className="dm-foot-stat dm-foot-stat--empty">{t("dir.modal.pick.first")}</span>
            )}
          </div>
          <div className="dm-foot-actions">
            {draft && (
              <button type="button" className="dm-btn dm-btn--ghost" onClick={reset}>
                {t("dir.modal.reset")}
              </button>
            )}
            <button type="button" className="dm-btn dm-btn--ghost" onClick={onClose}>
              {t("dir.modal.cancel")}
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--primary"
              onClick={apply}
              disabled={!draft}
            >
              {t("dir.modal.apply")}
            </button>
          </div>
        </div>
      }
    >
      {/* ── Tab 01 — Category ───────────────────────────────────── */}
      {activeTab === "01" && (
        <section className="dm-tabpane is-active">
          <div className="dm-pane-head">
            <h3 className="dm-pane-title">{t("dir.modal.q.category")}</h3>
            <p className="dm-pane-desc">{t("dir.modal.q.category.body")}</p>
          </div>
          <div className="dm-cat-grid">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`dm-cat${activeCat === c.id ? " is-on" : ""}`}
                onClick={() => pickCat(c.id)}
              >
                <CategoriaIcon id={c.id} />
                <span className="dm-cat-name">{c.nome}</span>
                <span className="dm-cat-desc">{c.descricao}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Tab 02 — Format ─────────────────────────────────────── */}
      {activeTab === "02" && (
        <section className="dm-tabpane is-active">
          <div className="dm-pane-head">
            <h3 className="dm-pane-title">{t("dir.modal.q.format")}</h3>
            <p className="dm-pane-desc">
              {fmts.length} {fmts.length === 1 ? t("dir.modal.opt") : t("dir.modal.opts")} in{" "}
              {CATEGORIAS.find((c) => c.id === activeCat)?.nome.toLowerCase()}
              {t("dir.modal.q.format.body")}
            </p>
          </div>
          <div className="dm-formato-grid">
            {fmts.map((f) => {
              const on = draft?.formatoId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`dm-formato${on ? " is-on" : ""}`}
                  onClick={() => pickFormato(f)}
                >
                  <div className="dm-formato-row">
                    <span className="dm-formato-name">{f.nome}</span>
                    <span className="dm-formato-canvas">
                      {f.canvas.ratio}
                      {f.canvas.duration > 0 ? ` · ${f.canvas.duration}s` : ""}
                    </span>
                  </div>
                  <p className="dm-formato-desc">{f.descricao}</p>
                  <div className="dm-formato-meta">
                    <span>
                      {f.anti_slop.length} {t("dir.modal.q.antislop.presets")}
                    </span>
                    {on && (
                      <span className="dm-formato-mark">{t("dir.modal.format.selected")}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tab 03 — Canvas ─────────────────────────────────────── */}
      {activeTab === "03" && formato && canvasSpec && canvasHasFields && (
        <section className="dm-tabpane is-active">
          <div className="dm-pane-head">
            <span className="dm-context-badge">
              <span className="dm-dot" />
              {formato.nome.toLowerCase()}
            </span>
            <h3 className="dm-pane-title">{t("dir.modal.q.canvas")}</h3>
            <p className="dm-pane-desc">{t("dir.modal.q.canvas.body")}</p>
          </div>

          <div className="dm-canvas-stack">
            {canvasSpec.ratios && (
              <div className="dm-canvas-field">
                <div className="dm-canvas-label">
                  <span className="dm-canvas-label-name">{t("dir.modal.q.aspect")}</span>
                  <span className="dm-canvas-label-default">
                    {t("dir.modal.q.default")} {formato.canvas.ratio}
                  </span>
                </div>
                <div className="dm-canvas-choices">
                  {canvasSpec.ratios.map((r) => {
                    const on = effectiveRatio === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`dm-canvas-choice${on ? " is-on" : ""}`}
                        onClick={() => updateCanvas({ ratio: r.id })}
                      >
                        <span className="dm-canvas-choice-name">{r.name}</span>
                        <span className="dm-canvas-choice-meta">{r.meta}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {canvasSpec.viewports && (
              <div className="dm-canvas-field">
                <div className="dm-canvas-label">
                  <span className="dm-canvas-label-name">{t("dir.modal.q.viewport")}</span>
                  <span className="dm-canvas-label-default">
                    {t("dir.modal.q.viewport.default")}
                  </span>
                </div>
                <div className="dm-canvas-choices">
                  {canvasSpec.viewports.map((v) => {
                    const on = (canvasOverrides.viewport ?? "1920×1080") === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`dm-canvas-choice${on ? " is-on" : ""}`}
                        onClick={() => updateCanvas({ viewport: v.id })}
                      >
                        <span className="dm-canvas-choice-name">{v.name}</span>
                        <span className="dm-canvas-choice-meta">{v.meta}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {canvasSpec.duration && (
              <div className="dm-canvas-field">
                <div className="dm-canvas-label">
                  <span className="dm-canvas-label-name">{t("dir.modal.q.duration")}</span>
                  <span className="dm-canvas-label-default">
                    {t("dir.modal.q.default")} {formato.canvas.duration}s
                  </span>
                </div>
                <div className="dm-canvas-input-row">
                  <input
                    type="number"
                    step={0.5}
                    min={1}
                    max={120}
                    value={effectiveDuration}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0) updateCanvas({ duration: n });
                    }}
                    className="dm-canvas-input"
                  />
                  <span className="dm-canvas-unit">{t("dir.modal.canvas.seconds")}</span>
                  <span className="dm-canvas-derived">
                    {tf(
                      "dir.modal.canvas.derived",
                      canvasOverrides.fps ?? 30,
                      Math.round(effectiveDuration! * (canvasOverrides.fps ?? 30)),
                    )}
                  </span>
                </div>
              </div>
            )}

            {canvasSpec.fps && (
              <div className="dm-canvas-field">
                <div className="dm-canvas-label">
                  <span className="dm-canvas-label-name">{t("dir.modal.q.framerate")}</span>
                  <span className="dm-canvas-label-default">
                    {t("dir.modal.q.framerate.default")}
                  </span>
                </div>
                <div className="dm-canvas-choices">
                  {FPS_CHOICES.map((fps) => {
                    const on = (canvasOverrides.fps ?? 30) === fps;
                    return (
                      <button
                        key={fps}
                        type="button"
                        className={`dm-canvas-choice${on ? " is-on" : ""}`}
                        onClick={() => updateCanvas({ fps })}
                      >
                        <span className="dm-canvas-choice-name">{fps}</span>
                        <span className="dm-canvas-choice-meta">fps</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {canvasSpec.slides && (
              <div className="dm-canvas-field">
                <div className="dm-canvas-label">
                  <span className="dm-canvas-label-name">{t("dir.modal.q.slides")}</span>
                  <span className="dm-canvas-label-default">{t("dir.modal.q.slides.default")}</span>
                </div>
                <div className="dm-canvas-input-row">
                  <input
                    type="number"
                    step={1}
                    min={2}
                    max={20}
                    value={canvasOverrides.slides ?? 5}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 2 && n <= 20) updateCanvas({ slides: n });
                    }}
                    className="dm-canvas-input"
                  />
                  <span className="dm-canvas-unit">{t("dir.modal.canvas.slides")}</span>
                </div>
              </div>
            )}

            {canvasOverrideCount > 0 && (
              <button
                type="button"
                className="dm-canvas-reset"
                onClick={() => setDraft({ ...draft!, canvas: undefined })}
              >
                {t("dir.modal.canvas.reset")}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Tab 04 — Directions ─────────────────────────────────── */}
      {activeTab === "04" && formato && (
        <section className="dm-tabpane is-active">
          <div className="dm-pane-head">
            <span className="dm-context-badge">
              <span className="dm-dot" />
              {formato.nome.toLowerCase()}
            </span>
            <h3 className="dm-pane-title">{t("dir.modal.q.directions")}</h3>
            <p className="dm-pane-desc">{t("dir.modal.q.directions.body")}</p>
          </div>

          <div className="dm-eixo-stack">
            {EIXOS.filter((e) => e.id !== "anti-slop").map((eixo) => {
              const dirs = directionsByEixo.get(eixo.id) || [];
              if (dirs.length === 0) return null;
              return (
                <div key={eixo.id} className="dm-eixo">
                  <div className="dm-eixo-head">
                    <span className="dm-eixo-name">{eixo.nome}</span>
                    <span className="dm-eixo-desc">{eixo.descricao}</span>
                  </div>
                  <div className="dm-dir-list">
                    {dirs.map((d) => {
                      const on = draft!.directionIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          className={`dm-dir${on ? " is-on" : ""}`}
                          onClick={() => toggleDirection(d.id)}
                        >
                          <span className="dm-dir-toggle" aria-hidden>
                            {on && <IconCheck />}
                          </span>
                          <div className="dm-dir-body">
                            <span className="dm-dir-name">{d.nome}</span>
                            <span className="dm-dir-desc">{d.descricao}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tab 05 — Anti-slop ──────────────────────────────────── */}
      {activeTab === "05" && formato && (
        <section className="dm-tabpane is-active">
          <div className="dm-pane-head">
            <span className="dm-context-badge">
              <span className="dm-dot" />
              {formato.nome.toLowerCase()}
            </span>
            <h3 className="dm-pane-title">{t("dir.modal.q.bans")}</h3>
            <p className="dm-pane-desc">{t("dir.modal.q.bans.body")}</p>
          </div>

          <div className="dm-as-stack">
            <div className="dm-as-block">
              <div className="dm-as-blocklabel">{t("dir.modal.bans.format.presets")}</div>
              <ul className="dm-as-list">
                {formato.anti_slop.map((text) => {
                  const on = draft!.enabledAntiSlop.includes(text);
                  return (
                    <li
                      key={text}
                      className={`dm-as-item${on ? " is-on" : ""}`}
                      onClick={() => toggleAntiSlop(text)}
                    >
                      <span className="dm-as-mark" aria-hidden>
                        {on && <IconCheck />}
                      </span>
                      <span className="dm-as-text">{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {antiSlopDirections.length > 0 && (
              <div className="dm-as-block">
                <div className="dm-as-blocklabel">{t("dir.modal.bans.global")}</div>
                <ul className="dm-as-list">
                  {antiSlopDirections.map((d) => {
                    const on = draft!.directionIds.includes(d.id);
                    return (
                      <li
                        key={d.id}
                        className={`dm-as-item${on ? " is-on" : ""}`}
                        onClick={() => toggleDirection(d.id)}
                      >
                        <span className="dm-as-mark" aria-hidden>
                          {on && <IconCheck />}
                        </span>
                        <div className="dm-as-text">
                          <strong>{d.nome}</strong>
                          <span className="dm-as-sub">{d.descricao}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {draft!.customAntiSlop.length > 0 && (
              <div className="dm-as-block">
                <div className="dm-as-blocklabel">{t("dir.modal.bans.yours")}</div>
                <ul className="dm-as-list">
                  {draft!.customAntiSlop.map((text, i) => (
                    <li key={`${text}-${i}`} className="dm-as-item is-on dm-as-item--custom">
                      <span className="dm-as-mark" aria-hidden>
                        <IconCheck />
                      </span>
                      <span className="dm-as-text">{text}</span>
                      <button
                        type="button"
                        className="dm-as-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustomAntiSlop(i);
                        }}
                        aria-label={t("dir.modal.remove")}
                      >
                        <IconClose />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dm-as-add">
              <input
                type="text"
                className="dm-as-input"
                placeholder={t("dir.modal.bans.add.placeholder")}
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomAntiSlop();
                  }
                }}
              />
              <button
                type="button"
                className="dm-btn"
                onClick={addCustomAntiSlop}
                disabled={!customDraft.trim()}
              >
                {t("dir.modal.bans.add")}
              </button>
            </div>
          </div>
        </section>
      )}

      {(activeTab === "03" || activeTab === "04" || activeTab === "05") && !formato && (
        <div className="dm-pane-empty">
          <p>{t("dir.modal.no.format")}</p>
          <button type="button" className="dm-btn" onClick={() => setActiveTab("01")}>
            {t("dir.modal.back.category")}
          </button>
        </div>
      )}
    </DfModal>
  );
}
