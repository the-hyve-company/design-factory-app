// builtin-labels.ts — i18n table for canonical builtin labels.
//
// Why separate from strings.ts:
//   · Builtins live in src/data/* with English ids + display labels. Those
//     ids are CANONICAL (saved to disk, exported in JSON, used as keys in
//     selections). The label text is what surfaces in the UI and needs
//     to flip pt↔en.
//   · Keeping these keyed by canonical id (not by a separate i18n key)
//     means the data files stay the source-of-truth — no double bookkeeping
//     on rename, no missing-key surprises.
//   · Customs flow through the same lookup with no entries here, falling
//     back to whatever the user typed (already correct for them).
//
// Lookup contract:
//   getBuiltinCanvasLabel("free", lang)           → "Livre" | "Free"
//   getBuiltinCanvasHint("free", lang)            → "sem canvas fixo" | "no fixed canvas"
//   getBuiltinFormatItemLabel("video", "demo", l) → "Demo" (kept canonical · same in both)
//   getBuiltinFormatCategoryLabel("video", lang)  → "Vídeo" | "Video"
//   getBuiltinRuleTitle("as-no-emojis", lang)     → "Sem emojis" | "No emojis"
//
// Each lookup returns null when the id is not a builtin (custom item) so
// callers can fall back to the data row's own .label/.title field.

import type { Lang } from "./strings";

interface Pair {
  pt: string;
  en: string;
}

/** Resolve a Pair to a string under the active lang.
 *  xx (debug pseudo-locale) wraps pt with ⟨…⟩ markers — same semantics as
 *  STRINGS.xx in strings.ts: translated values get markers; unwrapped
 *  literals (i18n gaps) appear without markers. */
function pick(p: Pair, lang: Lang): string {
  if (lang === "xx") return `⟨${p.pt}⟩`;
  return p[lang];
}

// ─── Canvas presets ────────────────────────────────────────────────────

const CANVAS_PRESET_LABELS: Record<string, Pair> = {
  free: { pt: "Livre", en: "Free" },
  "1080-1080": { pt: "Quadrado", en: "Square" },
  "1920-1080": { pt: "Hero web", en: "Web Hero" },
  "1080-1920": { pt: "Story", en: "Story" },
  "1080-1350": { pt: "Retrato", en: "Portrait" },
  "1200-630": { pt: "OG Image", en: "OG Image" },
  a4: { pt: "Print A4", en: "Print A4" },
  "1080-canvas": { pt: "Card", en: "Card" },
};

const CANVAS_PRESET_HINTS: Record<string, Pair> = {
  free: { pt: "sem canvas fixo", en: "no fixed canvas" },
  "1080-canvas": { pt: "marca de canvas", en: "canvas marker" },
};

export function getBuiltinCanvasLabel(id: string, lang: Lang): string | null {
  const v = CANVAS_PRESET_LABELS[id];
  return v ? pick(v, lang) : null;
}

export function getBuiltinCanvasHint(id: string, lang: Lang): string | null {
  const v = CANVAS_PRESET_HINTS[id];
  return v ? pick(v, lang) : null;
}

// ─── Format categories ─────────────────────────────────────────────────

const FORMAT_CATEGORY_LABELS: Record<string, Pair> = {
  video: { pt: "Vídeo", en: "Video" },
  interface: { pt: "Interface", en: "Interface" },
  social: { pt: "Social", en: "Social" },
  print: { pt: "Impressão", en: "Print" },
  other: { pt: "Outros", en: "Other" },
};

const FORMAT_CATEGORY_HINTS: Record<string, Pair> = {
  video: { pt: "saída em MP4 via render headless", en: "MP4 outputs via headless render" },
  interface: { pt: "telas estáticas · saída em HTML", en: "static screens · HTML output" },
  social: { pt: "para feed · com ratio fixo", en: "feed-friendly · ratio-locked" },
  print: { pt: "saída física · feel CMYK", en: "physical output · CMYK feel" },
  other: { pt: "sem categoria", en: "uncategorized" },
};

export function getBuiltinFormatCategoryLabel(catId: string, lang: Lang): string | null {
  const v = FORMAT_CATEGORY_LABELS[catId];
  return v ? pick(v, lang) : null;
}

export function getBuiltinFormatCategoryHint(catId: string, lang: Lang): string | null {
  const v = FORMAT_CATEGORY_HINTS[catId];
  return v ? pick(v, lang) : null;
}

// ─── Format subitems (composite key cat/item) ──────────────────────────

const FORMAT_ITEM_LABELS: Record<string, Pair> = {
  // Video
  "video/explainer": { pt: "Explicação", en: "Explainer" },
  "video/demo": { pt: "Demo", en: "Demo" },
  "video/intro-outro": { pt: "Intro / outro", en: "Intro / outro" },
  "video/transition": { pt: "Transição", en: "Transition" },
  "video/brand-reel": { pt: "Brand reel", en: "Brand reel" },
  // Interface
  "interface/landing": { pt: "Landing page", en: "Landing page" },
  "interface/dashboard": { pt: "Dashboard", en: "Dashboard" },
  "interface/app-screen": { pt: "Tela de app", en: "App screen" },
  "interface/email": { pt: "E-mail", en: "Email" },
  "interface/documentation": { pt: "Documentação", en: "Documentation" },
  // Social
  "social/post": { pt: "Post", en: "Post" },
  "social/story": { pt: "Story", en: "Story" },
  "social/reel": { pt: "Reel", en: "Reel" },
  "social/thread": { pt: "Thread", en: "Thread" },
  "social/header-banner": { pt: "Banner de capa", en: "Header banner" },
  // Print
  "print/poster": { pt: "Pôster", en: "Poster" },
  "print/business-card": { pt: "Cartão", en: "Business card" },
  "print/brochure": { pt: "Folder", en: "Brochure" },
  "print/flyer": { pt: "Flyer", en: "Flyer" },
  // Other
  "other/free": { pt: "Livre / sem definição", en: "Free / unspecified" },
};

const FORMAT_ITEM_DESCRIPTORS: Record<string, Pair> = {
  "video/explainer": { pt: "didático · denso", en: "didactic · dense" },
  "video/demo": { pt: "passo a passo de feature", en: "feature walkthrough" },
  "video/intro-outro": { pt: "abertura/encerramento", en: "branded bookend" },
  "video/transition": { pt: "ponte entre cenas", en: "shot bridge" },
  "video/brand-reel": { pt: "loop · ambiente", en: "loop · ambient" },
  "interface/landing": { pt: "hero · seções · CTA", en: "hero · sections · CTA" },
  "interface/dashboard": { pt: "denso · painéis", en: "data dense · panels" },
  "interface/app-screen": { pt: "uma única tela", en: "single view" },
  "interface/email": { pt: "HTML pra inbox", en: "inbox-safe HTML" },
  "interface/documentation": { pt: "referência longa", en: "longform reference" },
  "social/post": { pt: "card de feed", en: "feed card" },
  "social/story": { pt: "9:16 vertical", en: "9:16 vertical" },
  "social/reel": { pt: "vídeo curto em loop", en: "short video loop" },
  "social/thread": { pt: "narrativa em frames", en: "multi-frame narrative" },
  "social/header-banner": { pt: "perfil / canal", en: "profile / channel art" },
  "print/poster": { pt: "parede · expositor", en: "wall · display" },
  "print/business-card": { pt: "85×55mm", en: "85×55mm" },
  "print/brochure": { pt: "dobras · multi-painéis", en: "fold · multi-panel" },
  "print/flyer": { pt: "folha única", en: "single sheet" },
  "other/free": { pt: "ainda sem compromisso", en: "no commitment yet" },
};

export function getBuiltinFormatItemLabel(
  catId: string,
  itemId: string,
  lang: Lang,
): string | null {
  const v = FORMAT_ITEM_LABELS[`${catId}/${itemId}`];
  return v ? pick(v, lang) : null;
}

export function getBuiltinFormatItemDescriptor(
  catId: string,
  itemId: string,
  lang: Lang,
): string | null {
  const v = FORMAT_ITEM_DESCRIPTORS[`${catId}/${itemId}`];
  return v ? pick(v, lang) : null;
}

// ─── Rules — categories ────────────────────────────────────────────────
// Already covered by strings.ts ("rules.cat.*"), kept here as fallback
// for components that already pass raw category labels.

// ─── Rules — builtin titles + descriptions ─────────────────────────────

// Titles for the 50 brand-agnostic visual-taste defaults. The EN value
// here MUST match the canonical `title` field on the rule in
// rules-taxonomy.ts — that file is the source of truth for the EN copy,
// and the `pick()` fallback picks EN from this map when lang === "en" to
// keep the i18n table self-contained.
const RULE_TITLES: Record<string, Pair> = {
  // PT labels carried over from the legacy 50 where the EN title still
  // matches the ported library. Remaining 132-rule library PT labels
  // land in the i18n follow-up (df-rules-library port, step 3b).
  "as-no-invented-decoration": { pt: "Sem decoração inventada", en: "No invented decoration" },
  "as-no-generic-ai-gradient": { pt: "Sem gradiente genérico de IA", en: "No generic AI gradient" },
  "as-no-default-glassmorphism": {
    pt: "Sem glassmorphism por default",
    en: "No default glassmorphism",
  },
  "as-no-effect-stacking": { pt: "Sem empilhar efeitos", en: "No stacked effects" },
  "ly-dont-center-everything": { pt: "Não centralizar tudo", en: "Don't center everything" },
  "ly-clear-hierarchy": { pt: "Hierarquia clara", en: "One clear focal point" },
  "co-few-colors-neutral-base": { pt: "Poucas cores, base neutra", en: "Few colors, neutral base" },
  "mo-honor-reduced-motion": { pt: "Respeitar reduced-motion", en: "Honor reduced motion" },
};

// Full PT translations of the EN descriptions in rules-taxonomy.ts.
// Same shape (problem to avoid + concrete move). When `lang === "pt"` is
// active these get injected into the system prompt instead of the EN
// version, so the model receives instructions in the same language the
// user is writing in.
const RULE_DESCRIPTIONS: Record<string, Pair> = {
  // Cleared on the 132-rule library port: every description moved to the
  // ✗/✓ format, so EN is the model voice (rules-taxonomy.ts) and callers
  // fall back to it. PT descriptions return in the i18n follow-up.
};

export function getBuiltinRuleTitle(id: string, lang: Lang): string | null {
  const v = RULE_TITLES[id];
  return v ? pick(v, lang) : null;
}

export function getBuiltinRuleDescription(id: string, lang: Lang): string | null {
  const v = RULE_DESCRIPTIONS[id];
  return v ? pick(v, lang) : null;
}

// ─── Generic helpers (canonical-or-translated) ─────────────────────────

/** Canvas preset name with i18n fallback to the data row's own .name. */
export function canvasLabel(preset: { id: string; name: string }, lang: Lang): string {
  return getBuiltinCanvasLabel(preset.id, lang) ?? preset.name;
}

/** Canvas preset hint with i18n fallback. Empty string if no hint. */
export function canvasHint(preset: { id: string; hint?: string }, lang: Lang): string {
  return getBuiltinCanvasHint(preset.id, lang) ?? preset.hint ?? "";
}

/** Format category label with i18n fallback. */
export function formatCategoryLabel(cat: { id: string; label: string }, lang: Lang): string {
  return getBuiltinFormatCategoryLabel(cat.id, lang) ?? cat.label;
}

/** Format category hint with i18n fallback. */
export function formatCategoryHint(cat: { id: string; hint?: string }, lang: Lang): string {
  return getBuiltinFormatCategoryHint(cat.id, lang) ?? cat.hint ?? "";
}

/** Format item label with i18n fallback. */
export function formatItemLabel(
  catId: string,
  item: { id: string; label: string },
  lang: Lang,
): string {
  return getBuiltinFormatItemLabel(catId, item.id, lang) ?? item.label;
}

/** Format item descriptor with i18n fallback. */
export function formatItemDescriptor(
  catId: string,
  item: { id: string; descriptor?: string },
  lang: Lang,
): string {
  return getBuiltinFormatItemDescriptor(catId, item.id, lang) ?? item.descriptor ?? "";
}

/** Rule title with i18n fallback. Customs (no entry) return their own title. */
export function ruleTitle(rule: { id: string; title: string }, lang: Lang): string {
  return getBuiltinRuleTitle(rule.id, lang) ?? rule.title;
}

/** Rule description with i18n fallback. */
export function ruleDescription(rule: { id: string; description?: string }, lang: Lang): string {
  return getBuiltinRuleDescription(rule.id, lang) ?? rule.description ?? "";
}
