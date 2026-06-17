// NewProjectFormSkeu — the canonical+ form body, reusable.
//
// v8 (2026-05-05) — user review of v7:
//   1. Title editor MIGRATED to the modal faceplate (NewProjectModal).
//      The `cnp-zone--name` is no longer rendered when the host passes
//      `controlledName`. Standalone /np-canonical-plus lab still uses
//      the internal name input via `showHero` + an internal name state.
//   2. DS row now horizontal scroll-snap (cnp-ds-cards-row--v8) — no wrap.
//   3. Begin button → cnp-begin--v8 — premium TE-tátil chrome with
//      status LED + accent ring + chevron arrow (replaces ⌘⏎ key tip).
//   4. Picker keys, dials, DS cards — micro-interactions per
//      hyve-taste-master rules: tactile-button-affordance + motion-tactile-bounce.
//
// v6 (2026-05-05) — user review of v5:
//   1. Composer bar mais alta (~70px), respiro generoso entre os dois
//      grupos (attach/mic à esquerda, model rocker à direita). Hint
//      "drop · paste · drag" desce pra second row dentro da bar.
//   2. Model rocker maior (44–48px alt, 220–320px largura). Dropdown
//      ScreenModelMenu posicionado abaixo do rocker (não fixo no canto
//      da viewport como na v5).
//   3. Canvas: Responsive virou FLAG opcional (checkbox no rodapé do
//      modal Canvas). User escolhe um aspect-ratio BASE (preset OU
//      custom) e marca "Responsivo" se quiser adaptar ao viewport.
//   4. Selected state padronizado em Canvas/Formato/Regras: bolinha
//      `.dmv2-row-check-dot` que escala 0→1 quando selecionado.
//   5. Descrição/meta na direita das rows: grid auto 1fr auto fixo —
//      label trunca com ellipsis, meta encolhe sem quebrar.
//   6. Format modal: cat-head usa o mesmo split <div>/<button> do
//      RulesModal — colapsa funcional + caret rotaciona.
//   7. Format single-choice — ao escolher, modal fecha + trigger key
//      external (cnp-format-key) mostra título escolhido + dot accent.
//   8. Nome do projeto: input borderless (sem engrave bottom). Só
//      cursor pisca ao focar — sem outline accent.
//   9. Logo glow MIGROU pro topbar do modal (`np-modal-face-mark`).
//      Logo do campo nome REMOVIDO; input fica solo. v6 expõe um
//      callback `onNameChange` pra que o NewProjectModal acenda o logo
//      do faceplate header quando name.length > 0.
//  10. Sweep funcional — verificar que todos toggles, collapses e
//      marcações funcionam.
//
// v5 (2026-05-05) — user review of v4:
//   1. Dials 4 → 6 em grid 3×2: Density / Motion / Contrast (was Tone) /
//      Interactions / Surface (new) / Originality (new). Dials neutros
//      (value === 50) NÃO entram no payload nem no prompt suffix —
//      "ative-only state".
//   2. DS picker: substitui o botão único skeu por uma row de até 3 cards
//      visíveis (swatches + nome) + botão "Ver mais" → DfModal completo.
//   3. Modais Canvas/Formato/Regras com altura fixa (72vh), body scrolla,
//      header+footer fixos, refinement UI consistente.
//   4. Modelo move pro footer da prompt box (composer bar). MOTOR column
//      vira TASTE (só dials).
//   5. Nome do projeto + Logo HYVE acima do prompt — logo "acende" accent
//      + glow quando o nome está preenchido.
//
// v4 (2026-05-05) — user review of v3:
//   1. Direction → Rules unified (hyve-taste format, 30 builtin curated)
//   2. Modal must NOT scroll — height fixa adapta ao viewport
//   3. Zone CONTEXTO REMOVIDA (anti-slop migrou pra Rules; refs viraram
//      attachments dentro do prompt composer)
//   4. ChatComposer com features do EditorScreen (file picker + mic +
//      paste handler)
//   5. Taste dials 5→4 em grid 2x2 (Density/Motion/Tone/Interactions)
//
// Renders as:
//   1. Standalone lab screen at /np-canonical-plus,
//   2. Contents of <NewProjectModal /> opened from HomeScreen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { DfModal } from "@/components/DfModal";
import { CanvasModal } from "@/components/CanvasModal";
import { FormatModal } from "@/components/FormatModal";
import { RulesModal } from "@/components/RulesModal";
import { PickerKey } from "@/components/PickerKey";
import {
  NewProjectChatComposer,
  type ComposerAttachment,
} from "@/components/NewProjectChatComposer";
import { PromptConsole } from "@/components/PromptConsole";
import { workspaceContextPreamble } from "@/runtime/prompt-invoker";
import { assembleTurnBlocks, type TurnPreviewBlock } from "@/runtime/turn-pipeline";
import { buildCanonicalPlusBlock } from "@/runtime/canonical-plus-prompt";
import { SearchableDropdown, type SearchableDropdownItem } from "@/components/SearchableDropdown";
import { useT, tf } from "@/i18n";
import {
  db,
  listDesignSystemsFromFilesystem,
  readFileViaBridge,
  writeGlobalConfig,
  type FsDesignSystem,
} from "@/lib/claude-bridge";
import { parseDesignSystem } from "@/lib/ds-google";
import { ProviderIdSchema } from "@/lib/schemas";
import {
  defaultModelForProvider,
  getModelsForProvider,
  readLastModel,
  useLiveModelOptions,
  writeLastModel,
} from "@/providers/model-lists";
import { PROVIDERS, probeAllProviders } from "@/providers/registry";
import type { ProviderId, ProviderStatusReport } from "@/providers/types";
import { describeSelection as describeCanvas, type CanvasSelection } from "@/data/canvas-presets";
import { describeFormatSelection, type FormatSelection } from "@/data/format-taxonomy";
import {
  totalRuleCount,
  getUserRules,
  setUserRules,
  getEffectiveRules,
  type Rule,
} from "@/data/rules-taxonomy";
import {
  canvasLabel as canvasI18nLabel,
  formatCategoryLabel as fmtCatI18nLabel,
  formatItemLabel as fmtItemI18nLabel,
} from "@/i18n/builtin-labels";
import "@/styles/np-regions-lab.css";
import "@/styles/np-canonical-plus.css";
import "@/styles/np-direction-modal-v2.css";
import "@/styles/np-v8.css";

// ─── Types exposed to the host ────────────────────────────────────────

export interface NewProjectFormPayload {
  name: string;
  prompt: string;
  /** Canvas (aspect ratio / responsive). */
  canvas: CanvasSelection | null;
  /** Format (output category × subitem). */
  format: FormatSelection | null;
  /** v4: flat list of selected rule ids (replaces directions[]). */
  rules: string[];
  designSystem: string | null;
  provider: ProviderId;
  model: string;
  /** v4: attachments collected by the chat composer (replaces refs[]). */
  attachments: Array<{
    name: string;
    size: number;
    mime: string;
    content: string;
    kind: "image" | "text" | "binary";
  }>;
  /** v5: 6 dials in 3×2 grid. Neutral dials (value === 50) MAY be omitted
   *  from the host payload — see `tasteActive` for the active subset. */
  taste: {
    density: number;
    motion: number;
    contrast: number;
    interactions: number;
    surface: number;
    originality: number;
  };
  /** v5: only the dials the user actively moved away from 50. The host
   *  uses this to decide whether to append a `[taste: …]` suffix to the
   *  prompt — neutral dials NEVER influence the model. */
  tasteActive: Partial<NewProjectFormPayload["taste"]>;
}

export interface NewProjectFormSkeuProps {
  /** Called when the user clicks "Begin project". May be async. */
  onCreate?: (payload: NewProjectFormPayload) => void | Promise<void>;
  /** Called on the inline "reset" intent — caller may close modal etc. */
  onReset?: () => void;
  /** Whether to show the hero strip (kicker + title). Modal wants this OFF. */
  showHero?: boolean;
  /** Optional initial taste defaults. */
  initialTaste?: Partial<NewProjectFormPayload["taste"]>;
  /** v8: when host owns the name (e.g., NewProjectModal v8 with the
   *  faceplate title input), pass the live string here. The form will
   *  hide its internal `cnp-zone--name` and use this value at submit time.
   *  Standalone /np-canonical-plus lab leaves it undefined → form keeps
   *  the internal name input + state. */
  controlledName?: string;
  /** v6 (legacy): lifted name change callback. Kept for the standalone lab
   *  route (still receives changes from internal input). When `controlledName`
   *  is provided, no longer fires from the form. */
  onNameChange?: (name: string) => void;
}

// ─── Static data ──────────────────────────────────────────────────────

interface DialSpec {
  id: keyof NewProjectFormPayload["taste"];
  /** v7: i18n key namespace — `dial.{id}.label`, `.low`, `.high` */
  i18nKey: string;
}

// v5: 6 dials, 3×2 grid. Tone removido (sobreposição com Contrast); Surface
// e Originality adicionados (cobrem a percepção tactile e a aposta autoral
// sem entrar em jargão visual). Voice/color seguem em Rules.
// v7: dial copy now translates via i18n keys (dial.<id>.label/.low/.high).
const DIALS: DialSpec[] = [
  { id: "density", i18nKey: "dial.density" },
  { id: "motion", i18nKey: "dial.motion" },
  { id: "contrast", i18nKey: "dial.contrast" },
  { id: "interactions", i18nKey: "dial.interactions" },
  { id: "surface", i18nKey: "dial.surface" },
  { id: "originality", i18nKey: "dial.originality" },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function shortModelLabel(label: string): string {
  if (label.length <= 22) return label;
  return label.slice(0, 20) + "…";
}

// 4-stop snap model (user 2026-05-17): the slider lands on one of
// 5 positions — 0 / 25 / 50 / 75 / 100. Each non-neutral stop maps to
// a distinct tag (and a distinct prompt in canonical-plus-prompt).
// i18n keys per dial: dial.{id}.extremeLow / softLow / softHigh /
// extremeHigh / balanced (shared).
function dialDescriptor(
  spec: DialSpec,
  value: number,
  t: (key: string) => string,
): { word: string; pole: "extremeLow" | "softLow" | "mid" | "softHigh" | "extremeHigh" } {
  if (value <= 12) return { word: t(`${spec.i18nKey}.extremeLow`), pole: "extremeLow" };
  if (value <= 37) return { word: t(`${spec.i18nKey}.softLow`), pole: "softLow" };
  if (value <= 62) return { word: t("dial.balanced"), pole: "mid" };
  if (value <= 89) return { word: t(`${spec.i18nKey}.softHigh`), pole: "softHigh" };
  return { word: t(`${spec.i18nKey}.extremeHigh`), pole: "extremeHigh" };
}

/** Snap a raw 0-100 value to the closest of 0/25/50/75/100. */
function snapTo5Stops(value: number): number {
  const stops = [0, 25, 50, 75, 100];
  let best = stops[0];
  let bestDist = Math.abs(value - best);
  for (const s of stops) {
    const d = Math.abs(value - s);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * v5 — return only the dials whose value is NOT the neutral 50. Neutral
 * dials should not appear in the host payload nor be appended to the
 * prompt; if every dial is neutral the user hasn't expressed any taste
 * preference and the system stays out of the way.
 *
 * Exported for unit tests. Pure — no side effects.
 */
export function activeTaste(
  taste: NewProjectFormPayload["taste"],
): Partial<NewProjectFormPayload["taste"]> {
  const out: Partial<NewProjectFormPayload["taste"]> = {};
  (Object.entries(taste) as Array<[keyof NewProjectFormPayload["taste"], number]>).forEach(
    ([k, v]) => {
      if (v !== 50) out[k] = v;
    },
  );
  return out;
}

function clientToValue(clientX: number, rect: DOMRect): number {
  const PADDING = 11;
  const min = rect.left + PADDING;
  const max = rect.right - PADDING;
  if (max <= min) return 50;
  const raw = (clientX - min) / (max - min);
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round(clamped * 100);
}

// ─── Sub-components ───────────────────────────────────────────────────

interface DialProps {
  spec: DialSpec;
  value: number;
  onChange: (v: number) => void;
  /** v7: i18n lookup — passed in instead of called via hook so the
   *  component can stay a pure render given the same key. */
  t: (key: string) => string;
}

function Dial({ spec, value, onChange, t }: DialProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const desc = dialDescriptor(spec, value, t);
  const label = t(`${spec.i18nKey}.label`);

  // double-click anywhere on the dial (track or knob)
  // resets it to the neutral 50 position. User spec — "clicar 2 vezes
  // na bolinha do slider de taste tem q resetar o slider centralizando
  // ele". The native `dblclick` event fires after the second `pointerup`
  // and works regardless of whether the user clicked the knob or the
  // track surface. The reset uses the same onChange path as a normal
  // drag so parent state and CSS pulse animation both react via React.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (value === 50) return;
      onChange(50);
    },
    [onChange, value],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      // Don't snap-on-click during the double-click window so the user can
      // double-click the knob without it jumping to the cursor mid-way.
      // detail >= 2 means this is the second click of a dblclick sequence.
      if (e.detail >= 2) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      const rect = track.getBoundingClientRect();
      onChange(snapTo5Stops(clientToValue(e.clientX, rect)));
    },
    [onChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track || !track.hasPointerCapture(e.pointerId)) return;
      const rect = track.getBoundingClientRect();
      onChange(snapTo5Stops(clientToValue(e.clientX, rect)));
    },
    [onChange],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    if (track.hasPointerCapture(e.pointerId)) {
      track.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Keyboard navigation: arrow keys step between the 5 snap stops
  // (0/25/50/75/100), Home/End jump to extremes.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const stops = [0, 25, 50, 75, 100];
      const idx = stops.indexOf(snapTo5Stops(value));
      let next = value;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = stops[Math.max(0, idx - 1)];
      else if (e.key === "ArrowRight" || e.key === "ArrowUp")
        next = stops[Math.min(stops.length - 1, idx + 1)];
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 100;
      else return;
      e.preventDefault();
      onChange(next);
    },
    [onChange, value],
  );

  const knobLeft = `calc(11px + (100% - 22px) * ${value / 100})`;
  // v5: ative-only — CSS distingue entre dial em pose neutra (cinza, "em
  // standby") e dial deliberadamente movido (accent + engrave inferior).
  const isActive = value !== 50;

  return (
    <div className="cnp-dial" data-pole={desc.pole} data-active={isActive ? "true" : "false"}>
      <div className="cnp-dial-head">
        <span className="cnp-dial-label">{label}</span>
        <span className="cnp-dial-readout" title={`${value} ${desc.word}`}>
          {value !== 50 && <span className="cnp-dial-readout-num">{value}</span>}
          <span>{desc.word}</span>
        </span>
      </div>
      <div
        ref={trackRef}
        className="cnp-dial-track"
        role="slider"
        tabIndex={0}
        aria-label={`${label}: ${desc.word} (${value}/100). ${t("dial.doubleclick.reset")}.`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value} ${desc.word}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        title={t("dial.doubleclick.reset")}
      >
        <span className="cnp-dial-knob" style={{ left: knobLeft }} />
      </div>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────

const DEFAULT_TASTE: NewProjectFormPayload["taste"] = {
  density: 50,
  motion: 50,
  contrast: 50,
  interactions: 50,
  surface: 50,
  originality: 50,
};

export function NewProjectFormSkeu({
  onCreate,
  onReset,
  showHero = true,
  initialTaste,
  controlledName,
  onNameChange,
}: NewProjectFormSkeuProps) {
  // v7 (2026-05-05): i18n hook — re-renders this component when the
  // user flips the language toggle in Settings.
  const { t, lang } = useT();
  // v8: when controlledName is provided (modal owns the field), we use
  // it as the read-through value. Otherwise, internal state drives the
  // standalone lab's name input.
  const isControlled = typeof controlledName === "string";
  const [internalName, setInternalName] = useState("");
  const name = isControlled ? (controlledName as string) : internalName;
  const setName = isControlled
    ? (next: string) => {
        // No-op — modal owns the input. Should never be called.
        void next;
      }
    : setInternalName;

  // v6: surface name to host so it can drive the faceplate logo glow.
  // Effect (not inline) so we don't fire onNameChange on every render —
  // only when the value actually changes. Skipped when controlled (host
  // already has the value source-of-truth).
  useEffect(() => {
    if (isControlled) return;
    onNameChange?.(internalName);
  }, [internalName, onNameChange, isControlled]);
  const [prompt, setPrompt] = useState("");
  const [canvas, setCanvas] = useState<CanvasSelection | null>(null);
  const [format, setFormat] = useState<FormatSelection | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Bumped whenever the user creates a new rule from the inline modal so
  // RulesModal re-reads getEffectiveRules() and shows it.
  const [rulesCatalogVersion, setRulesCatalogVersion] = useState(0);

  // Dial state — defaults to 50 (balanced) for all 4 dials, optionally
  // overridden by initialTaste from the host.
  const [dialValues, setDialValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = { ...DEFAULT_TASTE, ...(initialTaste ?? {}) };
    return init;
  });

  // Design systems.
  const [designSystems, setDesignSystems] = useState<FsDesignSystem[]>([]);
  const [dsSwatchCache, setDsSwatchCache] = useState<Record<string, string[]>>({});
  const [selectedDsPath, setSelectedDsPath] = useState<string | null>(null);

  // Provider + model.
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [model, setModel] = useState<string>(
    () => readLastModel("claude") ?? defaultModelForProvider("claude"),
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  // Probe provider availability once when the modal opens so the
  // dropdown can paint a LED per-row (ready / auth-required / error).
  // The probe is cheap (no model calls — just CLI version + token check)
  // but cache the result for the modal session to avoid re-probing on
  // every menu toggle.
  const [providerStatus, setProviderStatus] = useState<Record<
    ProviderId,
    ProviderStatusReport
  > | null>(null);
  useEffect(() => {
    let cancelled = false;
    void probeAllProviders()
      .then((s) => {
        if (!cancelled) setProviderStatus(s);
      })
      .catch(() => {
        /* leave as null → all LEDs grey */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // DS picker dropdown lives in the composer toolbar (replaces the
  // "soltar · colar · arrastar" hint). Same anchored-popover pattern as
  // ModelRocker — abs-positioned menu sibling, dismiss on outside click.
  const [dsDropdownOpen, setDsDropdownOpen] = useState(false);
  const dsDropdownRef = useRef<HTMLDivElement>(null);

  // Modals.
  const [canvasModalOpen, setCanvasModalOpen] = useState(false);
  const [formatModalOpen, setFormatModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [dsModalOpen, setDsModalOpen] = useState(false);

  useEffect(() => {
    void listDesignSystemsFromFilesystem().then((list) => {
      if (list) setDesignSystems(list);
    });
  }, []);

  useEffect(() => {
    designSystems.forEach(async (ds) => {
      if (dsSwatchCache[ds.path]) return;
      try {
        const content = await readFileViaBridge(ds.designMdPath);
        if (!content) return;
        const text =
          typeof content === "string"
            ? content
            : ((content as { content?: string })?.content ?? "");
        const parsed = parseDesignSystem(text);
        const hexes = parsed.colors
          .slice(0, 4)
          .map((c) => c.hex)
          .filter(Boolean);
        if (hexes.length > 0) {
          setDsSwatchCache((prev) => ({ ...prev, [ds.path]: hexes }));
        }
      } catch {
        /* swallow */
      }
    });
  }, [designSystems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void db.getSetting("default_provider").then((raw) => {
      const parsed = ProviderIdSchema.safeParse(raw);
      if (parsed.success) {
        setProvider(parsed.data);
        const remembered = readLastModel(parsed.data);
        setModel(remembered ?? defaultModelForProvider(parsed.data));
      }
    });
    const onProviderChange = (e: Event) => {
      const detail = (e as CustomEvent<{ providerId?: string }>).detail;
      const parsed = ProviderIdSchema.safeParse(detail?.providerId);
      if (parsed.success) {
        setProvider(parsed.data);
        const remembered = readLastModel(parsed.data);
        setModel(remembered ?? defaultModelForProvider(parsed.data));
      }
    };
    window.addEventListener("df:provider-change", onProviderChange);
    return () => window.removeEventListener("df:provider-change", onProviderChange);
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelMenuRef.current?.contains(target)) return;
      const trigger = (target as Element)?.closest?.('[data-cnp-model-trigger="true"]');
      if (trigger) return;
      setModelMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [modelMenuOpen]);

  // outside-click dismiss for DS dropdown. Mirrors the ModelRocker
  // dismiss pattern. Trigger marked via data-cnp-ds-trigger="true".
  useEffect(() => {
    if (!dsDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dsDropdownRef.current?.contains(target)) return;
      const trigger = (target as Element)?.closest?.('[data-cnp-ds-trigger="true"]');
      if (trigger) return;
      setDsDropdownOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [dsDropdownOpen]);

  const setDial = useCallback((id: string, value: number) => {
    setDialValues((curr) => (curr[id] === value ? curr : { ...curr, [id]: value }));
  }, []);

  const handleApplyCanvas = useCallback((next: CanvasSelection | null) => {
    setCanvas(next);
    setCanvasModalOpen(false);
  }, []);

  const handleApplyFormat = useCallback((next: FormatSelection | null) => {
    setFormat(next);
    setFormatModalOpen(false);
  }, []);

  const handleApplyRules = useCallback((next: string[]) => {
    setRules(next);
    setRulesModalOpen(false);
  }, []);

  // When the user creates a new rule from inside RulesModal, persist it in
  // the user_rules slot and bump the catalog version so the modal re-reads.
  const handleCreateRule = useCallback(async (rule: Rule) => {
    const next = [...getUserRules(), rule];
    setUserRules(next);
    void writeGlobalConfig({ custom_rules: next as never }).catch(() => {});
    void db.setSetting("custom_rules", JSON.stringify(next)).catch(() => {});
    setRulesCatalogVersion((v) => v + 1);
  }, []);

  // describeCanvas/describeFormatSelection now accept an
  // i18n bag so the trigger button labels flip pt↔en when the user
  // toggles language. Without this they stayed in canonical EN.
  const canvasLabel = describeCanvas(canvas, {
    label: (p) => canvasI18nLabel(p, lang),
    customWord: t("canvas.row.custom"),
    responsiveSuffix: t("canvas.responsive.suffix"),
  });
  const formatLabel = describeFormatSelection(format, {
    catLabel: (c) => fmtCatI18nLabel(c, lang),
    itemLabel: (catId, item) => fmtItemI18nLabel(catId, item, lang),
  });
  const rulesTotal = useMemo(() => totalRuleCount(), [rulesCatalogVersion]);

  // Engine blocks for the PromptConsole — the same assembly the runtime
  // ships, built from the draft so the inspector shows the real prompt.
  const npEngineBlocks = useMemo<TurnPreviewBlock[]>(() => {
    if (!previewOpen) return [];
    const taste = {
      density: dialValues.density ?? 50,
      motion: dialValues.motion ?? 50,
      contrast: dialValues.contrast ?? 50,
      interactions: dialValues.interactions ?? 50,
      surface: dialValues.surface ?? 50,
      originality: dialValues.originality ?? 50,
    };
    const dirBlock = buildCanonicalPlusBlock({ format, rules, taste }, undefined);
    const slug = (name.trim() || "untitled")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    return assembleTurnBlocks(
      {
        userMessage: prompt.trim() || "(seu prompt)",
        providerId: provider,
        projectId: name.trim() || "new-project",
        threadId: "main",
        mode: "chat",
        context: {
          projectPath: `projects/${slug}`,
          primaryFile: "index.html",
          ...(selectedDsPath ? { designSystem: { path: selectedDsPath } } : {}),
        },
      },
      dirBlock ? { preambleExtras: dirBlock } : {},
    );
  }, [previewOpen, format, rules, dialValues, name, prompt, provider, selectedDsPath]);

  const reset = useCallback(() => {
    if (!isControlled) setInternalName("");
    setPrompt("");
    setCanvas(null);
    setFormat(null);
    setRules([]);
    setAttachments([]);
    setSelectedDsPath(null);
    setSubmitError(null);
    setDialValues({ ...DEFAULT_TASTE, ...(initialTaste ?? {}) });
    onReset?.();
  }, [initialTaste, onReset, isControlled]);

  const canBegin = name.trim().length > 0 && !submitting;

  const handleBegin = useCallback(async () => {
    if (!canBegin) return;
    setSubmitError(null);
    const taste: NewProjectFormPayload["taste"] = {
      density: dialValues.density ?? 50,
      motion: dialValues.motion ?? 50,
      contrast: dialValues.contrast ?? 50,
      interactions: dialValues.interactions ?? 50,
      surface: dialValues.surface ?? 50,
      originality: dialValues.originality ?? 50,
    };
    const payload: NewProjectFormPayload = {
      name: name.trim(),
      prompt: prompt.trim(),
      canvas,
      format,
      rules: [...rules],
      designSystem: selectedDsPath,
      provider,
      model,
      attachments: attachments.map((a) => ({
        name: a.name,
        size: a.size,
        mime: a.mime,
        content: a.content,
        kind: a.kind,
      })),
      taste,
      // Only the dials the user moved away from 50 land here. Neutral
      // dials never enter the host's prompt suffix nor any downstream
      // payload — see activeTaste() for the rule.
      tasteActive: activeTaste(taste),
    };
    if (!onCreate) {
      // No host handler wired (e.g. standalone/preview mount) — nothing to do.
      return;
    }
    try {
      setSubmitting(true);
      await onCreate(payload);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    canBegin,
    name,
    prompt,
    canvas,
    format,
    rules,
    selectedDsPath,
    provider,
    model,
    attachments,
    dialValues,
    onCreate,
  ]);

  // "Começar em branco" — open a blank project skipping the form (no prompt,
  // no canvas/format/rules/DS/attachments, neutral taste). Same name gate as
  // handleBegin (a project still needs a name; defaults to "Untitled" via the
  // modal host).
  const handleBeginBlank = useCallback(async () => {
    if (!canBegin) return;
    setSubmitError(null);
    const neutralTaste: NewProjectFormPayload["taste"] = {
      density: 50,
      motion: 50,
      contrast: 50,
      interactions: 50,
      surface: 50,
      originality: 50,
    };
    const payload: NewProjectFormPayload = {
      name: name.trim() || "Untitled",
      prompt: "",
      canvas: null,
      format: null,
      rules: [],
      designSystem: null,
      provider,
      model,
      attachments: [],
      taste: neutralTaste,
      tasteActive: activeTaste(neutralTaste),
    };
    if (!onCreate) return;
    try {
      setSubmitting(true);
      await onCreate(payload);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [canBegin, name, provider, model, onCreate]);

  // Cmd/Ctrl + Enter from anywhere in the form fires Begin.
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleBegin();
      }
    },
    [handleBegin],
  );

  // v8: horizontal scroll-snap row — show up to 12 DSes inline (DOM cap)
  // with the selected one promoted to the front. If more than 12 exist,
  // a "Ver mais" key opens the full DfModal grid.
  const DS_INLINE_CAP = 12;
  const dsCardsToShow = useMemo<FsDesignSystem[]>(() => {
    if (designSystems.length === 0) return [];
    const ordered = [...designSystems];
    if (selectedDsPath) {
      const idx = ordered.findIndex((d) => d.path === selectedDsPath);
      if (idx > 0) {
        const [picked] = ordered.splice(idx, 1);
        ordered.unshift(picked);
      }
    }
    return ordered.slice(0, DS_INLINE_CAP);
  }, [designSystems, selectedDsPath]);
  const hasMoreDs = designSystems.length > DS_INLINE_CAP;

  // v5: nome ativa o glow do logo e do "linha engrave" abaixo do input.
  const nameTouched = name.length > 0;

  // v5: derive count of dials moved away from neutral, used by the TASTE
  // engrave meta. Memoized so the inline header doesn't recompute per
  // mouse-move.
  const activeDialCount = useMemo(() => {
    let n = 0;
    for (const d of DIALS) {
      if ((dialValues[d.id] ?? 50) !== 50) n += 1;
    }
    return n;
  }, [dialValues]);

  return (
    <div
      className="cnp-card cnp-card--bare cnp-card--v4 cnp-card--v5"
      onKeyDown={handleFormKeyDown}
    >
      {showHero && (
        <div className="cnp-hero">
          <pre
            className="cnp-hero-ascii"
            aria-hidden="true"
          >{`· · · · · · · · · · · · · · · · · · · · · · ·
· · · · · · · · · · · · · · · · · · · · · · ·
· · · · · · · · · · · · · · · · · · · · · · ·
· · · · · · · · · · · · · · · · · · · · · · ·
· · · · · · · · · · · · · · · · · · · · · · ·`}</pre>
          <Logo size={26} className="cnp-hero-mark" />
          <div className="cnp-hero-copy">
            <div className="cnp-hero-kicker">{lang === "en" ? "new project" : "novo projeto"}</div>
            <div className="cnp-hero-title">
              {lang === "en" ? "What are we building?" : "O que vamos construir?"}
            </div>
          </div>
        </div>
      )}

      {/* ZONE 0 — NAME. v8: hidden when host (NewProjectModal v8) owns the
       * faceplate title input. When standalone (lab route), keeps the v6
       * borderless name hero so the lab page stays usable. */}
      {!isControlled && (
        <section className="cnp-zone cnp-zone--name" aria-label={t("newproject.name.aria")}>
          <div
            className={`cnp-name-hero cnp-name-hero--v6${nameTouched ? " is-active" : ""}`}
            data-name-touched={nameTouched ? "true" : "false"}
          >
            <input
              className="cnp-name-hero-input"
              placeholder={t("newproject.name.placeholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("newproject.name.aria")}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </section>
      )}

      {/* ZONE 1 — PROMPT (hero, full width, ChatComposer com Modelo no rodapé). */}
      <section className="cnp-zone cnp-zone--prompt" aria-labelledby="cnp-zone-prompt">
        <header className="cnp-zone-header">
          <span id="cnp-zone-prompt" className="cnp-zone-engrave">
            {t("newproject.engrave.prompt")}
          </span>
          {(prompt.length > 0 || attachments.length > 0) && (
            <span className="cnp-zone-meta">
              {prompt.length > 0 && `${prompt.length} ${t("newproject.prompt.chars")}`}
              {prompt.length > 0 && attachments.length > 0 && " · "}
              {attachments.length > 0 &&
                `${attachments.length} ${attachments.length === 1 ? t("newproject.prompt.attachment") : t("newproject.prompt.attachments")}`}
            </span>
          )}
        </header>
        <div className="cnp-zone-body cnp-prompt-bowl-v2 cnp-prompt-bowl-v5">
          <NewProjectChatComposer
            value={prompt}
            onChange={setPrompt}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSubmit={() => void handleBegin()}
            placeholder={t("composer.placeholder")}
            rows={6}
            hideHint={true}
            toolbarRight={
              /* User ask 2026-05-18: "3 dropdowns lado a lado, provider/
               * modelo/design system" inside the modal. Provider was previously
               * read-only (defaulted from the topbar picker on EditorScreen);
               * adding the dropdown here lets the user pick which CLI/API
               * to fire BEFORE the first prompt + persist it as the project
               * default via the existing writeLastModel cascade. Order
               * matches the user spec exactly: Provider → Modelo → DS. */
              <span className="cnp-composer-toolbar-cluster">
                <ProviderRocker
                  provider={provider}
                  open={providerMenuOpen}
                  onToggle={() => setProviderMenuOpen((s) => !s)}
                  onPick={(id) => {
                    setProvider(id);
                    // Model is provider-scoped — switching provider invalidates
                    // the current model id. Try a remembered model for the new
                    // provider first; fall back to the provider's default.
                    const remembered = readLastModel(id);
                    setModel(remembered ?? defaultModelForProvider(id));
                    setProviderMenuOpen(false);
                  }}
                  menuRef={providerMenuRef}
                  statusByProvider={providerStatus}
                />
                <ModelRocker
                  provider={provider}
                  model={model}
                  open={modelMenuOpen}
                  onToggle={() => setModelMenuOpen((s) => !s)}
                  onPick={(id) => {
                    setModel(id);
                    writeLastModel(provider, id);
                    setModelMenuOpen(false);
                  }}
                  menuRef={modelMenuRef}
                />
                <DsDropdown
                  cards={dsCardsToShow}
                  allCards={designSystems}
                  selectedDsPath={selectedDsPath}
                  swatchCache={dsSwatchCache}
                  hasMore={hasMoreDs}
                  noDsAvailable={designSystems.length === 0}
                  open={dsDropdownOpen}
                  onToggle={() => setDsDropdownOpen((s) => !s)}
                  onPick={(p) => {
                    setSelectedDsPath(p);
                    setDsDropdownOpen(false);
                  }}
                  onClear={() => {
                    setSelectedDsPath(null);
                    setDsDropdownOpen(false);
                  }}
                  onOpenModal={() => {
                    setDsModalOpen(true);
                    setDsDropdownOpen(false);
                  }}
                  menuRef={dsDropdownRef}
                  t={t}
                />
              </span>
            }
          />
        </div>
      </section>

      {/* ZONE 2 + ZONE 3 — PROJETO (left) + TASTE (right)
       * 3 picker keys (Canvas / Formato / Regras) standardised via
       * <PickerKey> — same skeu bezel, same accent-dot LED, same
       * stretch-to-fill column height. */}
      <section
        className="cnp-zone cnp-zone--split"
        aria-label={lang === "en" ? "Project and taste" : "Projeto e taste"}
      >
        <div className="cnp-split">
          {/* PROJETO column */}
          <div className="cnp-split-cell">
            <header className="cnp-zone-header">
              <span className="cnp-zone-engrave">{t("newproject.engrave.projeto")}</span>
            </header>
            {/* v9 (2026-05-05): picker labels Canvas/Formato/Regras
             * REMOVED per user feedback: "canvas, formato e regras
             * nao precisam do titulo pequeno em cima". The picker
             * placeholders ("Escolher canvas" / etc) carry the meaning.
             * DS row keeps its label for context (4 cards). */}
            <div className="cnp-zone-body cnp-stack">
              <div className="cnp-stack-row cnp-stack-row--unlabeled">
                <PickerKey
                  active={Boolean(canvas)}
                  onClick={() => setCanvasModalOpen(true)}
                  label={canvasLabel ?? t("newproject.trigger.canvas")}
                />
              </div>

              <div className="cnp-stack-row cnp-stack-row--unlabeled">
                <PickerKey
                  active={Boolean(format)}
                  onClick={() => setFormatModalOpen(true)}
                  label={formatLabel ?? t("newproject.trigger.format")}
                />
              </div>

              <div className="cnp-stack-row cnp-stack-row--unlabeled">
                <PickerKey
                  active={rules.length > 0}
                  onClick={() => setRulesModalOpen(true)}
                  label={
                    rules.length > 0
                      ? tf("newproject.trigger.rules.count", rules.length, rulesTotal)
                      : t("newproject.trigger.rules")
                  }
                />
              </div>

              {/* DS row dropped to keep the modal compact. The DS
                  picker now lives as a dropdown in the composer
                  toolbar (toolbarMid slot). */}
            </div>
          </div>

          {/* TASTE column — only the 6 dials. Modelo migrou pro footer da
              prompt box (composer toolbar). */}
          <div className="cnp-split-cell">
            <header className="cnp-zone-header">
              <span className="cnp-zone-engrave">{t("newproject.engrave.taste")}</span>
              <span className="cnp-zone-meta cnp-zone-meta--mute">
                {activeDialCount === 0
                  ? t("newproject.taste.balanced")
                  : `${activeDialCount} ${activeDialCount === 1 ? t("newproject.taste.active") : t("newproject.taste.active.plural")}`}
              </span>
            </header>
            <div className="cnp-zone-body cnp-engine-col">
              {/* 2 columns × 3 rows: each dial gets ~50% width, more
                  breathing room between track and pole labels than the
                  earlier 3×2 grid. */}
              <div className="cnp-dials-grid-2x3">
                {DIALS.map((d) => (
                  <Dial
                    key={d.id}
                    spec={d}
                    value={dialValues[d.id] ?? 50}
                    onChange={(v) => setDial(d.id, v)}
                    t={t}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Submit row — error toast above begin button. */}
      {submitError && (
        <div className="cnp-error" role="alert">
          {submitError}
        </div>
      )}

      <div className="cnp-foot-row">
        <button type="button" className="cnp-foot-reset" onClick={reset} disabled={submitting}>
          {t("newproject.foot.reset")}
        </button>
        <button
          type="button"
          className="cnp-foot-reset"
          onClick={() => setPreviewOpen(true)}
          disabled={submitting}
          title="See the compiled direction before starting"
        >
          Preview prompt
        </button>
        <button
          type="button"
          className="cnp-foot-reset"
          onClick={() => {
            void handleBeginBlank();
          }}
          disabled={!canBegin}
          title="Abre o projeto em branco — sem prompt, sem direção pré-definida."
        >
          Começar em branco
        </button>
        {/* v8: premium TE-tátil button — status LED + chevron arrow,
         * no ⌘⏎ key indicator. ed: "queria um botao de iniciar
         * projeto mais tatil e animado e sem essa tip de atalho". */}
        <button
          type="button"
          className={`cnp-begin cnp-begin--v8${submitting ? " is-loading" : ""}`}
          onClick={() => {
            void handleBegin();
          }}
          disabled={!canBegin}
          aria-label={t("newproject.foot.begin.aria")}
          aria-busy={submitting}
        >
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">
            {submitting ? t("newproject.foot.beginning") : t("newproject.foot.begin")}
          </span>
          <span className="cnp-begin-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>

      {/* PROMPT CONSOLE — preview the compiled direction before starting.
       * Per decision doc §5: lives in the New Project modal as inspector.
       * User direction 2026-05-15: must surface EVERY personalization
       * — DS, canvas, format, rules, taste, provider, attachments and
       * the raw user prompt. Skeu chrome + i18n via useT. */}
      <PromptConsole
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        projectName={name.trim() || undefined}
        userPrompt={prompt}
        designSystem={selectedDsPath}
        canvas={canvas}
        format={format}
        formatLabel={formatLabel ?? undefined}
        rules={rules}
        ruleLabels={rules.map((id) => getEffectiveRules().find((r) => r.id === id)?.title ?? id)}
        taste={activeTaste({
          density: dialValues.density ?? 50,
          motion: dialValues.motion ?? 50,
          contrast: dialValues.contrast ?? 50,
          interactions: dialValues.interactions ?? 50,
          surface: dialValues.surface ?? 50,
          originality: dialValues.originality ?? 50,
        })}
        provider={provider}
        model={model}
        attachments={attachments.map((a) => ({
          name: a.name,
          size: a.size,
          kind: a.kind,
        }))}
        systemPreamble={workspaceContextPreamble({
          projectId: name.trim() || "new-project",
          projectPath: `projects/${(name.trim() || "untitled")
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")}`,
          primaryFile: "index.html",
          mode: "hifi",
          conversationHistory: [],
          hasDesignSystem: !!selectedDsPath,
          ...(selectedDsPath ? { designSystemPath: selectedDsPath } : {}),
        })}
        engineBlocks={npEngineBlocks}
        onConfirm={
          canBegin
            ? () => {
                void handleBegin();
              }
            : undefined
        }
        confirmLabel={t("newproject.foot.begin")}
      />

      {/* CANVAS MODAL */}
      <CanvasModal
        open={canvasModalOpen}
        initial={canvas}
        onClose={() => setCanvasModalOpen(false)}
        onApply={handleApplyCanvas}
      />

      {/* FORMAT MODAL */}
      <FormatModal
        open={formatModalOpen}
        initial={format}
        onClose={() => setFormatModalOpen(false)}
        onApply={handleApplyFormat}
      />

      {/* RULES MODAL — replaces DirectionModalV2 */}
      <RulesModal
        open={rulesModalOpen}
        initial={rules}
        onClose={() => setRulesModalOpen(false)}
        onApply={handleApplyRules}
        onCreateRule={handleCreateRule}
        catalogVersion={rulesCatalogVersion}
      />

      {/* DS MODAL */}
      <DfModal
        open={dsModalOpen}
        onClose={() => setDsModalOpen(false)}
        size="lg"
        title={t("newproject.ds.modal.title")}
      >
        <div className="reg-ds-modal">
          <div className="reg-ds-modal-grid">
            {designSystems.map((ds) => {
              const swatches = (dsSwatchCache[ds.path] ?? []).slice(0, 4);
              const padded = [
                ...swatches,
                ...Array(Math.max(0, 4 - swatches.length)).fill("var(--df-surface-raised)"),
              ];
              return (
                <button
                  key={ds.path}
                  className={`reg-ds-modal-card${selectedDsPath === ds.path ? " is-on" : ""}`}
                  onClick={() => {
                    setSelectedDsPath(ds.path);
                    setDsModalOpen(false);
                  }}
                >
                  <div className="reg-ds-modal-swatchbar">
                    {padded.map((sw, i) => (
                      <span key={i} style={{ background: sw, flex: 1 }} />
                    ))}
                  </div>
                  <div className="reg-ds-modal-name">{ds.name}</div>
                  {selectedDsPath === ds.path && (
                    <div className="reg-ds-modal-check">✓ {t("newproject.ds.modal.selected")}</div>
                  )}
                </button>
              );
            })}
            {designSystems.length === 0 && (
              <div className="reg-ds-modal-empty">{t("newproject.ds.modal.empty")}</div>
            )}
          </div>
        </div>
      </DfModal>

      {/* v6: MODEL MENU now lives INSIDE <ModelRocker> as an
        absolute-positioned child (top: 100%). Previous v5 rendered it
        here as a viewport-fixed panel — broken UX feedback in v5 review. */}
    </div>
  );
}

// ─── DS dropdown ────────────────────────────────────────────────
//
// Lives in the composer toolbar (replaces the "soltar · colar · arrastar"
// hint). Mirrors the ModelRocker pattern: PickerKey-style 44px tactile
// pill with bezel + caret, anchored absolute popover that lists all DSes.
// User spec 2026-05-05 (): "no lugar onde diz soltar ·
// colar · arrastar no modal de criação, poderia ser um dropdown de design
// system, assim eliminamos la de baixo".

interface DsDropdownProps {
  /** Visible cards (capped at DS_INLINE_CAP, ordered with selected first). */
  cards: FsDesignSystem[];
  /** Full list — used inside the dropdown menu (no caps). */
  allCards: FsDesignSystem[];
  selectedDsPath: string | null;
  swatchCache: Record<string, string[]>;
  hasMore: boolean;
  noDsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
  onPick: (path: string) => void;
  onClear: () => void;
  onOpenModal: () => void;
  menuRef: React.RefObject<HTMLDivElement>;
  t: (key: string) => string;
}

export function DsDropdown({
  cards,
  allCards,
  selectedDsPath,
  swatchCache,
  hasMore,
  noDsAvailable,
  open,
  onToggle,
  onPick,
  onClear,
  onOpenModal,
  menuRef,
  t,
}: DsDropdownProps) {
  const selected = selectedDsPath ? allCards.find((d) => d.path === selectedDsPath) : null;
  const triggerLabel = selected
    ? selected.name
    : noDsAvailable
      ? t("newproject.trigger.ds.empty")
      : t("newproject.stack.ds");

  // powered by <SearchableDropdown>. Items include all DSes (no
  // arbitrary cap — search lets the user reach ANY DS even with
  // hundreds). Footer action "Ver mais" still opens the full DfModal
  // grid for the visual browse experience. `cards` (capped, ordered
  // selected-first) is preserved for the trigger swatches; the popover
  // walks `allCards` so search covers the whole list.
  const items: SearchableDropdownItem<FsDesignSystem>[] = allCards.map((ds) => {
    const swatches = (swatchCache[ds.path] ?? []).slice(0, 4);
    const padded = [
      ...swatches,
      ...Array(Math.max(0, 4 - swatches.length)).fill("var(--df-surface-raised)"),
    ];
    return {
      id: ds.path,
      label: ds.name,
      sub: ds.path.split("/").slice(-2).join("/"),
      searchText: `${ds.path} ${ds.slug ?? ""}`,
      payload: ds,
      leading: (
        <span className="cnp-ds-dropdown-swatches" aria-hidden>
          {padded.map((sw, i) => (
            <span key={i} className="cnp-ds-dropdown-sw" style={{ background: sw }} />
          ))}
        </span>
      ),
    };
  });
  // Footer action: "Ver mais" — opens the full DfModal grid (visual browse).
  // Only show when we exceed the inline cap or sources beyond what's loaded.
  const showMore = hasMore || allCards.length > 8;
  if (showMore) {
    items.push({
      id: "__ds_more__",
      label: t("newproject.trigger.ds.more"),
      footerAction: true,
    });
  }
  // Reference cards prop to avoid unused-var lint (it was used before for
  // capping; now SearchableDropdown's internal scroll handles overflow).
  void cards;

  // Trigger ref → SearchableDropdown uses it to portal the popover
  // into document.body with fixed coords. Without this the popover
  // gets clipped by .np-modal-card's overflow:hidden + trapped by
  // its animation transform's containing block.
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="cnp-ds-dropdown-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`cnp-ds-dropdown-trigger${selected ? " is-on" : ""}`}
        onClick={() => {
          if (noDsAvailable) {
            onOpenModal();
          } else {
            onToggle();
          }
        }}
        data-cnp-ds-trigger="true"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("newproject.stack.ds")}
      >
        {/* LED — same skeu family as the ModelRocker reg-led. Lights up
         * (accent fill + halo) when a DS is configured; recessed gray
         * when not. Class-only state — see np-regions-lab.css `.reg-led`. */}
        <span className={`reg-led${selected ? "" : " is-off"}`} aria-hidden />
        {selected && (
          <span className="cnp-ds-dropdown-swatches" aria-hidden>
            {(swatchCache[selected.path] ?? [])
              .slice(0, 4)
              .concat(
                Array(Math.max(0, 4 - (swatchCache[selected.path] ?? []).length)).fill(
                  "var(--df-surface-raised)",
                ),
              )
              .map((sw, i) => (
                <span key={i} className="cnp-ds-dropdown-sw" style={{ background: sw }} />
              ))}
          </span>
        )}
        <span className="cnp-ds-dropdown-label">{triggerLabel}</span>
        {!noDsAvailable && (
          <span className="cnp-ds-dropdown-caret" aria-hidden>
            ▾
          </span>
        )}
      </button>

      <SearchableDropdown<FsDesignSystem>
        open={open && !noDsAvailable}
        onClose={onToggle}
        items={items}
        selectedId={selectedDsPath}
        onPick={(it) => {
          if (it.footerAction) {
            onOpenModal();
          } else {
            onPick(it.id);
          }
        }}
        onClear={onClear}
        clearLabel={t("newproject.foot.reset")}
        searchPlaceholder={t("dropdown.search.placeholder")}
        emptyTemplate={t("dropdown.search.empty")}
        ariaLabel={t("newproject.stack.ds")}
        anchor="bottom-start"
        width={300}
        searchThreshold={6}
        popoverRef={menuRef}
        triggerRef={triggerRef}
      />
    </div>
  );
}

// ─── Model rocker ─────────────────────────────────────────────────────
//
// v6 (2026-05-05) — rocker is bigger (44–48px tall, 220–320px wide) and
// owns its own dropdown via an absolute-positioned sibling. User
// flagged v5 menu as broken because it was viewport-fixed (bottom-right
// corner of screen) which felt like it had escaped the form.

interface ModelRockerProps {
  provider: ProviderId;
  model: string;
  open: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
  menuRef: React.RefObject<HTMLDivElement>;
  /** Anchor side the popover opens from. Default `bottom-start` matches
   *  the NewProject modal (trigger near the top of its column). Surfaces
   *  where the trigger sits at the BOTTOM of the viewport (chat input
   *  bar) pass `top-start` so the popover opens upward and stays
   *  on-screen. */
  anchor?: "bottom-start" | "top-start" | "bottom-end" | "top-end";
  /** Compact mode shrinks the trigger to match a 36px button row (chat
   *  input bar's send button). Defaults to the 44px NewProject pill. */
  compact?: boolean;
}

export function ModelRocker({
  provider,
  model,
  open,
  onToggle,
  onPick,
  menuRef,
  anchor = "bottom-start",
  compact = false,
}: ModelRockerProps) {
  const { options: live } = useLiveModelOptions(provider);
  const fallback = getModelsForProvider(provider);
  const opts = live.length > 0 ? live : fallback;
  const current = opts.find((o) => o.id === model);
  const { t } = useT();
  // Trigger ref → SearchableDropdown portals the popover into body so
  // it escapes np-modal-card's overflow:hidden + transform containing
  // block.
  const triggerRef = useRef<HTMLButtonElement>(null);

  const items: SearchableDropdownItem<(typeof opts)[number]>[] = opts.map((m) => ({
    id: m.id,
    label: m.label,
    sub: m.sub,
    searchText: m.id,
    payload: m,
  }));

  // User ask 2026-05-11: "AJEITE DESIGN E COMPORTAMENTO DO DROPDOWN
  // DE MODELOS PRA FICAR IGUAL DO DE DESIGN SYSTEM NO MODAL DE NOVO
  // PROJEOTO". Switched the JSX to reuse the DsDropdown class family
  // (`cnp-ds-dropdown-*`) instead of the v6 rocker chrome, and mirrored
  // anchor (bottom-start) + selected-state (is-on). Same instrument
  // key, same anchored popover via Portal.
  const selected = !!current;

  return (
    <div className="cnp-ds-dropdown-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`cnp-ds-dropdown-trigger${selected ? " is-on" : ""}${compact ? " is-compact" : ""}`}
        onClick={onToggle}
        data-cnp-model-trigger="true"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
      >
        <span className={`reg-led${selected ? "" : " is-off"}`} aria-hidden />
        <span className="cnp-ds-dropdown-label">{shortModelLabel(current?.label ?? model)}</span>
        <span className="cnp-ds-dropdown-caret" aria-hidden>
          ▾
        </span>
      </button>
      <SearchableDropdown
        open={open}
        onClose={onToggle}
        items={items}
        selectedId={model}
        onPick={(it) => onPick(it.id)}
        searchPlaceholder={t("dropdown.search.placeholder")}
        emptyTemplate={t("dropdown.search.empty")}
        ariaLabel="Model"
        anchor={anchor}
        width={300}
        searchThreshold={6}
        popoverRef={menuRef}
        triggerRef={triggerRef}
      />
    </div>
  );
}

// ─── ProviderRocker ──────────────────────────────────────────────────
// Mirrors ModelRocker's anchored-popover pattern (Portal-based, escapes
// the modal's overflow:hidden) but populates from the canonical PROVIDERS
// registry so it always reflects the current 10-provider roster.
//
// Each row shows: provider label · capability hint (CLI / API / Local) ·
// status LED (ready / auth / error / unavailable). The status comes from
// probeAllProviders() which the host fired when the modal opened.
interface ProviderRockerProps {
  provider: ProviderId;
  open: boolean;
  onToggle: () => void;
  onPick: (id: ProviderId) => void;
  menuRef: React.RefObject<HTMLDivElement>;
  statusByProvider: Record<ProviderId, ProviderStatusReport> | null;
}

export function ProviderRocker({
  provider,
  open,
  onToggle,
  onPick,
  menuRef,
  statusByProvider,
}: ProviderRockerProps) {
  const { t } = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = PROVIDERS.find((p) => p.meta.id === provider);

  const items: SearchableDropdownItem<(typeof PROVIDERS)[number]>[] = PROVIDERS.map((p) => {
    const status = statusByProvider?.[p.meta.id]?.status;
    // Compact sub-label: transport + status hint when not ready.
    const transport =
      p.meta.id === "ollama"
        ? "Local"
        : p.meta.id === "anthropic" ||
            p.meta.id === "openai" ||
            p.meta.id === "gemini-api" ||
            p.meta.id === "openrouter"
          ? "API"
          : "CLI";
    const statusHint =
      status === "connected"
        ? ""
        : status === "needs-auth"
          ? " · auth required"
          : status === "not-installed"
            ? " · not installed"
            : status === "error"
              ? " · error"
              : "";
    return {
      id: p.meta.id,
      label: p.meta.label,
      sub: `${transport}${statusHint}`,
      searchText: `${p.meta.id} ${p.meta.label} ${transport}`,
      payload: p,
    };
  });

  return (
    <div className="cnp-ds-dropdown-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="cnp-ds-dropdown-trigger is-on"
        onClick={onToggle}
        data-cnp-provider-trigger="true"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Provider"
      >
        <span className="reg-led" aria-hidden />
        <span className="cnp-ds-dropdown-label">{current?.meta.label ?? provider}</span>
        <span className="cnp-ds-dropdown-caret" aria-hidden>
          ▾
        </span>
      </button>
      <SearchableDropdown
        open={open}
        onClose={onToggle}
        items={items}
        selectedId={provider}
        onPick={(it) => onPick(it.id as ProviderId)}
        searchPlaceholder={t("dropdown.search.placeholder")}
        emptyTemplate={t("dropdown.search.empty")}
        ariaLabel="Provider"
        anchor="bottom-start"
        width={300}
        searchThreshold={6}
        popoverRef={menuRef}
        triggerRef={triggerRef}
      />
    </div>
  );
}
