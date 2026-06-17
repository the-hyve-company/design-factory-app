// rules-taxonomy.ts — Unified Rules catalog (replaces Direction taxonomy).
//
// Schema: a FLAT list of Rule. Categories are computed at runtime
// from the `category` string. DF ships with ~50 high-impact visual
// builtin rules; users add more via the Padrões UI
// (id + title + category + description).
//
// Previous schema (direction-taxonomy.ts) used nested
// categories[].items[]; the flat list collapses that into a single
// dimension that's easier to filter, search and override.
//
// Selection schema in NewProjectFormPayload.rules:
//   string[]  ← flat array of rule ids

import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────

export interface Rule {
  /** Stable id — kebab-case. Builtins use a 2-letter category prefix
   *  (`as-`, `ly-`, `ty-`, `co-`, `de-`, `mo-`, `im-`, `ic-`, `fo-`, `st-`). */
  id: string;
  /** Short human-readable title. Shown in row + chips. */
  title: string;
  /** Category id — used to group rows in the modal. */
  category: string;
  /** 1-line helper. Optional. */
  description?: string;
  /** True for rules shipped with DF (cannot be deleted, can be edited). */
  builtin: boolean;
}

export interface RuleCategoryMeta {
  id: string;
  label: string;
  /** Optional one-liner shown beside the engrave label. */
  hint?: string;
}

// ─── Schemas (Zod) ────────────────────────────────────────────────────

export const RuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  builtin: z.boolean(),
});

export const RuleArraySchema = z.array(RuleSchema);

// ─── Category metadata ────────────────────────────────────────────────
// Order here defines the order they appear in the modal.

export const RULE_CATEGORIES: ReadonlyArray<RuleCategoryMeta> = Object.freeze([
  { id: "anti-slop", label: "Anti-slop", hint: "explicit don'ts" },
  { id: "layout", label: "Layout", hint: "structure & spacing" },
  { id: "typography", label: "Typography", hint: "type & numerals" },
  { id: "color", label: "Color", hint: "palette intent" },
  { id: "depth", label: "Depth", hint: "elevation & edges" },
  { id: "motion", label: "Motion", hint: "how it moves" },
  { id: "imagery", label: "Imagery", hint: "photos & media" },
  { id: "icons", label: "Icons", hint: "iconography" },
  { id: "forms", label: "Forms", hint: "inputs & controls" },
  { id: "states", label: "States", hint: "interaction states" },
  { id: "custom", label: "Custom", hint: "your additions" },
]);

// ─── Defaults — 50 visual-taste builtin rules ─────────────────────────
//
// 50 brand-agnostic VISUAL taste defaults across 10 categories.
// No copy/voice/process rules; nothing tied to any specific brand.
//
// Each `description` is a short 1-2 sentence mini-prompt (problem to
// avoid, then the concrete move) concatenated into the system prompt
// when the rule is enabled. Keep ids kebab-case with a 2-letter
// category prefix (as/ly/ty/co/de/mo/im/ic/fo/st). `title` is the
// picker-row label only; PT+EN copy lives in i18n/builtin-labels.ts
// and the EN here must match the EN title there.
export const DEFAULT_BUILTIN_RULES: ReadonlyArray<Rule> = Object.freeze([
  // ─── Anti-slop ─────────────────────────────────────────────────────
  {
    id: "as-no-decorative-emojis",
    title: "No decorative emojis",
    category: "anti-slop",
    description:
      "Colored emojis used as icons or bullets (🚀⚡✨🔥) pull an interface toward casual chat and read as a default-template tell. Carry meaning through type weight and a consistent monochrome icon set instead.",
    builtin: true,
  },
  {
    id: "as-no-invented-decoration",
    title: "No invented decoration",
    category: "anti-slop",
    description:
      "Gradients, glows, blurs, particle fields, and animated backgrounds added for their own sake date a design and fight the content. Reach for an effect only when it earns its place — otherwise let type, spacing, and a restrained palette carry it.",
    builtin: true,
  },
  {
    id: "as-no-generic-ai-gradient",
    title: "No generic AI gradient",
    category: "anti-slop",
    description:
      "The violet-to-blue hero gradient is an instant template tell. If a gradient earns its place, build it from colors already in the palette and keep the hue shift small and intentional.",
    builtin: true,
  },
  {
    id: "as-no-default-glassmorphism",
    title: "No default glassmorphism",
    category: "anti-slop",
    description:
      "Frosted, semi-transparent blur on every surface is a dated default that hurts legibility. Use solid, opaque surfaces unless the blur genuinely communicates layering over content behind it.",
    builtin: true,
  },
  {
    id: "as-no-effect-stacking",
    title: "No stacked effects",
    category: "anti-slop",
    description:
      "Piling shadow plus gradient plus blur plus border plus glow onto one element reads as over-designed and muddy. Pick one treatment per element and let it do the work.",
    builtin: true,
  },
  // ─── Layout & composition ──────────────────────────────────────────
  {
    id: "ly-generous-spacing",
    title: "Generous, consistent spacing",
    category: "layout",
    description:
      "Cramped, uneven spacing is the fastest way to look unfinished. Give elements room to breathe and use one consistent spacing rhythm — whitespace is structure, not wasted space.",
    builtin: true,
  },
  {
    id: "ly-no-card-bars",
    title: "No card bars or accents",
    category: "layout",
    description:
      "A colored bar stuck on the top or side of a card adds no information and dates the design (the 2019-dashboard look). Signal hierarchy or status with the card's own content — a stronger heading, a small status dot, a tinted background.",
    builtin: true,
  },
  {
    id: "ly-dont-center-everything",
    title: "Don't center everything",
    category: "layout",
    description:
      "Centering all text and content blocks by default is a tell and makes long copy hard to scan. Left-align body text and content; reserve centering for short, deliberate moments like a hero or an empty state.",
    builtin: true,
  },
  {
    id: "ly-consistent-alignment-edges",
    title: "Consistent alignment edges",
    category: "layout",
    description:
      "Elements that don't share alignment lines read as careless. Align to a small set of shared edges or a grid so columns, labels, and content snap to the same verticals.",
    builtin: true,
  },
  {
    id: "ly-proximity-grouping",
    title: "Group by proximity",
    category: "layout",
    description:
      "Related items belong close together; unrelated ones need a clear gap. Use spacing to group and separate before reaching for borders or boxes — proximity does most of the structural work.",
    builtin: true,
  },
  {
    id: "ly-clear-hierarchy",
    title: "One clear focal point",
    category: "layout",
    description:
      "When everything competes for attention, nothing wins. Establish one primary element per screen and let size, weight, and spacing make the reading order obvious.",
    builtin: true,
  },
  {
    id: "ly-optical-alignment",
    title: "Optical alignment",
    category: "layout",
    description:
      "Mathematically centered isn't always visually centered — icons with descenders, triangles, and play glyphs look off. Trust the eye and nudge until it reads aligned rather than relying on geometric centering alone.",
    builtin: true,
  },
  // ─── Typography ────────────────────────────────────────────────────
  {
    id: "ty-limited-type-scale",
    title: "Limited type scale",
    category: "typography",
    description:
      "Many ad-hoc font sizes make a layout read as assembled rather than designed. Pick a small set of sizes with clear jumps between them and reuse it — hierarchy comes from deliberate contrast, not a new size per element.",
    builtin: true,
  },
  {
    id: "ty-tabular-figures",
    title: "Tabular figures for numbers",
    category: "typography",
    description:
      "Proportional digits shift left and right between rows, so numbers in tables, prices, and counters won't line up. Use tabular figures (font-variant-numeric: tabular-nums) anywhere digits need to align in columns.",
    builtin: true,
  },
  {
    id: "ty-comfortable-measure",
    title: "Comfortable measure & leading",
    category: "typography",
    description:
      "Lines that run too long are hard to read and tight leading makes paragraphs feel cramped. Cap body line length around 45-75 characters and give body text generous line-height; tighten leading only on large display type.",
    builtin: true,
  },
  {
    id: "ty-one-or-two-typefaces",
    title: "One or two typefaces",
    category: "typography",
    description:
      "A font zoo fragments the design. Use one typeface, or at most a display face paired with a text face, and create variety with weight and size instead of more families.",
    builtin: true,
  },
  {
    id: "ty-weight-for-hierarchy",
    title: "Weight for hierarchy, not color",
    category: "typography",
    description:
      "Reaching for color or ALL CAPS to mark importance clutters the palette and hurts readability. Drive hierarchy with size and weight first; color is an accent, not a heading system.",
    builtin: true,
  },
  {
    id: "ty-no-justify-long-text",
    title: "Don't justify long text",
    category: "typography",
    description:
      "Justified text on the web opens uneven rivers of whitespace because browsers lack fine hyphenation. Left-align body copy (ragged right) for even word spacing and a steadier read.",
    builtin: true,
  },
  {
    id: "ty-tracking-by-size",
    title: "Tracking by size",
    category: "typography",
    description:
      "Default letter-spacing rarely fits every size. Tighten tracking slightly on large headings, leave body text at normal, and open it up for small uppercase labels so each reads cleanly.",
    builtin: true,
  },
  // ─── Color ─────────────────────────────────────────────────────────
  {
    id: "co-honor-existing-palette",
    title: "Honor the existing palette",
    category: "color",
    description:
      "Introducing a fresh hue for every new component fragments the design until nothing reads as one system. Build from the palette already in play — derive tints and shades from existing hues rather than adding orphan colors.",
    builtin: true,
  },
  {
    id: "co-no-raw-black",
    title: "Soften pure black & white",
    category: "color",
    description:
      "Pure black (#000) and pure white (#fff) feel harsh and flat against real content — they crush shadow detail and read as unconsidered. Soften slightly toward a near-black and a near-white so surfaces feel intentional.",
    builtin: true,
  },
  {
    id: "co-accent-sparingly",
    title: "Accent color sparingly",
    category: "color",
    description:
      "An accent color used everywhere stops accenting anything. Spend it on the one element that should draw the eye — a primary action, an active state — and keep chrome and large surfaces neutral.",
    builtin: true,
  },
  {
    id: "co-few-colors-neutral-base",
    title: "Few colors, neutral base",
    category: "color",
    description:
      "A rainbow palette reads as chaotic and amateur. Let a neutral scale carry the bulk of the interface and treat color as the exception that marks meaning, not the default for every surface.",
    builtin: true,
  },
  {
    id: "co-semantic-colors-consistent",
    title: "Consistent semantic colors",
    category: "color",
    description:
      "Inventing a new success-green or error-red per component breaks the mental model. Define one color each for success, warning, error, and info, and reuse them everywhere those meanings appear.",
    builtin: true,
  },
  {
    id: "co-desaturate-large-fills",
    title: "Desaturate large fills",
    category: "color",
    description:
      "Fully saturated color across a big area vibrates and tires the eye. Reserve high saturation for small accents and use muted, desaturated tones for large backgrounds and fills.",
    builtin: true,
  },
  // ─── Depth & elevation ─────────────────────────────────────────────
  {
    id: "de-soft-consistent-shadows",
    title: "Soft, consistent shadows",
    category: "depth",
    description:
      "Harsh, dark drop shadows look cheap and inconsistent shadows break the sense of space. Use one elevation system with soft, diffuse shadows cast as if from a single light direction.",
    builtin: true,
  },
  {
    id: "de-hairline-borders",
    title: "Hairline, low-contrast borders",
    category: "depth",
    description:
      "Heavy black 1px borders on everything box the design in and add visual noise. Use thin, low-contrast dividers — or whitespace — and keep border weight consistent across the UI.",
    builtin: true,
  },
  {
    id: "de-consistent-radius",
    title: "Consistent corner radius",
    category: "depth",
    description:
      "Mixing sharp corners, small radii, and full pills at random looks accidental. Pick one radius scale and apply it by component role — and keep nested radii visually concentric.",
    builtin: true,
  },
  {
    id: "de-layering-restraint",
    title: "Restrained layering",
    category: "depth",
    description:
      "When every element floats on its own shadow, depth loses meaning and the screen feels busy. Keep elevation levels few and intentional — most content sits flat on the surface.",
    builtin: true,
  },
  // ─── Motion ────────────────────────────────────────────────────────
  {
    id: "mo-motion-serves-meaning",
    title: "Motion serves meaning",
    category: "motion",
    description:
      "Animation that loops or fires with no reason reads as nervous noise. Use motion to show a state change — something appeared, loaded, or moved — so every animation is legible from a single still frame.",
    builtin: true,
  },
  {
    id: "mo-no-decorative-spinners",
    title: "No decorative spinners",
    category: "motion",
    description:
      "A permanent spinner on an idle surface reads as broken and trains people to ignore real loading states. Reserve indefinite spinners for genuine in-progress work; for visual interest use a subtle static treatment.",
    builtin: true,
  },
  {
    id: "mo-honor-reduced-motion",
    title: "Honor reduced motion",
    category: "motion",
    description:
      "Parallax, slide-ins, and autoplay motion are uncomfortable or painful for some people. Honor the reduced-motion preference: keep essential feedback and offer a still or quick cross-fade fallback for the rest.",
    builtin: true,
  },
  {
    id: "mo-quick-subtle-timing",
    title: "Quick, subtle timing",
    category: "motion",
    description:
      "Slow, bouncy default transitions make an interface feel sluggish. Keep UI motion short (around 150-250ms) with a consistent ease-out curve so it feels responsive rather than theatrical.",
    builtin: true,
  },
  {
    id: "mo-restrained-entrances",
    title: "Restrained entrances",
    category: "motion",
    description:
      "Animating everything on load creates a distracting cascade. Animate the entrance of genuinely new content only, and use a light stagger just where it helps reveal reading order.",
    builtin: true,
  },
  // ─── Imagery ───────────────────────────────────────────────────────
  {
    id: "im-preserve-aspect-ratio",
    title: "Preserve aspect ratio",
    category: "imagery",
    description:
      "Stretched or squashed images look amateur instantly. Preserve the original aspect ratio and use object-fit (cover or contain) to fit a frame — crop deliberately rather than distort.",
    builtin: true,
  },
  {
    id: "im-consistent-treatment",
    title: "Consistent image treatment",
    category: "imagery",
    description:
      "A set of images with different ratios, corner radii, and color grades reads as a pile, not a system. Apply the same ratio, radius, and treatment across a group so it feels intentional.",
    builtin: true,
  },
  {
    id: "im-overlay-for-legibility",
    title: "Overlay for text on images",
    category: "imagery",
    description:
      "Text laid directly over a photo usually fails contrast somewhere in the image. Add a scrim, gradient, or tint behind the text so it stays readable across the whole image, light areas included.",
    builtin: true,
  },
  {
    id: "im-avoid-generic-stock",
    title: "Avoid generic stock",
    category: "imagery",
    description:
      "Generic, low-resolution stock photos cheapen a design. Prefer real, sharp, on-topic imagery — and when you don't have it, a clean illustration, pattern, or solid surface beats filler stock.",
    builtin: true,
  },
  // ─── Icons ─────────────────────────────────────────────────────────
  {
    id: "ic-consistent-set-weight",
    title: "Consistent icon set",
    category: "icons",
    description:
      "Mixing icon families, or filled and outline styles at random, looks careless. Use a single icon set with one consistent stroke weight so icons read as siblings.",
    builtin: true,
  },
  {
    id: "ic-size-align-to-text",
    title: "Size & align icons to text",
    category: "icons",
    description:
      "Icons that don't match their label's size or baseline look bolted on. Size icons relative to adjacent text and align them optically to the text baseline or center.",
    builtin: true,
  },
  {
    id: "ic-icons-clarify-not-decorate",
    title: "Icons clarify, not decorate",
    category: "icons",
    description:
      "An icon on every line becomes noise and slows scanning. Use icons where they speed recognition, pair them with a label when the meaning is ambiguous, and drop them where text alone is clearer.",
    builtin: true,
  },
  // ─── Forms & controls ──────────────────────────────────────────────
  {
    id: "fo-clear-input-affordance",
    title: "Inputs look editable",
    category: "forms",
    description:
      "Borderless, flat fields leave people unsure what's clickable. Give inputs a clear affordance — a visible border or filled background, enough internal padding, and an obvious focus state.",
    builtin: true,
  },
  {
    id: "fo-label-above-or-clear",
    title: "Keep a visible label",
    category: "forms",
    description:
      "Placeholder-only fields lose their label the moment someone types and hurt accessibility. Keep a persistent visible label above or beside each field; use placeholder text only for format hints.",
    builtin: true,
  },
  {
    id: "fo-generous-touch-targets",
    title: "Generous touch targets",
    category: "forms",
    description:
      "Tiny, tightly-packed controls are hard to hit, especially on touch. Give interactive targets at least ~44px of hit area and enough space between them to avoid mis-taps.",
    builtin: true,
  },
  {
    id: "fo-align-fields",
    title: "Align form fields",
    category: "forms",
    description:
      "Fields of random widths and misaligned labels make a form feel chaotic. Align labels and inputs to a shared column and size each field to the length of content it expects.",
    builtin: true,
  },
  // ─── States & interaction ──────────────────────────────────────────
  {
    id: "st-visible-focus",
    title: "Visible focus state",
    category: "states",
    description:
      "Removing the focus outline strands keyboard users with no idea where they are. Keep a clear, styled focus ring on every interactive element — never remove the outline without a visible replacement.",
    builtin: true,
  },
  {
    id: "st-interactive-feedback",
    title: "Interactive feedback",
    category: "states",
    description:
      "Controls that don't react feel dead or broken. Give every clickable element visible hover, active, and pressed feedback so it confirms it can be used and that the tap registered.",
    builtin: true,
  },
  {
    id: "st-design-empty-error",
    title: "Design empty & error states",
    category: "states",
    description:
      "Shipping only the happy path leaves empty, loading, and error states looking broken. Design these states deliberately — a helpful empty state, a clear error, a calm loading placeholder.",
    builtin: true,
  },
  {
    id: "st-disabled-reads-disabled",
    title: "Disabled reads as disabled",
    category: "states",
    description:
      "A disabled control that looks active invites dead clicks, but one that vanishes confuses. Lower its contrast so it clearly reads as unavailable while staying legible and in place.",
    builtin: true,
  },
  {
    id: "st-selected-distinct-from-hover",
    title: "Selected distinct from hover",
    category: "states",
    description:
      "When the selected state looks like hover, people lose track of where they are. Make the current/selected state clearly distinct from transient hover — a different fill or marker, not just a shade.",
    builtin: true,
  },
]);

// ─── Runtime store ────────────────────────────────────────────────────
// We keep separable slots:
//   - _builtinOverrides: edits user applied to a builtin (title/desc).
//   - _userRules: user-authored rules (builtin: false).
//   - _customCategories: net-new rule categories the user created.
//   - _categoryLabelOverrides: rename overrides for builtin categories.
// Disabled builtins are not deletable but can be hidden via _disabledIds.

let _builtinOverrides: Map<
  string,
  Partial<Pick<Rule, "title" | "description" | "category">>
> = new Map();
let _userRules: Rule[] = [];
let _disabledIds: Set<string> = new Set();
let _customRuleCategories: RuleCategoryMeta[] = [];
let _categoryLabelOverrides: Map<string, string> = new Map();
// builtin rules permanently hidden from Padrões + picker; reset via
// "Resetar tudo". Distinct from _disabledIds (soft hide).
let _hiddenBuiltinRules: Set<string> = new Set();
let _hiddenBuiltinCategories: Set<string> = new Set();

export function getBuiltinOverrides(): Record<
  string,
  Partial<Pick<Rule, "title" | "description" | "category">>
> {
  return Object.fromEntries(_builtinOverrides);
}
export function setBuiltinOverrides(
  map: Record<string, Partial<Pick<Rule, "title" | "description" | "category">>>,
): void {
  _builtinOverrides = new Map(Object.entries(map));
}
export function getHiddenBuiltinRuleIds(): string[] {
  return [..._hiddenBuiltinRules];
}
export function setHiddenBuiltinRuleIds(ids: string[]): void {
  _hiddenBuiltinRules = new Set(ids);
}
export function getHiddenBuiltinRuleCategoryIds(): string[] {
  return [..._hiddenBuiltinCategories];
}
export function setHiddenBuiltinRuleCategoryIds(ids: string[]): void {
  _hiddenBuiltinCategories = new Set(ids);
}
export function getUserRules(): Rule[] {
  return _userRules.map((r) => ({ ...r }));
}
export function setUserRules(arr: Rule[]): void {
  // User rules slot only ever holds non-builtin rules. If any item arrives
  // with builtin: true we coerce — the data slot is the authority.
  _userRules = arr.map((r) => ({ ...r, builtin: false }));
}
export function getDisabledRuleIds(): string[] {
  return [..._disabledIds];
}
export function setDisabledRuleIds(ids: string[]): void {
  _disabledIds = new Set(ids);
}

/**
 * Effective catalog: builtins (with overrides applied) + user rules,
 * minus any disabled ids. Order: builtin order first, then user rules
 * grouped by category appearance.
 */
export function getEffectiveRules(): Rule[] {
  const out: Rule[] = [];
  for (const r of DEFAULT_BUILTIN_RULES) {
    if (_disabledIds.has(r.id)) continue;
    if (_hiddenBuiltinRules.has(r.id)) continue;
    const override = _builtinOverrides.get(r.id);
    out.push(override ? { ...r, ...override } : r);
  }
  for (const r of _userRules) {
    if (_disabledIds.has(r.id)) continue;
    out.push(r);
  }
  return out;
}

/** Effective list of category metas including user-introduced categories.
 *  applies label overrides + appends custom categories slot. */
export function getEffectiveCategories(): RuleCategoryMeta[] {
  const known = new Set(RULE_CATEGORIES.map((c) => c.id));
  const out: RuleCategoryMeta[] = RULE_CATEGORIES.map((c) => ({
    ...c,
    label: _categoryLabelOverrides.get(c.id) ?? c.label,
  }));
  for (const cc of _customRuleCategories) {
    if (!known.has(cc.id)) {
      known.add(cc.id);
      out.push({ ...cc });
    }
  }
  for (const r of _userRules) {
    if (!known.has(r.category)) {
      known.add(r.category);
      out.push({ id: r.category, label: titleCase(r.category) });
    }
  }
  return out;
}

// ─── Custom category management ──────────────────────────────────

export function getCustomRuleCategories(): RuleCategoryMeta[] {
  return _customRuleCategories.map((c) => ({ ...c }));
}
export function setCustomRuleCategories(arr: RuleCategoryMeta[]): void {
  _customRuleCategories = arr.map((c) => ({ ...c }));
}
export function getCategoryLabelOverrides(): Record<string, string> {
  return Object.fromEntries(_categoryLabelOverrides);
}
export function setCategoryLabelOverrides(map: Record<string, string>): void {
  _categoryLabelOverrides = new Map(Object.entries(map));
}

/** Group effective rules by category, preserving category order. */
export function groupRulesByCategory(): Array<{ meta: RuleCategoryMeta; rules: Rule[] }> {
  const cats = getEffectiveCategories();
  const all = getEffectiveRules();
  const byCat = new Map<string, Rule[]>();
  for (const r of all) {
    const arr = byCat.get(r.category) ?? [];
    arr.push(r);
    byCat.set(r.category, arr);
  }
  const out: Array<{ meta: RuleCategoryMeta; rules: Rule[] }> = [];
  for (const meta of cats) {
    const rules = byCat.get(meta.id);
    if (rules && rules.length > 0) out.push({ meta, rules });
  }
  return out;
}

export function findRule(id: string): Rule | null {
  return getEffectiveRules().find((r) => r.id === id) ?? null;
}

export function describeRuleSelection(ids: string[]): string {
  const total = ids.length;
  if (total === 0) return "Nenhuma regra";
  if (total === 1) {
    const found = findRule(ids[0]);
    return found ? found.title : "1 regra";
  }
  return `${total} regras`;
}

/** Total count of rules across all categories. */
export function totalRuleCount(): number {
  return getEffectiveRules().length;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Generate a stable id for a new user rule. */
export function generateUserRuleId(category: string): string {
  const safeCat =
    category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "custom";
  const stamp = Date.now().toString(36);
  return `usr-${safeCat}-${stamp}`;
}

// ─── : Export / Import / Reset helpers ─────────────────────────────

/** Snapshot for export. Forward-compat: full state of customs + overrides. */
export interface RulesExportV1 {
  schema: "df.rules.v1";
  exportedAt: string;
  userRules: Rule[];
  builtinOverrides: Record<string, Partial<Pick<Rule, "title" | "description" | "category">>>;
  disabledIds: string[];
  customRuleCategories: RuleCategoryMeta[];
  categoryLabelOverrides: Record<string, string>;
  hiddenBuiltinRuleIds: string[];
  hiddenBuiltinCategoryIds: string[];
}

export function buildRulesExport(): RulesExportV1 {
  return {
    schema: "df.rules.v1",
    exportedAt: new Date().toISOString(),
    userRules: getUserRules(),
    builtinOverrides: getBuiltinOverrides(),
    disabledIds: getDisabledRuleIds(),
    customRuleCategories: getCustomRuleCategories(),
    categoryLabelOverrides: getCategoryLabelOverrides(),
    hiddenBuiltinRuleIds: getHiddenBuiltinRuleIds(),
    hiddenBuiltinCategoryIds: getHiddenBuiltinRuleCategoryIds(),
  };
}

const RuleCategoryMetaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hint: z.string().optional(),
});

const RulesExportSchema = z.object({
  schema: z.literal("df.rules.v1"),
  exportedAt: z.string().optional(),
  userRules: z.array(RuleSchema),
  builtinOverrides: z
    .record(
      z.string(),
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
      }),
    )
    .default({}),
  disabledIds: z.array(z.string()).default([]),
  customRuleCategories: z.array(RuleCategoryMetaSchema).default([]),
  categoryLabelOverrides: z.record(z.string(), z.string()).default({}),
  hiddenBuiltinRuleIds: z.array(z.string()).default([]),
  hiddenBuiltinCategoryIds: z.array(z.string()).default([]),
});

export function parseRulesImport(raw: unknown): RulesExportV1 {
  return RulesExportSchema.parse(raw) as RulesExportV1;
}
