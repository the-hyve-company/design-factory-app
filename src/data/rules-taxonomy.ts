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
  /** Severity tier — P0 must-fix · P1 should-fix · P2 polish. Builtins only. */
  tier?: "P0" | "P1" | "P2";
  /** Factory-default rule: ships enabled and pre-fills the picker. Builtins only. */
  core?: boolean;
  /** Has a deterministic static-p0 check (grep / heuristic). Builtins only. */
  checkable?: boolean;
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
  tier: z.enum(["P0", "P1", "P2"]).optional(),
  core: z.boolean().optional(),
  checkable: z.boolean().optional(),
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
  { id: "a11y", label: "Accessibility", hint: "contrast, focus, keyboard" },
  { id: "copy", label: "Copy", hint: "voice & microcopy" },
  { id: "i18n-rtl", label: "i18n & RTL", hint: "locale & direction" },
  { id: "laws-of-ux", label: "Laws of UX", hint: "usability heuristics" },
  { id: "custom", label: "Custom", hint: "your additions" },
]);

// ─── Defaults — 132 brand-agnostic craft builtin rules ────────────────
//
// 132 brand-agnostic craft defaults across 14 categories: the 10 visual
// ones plus accessibility, copy, i18n/RTL and laws-of-ux. Nothing tied to
// any specific brand. Ported from docs/specs/df-rules-library.md (the
// research-backed library — see 2026-06-26-df-craft-enforcement.md).
//
// Each `description` is a compact ✗ avoid / ✓ do-instead pair (with the
// concrete value when it matters), concatenated into the system prompt
// when the rule is enabled. `tier` (P0/P1/P2) = severity; `core` = ships
// in the factory default set (14 rules); `checkable` = has a deterministic
// static-p0 detector. Keep ids kebab-case with a category prefix. `title`
// is the picker-row label only; PT+EN copy lives in i18n/builtin-labels.ts
// and the EN here must match the EN title there.
export const DEFAULT_BUILTIN_RULES: ReadonlyArray<Rule> = Object.freeze([
  // ─── Anti-slop (13) ─────────────────────────────────────────
  {
    id: "as-no-shadcn-default",
    title: "Override the default shadcn/Tailwind look",
    category: "anti-slop",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ Default zinc/slate neutrals + indigo accent + `0.5rem` radius on everything.\n✓ Override four axes: accent hue, the `--radius` scale, the display font, the neutral ramp.",
    builtin: true,
  },
  {
    id: "as-no-generic-ai-gradient",
    title: "No generic AI gradient",
    category: "anti-slop",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ Two-stop violet→blue / blue→cyan / indigo→pink gradient on hero or background.\n✓ Flat surface; or a same-family ramp (hue shift ≤30°) that marks real hierarchy.",
    builtin: true,
  },
  {
    id: "as-no-gradient-text",
    title: "No gradient-filled headline text",
    category: "anti-slop",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ `background-clip:text` with a multi-hue gradient on headings.\n✓ Solid token color; size + weight carry it. If intentional, one per page, unset on `::selection`.",
    builtin: true,
  },
  {
    id: "as-no-unprompted-glow",
    title: "No unprompted neon glow",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `box-shadow:0 0 …` halos / glowing `text-shadow` as ambient decoration.\n✓ Glow only on a genuinely active/recording/pressed element; depth via a real elevation shadow.",
    builtin: true,
  },
  {
    id: "as-no-decorative-emojis",
    title: "No emojis as icons",
    category: "anti-slop",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      '✗ Emoji icons/bullets (🚀 ⚡ ✨ 🔥 🎯) in `<h*>`, `<button>`, `<li>`, `class*="icon"`.\n✓ One monoline SVG set, 1.6–1.8px stroke, `currentColor`; emphasis via type weight.',
    builtin: true,
  },
  {
    id: "as-no-invented-decoration",
    title: "No invented decoration",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Gradients, glows, blurs, particle fields added for their own sake.\n✓ Drop any effect that, if removed, loses no information; let type + spacing carry it.",
    builtin: true,
  },
  {
    id: "as-no-default-glassmorphism",
    title: "No default glassmorphism",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `backdrop-filter:blur()` frost on cards, headers, and modals at once.\n✓ Solid surfaces; glass on 1-2 semantic surfaces only (fixed nav, modal scrim), where content sits behind.",
    builtin: true,
  },
  {
    id: "as-no-effect-stacking",
    title: "No stacked effects",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Shadow + gradient + blur + border + glow piled on one element.\n✓ One treatment per element; depth from a single elevation system.",
    builtin: true,
  },
  {
    id: "as-no-aurora-bg",
    title: "No aurora / mesh / blob background",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Animated multi-`radial-gradient` aurora or drifting `filter:blur` color blobs.\n✓ Solid surface; tension from layout, not a moving backdrop.",
    builtin: true,
  },
  {
    id: "as-no-decorative-bg-pattern",
    title: "No decorative background pattern",
    category: "anti-slop",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Tiled dot-grids, blueprint grids, decorative wave/blob SVGs as filler.\n✓ Plain surface; whitespace as structure (pattern only if it encodes real data).",
    builtin: true,
  },
  {
    id: "as-no-tasteful-default-cliche",
    title: 'Avoid the "tasteful default" cliché',
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      '✗ Reflexive cream `#F4F1EA`+serif+sage, "near-black+acid-green", or broadsheet-hairline looks.\n✓ A palette/voice grounded in the subject; justify a known look as a deliberate choice.',
    builtin: true,
  },
  {
    id: "as-break-perfect-symmetry",
    title: "Break perfect symmetry with intention",
    category: "anti-slop",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Evenly-weighted, perfectly symmetric layout, identical rhythm top-to-bottom.\n✓ Alternate density (one tight section, one breathing); anchor with a deliberate asymmetry.",
    builtin: true,
  },
  {
    id: "as-soul-80-20",
    title: "80% proven, 20% distinctive",
    category: "anti-slop",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ A flawless but anonymous template with zero risk.\n✓ One signature move — a bold type/color call, an unexpected proportion, product-specific microcopy.",
    builtin: true,
  },
  // ─── Layout (12) ─────────────────────────────────────────
  {
    id: "ly-generous-spacing",
    title: "Generous, intentional spacing",
    category: "layout",
    tier: "P1",
    core: true,
    checkable: false,
    description:
      "✗ Cramped, evenly-distributed elements with no breathing room.\n✓ Generous whitespace; group by proximity, separate by gap.",
    builtin: true,
  },
  {
    id: "ly-clear-hierarchy",
    title: "One clear focal point",
    category: "layout",
    tier: "P1",
    core: true,
    checkable: false,
    description:
      "✗ Flat layout where everything competes equally.\n✓ One primary focal point per view; de-emphasize the rest.",
    builtin: true,
  },
  {
    id: "ly-spacing-scale",
    title: "Spacing on a scale",
    category: "layout",
    tier: "P1",
    core: false,
    checkable: true,
    description: "✗ Arbitrary margins/paddings (13px, 27px…).\n✓ 4/8/12/16/24/32/48/64.",
    builtin: true,
  },
  {
    id: "ly-padding-ratio",
    title: "Horizontal padding > vertical",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: true,
    description: "✗ Equal H/V padding on buttons/chips.\n✓ Horizontal ≈ 2× vertical.",
    builtin: true,
  },
  {
    id: "ly-dont-center-everything",
    title: "Don't center everything",
    category: "layout",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ All text and blocks center-aligned.\n✓ Left-align body and long text; center only short hero/empty states.",
    builtin: true,
  },
  {
    id: "ly-no-hero-three-card",
    title: "Break the hero + 3-card cliché",
    category: "layout",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Centered hero followed by a row of three identical feature cards.\n✓ Vary one section — asymmetric split, full-bleed quote, inline demo.",
    builtin: true,
  },
  {
    id: "ly-no-uniform-bento",
    title: "No uniform bento grid",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ A grid of equal-size bento tiles, equal weight.\n✓ Size cells by importance; let the grid express hierarchy.",
    builtin: true,
  },
  {
    id: "ly-grid-system",
    title: "Align to a grid",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Ad-hoc widths and misaligned columns.\n✓ A 12-column grid with consistent gutters; align to it.",
    builtin: true,
  },
  {
    id: "ly-concentric-radius",
    title: "Concentric corner radii",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Same radius on an inner element and its padded container.\n✓ Outer radius = inner radius + padding.",
    builtin: true,
  },
  {
    id: "ly-vary-density",
    title: "Vary section density",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Identical vertical rhythm down the whole page.\n✓ Alternate tight and breathing sections for intentional pace.",
    builtin: true,
  },
  {
    id: "ly-optical-alignment",
    title: "Align optically",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Pure metric centering of icons/glyphs/play buttons.\n✓ Nudge for optical balance (triangles, type with descenders).",
    builtin: true,
  },
  {
    id: "ly-no-fake-logo-cloud",
    title: "No filler logo cloud",
    category: "layout",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ A gray "Trusted by" logo row as decoration.\n✓ Real logos, or drop the section.',
    builtin: true,
  },
  // ─── Typography (15) ─────────────────────────────────────────
  {
    id: "ty-limited-type-scale",
    title: "Use a limited type scale",
    category: "typography",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ Arbitrary font sizes (17px, 22px, 29px…).\n✓ One scale: 12/14/16/18/20/24/30/36/48/64.",
    builtin: true,
  },
  {
    id: "ty-weight-for-hierarchy",
    title: "Weight, not just size, builds hierarchy",
    category: "typography",
    tier: "P1",
    core: true,
    checkable: true,
    description:
      "✗ Hierarchy by size alone; body weights below 400.\n✓ Weights 400/500/600/700; pair size + weight; never <400 for text.",
    builtin: true,
  },
  {
    id: "ty-comfortable-measure",
    title: "Keep a comfortable measure",
    category: "typography",
    tier: "P1",
    core: true,
    checkable: true,
    description:
      "✗ Body lines spanning the full container width.\n✓ 45–75 characters (~66); `max-width: 65ch` on text blocks.",
    builtin: true,
  },
  {
    id: "ty-body-min-16",
    title: "Body text ≥16px",
    category: "typography",
    tier: "P1",
    core: false,
    checkable: true,
    description: "✗ Body copy below 16px.\n✓ 16–18px body; 14px only for secondary/meta labels.",
    builtin: true,
  },
  {
    id: "ty-line-height",
    title: "Line-height by role",
    category: "typography",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ One tight line-height on everything.\n✓ Body 1.5; headings 1.1–1.25 (tighter as size grows).",
    builtin: true,
  },
  {
    id: "ty-no-default-fonts",
    title: "No default system fonts",
    category: "typography",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Inter / Roboto / Arial / Times / Open Sans / Montserrat / bare `system-ui` as the brand face.\n✓ A deliberately chosen display + text pairing; system stack only as fallback.",
    builtin: true,
  },
  {
    id: "ty-display-font-on-headings",
    title: "Headings use the display face",
    category: "typography",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ Hardcoded Inter/system on `h1`/`h2` when a display font is set.\n✓ `var(--font-display)` on headings; `var(--font-text)` on body.",
    builtin: true,
  },
  {
    id: "ty-text-wrap",
    title: "Tidy wrapping",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Ragged, orphan-heavy headline wraps.\n✓ `text-wrap: balance` on headings, `pretty` on body.",
    builtin: true,
  },
  {
    id: "ty-font-smoothing",
    title: "Smooth text on dark",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Heavy-looking text on dark surfaces.\n✓ `-webkit-font-smoothing: antialiased` for light-on-dark.",
    builtin: true,
  },
  {
    id: "ty-smart-quotes",
    title: "Curly quotes and apostrophes",
    category: "typography",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Straight `'` `\"` in rendered copy.\n✓ Curly `\" \"` `' '` and proper apostrophes.",
    builtin: true,
  },
  {
    id: "ty-tabular-nums",
    title: "Tabular figures for data",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Proportional figures in tables, timers, prices, counters.\n✓ `font-variant-numeric: tabular-nums` so digits align.",
    builtin: true,
  },
  {
    id: "ty-no-hover-type-shift",
    title: "Don't reflow type on hover",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `font-size` / `font-weight` / `text-transform` changing on `:hover`.\n✓ Shift color/opacity/background only; reserve weight as a static layout slot.",
    builtin: true,
  },
  {
    id: "ty-underline-links-only",
    title: "Underline means link",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Underline as decoration on non-links.\n✓ Underline reserved for `<a>`; emphasis via weight/color.",
    builtin: true,
  },
  {
    id: "ty-no-bold-italic-stack",
    title: "One emphasis axis at a time",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Bold + italic stacked on the same run.\n✓ Pick one emphasis axis; reserve the other.",
    builtin: true,
  },
  {
    id: "ty-sentence-case",
    title: "Sentence case for UI",
    category: "typography",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Title Case or ALL CAPS across headings, buttons, labels.\n✓ Sentence case; ALL CAPS only on tiny labels with letter-spacing.",
    builtin: true,
  },
  // ─── Color (14) ─────────────────────────────────────────
  {
    id: "co-few-colors-neutral-base",
    title: "Few colors, neutral base",
    category: "color",
    tier: "P1",
    core: true,
    checkable: false,
    description:
      "✗ Many competing hues across the screen.\n✓ 70–90% neutrals + one accent (5–10%) + semantic (0–5%).",
    builtin: true,
  },
  {
    id: "co-no-raw-black",
    title: "No pure black or white",
    category: "color",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ `#000` / `#fff` as bg or fg.\n✓ Dark: bg `#0f0f0f`, fg `#f0f0f0`. Light: bg `#fafafa`, fg `#111111`.",
    builtin: true,
  },
  {
    id: "co-accent-sparingly",
    title: "Ration the accent",
    category: "color",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Accent on links, CTA, chips, rings all at once.\n✓ ≤2 visible accent uses per screen (links and rings count).",
    builtin: true,
  },
  {
    id: "co-one-accent",
    title: "One accent only",
    category: "color",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ A second invented accent hue.\n✓ Single `--accent`; extra meaning via `--success` / `--warn` / `--danger`.",
    builtin: true,
  },
  {
    id: "co-oklch",
    title: "Author color in OKLCH",
    category: "color",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `hex` / `rgb` / `hsl` for color decisions and ramps.\n✓ `oklch()` — perceptual lightness, controllable chroma/hue.",
    builtin: true,
  },
  {
    id: "co-chroma-budget",
    title: "Budget the chroma",
    category: "color",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ Saturated "neutrals" and huge fully-saturated fills.\n✓ Neutrals C≈0; accent C≤0.20; large fills low chroma.',
    builtin: true,
  },
  {
    id: "co-semantic-token-names",
    title: "Name tokens by purpose",
    category: "color",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `--blue-500`, `--green-500`.\n✓ `--accent`, `--success` — named by role, not hue.",
    builtin: true,
  },
  {
    id: "co-no-tailwind-indigo",
    title: "No default Tailwind indigo",
    category: "color",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ `#6366f1` `#4f46e5` `#4338ca` `#3730a3` `#8b5cf6` `#7c3aed` `#a855f7` as accent.\n✓ The brief's `--accent`. (A `var(--accent)` that resolves to indigo is fine — it's intentional.)",
    builtin: true,
  },
  {
    id: "co-functional-gradient",
    title: "Gradients separate, don't decorate",
    category: "color",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Decorative gradient filling empty space.\n✓ Gradient only to separate hierarchy (header→body, CTA), same family, hue shift ≤30°.",
    builtin: true,
  },
  {
    id: "co-dark-translucent-borders",
    title: "Translucent borders on dark",
    category: "color",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Solid dark borders on dark surfaces.\n✓ `1px rgba(255,255,255,0.08)` — reads as structure without noise.",
    builtin: true,
  },
  {
    id: "co-12-step-ramp",
    title: "A 12-step role ramp",
    category: "color",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Ad-hoc tints invented per component.\n✓ A 12-step scale with fixed roles (bg, subtle, ui, border, solid, text…); each decision picks a step.",
    builtin: true,
  },
  {
    id: "co-hover-active-from-ramp",
    title: "States step the ramp",
    category: "color",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Random hover/active colors.\n✓ Hover/active = next step on the ramp, not a new color.",
    builtin: true,
  },
  {
    id: "co-state-by-token",
    title: "Semantic states use tokens",
    category: "color",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Raw red/green for error/success.\n✓ `--danger` / `--success` / `--warn`; pair with icon + text (not color alone).",
    builtin: true,
  },
  {
    id: "co-no-pure-saturated-on-white",
    title: "Tame brand color for text",
    category: "color",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Bright brand accent as body-text color (fails contrast).\n✓ Darken to a 600-level shade for text; reserve the bright variant for fills.",
    builtin: true,
  },
  // ─── Depth (8) ─────────────────────────────────────────
  {
    id: "de-consistent-radius",
    title: "One radius system",
    category: "depth",
    tier: "P1",
    core: true,
    checkable: true,
    description:
      "✗ Mixed corner radii across components.\n✓ One `--radius` scale; concentric for nested elements.",
    builtin: true,
  },
  {
    id: "de-shadow-blur-ratio",
    title: "Soft, plausible shadows",
    category: "depth",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Hard shadows with blur ≈ offset and high alpha.\n✓ Blur ≈ 2× offset, low alpha; light comes from one direction.",
    builtin: true,
  },
  {
    id: "de-no-shadow-dark",
    title: "No drop shadows on dark",
    category: "depth",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `box-shadow` for elevation on dark surfaces (invisible/muddy).\n✓ Depth via a lighter surface + translucent border on dark.",
    builtin: true,
  },
  {
    id: "de-shadow-over-border",
    title: "Shadow beats heavy border",
    category: "depth",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Thick borders to separate cards.\n✓ A subtle multi-layer shadow (or a hairline) reads cleaner than a heavy border.",
    builtin: true,
  },
  {
    id: "de-nested-brightness",
    title: "Gentle nesting steps",
    category: "depth",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Big brightness jumps between nested containers.\n✓ ≤12% brightness step (dark) / ≤7% (light) per nesting level.",
    builtin: true,
  },
  {
    id: "de-single-elevation-system",
    title: "One elevation scale",
    category: "depth",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Random shadow values per element.\n✓ A fixed elevation scale (sm/md/lg); pick a level, don't invent.",
    builtin: true,
  },
  {
    id: "de-image-outline",
    title: "Hairline edge on images",
    category: "depth",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Images floating with no edge definition.\n✓ `1px rgba(0,0,0,0.1)` inset/outline to seat them on the surface.",
    builtin: true,
  },
  {
    id: "de-one-treatment",
    title: "One depth treatment per element",
    category: "depth",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Shadow + border + gradient + glow stacked on one element.\n✓ Choose one depth treatment.",
    builtin: true,
  },
  // ─── Motion (15) ─────────────────────────────────────────
  {
    id: "mo-gpu-only-props",
    title: "Animate only compositor props",
    category: "motion",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ Animating `width`/`height`/`top`/`left`/`margin` (layout thrash).\n✓ Only `transform` / `opacity` / `filter` / `clip-path`.",
    builtin: true,
  },
  {
    id: "mo-honor-reduced-motion",
    title: "Honor reduced motion",
    category: "motion",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ Transforms/parallax with no reduced-motion path.\n✓ `@media (prefers-reduced-motion: reduce)` strips axis motion; keep opacity/color crossfades.",
    builtin: true,
  },
  {
    id: "mo-no-transition-all",
    title: "Never `transition: all`",
    category: "motion",
    tier: "P1",
    core: false,
    checkable: true,
    description: "✗ `transition: all`.\n✓ Name the exact properties (`transform`, `opacity`).",
    builtin: true,
  },
  {
    id: "mo-duration-by-type",
    title: "Duration by interaction type",
    category: "motion",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ One long duration on everything.\n✓ 50–100ms instant · 150ms default · 200–300ms entering · 300–500ms cross-screen.",
    builtin: true,
  },
  {
    id: "mo-micro-under-500",
    title: "Microinteractions <500ms",
    category: "motion",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ >500ms on hover/press/toggle/validation.\n✓ Keep non-navigation motion <500ms; frequent (seen 50×/session) ≤200ms.",
    builtin: true,
  },
  {
    id: "mo-ease-out-enter",
    title: "Ease-out in, accelerate out",
    category: "motion",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ `linear`/`ease-in` on entrances; exit slower than enter.\n✓ Ease-out on enter, accelerate on exit, exit ≤ enter duration.",
    builtin: true,
  },
  {
    id: "mo-curve-vs-spring",
    title: "Curve vs spring by property",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ A timing curve on physical `scale`/position; a spring on opacity.\n✓ Curve for opacity/color; spring for position/scale/rotation/gesture.",
    builtin: true,
  },
  {
    id: "mo-m3-easing",
    title: "Use the real M3 easing",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      '✗ `cubic-bezier(0.4,0,0.2,1)` labeled "Material 3" (that\'s M2/legacy).\n✓ M3 standard `cubic-bezier(0.2,0,0,1)` — front-loaded, settles on target.',
    builtin: true,
  },
  {
    id: "mo-press-scale",
    title: "Sane press scale",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `scale(0.8)` on press (collapses).\n✓ 0.90–0.97; ~2px travel reads as a real press.",
    builtin: true,
  },
  {
    id: "mo-dialog-not-scale-zero",
    title: "Dialogs don't grow from zero",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Modal animating from `scale(0)`.\n✓ `scale(0.96)→1` + opacity; subtle, not a pop.",
    builtin: true,
  },
  {
    id: "mo-linear-only-loops",
    title: "`linear` only for loops",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `linear` timing on one-shot transitions.\n✓ `linear` only for spinners/continuous loops; eased everywhere else.",
    builtin: true,
  },
  {
    id: "mo-will-change-sparingly",
    title: "`will-change` with restraint",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ `will-change: all` or on many idle elements.\n✓ Only on an element about to animate; remove after.",
    builtin: true,
  },
  {
    id: "mo-selective-reveal",
    title: "Reveal sparingly on scroll",
    category: "motion",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Universal fade-up on every section on scroll.\n✓ One restrained reveal where it earns attention; content visible by default.",
    builtin: true,
  },
  {
    id: "mo-no-endless-loop",
    title: "No endless ambient motion",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Infinite background loops; spinner forever.\n✓ Cap cycles; cancel on route change; pause control for motion >5s; spinner→progress at 60s.",
    builtin: true,
  },
  {
    id: "mo-css-spring",
    title: "Spring feel without a framework",
    category: "motion",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ "Springy" motion faked with a long ease (sluggish).\n✓ CSS `linear()` easing for real spring feel on a single property (~1.3kB, no JS).',
    builtin: true,
  },
  // ─── Imagery (6) ─────────────────────────────────────────
  {
    id: "im-no-stock-cdn",
    title: "No placeholder image CDNs",
    category: "imagery",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `unsplash.com` / `placehold.co` / `picsum.photos` / `placekitten.com`.\n✓ Real assets, or a labeled local placeholder.",
    builtin: true,
  },
  {
    id: "im-aspect-ratio",
    title: "Reserve image space",
    category: "imagery",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Images with no dimensions (layout shift on load).\n✓ Set `aspect-ratio` + `object-fit: cover`.",
    builtin: true,
  },
  {
    id: "im-no-distortion",
    title: "Never distort images",
    category: "imagery",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Stretching via mismatched `width`/`height`.\n✓ `object-fit: cover`; crop, don't squash.",
    builtin: true,
  },
  {
    id: "im-overlay-legible",
    title: "Keep text on images legible",
    category: "imagery",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Text laid directly over a busy photo.\n✓ A scrim, gradient, blur, or duotone behind the text.",
    builtin: true,
  },
  {
    id: "im-subtle-outline",
    title: "Seat images on the surface",
    category: "imagery",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Photos blending into the background edge.\n✓ `1px rgba(0,0,0,0.1)` outline to define the edge.",
    builtin: true,
  },
  {
    id: "im-consistent-treatment",
    title: "One image treatment",
    category: "imagery",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Mixed radii, ratios, and filters across images.\n✓ One consistent treatment (radius, ratio, filter) per surface.",
    builtin: true,
  },
  // ─── Icons (4) ─────────────────────────────────────────
  {
    id: "ic-monoline-stroke",
    title: "One monoline icon set",
    category: "icons",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Mixed icon styles / heavy random weights.\n✓ One set, 1.6–1.8px stroke, on a 24px grid.",
    builtin: true,
  },
  {
    id: "ic-currentcolor",
    title: "Icons inherit color",
    category: "icons",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ Hardcoded fills on icons.\n✓ `stroke`/`fill: currentColor` so they theme with text.",
    builtin: true,
  },
  {
    id: "ic-clarify-not-decorate",
    title: "Icons clarify, not decorate",
    category: "icons",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ An icon on every list item as decoration.\n✓ Icons only where they speed scanning; the text label stays.",
    builtin: true,
  },
  {
    id: "ic-optical-size",
    title: "Optically size and align",
    category: "icons",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Icons mismatched to text size / off the baseline.\n✓ Size to the adjacent text; align optically to the cap height.",
    builtin: true,
  },
  // ─── Forms (9) ─────────────────────────────────────────
  {
    id: "fo-label-every-input",
    title: "Every input has a real label",
    category: "forms",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ Placeholder as the only label.\n✓ `<label for>` always; placeholder shows an example, not the name.",
    builtin: true,
  },
  {
    id: "fo-error-wiring",
    title: "Wire errors to the field",
    category: "forms",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      '✗ Error text floating, unconnected to the input.\n✓ `aria-describedby` + `aria-invalid="true"` + `role="alert"` on the message.',
    builtin: true,
  },
  {
    id: "fo-inline-validation",
    title: "Validate inline, on blur",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Errors only on submit, summarized at the top.\n✓ Validate on blur; show the error next to the field.",
    builtin: true,
  },
  {
    id: "fo-error-actionable",
    title: "Actionable field errors",
    category: "forms",
    tier: "P1",
    core: false,
    checkable: false,
    description: '✗ "Invalid input."\n✓ "Email must include @ and a domain."',
    builtin: true,
  },
  {
    id: "fo-no-redundant-entry",
    title: "Don't re-ask known data",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Re-asking data the user already gave in the same flow (WCAG 3.3.7).\n✓ Carry it forward or offer a select; autofill alone doesn't satisfy it.",
    builtin: true,
  },
  {
    id: "fo-correct-input-types",
    title: "Correct input types",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      '✗ `type="text"` for email/number/tel/date.\n✓ Right `type` + `inputmode` + `autocomplete`.',
    builtin: true,
  },
  {
    id: "fo-no-reset-button",
    title: "No destructive reset",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ A "Reset"/"Clear" button beside Submit.\n✓ Drop it; accidental data loss outweighs the rare use.',
    builtin: true,
  },
  {
    id: "fo-submit-state",
    title: "Guard the submit",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Submit clickable repeatedly during request.\n✓ Disable + loading state on submit; prevent double-send.",
    builtin: true,
  },
  {
    id: "fo-mark-optional",
    title: "Mark optional, not asterisk soup",
    category: "forms",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ Asterisks on most fields.\n✓ Assume required; label the few optional ones "(optional)".',
    builtin: true,
  },
  // ─── States (10) ─────────────────────────────────────────
  {
    id: "st-design-empty-error",
    title: "Design every state, not just happy path",
    category: "states",
    tier: "P1",
    core: true,
    checkable: false,
    description:
      "✗ Only the populated, success view.\n✓ Design empty, loading, error, and success states too.",
    builtin: true,
  },
  {
    id: "st-eight-states",
    title: "Cover interactive states",
    category: "states",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Components with only a default state.\n✓ default / hover / active / focus / disabled / loading / error / selected as needed.",
    builtin: true,
  },
  {
    id: "st-loading-pattern",
    title: "Right loading pattern",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Blank screen or layout jump while loading.\n✓ Skeleton when layout is known; spinner when not; escalate spinner→progress at 60s.",
    builtin: true,
  },
  {
    id: "st-optimistic-ui",
    title: "Optimistic, then confirm",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Blocking the UI until the server responds.\n✓ Update optimistically; motion confirms a change, never performs it.",
    builtin: true,
  },
  {
    id: "st-selected-not-hover",
    title: "Selected ≠ hover",
    category: "states",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Selected state looks like transient hover.\n✓ Selected = persistent bg-tint + weight; hover = lighter, transient.",
    builtin: true,
  },
  {
    id: "st-active-no-state-lines",
    title: "Active by fill, not bars",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Colored left/top bar to mark active.\n✓ Active = bg-tint + weight + (optional) icon; no decorative state line.",
    builtin: true,
  },
  {
    id: "st-focus-visible",
    title: "Visible keyboard focus",
    category: "states",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `outline: none` with no replacement.\n✓ `:focus-visible` ring, ≥3:1 contrast, ≥2px.",
    builtin: true,
  },
  {
    id: "st-disabled-legible",
    title: "Disabled stays readable",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Disabled = low opacity only (unreadable, no semantics).\n✓ Reduced emphasis + `not-allowed` cursor + `aria-disabled`; keep it legible.",
    builtin: true,
  },
  {
    id: "st-error-actionable",
    title: "Errors say what to do",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description: '✗ "An error occurred."\n✓ What happened + how to fix + a way forward.',
    builtin: true,
  },
  {
    id: "st-empty-onboards",
    title: "Empty state onboards",
    category: "states",
    tier: "P2",
    core: false,
    checkable: false,
    description: '✗ "No data" dead end.\n✓ Explain what goes here + a primary action to fill it.',
    builtin: true,
  },
  // ─── Accessibility (10) ─────────────────────────────────────────
  {
    id: "a11y-contrast-aa",
    title: "Meet WCAG 2.2 AA contrast",
    category: "a11y",
    tier: "P0",
    core: true,
    checkable: true,
    description:
      "✗ Body text below 4.5:1.\n✓ 4.5:1 body · 3:1 large (≥18pt/14pt bold) & non-text · inclusive (exactly 4.5:1 passes).",
    builtin: true,
  },
  {
    id: "a11y-focus-visible",
    title: "Keep focus visible",
    category: "a11y",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      "✗ `outline: none` killing keyboard focus.\n✓ `:focus-visible` indicator, ≥3:1, ≥2px perimeter.",
    builtin: true,
  },
  {
    id: "a11y-keyboard",
    title: "Fully keyboard-operable",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Click-only handlers; positive `tabindex` reordering.\n✓ Everything reachable/operable by keyboard in DOM order; no `tabindex>0`.",
    builtin: true,
  },
  {
    id: "a11y-native-elements",
    title: "Native elements first",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      '✗ `<div role="button">` / bare `<a>` with click handler.\n✓ `<button>` for actions, `<a href>` for navigation; ARIA only when nothing native fits.',
    builtin: true,
  },
  {
    id: "a11y-alt-text",
    title: "Text alternatives",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      '✗ `<img>` without `alt`; icon-only button with no label.\n✓ `alt` for content, `alt=""` for decorative, `aria-label` on icon buttons.',
    builtin: true,
  },
  {
    id: "a11y-html-lang",
    title: "Declare the language",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      '✗ `<html>` with no `lang`.\n✓ `<html lang="…">`; inner `lang` on sub-tree switches.',
    builtin: true,
  },
  {
    id: "a11y-heading-order",
    title: "Sane heading order",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Skipped levels (`h1`→`h3`); heading level chosen by size.\n✓ One `<h1>`, no skips; style the level you mean independently of size.",
    builtin: true,
  },
  {
    id: "a11y-landmarks",
    title: "Use landmarks",
    category: "a11y",
    tier: "P2",
    core: false,
    checkable: true,
    description:
      "✗ A page built from `<div>`s only.\n✓ `<header>` `<nav>` `<main>` `<aside>` `<footer>`.",
    builtin: true,
  },
  {
    id: "a11y-no-invent-aria",
    title: "Never invent ARIA",
    category: "a11y",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Guessed `aria-*` (ARIA pages average more errors, not fewer).\n✓ Native element → restyle native → APG pattern verbatim; last resort only.",
    builtin: true,
  },
  {
    id: "a11y-target-size",
    title: "Adequate target size",
    category: "a11y",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Interactive targets below 24×24px.\n✓ ≥24×24 (AA floor); 44×44 is the craft commitment.",
    builtin: true,
  },
  // ─── Copy (6) ─────────────────────────────────────────
  {
    id: "cp-no-generic-copy",
    title: "No generic marketing copy",
    category: "copy",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      '✗ "We help teams collaborate", "Welcome", "Get started".\n✓ Specific to the product and audience; say what it actually does.',
    builtin: true,
  },
  {
    id: "cp-no-fake-metrics",
    title: "No invented metrics",
    category: "copy",
    tier: "P0",
    core: false,
    checkable: true,
    description:
      '✗ "10× faster", "99.9% uptime", "3× more productive".\n✓ A real source, or a clearly labeled placeholder.',
    builtin: true,
  },
  {
    id: "cp-no-em-dash-tell",
    title: "Cut the AI punctuation tells",
    category: "copy",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ Em-dashes (—), `--`, and `...` peppered through copy.\n✓ Commas/periods; a real ellipsis `…` only when truly needed.",
    builtin: true,
  },
  {
    id: "cp-actionable-buttons",
    title: "Verbs on buttons",
    category: "copy",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ "Submit", "Get started", "Click here".\n✓ Verb + object: "Start tracking", "Create project".',
    builtin: true,
  },
  {
    id: "cp-sentence-case",
    title: "Sentence case in UI",
    category: "copy",
    tier: "P2",
    core: false,
    checkable: false,
    description: "✗ Title Case across UI labels.\n✓ Sentence case; reserve caps for tiny labels.",
    builtin: true,
  },
  {
    id: "cp-no-filler",
    title: "No filler copy",
    category: "copy",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      '✗ `lorem ipsum`, "feature one/two/three", "sample content".\n✓ Real copy, or solve the empty section with composition.',
    builtin: true,
  },
  // ─── i18n & RTL (4) ─────────────────────────────────────────
  {
    id: "i18n-logical-properties",
    title: "Logical, not physical, properties",
    category: "i18n-rtl",
    tier: "P1",
    core: false,
    checkable: true,
    description:
      "✗ `margin-left/right`, `left`/`right`, `text-align: left`.\n✓ `margin-inline`, `inset-inline`, `text-align: start` so RTL mirrors for free.",
    builtin: true,
  },
  {
    id: "i18n-rtl-aware",
    title: "Respect direction",
    category: "i18n-rtl",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      '✗ Layout assuming LTR only.\n✓ Honor `dir="rtl"`; mirror layout — but not directional icons that map to physical motion.',
    builtin: true,
  },
  {
    id: "i18n-locale-format",
    title: "Localize numbers and dates",
    category: "i18n-rtl",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Hardcoded date/number/currency formats.\n✓ `Intl.DateTimeFormat` / `Intl.NumberFormat`.",
    builtin: true,
  },
  {
    id: "i18n-room-to-expand",
    title: "Leave room for translation",
    category: "i18n-rtl",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Tight, fixed-width labels; text baked into images.\n✓ Real (translatable) text; allow ~30% expansion without breaking layout.",
    builtin: true,
  },
  // ─── Laws of UX (6) ─────────────────────────────────────────
  {
    id: "lux-fitts",
    title: "Size and place by frequency (Fitts)",
    category: "laws-of-ux",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Tiny primary actions far from where the user is.\n✓ Bigger, closer targets for frequent/important actions.",
    builtin: true,
  },
  {
    id: "lux-hick",
    title: "Reduce choices (Hick)",
    category: "laws-of-ux",
    tier: "P1",
    core: false,
    checkable: false,
    description:
      "✗ Twenty equal-weight options at once.\n✓ Group, prioritize, and progressively disclose.",
    builtin: true,
  },
  {
    id: "lux-miller",
    title: "Chunk into groups (Miller)",
    category: "laws-of-ux",
    tier: "P2",
    core: false,
    checkable: false,
    description: "✗ A flat list of 9+ nav items.\n✓ Chunk into 5±2 groups.",
    builtin: true,
  },
  {
    id: "lux-jakob",
    title: "Match conventions (Jakob)",
    category: "laws-of-ux",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Reinventing cart, search, nav, or form patterns.\n✓ Use familiar patterns; spend novelty in the distinctive 20%.",
    builtin: true,
  },
  {
    id: "lux-proximity",
    title: "Group by proximity (Gestalt)",
    category: "laws-of-ux",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Uniform spacing with no grouping.\n✓ Related items close; clear gaps between groups.",
    builtin: true,
  },
  {
    id: "lux-aesthetic-usability",
    title: "Polish helps, doesn't replace",
    category: "laws-of-ux",
    tier: "P2",
    core: false,
    checkable: false,
    description:
      "✗ Relying on looks to mask broken flows.\n✓ Polish raises perceived usability — but fix the real usability too.",
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

// ─── Factory default rule set ─────────────────────────────────────────
// The `core: true` builtins (14) ship enabled and pre-fill the New
// Project picker. The user can override this per project (the picker)
// and, eventually, edit their personal default (the `default_rule_ids`
// setting + a config panel). `getCoreRuleIds` is the immutable factory
// floor; `resolveDefaultRuleIds` turns a persisted setting into a clean
// id list, falling back to the floor.

/** The 14 factory-core rule ids — the default-on set. */
export function getCoreRuleIds(): string[] {
  return DEFAULT_BUILTIN_RULES.filter((r) => r.core).map((r) => r.id);
}

/** Resolve a persisted `default_rule_ids` setting (raw string from
 *  db.getSetting) to a clean id list: valid JSON array, keep only ids
 *  that still exist, fall back to the core set when absent/empty/corrupt. */
export function resolveDefaultRuleIds(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim()) {
    try {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const known = arr.filter(
          (id): id is string => typeof id === "string" && findRule(id) !== null,
        );
        if (known.length > 0) return known;
      }
    } catch {
      // corrupt JSON → fall back to the factory core set
    }
  }
  return getCoreRuleIds();
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
