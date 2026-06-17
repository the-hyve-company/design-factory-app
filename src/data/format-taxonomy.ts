// format-taxonomy.ts — Output Format catalog (category × subitem).
//
// split: Format = output category × subitem. NOT canvas size
// (that's canvas-presets.ts) and NOT taste/anti-slop (that's
// direction-taxonomy.ts).
//
// Picker UX is single-select with collapsable categories. Each subitem is
// a row inside a category (Video > Explainer, Interface > Landing, etc).
//
// Selection schema in NewProjectFormPayload.format:
//   { categoryId: "video", itemId: "explainer" }
//   null  ← nothing picked yet

import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────

export interface FormatCategory {
  id: string;
  label: string;
  /** Optional one-liner shown in the collapsed header. */
  hint?: string;
  items: FormatItem[];
}

export interface FormatItem {
  id: string;
  label: string;
  /** Short descriptor shown after the item label in the picker. */
  descriptor?: string;
  /** Long-form instruction text concatenated into the system prompt
   *  when this format is selected. Editable in Settings. When absent,
   *  only the descriptor (if any) is included — keeps the prompt
   *  surface lean for vestigial formats. Added so the descriptor
   *  could become a small editable prompt. */
  prompt?: string;
}

export interface FormatSelection {
  categoryId: string;
  itemId: string;
}

// ─── Schemas (Zod) ────────────────────────────────────────────────────

export const FormatItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  descriptor: z.string().optional(),
  prompt: z.string().optional(),
});

export const FormatCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hint: z.string().optional(),
  items: z.array(FormatItemSchema).min(0),
});

export const FormatSelectionSchema = z.object({
  categoryId: z.string().min(1),
  itemId: z.string().min(1),
});

// ─── Defaults ─────────────────────────────────────────────────────────

// Builtin formats — restored from legacy `direction-data.ts` per the
// 2026-05-17 audit (P0-D Rota A). Catalog now covers the auditor's
// priority list: video (explainer, hero-loop, logo-reveal), social
// (post, story, carousel), print (poster), and interface (landing,
// dashboard, app-screen, email, hero-section). Prompts are tighter
// than the legacy 200-line variants — the new runtime keeps Canonical+
// direction in the system prompt continuously, so each format
// instruction stays compact and disposable.
export const DEFAULT_FORMAT_TAXONOMY: ReadonlyArray<FormatCategory> = Object.freeze([
  {
    id: "interface",
    label: "Interface",
    hint: "static screens · HTML output",
    items: [
      {
        id: "landing",
        label: "Landing page",
        descriptor: "hero · sections · CTA",
        prompt:
          "Output is a single-page HTML landing. Mobile-first responsive. " +
          "Required sections in order: hero with value-prop + primary CTA · " +
          "supporting feature blocks (3-6 cards or rows) · social proof (logos, " +
          "stats or quotes) · pricing if relevant · final CTA. Use semantic " +
          "section markup. No fold-anxiety — long scroll is fine when content " +
          "earns it.",
      },
      {
        id: "hero-section",
        label: "Hero section",
        descriptor: "single-screen value prop",
        prompt:
          "Output is the hero SECTION of a page, not a full page. Single " +
          "viewport-height composition: bold value-prop headline + one supporting " +
          "line + one primary CTA. Type leads — at least 56px on desktop, " +
          "clamp() for fluid scaling. Background is solid or one calm gradient, " +
          "never AI-shimmer haze. No nav bar, no footer, no other sections.",
      },
      {
        id: "dashboard",
        label: "Dashboard",
        descriptor: "data dense · panels",
        prompt:
          "Output is a data-dense dashboard view. Use a panel grid (sidebar + " +
          "main, or top-bar + tiled cards). KPI cards use tabular numbers and " +
          "include delta vs previous period. Tables are scannable: small row " +
          "height, monospace digits, sticky header. Reserve color for status; " +
          "everything else is grayscale. No decorative illustrations.",
      },
      {
        id: "app-screen",
        label: "App screen",
        descriptor: "single view",
        prompt:
          "Output is a single application screen — one task in focus. Header " +
          "with screen title + primary action top-right. Content area is the " +
          "task itself (form, list, detail view, etc), nothing else. Bottom or " +
          "side affordances only when navigation is essential to the task.",
      },
      {
        id: "email",
        label: "Email",
        descriptor: "inbox-safe HTML",
        prompt:
          "Output is inbox-safe HTML. Use table-based layout (mso compatible). " +
          "Max-width 600px. Inline styles only — no <style> blocks unless wrapped " +
          "in MSO conditionals. Web fonts fall back to system stack. No JS, no " +
          "form elements, no flex/grid.",
      },
    ],
  },
  {
    id: "social",
    label: "Social",
    hint: "feed-friendly · ratio-locked",
    items: [
      {
        id: "post",
        label: "Post",
        descriptor: "feed card",
        prompt:
          "Output is a 1080×1080 (1:1) or 1080×1350 (4:5) feed card. One " +
          "primary message, no fold thinking. Type leads (≥60% of canvas " +
          "height). Brand mark anchored — small, bottom-right or top-left. " +
          "No CTA buttons (feed has its own). High legibility at thumbnail.",
      },
      {
        id: "story",
        label: "Story",
        descriptor: "9:16 vertical",
        prompt:
          "Output is 1080×1920 (9:16) vertical. Tap-safe zones: avoid top 250px " +
          "and bottom 250px for critical content (platform UI overlays). One " +
          "message per story — never split. CTA can be implied (URL sticker " +
          "placement) but not rendered.",
      },
      {
        id: "carousel",
        label: "Carousel",
        descriptor: "multi-slide swipe",
        prompt:
          "Output is a multi-slide carousel (4-8 slides). Each slide is a single " +
          "<section> at 1080×1080 (1:1) or 1080×1350 (4:5). Slide 1 is the hook " +
          "(headline + visual cue to swipe). Slides 2..n-1 each carry ONE idea — " +
          "no walls of text, no nested grids. Last slide is the CTA. Consistent " +
          "type scale + brand mark position across all slides — the swipe should " +
          "feel like one document, not eight posters glued together.",
      },
    ],
  },
  {
    id: "video",
    label: "Video",
    hint: "time-based · MP4 via HyperFrames",
    items: [
      {
        id: "explainer",
        label: "Explainer",
        descriptor: "didactic · scene-based",
        prompt:
          "Output is a single self-contained HTML file rendered by Puppeteer at " +
          "a fixed viewport, captured frame-by-frame at 30fps. Animation is " +
          "100% CSS @keyframes with explicit animation-delay — NO setTimeout, " +
          "NO Math.random without seed, NO scroll, NO interactivity. Wrap each " +
          "scene in a <section data-scene='01' data-start='0' data-duration='3' " +
          "data-name='Opening'>...</section>. Emit a <script type='application/" +
          "df-manifest'> JSON at end of body listing scenes (id, name, start, " +
          "duration) for the editor. Every visible element TEACHES — one new " +
          "idea every 1.5-2.5s. Transform + opacity only (60fps). No fade-in " +
          "default, no particle field, no mesh-gradient orbs.",
      },
      {
        id: "hero-loop",
        label: "Hero loop",
        descriptor: "4-8s seamless loop",
        prompt:
          "Output is a seamless looping video, 4-8s, designed to repeat without " +
          "visible cut. animation-iteration-count: infinite on the main loop. " +
          "Single composition that breathes — one element transforming, looping " +
          "back to start state. No scene contract, no manifest needed (single " +
          "scene). Aspect determined by canvas selection. Decorative role — " +
          "no copy beyond a wordmark, no CTA. Transform + opacity only.",
      },
      {
        id: "logo-reveal",
        label: "Logo reveal",
        descriptor: "2-4s brand mark",
        prompt:
          "Output is a 2-4s brand reveal. Single scene, single mark. Sequence: " +
          "negative space → element(s) enter (mask, clip-path, scale, or stroke " +
          "draw) → settle on final logo for the last ~25% of the duration. End " +
          "frame must read as a clean static logo (so the last frame is " +
          "thumbnail-safe). Background is solid or one subtle gradient consistent " +
          "with the brand. Sound out of scope (silent MP4).",
      },
    ],
  },
  {
    id: "print",
    label: "Print",
    hint: "static · ratio-locked · print-safe",
    items: [
      {
        id: "poster",
        label: "Poster",
        descriptor: "A2 / A3 / 18×24",
        prompt:
          "Output is a single static poster composition. Aspect determined by " +
          "canvas selection (A2 / A3 / 18×24 / custom). Single viewport — no " +
          "scroll, no fold. One dominant typographic anchor (headline OR " +
          "imagery, not both fighting). Hierarchy resolves with weight + scale, " +
          "not color. Print-safe color: avoid pure RGB blues that won't survive " +
          "CMYK; prefer rich blacks (C 60 / M 40 / Y 40 / K 100 emulation in " +
          "OKLCH). Bleed: leave at least 5% margin on critical type.",
      },
    ],
  },
]);

// ─── Runtime store (overrides + customs + disabled + hidden) ──────────

let _customCategories: FormatCategory[] = [];
let _disabledIds: Set<string> = new Set();
// builtin items permanently hidden (e.g. user deleted "Story" from
// Social) — distinct from _disabledIds (soft hide). Composite ids
// `${categoryId}/${itemId}`. Reset via "Resetar tudo".
let _hiddenBuiltinItems: Set<string> = new Set();
let _hiddenBuiltinCategories: Set<string> = new Set();

export function getCustomFormatCategories(): FormatCategory[] {
  return _customCategories.map((c) => ({ ...c, items: [...c.items] }));
}
export function setCustomFormatCategories(arr: FormatCategory[]): void {
  _customCategories = arr.map((c) => ({ ...c, items: [...c.items] }));
}
export function getDisabledFormatItemIds(): string[] {
  return [..._disabledIds];
}
export function setDisabledFormatItemIds(ids: string[]): void {
  _disabledIds = new Set(ids);
}
export function getHiddenBuiltinFormatItemIds(): string[] {
  return [..._hiddenBuiltinItems];
}
export function setHiddenBuiltinFormatItemIds(ids: string[]): void {
  _hiddenBuiltinItems = new Set(ids);
}
export function getHiddenBuiltinFormatCategoryIds(): string[] {
  return [..._hiddenBuiltinCategories];
}
export function setHiddenBuiltinFormatCategoryIds(ids: string[]): void {
  _hiddenBuiltinCategories = new Set(ids);
}

/**
 * Effective taxonomy = defaults merged with custom categories. Custom
 * categories with a duplicate id REPLACE the default. Disabled item ids
 * are stripped from the items array.
 */
export function getEffectiveFormatTaxonomy(): FormatCategory[] {
  const customById = new Map(_customCategories.map((c) => [c.id, c]));
  const merged: FormatCategory[] = [];
  for (const def of DEFAULT_FORMAT_TAXONOMY) {
    const custom = customById.get(def.id);
    const cat = custom ?? def;
    customById.delete(def.id);
    const items = cat.items.filter((it) => !_disabledIds.has(`${cat.id}/${it.id}`));
    merged.push({ ...cat, items });
  }
  // Append remaining custom categories (new ones not shadowing defaults).
  for (const cat of customById.values()) {
    const items = cat.items.filter((it) => !_disabledIds.has(`${cat.id}/${it.id}`));
    merged.push({ ...cat, items });
  }
  return merged;
}

export function findFormatItem(
  sel: FormatSelection | null,
): { category: FormatCategory; item: FormatItem } | null {
  if (!sel) return null;
  const taxonomy = getEffectiveFormatTaxonomy();
  const category = taxonomy.find((c) => c.id === sel.categoryId);
  if (!category) return null;
  const item = category.items.find((i) => i.id === sel.itemId);
  if (!item) return null;
  return { category, item };
}

export function describeFormatSelection(
  sel: FormatSelection | null,
  /** Optional localized resolvers. Kept optional so existing tests + CLI
   *  call sites still get canonical EN labels. */
  i18n?: {
    catLabel: (cat: FormatCategory) => string;
    itemLabel: (catId: string, item: FormatItem) => string;
  },
): string | null {
  const found = findFormatItem(sel);
  if (!found) return null;
  const cat = i18n?.catLabel(found.category) ?? found.category.label;
  const item = i18n?.itemLabel(found.category.id, found.item) ?? found.item.label;
  return `${cat} · ${item}`;
}

// ─── : Export / Import / Reset helpers ─────────────────────────────

/** Snapshot for export. Forward-compat: includes all custom slots. */
export interface FormatTaxonomyExportV1 {
  schema: "df.format-taxonomy.v1";
  exportedAt: string;
  customCategories: FormatCategory[];
  disabledIds: string[];
  hiddenBuiltinItemIds: string[];
  hiddenBuiltinCategoryIds: string[];
}

export function buildFormatTaxonomyExport(): FormatTaxonomyExportV1 {
  return {
    schema: "df.format-taxonomy.v1",
    exportedAt: new Date().toISOString(),
    customCategories: getCustomFormatCategories(),
    disabledIds: getDisabledFormatItemIds(),
    hiddenBuiltinItemIds: getHiddenBuiltinFormatItemIds(),
    hiddenBuiltinCategoryIds: getHiddenBuiltinFormatCategoryIds(),
  };
}

const FormatTaxonomyExportSchema = z.object({
  schema: z.literal("df.format-taxonomy.v1"),
  exportedAt: z.string().optional(),
  customCategories: z.array(FormatCategorySchema),
  disabledIds: z.array(z.string()).default([]),
  hiddenBuiltinItemIds: z.array(z.string()).default([]),
  hiddenBuiltinCategoryIds: z.array(z.string()).default([]),
});

export function parseFormatTaxonomyImport(raw: unknown): FormatTaxonomyExportV1 {
  return FormatTaxonomyExportSchema.parse(raw) as FormatTaxonomyExportV1;
}
