// RulesEditor.tsx — Settings · Rules.
//
// user spec:
//   "rules, formats e canvas com gerenciamento premium em settings".
//
// Anatomy (shared with Canvas + Formats):
//   <TaxonomyManager> with category groups (anti-slop / tone / motion /
//   color / language / voice / layout / custom) + group filter pills.
//
// CRUD over the rules catalog:
//   - Builtins: edit title/description/category (overrides). Cannot delete.
//     Toggle to hide.
//   - User rules: edit + delete freely. Add via the manager's "+ New" CTA
//     which still opens the existing RuleCreateModal so the
//     id-generation flow stays canonical.
//
// Persistence: writeGlobalConfig (filesystem) + db.setSetting fallback.

import { useEffect, useMemo, useState } from "react";
import { db, writeGlobalConfig } from "@/lib/claude-bridge";
import {
  TaxonomyManager,
  type TaxonomyItem,
  type TaxonomyGroup,
} from "@/components/TaxonomyManager";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";
import { PadroesCategoryManager, type ManagedCategory } from "@/components/PadroesCategoryManager";
import { ImportExportControls, type ImportPreview } from "@/components/ImportExportControls";
import { RuleCreateModal } from "@/components/RuleCreateModal";
import { useT, type Lang } from "@/i18n";
import {
  ruleTitle as builtinRuleTitle,
  ruleDescription as builtinRuleDescription,
} from "@/i18n/builtin-labels";
import {
  buildRulesExport,
  DEFAULT_BUILTIN_RULES,
  RULE_CATEGORIES,
  getBuiltinOverrides,
  getCategoryLabelOverrides,
  getCustomRuleCategories,
  getEffectiveCategories,
  getHiddenBuiltinRuleIds,
  getUserRules,
  parseRulesImport,
  setBuiltinOverrides,
  setCategoryLabelOverrides,
  setCustomRuleCategories,
  setDisabledRuleIds,
  setHiddenBuiltinRuleIds,
  setUserRules,
  type Rule,
  type RuleCategoryMeta,
  type RulesExportV1,
} from "@/data/rules-taxonomy";

// ─── Orphan bucket ──────────────────────────────────────────────
//
// When a custom rule category is deleted with rules still inside, the
// rules cascade into a "_orphan" bucket labeled "Sem categoria" so they
// don't disappear from the picker. User reassigns them later.

const ORPHAN_CATEGORY_ID = "_orphan";
const ORPHAN_CATEGORY_LABEL = "Sem categoria";

// ─── Persistence ──────────────────────────────────────────────────────

async function loadDisabled(): Promise<Set<string>> {
  const raw = await db.getSetting("rules_disabled").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}

async function persistDisabled(s: Set<string>): Promise<void> {
  await db.setSetting("rules_disabled", JSON.stringify([...s])).catch(() => {});
}

async function persistUserRules(arr: Rule[]): Promise<void> {
  setUserRules(arr);
  await writeGlobalConfig({ custom_rules: arr as never }).catch(() => {});
  await db.setSetting("custom_rules", JSON.stringify(arr)).catch(() => {});
}

async function persistOverrides(
  map: Record<string, Partial<Pick<Rule, "title" | "description" | "category">>>,
): Promise<void> {
  setBuiltinOverrides(map);
  await writeGlobalConfig({ builtin_rule_overrides: map as never }).catch(() => {});
  await db.setSetting("builtin_rule_overrides", JSON.stringify(map)).catch(() => {});
}

// category management persistence
async function persistCustomRuleCategories(arr: RuleCategoryMeta[]): Promise<void> {
  setCustomRuleCategories(arr);
  await writeGlobalConfig({ custom_rule_categories: arr as never }).catch(() => {});
  await db.setSetting("custom_rule_categories", JSON.stringify(arr)).catch(() => {});
}
async function persistCategoryLabelOverrides(map: Record<string, string>): Promise<void> {
  setCategoryLabelOverrides(map);
  await writeGlobalConfig({ rule_category_overrides: map as never }).catch(() => {});
  await db.setSetting("rule_category_overrides", JSON.stringify(map)).catch(() => {});
}

// permanent hidden builtin rules.
async function loadHiddenBuiltinRules(): Promise<Set<string>> {
  const raw = await db.getSetting("rules_hidden_builtins").catch(() => null);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}
async function persistHiddenBuiltinRules(s: Set<string>): Promise<void> {
  setHiddenBuiltinRuleIds([...s]);
  await writeGlobalConfig({ hidden_builtin_rules: [...s] as never }).catch(() => {});
  await db.setSetting("rules_hidden_builtins", JSON.stringify([...s])).catch(() => {});
}

// ─── Adapter — Rule → TaxonomyItem ────────────────────────────────────

interface RuleItem extends TaxonomyItem {
  rule: Rule;
  hasOverride: boolean;
}

function toItem(rule: Rule, hasOverride: boolean, enabled: boolean, lang: Lang): RuleItem {
  // localize builtin titles/descriptions. Customs +
  // overridden builtins keep their stored title — overrides are user-
  // typed text and must surface as-is, while pristine builtins flip via
  // i18n.
  const isPristineBuiltin = rule.builtin && !hasOverride;
  return {
    id: rule.id,
    title: isPristineBuiltin ? builtinRuleTitle(rule, lang) : rule.title,
    subtitle: isPristineBuiltin ? builtinRuleDescription(rule, lang) : rule.description,
    builtin: rule.builtin,
    enabled,
    edited: hasOverride,
    group: rule.category,
    rule,
    hasOverride,
  };
}

// ─── Light-weight markdown preview ────────────────────────────────────
// Renders bold (**) italic (*) inline code (`) within a single line. We
// keep it tiny on purpose — rule descriptions are 1-line hints, not docs.

function renderInlineMarkdown(input: string): React.ReactNode[] {
  if (!input) return [];
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > last) tokens.push(input.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      tokens.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      tokens.push(
        <code
          key={key++}
          style={{
            fontFamily: "var(--df-font-mono)",
            fontSize: 11,
            padding: "1px 4px",
            background: "var(--df-bg-base)",
            borderRadius: 3,
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      tokens.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < input.length) tokens.push(input.slice(last));
  return tokens;
}

// ─── Detail form ──────────────────────────────────────────────────────

interface DetailFormProps {
  item: RuleItem;
  allItems: RuleItem[];
  categories: ReturnType<typeof getEffectiveCategories>;
  onSave: (
    rule: Rule,
    patch: Partial<Pick<Rule, "title" | "description" | "category">>,
  ) => Promise<void>;
  onDelete: (rule: Rule) => Promise<void>;
  onDeleteBuiltinPermanent: (rule: Rule) => Promise<void>;
  onResetBuiltin: (rule: Rule) => Promise<void>;
  onDuplicate: (rule: Rule) => Promise<void>;
  onToggleEnabled: (id: string, next: boolean) => void;
}

function DetailForm({
  item,
  allItems,
  categories,
  onSave,
  onDelete,
  onDeleteBuiltinPermanent,
  onResetBuiltin,
  onDuplicate,
  onToggleEnabled,
}: DetailFormProps) {
  const { t, lang } = useT();
  const [title, setTitle] = useState(item.rule.title);
  const [description, setDescription] = useState(item.rule.description ?? "");
  const [categoryId, setCategoryId] = useState(item.rule.category);
  const [savedTick, setSavedTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePermanent, setConfirmDeletePermanent] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setTitle(item.rule.title);
    setDescription(item.rule.description ?? "");
    setCategoryId(item.rule.category);
    setSavedTick(0);
  }, [item.id]);

  // validation: empty title + duplicate (across all rules).
  const validation = useMemo(() => {
    const errors: { title?: string } = {};
    const trimmed = title.trim();
    if (!trimmed) {
      errors.title = t("settings.padroes.validation.empty.name");
    } else {
      const dup = allItems.find(
        (it) => it.id !== item.id && it.title.toLowerCase() === trimmed.toLowerCase(),
      );
      if (dup) errors.title = t("settings.padroes.validation.duplicate");
    }
    return errors;
  }, [title, allItems, item.id, t]);
  const hasErrors = Object.keys(validation).length > 0;

  const handleSave = async () => {
    if (hasErrors) return;
    const patch: Partial<Pick<Rule, "title" | "description" | "category">> = {};
    const t1 = title.trim();
    if (t1 && t1 !== item.rule.title) patch.title = t1;
    const d1 = description.trim();
    if (d1 !== (item.rule.description ?? "")) {
      patch.description = d1.length > 0 ? d1 : undefined;
    }
    if (categoryId !== item.rule.category) patch.category = categoryId;
    if (Object.keys(patch).length === 0) return;
    await onSave(item.rule, patch);
    setSavedTick((n) => n + 1);
    window.setTimeout(() => setSavedTick(0), 1500);
  };

  const enabled = item.enabled !== false;

  return (
    <>
      <div className="tx-mgr-detail-head">
        <div className="tx-mgr-detail-head-text">
          <span className="tx-mgr-detail-eyebrow">{t("settings.rules.detail.eyebrow")}</span>
          <h3 className="tx-mgr-detail-title">
            {item.rule.builtin && !item.hasOverride
              ? builtinRuleTitle(item.rule, lang)
              : item.rule.title}
          </h3>
        </div>
        <div className="tx-mgr-detail-actions">
          <button
            type="button"
            className="tx-mgr-detail-action"
            onClick={() => void onDuplicate(item.rule)}
            title={t("tax.bulk.duplicate")}
          >
            {t("tax.bulk.duplicate")}
          </button>
          {!item.rule.builtin && (
            <button
              type="button"
              className="tx-mgr-detail-action tx-mgr-detail-action--danger"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("settings.padroes.detail.delete.aria")}
            >
              {t("settings.canvas.action.delete")}
            </button>
          )}
          {item.rule.builtin && (
            <button
              type="button"
              className="tx-mgr-detail-action tx-mgr-detail-action--danger"
              onClick={() => setConfirmDeletePermanent(true)}
              aria-label={t("settings.padroes.detail.delete.builtin.aria")}
              title={t("settings.padroes.builtin.action.delete")}
            >
              {t("settings.padroes.builtin.action.delete")}
            </button>
          )}
        </div>
      </div>

      {/* v19 — Builtin guidance + explicit Hide/Show + Reset (when edited)
       * Removed amber tip card ("Padrão do Design Factory…"). The
       * PADRÃO badge on the row + the action buttons below already convey
       * the affordance — the tip was visually loud and redundant. */}
      {item.rule.builtin && (
        <>
          <div className="padroes-builtin-actions" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className="padroes-action-btn"
              onClick={() => onToggleEnabled(item.id, !enabled)}
            >
              {enabled
                ? t("settings.padroes.builtin.action.hide")
                : t("settings.padroes.builtin.action.show")}
            </button>
            {item.hasOverride && (
              <button
                type="button"
                className="padroes-action-btn padroes-action-btn--reset"
                onClick={() => setConfirmReset(true)}
              >
                {t("settings.padroes.builtin.action.reset")}
              </button>
            )}
          </div>
        </>
      )}

      <div className="tx-mgr-form">
        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`rule-title-${item.id}`}>
            {t("settings.rules.field.title")}
          </label>
          <input
            id={`rule-title-${item.id}`}
            type="text"
            className={`tx-mgr-input${validation.title ? " is-invalid" : ""}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={Boolean(validation.title)}
          />
          {validation.title && (
            <span className="tx-mgr-field-error" role="alert">
              {validation.title}
            </span>
          )}
        </div>

        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`rule-cat-${item.id}`}>
            {t("settings.rules.field.category")}
          </label>
          <select
            id={`rule-cat-${item.id}`}
            className="tx-mgr-select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="tx-mgr-field">
          <label className="tx-mgr-field-label" htmlFor={`rule-desc-${item.id}`}>
            {t("settings.rules.field.description")}
          </label>
          <textarea
            id={`rule-desc-${item.id}`}
            className="tx-mgr-textarea"
            placeholder={t("settings.rules.field.description.placeholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ minHeight: 70 }}
          />
          {description && (
            <div
              className="tx-mgr-field-help"
              aria-label={t("rules.editor.preview.aria")}
              style={{
                marginTop: 6,
                padding: "8px 10px",
                background: "var(--df-bg-base)",
                borderRadius: "var(--df-r-sm)",
                boxShadow: "var(--df-bezel-recessed)",
                fontSize: 11.5,
                lineHeight: 1.55,
                color: "var(--df-text-secondary)",
              }}
            >
              {renderInlineMarkdown(description)}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            marginTop: 6,
          }}
        >
          <span className={`tx-mgr-status${savedTick > 0 ? " is-shown" : ""}`}>
            {t("settings.canvas.action.saved")}
          </span>
          <button
            type="button"
            className="df-btn df-btn--primary df-btn--sm"
            onClick={() => void handleSave()}
            disabled={hasErrors}
            title={hasErrors ? validation.title : undefined}
          >
            {t("settings.canvas.action.save")}
          </button>
        </div>
      </div>

      <PadroesConfirmModal
        open={confirmDelete}
        title={item.rule.title}
        body={t("settings.canvas.action.delete.confirm").replace("{0}", item.rule.title)}
        tone="danger"
        confirmLabel={t("settings.canvas.action.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          void onDelete(item.rule);
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <PadroesConfirmModal
        open={confirmDeletePermanent}
        title={item.rule.title}
        body={t("settings.padroes.builtin.action.delete.confirm").replace("{0}", item.rule.title)}
        tone="danger"
        confirmLabel={t("settings.padroes.builtin.action.delete")}
        onConfirm={() => {
          setConfirmDeletePermanent(false);
          void onDeleteBuiltinPermanent(item.rule);
        }}
        onClose={() => setConfirmDeletePermanent(false)}
      />

      <PadroesConfirmModal
        open={confirmReset}
        title={item.rule.title}
        body={t("settings.rules.action.reset.confirm").replace("{0}", item.rule.title)}
        tone="neutral"
        confirmLabel={t("settings.padroes.builtin.action.reset")}
        onConfirm={() => {
          setConfirmReset(false);
          void onResetBuiltin(item.rule);
        }}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────

export function RulesEditor() {
  const { t, lang } = useT();
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [hiddenBuiltins, setHiddenBuiltins] = useState<Set<string>>(
    () => new Set(getHiddenBuiltinRuleIds()),
  );
  const [overrides, setOverrides] = useState<
    Record<string, Partial<Pick<Rule, "title" | "description" | "category">>>
  >(() => getBuiltinOverrides());
  const [userRules, setUserRulesState] = useState<Rule[]>(() => getUserRules());
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [customCats, setCustomCats] = useState<RuleCategoryMeta[]>(() => getCustomRuleCategories());
  const [catLabelOverrides, setCatLabelOverrides] = useState<Record<string, string>>(() =>
    getCategoryLabelOverrides(),
  );

  useEffect(() => {
    void loadDisabled().then((s) => setDisabled(s));
    void loadHiddenBuiltinRules().then((s) => {
      setHiddenBuiltins(s);
      setHiddenBuiltinRuleIds([...s]);
    });
  }, []);

  const allRules = useMemo<Rule[]>(() => {
    const out: Rule[] = [];
    for (const r of DEFAULT_BUILTIN_RULES) {
      // permanently-hidden builtins disappear from the list entirely.
      if (hiddenBuiltins.has(r.id)) continue;
      const override = overrides[r.id];
      out.push(override ? { ...r, ...override } : r);
    }
    for (const r of userRules) out.push(r);
    return out;
  }, [overrides, userRules, hiddenBuiltins]);

  // categories computed from baseline + label overrides + custom slot.
  // We don't call getEffectiveCategories() because it walks module-level
  // state; we want React-reactive recomputation when user renames/creates.
  const categories = useMemo<RuleCategoryMeta[]>(() => {
    const out: RuleCategoryMeta[] = RULE_CATEGORIES.map((c) => ({
      ...c,
      label: catLabelOverrides[c.id] ?? c.label,
    }));
    const known = new Set(out.map((c) => c.id));
    for (const cc of customCats) {
      if (!known.has(cc.id)) {
        known.add(cc.id);
        out.push({ ...cc });
      }
    }
    for (const r of userRules) {
      if (!known.has(r.category)) {
        known.add(r.category);
        out.push({ id: r.category, label: titleCaseLocal(r.category) });
      }
    }
    return out;
  }, [userRules, customCats, catLabelOverrides]);

  // localize builtin RULE_CATEGORIES labels via the
  // existing rules.cat.* keys so the group filter pills + section
  // headers flip pt↔en. Customs (no key in strings.ts) fall through to
  // their stored label.
  const groups = useMemo<TaxonomyGroup[]>(
    () =>
      categories.map((c) => {
        const k = `rules.cat.${c.id}`;
        const localized = t(k);
        return {
          id: c.id,
          label: localized === k ? c.label : localized,
          hint: c.hint,
        };
      }),
    [categories, t, lang],
  );

  const items = useMemo<RuleItem[]>(
    () =>
      allRules.map((r) =>
        toItem(r, r.builtin && Boolean(overrides[r.id]), !disabled.has(r.id), lang),
      ),
    [allRules, overrides, disabled, lang],
  );

  // ─── Mutators ────────────────────────────────────────────────────────

  const handleToggle = async (id: string, next: boolean) => {
    setDisabled((prev) => {
      const out = new Set(prev);
      if (next) out.delete(id);
      else out.add(id);
      setDisabledRuleIds([...out]);
      void persistDisabled(out);
      return out;
    });
  };

  const handleSave = async (
    rule: Rule,
    patch: Partial<Pick<Rule, "title" | "description" | "category">>,
  ) => {
    if (rule.builtin) {
      const next = { ...overrides };
      next[rule.id] = { ...(next[rule.id] ?? {}), ...patch };
      setOverrides(next);
      await persistOverrides(next);
    } else {
      const next = userRules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r));
      setUserRulesState(next);
      await persistUserRules(next);
    }
  };

  const handleDelete = async (rule: Rule) => {
    if (rule.builtin) return;
    const next = userRules.filter((r) => r.id !== rule.id);
    setUserRulesState(next);
    await persistUserRules(next);
  };

  const handleDeleteBuiltinPermanent = async (rule: Rule) => {
    if (!rule.builtin) return;
    const out = new Set(hiddenBuiltins);
    out.add(rule.id);
    setHiddenBuiltins(out);
    await persistHiddenBuiltinRules(out);
  };

  const handleBulkHideBuiltins = async (ids: string[]) => {
    const builtinIds = ids.filter((id) => DEFAULT_BUILTIN_RULES.some((r) => r.id === id));
    if (builtinIds.length === 0) return;
    const out = new Set(hiddenBuiltins);
    for (const id of builtinIds) out.add(id);
    setHiddenBuiltins(out);
    await persistHiddenBuiltinRules(out);
  };

  const handleBulkToggleEnabled = async (ids: string[], enable: boolean) => {
    const out = new Set(disabled);
    for (const id of ids) {
      if (enable) out.delete(id);
      else out.add(id);
    }
    setDisabled(out);
    setDisabledRuleIds([...out]);
    await persistDisabled(out);
  };

  const handleBulkMoveCategory = async (ids: string[], targetCategoryId: string) => {
    if (!targetCategoryId) return;
    // Moving builtins = creating an override; moving customs = mutating slot.
    let nextOverrides = { ...overrides };
    let nextUserRules = [...userRules];
    let touchedOverrides = false;
    let touchedUser = false;
    for (const id of ids) {
      const allId = allRules.find((r) => r.id === id);
      if (!allId) continue;
      if (allId.builtin) {
        nextOverrides[id] = { ...(nextOverrides[id] ?? {}), category: targetCategoryId };
        touchedOverrides = true;
      } else {
        nextUserRules = nextUserRules.map((r) =>
          r.id === id ? { ...r, category: targetCategoryId } : r,
        );
        touchedUser = true;
      }
    }
    if (touchedOverrides) {
      setOverrides(nextOverrides);
      await persistOverrides(nextOverrides);
    }
    if (touchedUser) {
      setUserRulesState(nextUserRules);
      await persistUserRules(nextUserRules);
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    const deletable = ids.filter((id) => userRules.some((r) => r.id === id));
    if (deletable.length === 0) return;
    const next = userRules.filter((r) => !deletable.includes(r.id));
    setUserRulesState(next);
    await persistUserRules(next);
  };

  const handleResetBuiltin = async (rule: Rule) => {
    if (!rule.builtin || !overrides[rule.id]) return;
    const next = { ...overrides };
    delete next[rule.id];
    setOverrides(next);
    await persistOverrides(next);
  };

  const handleDuplicate = async (rule: Rule) => {
    const dup: Rule = {
      id: `usr-${rule.category}-${Date.now().toString(36)}`,
      title: `${rule.title} (custom)`,
      category: rule.category,
      description: rule.description,
      builtin: false,
    };
    const next = [...userRules, dup];
    setUserRulesState(next);
    await persistUserRules(next);
  };

  const handleBulkDuplicate = async (ids: string[]) => {
    const newOnes: Rule[] = [];
    for (const id of ids) {
      const r = allRules.find((x) => x.id === id);
      if (!r) continue;
      newOnes.push({
        id: `usr-${r.category}-${Date.now().toString(36)}-${newOnes.length}`,
        title: `${r.title} (custom)`,
        category: r.category,
        description: r.description,
        builtin: false,
      });
    }
    if (newOnes.length === 0) return;
    const next = [...userRules, ...newOnes];
    setUserRulesState(next);
    await persistUserRules(next);
  };

  const handleCreate = async (rule: Rule) => {
    const next = [...userRules, rule];
    setUserRulesState(next);
    await persistUserRules(next);
    setCreateOpen(false);
  };

  // Reorder is per-category — only user rules can be reordered (builtins
  // keep their canonical order). Skip persisting reorders for now since
  // builtins are immutable; user-rule reorder would need a dedicated slot.
  // (User didn't request it explicitly for — kept as no-op.)

  // ─── Category management ───────────────────────────────────────
  const managedCategories = useMemo<ManagedCategory[]>(() => {
    const out: ManagedCategory[] = [];
    const builtinIds = new Set(RULE_CATEGORIES.map((c) => c.id));
    for (const def of RULE_CATEGORIES) {
      const overrideLabel = catLabelOverrides[def.id];
      const itemCount = items.filter((it) => it.group === def.id && it.enabled !== false).length;
      out.push({
        id: def.id,
        label: overrideLabel ?? def.label,
        builtin: true,
        itemCount,
        hasOverride: Boolean(overrideLabel && overrideLabel !== def.label),
      });
    }
    for (const cc of customCats) {
      if (builtinIds.has(cc.id)) continue;
      const itemCount = items.filter((it) => it.group === cc.id && it.enabled !== false).length;
      out.push({ id: cc.id, label: cc.label, builtin: false, itemCount });
    }
    return out;
  }, [customCats, catLabelOverrides, items]);

  const handleCatCreate = async (label: string) => {
    const id = `cat-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    const next = [...customCats, { id, label }];
    setCustomCats(next);
    await persistCustomRuleCategories(next);
  };

  const handleCatRename = async (id: string, nextLabel: string) => {
    const isBuiltin = RULE_CATEGORIES.some((c) => c.id === id);
    if (isBuiltin) {
      const next = { ...catLabelOverrides, [id]: nextLabel };
      setCatLabelOverrides(next);
      await persistCategoryLabelOverrides(next);
    } else {
      const next = customCats.map((c) => (c.id === id ? { ...c, label: nextLabel } : c));
      setCustomCats(next);
      await persistCustomRuleCategories(next);
    }
  };

  const handleCatResetBuiltin = async (id: string) => {
    if (!(id in catLabelOverrides)) return;
    const next = { ...catLabelOverrides };
    delete next[id];
    setCatLabelOverrides(next);
    await persistCategoryLabelOverrides(next);
  };

  const handleCatDelete = async (id: string) => {
    // Allow deleting custom categories with items. Cascade: rules in
    // that category get re-categorized to `_orphan` (Sem categoria) which
    // is auto-created. User reassigns them later via row's category
    // dropdown.
    const isBuiltin = RULE_CATEGORIES.some((c) => c.id === id);
    if (isBuiltin) return;

    // Cascade — re-tag rules in this category to "_orphan".
    const affected = userRules.filter((r) => r.category === id);
    if (affected.length > 0) {
      const nextRules = userRules.map((r) =>
        r.category === id ? { ...r, category: ORPHAN_CATEGORY_ID } : r,
      );
      setUserRulesState(nextRules);
      await persistUserRules(nextRules);

      // Ensure the orphan custom category exists so the picker has a
      // home for these rules.
      const orphanExists = customCats.some((c) => c.id === ORPHAN_CATEGORY_ID);
      const baseCats = customCats.filter((c) => c.id !== id);
      const nextCats = orphanExists
        ? baseCats
        : [...baseCats, { id: ORPHAN_CATEGORY_ID, label: ORPHAN_CATEGORY_LABEL }];
      setCustomCats(nextCats);
      await persistCustomRuleCategories(nextCats);
    } else {
      const next = customCats.filter((c) => c.id !== id);
      setCustomCats(next);
      await persistCustomRuleCategories(next);
    }
  };

  // ─── Import / Export / Reset ────────────────────────────────

  const previewImport = (payload: RulesExportV1): ImportPreview => {
    const existingIds = new Set(userRules.map((r) => r.id));
    const incomingIds = new Set(payload.userRules.map((r) => r.id));
    const added: string[] = [];
    const replaced: string[] = [];
    const removed: string[] = [];
    for (const r of payload.userRules) {
      if (existingIds.has(r.id)) replaced.push(r.title);
      else added.push(r.title);
    }
    for (const r of userRules) {
      if (!incomingIds.has(r.id)) removed.push(r.title);
    }
    return { added, replaced, removed };
  };

  const applyImport = async (payload: RulesExportV1, mode: "merge" | "replace") => {
    let nextUser: Rule[];
    if (mode === "replace") {
      nextUser = [...payload.userRules];
    } else {
      const byId = new Map(userRules.map((r) => [r.id, r]));
      for (const r of payload.userRules) byId.set(r.id, r);
      nextUser = [...byId.values()];
    }
    setUserRulesState(nextUser);
    await persistUserRules(nextUser);

    const nextOverrides =
      mode === "replace"
        ? { ...payload.builtinOverrides }
        : { ...overrides, ...payload.builtinOverrides };
    setOverrides(nextOverrides);
    await persistOverrides(nextOverrides);

    const nextDisabled = new Set(mode === "replace" ? [] : [...disabled]);
    for (const id of payload.disabledIds ?? []) nextDisabled.add(id);
    setDisabled(nextDisabled);
    setDisabledRuleIds([...nextDisabled]);
    await persistDisabled(nextDisabled);

    const nextCustomCats =
      mode === "replace"
        ? [...payload.customRuleCategories]
        : (() => {
            const byId = new Map(customCats.map((c) => [c.id, c]));
            for (const c of payload.customRuleCategories ?? []) byId.set(c.id, c);
            return [...byId.values()];
          })();
    setCustomCats(nextCustomCats);
    await persistCustomRuleCategories(nextCustomCats);

    const nextLabelOverrides =
      mode === "replace"
        ? { ...payload.categoryLabelOverrides }
        : { ...catLabelOverrides, ...payload.categoryLabelOverrides };
    setCatLabelOverrides(nextLabelOverrides);
    await persistCategoryLabelOverrides(nextLabelOverrides);

    const nextHidden = new Set(mode === "replace" ? [] : [...hiddenBuiltins]);
    for (const id of payload.hiddenBuiltinRuleIds ?? []) nextHidden.add(id);
    setHiddenBuiltins(nextHidden);
    await persistHiddenBuiltinRules(nextHidden);
  };

  const handleResetAll = async () => {
    setUserRulesState([]);
    await persistUserRules([]);
    setOverrides({});
    await persistOverrides({});
    const empty = new Set<string>();
    setDisabled(empty);
    setDisabledRuleIds([]);
    await persistDisabled(empty);
    setCustomCats([]);
    await persistCustomRuleCategories([]);
    setCatLabelOverrides({});
    await persistCategoryLabelOverrides({});
    setHiddenBuiltins(empty);
    await persistHiddenBuiltinRules(empty);
  };

  // ImportExportControls slot removed 2026-05-21 — handlers/exports
  // preserved for future surfaces. Silence TS6133 while they sit idle.
  void previewImport;
  void applyImport;
  void handleResetAll;
  void buildRulesExport;
  void parseRulesImport;
  void ImportExportControls;

  return (
    <>
      <TaxonomyManager<RuleItem>
        kicker={t("settings.rules.kicker")}
        title={t("settings.rules.title")}
        description={t("settings.rules.desc")}
        hideHero
        showSelectCheckboxes
        items={items}
        groups={groups}
        groupFilter={groupFilter}
        onGroupFilterChange={setGroupFilter}
        searchPlaceholder={t("settings.rules.search")}
        createLabel={t("settings.rules.create")}
        emptyTitle={t("settings.rules.empty.search")}
        emptyBody={t("settings.rules.empty.search.body")}
        emptyAllTitle={t("settings.rules.empty.all.title")}
        emptyAllBody={t("settings.rules.empty.all.body")}
        onCreate={() => setCreateOpen(true)}
        onToggleEnabled={(id, on) => void handleToggle(id, on)}
        onDelete={(ids) => void handleBulkDelete(ids)}
        onDuplicate={(ids) => void handleBulkDuplicate(ids)}
        onBulkToggleEnabled={(ids, enable) => void handleBulkToggleEnabled(ids, enable)}
        onBulkHideBuiltins={(ids) => void handleBulkHideBuiltins(ids)}
        onBulkMoveCategory={(ids, target) => void handleBulkMoveCategory(ids, target)}
        onManageCategories={() => setCatManagerOpen(true)}
        manageCategoriesLabel={t("settings.padroes.cats.manage")}
        /* toolbarTopSlot removed 2026-05-21 — user ask: "remove
           Exportar / Importar / Resetar tudo". */
        renderDetail={({ item }) => (
          <DetailForm
            item={item}
            allItems={items}
            categories={categories}
            onSave={handleSave}
            onDelete={handleDelete}
            onDeleteBuiltinPermanent={handleDeleteBuiltinPermanent}
            onResetBuiltin={handleResetBuiltin}
            onDuplicate={handleDuplicate}
            onToggleEnabled={(id, on) => void handleToggle(id, on)}
          />
        )}
      />
      <RuleCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      <PadroesCategoryManager
        open={catManagerOpen}
        categories={managedCategories}
        onCreate={handleCatCreate}
        onRename={handleCatRename}
        onResetBuiltin={handleCatResetBuiltin}
        onDelete={handleCatDelete}
        onClose={() => setCatManagerOpen(false)}
      />
    </>
  );
}

function titleCaseLocal(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
