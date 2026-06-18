/**
 * CommandsSettingsPanel — full CRUD for editorial verbs (commands).
 *
 * 3 frentes per user spec —
 *   1. Builtins reduced to 3 (review, polish, rewrite). Done in registry.ts.
 *   2. No categories — flat alphabetical list (3 builtin + customs).
 *   3. Structured create/edit form (UI fields, not raw YAML):
 *      · Id (auto-snake-case + duplicate check + frontmatter live update)
 *      · Label (display name)
 *      · Description (1-line)
 *      · Hue (select)
 *      · Category (select, kept for runtime grouping in Library)
 *      · ModifiesHtml (checkbox)
 *      · Body (system prompt textarea)
 *      · Frontmatter preview (read-only, generated from form)
 *   Auto-register: writeCustomCommand + dispatch df-verbs-changed = the
 *   slash menu + library see the new verb without page reload.
 *
 * Three states per row (rendered identically in flat list):
 *   · built-in — editable; "Reset to default" reverts (writes nothing if
 *     not currently overridden).
 *   · override — built-in with user edits; "Reset to default" reverts.
 *   · custom — user-created; "Delete" removes.
 *
 * Bridge: GET /commands/list · POST /commands/write · POST /commands/delete.
 */

import { useEffect, useMemo, useState } from "react";
import { loadAllVerbs, type Verb, type VerbCategory, type VerbHue } from "@/runtime/verbs/registry";
import {
  listCustomCommands,
  writeCustomCommand,
  deleteCustomCommand,
  readGlobalConfig,
  writeGlobalConfig,
  db,
} from "@/lib/claude-bridge";
import { SkeuToggle } from "@/components/SkeuToggle";
import { useT, tf } from "@/i18n";

// ── Hidden-builtins persistence ─────────────────────────────────────
// Mirrors the pattern used by Canvas/Formats/Rules: users can
// permanently hide built-in commands. They stay shippable in the source
// (so a future update brings them back if hidden_builtin_commands is
// cleared), but they're filtered out everywhere — slash menu, Library,
// settings list. A "Restore" tray at the bottom of the panel surfaces
// hidden ids so the action is reversible.

async function loadHiddenBuiltins(): Promise<Set<string>> {
  const raw = await db.getSetting("commands_hidden_builtins").catch(() => null);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveHiddenBuiltins(s: Set<string>): Promise<void> {
  await writeGlobalConfig({ hidden_builtin_commands: [...s] as never }).catch(() => {});
  await db.setSetting("commands_hidden_builtins", JSON.stringify([...s])).catch(() => {});
}
import "@/styles/settings-commands.css";

// ─── Types ──────────────────────────────────────────────────────────

interface CommandFormDraft {
  id: string;
  label: string;
  description: string;
  category: VerbCategory;
  hue: VerbHue;
  modifiesHtml: boolean;
  icon: string;
  body: string;
}

const DEFAULT_BODY = `You are doing X to an existing HTML document. Apply the smallest change that fully satisfies the request.

Replace this body with your system prompt — the form above generates the frontmatter automatically.`;

const DEFAULT_DRAFT: CommandFormDraft = {
  id: "my-command",
  label: "My Command",
  description: "One sentence description shown in the library",
  category: "refine",
  hue: "warm-gold",
  modifiesHtml: true,
  icon: "command",
  body: DEFAULT_BODY,
};

const HUE_OPTIONS: ReadonlyArray<{ id: VerbHue; key: string }> = [
  { id: "cool-blue", key: "cmd.hue.cool-blue" },
  { id: "warm-gold", key: "cmd.hue.warm-gold" },
  { id: "warm-coral", key: "cmd.hue.warm-coral" },
  { id: "cool-purple", key: "cmd.hue.cool-purple" },
  { id: "neutral", key: "cmd.hue.neutral" },
];

const CATEGORY_OPTIONS: ReadonlyArray<{ id: VerbCategory; key: string }> = [
  { id: "evaluate", key: "cmd.cat.evaluate" },
  { id: "refine", key: "cmd.cat.refine" },
  { id: "direction", key: "cmd.cat.direction" },
  { id: "enhance", key: "cmd.cat.enhance" },
  { id: "fix", key: "cmd.cat.fix" },
  { id: "export", key: "cmd.cat.export" },
];

// ─── Helpers ────────────────────────────────────────────────────────

/** Convert a free-form id input to a safe slug. Lower-case, ASCII letters,
 *  digits, dashes only. Spaces become dashes. Truncated at 41 chars.
 *  Strips leading dashes only — preserves trailing dash so the user can
 *  keep typing words separated by spaces in real time without losing the
 *  separator (e.g. "my " stays "my-" not "my"). */
function toSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 41);
}

/** Strict slug — trims trailing dashes too. Used at validation time
 *  (creation, save) to normalize before persisting. */
function finalizeSlug(input: string): string {
  return toSlug(input).replace(/-+$/, "");
}

function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(id);
}

/** Build the .md content from a structured draft. The runtime registry
 *  parses this back into a Verb via parseFrontmatter + verbFromMarkdown. */
function serializeDraft(d: CommandFormDraft): string {
  return [
    "---",
    `id: ${d.id}`,
    `label: ${d.label}`,
    `description: ${d.description}`,
    `category: ${d.category}`,
    `hue: ${d.hue}`,
    `modifiesHtml: ${d.modifiesHtml}`,
    `icon: ${d.icon}`,
    "---",
    "",
    d.body,
  ].join("\n");
}

/** Render just the frontmatter part for the read-only preview block. */
function frontmatterPreview(d: CommandFormDraft): string {
  return [
    "---",
    `id: ${d.id || "—"}`,
    `label: ${d.label || "—"}`,
    `description: ${d.description || "—"}`,
    `category: ${d.category}`,
    `hue: ${d.hue}`,
    `modifiesHtml: ${d.modifiesHtml}`,
    `icon: ${d.icon}`,
    "---",
  ].join("\n");
}

function verbToDraft(v: Verb): CommandFormDraft {
  return {
    id: v.id,
    label: v.label,
    description: v.description,
    category: v.category,
    hue: v.hue,
    modifiesHtml: v.modifiesHtml,
    icon: v.icon,
    body: v.systemPrompt,
  };
}

// ─── Panel ──────────────────────────────────────────────────────────

export function CommandsSettingsPanel() {
  const { t } = useT();
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CommandFormDraft>>({});
  const [showNew, setShowNew] = useState(false);
  const [newDraft, setNewDraft] = useState<CommandFormDraft>(DEFAULT_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenBuiltins, setHiddenBuiltins] = useState<Set<string>>(new Set());

  const refresh = async () => {
    const all = await loadAllVerbs(
      async () => listCustomCommands(),
      async () => {
        const cfg = (await readGlobalConfig()) as Record<string, unknown> | null;
        const arr = cfg?.commands_disabled;
        return Array.isArray(arr) ? (arr as string[]) : [];
      },
    );
    setVerbs(all);
    setDisabled(new Set(all.filter((v) => v.disabled).map((v) => v.id)));
    setHiddenBuiltins(await loadHiddenBuiltins());
    // Auto-register: every refresh fires this so EditorScreen + slash menu
    // hot-load the new verb list.
    window.dispatchEvent(new Event("df-verbs-changed"));
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleHideBuiltin = async (v: Verb) => {
    if (!confirm(tf("cmd.hide.confirm", v.label))) return;
    const next = new Set(hiddenBuiltins);
    next.add(v.id);
    setHiddenBuiltins(next);
    await saveHiddenBuiltins(next);
    // Also drop any override so the row truly disappears.
    if (v.source === "override") {
      await deleteCustomCommand(v.id).catch(() => null);
    }
    setEditingId(null);
    await refresh();
    window.dispatchEvent(new Event("df-verbs-changed"));
  };

  // handleRestoreBuiltin removed 2026-05-21 — deletes are permanent now.
  // Per-command UI no longer surfaces a restore option.

  // flat alphabetical list — no categories. Builtins float to top
  // (mono kicker shows "padrão" / "default") then customs (user-created).
  // Hidden built-ins are filtered out; surfaced in the restore tray.
  const visibleVerbs = useMemo(
    () =>
      verbs.filter(
        (v) => !(hiddenBuiltins.has(v.id) && (v.source === "builtin" || v.source === "override")),
      ),
    [verbs, hiddenBuiltins],
  );
  const sorted = useMemo(() => {
    return [...visibleVerbs].sort((a, b) => {
      // Builtin (incl override) before custom; then alpha.
      const sourceWeight = (s: Verb["source"]) => (s === "custom" ? 1 : 0);
      const sa = sourceWeight(a.source);
      const sb = sourceWeight(b.source);
      if (sa !== sb) return sa - sb;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
  }, [visibleVerbs]);

  const builtinIds = useMemo(
    () =>
      new Set(
        verbs.filter((v) => v.source === "builtin" || v.source === "override").map((v) => v.id),
      ),
    [verbs],
  );

  // hiddenList memo removed alongside the restore tray. hiddenBuiltins
  // is still consulted by visibleVerbs / sorted to keep deleted commands
  // out of the slash menu — just no longer exposed for restore.

  const handleToggleDisabled = async (id: string, on: boolean) => {
    const next = new Set(disabled);
    if (on) next.delete(id);
    else next.add(id);
    setDisabled(next);
    await writeGlobalConfig({ commands_disabled: Array.from(next) } as Record<string, unknown>);
    void refresh();
  };

  const handleSave = async (verb: Verb) => {
    const draft = drafts[verb.id];
    if (!draft) return;
    const finalId = verb.source === "custom" ? finalizeSlug(draft.id) : verb.id;
    if (!isValidId(finalId)) {
      setError(t("cmd.alert.invalid.id"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // For builtin overrides, id MUST stay the same (renaming would
      // create a new file alongside). For customs, allow rename if user
      // changed the id and the new id doesn't collide.
      if (verb.source === "custom" && finalId !== verb.id) {
        // Collision check.
        if (verbs.some((v) => v.id === finalId && v.id !== verb.id)) {
          setError(t("cmd.alert.duplicate"));
          setBusy(false);
          return;
        }
        // Delete old file then write new.
        await deleteCustomCommand(verb.id);
      }
      const ok = await writeCustomCommand(finalId, serializeDraft({ ...draft, id: finalId }));
      if (!ok) {
        setError(t("cmd.save.failed"));
      } else {
        setEditingId(null);
        setDrafts((d) => {
          const n = { ...d };
          delete n[verb.id];
          return n;
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (verb: Verb) => {
    if (!confirm(tf("cmd.reset.confirm", verb.label))) return;
    setBusy(true);
    try {
      const ok = await deleteCustomCommand(verb.id);
      if (ok) {
        setEditingId(null);
        setDrafts((d) => {
          const n = { ...d };
          delete n[verb.id];
          return n;
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (verb: Verb) => {
    if (!confirm(tf("cmd.delete.confirm", verb.label))) return;
    setBusy(true);
    try {
      const ok = await deleteCustomCommand(verb.id);
      if (ok) {
        setEditingId(null);
        setDrafts((d) => {
          const n = { ...d };
          delete n[verb.id];
          return n;
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    // Finalize id (strip trailing dashes) only at submit time so the user
    // can type spaces in real time without the separator vanishing.
    const finalId = finalizeSlug(newDraft.id);
    if (!isValidId(finalId)) {
      setError(t("cmd.alert.invalid.id"));
      return;
    }
    if (builtinIds.has(finalId) || verbs.some((v) => v.id === finalId)) {
      setError(t("cmd.alert.duplicate"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const finalDraft = { ...newDraft, id: finalId };
      const ok = await writeCustomCommand(finalId, serializeDraft(finalDraft));
      if (ok) {
        setShowNew(false);
        setNewDraft(DEFAULT_DRAFT);
        await refresh();
      } else {
        setError(t("cmd.alert.create.failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  // builtinCount/overrideCount/customCount removed alongside the summary
  // line. tf("cmd.count", verbs.length) in the toolbar still reads
  // verbs.length directly.

  return (
    <section className="cmd-panel" aria-label={t("cmd.title")}>
      {/* Hero + summary line removed 2026-05-21 — user ask: "9
          comandos · 9 de fábrica · 0 customs. Cada comando é um system
          prompt aplicado... remove isso tambem". The Aqua sub-tab pill
          identifies the page; the simple count next to the New button
          in the toolbar below carries the meta. */}

      {/* Toolbar — create button */}
      <div className="cmd-toolbar">
        <span className="cmd-toolbar-count">{tf("cmd.count", verbs.length)}</span>
        <button
          type="button"
          className="df-btn df-btn--primary"
          onClick={() => {
            setError(null);
            setShowNew((s) => !s);
          }}
        >
          {showNew ? t("cmd.cancel") : t("cmd.new")}
        </button>
      </div>

      {/* Create form */}
      {showNew && (
        <div className="cmd-form-card">
          <CommandForm
            draft={newDraft}
            setDraft={(next) => setNewDraft(next)}
            isCreate
            existingIds={new Set(verbs.map((v) => v.id))}
          />
          {error && <p className="cmd-form-error">{error}</p>}
          <div className="cmd-form-actions">
            <button
              type="button"
              className="df-btn df-btn--ghost"
              onClick={() => {
                setShowNew(false);
                setError(null);
                setNewDraft(DEFAULT_DRAFT);
              }}
            >
              {t("cmd.cancel")}
            </button>
            <button
              type="button"
              className="df-btn df-btn--primary"
              onClick={() => void handleCreate()}
              disabled={
                busy || !isValidId(newDraft.id) || !newDraft.label.trim() || !newDraft.body.trim()
              }
            >
              {busy ? t("cmd.creating") : t("cmd.create")}
            </button>
          </div>
        </div>
      )}

      {/* Flat list — no categories */}
      <div className="cmd-list">
        {sorted.length === 0 && (
          <div className="cmd-empty">
            <div className="cmd-empty-mark" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <p className="cmd-empty-title">{t("cmd.empty.title")}</p>
            <p className="cmd-empty-body">{t("cmd.empty.body")}</p>
          </div>
        )}
        {/* "Excluídos" tray removed 2026-05-21 — user ask: "nao quero
            esse aviso, nao quero recuperar, prefiro que apareça aviso
            pedindo confirmação de deletar permanente". Confirm dialog
            in handleHideBuiltin enforces the permanence; no recovery
            surface needed. */}
        {sorted.map((v) => {
          const isOpen = editingId === v.id;
          const isOn = !disabled.has(v.id);
          const draft = drafts[v.id];
          const sourceBadge =
            v.source === "override"
              ? t("cmd.row.pill.edited")
              : v.source === "custom"
                ? t("cmd.row.pill.custom")
                : t("cmd.row.pill.builtin");
          return (
            <div key={v.id} className={`cmd-row${isOpen ? " is-open" : ""}`}>
              <div className="cmd-row-head">
                <SkeuToggle
                  on={isOn}
                  onChange={(next) => void handleToggleDisabled(v.id, next)}
                  label={tf("cmd.row.enable", v.label)}
                />
                <button
                  type="button"
                  className="cmd-row-headbtn"
                  onClick={() => {
                    if (!isOpen) {
                      setError(null);
                      setDrafts((d) => ({ ...d, [v.id]: verbToDraft(v) }));
                    }
                    setEditingId(isOpen ? null : v.id);
                  }}
                >
                  <div className="cmd-row-id">
                    <span className="cmd-row-name">{v.label}</span>
                    <code className="cmd-row-trigger">/{v.id}</code>
                    <span className={`cmd-row-pill cmd-row-pill--${v.source}`}>{sourceBadge}</span>
                  </div>
                  <p className="cmd-row-desc">{v.description}</p>
                  <svg
                    className={`cmd-row-chev${isOpen ? " is-open" : ""}`}
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
              {isOpen && draft && (
                <div className="cmd-row-body">
                  <CommandForm
                    draft={draft}
                    setDraft={(next) => setDrafts((d) => ({ ...d, [v.id]: next }))}
                    isCreate={false}
                    lockedId={v.source !== "custom"}
                    existingIds={new Set(verbs.filter((x) => x.id !== v.id).map((x) => x.id))}
                  />
                  {error && <p className="cmd-form-error">{error}</p>}
                  <div className="cmd-form-actions">
                    {v.source === "custom" ? (
                      <button
                        type="button"
                        className="df-btn df-btn--danger"
                        onClick={() => void handleDelete(v)}
                        disabled={busy}
                      >
                        {t("cmd.delete")}
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        {v.source === "override" && (
                          <button
                            type="button"
                            className="df-btn df-btn--ghost"
                            onClick={() => void handleReset(v)}
                            disabled={busy}
                          >
                            {t("cmd.reset.default")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="df-btn df-btn--danger"
                          onClick={() => void handleHideBuiltin(v)}
                          disabled={busy}
                          title={t("cmd.hide.tooltip")}
                        >
                          {t("cmd.hide")}
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="df-btn df-btn--primary"
                      onClick={() => void handleSave(v)}
                      disabled={
                        busy || !isValidId(draft.id) || !draft.label.trim() || !draft.body.trim()
                      }
                    >
                      {busy ? t("cmd.saving") : t("cmd.save")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Form (shared by create + edit) ─────────────────────────────────

interface CommandFormProps {
  draft: CommandFormDraft;
  setDraft: (next: CommandFormDraft) => void;
  isCreate: boolean;
  /** When true, the id field is disabled (builtin and override commands
   *  cannot rename — that would create a parallel file and break the
   *  override mechanic). Custom commands can rename freely. */
  lockedId?: boolean;
  /** All other ids in the registry — used for live duplicate validation. */
  existingIds: Set<string>;
}

function CommandForm({ draft, setDraft, isCreate, lockedId, existingIds }: CommandFormProps) {
  const { t } = useT();
  const idValid = isValidId(draft.id);
  const idDuplicate = isCreate && existingIds.has(draft.id);

  const update = (patch: Partial<CommandFormDraft>) => {
    setDraft({ ...draft, ...patch });
  };

  const handleIdChange = (raw: string) => {
    update({ id: toSlug(raw) });
  };

  return (
    <div className="cmd-form">
      {/* Row 1: Id + Label side-by-side */}
      <div className="cmd-form-row">
        <label className="cmd-field">
          <span className="cmd-field-label">{t("cmd.field.id")}</span>
          <input
            type="text"
            className={`cmd-field-input cmd-field-input--mono${!idValid || idDuplicate ? " is-invalid" : ""}`}
            value={draft.id}
            onChange={(e) => handleIdChange(e.target.value)}
            placeholder={t("cmd.id.placeholder")}
            disabled={lockedId}
            aria-describedby="cmd-id-help"
          />
          <span id="cmd-id-help" className="cmd-field-help">
            {lockedId
              ? t("cmd.field.id.locked.help")
              : idDuplicate
                ? t("cmd.alert.duplicate")
                : !idValid
                  ? t("cmd.alert.invalid.id")
                  : t("cmd.field.id.help")}
          </span>
        </label>
        <label className="cmd-field">
          <span className="cmd-field-label">{t("cmd.field.label")}</span>
          <input
            type="text"
            className="cmd-field-input"
            value={draft.label}
            onChange={(e) => update({ label: e.target.value })}
            placeholder={t("cmd.field.label.placeholder")}
          />
        </label>
      </div>

      {/* Row 2: description full width */}
      <label className="cmd-field">
        <span className="cmd-field-label">{t("cmd.field.description")}</span>
        <input
          type="text"
          className="cmd-field-input"
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={t("cmd.field.description.placeholder")}
        />
      </label>

      {/* Row 3: category + hue side-by-side + modifiesHtml checkbox */}
      <div className="cmd-form-row cmd-form-row--three">
        <label className="cmd-field">
          <span className="cmd-field-label">{t("cmd.field.category")}</span>
          <select
            className="cmd-field-input"
            value={draft.category}
            onChange={(e) => update({ category: e.target.value as VerbCategory })}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(opt.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="cmd-field">
          <span className="cmd-field-label">{t("cmd.field.hue")}</span>
          <select
            className="cmd-field-input"
            value={draft.hue}
            onChange={(e) => update({ hue: e.target.value as VerbHue })}
          >
            {HUE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(opt.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="cmd-field cmd-field--checkbox">
          <span className="cmd-field-label">{t("cmd.field.modifies")}</span>
          <span className="cmd-checkbox-row">
            <input
              type="checkbox"
              className="cmd-checkbox"
              checked={draft.modifiesHtml}
              onChange={(e) => update({ modifiesHtml: e.target.checked })}
            />
            <span className="cmd-checkbox-label">{t("cmd.field.modifies.label")}</span>
          </span>
        </label>
      </div>

      {/* Body (system prompt) */}
      <label className="cmd-field">
        <span className="cmd-field-label">{t("cmd.field.body")}</span>
        <textarea
          className="cmd-field-textarea"
          value={draft.body}
          onChange={(e) => update({ body: e.target.value })}
          rows={12}
          placeholder={t("cmd.field.body.placeholder")}
        />
        <span className="cmd-field-help">{t("cmd.field.body.help")}</span>
      </label>

      {/* Frontmatter preview — read-only, generated from form */}
      <details className="cmd-frontmatter-disclosure">
        <summary className="cmd-frontmatter-summary">{t("cmd.frontmatter.title")}</summary>
        <pre className="cmd-frontmatter-preview" aria-label={t("cmd.frontmatter.title")}>
          {frontmatterPreview(draft)}
        </pre>
        <p className="cmd-frontmatter-note">{t("cmd.frontmatter.note")}</p>
      </details>
    </div>
  );
}
