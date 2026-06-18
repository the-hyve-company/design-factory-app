// BuiltinPromptsPanel — Settings panel for the 3 built-in system prompts
// (generate, refine, tweaks). Uses the same .fmt-row + collapsible body
// pattern as Formats / Directions / Commands. No toggle: built-ins are
// runtime-required.

import { useEffect, useState } from "react";
import { db, readGlobalConfig, writeGlobalConfig } from "@/lib/claude-bridge";
import { DEFAULT_BUILTIN_PROMPTS } from "@/data/prompts-taxonomy";
import { useT } from "@/i18n";

interface BuiltinDef {
  id: string;
  /** i18n key for the label (resolved at render time so the row label
   *  flips with language). */
  labelKey: string;
  /** i18n key for the trigger hint (parenthesized note shown next to the
   *  description: "(initial prompt)" / "(chat reply)"). Note: "/tweaks"
   *  is a literal slash command and stays untranslated by surfacing the
   *  same value in both languages. */
  triggerKey: string;
  /** i18n key for the inline description. */
  descKey: string;
  defaultPrompt: string;
}

// Sourced from the canonical taxonomy (src/data/prompts-taxonomy.ts).
// i18n keys are joined here because translations are panel-owned and
// don't belong in the data layer.
const EDITABLE_BUILTINS: BuiltinDef[] = DEFAULT_BUILTIN_PROMPTS.map((p) => ({
  id: p.id,
  labelKey: `builtin.row.${p.id}.label`,
  triggerKey: `builtin.row.${p.id}.trigger`,
  descKey: `builtin.row.${p.id}.desc`,
  defaultPrompt: p.body,
}));

interface RowProps {
  def: BuiltinDef;
  override: string;
  onChange: (next: string) => void;
  onReset: () => void;
}

function BuiltinRow({ def, override, onChange, onReset }: RowProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [savedTick, setSavedTick] = useState(0);
  const isOverridden = override !== "" && override !== def.defaultPrompt;

  useEffect(() => {
    if (open) setDraft(override !== "" ? override : def.defaultPrompt);
  }, [open, override, def.defaultPrompt]);

  const handleSave = () => {
    if (draft === def.defaultPrompt) {
      onReset();
    } else {
      onChange(draft);
    }
    setSavedTick((n) => n + 1);
    window.setTimeout(() => setSavedTick(0), 1500);
  };

  return (
    <div className="fmt-row">
      <div className={`fmt-row-head${open ? " is-open" : ""}`}>
        <button
          type="button"
          className="fmt-row-headbtn"
          onClick={() => setOpen((v) => !v)}
          style={{ flex: 1 }}
        >
          <div className="fmt-row-id">
            <span className="fmt-row-name">{t(def.labelKey)}</span>
            {isOverridden && <span className="fmt-row-pill">{t("builtin.pill.edited")}</span>}
          </div>
          <svg
            className={`fmt-row-chev${open ? " is-open" : ""}`}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="fmt-row-body">
          <p
            style={{
              fontSize: 12,
              color: "var(--df-text-muted)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            <code
              style={{
                fontFamily: "var(--df-font-mono)",
                fontSize: 11,
                color: "var(--df-text-faint)",
              }}
            >
              {t(def.triggerKey)}
            </code>
            {" · "}
            {t(def.descKey)}
          </p>
          <label className="fmt-field">
            <span className="fmt-field-label">{t("builtin.body.aria")}</span>
            <textarea
              className="fmt-field-textarea"
              rows={Math.max(8, Math.min(20, Math.ceil(draft.length / 80)))}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ minHeight: 200 }}
            />
          </label>
          <div className="fmt-row-actions">
            <button
              type="button"
              className="df-btn df-btn--ghost"
              onClick={onReset}
              disabled={!isOverridden}
            >
              {t("builtin.reset")}
            </button>
            <button type="button" className="df-btn df-btn--primary" onClick={handleSave}>
              {savedTick > 0 ? t("builtin.saved") : t("builtin.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BuiltinPromptsPanel() {
  const { t } = useT();
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const fromFs = await readGlobalConfig();
      const next: Record<string, string> = {};
      if (fromFs?.builtin_prompts) {
        for (const [id, val] of Object.entries(fromFs.builtin_prompts)) {
          if (val) next[id] = val;
        }
      }
      for (const b of EDITABLE_BUILTINS) {
        if (next[b.id]) continue;
        const val = await db.getSetting(`builtin_prompt:${b.id}`).catch(() => null);
        if (val) next[b.id] = val;
      }
      setOverrides(next);
    })();
  }, []);

  const handleChange = (id: string, value: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [id]: value };
      void writeGlobalConfig({ builtin_prompts: next }).catch(() => {});
      return next;
    });
    db.setSetting(`builtin_prompt:${id}`, value).catch(() => {});
  };
  const handleReset = (id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      void writeGlobalConfig({ builtin_prompts: next }).catch(() => {});
      return next;
    });
    db.setSetting(`builtin_prompt:${id}`, "").catch(() => {});
  };

  return (
    <>
      {/* Hero removed 2026-05-21 — parent InsumosPanel header carries
          the page identity; sub-tabs serve as nav. */}
      <section className="settings-group" style={{ borderTop: 0, paddingTop: 0 }}>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: "var(--df-text-xs)",
            color: "var(--df-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span aria-hidden style={{ opacity: 0.7 }}>
            ⚠
          </span>
          {t("builtin.warning")}
        </p>
        <div className="fmt-list">
          {EDITABLE_BUILTINS.map((b) => (
            <BuiltinRow
              key={b.id}
              def={b}
              override={overrides[b.id] || ""}
              onChange={(v) => handleChange(b.id, v)}
              onReset={() => handleReset(b.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
