// InsumosPanel.tsx — Settings · Padrões.
//
// Labelled "Padrões" (PT) / "Defaults" (EN). The URL slug stays
// /settings/insumos for backward compatibility — this is a label-only
// rename.
//
// Anatomy:
//   ┌─ kicker ──────────────────────────────────────────────────────┐
//   │ DESIGN FACTORY · PADRÕES                                       │
//   │ Padrões                                                        │
//   │ subtitle prose                                                 │
//   ├─ Aqua sub-tabs (preserved Aqua DNA — they're tabs, not list)  │
//   │ [Canvas]  [Formatos]  [Regras]                                 │
//   ├─ Direções block (guidance for current sub-tab) ───────────────│
//   │ ▸ Como usar canvas / How to use canvas                         │
//   │   2-3 sentence directions.                                     │
//   ├─ active editor body (TaxonomyManager skinned editorially) ───│
//   │ wider list (380px) + flat surfaces + breathing room            │
//   └────────────────────────────────────────────────────────────────┘
//
// Container .padroes-panel triggers settings-padroes.css overrides that
// reduce skeu density inside this scope ONLY. The NewProject modal is
// untouched — its premium skeu (faceplate hero, picker keys, Aqua tabs)
// stays intact.
//
// Backward-compat: SettingsScreen keeps redirecting legacy
// /settings/canvas|formats|rules to /settings/insumos/{tab}.

import { CanvasPresetsEditor } from "@/components/CanvasPresetsEditor";
import { FormatTaxonomyEditor } from "@/components/FormatTaxonomyEditor";
import { RulesEditor } from "@/components/RulesEditor";
import { TasteDialEditor } from "@/components/TasteDialEditor";
import { CommandsSettingsPanel } from "@/components/CommandsSettingsPanel";
import { BuiltinPromptsPanel } from "@/components/BuiltinPromptsPanel";
import { useT } from "@/i18n";
import "@/styles/settings-insumos.css";
import "@/styles/settings-padroes.css";

// Defaults page = the 6 editable defaults that surface in New Project +
// drive runtime behaviour. User ask 2026-05-18 — all 6 live under
// /settings/defaults (was /settings/insumos) as sub-tabs.
// Skills live at /skills (home) — they have their own library and are
// NOT a project default. Don't bring them here.
export type InsumoTab = "canvas" | "formats" | "rules" | "taste" | "commands" | "prompts";

// Taste sub-tab — lets the user rewrite the
// low/high phrase for each of the 6 canonical+ taste dials,
// editable directly in settings. Commands/prompts merged in later.
const TABS: ReadonlyArray<{ id: InsumoTab; key: string; fallback?: string }> = Object.freeze([
  { id: "canvas", key: "settings.insumos.tab.canvas" },
  { id: "formats", key: "settings.insumos.tab.formats" },
  { id: "rules", key: "settings.insumos.tab.rules" },
  { id: "taste", key: "settings.insumos.tab.taste", fallback: "Taste" },
  { id: "commands", key: "settings.insumos.tab.commands", fallback: "Commands" },
  { id: "prompts", key: "settings.insumos.tab.prompts", fallback: "System Prompts" },
]);

// Direções/"Como usar" block removed from each sub-tab
// (the settings pages don't need that "how to use" block). The
// PadroesDirections component file is preserved (used as a reference
// pattern) but no longer mounted. i18n keys settings.padroes.directions.*
// kept in strings.ts for backward-compat — no live consumer.

interface InsumosPanelProps {
  /** Currently active sub-tab. */
  tab: InsumoTab;
  /** Called when user clicks a sub-tab — caller persists to URL. */
  onTabChange: (next: InsumoTab) => void;
}

export function InsumosPanel({ tab, onTabChange }: InsumosPanelProps) {
  const { t } = useT();

  return (
    <section
      className="settings-page insumos-panel padroes-panel"
      aria-label={t("settings.insumos.title")}
    >
      <h1 className="settings-title">{t("settings.insumos.title")}</h1>
      <p className="settings-group-sub">{t("settings.insumos.desc")}</p>

      {/* ── Aqua sub-tabs (preserved Aqua DNA) ───────────────────── */}
      <div className="insumos-tabs" role="tablist" aria-label={t("settings.insumos.tabs.aria")}>
        {TABS.map((entry) => {
          const active = tab === entry.id;
          const tabLabel = t(entry.key);
          // i18n fallback — if the translation key returns itself (no
          // entry exists in strings.ts yet), fall back to the literal
          // English label declared on the TABS entry. Keeps the new
          // Taste tab labelled cleanly without forcing a strings.ts
          // edit in the same PR.
          const safeLabel = tabLabel === entry.key && entry.fallback ? entry.fallback : tabLabel;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`insumos-panel-${entry.id}`}
              id={`insumos-tab-${entry.id}`}
              className={`insumos-tab${active ? " is-active" : ""}`}
              onClick={() => {
                if (!active) onTabChange(entry.id);
              }}
            >
              <span className="insumos-tab-led" aria-hidden />
              <span className="insumos-tab-label">{safeLabel}</span>
            </button>
          );
        })}
      </div>

      {/* "Como usar" block dropped from this surface; the sub-tab
          editor renders directly under the Aqua tabs. */}

      {/* ── Active editor body ──────────────────────────────────── */}
      <div
        className="insumos-body"
        role="tabpanel"
        id={`insumos-panel-${tab}`}
        aria-labelledby={`insumos-tab-${tab}`}
      >
        {tab === "canvas" && <CanvasPresetsEditor />}
        {tab === "formats" && <FormatTaxonomyEditor />}
        {tab === "rules" && <RulesEditor />}
        {tab === "taste" && <TasteDialEditor />}
        {tab === "commands" && <CommandsSettingsPanel />}
        {tab === "prompts" && <BuiltinPromptsPanel />}
      </div>
    </section>
  );
}
