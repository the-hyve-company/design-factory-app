// rules-taxonomy.ts — Unified Rules catalog (replaces Direction taxonomy).
//
// Schema: a FLAT list of Rule. Categories are computed at runtime
// from the `category` string. Format mirrors hyve-taste-master rules.
// DF ships with ~30 high-impact builtin rules; users add more via
// the Padrões UI (id + title + category + description).
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
  /** Stable id — kebab-case. Builtins use `as-*`, `tn-*`, `mo-*`, etc. */
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
  { id: "tone", label: "Tone", hint: "overall feel" },
  { id: "motion", label: "Motion", hint: "how it moves" },
  { id: "color", label: "Color", hint: "palette intent" },
  { id: "language", label: "Language", hint: "primary language" },
  { id: "voice", label: "Voice", hint: "writing register" },
  { id: "layout", label: "Layout", hint: "structural intent" },
  { id: "custom", label: "Custom", hint: "your additions" },
]);

// ─── Defaults — 5 canonical builtin rules ─────────────────────────────
//
// User ask 2026-05-11: "quero limpar todas rules atuais e criar
// apenas 3 [later: 5], as melhores, com conteúdo relevante". The
// previous 30-rule catalog was scattershot trivia (em-dashes, "as an
// AI" disclosures, single-hue palettes) — none of which moved the
// needle on real HYVE output quality.
//
// The 5 below distill the load-bearing canon feedback that recurs
// across HYVE memory (no-emojis, no-card-bars, no-invented-decoration,
// skeu-premium tier-2 minimum, read-DESIGN-canon-before-tokens). Each
// description is a full mini-prompt that gets concatenated into the
// system prompt when the rule is selected — no longer a 1-line
// chip-style hint.
//
// Adding a rule: keep id kebab-case + 3-letter category prefix,
// `description` is the actual instruction text that ships to Claude,
// `title` is the picker-row label only.
// 30 default rules — user reset 2026-05-21. The previous 5 rules
// distilled HYVE-internal memory and didn't carry over to a generic
// Design Factory install. This pass replaces them with 30 globally
// useful rules, written in the same shape: a problem to avoid stated
// first, then what to do instead in concrete terms — never just "the
// opposite of the don't". Each is independent of every other rule and
// independent of the 6 taste dials (density / motion / contrast /
// interactions / surface / originality), which carry their own sliders.
//
// Adding rules: keep id kebab-case + 2-3-letter category prefix
// (as = anti-slop, tn = tone, mo = motion, co = color, ln = language,
// vo = voice, ly = layout, cu = custom). Title is the picker-row label
// only; description is the full text that ships to the model when the
// rule is enabled, so write it as a small mini-prompt with concrete
// substitutes for the banned pattern.
export const DEFAULT_BUILTIN_RULES: ReadonlyArray<Rule> = Object.freeze([
  // ─── Anti-slop ─────────────────────────────────────────────────────
  {
    id: "as-no-decorative-emojis",
    title: "No decorative emojis",
    category: "anti-slop",
    description:
      "Decorative coloured emojis (🚀⚡🔗📦🟢🔴 etc) drift product UI " +
      "and copy toward casual chat or marketing pitch, eroding the " +
      "adult, focused tone real interfaces need. Carry meaning with " +
      "careful typography (weight, size, kerning) and a consistent " +
      "monochrome line-icon set instead. Minimal technical glyphs " +
      "(✓ × → •) stay acceptable inside developer docs and specs, " +
      "where they read as notation rather than decoration.",
    builtin: true,
  },
  {
    id: "as-no-invented-decoration",
    title: "No invented decoration",
    category: "anti-slop",
    description:
      "Adding gradients, glows, blurs, cursor torches, particle " +
      "fields, or animated backgrounds without grounding in the " +
      "project's design system creates inconsistency and dates the " +
      "work the moment a real DS lands. Before reaching for a " +
      "decorative effect, check the existing tokens and components — " +
      "reuse what is already canonical, or fall back to functional " +
      "emphasis (weight change, established palette colour, motion " +
      "that signals state). When in doubt, omit; restraint reads as " +
      "confidence.",
    builtin: true,
  },
  {
    id: "as-no-placeholder-text",
    title: "No placeholder text",
    category: "anti-slop",
    description:
      'Lorem ipsum, "Feature 1/2/3", "[TODO]", "Click here", and ' +
      '"Add your content here" mark a draft as unfinished and waste ' +
      "the reader's attention. Write the actual labels and copy the " +
      'surface needs — even rough realistic text ("Inscrições abrem ' +
      'em março") beats Latin filler because it stress-tests the ' +
      "layout at real line lengths. When a slot genuinely has no " +
      "content yet, leave it empty (or marked with a data attribute " +
      "the pipeline catches) rather than ship visible filler strings.",
    builtin: true,
  },
  {
    id: "as-no-external-assets",
    title: "No external assets",
    category: "anti-slop",
    description:
      "Linking to external CDNs (`fonts.googleapis.com`, `unpkg`, " +
      "`cdn.jsdelivr`) or hotlinked images breaks the page offline, " +
      "when the CDN rotates URLs, and when the network is slow. " +
      "Inline fonts via `@font-face` with base64 data URIs, embed " +
      "small images as base64 directly in markup, and keep larger " +
      "media under the project root referenced by relative paths. " +
      "The artifact must travel as a single self-contained file (or " +
      "folder) — that is the contract.",
    builtin: true,
  },
  {
    id: "as-no-fake-data",
    title: "No fake or mock data",
    category: "anti-slop",
    description:
      '"User 1, User 2, User 3" and "$XX.XX" make outputs read as ' +
      "low-effort templates. Use plausible realistic data: real-shape " +
      'names ("Ana Reis", "Marcus Tan"), numbers that pattern like ' +
      "actual numbers (prices $24 / $89 / $1,240, not 1 / 2 / 3), " +
      'dates relative to today ("last week", "em março"). When the ' +
      "domain matters (analytics, billing), follow that domain's " +
      "conventions so the surface reads as the working product it " +
      "claims to be.",
    builtin: true,
  },
  {
    id: "as-no-ai-tells",
    title: "No AI tells in output",
    category: "anti-slop",
    description:
      '"I\'d be happy to help", "Certainly!", "As an AI", "Here\'s ' +
      'what I can do", "Let me know if you need anything else" leak ' +
      "the assistant's voice into product surfaces and make the work " +
      "feel scripted. Strip the helpful-assistant register entirely — " +
      "speak as the product or document itself. The user already " +
      "knows they're using a tool; the tool doesn't need to introduce " +
      "itself on every response.",
    builtin: true,
  },
  {
    id: "as-no-silent-fallbacks",
    title: "No silent fallbacks",
    category: "anti-slop",
    description:
      "Patterns like `catch(() => {})`, `?? defaultValue` without " +
      'logging, and "if it fails, show nothing" turn bugs into ' +
      "invisible degradation that costs days to debug. When something " +
      "fails, log the error with scope + attempted operation + actual " +
      "cause, then either surface a user-visible message or return a " +
      "typed error result the caller has to handle. Silent swallow is " +
      "acceptable only when you're filtering known-benign failures, " +
      "and the comment above the catch must say so.",
    builtin: true,
  },
  {
    id: "as-no-hedging",
    title: "No hedging in shipped output",
    category: "anti-slop",
    description:
      '"Talvez", "poderia ser", "ainda precisa de polish", "em uma ' +
      'próxima iteração", "para production-ready precisaríamos" — ' +
      "these belong in design reviews, never in the surface a real " +
      "user reads. Make the call within the constraints, ship the " +
      "best version that fits, and move on. If something is genuinely " +
      "incomplete, name it once in the commit message or changelog — " +
      "never in the user-facing output itself.",
    builtin: true,
  },
  // ─── Tone ──────────────────────────────────────────────────────────
  {
    id: "tn-read-ds-canon",
    title: "Read design system canon first",
    category: "tone",
    description:
      "Before generating any UI, palette, or component variant, read " +
      "the project's design system documentation (design.md, tokens " +
      "file, DESIGN-RULES, or equivalent). Improvising colours, " +
      "spacing scales, typography ramps, or radius values when the " +
      "canon already defines them produces output that drifts from " +
      "the rest of the product. When the project has no DS yet, " +
      "establish 3-5 canonical tokens up-front (one neutral scale, " +
      "one accent, two type sizes, two spacing units) and reuse them.",
    builtin: true,
  },
  {
    id: "tn-one-detail-earns",
    title: "One detail that earns the work",
    category: "tone",
    description:
      "Every shipped surface needs at least one detail that signals " +
      "craft rather than assembly — a micro-interaction on a primary " +
      "action, a typographic move (tabular nums on prices, optical " +
      "sizing, off-by-default ligatures kept on for headings), a " +
      "paint quality (a single considered shadow stack, a small " +
      "gradient on a highlight only), or a custom illustration " +
      "moment. The anchor should fit the surface — a settings page " +
      "doesn't need fireworks, a landing page might.",
    builtin: true,
  },
  {
    id: "tn-surgical-edits",
    title: "Surgical edits first",
    category: "tone",
    description:
      "When asked to change one thing, change only that thing — don't " +
      "refactor adjacent code, rename unrelated variables, tighten " +
      "styling outside the scope, or add features the brief didn't " +
      "ask for. Surgical edits keep diffs reviewable and respect the " +
      "implicit contract that the rest of the file works. When you " +
      "spot something else broken, file a separate follow-up — never " +
      "land it as a side effect.",
    builtin: true,
  },
  {
    id: "tn-ship-complete",
    title: "Ship complete, not chunks",
    category: "tone",
    description:
      "Deliver a working artifact — a file that opens, a demo that " +
      "runs, copy that reads end-to-end — not a partial draft with a " +
      "list of remaining items. When the scope is too large to " +
      "finish in one pass, narrow the scope: a smaller surface shipped " +
      'whole beats a larger surface half-built. "Working at smaller ' +
      'scope" is the kind of edit a maintainer can actually merge.',
    builtin: true,
  },
  {
    id: "tn-show-dont-tell",
    title: "Show, don't tell",
    category: "tone",
    description:
      "Don't describe what a feature does in copy (\"intelligent " +
      'suggestions appear as you type"); demonstrate it with the ' +
      'working interface itself. Don\'t claim a product is "fast" or ' +
      '"intuitive" — let the affordances speak. In documentation, ' +
      "lead with a runnable example, then explain why it works. The " +
      "demo carries weight; the adjective doesn't.",
    builtin: true,
  },
  // ─── Motion ────────────────────────────────────────────────────────
  {
    id: "mo-honor-reduced-motion",
    title: "Honor reduced motion",
    category: "motion",
    description:
      "Wrap all non-essential animation in `@media (prefers-reduced-" +
      "motion: reduce)` and provide either a static fallback or a " +
      "much-shorter cross-fade. Vestibular disorders make parallax, " +
      "slide-in transitions, and autoplay motion physically painful " +
      "for a meaningful fraction of users. Essential motion (loading " +
      "progress, focus rings) can stay; everything else needs a still " +
      "alternative.",
    builtin: true,
  },
  {
    id: "mo-motion-serves-meaning",
    title: "Motion serves meaning",
    category: "motion",
    description:
      "Use animation to communicate state change (something appeared, " +
      "something is loading, something moved from A to B) — not to " +
      "fill silence or decorate idle surfaces. Every animation should " +
      "be readable from a still frame: a list item slides in because " +
      "it was just added, a button shrinks on press because the user " +
      "touched it. Decorative motion that loops with no semantic " +
      "anchor turns into nervous noise.",
    builtin: true,
  },
  {
    id: "mo-no-decorative-spinners",
    title: "No infinite spinners as decoration",
    category: "motion",
    description:
      "Indefinite spinners belong on real work whose duration you " +
      "can't measure ahead of time. They don't belong on idle " +
      "surfaces — a button with a permanent spin reads as broken or " +
      "stuck, and trains users to ignore real loading states later. " +
      "When a surface needs visual interest, use a static badge, a " +
      "subtle pulse on a primary element, or content that breathes " +
      "via typography — never perpetual rotation.",
    builtin: true,
  },
  // ─── Color ─────────────────────────────────────────────────────────
  {
    id: "co-honor-existing-palette",
    title: "Honor user's existing palette",
    category: "color",
    description:
      "When the project already defines colours (tokens.css, a DS, a " +
      "brand guide), build new components from the existing scale: " +
      "derive tints, shades, and accents from the established hues " +
      'rather than introducing fresh ones. Adding "just one new ' +
      'colour" per feature fragments visual identity until nothing ' +
      "reads as a system. When you genuinely need a new hue, expand " +
      "the palette with a full scale (10 steps, light → dark) and " +
      "document it alongside the existing ones — never one orphan " +
      "value.",
    builtin: true,
  },
  {
    id: "co-wcag-aa-on-text",
    title: "WCAG AA on text",
    category: "color",
    description:
      "Body text needs at least 4.5:1 contrast against its background; " +
      "large text (≥18pt or ≥14pt bold) needs 3:1. Check actual pairs " +
      'in both light and dark themes before shipping — "looks fine ' +
      'on my screen" is not a green light. When a brand colour fails ' +
      "contrast for text, keep it as a decorative accent (a LED, a " +
      "dot, an underline) and use a higher-contrast neutral for the " +
      "actual letters.",
    builtin: true,
  },
  {
    id: "co-no-raw-black",
    title: "No raw black",
    category: "color",
    description:
      "Pure `#000` reads as flat and dated against any modern surface " +
      "— it crushes shadow detail, breaks anti-aliasing on type, and " +
      "lacks the warm undertone real ink has. Use a warm charcoal " +
      "(`#1a1a17`, `oklch(0.18 0.005 80)`, or the equivalent in your " +
      "colour space) for text and ink-heavy surfaces. Same logic for " +
      "pure `#fff` — prefer an off-white (`#fafaf7`) for backgrounds " +
      "that should feel like paper.",
    builtin: true,
  },
  {
    id: "co-brand-color-sparingly",
    title: "Brand color sparingly",
    category: "color",
    description:
      "The brand's signature colour carries the most visual weight " +
      "wherever it appears. Spend that weight where it earns attention: " +
      "the active LED on a control, a critical CTA, a single dot " +
      "indicating live status — never on chrome (toolbars, navigation, " +
      "card backgrounds) where the brand colour competes with content. " +
      "A surface where the brand colour appears once reads as " +
      "confident; a surface where it appears six times reads as " +
      "desperate.",
    builtin: true,
  },
  // ─── Language ──────────────────────────────────────────────────────
  {
    id: "ln-match-user-language",
    title: "Match user's language",
    category: "language",
    description:
      "Detect the language of the user's input and reply in the same " +
      "language. When the user types Portuguese, write Portuguese; " +
      "when they switch to English mid-thread, switch with them. " +
      "Don't translate strings the user authored — preserve casing, " +
      "accents, and the exact wording they used in their own data. " +
      "The product should feel like it speaks the user's language " +
      "natively, not like a translation layer.",
    builtin: true,
  },
  {
    id: "ln-utf8-strict",
    title: "UTF-8 strict",
    category: "language",
    description:
      "Always output UTF-8 with full accent preservation. Don't use " +
      "HTML entities for accented characters (`&aacute;` for á), " +
      "don't fall back to ASCII transliteration, and don't store text " +
      "as base64 when it should be UTF-8. The round-trip write → save " +
      "→ reload → render must leave acute, tilde, cedilla, and emoji " +
      "intact. Box-drawing characters (`─ ┄ ━`) and arrow symbols are " +
      "equally first-class — strip them only when the destination " +
      "format truly can't carry them.",
    builtin: true,
  },
  // ─── Voice ─────────────────────────────────────────────────────────
  {
    id: "vo-plain-register",
    title: "Plain register",
    category: "voice",
    description:
      "Write at the register of a focused colleague explaining " +
      "something concrete — not the register of a marketing brochure " +
      'or a corporate memo. No "leverage", no "enable", no ' +
      '"robust", no "world-class". Short sentences that name the ' +
      "thing directly. The reader is smart and busy; respect both.",
    builtin: true,
  },
  {
    id: "vo-no-marketing-speak",
    title: "No marketing speak",
    category: "voice",
    description:
      'Banned vocabulary: "leverage", "synergy", "revolutionary", ' +
      '"world-class", "next-generation", "game-changing", "best-' +
      'in-class", "cutting-edge", "robust", "seamless", ' +
      '"intuitive", "delightful", "powerful". These words signal ' +
      "the writer doesn't know how to describe what they're claiming. " +
      'Replace each with concrete specifics: "powerful editor" → ' +
      '"edits files locally with autosave at 1s intervals".',
    builtin: true,
  },
  {
    id: "vo-concrete-over-abstract",
    title: "Concrete over abstract",
    category: "voice",
    description:
      "Numbers, examples, and named entities beat adjectives every " +
      'time. "Fast" becomes "loads in under 300ms"; "popular" ' +
      'becomes "used by 1,200 teams"; "easy" becomes "three ' +
      "keystrokes from cold start\". When you can't quantify, name a " +
      'specific instance: "the kind of edit you do in passes one ' +
      'and two" beats "supports complex edits". Vagueness is the ' +
      "easy default — specificity is the discipline.",
    builtin: true,
  },
  // ─── Layout ────────────────────────────────────────────────────────
  {
    id: "ly-no-card-bars",
    title: "No card bars or vertical accents",
    category: "layout",
    description:
      "Decorative bars at the top, base, or side of a card don't add " +
      "information — they fragment the card visually and date the " +
      "design fast (the trope reads like 2019 dashboard SaaS). To " +
      "signal hierarchy or status inside a card, use the card's own " +
      "content: a larger heading, a coloured dot adjacent to the " +
      "title, a tinted background state. When you need a divider, " +
      "use whitespace — not paint.",
    builtin: true,
  },
  {
    id: "ly-respect-viewport",
    title: "Respect viewport",
    category: "layout",
    description:
      "The page must not produce horizontal scroll at common widths " +
      "(320, 375, 768, 1024, 1440 px). Use `box-sizing: border-box`, " +
      "fluid widths or grids with `minmax(0, 1fr)`, and test resize " +
      "behaviour — don't ship a layout you've only seen at 1440 px. " +
      "Tables that don't fit get an internal horizontal scroll (not " +
      "page-level); fixed-width elements get a max-width plus inline " +
      "padding.",
    builtin: true,
  },
  {
    id: "ly-sticky-has-escape",
    title: "Sticky elements have escape",
    category: "layout",
    description:
      "Any sticky banner, drawer, modal, or floating panel needs an " +
      "explicit close affordance — a × button, an Esc shortcut, an " +
      "outside-click handler, all three when possible. Sticky " +
      "elements without escape feel like traps and erode user trust. " +
      "The escape mechanism must be discoverable inside the same " +
      "frame as the sticky content; relying solely on a keyboard " +
      "shortcut excludes users who don't know it exists.",
    builtin: true,
  },
  {
    id: "ly-optical-alignment",
    title: "Optical alignment",
    category: "layout",
    description:
      "Geometric centering and visual centering are not the same. " +
      "Triangles, asymmetric icons, glyphs with descenders, and " +
      "italic type need offset adjustments so they read as aligned. " +
      "Eye trumps math: when a play icon (▶) looks off-centre inside " +
      "a circular button despite being mathematically centred, nudge " +
      "it 1-2 px right until it reads centred. Optical kerning, " +
      "optical sizing in variable fonts, and trim metrics on type " +
      "all serve the same principle.",
    builtin: true,
  },
  // ─── Custom (shipped as defaults but slot is open for user rules) ──
  {
    id: "cu-tabular-nums",
    title: "Tabular nums for numerical data",
    category: "custom",
    description:
      "Apply `font-variant-numeric: tabular-nums` on any surface " +
      "where digits need to align: tables, prices, time displays, " +
      "counters, version numbers. Proportional digits (the default) " +
      "make 1,234 and 5,678 shift left/right between rows, which " +
      "destroys scannability. Tabular nums lock each digit to a fixed " +
      "width — numbers stack into clean columns and reading speed in " +
      "data-heavy contexts triples.",
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
