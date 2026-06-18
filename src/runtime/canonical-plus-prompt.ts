// canonical-plus-prompt.ts — builds the system-prompt block that
// carries the user's "canonical+" choices (Format / Rules / Taste)
// into every turn of a project.
//
// User ask 2026-05-11: "vamos garantir que [tweaks, formats, rules]
// estão sendo injetados no prompt inicial do projeto/sessão, assim
// como design.md, skills etc". Previously the NewProject modal
// collected these via the canonical+ form (rules array, format
// selection, 6 taste dials) and shoved them into
// `extras.canonicalPlus`, but downstream the payload was discarded —
// only `rawPrompt` survived. So the dials, format pick, and rules
// were decorative: the user spent 30s configuring a project and the
// agent received the bare prompt.
//
// This module is the missing link: a pure builder that takes the
// canonicalPlus payload + taxonomy lookups and returns a markdown
// block that EditorScreen forwards to the turn pipeline as
// `preambleExtras`. The pipeline appends it to the system prompt
// alongside the workspace preamble and the design system markdown.

import { getEffectiveRules } from "@/data/rules-taxonomy";
import { getEffectiveFormatTaxonomy } from "@/data/format-taxonomy";
import { ruleTitle, ruleDescription } from "@/i18n/builtin-labels";
import { getLang } from "@/i18n/index";

export interface CanonicalPlusInput {
  /** Format selection from the picker. Null when the user didn't pick. */
  format?: { categoryId: string; itemId: string } | null;
  /** Rule ids selected from the picker. Looked up against the
   *  effective rules catalog (builtins + overrides + user rules). */
  rules?: string[];
  /** 6 dial values (0..100). Only the ones the user moved away from 50
   *  end up here (tasteActive). Neutral dials are omitted. */
  taste?: Partial<{
    density: number;
    motion: number;
    contrast: number;
    interactions: number;
    surface: number;
    originality: number;
  }>;
}

// Dial type + phrase catalog moved to `src/data/dials-taxonomy.ts`
// (2026-05-18 defaults canonicalisation — one of the 7 canonical
// categories). Re-exported here for back-compat: existing callers
// that import { DEFAULT_DIAL_LANGUAGE, DialKey, DialDirection,
// DIAL_KEYS, DIAL_STOPS } from canonical-plus-prompt still work.
import {
  DEFAULT_BUILTIN_DIALS,
  DIAL_KEYS as DIAL_KEYS_TAXONOMY,
  DIAL_STOPS as DIAL_STOPS_TAXONOMY,
  type DialDirection as DialDirectionTaxonomy,
  type DialKey as DialKeyTaxonomy,
} from "@/data/dials-taxonomy";

export type DialDirection = DialDirectionTaxonomy;
export type DialKey = DialKeyTaxonomy;
export const DEFAULT_DIAL_LANGUAGE = DEFAULT_BUILTIN_DIALS;
export const DIAL_KEYS = DIAL_KEYS_TAXONOMY;
export const DIAL_STOPS = DIAL_STOPS_TAXONOMY;

function dialPhrase(
  key: DialKey,
  value: number,
  overrides?: Partial<Record<DialKey, Partial<DialDirection>>>,
): string | null {
  const baseline = DEFAULT_DIAL_LANGUAGE[key];
  const override = overrides?.[key];
  // Bins (see DIAL_STOPS): neutral 38-62 returns null.
  let stop: keyof DialDirection | null = null;
  if (value < 10) stop = "extremeLow";
  else if (value < 38) stop = "softLow";
  else if (value <= 62) stop = null;
  else if (value <= 89) stop = "softHigh";
  else stop = "extremeHigh";
  if (!stop) return null;
  return override?.[stop] ?? baseline[stop];
}

/**
 * Build the canonical+ block. Returns "" when the input has nothing
 * worth saying (no format, no rules, all dials neutral). When
 * non-empty, the result starts with "## Project setup" and is safe
 * to drop into a system prompt as-is.
 *
 * `dialOverrides` lets the user customise low/high phrasing per
 * dial via Settings → Taste — the editor persists strings into
 * db.settings and EditorScreen forwards them on each turn.
 */
export function buildCanonicalPlusBlock(
  input: CanonicalPlusInput,
  dialOverrides?: Partial<Record<DialKey, Partial<DialDirection>>>,
): string {
  const sections: string[] = [];

  // ── Format
  if (input.format) {
    const item = lookupFormatItem(input.format.categoryId, input.format.itemId);
    if (item) {
      const formatText = item.prompt?.trim() || item.descriptor?.trim();
      if (formatText) {
        sections.push(`### Format · ${item.label}\n${formatText}`);
      }
    }
  }

  // ── Rules
  // User ask 2026-05-21: rules carry bilingual entries (PT + EN)
  // in src/i18n/builtin-labels.ts. Pick the localized title +
  // description before injecting into the system prompt so the model
  // receives the constraint in the same language the user is writing
  // in. The shipped builtin rule object still carries the EN canonical
  // value as fallback for any id missing from the i18n table (e.g.,
  // user-authored rules).
  if (input.rules && input.rules.length > 0) {
    const effective = getEffectiveRules();
    const byId = new Map(effective.map((r) => [r.id, r]));
    const lang = getLang();
    const lines: string[] = [];
    for (const id of input.rules) {
      const rule = byId.get(id);
      if (!rule) continue;
      const localizedTitle = ruleTitle(rule, lang);
      const localizedBody = ruleDescription(rule, lang).trim();
      if (localizedBody) lines.push(`- **${localizedTitle}** — ${localizedBody}`);
      else lines.push(`- **${localizedTitle}**`);
    }
    if (lines.length > 0) {
      sections.push(`### Constraints\n${lines.join("\n")}`);
    }
  }

  // ── Taste (only non-neutral dials)
  if (input.taste) {
    const tasteLines: string[] = [];
    DIAL_KEYS.forEach((key) => {
      const v = input.taste?.[key];
      if (typeof v !== "number") return;
      const phrase = dialPhrase(key, v, dialOverrides);
      if (phrase) tasteLines.push(`- ${phrase}`);
    });
    if (tasteLines.length > 0) {
      sections.push(`### Taste calibration\n${tasteLines.join("\n")}`);
    }
  }

  if (sections.length === 0) return "";
  return `## Project setup\n\n${sections.join("\n\n")}`;
}

function lookupFormatItem(categoryId: string, itemId: string) {
  const tax = getEffectiveFormatTaxonomy();
  const cat = tax.find((c) => c.id === categoryId);
  if (!cat) return null;
  return cat.items.find((i) => i.id === itemId) ?? null;
}

/**
 * Build the canonical+ COMPACT summary. Returns a 3-5 line skeleton
 * suitable for injection into the system prompt of EVERY turn.
 *
 * Why a separate summary builder: the full block (~300-600 tokens
 * worth of prose) is too heavy to repeat on each turn — auditor
 * verdict 2026-05-17 called this out as the missing piece for
 * "consolidated authority". The compact form carries the same axes
 * (Direction · Constraints · Taste) at one-tenth the cost.
 *
 * Shape (no headers, terse):
 *
 *   Direction: Landing × Hero focus
 *   Constraints: lang-match-user, no-placeholder-content
 *   Taste: dense (60), still (30), bold (75)
 *
 * Returns "" when there's nothing worth saying. Safe to drop into a
 * system prompt as-is — no leading blank line, no trailing newline.
 */
export function buildCanonicalPlusSummary(
  input: CanonicalPlusInput,
  dialOverrides?: Partial<Record<DialKey, Partial<DialDirection>>>,
): string {
  const lines: string[] = [];

  // ── Direction: "Category × Item"
  if (input.format) {
    const item = lookupFormatItem(input.format.categoryId, input.format.itemId);
    if (item) {
      const tax = getEffectiveFormatTaxonomy();
      const cat = tax.find((c) => c.id === input.format!.categoryId);
      const catLabel = cat?.label ?? input.format.categoryId;
      lines.push(`Direction: ${catLabel} × ${item.label}`);
    }
  }

  // ── Constraints: rule ids only (titles are too long for one line)
  if (input.rules && input.rules.length > 0) {
    const effective = getEffectiveRules();
    const byId = new Map(effective.map((r) => [r.id, r]));
    const ids: string[] = [];
    for (const id of input.rules) {
      if (byId.has(id)) ids.push(id);
    }
    if (ids.length > 0) {
      lines.push(`Constraints: ${ids.join(", ")}`);
    }
  }

  // ── Taste: "<adjective> (<value>)" for each non-neutral dial.
  // The adjective comes from the dial's stop label so the compact form
  // stays in sync with the full block's language.
  if (input.taste) {
    const tasteParts: string[] = [];
    DIAL_KEYS.forEach((key) => {
      const v = input.taste?.[key];
      if (typeof v !== "number") return;
      const stop = stopForValue(v);
      if (!stop) return;
      // Prefer a user override's first word (e.g. user customised
      // density.softHigh to "Generous breathing room with stronger
      // hierarchy" → "Generous"). Falls back to the static adjective
      // map. Keeps the summary in sync with Settings → Taste edits.
      const override = dialOverrides?.[key]?.[stop];
      const adjective =
        (override?.split(/\s+/)[0] ?? "").trim().toLowerCase() || stopAdjective(key, stop);
      if (adjective) tasteParts.push(`${adjective} (${v})`);
    });
    if (tasteParts.length > 0) {
      lines.push(`Taste: ${tasteParts.join(", ")}`);
    }
  }

  if (lines.length === 0) return "";
  return `Project Direction Summary\n${lines.join("\n")}`;
}

export interface CanonicalPlusChips {
  /** Resolved format item label (e.g. "Landing page"), or null. */
  format: string | null;
  /** Number of selected rules. */
  rulesCount: number;
  /** Number of non-neutral taste dials. */
  tasteCount: number;
}

/** Compact metadata for rendering removable chips (Format / Rules / Taste)
 *  in the chat composer. Keeps the taxonomy lookups in this module instead
 *  of leaking them into EditorScreen. */
export function describeCanonicalPlus(input: CanonicalPlusInput): CanonicalPlusChips {
  let format: string | null = null;
  if (input.format) {
    const item = lookupFormatItem(input.format.categoryId, input.format.itemId);
    if (item) format = item.label;
  }
  const rulesCount = input.rules?.length ?? 0;
  let tasteCount = 0;
  if (input.taste) {
    DIAL_KEYS.forEach((key) => {
      const v = input.taste?.[key];
      if (typeof v === "number" && stopForValue(v)) tasteCount += 1;
    });
  }
  return { format, rulesCount, tasteCount };
}

// Internal helpers for the summary form. The full block uses whole
// phrases; the summary just needs one adjective per (dial, stop).
function stopForValue(value: number): keyof DialDirection | null {
  if (value < 10) return "extremeLow";
  if (value < 38) return "softLow";
  if (value <= 62) return null;
  if (value <= 89) return "softHigh";
  return "extremeHigh";
}

const STOP_ADJECTIVE: Record<DialKey, Record<keyof DialDirection, string>> = {
  density: { extremeLow: "empty", softLow: "spacious", softHigh: "layered", extremeHigh: "dense" },
  motion: { extremeLow: "inert", softLow: "quiet", softHigh: "animated", extremeHigh: "kinetic" },
  contrast: { extremeLow: "whisper", softLow: "muted", softHigh: "bold", extremeHigh: "electric" },
  interactions: {
    extremeLow: "static",
    softLow: "restrained",
    softHigh: "playful",
    extremeHigh: "tactile",
  },
  surface: {
    extremeLow: "paper",
    softLow: "flat",
    softHigh: "textured",
    extremeHigh: "skeuomorphic",
  },
  originality: {
    extremeLow: "strict",
    softLow: "conventional",
    softHigh: "authorial",
    extremeHigh: "experimental",
  },
};

function stopAdjective(key: DialKey, stop: keyof DialDirection): string {
  return STOP_ADJECTIVE[key]?.[stop] ?? "";
}
