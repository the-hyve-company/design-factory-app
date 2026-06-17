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

// Rule titles for the 30 hyve-agnostic defaults (PR #207 OSS prep,
// user ask 2026-05-21 to bilingualize). The EN value here MUST
// match the canonical `title` field on the rule in rules-taxonomy.ts
// — that file is the source of truth for the EN copy, and the
// `pick()` fallback picks EN from this map when lang === "en" to keep
// the i18n table self-contained (no cross-file divergence audit).
const RULE_TITLES: Record<string, Pair> = {
  // Anti-slop
  "as-no-decorative-emojis": { pt: "Sem emojis decorativos", en: "No decorative emojis" },
  "as-no-invented-decoration": { pt: "Sem decoração inventada", en: "No invented decoration" },
  "as-no-placeholder-text": { pt: "Sem texto-placeholder", en: "No placeholder text" },
  "as-no-external-assets": { pt: "Sem assets externos", en: "No external assets" },
  "as-no-fake-data": { pt: "Sem dados fake ou mock", en: "No fake or mock data" },
  "as-no-ai-tells": { pt: "Sem voz de assistente no output", en: "No AI tells in output" },
  "as-no-silent-fallbacks": { pt: "Sem fallback silencioso", en: "No silent fallbacks" },
  "as-no-hedging": { pt: "Sem hedge no que foi entregue", en: "No hedging in shipped output" },
  // Tone
  "tn-read-ds-canon": { pt: "Ler o canon do design system", en: "Read design system canon first" },
  "tn-one-detail-earns": {
    pt: "Um detalhe que justifica a peça",
    en: "One detail that earns the work",
  },
  "tn-surgical-edits": { pt: "Edições cirúrgicas primeiro", en: "Surgical edits first" },
  "tn-ship-complete": { pt: "Entregar inteiro, não em pedaços", en: "Ship complete, not chunks" },
  "tn-show-dont-tell": { pt: "Mostrar, não descrever", en: "Show, don't tell" },
  // Motion
  "mo-honor-reduced-motion": { pt: "Respeitar reduced-motion", en: "Honor reduced motion" },
  "mo-motion-serves-meaning": { pt: "Animação serve significado", en: "Motion serves meaning" },
  "mo-no-decorative-spinners": {
    pt: "Sem spinner infinito decorativo",
    en: "No infinite spinners as decoration",
  },
  // Color
  "co-honor-existing-palette": {
    pt: "Honrar a paleta existente",
    en: "Honor user's existing palette",
  },
  "co-wcag-aa-on-text": { pt: "WCAG AA em texto", en: "WCAG AA on text" },
  "co-no-raw-black": { pt: "Sem preto puro", en: "No raw black" },
  "co-brand-color-sparingly": { pt: "Cor da marca com parcimônia", en: "Brand color sparingly" },
  // Language
  "ln-match-user-language": { pt: "Falar o idioma do usuário", en: "Match user's language" },
  "ln-utf8-strict": { pt: "UTF-8 sempre", en: "UTF-8 strict" },
  // Voice
  "vo-plain-register": { pt: "Registro simples", en: "Plain register" },
  "vo-no-marketing-speak": { pt: "Sem marketing-speak", en: "No marketing speak" },
  "vo-concrete-over-abstract": { pt: "Concreto, não abstrato", en: "Concrete over abstract" },
  // Layout
  "ly-no-card-bars": {
    pt: "Sem barras decorativas em cards",
    en: "No card bars or vertical accents",
  },
  "ly-respect-viewport": { pt: "Respeitar o viewport", en: "Respect viewport" },
  "ly-sticky-has-escape": {
    pt: "Sticky sempre tem como fechar",
    en: "Sticky elements have escape",
  },
  "ly-optical-alignment": { pt: "Alinhamento óptico", en: "Optical alignment" },
  // Custom
  "cu-tabular-nums": {
    pt: "Tabular nums para dados numéricos",
    en: "Tabular nums for numerical data",
  },
};

// Full PT translations of the EN descriptions in rules-taxonomy.ts.
// Same shape (problem to avoid + concrete substitute). When `lang ===
// "pt"` is active these get injected into the system prompt instead of
// the EN version, so the model receives instructions in the same
// language the user is writing in.
const RULE_DESCRIPTIONS: Record<string, Pair> = {
  "as-no-decorative-emojis": {
    pt: "Emojis coloridos decorativos (🚀⚡🔗📦🟢🔴 etc) puxam UI e copy de produto pra tom de chat casual ou pitch de marketing, e quebram o registro adulto e focado que interfaces reais precisam. Carregue significado com tipografia bem-tratada (peso, tamanho, kerning) e iconografia monocromática consistente. Símbolos técnicos minimalistas (✓ × → •) continuam aceitos em docs e specs, onde leem como notação, não como decoração.",
    en: "Decorative coloured emojis (🚀⚡🔗📦🟢🔴 etc) drift product UI and copy toward casual chat or marketing pitch, eroding the adult, focused tone real interfaces need. Carry meaning with careful typography (weight, size, kerning) and a consistent monochrome line-icon set instead. Minimal technical glyphs (✓ × → •) stay acceptable inside developer docs and specs, where they read as notation rather than decoration.",
  },
  "as-no-invented-decoration": {
    pt: "Adicionar gradients, glows, blurs, cursor torch, particle fields ou animações de fundo sem base no design system cria inconsistência e envelhece o trabalho no momento em que um DS real for adotado. Antes de qualquer efeito decorativo, verifique os tokens e componentes existentes — reaproveite o que já é canônico, ou caia em ênfase funcional (mudança de peso, cor da paleta estabelecida, animação que sinaliza estado). Em dúvida, omita; restrição lê como confiança.",
    en: "Adding gradients, glows, blurs, cursor torches, particle fields, or animated backgrounds without grounding in the project's design system creates inconsistency and dates the work the moment a real DS lands. Before reaching for a decorative effect, check the existing tokens and components — reuse what is already canonical, or fall back to functional emphasis (weight change, established palette colour, motion that signals state). When in doubt, omit; restraint reads as confidence.",
  },
  "as-no-placeholder-text": {
    pt: 'Lorem ipsum, "Feature 1/2/3", "[TODO]", "Click here" e "Adicione conteúdo aqui" marcam um draft como não-pronto e desperdiçam atenção do leitor. Escreva os labels e a copy real que a superfície precisa — mesmo texto provisório realista ("Inscrições abrem em março") supera filler em latim porque testa o layout em line-lengths reais. Quando um slot ainda não tem conteúdo definido, deixe vazio (ou marcado com data-attribute que o pipeline detecta) em vez de mostrar string de placeholder.',
    en: 'Lorem ipsum, "Feature 1/2/3", "[TODO]", "Click here", and "Add your content here" mark a draft as unfinished and waste the reader\'s attention. Write the actual labels and copy the surface needs — even rough realistic text ("Inscrições abrem em março") beats Latin filler because it stress-tests the layout at real line lengths. When a slot genuinely has no content yet, leave it empty (or marked with a data attribute the pipeline catches) rather than ship visible filler strings.',
  },
  "as-no-external-assets": {
    pt: "Linkar pra CDNs externos (fonts.googleapis.com, unpkg, cdn.jsdelivr) ou hotlinkar imagens quebra a página offline, quando o CDN muda URLs e quando a rede está lenta. Embuta fontes via @font-face com data URIs base64, inline ícones SVG direto no markup, e mantenha imagens grandes sob a raiz do projeto referenciadas por caminhos relativos. O artefato precisa viajar como arquivo único auto-contido (ou pasta) — esse é o contrato.",
    en: "Linking to external CDNs (`fonts.googleapis.com`, `unpkg`, `cdn.jsdelivr`) or hotlinked images breaks the page offline, when the CDN rotates URLs, and when the network is slow. Inline fonts via `@font-face` with base64 data URIs, embed small images as base64 directly in markup, and keep larger media under the project root referenced by relative paths. The artifact must travel as a single self-contained file (or folder) — that is the contract.",
  },
  "as-no-fake-data": {
    pt: '"User 1, User 2, User 3" e "$XX,XX" fazem o output parecer template barato. Use dados realistas plausíveis: nomes com cara de nome ("Ana Reis", "Marcus Tan"), números com padrão de número real (preços R$24 / R$89 / R$1.240, não 1 / 2 / 3), datas relativas a hoje ("semana passada", "em março"). Quando o domínio importa (analytics, billing), siga as convenções dele pra superfície ler como o produto real que ela diz ser.',
    en: '"User 1, User 2, User 3" and "$XX.XX" make outputs read as low-effort templates. Use plausible realistic data: real-shape names ("Ana Reis", "Marcus Tan"), numbers that pattern like actual numbers (prices $24 / $89 / $1,240, not 1 / 2 / 3), dates relative to today ("last week", "em março"). When the domain matters (analytics, billing), follow that domain\'s conventions so the surface reads as the working product it claims to be.',
  },
  "as-no-ai-tells": {
    pt: '"Posso ajudar com isso", "Certo!", "Como um AI", "Aqui está o que posso fazer", "Me avise se precisar de mais" vazam a voz do assistente em superfícies de produto e fazem o trabalho parecer scripted. Tire o registro de assistente-prestativo inteiro — fale como o produto ou documento em si. O usuário já sabe que está usando uma ferramenta; a ferramenta não precisa se apresentar a cada resposta.',
    en: '"I\'d be happy to help", "Certainly!", "As an AI", "Here\'s what I can do", "Let me know if you need anything else" leak the assistant\'s voice into product surfaces and make the work feel scripted. Strip the helpful-assistant register entirely — speak as the product or document itself. The user already knows they\'re using a tool; the tool doesn\'t need to introduce itself on every response.',
  },
  "as-no-silent-fallbacks": {
    pt: 'Padrões como catch(() => {}), ?? defaultValue sem log, e "se falhar mostra nada" transformam bugs em degradação invisível que custa dias pra debugar. Quando algo falha, logue o erro com escopo + operação tentada + causa real, e ou superfície uma mensagem visível pro usuário ou retorne um Result tipado que o caller é obrigado a tratar. Swallow silencioso só é aceitável quando você está filtrando falhas conhecidas-benignas, e o comentário acima do catch precisa explicar.',
    en: 'Patterns like `catch(() => {})`, `?? defaultValue` without logging, and "if it fails, show nothing" turn bugs into invisible degradation that costs days to debug. When something fails, log the error with scope + attempted operation + actual cause, then either surface a user-visible message or return a typed error result the caller has to handle. Silent swallow is acceptable only when you\'re filtering known-benign failures, and the comment above the catch must say so.',
  },
  "as-no-hedging": {
    pt: '"Talvez", "poderia ser", "ainda precisa de polish", "em uma próxima iteração", "para production-ready precisaríamos" — isso é coisa de design review, nunca da superfície que um usuário real vai ler. Faça a chamada dentro das constraints, entregue a melhor versão que couber, e siga. Se algo está genuinamente incompleto, diga uma vez no commit message ou changelog — nunca no output que vai pra usuário.',
    en: '"Talvez", "poderia ser", "ainda precisa de polish", "em uma próxima iteração", "para production-ready precisaríamos" — these belong in design reviews, never in the surface a real user reads. Make the call within the constraints, ship the best version that fits, and move on. If something is genuinely incomplete, name it once in the commit message or changelog — never in the user-facing output itself.',
  },
  "tn-read-ds-canon": {
    pt: "Antes de gerar qualquer UI, paleta ou variante de componente, leia a documentação do design system do projeto (design.md, arquivo de tokens, DESIGN-RULES ou equivalente). Improvisar cores, escala de spacing, ramp tipográfico ou radius quando o canon já define produz output que dá drift do resto do produto. Quando o projeto ainda não tem DS, estabeleça 3-5 tokens canônicos antes (uma escala neutra, um accent, dois tamanhos de texto, dois de spacing) e reuse.",
    en: "Before generating any UI, palette, or component variant, read the project's design system documentation (design.md, tokens file, DESIGN-RULES, or equivalent). Improvising colours, spacing scales, typography ramps, or radius values when the canon already defines them produces output that drifts from the rest of the product. When the project has no DS yet, establish 3-5 canonical tokens up-front (one neutral scale, one accent, two type sizes, two spacing units) and reuse them.",
  },
  "tn-one-detail-earns": {
    pt: "Toda superfície entregue precisa de pelo menos um detalhe que sinalize craft em vez de montagem — uma micro-interação em uma ação primária, um movimento tipográfico (tabular nums em preço, optical sizing, ligaturas off por default mas on em títulos), uma qualidade de pintura (uma sombra cuidada, um gradiente sutil em um highlight só), ou um momento de ilustração custom. O âncora se ajusta à superfície — uma página de settings não precisa de fogos, uma landing pode.",
    en: "Every shipped surface needs at least one detail that signals craft rather than assembly — a micro-interaction on a primary action, a typographic move (tabular nums on prices, optical sizing, off-by-default ligatures kept on for headings), a paint quality (a single considered shadow stack, a small gradient on a highlight only), or a custom illustration moment. The anchor should fit the surface — a settings page doesn't need fireworks, a landing page might.",
  },
  "tn-surgical-edits": {
    pt: "Quando pedirem pra mudar uma coisa, mude só aquela coisa — não refatore código adjacente, não renomeie variáveis não relacionadas, não aperte regras de styling fora do escopo, e não adicione features que o brief não pediu. Edits cirúrgicos mantêm diffs revisáveis e respeitam o contrato implícito de que o resto do arquivo funciona. Quando achar algo mais quebrado, abra um follow-up separado — nunca empacote como side effect.",
    en: "When asked to change one thing, change only that thing — don't refactor adjacent code, rename unrelated variables, tighten styling outside the scope, or add features the brief didn't ask for. Surgical edits keep diffs reviewable and respect the implicit contract that the rest of the file works. When you spot something else broken, file a separate follow-up — never land it as a side effect.",
  },
  "tn-ship-complete": {
    pt: 'Entregue um artefato funcionando — arquivo que abre, demo que roda, copy que se lê do começo ao fim — não um draft parcial com lista do que ainda falta. Quando o escopo é grande demais pra finalizar em uma pass, estreite o escopo: uma superfície menor entregue inteira vence uma maior pela metade. "Funciona em escopo menor" é o tipo de edit que um mantenedor consegue mergear de verdade.',
    en: 'Deliver a working artifact — a file that opens, a demo that runs, copy that reads end-to-end — not a partial draft with a list of remaining items. When the scope is too large to finish in one pass, narrow the scope: a smaller surface shipped whole beats a larger surface half-built. "Working at smaller scope" is the kind of edit a maintainer can actually merge.',
  },
  "tn-show-dont-tell": {
    pt: 'Não descreva o que uma feature faz em copy ("sugestões inteligentes aparecem enquanto você digita"); demonstre com a interface funcionando. Não afirme que um produto é "rápido" ou "intuitivo" — deixe os affordances falarem. Em documentação, comece com um exemplo executável, depois explique por que funciona. A demo carrega peso; o adjetivo não.',
    en: 'Don\'t describe what a feature does in copy ("intelligent suggestions appear as you type"); demonstrate it with the working interface itself. Don\'t claim a product is "fast" or "intuitive" — let the affordances speak. In documentation, lead with a runnable example, then explain why it works. The demo carries weight; the adjective doesn\'t.',
  },
  "mo-honor-reduced-motion": {
    pt: "Envolva toda animação não-essencial em @media (prefers-reduced-motion: reduce) e forneça fallback estático ou um cross-fade muito mais curto. Distúrbios vestibulares tornam parallax, slide-in transitions e motion em autoplay fisicamente dolorosos pra uma fração relevante dos usuários. Animação essencial (progress de loading, focus ring) pode ficar; o resto precisa de alternativa parada.",
    en: "Wrap all non-essential animation in `@media (prefers-reduced-motion: reduce)` and provide either a static fallback or a much-shorter cross-fade. Vestibular disorders make parallax, slide-in transitions, and autoplay motion physically painful for a meaningful fraction of users. Essential motion (loading progress, focus rings) can stay; everything else needs a still alternative.",
  },
  "mo-motion-serves-meaning": {
    pt: "Use animação pra comunicar mudança de estado (algo apareceu, algo está carregando, algo moveu de A pra B) — não pra preencher silêncio ou decorar superfícies idle. Toda animação precisa ser legível a partir de um quadro parado: um item da lista entra deslizando porque acabou de ser adicionado, um botão encolhe no press porque o usuário tocou. Motion decorativo que loopa sem âncora semântica vira ruído nervoso.",
    en: "Use animation to communicate state change (something appeared, something is loading, something moved from A to B) — not to fill silence or decorate idle surfaces. Every animation should be readable from a still frame: a list item slides in because it was just added, a button shrinks on press because the user touched it. Decorative motion that loops with no semantic anchor turns into nervous noise.",
  },
  "mo-no-decorative-spinners": {
    pt: "Spinners infinitos cabem em trabalho real cuja duração você não consegue medir adiante. Não cabem em superfícies idle — um botão com spin permanente lê como quebrado ou travado, e treina o usuário a ignorar loading states reais depois. Quando a superfície precisa de interesse visual, use um badge estático, um pulse sutil em um elemento primário, ou conteúdo que respira via tipografia — nunca rotação perpétua.",
    en: "Indefinite spinners belong on real work whose duration you can't measure ahead of time. They don't belong on idle surfaces — a button with a permanent spin reads as broken or stuck, and trains users to ignore real loading states later. When a surface needs visual interest, use a static badge, a subtle pulse on a primary element, or content that breathes via typography — never perpetual rotation.",
  },
  "co-honor-existing-palette": {
    pt: 'Quando o projeto já define cores (tokens.css, um DS, guia de marca), construa componentes novos a partir da escala existente: derive tints, shades e accents dos hues estabelecidos em vez de introduzir novos. Adicionar "só uma cor nova" por feature fragmenta a identidade visual até nada ler como sistema. Quando você genuinamente precisa de um hue novo, expanda a paleta com a escala completa (10 stops do claro ao escuro) e documente junto às existentes — nunca um valor órfão.',
    en: 'When the project already defines colours (tokens.css, a DS, a brand guide), build new components from the existing scale: derive tints, shades, and accents from the established hues rather than introducing fresh ones. Adding "just one new colour" per feature fragments visual identity until nothing reads as a system. When you genuinely need a new hue, expand the palette with a full scale (10 steps, light → dark) and document it alongside the existing ones — never one orphan value.',
  },
  "co-wcag-aa-on-text": {
    pt: 'Texto corrido precisa de pelo menos 4,5:1 de contraste contra o fundo; texto grande (≥18pt ou ≥14pt bold) precisa de 3:1. Cheque pares reais em ambos os temas (light e dark) antes de entregar — "parece bom na minha tela" não é OK. Quando uma cor da marca falha no contraste pra texto, mantenha como accent decorativo (LED, dot, underline) e use um neutro de contraste maior pra letras de fato.',
    en: 'Body text needs at least 4.5:1 contrast against its background; large text (≥18pt or ≥14pt bold) needs 3:1. Check actual pairs in both light and dark themes before shipping — "looks fine on my screen" is not a green light. When a brand colour fails contrast for text, keep it as a decorative accent (a LED, a dot, an underline) and use a higher-contrast neutral for the actual letters.',
  },
  "co-no-raw-black": {
    pt: "#000 puro lê como flat e datado contra qualquer superfície moderna — esmaga detalhe de sombra, quebra anti-aliasing de tipografia e não tem o undertone warm que tinta real tem. Use um warm charcoal (#1a1a17, oklch(0.18 0.005 80) ou equivalente no seu color space) pra texto e superfícies pesadas de tinta. Mesma lógica pra #fff puro — prefira um off-white (#fafaf7) pra fundos que devem ter cara de papel.",
    en: "Pure `#000` reads as flat and dated against any modern surface — it crushes shadow detail, breaks anti-aliasing on type, and lacks the warm undertone real ink has. Use a warm charcoal (`#1a1a17`, `oklch(0.18 0.005 80)`, or the equivalent in your colour space) for text and ink-heavy surfaces. Same logic for pure `#fff` — prefer an off-white (`#fafaf7`) for backgrounds that should feel like paper.",
  },
  "co-brand-color-sparingly": {
    pt: "A cor de assinatura da marca carrega o peso visual mais forte em qualquer superfície que a usa. Gaste esse peso onde ele ganha atenção: o LED ativo de um controle, um CTA crítico, um único dot indicando status live — nunca em chrome (toolbars, navegação, fundos de card) onde a cor da marca compete com o conteúdo. Uma superfície onde a cor da marca aparece uma vez lê como confiante; uma onde aparece seis vezes lê como desesperada.",
    en: "The brand's signature colour carries the most visual weight wherever it appears. Spend that weight where it earns attention: the active LED on a control, a critical CTA, a single dot indicating live status — never on chrome (toolbars, navigation, card backgrounds) where the brand colour competes with content. A surface where the brand colour appears once reads as confident; a surface where it appears six times reads as desperate.",
  },
  "ln-match-user-language": {
    pt: "Detecte o idioma do input do usuário e responda no mesmo. Se o usuário digita em português, escreva em português; se ele troca pra inglês no meio do thread, troque junto. Não traduza strings que o usuário escreveu — preserve casing, acentos e a wording exata que ele usou nos próprios dados. O produto precisa parecer que fala o idioma do usuário nativamente, não como camada de tradução.",
    en: "Detect the language of the user's input and reply in the same language. When the user types Portuguese, write Portuguese; when they switch to English mid-thread, switch with them. Don't translate strings the user authored — preserve casing, accents, and the exact wording they used in their own data. The product should feel like it speaks the user's language natively, not like a translation layer.",
  },
  "ln-utf8-strict": {
    pt: "Sempre entregue UTF-8 com preservação completa de acentos. Não use HTML entities pra caracteres acentuados (&aacute; pra á), não caia em transliteração ASCII, e não armazene texto como base64 quando deveria ser UTF-8. O round-trip write → save → reload → render precisa deixar agudo, til, cedilha e emoji intactos. Caracteres de box-drawing (─ ┄ ━) e setas são igualmente first-class — só tire se o formato de destino genuinamente não suporta.",
    en: "Always output UTF-8 with full accent preservation. Don't use HTML entities for accented characters (`&aacute;` for á), don't fall back to ASCII transliteration, and don't store text as base64 when it should be UTF-8. The round-trip write → save → reload → render must leave acute, tilde, cedilla, and emoji intact. Box-drawing characters (`─ ┄ ━`) and arrow symbols are equally first-class — strip them only when the destination format truly can't carry them.",
  },
  "vo-plain-register": {
    pt: 'Escreva no registro de um colega focado explicando algo concreto — não no registro de folheto de marketing ou memo corporativo. Sem "alavancar", sem "habilitar", sem "robusto", sem "world-class". Frases curtas que nomeiam a coisa diretamente. O leitor é inteligente e ocupado; respeite ambos.',
    en: 'Write at the register of a focused colleague explaining something concrete — not the register of a marketing brochure or a corporate memo. No "leverage", no "enable", no "robust", no "world-class". Short sentences that name the thing directly. The reader is smart and busy; respect both.',
  },
  "vo-no-marketing-speak": {
    pt: 'Vocabulário banido: "alavancar", "sinergia", "revolucionário", "world-class", "next-generation", "game-changing", "best-in-class", "cutting-edge", "robusto", "seamless", "intuitivo", "delightful", "poderoso". Essas palavras sinalizam que quem escreve não sabe descrever o que está afirmando. Substitua cada uma por específicos concretos: "editor poderoso" → "edita arquivos localmente com autosave a cada 1s".',
    en: 'Banned vocabulary: "leverage", "synergy", "revolutionary", "world-class", "next-generation", "game-changing", "best-in-class", "cutting-edge", "robust", "seamless", "intuitive", "delightful", "powerful". These words signal the writer doesn\'t know how to describe what they\'re claiming. Replace each with concrete specifics: "powerful editor" → "edits files locally with autosave at 1s intervals".',
  },
  "vo-concrete-over-abstract": {
    pt: 'Números, exemplos e entidades nomeadas vencem adjetivos sempre. "Rápido" vira "carrega em menos de 300ms"; "popular" vira "usado por 1.200 times"; "fácil" vira "três teclas a partir do cold start". Quando não dá pra quantificar, nomeie uma instância específica: "o tipo de edit que você faz nas passes um e dois" vence "suporta edits complexos". Vago é o default fácil — específico é a disciplina.',
    en: 'Numbers, examples, and named entities beat adjectives every time. "Fast" becomes "loads in under 300ms"; "popular" becomes "used by 1,200 teams"; "easy" becomes "three keystrokes from cold start". When you can\'t quantify, name a specific instance: "the kind of edit you do in passes one and two" beats "supports complex edits". Vagueness is the easy default — specificity is the discipline.',
  },
  "ly-no-card-bars": {
    pt: "Barras decorativas no topo, base ou lateral de um card não adicionam informação — fragmentam o card visualmente e datam o design rápido (o trope lê como SaaS dashboard de 2019). Pra sinalizar hierarquia ou status dentro de um card, use o conteúdo do próprio card: um heading maior, um dot colorido adjacente ao título, um background tonal. Quando precisar de divisor, use whitespace — não tinta.",
    en: "Decorative bars at the top, base, or side of a card don't add information — they fragment the card visually and date the design fast (the trope reads like 2019 dashboard SaaS). To signal hierarchy or status inside a card, use the card's own content: a larger heading, a coloured dot adjacent to the title, a tinted background state. When you need a divider, use whitespace — not paint.",
  },
  "ly-respect-viewport": {
    pt: "A página não pode produzir scroll horizontal em larguras comuns (320, 375, 768, 1024, 1440 px). Use box-sizing: border-box, larguras fluidas ou grids com minmax(0, 1fr), e teste resize — não entregue um layout que você só viu em 1440 px. Tabelas que não cabem ganham scroll horizontal interno (não na página); elementos de largura fixa ganham max-width e padding inline.",
    en: "The page must not produce horizontal scroll at common widths (320, 375, 768, 1024, 1440 px). Use `box-sizing: border-box`, fluid widths or grids with `minmax(0, 1fr)`, and test resize behaviour — don't ship a layout you've only seen at 1440 px. Tables that don't fit get an internal horizontal scroll (not page-level); fixed-width elements get a max-width plus inline padding.",
  },
  "ly-sticky-has-escape": {
    pt: "Qualquer banner sticky, drawer, modal ou painel flutuante precisa de affordance explícito pra fechar — botão ×, atalho Esc, handler de outside-click, todos os três quando possível. Elementos sticky sem escape parecem armadilhas e erodem confiança. O mecanismo de escape precisa ser descobrível dentro do mesmo quadro que o conteúdo sticky; depender só de atalho de teclado exclui usuários que não sabem que ele existe.",
    en: "Any sticky banner, drawer, modal, or floating panel needs an explicit close affordance — a × button, an Esc shortcut, an outside-click handler, all three when possible. Sticky elements without escape feel like traps and erode user trust. The escape mechanism must be discoverable inside the same frame as the sticky content; relying solely on a keyboard shortcut excludes users who don't know it exists.",
  },
  "ly-optical-alignment": {
    pt: "Centralização geométrica e visual não são a mesma coisa. Triângulos, ícones assimétricos, glifos com descenders e itálicos precisam de ajuste de offset pra ler como alinhados. Olho vence matemática: quando um ícone de play (▶) parece off-center dentro de um botão circular apesar de estar matematicamente centrado, nudge 1-2 px pra direita até ler centrado. Optical kerning, optical sizing em variable fonts e trim metrics em type servem ao mesmo princípio.",
    en: "Geometric centering and visual centering are not the same. Triangles, asymmetric icons, glyphs with descenders, and italic type need offset adjustments so they read as aligned. Eye trumps math: when a play icon (▶) looks off-centre inside a circular button despite being mathematically centred, nudge it 1-2 px right until it reads centred. Optical kerning, optical sizing in variable fonts, and trim metrics on type all serve the same principle.",
  },
  "cu-tabular-nums": {
    pt: "Aplique font-variant-numeric: tabular-nums em qualquer superfície onde dígitos precisam alinhar: tabelas, preços, displays de tempo, contadores, números de versão. Dígitos proporcionais (o default) fazem 1.234 e 5.678 mudarem de posição entre linhas, o que destrói scannability. Tabular nums travam cada dígito em largura fixa — os números empilham em colunas limpas e a velocidade de leitura em contextos pesados de dados triplica.",
    en: "Apply `font-variant-numeric: tabular-nums` on any surface where digits need to align: tables, prices, time displays, counters, version numbers. Proportional digits (the default) make 1,234 and 5,678 shift left/right between rows, which destroys scannability. Tabular nums lock each digit to a fixed width — numbers stack into clean columns and reading speed in data-heavy contexts triples.",
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
