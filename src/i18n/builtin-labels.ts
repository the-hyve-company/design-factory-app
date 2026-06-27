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
  // Anti-slop
  "as-no-shadcn-default": {
    pt: "Fuja do visual shadcn/Tailwind padrão",
    en: "Override the default shadcn/Tailwind look",
  },
  "as-no-generic-ai-gradient": { pt: "Sem gradiente genérico de IA", en: "No generic AI gradient" },
  "as-no-gradient-text": { pt: "Sem título com gradiente", en: "No gradient-filled headline text" },
  "as-no-unprompted-glow": { pt: "Sem glow neon gratuito", en: "No unprompted neon glow" },
  "as-no-decorative-emojis": { pt: "Sem emoji como ícone", en: "No emojis as icons" },
  "as-no-invented-decoration": { pt: "Sem decoração inventada", en: "No invented decoration" },
  "as-no-default-glassmorphism": {
    pt: "Sem glassmorphism por padrão",
    en: "No default glassmorphism",
  },
  "as-no-effect-stacking": { pt: "Sem empilhar efeitos", en: "No stacked effects" },
  "as-no-aurora-bg": { pt: "Sem fundo aurora/mesh/blob", en: "No aurora / mesh / blob background" },
  "as-no-decorative-bg-pattern": {
    pt: "Sem padrão decorativo no fundo",
    en: "No decorative background pattern",
  },
  "as-no-tasteful-default-cliche": {
    pt: 'Evite o clichê do "default com bom gosto"',
    en: 'Avoid the "tasteful default" cliché',
  },
  "as-break-perfect-symmetry": {
    pt: "Quebre a simetria perfeita com intenção",
    en: "Break perfect symmetry with intention",
  },
  "as-soul-80-20": { pt: "80% provado, 20% distintivo", en: "80% proven, 20% distinctive" },
  // Layout
  "ly-generous-spacing": {
    pt: "Espaçamento generoso e intencional",
    en: "Generous, intentional spacing",
  },
  "ly-clear-hierarchy": { pt: "Um ponto focal claro", en: "One clear focal point" },
  "ly-spacing-scale": { pt: "Espaçamento numa escala", en: "Spacing on a scale" },
  "ly-padding-ratio": { pt: "Padding horizontal > vertical", en: "Horizontal padding > vertical" },
  "ly-dont-center-everything": { pt: "Não centralize tudo", en: "Don't center everything" },
  "ly-no-hero-three-card": {
    pt: "Quebre o clichê hero + 3 cards",
    en: "Break the hero + 3-card cliché",
  },
  "ly-no-uniform-bento": { pt: "Sem bento grid uniforme", en: "No uniform bento grid" },
  "ly-grid-system": { pt: "Alinhe a um grid", en: "Align to a grid" },
  "ly-concentric-radius": { pt: "Raios de canto concêntricos", en: "Concentric corner radii" },
  "ly-vary-density": { pt: "Varie a densidade das seções", en: "Vary section density" },
  "ly-optical-alignment": { pt: "Alinhe opticamente", en: "Align optically" },
  "ly-no-fake-logo-cloud": { pt: "Sem nuvem de logos de enchimento", en: "No filler logo cloud" },
  // Typography
  "ty-limited-type-scale": { pt: "Escala tipográfica enxuta", en: "Use a limited type scale" },
  "ty-weight-for-hierarchy": {
    pt: "Hierarquia por peso, não só tamanho",
    en: "Weight, not just size, builds hierarchy",
  },
  "ty-comfortable-measure": { pt: "Medida de linha confortável", en: "Keep a comfortable measure" },
  "ty-body-min-16": { pt: "Corpo de texto ≥16px", en: "Body text ≥16px" },
  "ty-line-height": { pt: "Entrelinha conforme o papel", en: "Line-height by role" },
  "ty-no-default-fonts": { pt: "Sem fontes default do sistema", en: "No default system fonts" },
  "ty-display-font-on-headings": {
    pt: "Títulos na fonte de display",
    en: "Headings use the display face",
  },
  "ty-text-wrap": { pt: "Quebra de linha caprichada", en: "Tidy wrapping" },
  "ty-font-smoothing": { pt: "Suavize o texto no escuro", en: "Smooth text on dark" },
  "ty-smart-quotes": { pt: "Aspas e apóstrofos tipográficos", en: "Curly quotes and apostrophes" },
  "ty-tabular-nums": { pt: "Números tabulares em dados", en: "Tabular figures for data" },
  "ty-no-hover-type-shift": { pt: "Não mexa no texto no hover", en: "Don't reflow type on hover" },
  "ty-underline-links-only": { pt: "Sublinhado só em link", en: "Underline means link" },
  "ty-no-bold-italic-stack": { pt: "Um eixo de ênfase por vez", en: "One emphasis axis at a time" },
  "ty-sentence-case": { pt: "Sentence case na interface", en: "Sentence case for UI" },
  // Color
  "co-few-colors-neutral-base": { pt: "Poucas cores, base neutra", en: "Few colors, neutral base" },
  "co-no-raw-black": { pt: "Sem preto ou branco puro", en: "No pure black or white" },
  "co-accent-sparingly": { pt: "Use o acento com parcimônia", en: "Ration the accent" },
  "co-one-accent": { pt: "Apenas um acento", en: "One accent only" },
  "co-oklch": { pt: "Defina cor em OKLCH", en: "Author color in OKLCH" },
  "co-chroma-budget": { pt: "Controle o chroma", en: "Budget the chroma" },
  "co-semantic-token-names": { pt: "Nomeie tokens por propósito", en: "Name tokens by purpose" },
  "co-no-tailwind-indigo": {
    pt: "Sem o indigo padrão do Tailwind",
    en: "No default Tailwind indigo",
  },
  "co-functional-gradient": {
    pt: "Gradiente separa, não enfeita",
    en: "Gradients separate, don't decorate",
  },
  "co-dark-translucent-borders": {
    pt: "Bordas translúcidas no escuro",
    en: "Translucent borders on dark",
  },
  "co-12-step-ramp": { pt: "Rampa de 12 passos por papel", en: "A 12-step role ramp" },
  "co-hover-active-from-ramp": { pt: "Estados andam na rampa", en: "States step the ramp" },
  "co-state-by-token": { pt: "Estados semânticos por token", en: "Semantic states use tokens" },
  "co-no-pure-saturated-on-white": {
    pt: "Suavize a cor de marca no texto",
    en: "Tame brand color for text",
  },
  // Depth
  "de-consistent-radius": { pt: "Um sistema de raio", en: "One radius system" },
  "de-shadow-blur-ratio": { pt: "Sombras suaves e plausíveis", en: "Soft, plausible shadows" },
  "de-no-shadow-dark": { pt: "Sem drop shadow no escuro", en: "No drop shadows on dark" },
  "de-shadow-over-border": { pt: "Sombra em vez de borda pesada", en: "Shadow beats heavy border" },
  "de-nested-brightness": { pt: "Passos suaves de aninhamento", en: "Gentle nesting steps" },
  "de-single-elevation-system": { pt: "Uma escala de elevação", en: "One elevation scale" },
  "de-image-outline": { pt: "Borda hairline nas imagens", en: "Hairline edge on images" },
  "de-one-treatment": {
    pt: "Um tratamento de profundidade por elemento",
    en: "One depth treatment per element",
  },
  // Motion
  "mo-gpu-only-props": { pt: "Anime só props de composição", en: "Animate only compositor props" },
  "mo-honor-reduced-motion": { pt: "Respeite reduced-motion", en: "Honor reduced motion" },
  "mo-no-transition-all": { pt: "Nunca `transition: all`", en: "Never `transition: all`" },
  "mo-duration-by-type": { pt: "Duração conforme a interação", en: "Duration by interaction type" },
  "mo-micro-under-500": { pt: "Microinterações <500ms", en: "Microinteractions <500ms" },
  "mo-ease-out-enter": {
    pt: "Ease-out na entrada, acelera na saída",
    en: "Ease-out in, accelerate out",
  },
  "mo-curve-vs-spring": {
    pt: "Curva vs spring conforme a prop",
    en: "Curve vs spring by property",
  },
  "mo-m3-easing": { pt: "Use o easing real do M3", en: "Use the real M3 easing" },
  "mo-press-scale": { pt: "Escala de clique comedida", en: "Sane press scale" },
  "mo-dialog-not-scale-zero": {
    pt: "Diálogos não nascem do zero",
    en: "Dialogs don't grow from zero",
  },
  "mo-linear-only-loops": { pt: "`linear` só em loop", en: "`linear` only for loops" },
  "mo-will-change-sparingly": {
    pt: "`will-change` com parcimônia",
    en: "`will-change` with restraint",
  },
  "mo-selective-reveal": {
    pt: "Revele com parcimônia no scroll",
    en: "Reveal sparingly on scroll",
  },
  "mo-no-endless-loop": { pt: "Sem movimento ambiente infinito", en: "No endless ambient motion" },
  "mo-css-spring": { pt: "Spring sem framework", en: "Spring feel without a framework" },
  // Imagery
  "im-no-stock-cdn": { pt: "Sem CDN de imagem placeholder", en: "No placeholder image CDNs" },
  "im-aspect-ratio": { pt: "Reserve o espaço da imagem", en: "Reserve image space" },
  "im-no-distortion": { pt: "Nunca distorça imagens", en: "Never distort images" },
  "im-overlay-legible": { pt: "Texto sobre imagem legível", en: "Keep text on images legible" },
  "im-subtle-outline": { pt: "Assente a imagem na superfície", en: "Seat images on the surface" },
  "im-consistent-treatment": { pt: "Um tratamento de imagem", en: "One image treatment" },
  // Icons
  "ic-monoline-stroke": { pt: "Um conjunto de ícones monoline", en: "One monoline icon set" },
  "ic-currentcolor": { pt: "Ícones herdam a cor", en: "Icons inherit color" },
  "ic-clarify-not-decorate": {
    pt: "Ícone esclarece, não enfeita",
    en: "Icons clarify, not decorate",
  },
  "ic-optical-size": { pt: "Dimensione e alinhe opticamente", en: "Optically size and align" },
  // Forms
  "fo-label-every-input": {
    pt: "Todo campo com label de verdade",
    en: "Every input has a real label",
  },
  "fo-error-wiring": { pt: "Ligue o erro ao campo", en: "Wire errors to the field" },
  "fo-inline-validation": { pt: "Valide inline, no blur", en: "Validate inline, on blur" },
  "fo-error-actionable": { pt: "Erros de campo acionáveis", en: "Actionable field errors" },
  "fo-no-redundant-entry": { pt: "Não repita o que já sabe", en: "Don't re-ask known data" },
  "fo-correct-input-types": { pt: "Tipos de input corretos", en: "Correct input types" },
  "fo-no-reset-button": { pt: "Sem reset destrutivo", en: "No destructive reset" },
  "fo-submit-state": { pt: "Proteja o envio", en: "Guard the submit" },
  "fo-mark-optional": {
    pt: "Marque o opcional, sem mar de asteriscos",
    en: "Mark optional, not asterisk soup",
  },
  // States
  "st-design-empty-error": {
    pt: "Desenhe todo estado, não só o caminho feliz",
    en: "Design every state, not just happy path",
  },
  "st-eight-states": { pt: "Cubra os estados interativos", en: "Cover interactive states" },
  "st-loading-pattern": { pt: "Padrão de loading certo", en: "Right loading pattern" },
  "st-optimistic-ui": { pt: "Otimista, depois confirma", en: "Optimistic, then confirm" },
  "st-selected-not-hover": { pt: "Selecionado ≠ hover", en: "Selected ≠ hover" },
  "st-active-no-state-lines": {
    pt: "Ativo por preenchimento, não barra",
    en: "Active by fill, not bars",
  },
  "st-focus-visible": { pt: "Foco de teclado visível", en: "Visible keyboard focus" },
  "st-disabled-legible": { pt: "Desabilitado continua legível", en: "Disabled stays readable" },
  "st-error-actionable": { pt: "Erro diz o que fazer", en: "Errors say what to do" },
  "st-empty-onboards": { pt: "Estado vazio que orienta", en: "Empty state onboards" },
  // Accessibility
  "a11y-contrast-aa": { pt: "Contraste WCAG 2.2 AA", en: "Meet WCAG 2.2 AA contrast" },
  "a11y-focus-visible": { pt: "Mantenha o foco visível", en: "Keep focus visible" },
  "a11y-keyboard": { pt: "Operável 100% por teclado", en: "Fully keyboard-operable" },
  "a11y-native-elements": { pt: "Elementos nativos primeiro", en: "Native elements first" },
  "a11y-alt-text": { pt: "Alternativas em texto", en: "Text alternatives" },
  "a11y-html-lang": { pt: "Declare o idioma", en: "Declare the language" },
  "a11y-heading-order": { pt: "Ordem de headings coerente", en: "Sane heading order" },
  "a11y-landmarks": { pt: "Use landmarks", en: "Use landmarks" },
  "a11y-no-invent-aria": { pt: "Nunca invente ARIA", en: "Never invent ARIA" },
  "a11y-target-size": { pt: "Alvo de toque adequado", en: "Adequate target size" },
  // Copy
  "cp-no-generic-copy": { pt: "Sem copy de marketing genérica", en: "No generic marketing copy" },
  "cp-no-fake-metrics": { pt: "Sem métricas inventadas", en: "No invented metrics" },
  "cp-no-em-dash-tell": {
    pt: "Corte os tells de pontuação de IA",
    en: "Cut the AI punctuation tells",
  },
  "cp-actionable-buttons": { pt: "Verbos nos botões", en: "Verbs on buttons" },
  "cp-sentence-case": { pt: "Sentence case na interface", en: "Sentence case in UI" },
  "cp-no-filler": { pt: "Sem texto de enchimento", en: "No filler copy" },
  // i18n & RTL
  "i18n-logical-properties": {
    pt: "Propriedades lógicas, não físicas",
    en: "Logical, not physical, properties",
  },
  "i18n-rtl-aware": { pt: "Respeite a direção (RTL)", en: "Respect direction" },
  "i18n-locale-format": { pt: "Localize números e datas", en: "Localize numbers and dates" },
  "i18n-room-to-expand": { pt: "Deixe espaço pra tradução", en: "Leave room for translation" },
  // Laws of UX
  "lux-fitts": {
    pt: "Tamanho e posição por frequência (Fitts)",
    en: "Size and place by frequency (Fitts)",
  },
  "lux-hick": { pt: "Reduza as escolhas (Hick)", en: "Reduce choices (Hick)" },
  "lux-miller": { pt: "Agrupe em blocos (Miller)", en: "Chunk into groups (Miller)" },
  "lux-jakob": { pt: "Siga as convenções (Jakob)", en: "Match conventions (Jakob)" },
  "lux-proximity": { pt: "Agrupe por proximidade (Gestalt)", en: "Group by proximity (Gestalt)" },
  "lux-aesthetic-usability": {
    pt: "Acabamento ajuda, não substitui",
    en: "Polish helps, doesn't replace",
  },
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
