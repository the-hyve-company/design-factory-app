// RuleCreateModal.tsx — inline rule creation surface.
//
// Triggered from RulesModal footer ("+ Nova regra"). Mirrors the hyve-taste
// authoring shape: title (required) + category (existing select OR new
// custom string) + optional 1-line description.
//
// Persistence is delegated to onCreate — RulesModal forwards to its own
// onCreateRule prop, which is wired to claude-bridge writeGlobalConfig in
// the Settings layer.

import { useEffect, useMemo, useState } from "react";
import { DfModal } from "@/components/DfModal";
import {
  RULE_CATEGORIES,
  generateUserRuleId,
  getEffectiveCategories,
  type Rule,
} from "@/data/rules-taxonomy";
import { useT } from "@/i18n";

interface RuleCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (rule: Rule) => Promise<void> | void;
}

const NEW_CAT_VALUE = "__new__";

export function RuleCreateModal({ open, onClose, onCreate }: RuleCreateModalProps) {
  const { t } = useT();
  const categories = useMemo(() => getEffectiveCategories(), [open]);
  const [title, setTitle] = useState("");
  const [categoryChoice, setCategoryChoice] = useState<string>("custom");
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setCategoryChoice("custom");
    setNewCategory("");
    setDescription("");
    setError(null);
    setSubmitting(false);
  }, [open]);

  const isNewCategory = categoryChoice === NEW_CAT_VALUE;
  const effectiveCategory = isNewCategory
    ? newCategory
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
    : categoryChoice;

  const canSubmit = title.trim().length > 0 && effectiveCategory.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    const rule: Rule = {
      id: generateUserRuleId(effectiveCategory),
      title: title.trim(),
      category: effectiveCategory,
      description: description.trim() || undefined,
      builtin: false,
    };
    try {
      setSubmitting(true);
      await onCreate(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <DfModal
      open={open}
      onClose={onClose}
      size="md"
      className="dmv2-modal"
      head={
        <header className="dmv2-head">
          <div className="dmv2-head-text">
            <span className="dmv2-eyebrow">{t("rules.new.eyebrow")}</span>
            <h2 className="dmv2-title">{t("rules.new.title")}</h2>
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
          <span className="dmv2-foot-stat">
            {error ? (
              <span style={{ color: "var(--df-accent-danger)" }}>{error}</span>
            ) : (
              t("rules.new.foot.cmd")
            )}
          </span>
          <div className="dmv2-foot-actions">
            <button type="button" className="dmv2-btn-text" onClick={onClose} disabled={submitting}>
              {t("rules.new.cancel")}
            </button>
            <button
              type="button"
              className="dmv2-btn-primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitting ? t("rules.new.saving") : t("rules.new.save")}
            </button>
          </div>
        </div>
      }
    >
      <div className="rcm-form" onKeyDown={handleKeyDown}>
        <div className="rcm-row">
          <label className="rcm-label" htmlFor="rcm-title">
            {t("rules.new.title.label")}
          </label>
          <input
            id="rcm-title"
            className="rcm-input"
            type="text"
            placeholder={t("rules.new.title.placeholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>

        <div className="rcm-row">
          <label className="rcm-label" htmlFor="rcm-cat">
            {t("rules.new.cat.label")}
          </label>
          <select
            id="rcm-cat"
            className="rcm-select"
            value={categoryChoice}
            onChange={(e) => setCategoryChoice(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            {/* Allow user to spawn a new category. */}
            {!RULE_CATEGORIES.some((rc) => rc.id === NEW_CAT_VALUE) && (
              <option value={NEW_CAT_VALUE}>{t("rules.new.cat.new")}</option>
            )}
          </select>
        </div>

        {isNewCategory && (
          <div className="rcm-row">
            <label className="rcm-label" htmlFor="rcm-newcat">
              {t("rules.new.newcat.label")}
            </label>
            <input
              id="rcm-newcat"
              className="rcm-input"
              type="text"
              placeholder={t("rules.new.newcat.placeholder")}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              spellCheck={false}
            />
            <span className="rcm-help">{t("rules.new.newcat.help")}</span>
          </div>
        )}

        <div className="rcm-row">
          <label className="rcm-label" htmlFor="rcm-desc">
            {t("rules.new.desc.label")}
          </label>
          <input
            id="rcm-desc"
            className="rcm-input"
            type="text"
            placeholder={t("rules.new.desc.placeholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            spellCheck={false}
            maxLength={120}
          />
        </div>
      </div>
    </DfModal>
  );
}
