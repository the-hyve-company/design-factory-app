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
  "as-no-decorative-emojis": { pt: "Sem emojis decorativos", en: "No decorative emojis" },
  "as-no-invented-decoration": { pt: "Sem decoração inventada", en: "No invented decoration" },
  "as-no-generic-ai-gradient": { pt: "Sem gradiente genérico de IA", en: "No generic AI gradient" },
  "as-no-default-glassmorphism": {
    pt: "Sem glassmorphism por default",
    en: "No default glassmorphism",
  },
  "as-no-effect-stacking": { pt: "Sem empilhar efeitos", en: "No stacked effects" },
  // Layout
  "ly-generous-spacing": { pt: "Espaço pra respirar", en: "Generous, consistent spacing" },
  "ly-no-card-bars": { pt: "Sem barras decorativas em card", en: "No card bars or accents" },
  "ly-dont-center-everything": { pt: "Não centralizar tudo", en: "Don't center everything" },
  "ly-consistent-alignment-edges": {
    pt: "Bordas de alinhamento consistentes",
    en: "Consistent alignment edges",
  },
  "ly-proximity-grouping": { pt: "Agrupar por proximidade", en: "Group by proximity" },
  "ly-clear-hierarchy": { pt: "Hierarquia clara", en: "One clear focal point" },
  "ly-optical-alignment": { pt: "Alinhamento óptico", en: "Optical alignment" },
  // Typography
  "ty-limited-type-scale": { pt: "Escala tipográfica enxuta", en: "Limited type scale" },
  "ty-tabular-figures": { pt: "Tabular figures para números", en: "Tabular figures for numbers" },
  "ty-comfortable-measure": {
    pt: "Medida e entrelinha confortáveis",
    en: "Comfortable measure & leading",
  },
  "ty-one-or-two-typefaces": { pt: "Uma ou duas fontes", en: "One or two typefaces" },
  "ty-weight-for-hierarchy": {
    pt: "Hierarquia por peso, não por cor",
    en: "Weight for hierarchy, not color",
  },
  "ty-no-justify-long-text": { pt: "Não justificar texto longo", en: "Don't justify long text" },
  "ty-tracking-by-size": { pt: "Tracking por tamanho", en: "Tracking by size" },
  // Color
  "co-honor-existing-palette": {
    pt: "Honrar a paleta existente",
    en: "Honor the existing palette",
  },
  "co-no-raw-black": { pt: "Suavizar preto e branco puros", en: "Soften pure black & white" },
  "co-accent-sparingly": { pt: "Cor de destaque com parcimônia", en: "Accent color sparingly" },
  "co-few-colors-neutral-base": { pt: "Poucas cores, base neutra", en: "Few colors, neutral base" },
  "co-semantic-colors-consistent": {
    pt: "Cores semânticas consistentes",
    en: "Consistent semantic colors",
  },
  "co-desaturate-large-fills": { pt: "Dessaturar áreas grandes", en: "Desaturate large fills" },
  // Depth
  "de-soft-consistent-shadows": {
    pt: "Sombras suaves e consistentes",
    en: "Soft, consistent shadows",
  },
  "de-hairline-borders": {
    pt: "Bordas hairline, baixo contraste",
    en: "Hairline, low-contrast borders",
  },
  "de-consistent-radius": { pt: "Radius consistente", en: "Consistent corner radius" },
  "de-layering-restraint": { pt: "Contenção de camadas", en: "Restrained layering" },
  // Motion
  "mo-motion-serves-meaning": { pt: "Movimento serve significado", en: "Motion serves meaning" },
  "mo-no-decorative-spinners": {
    pt: "Sem spinner decorativo infinito",
    en: "No decorative spinners",
  },
  "mo-honor-reduced-motion": { pt: "Respeitar reduced-motion", en: "Honor reduced motion" },
  "mo-quick-subtle-timing": {
    pt: "Tempos curtos e easing consistente",
    en: "Quick, subtle timing",
  },
  "mo-restrained-entrances": { pt: "Entrada com moderação", en: "Restrained entrances" },
  // Imagery
  "im-preserve-aspect-ratio": { pt: "Preservar proporção", en: "Preserve aspect ratio" },
  "im-consistent-treatment": {
    pt: "Tratamento de imagem uniforme",
    en: "Consistent image treatment",
  },
  "im-overlay-for-legibility": {
    pt: "Overlay pra texto sobre imagem",
    en: "Overlay for text on images",
  },
  "im-avoid-generic-stock": { pt: "Evitar stock genérico", en: "Avoid generic stock" },
  // Icons
  "ic-consistent-set-weight": { pt: "Conjunto de ícones consistente", en: "Consistent icon set" },
  "ic-size-align-to-text": { pt: "Ícone dimensionado ao texto", en: "Size & align icons to text" },
  "ic-icons-clarify-not-decorate": {
    pt: "Ícone esclarece, não enfeita",
    en: "Icons clarify, not decorate",
  },
  // Forms
  "fo-clear-input-affordance": { pt: "Input parece editável", en: "Inputs look editable" },
  "fo-label-above-or-clear": { pt: "Label sempre visível", en: "Keep a visible label" },
  "fo-generous-touch-targets": { pt: "Alvos de toque generosos", en: "Generous touch targets" },
  "fo-align-fields": { pt: "Campos alinhados", en: "Align form fields" },
  // States
  "st-visible-focus": { pt: "Foco visível", en: "Visible focus state" },
  "st-interactive-feedback": { pt: "Feedback de interação", en: "Interactive feedback" },
  "st-design-empty-error": { pt: "Estados vazio e de erro", en: "Design empty & error states" },
  "st-disabled-reads-disabled": {
    pt: "Disabled parece disabled",
    en: "Disabled reads as disabled",
  },
  "st-selected-distinct-from-hover": {
    pt: "Selecionado distinto do hover",
    en: "Selected distinct from hover",
  },
};

// Full PT translations of the EN descriptions in rules-taxonomy.ts.
// Same shape (problem to avoid + concrete move). When `lang === "pt"` is
// active these get injected into the system prompt instead of the EN
// version, so the model receives instructions in the same language the
// user is writing in.
const RULE_DESCRIPTIONS: Record<string, Pair> = {
  // ── Anti-slop
  "as-no-decorative-emojis": {
    pt: "Emojis coloridos como ícone ou bullet (🚀⚡✨🔥) puxam a interface pra tom de chat casual e leem como cara de template. Carregue significado com peso de tipografia e um conjunto de ícones monocromático consistente.",
    en: "Colored emojis used as icons or bullets (🚀⚡✨🔥) pull an interface toward casual chat and read as a default-template tell. Carry meaning through type weight and a consistent monochrome icon set instead.",
  },
  "as-no-invented-decoration": {
    pt: "Gradients, glows, blurs, partículas e fundos animados por enfeite datam o design e competem com o conteúdo. Só use um efeito quando ele se justifica — fora isso, deixe tipografia, espaçamento e uma paleta contida carregarem.",
    en: "Gradients, glows, blurs, particle fields, and animated backgrounds added for their own sake date a design and fight the content. Reach for an effect only when it earns its place — otherwise let type, spacing, and a restrained palette carry it.",
  },
  "as-no-generic-ai-gradient": {
    pt: "O gradiente roxo→azul de hero é cara de template na hora. Se um gradiente se justifica, monte com cores que já estão na paleta e mantenha o salto de hue pequeno e intencional.",
    en: "The violet-to-blue hero gradient is an instant template tell. If a gradient earns its place, build it from colors already in the palette and keep the hue shift small and intentional.",
  },
  "as-no-default-glassmorphism": {
    pt: "Blur fosco semitransparente em toda superfície é default datado e prejudica a legibilidade. Use superfícies sólidas e opacas, a não ser que o blur realmente comunique camada sobre o conteúdo atrás.",
    en: "Frosted, semi-transparent blur on every surface is a dated default that hurts legibility. Use solid, opaque surfaces unless the blur genuinely communicates layering over content behind it.",
  },
  "as-no-effect-stacking": {
    pt: "Empilhar sombra + gradiente + blur + borda + glow num elemento só lê como over-design e fica turvo. Escolha um tratamento por elemento e deixe ele resolver.",
    en: "Piling shadow plus gradient plus blur plus border plus glow onto one element reads as over-designed and muddy. Pick one treatment per element and let it do the work.",
  },
  // ── Layout
  "ly-generous-spacing": {
    pt: "Espaçamento apertado e irregular é o jeito mais rápido de parecer não-finalizado. Dê respiro aos elementos e use um ritmo de espaçamento consistente — whitespace é estrutura, não espaço desperdiçado.",
    en: "Cramped, uneven spacing is the fastest way to look unfinished. Give elements room to breathe and use one consistent spacing rhythm — whitespace is structure, not wasted space.",
  },
  "ly-no-card-bars": {
    pt: "Uma barra colorida no topo ou na lateral do card não adiciona informação e data o design (cara de dashboard 2019). Sinalize hierarquia ou status com o conteúdo do próprio card — um heading mais forte, um dot de status, um fundo tonal.",
    en: "A colored bar stuck on the top or side of a card adds no information and dates the design (the 2019-dashboard look). Signal hierarchy or status with the card's own content — a stronger heading, a small status dot, a tinted background.",
  },
  "ly-dont-center-everything": {
    pt: "Centralizar todo texto e bloco por default é tell e dificulta a leitura de texto longo. Alinhe corpo e conteúdo à esquerda; reserve o centro pra momentos curtos e deliberados, tipo um hero ou um estado vazio.",
    en: "Centering all text and content blocks by default is a tell and makes long copy hard to scan. Left-align body text and content; reserve centering for short, deliberate moments like a hero or an empty state.",
  },
  "ly-consistent-alignment-edges": {
    pt: "Elementos que não compartilham linhas de alinhamento leem como descuido. Alinhe a um conjunto pequeno de bordas comuns ou a um grid, pra colunas, labels e conteúdo travarem nas mesmas verticais.",
    en: "Elements that don't share alignment lines read as careless. Align to a small set of shared edges or a grid so columns, labels, and content snap to the same verticals.",
  },
  "ly-proximity-grouping": {
    pt: "Itens relacionados ficam perto; não-relacionados precisam de um respiro claro. Use espaçamento pra agrupar e separar antes de recorrer a bordas ou caixas — proximidade faz a maior parte do trabalho estrutural.",
    en: "Related items belong close together; unrelated ones need a clear gap. Use spacing to group and separate before reaching for borders or boxes — proximity does most of the structural work.",
  },
  "ly-clear-hierarchy": {
    pt: "Quando tudo compete por atenção, nada vence. Estabeleça um elemento primário por tela e deixe tamanho, peso e espaçamento tornarem a ordem de leitura óbvia.",
    en: "When everything competes for attention, nothing wins. Establish one primary element per screen and let size, weight, and spacing make the reading order obvious.",
  },
  "ly-optical-alignment": {
    pt: "Centralizado na matemática nem sempre é centralizado no olho — ícones com descenders, triângulos e o glifo de play parecem tortos. Confie no olho e ajuste até ler alinhado, em vez de depender só da centralização geométrica.",
    en: "Mathematically centered isn't always visually centered — icons with descenders, triangles, and play glyphs look off. Trust the eye and nudge until it reads aligned rather than relying on geometric centering alone.",
  },
  // ── Typography
  "ty-limited-type-scale": {
    pt: "Muitos tamanhos de fonte ad-hoc fazem o layout parecer montado em vez de desenhado. Escolha um conjunto pequeno de tamanhos com saltos claros e reutilize — hierarquia vem de contraste deliberado, não de um tamanho novo por elemento.",
    en: "Many ad-hoc font sizes make a layout read as assembled rather than designed. Pick a small set of sizes with clear jumps between them and reuse it — hierarchy comes from deliberate contrast, not a new size per element.",
  },
  "ty-tabular-figures": {
    pt: "Dígitos proporcionais mudam de posição entre linhas, então números em tabela, preço e contador não alinham. Use tabular figures (font-variant-numeric: tabular-nums) onde os dígitos precisam alinhar em coluna.",
    en: "Proportional digits shift left and right between rows, so numbers in tables, prices, and counters won't line up. Use tabular figures (font-variant-numeric: tabular-nums) anywhere digits need to align in columns.",
  },
  "ty-comfortable-measure": {
    pt: "Linhas longas demais cansam e entrelinha apertada deixa o parágrafo sufocado. Limite a linha de corpo a ~45-75 caracteres e dê line-height generoso ao corpo; aperte a entrelinha só em display grande.",
    en: "Lines that run too long are hard to read and tight leading makes paragraphs feel cramped. Cap body line length around 45-75 characters and give body text generous line-height; tighten leading only on large display type.",
  },
  "ty-one-or-two-typefaces": {
    pt: "Um zoo de fontes fragmenta o design. Use uma família, ou no máximo uma de display com uma de texto, e crie variedade com peso e tamanho em vez de mais famílias.",
    en: "A font zoo fragments the design. Use one typeface, or at most a display face paired with a text face, and create variety with weight and size instead of more families.",
  },
  "ty-weight-for-hierarchy": {
    pt: "Recorrer a cor ou CAIXA ALTA pra marcar importância polui a paleta e atrapalha a leitura. Conduza hierarquia com tamanho e peso primeiro; cor é accent, não um sistema de título.",
    en: "Reaching for color or ALL CAPS to mark importance clutters the palette and hurts readability. Drive hierarchy with size and weight first; color is an accent, not a heading system.",
  },
  "ty-no-justify-long-text": {
    pt: "Texto justificado na web abre rios irregulares de espaço porque o browser não hifeniza bem. Alinhe o corpo à esquerda (ragged right) pra espaçamento de palavra uniforme e leitura mais estável.",
    en: "Justified text on the web opens uneven rivers of whitespace because browsers lack fine hyphenation. Left-align body copy (ragged right) for even word spacing and a steadier read.",
  },
  "ty-tracking-by-size": {
    pt: "O letter-spacing default raramente serve a todos os tamanhos. Aperte um pouco o tracking em títulos grandes, deixe o corpo no normal e abra em labels pequenos em caixa alta, pra cada um ler limpo.",
    en: "Default letter-spacing rarely fits every size. Tighten tracking slightly on large headings, leave body text at normal, and open it up for small uppercase labels so each reads cleanly.",
  },
  // ── Color
  "co-honor-existing-palette": {
    pt: "Introduzir um hue novo a cada componente fragmenta o design até nada ler como um sistema só. Construa a partir da paleta que já existe — derive tints e shades dos hues existentes em vez de adicionar cores órfãs.",
    en: "Introducing a fresh hue for every new component fragments the design until nothing reads as one system. Build from the palette already in play — derive tints and shades from existing hues rather than adding orphan colors.",
  },
  "co-no-raw-black": {
    pt: "Preto puro (#000) e branco puro (#fff) ficam duros e chapados contra conteúdo real — esmagam detalhe de sombra e leem como sem cuidado. Suavize levemente pra um quase-preto e um quase-branco pra superfície parecer intencional.",
    en: "Pure black (#000) and pure white (#fff) feel harsh and flat against real content — they crush shadow detail and read as unconsidered. Soften slightly toward a near-black and a near-white so surfaces feel intentional.",
  },
  "co-accent-sparingly": {
    pt: "Uma cor de destaque usada em tudo deixa de destacar qualquer coisa. Gaste no único elemento que deve puxar o olho — uma ação primária, um estado ativo — e mantenha chrome e superfícies grandes neutros.",
    en: "An accent color used everywhere stops accenting anything. Spend it on the one element that should draw the eye — a primary action, an active state — and keep chrome and large surfaces neutral.",
  },
  "co-few-colors-neutral-base": {
    pt: "Paleta arco-íris lê como caótica e amadora. Deixe uma escala neutra carregar a maior parte da interface e trate cor como a exceção que marca significado, não o default de toda superfície.",
    en: "A rainbow palette reads as chaotic and amateur. Let a neutral scale carry the bulk of the interface and treat color as the exception that marks meaning, not the default for every surface.",
  },
  "co-semantic-colors-consistent": {
    pt: "Inventar um verde-de-sucesso ou vermelho-de-erro novo por componente quebra o modelo mental. Defina uma cor pra sucesso, aviso, erro e info, e reutilize sempre que esses significados aparecem.",
    en: "Inventing a new success-green or error-red per component breaks the mental model. Define one color each for success, warning, error, and info, and reuse them everywhere those meanings appear.",
  },
  "co-desaturate-large-fills": {
    pt: "Cor totalmente saturada numa área grande vibra e cansa o olho. Reserve saturação alta pra accents pequenos e use tons dessaturados pra fundos e preenchimentos grandes.",
    en: "Fully saturated color across a big area vibrates and tires the eye. Reserve high saturation for small accents and use muted, desaturated tones for large backgrounds and fills.",
  },
  // ── Depth
  "de-soft-consistent-shadows": {
    pt: "Sombra escura e dura parece barata, e sombras inconsistentes quebram a noção de espaço. Use um sistema de elevação só, com sombras suaves e difusas, como se viessem de uma única direção de luz.",
    en: "Harsh, dark drop shadows look cheap and inconsistent shadows break the sense of space. Use one elevation system with soft, diffuse shadows cast as if from a single light direction.",
  },
  "de-hairline-borders": {
    pt: "Borda preta de 1px pesada em tudo engaiola o design e adiciona ruído. Use divisores finos e de baixo contraste — ou whitespace — e mantenha o peso da borda consistente na UI.",
    en: "Heavy black 1px borders on everything box the design in and add visual noise. Use thin, low-contrast dividers — or whitespace — and keep border weight consistent across the UI.",
  },
  "de-consistent-radius": {
    pt: "Misturar canto reto, radius pequeno e pill total ao acaso parece acidental. Escolha uma escala de radius e aplique por papel de componente — e mantenha radii aninhados visualmente concêntricos.",
    en: "Mixing sharp corners, small radii, and full pills at random looks accidental. Pick one radius scale and apply it by component role — and keep nested radii visually concentric.",
  },
  "de-layering-restraint": {
    pt: "Quando todo elemento flutua na própria sombra, profundidade perde sentido e a tela fica agitada. Mantenha poucos níveis de elevação e intencionais — a maior parte do conteúdo fica plana na superfície.",
    en: "When every element floats on its own shadow, depth loses meaning and the screen feels busy. Keep elevation levels few and intentional — most content sits flat on the surface.",
  },
  // ── Motion
  "mo-motion-serves-meaning": {
    pt: "Animação que fica em loop ou dispara sem motivo lê como ruído nervoso. Use movimento pra mostrar mudança de estado — algo apareceu, carregou ou moveu — de forma que cada animação seja legível a partir de um quadro parado.",
    en: "Animation that loops or fires with no reason reads as nervous noise. Use motion to show a state change — something appeared, loaded, or moved — so every animation is legible from a single still frame.",
  },
  "mo-no-decorative-spinners": {
    pt: "Um spinner permanente numa superfície idle lê como quebrado e treina a pessoa a ignorar loading states reais. Reserve spinners infinitos pra trabalho de fato em andamento; pra interesse visual, use um tratamento estático sutil.",
    en: "A permanent spinner on an idle surface reads as broken and trains people to ignore real loading states. Reserve indefinite spinners for genuine in-progress work; for visual interest use a subtle static treatment.",
  },
  "mo-honor-reduced-motion": {
    pt: "Parallax, slide-ins e motion em autoplay são desconfortáveis ou dolorosos pra algumas pessoas. Respeite a preferência reduced-motion: mantenha o feedback essencial e ofereça um fallback parado ou um cross-fade curto pro resto.",
    en: "Parallax, slide-ins, and autoplay motion are uncomfortable or painful for some people. Honor the reduced-motion preference: keep essential feedback and offer a still or quick cross-fade fallback for the rest.",
  },
  "mo-quick-subtle-timing": {
    pt: "Transições lentas e bouncy por default deixam a interface arrastada. Mantenha o motion de UI curto (~150-250ms) com uma curva ease-out consistente, pra parecer responsivo e não teatral.",
    en: "Slow, bouncy default transitions make an interface feel sluggish. Keep UI motion short (around 150-250ms) with a consistent ease-out curve so it feels responsive rather than theatrical.",
  },
  "mo-restrained-entrances": {
    pt: "Animar tudo no load cria uma cascata que distrai. Anime a entrada só de conteúdo genuinamente novo e use um stagger leve apenas onde ajuda a revelar a ordem de leitura.",
    en: "Animating everything on load creates a distracting cascade. Animate the entrance of genuinely new content only, and use a light stagger just where it helps reveal reading order.",
  },
  // ── Imagery
  "im-preserve-aspect-ratio": {
    pt: "Imagem esticada ou achatada parece amadora na hora. Preserve a proporção original e use object-fit (cover ou contain) pra encaixar num frame — corte de propósito em vez de distorcer.",
    en: "Stretched or squashed images look amateur instantly. Preserve the original aspect ratio and use object-fit (cover or contain) to fit a frame — crop deliberately rather than distort.",
  },
  "im-consistent-treatment": {
    pt: "Um conjunto de imagens com proporções, radii e grades de cor diferentes lê como pilha, não sistema. Aplique a mesma proporção, radius e tratamento no grupo pra parecer intencional.",
    en: "A set of images with different ratios, corner radii, and color grades reads as a pile, not a system. Apply the same ratio, radius, and treatment across a group so it feels intentional.",
  },
  "im-overlay-for-legibility": {
    pt: "Texto direto sobre foto quase sempre falha contraste em algum ponto da imagem. Coloque um scrim, gradiente ou tint atrás do texto pra ele continuar legível na imagem inteira, áreas claras incluídas.",
    en: "Text laid directly over a photo usually fails contrast somewhere in the image. Add a scrim, gradient, or tint behind the text so it stays readable across the whole image, light areas included.",
  },
  "im-avoid-generic-stock": {
    pt: "Foto de stock genérica e de baixa resolução barateia o design. Prefira imagem real, nítida e no tema — e quando não tiver, uma ilustração limpa, padrão ou superfície sólida vence stock de enchimento.",
    en: "Generic, low-resolution stock photos cheapen a design. Prefer real, sharp, on-topic imagery — and when you don't have it, a clean illustration, pattern, or solid surface beats filler stock.",
  },
  // ── Icons
  "ic-consistent-set-weight": {
    pt: "Misturar famílias de ícone, ou estilos filled e outline ao acaso, parece descuidado. Use um único conjunto de ícones com um peso de traço consistente, pra eles lerem como irmãos.",
    en: "Mixing icon families, or filled and outline styles at random, looks careless. Use a single icon set with one consistent stroke weight so icons read as siblings.",
  },
  "ic-size-align-to-text": {
    pt: "Ícone que não bate com o tamanho ou a baseline do label parece colado por cima. Dimensione o ícone em relação ao texto ao lado e alinhe opticamente à baseline ou ao centro do texto.",
    en: "Icons that don't match their label's size or baseline look bolted on. Size icons relative to adjacent text and align them optically to the text baseline or center.",
  },
  "ic-icons-clarify-not-decorate": {
    pt: "Um ícone em cada linha vira ruído e atrasa a leitura. Use ícone onde ele acelera o reconhecimento, com label quando o sentido é ambíguo, e tire onde o texto sozinho é mais claro.",
    en: "An icon on every line becomes noise and slows scanning. Use icons where they speed recognition, pair them with a label when the meaning is ambiguous, and drop them where text alone is clearer.",
  },
  // ── Forms
  "fo-clear-input-affordance": {
    pt: "Campos sem borda e chapados deixam a pessoa em dúvida do que é clicável. Dê ao input uma affordance clara — borda visível ou fundo preenchido, padding interno suficiente e um focus state óbvio.",
    en: "Borderless, flat fields leave people unsure what's clickable. Give inputs a clear affordance — a visible border or filled background, enough internal padding, and an obvious focus state.",
  },
  "fo-label-above-or-clear": {
    pt: "Campo só com placeholder perde o label assim que a pessoa digita e prejudica acessibilidade. Mantenha um label visível e persistente acima ou ao lado de cada campo; use placeholder só pra dica de formato.",
    en: "Placeholder-only fields lose their label the moment someone types and hurt accessibility. Keep a persistent visible label above or beside each field; use placeholder text only for format hints.",
  },
  "fo-generous-touch-targets": {
    pt: "Controles minúsculos e colados são difíceis de acertar, ainda mais no toque. Dê aos alvos interativos pelo menos ~44px de área de clique e espaço suficiente entre eles pra evitar erro de toque.",
    en: "Tiny, tightly-packed controls are hard to hit, especially on touch. Give interactive targets at least ~44px of hit area and enough space between them to avoid mis-taps.",
  },
  "fo-align-fields": {
    pt: "Campos de larguras aleatórias e labels desalinhados deixam o formulário caótico. Alinhe labels e inputs a uma coluna comum e dimensione cada campo pelo tamanho do conteúdo que ele espera.",
    en: "Fields of random widths and misaligned labels make a form feel chaotic. Align labels and inputs to a shared column and size each field to the length of content it expects.",
  },
  // ── States
  "st-visible-focus": {
    pt: "Tirar o outline de foco deixa quem usa teclado sem saber onde está. Mantenha um anel de foco claro e estilizado em todo elemento interativo — nunca remova o outline sem um substituto visível.",
    en: "Removing the focus outline strands keyboard users with no idea where they are. Keep a clear, styled focus ring on every interactive element — never remove the outline without a visible replacement.",
  },
  "st-interactive-feedback": {
    pt: "Controle que não reage parece morto ou quebrado. Dê a todo elemento clicável feedback visível de hover, active e pressed, pra confirmar que dá pra usar e que o toque registrou.",
    en: "Controls that don't react feel dead or broken. Give every clickable element visible hover, active, and pressed feedback so it confirms it can be used and that the tap registered.",
  },
  "st-design-empty-error": {
    pt: "Entregar só o happy path deixa os estados vazio, loading e erro com cara de quebrado. Desenhe esses estados de propósito — um vazio que ajuda, um erro claro, um placeholder de loading calmo.",
    en: "Shipping only the happy path leaves empty, loading, and error states looking broken. Design these states deliberately — a helpful empty state, a clear error, a calm loading placeholder.",
  },
  "st-disabled-reads-disabled": {
    pt: "Um controle desabilitado com cara de ativo convida clique morto, mas um que some confunde. Reduza o contraste pra ele ler claramente como indisponível, mantendo legível e no lugar.",
    en: "A disabled control that looks active invites dead clicks, but one that vanishes confuses. Lower its contrast so it clearly reads as unavailable while staying legible and in place.",
  },
  "st-selected-distinct-from-hover": {
    pt: "Quando o estado selecionado parece hover, a pessoa perde o rastro de onde está. Faça o estado atual/selecionado claramente distinto do hover transitório — um fill ou marcador diferente, não só um tom.",
    en: "When the selected state looks like hover, people lose track of where they are. Make the current/selected state clearly distinct from transient hover — a different fill or marker, not just a shade.",
  },
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
