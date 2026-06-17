// direction-data.ts — Category > Format + Directions (v2)
//
// DEPRECATED 2026-05-17 (audit P0-D, Rota A).
//
// This module backed the legacy DirectionModal that lives in
// NewProjectLabScreen — a lab/experimental new-project flow that
// predates the canonical NewProject modal + Canonical+ taxonomy.
// The main production path (HomeScreen → NewProjectModal →
// handleCreateFromNpModal → format-taxonomy.ts) no longer touches
// these exports.
//
// Kept in tree because:
//   1. NewProjectLabScreen still imports CATEGORIAS / FORMATOS /
//      EIXOS / DIRECTIONS to render the lab DirectionModal.
//   2. Some legacy projects were created with a DirectionSelection
//      payload and EditorScreen hydrates the type for backward-compat
//      (canvas ratio display only — no prompt injection anymore).
//
// Do NOT add new formats here. New formats land in
// src/data/format-taxonomy.ts (`DEFAULT_FORMAT_TAXONOMY`). New rules
// land in src/data/rules-taxonomy.ts (`DEFAULT_BUILTIN_RULES`).
//
// Source of truth for the legacy Direction Modal. Edit here. All
// visible strings are English (app is English-only). Prompt bodies are
// written for the AI (which accepts both EN and PT-BR).
//
// Anti-slop semantics: items here come UNCHECKED by default. The user
// toggles each one to enable. `formato.anti_slop[]` is the per-format
// preset list shown in the Anti-slop tab; nothing applies until enabled.

export type CategoriaId = "video" | "interface" | "social";
export type EixoId = "motion" | "typography" | "layout" | "surfaces" | "anti-slop";

export interface Categoria {
  id: CategoriaId;
  nome: string;
  descricao: string;
}

export interface Formato {
  id: string;
  categoria: CategoriaId;
  nome: string;
  descricao: string;
  canvas: { ratio: string; duration: number };
  prompt_prefix: string;
  /** Per-format anti-slop preset list. NOT auto-applied — shown opt-in. */
  anti_slop: string[];
}

export interface Eixo {
  id: EixoId;
  nome: string;
  descricao: string;
}

export interface Direction {
  id: string;
  eixo: EixoId;
  nome: string;
  descricao: string;
  rule_ref?: string;
  aplica: { categorias: CategoriaId[]; formatos?: string[] };
  prompt_addon: string;
}

export const CATEGORIAS: Categoria[] = [
  {
    id: "video",
    nome: "Video",
    descricao: "Outputs that render to MP4 via the HyperFrames pipeline.",
  },
  {
    id: "interface",
    nome: "Interface",
    descricao: "Static screens — UI, landing pages, dashboards. HTML output.",
  },
  {
    id: "social",
    nome: "Social",
    descricao: "Feed-friendly content — carousels, stories, OG images.",
  },
];

// ─────────────────────────────────────────────────────────────────────
// FORMATS
// ─────────────────────────────────────────────────────────────────────

export const FORMATOS: Formato[] = [
  // ─── VIDEO ─────────────────────────────────────────────────────────
  {
    id: "explainer",
    categoria: "video",
    nome: "Explainer",
    descricao:
      "Video explaining a product, concept, or flow. Didactic, dense, with explicit visual objects.",
    canvas: { ratio: "16:9", duration: 18 },
    prompt_prefix: `You are producing an EXPLAINER VIDEO.

═══ CANVAS ═══

Aspect ratio: {{ratio}}. Viewport: {{viewport}}.
Duration: {{duration}}s @ {{fps}}fps ({{frames}} frames total).

The HTML body MUST render at the exact viewport pixel size above:

  html, body { width: {{viewport_w}}px; height: {{viewport_h}}px; margin: 0; }

If the ratio is 9:16 or 1:1, the body is portrait/square — compose
vertically: a tall stack of beats, not a 16:9 layout squished. Each
didactic element scales to fill the actual shape.

═══ OUTPUT PIPELINE — read before writing any line ═══

Output: a SINGLE self-contained .html file. Loaded in headless Chrome
(Puppeteer) at viewport {{viewport}}. A virtual clock shim overrides
Date.now / performance.now / requestAnimationFrame. Captured at {{fps}}fps.
FFmpeg muxes the PNGs into MP4 (libx264, yuv420p).

YOU ARE NOT MAKING:
- A landing page
- A deck/slideshow with prev/next buttons
- A documentation page describing what would happen in a video
- A page the user navigates with keyboard/mouse
- Anything with vertical scroll
- Anything with play/pause/restart controls

YOU ARE MAKING:
- ONE HTML file rendering ONE viewport ({{viewport}}) at any given moment
- 100% time-based animations via CSS @keyframes with precise animation-delay
- Animation timeline = the duration the user asked for (or {{duration}}s default)
- Zero interactivity: no buttons, no nav, no clicks, no hover, no scroll
- Zero setTimeout (lints will warn — breaks under virtual clock)
- Zero Math.random without seedrandom (frames must be deterministic)
- "Time passing" in the video = animation playing, NOT user clicking

═══ SCENE CONTRACT (REQUIRED — for editor compatibility) ═══

Wrap each scene in a <section> with explicit metadata, in document order:

  <section data-scene="01" data-start="0" data-duration="3" data-name="Opening">
    ...
  </section>

- data-scene: 2-digit ordinal ("01", "02", …).
- data-start: scene start time in SECONDS from t=0.
- data-duration: scene length in seconds.
- data-name: short human label ("Opening", "Maestro intro", "Pipeline", …).

After the </body>, emit a JSON manifest the editor can parse:

  <script type="application/df-manifest">
  {
    "duration": 18,
    "fps": 30,
    "scenes": [
      { "id": "01", "name": "Opening", "start": 0, "duration": 3 },
      ...
    ]
  }
  </script>

The editor reads this manifest to build a timeline. Don't skip it.

═══ EXPLAINER PRINCIPLES ═══

- Every element on screen IS TEACHING something. If it doesn't teach, cut it.
- Layered information that overlaps temporally (Layer 1: what it is.
  Layer 2: how it works. Layer 3: what changes).
- Animated visual objects (boxes that enter, arrows that connect, data
  that appears, before/after that morphs) — animation SERVES clarity.
- Pace: 1 new idea every 1.5-2.5s on shorter videos; 2.5-4s on longer
  ones (>60s). Don't fire-hose.
- Every animation answers "why did this just move?".

═══ CSS TIME-BASED TECHNIQUES ═══

- @keyframes with animation-delay: precise ms-based entry/exit.
- animation-fill-mode: forwards (preserves final state).
- animation-iteration-count: 1 (no loop, except in hero-loop format).
- transform + opacity ONLY (60fps; never width/height/top/left/margin).
- Scene visibility via @keyframes that animates opacity over time windows.
- requestAnimationFrame is OK (virtual-clocked). setInterval/setTimeout: NO.`,
    anti_slop: [
      "No generic fade-in on every element. Each animation must justify its property, duration, and curve.",
      "No spring overshoot on every pop. Bounce >0.3 reads as cartoonish in UI. Sweet spot: 0.1-0.3.",
      "No particle field canvas (sparks, embers, dust). Motion comes from didactic elements.",
      "No mesh gradient bg with 4-6 orbs and mix-blend screen. Background is a solid surface from the DS or has a didactic purpose.",
      "No skewed light streak between scenes. Transitions are logical (hard cut, push, morphological continuation).",
      "No serif italic accent on coloured words. Resolve hierarchy via weight, scale, or solid colour.",
      "No word-stagger fade-up letter-by-letter as default entry. Use clip-path reveal, mask, or whole-block entries.",
      "No vignette + grain overlay by default. If grain is present, it serves a deliberate purpose (printed feel, atmosphere).",
      "No coloured side stripe (border-left) on cards or callouts. AI fingerprint.",
    ],
  },
  {
    id: "logo-reveal",
    categoria: "video",
    nome: "Logo Reveal",
    descricao: "Brand mark presentation. Everything builds toward the final frame.",
    canvas: { ratio: "16:9", duration: 4 },
    prompt_prefix: `You are producing a LOGO REVEAL VIDEO.

═══ CANVAS ═══

Aspect ratio: {{ratio}}. Viewport: {{viewport}}.
Duration: {{duration}}s @ {{fps}}fps ({{frames}} frames total).

The HTML body MUST render at the exact viewport pixel size above —
nothing else. Set:

  html, body { width: {{viewport_w}}px; height: {{viewport_h}}px; margin: 0; }

If the ratio is 9:16 or 1:1, the body is portrait/square — compose
vertically, don't just shrink a 16:9 layout. Headlines, logos,
elements scale to fill the new shape.

═══ OUTPUT PIPELINE ═══

Output: ONE self-contained HTML file rendering at {{viewport}}.
A headless Chrome captures frame-by-frame at {{fps}}fps. A virtual clock
shim controls Date.now / performance.now / RAF. FFmpeg muxes into MP4.

NOT a deck, not an interactive page, not a scroll-based landing, not a
visual doc. IS an HTML with timed CSS @keyframes that plays a logo
reveal of the requested duration.

FORBIDDEN: setTimeout (breaks the virtual clock), Math.random without a
seed, buttons/nav/clicks, scroll, hover effects.

═══ SCENE CONTRACT (REQUIRED) ═══

Wrap the build-up, pause, reveal, and settle in <section data-scene="..."
data-start="..." data-duration="..." data-name="..."> blocks. After
</body>, emit a JSON manifest the editor parses:

  <script type="application/df-manifest">
  {
    "duration": 4,
    "fps": 30,
    "scenes": [
      { "id": "build", "name": "Build-up", "start": 0,   "duration": 2.4 },
      { "id": "pause", "name": "Pause",    "start": 2.4, "duration": 0.4 },
      { "id": "reveal","name": "Reveal",   "start": 2.8, "duration": 0.1 },
      { "id": "settle","name": "Settle",   "start": 2.9, "duration": 1.1 }
    ]
  }
  </script>

EVERY scene MUST include an "id" field, and that id MUST equal the
"data-scene" attribute on the matching <section>. The editor uses id
as the lookup key for resize / find-replace / scoped refine — a
mismatch silently breaks all scoped editing.

Don't emit any scene with duration under 0.05s. The "hard reveal" is
one beat, not one frame — give it ~0.1s minimum so the timeline is
clickable and the editor can scope edits to it.

═══ LOGO REVEAL PRINCIPLES ═══

- The final ~25% of the duration is the logo, clean, still, legible.
  Everything before builds to that moment.
- Every element relates to the logo (shape, colour, concept). Not parallel
  decoration.
- Recommended structure (scale to actual duration):
  - First 60%   : build-up (related shapes converging)
  - Next 10%    : pause before reveal
  - One frame   : hard reveal (cut, not fade)
  - Final 25%   : settle — stable logo + subtle breathing/glow
- The reveal is ONE EVENT. Don't reveal "logo + tagline + CTA" all at
  once — logo first, alone. Tagline / CTA belong to a separate piece.`,
    anti_slop: [
      "No shimmer/sweep gradient crossing the logo at the end. Stock motion slop.",
      "No particle burst at the reveal moment. Stock motion slop.",
      "No pulsing drop shadow on the logo. Logo is flat or has real weight, not 'glow'.",
      "No tagline fade-in below the logo at the end. If a tagline is needed, it's a separate piece.",
      "No generic mesh gradient bg. Background is a solid colour or a brand-relevant texture.",
    ],
  },
  {
    id: "hero-loop",
    categoria: "video",
    nome: "Hero Loop",
    descricao: "Seamless loop. Last frame matches first. For autoplay on landing pages.",
    canvas: { ratio: "16:9", duration: 8 },
    prompt_prefix: `You are producing a HERO LOOP VIDEO.

═══ CANVAS ═══

Aspect ratio: {{ratio}}. Viewport: {{viewport}}.
Loop duration: {{duration}}s @ {{fps}}fps ({{frames}} frames total).

The HTML body MUST render at the exact viewport pixel size above:

  html, body { width: {{viewport_w}}px; height: {{viewport_h}}px; margin: 0; }

If the ratio is 9:16 or 1:1, compose for the actual shape — drift /
breathing / parallax that fills a vertical or square frame, not a
16:9 hero squished into the box.

═══ OUTPUT PIPELINE ═══

Output: ONE self-contained HTML file at {{viewport}}. Headless Chrome
captures at {{fps}}fps. Virtual clock shim controls timing. FFmpeg muxes
into MP4 that loops on landing pages with silent autoplay.

NOT a deck, not an interactive page, not a scroll-based landing, not a
static hero section. IS an HTML with timed CSS @keyframes that creates a
seamless loop of the requested duration.

FORBIDDEN: setTimeout (breaks virtual clock), Math.random without a seed,
buttons/nav/clicks, scroll, hover effects.

═══ SCENE CONTRACT (REQUIRED) ═══

Even hero loops emit the manifest so the editor can show timing. Wrap
the loop in a single <section data-scene="01" data-start="0"
data-duration="{{duration}}" data-name="Hero loop"> block (or split
into phases if there are clear sub-states). After </body>, emit:

  <script type="application/df-manifest">
  {
    "duration": {{duration}},
    "fps": 30,
    "scenes": [
      { "id": "01", "name": "Hero loop", "start": 0, "duration": {{duration}} }
    ]
  }
  </script>

EVERY scene MUST include an "id" matching the "data-scene" attribute
of the section. No id = scoped editing breaks silently.

═══ HERO LOOP PRINCIPLES ═══

- The loop is SEAMLESS: frame 0 === frame N visually. Animations begin
  and end in the SAME state. Use animation-iteration-count: infinite with
  keyframes that return to the 0% state at 100%.
- Silent autoplay: no surprise, no narrative, no strong beats. Must be
  PLEASANT IN THE BACKGROUND continuously.
- Continuous low-frequency motion (drift, breathing, subtle parallax),
  not punctuated events with pauses.
- 1-2 textual elements MAX. The rest is movement, shape, colour.
- Think breathe, flow, drift. Not "explain".`,
    anti_slop: [
      "No tagline cycling words (rotating words). SaaS cliché.",
      "No word-stagger fade-up inside the loop. Text, if present, is always there or appears once at the start.",
      "No serif italic accent. Same reason as in the explainer.",
      "No mesh gradient with mix-blend screen. Default slop.",
      "No particle field. Default slop.",
    ],
  },

  // ─── INTERFACE ─────────────────────────────────────────────────────
  {
    id: "landing-page",
    categoria: "interface",
    nome: "Landing page",
    descricao: "Full page: hero + 2-4 sections + footer. Vertical scroll.",
    canvas: { ratio: "16:9", duration: 0 },
    prompt_prefix: `You are producing a complete LANDING PAGE.

PRINCIPLES:
- Minimum structure: HERO → 1 "what it is / how it works" section (with
  visual) → 1 social proof OR features section → final CTA → FOOTER.
  Max 5-6 sections — short landings convert better than long.
- Each section makes ONE point. If it has 3 points, split it (or drop 2).
- Consistent typographic hierarchy across sections: H1 (hero) > H2
  (section heading) > H3 (subheading inside). Same family, same scale.
- Vertical spacing between sections: 96-160px desktop. Don't go less, don't go more.
- Footer is simple: brand mark + 2 columns of links + copyright. Nothing else.
- 1 primary CTA per viewport. Secondaries are ghost/outline.`,
    anti_slop: [
      "No gradient text-clip on the hero headline. Reduces scannability. Use weight/size/solid colour for emphasis.",
      "No glow/neon box-shadow on the CTA button. SaaS slop.",
      "No 3-col 'features grid' with rounded icon tiles. AI feature-card pattern.",
      "No grid of N identical cards with icon + heading + body. Differential hierarchy required — one card dominates.",
      "No big number + tiny label + 3 supporting stats + gradient accent. Recognisable SaaS template.",
      "No 'trusted by' / 'powered by' grid of grey logos. B2B cliché.",
      "No animated gradient bg with infinite keyframes. Background is flat or has a deliberate texture.",
      "No 3-col pricing with the middle plan highlighted in a coral gradient. Pricing can be a flat row.",
    ],
  },
  {
    id: "interface-screen",
    categoria: "interface",
    nome: "Interface (free screen)",
    descricao: "Single UI screen — dashboard, settings, modal, app screen.",
    canvas: { ratio: "16:9", duration: 0 },
    prompt_prefix: `You are producing ONE INTERFACE SCREEN — not a landing, not a hero. A real app screen.

PRINCIPLES:
- Dense with useful information. App screens are NOT heroes — many
  elements are fine, as long as hierarchy is clear.
- Recurring components (buttons, inputs, cards, tables) follow the SAME
  visual system across the screen. Consistent paddings, radii, weights.
- Layout: compact top nav + sidebar (if needed) + main content. Don't
  centre a "single card in the middle".
- Data is REAL-LOOKING (plausible names, values, dates). Never Lorem
  ipsum, never "John Doe", never "$XX.XX".
- Show 4 states: loading (skeleton), empty (CTA), error (retry), data.
- Hover responds with more than colour change — subtle scale, bg shift, border, or reveal.`,
    anti_slop: [
      "No generic 'sample dashboard' with fake chart and 4 stat cards on top. Template cliché.",
      "No avatar circles with hash-coloured initials. GitHub/Linear cliché.",
      "No frosted-glass cards floating with backdrop-filter. Glass needs a reason (overlay on rich content, sticky bar).",
      "No nested cards (cards inside cards). Always wrong. Hierarchy comes from spacing/typography, not containment.",
      "No coloured side stripe (border-left) on cards/alerts. AI fingerprint.",
      "No wrapping everything in cards by default. Some elements deserve open air — lists, dividers, section headers.",
      "No 'AI insight' sparkle (✨) badge decorating something.",
    ],
  },
  {
    id: "slides",
    categoria: "interface",
    nome: "Slides (deck)",
    descricao: "Multi-slide 16:9 presentation. Each slide is a navigable screen.",
    canvas: { ratio: "16:9", duration: 0 },
    prompt_prefix: `You are producing a multi-slide DECK at 16:9.

PRINCIPLES:
- Each slide makes ONE point. Two points = two slides.
- Hierarchical typography: 1 large headline, 1-2 subheads/data points,
  generous negative space. A text-stuffed slide is a document, not a slide.
- Slide-to-slide transitions are the reader's job. Slides are STATIC
  individually.
- Subtle slide numbering in one corner (e.g., "07 / 24" in small-caps mono, bottom-right).
- Brand mark consistently in one corner (same place on every slide).
- Composition varies between slides (asymmetric, monumental, text-only) —
  but always one idea per slide.`,
    anti_slop: [
      "No 'Agenda' slide with 5 bullets and icons. Keynote slop.",
      "No 'Thank you' slide on a coral gradient bg. Universal slop.",
      "No stat slide with '99.9%' in gradient text-clip.",
      "No quote slide with giant coral italic-Fraunces quotation marks. Cliché.",
      "No data slide with 4 equidistant stat cards in 2x2 plus sparklines.",
      "No decorative emoji in slide headlines.",
      "No multiple accent colours on one slide. One section = one idea = one accent.",
    ],
  },
  {
    id: "hero-section",
    categoria: "interface",
    nome: "Hero Section",
    descricao: "Above-the-fold landing block. 1-2 sentences + CTA + visual. Static.",
    canvas: { ratio: "16:9", duration: 0 },
    prompt_prefix: `You are producing a static HERO SECTION.

PRINCIPLES:
- 1 main sentence (short headline) + 1 supporting sentence + 1 CTA.
  More than that scatters attention.
- Clear typographic hierarchy: monumental headline (clamp 56-128px),
  modest support (16-22px), CTA with weight and 44px+ touch height.
- Supporting visual at right or below: a single image/screenshot/diagram. Not a gallery.
- Generous spacing. Side margin minimum 8% of viewport. Vertical gap before content: 18-25vh.`,
    anti_slop: [
      "No gradient text-clip on the headline.",
      "No glow/neon box-shadow on the CTA. SaaS slop.",
      "No mockup of laptop/phone floating in 3D rotateY. B2B slop. Use a plain mockup, well-rendered.",
      "No serif italic on coloured key words in the headline. Resolve via weight or all-caps.",
      "No animated gradient bg with infinite keyframes. Background is flat or has a specific texture.",
      "No 'AI-powered · Real-time · Secure' chip pills above the headline. B2B slop.",
      "No purple-to-blue gradient bg or CTA. AI fingerprint.",
    ],
  },
  {
    id: "pricing-card",
    categoria: "interface",
    nome: "Pricing Card",
    descricao: "Single plan card (not the full table). Tests hierarchy + list pattern.",
    canvas: { ratio: "9:16", duration: 0 },
    prompt_prefix: `You are producing ONE PRICING CARD.

PRINCIPLES:
- Hierarchy: plan name (small caps) > big price > period > separator >
  4-7 features > CTA.
- The PRICE is the main element. It dominates the card typographically.
  Use weight, scale, and tracking. Numbers tabular-nums for alignment.
- Feature list: each item one short line, left-aligned, consistent
  bullet (or none). No "✓ Awesome feature with 5 sub-bullets".
- The card has real visual weight: defined border or justified shadow,
  not a "spongy floating card".`,
    anti_slop: [
      "No 'MOST POPULAR' badge in coral gradient above the card. Cliché. Use weight or border accent if you must highlight.",
      "No green ✓ icon before each feature. Use a square bullet, dash, or nothing. Green checkmark is B2B slop.",
      "No gradient text-clip on the price.",
      "No 'monthly/annual' toggle with glow. Plain UI suffices.",
      "No frosted-glass card with backdrop-filter.",
    ],
  },

  // ─── SOCIAL ────────────────────────────────────────────────────────
  {
    id: "og-image",
    categoria: "social",
    nome: "OG Image",
    descricao: "1200×630 link unfurl preview for Twitter/Slack/LinkedIn. Static.",
    canvas: { ratio: "1.91:1", duration: 0 },
    prompt_prefix: `You are producing an OG IMAGE — link unfurl in social feeds.

PRINCIPLES:
- 1.91:1 is wide. Asymmetric composition: text on the left 60%, visual
  on the right 40% (or vice versa). DO NOT centre.
- Text must be LEGIBLE AT 200px WIDTH (small preview in feed). Min 56-72px
  base font size, high contrast.
- Logo / brand mark in one corner, small, consistent. Not in the middle.
- 1 dominant colour + 1 accent. Not 4.`,
    anti_slop: [
      "No diagonal coral/teal/purple gradient bg. Notion/Linear copy slop.",
      "No 'dotted grid bg' SVG pattern. Slop.",
      "No giant emoji as the focal element.",
      "No frosted-glass card floating with backdrop-filter.",
      "No coral neon shadow behind the title.",
    ],
  },
  {
    id: "carousel-square",
    categoria: "social",
    nome: "Square carousel",
    descricao: "Multi-slide 1:1 for Instagram/LinkedIn. 3-7 slides, continuous narrative.",
    canvas: { ratio: "1:1", duration: 0 },
    prompt_prefix: `You are producing a CAROUSEL — multiple 1:1 slides.

PRINCIPLES:
- Each slide makes 1 point. Two = split into two slides.
- Visual continuity between slides: same grid, same type family, same
  palette. Variation comes from CONTENT, not decoration.
- Slide 1 is the hook (stops the scroll). Slide N is the CTA / payoff.
- Subtle slide numbering in one corner (e.g. "01 / 05" small-caps mono).
- Large text, mobile-legible. Min 28px base, 56-72px on headlines.`,
    anti_slop: [
      "No giant 'swipe →' arrow in the bottom-right corner. Creator slop.",
      "No avatar + creator handle on every slide. Cliché. Show only on first or last slide.",
      "No decorative emoji in headlines (e.g. '🚀 Launch faster').",
      "No different gradient bg per slide. Continuity > decorative variation.",
      "No 'pull-quote' in giant coral italic-Fraunces in the middle. Cliché.",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// DIRECTIONS — toggleable. All start UNCHECKED.
// ─────────────────────────────────────────────────────────────────────

export const EIXOS: Eixo[] = [
  { id: "motion", nome: "Motion", descricao: "How elements enter, exit, and move" },
  { id: "typography", nome: "Typography", descricao: "Hierarchy, scale, and type families" },
  { id: "layout", nome: "Composition", descricao: "Grid, distribution, spatial hierarchy" },
  { id: "surfaces", nome: "Surfaces", descricao: "Background, depth, texture" },
  {
    id: "anti-slop",
    nome: "Anti-slop",
    descricao: "Extra prohibitions on top of the format presets",
  },
];

export const DIRECTIONS: Direction[] = [
  // ─── MOTION ──────────────────────────────────────────────────────
  {
    id: "motion-clip-path-reveal",
    eixo: "motion",
    nome: "Clip-path reveal",
    descricao: "Text emerges from the surface via shape mask, not a fade.",
    rule_ref: "motion-clip-path-reveal",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `MOTION — Clip-path reveal:
Text/elements appear via animated clip-path: inset() (shape mask reveal), not opacity 0→1. Sense of "emerges from surface". Apply on headlines, transitions, scene reveals. Classic ease-out, 400-600ms.`,
  },
  {
    id: "motion-spring-bounce-subtle",
    eixo: "motion",
    nome: "Subtle spring bounce",
    descricao: "Bounce 0.1-0.3 (UI sweet spot). Above 0.3 reads as cartoonish.",
    rule_ref: "motion-spring-bounce-subtlety",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `MOTION — Spring bounce subtle:
Spring animations use bounce 0.1-0.3 (cubic-bezier with minimal overshoot). Bounce 0 = entirely smooth. Bounce >0.3 = cartoonish in UI. Apply on entries, toggles, popovers. Duration 200-400ms.`,
  },
  {
    id: "motion-blur-transition",
    eixo: "motion",
    nome: "Blur on transition",
    descricao: "filter: blur(2-4px) during state transitions. Smooth crossfade.",
    rule_ref: "motion-blur-transition-polish",
    aplica: { categorias: ["video", "interface"] },
    prompt_addon: `MOTION — Blur transition polish:
On state transitions (modal open, drawer slide, scene change), apply filter: blur(2-4px) on the entering element for 80-150ms then settle to blur(0). Masks edge imperfection between states. Smooth crossfade with no truly-static frame.`,
  },
  {
    id: "motion-split-stagger",
    eixo: "motion",
    nome: "Semantic stagger",
    descricao: "Animate by word/chunk with 80-100ms gap. Never the whole container.",
    rule_ref: "motion-split-stagger-enter",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `MOTION — Split stagger enter:
Section entry is split into SEMANTIC chunks (words in a headline, items in a list) with 80-100ms stagger between each. Never animate the whole container (anti-slop generic fade-in). Title 80ms/word, list 60-90ms/item.`,
  },
  {
    id: "motion-beat-pause",
    eixo: "motion",
    nome: "Beat pauses",
    descricao: "167-367ms pauses between beats in sequential animations.",
    rule_ref: "motion-beat-pause-breathing",
    aplica: { categorias: ["video"] },
    prompt_addon: `MOTION — Beat pause breathing:
Sequential animations (AV, product reveals) include DELIBERATE 10-22 frame (167-367ms) pauses between beats. Pause = information settling. Frames between beat A and beat B are static for that window — not constant motion.`,
  },
  {
    id: "motion-no-fade",
    eixo: "motion",
    nome: "No fade-in default",
    descricao: "Banish opacity 0→1 as the default entry. Pick a real motion language.",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `MOTION — No fade default:
Opacity 0→1 by itself is a placeholder for "I didn't decide". Pick a deliberate entry per element type: clip-path reveal for text, scale + translateY for cards, slide from edge for drawers, mask wipe for scene change. Fade can compose, but never alone.`,
  },
  {
    id: "motion-transform-opacity-only",
    eixo: "motion",
    nome: "Transform + opacity only",
    descricao: "Animate only transform and opacity. Never width/height/top/left.",
    rule_ref: "motion-transform-opacity-only",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `MOTION — Transform + opacity only:
Animate ONLY the \`transform\` and \`opacity\` properties for 60fps consistency. Never animate width, height, top, left, margin, padding — they trigger layout passes and cause CLS. Use translate / scale / rotate to move and resize.`,
  },
  {
    id: "motion-duration-under-300ms",
    eixo: "motion",
    nome: "User motion under 300ms",
    descricao: "Hover/press 120-180ms. Entries 150-260ms. Exits ~20% faster.",
    rule_ref: "motion-duration-under-300ms",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `MOTION — Duration under 300ms:
User-triggered motion stays under 300ms. Hover/press 120-180ms. Entries 150-260ms. Exits ~20% faster than enters. Long durations on UI feedback reads as sluggish, not graceful.`,
  },
  {
    id: "motion-subtle-exit",
    eixo: "motion",
    nome: "Subtle, fast exit",
    descricao: "Exits don't mirror entries. 150ms, slight translate + blur, gone.",
    rule_ref: "motion-subtle-exit-animation",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `MOTION — Subtle exit:
Element exits last 150ms with translateY -12px (or other small displacement) + filter blur(4px). Never the mirror of the entry. Enter can be 300ms+ elaborate; exit is brief and gets out of the way.`,
  },

  // ─── TYPOGRAPHY (additions) ──────────────────────────────────────
  {
    id: "typography-tight-line-height",
    eixo: "typography",
    nome: "Tight display line-height",
    descricao: "Display: 1.05-1.2. Body: 1.4-1.6. Below 1.3 in body fatigues.",
    rule_ref: "typography-tight-line-height-min-1-3",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Tight line-height:
Display sizes use line-height 1.05-1.2 for visual punch. Body uses 1.4-1.6 for comfort. Don't compress body below 1.3 — it fatigues the reader and breaks tracking.`,
  },
  {
    id: "typography-body-width-65ch",
    eixo: "typography",
    nome: "Reading width capped at 65ch",
    descricao: "Long-form paragraphs cap at ~65 characters per line.",
    rule_ref: "typography-body-width-65ch",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Body width 65ch:
Long-form text caps at max-width 65ch (or ~600-720px). Wider lines exhaust the eye; shorter ones break flow. Single column reading column = 65ch sweet spot.`,
  },
  {
    id: "typography-wrap-balance",
    eixo: "typography",
    nome: "Headline wrap balance",
    descricao: "text-wrap: balance for headlines. text-wrap: pretty for body.",
    rule_ref: "typography-wrap-balance-pretty",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Wrap balance / pretty:
Apply \`text-wrap: balance\` to headlines so multi-line titles distribute evenly (no orphan word). Apply \`text-wrap: pretty\` to body to avoid single-word last lines. Both have native browser support and zero JS.`,
  },

  // ─── LAYOUT (additions) ──────────────────────────────────────────
  {
    id: "layout-container-max-width",
    eixo: "layout",
    nome: "Content max-width",
    descricao: "Cap content at ~1400px. Full-viewport reading is illegible on big screens.",
    rule_ref: "layout-container-max-width",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `LAYOUT — Container max-width:
Cap content at max-width ~1400px (or 80-90ch for reading). Full-viewport content on 1920-3840px monitors becomes illegible — too much eye-travel between left and right columns. The cap creates a defined reading zone.`,
  },
  {
    id: "layout-state-machine",
    eixo: "layout",
    nome: "Four states for data UIs",
    descricao: "Loading (skeleton), empty (CTA), error (retry), data. Missing state = template.",
    rule_ref: "layout-state-machine-completeness",
    aplica: { categorias: ["interface"] },
    prompt_addon: `LAYOUT — State machine completeness:
Every component that fetches data must show 4 states: loading (skeleton), empty (with a CTA, not a dead-end), error (with retry), and data. Missing one state means you tested only the happy path. Skeleton should suggest the shape of the content that's coming.`,
  },

  // ─── SURFACES (additions) ────────────────────────────────────────
  {
    id: "surfaces-card-exact-border",
    eixo: "surfaces",
    nome: "Alpha-aware card border",
    descricao: "border: 1px solid rgba(...) — alpha matches the surrounding bg.",
    rule_ref: "surfaces-card-exact-border",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `SURFACES — Alpha card border:
Card borders use 1px with alpha-aware colour: rgba(white, 0.07) on dark bg, rgba(black, 0.10) on light bg. Solid colour borders create hard edges that fight multiple backgrounds. Alpha responds to whatever sits behind.`,
  },
  {
    id: "surfaces-concentric-radius",
    eixo: "surfaces",
    nome: "Concentric radius",
    descricao: "Outer radius = inner radius + padding. Nested elements feel locked together.",
    rule_ref: "surfaces-concentric-radius-depth",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `SURFACES — Concentric radius:
Nested rounded elements respect: outer radius = inner radius + padding. A 16px rounded card containing a 12px rounded button with 4px padding feels locked together. Mismatched radii make nested elements look glued, not designed.`,
  },

  // ─── ANTI-SLOP (additions) ───────────────────────────────────────
  {
    id: "anti-nested-cards",
    eixo: "anti-slop",
    nome: "No nested cards",
    descricao: "Cards inside cards. Always wrong. Hierarchy via spacing, not containment.",
    rule_ref: "anti-slop-nested-cards",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Nested cards:
FORBIDDEN: cards inside cards. Always wrong, no exception. Visual noise and excessive depth. Hierarchy comes from spacing and typography, not from nesting containers.`,
  },
  {
    id: "anti-multiple-accents",
    eixo: "anti-slop",
    nome: "One accent per section",
    descricao: "Multi-accent = visual noise + indecision.",
    rule_ref: "anti-slop-multiple-accents",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Multiple accents:
FORBIDDEN: multiple accent colours in the same section. One section = one dominant idea = one accent. Multi-accent creates visual noise, breaks hierarchy, signals indecision. Use weight or scale for sub-emphasis instead.`,
  },
  {
    id: "anti-placeholder-content",
    eixo: "anti-slop",
    nome: "No Lorem ipsum / John Doe",
    descricao: "Use real-looking data, not template placeholders.",
    rule_ref: "anti-slop-placeholder-content",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Placeholder content:
FORBIDDEN: "John Doe", "$99/mo", "Company Inc.", Lorem ipsum, "your_email@example.com" in any output meant to ship. Use plausible domain-relevant fictional data — names, dates, values, copy that someone could actually type.`,
  },
  {
    id: "anti-generic-drop-shadows",
    eixo: "anti-slop",
    nome: "No template box-shadow",
    descricao: "0 4px 8px rgba(0,0,0,0.1) is copy-paste from tutorials. Layered + intent.",
    rule_ref: "anti-slop-generic-drop-shadows",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Generic drop shadows:
FORBIDDEN: a single box-shadow like \`0 4px 8px rgba(0,0,0,0.1)\` on every rounded card. That's copy-paste from tutorials. Real depth needs layered shadows (ring + lift + ambient) with intent — see the Three-layer shadow direction.`,
  },
  {
    id: "anti-color-courage-missing",
    eixo: "anti-slop",
    nome: "No grayscale-only output",
    descricao: "All-grey UI without an accent reads as a template, not a decision.",
    rule_ref: "anti-slop-color-courage-missing",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Color courage missing:
FORBIDDEN: an entire UI in grayscale with no accent. Reads as a neutral template, not a deliberate choice. One strong colour, intentionally placed, signals confidence. The accent doesn't need to be loud — it needs to be present and earned.`,
  },

  // ─── TYPOGRAPHY ──────────────────────────────────────────────────
  {
    id: "typography-monumental-numbers",
    eixo: "typography",
    nome: "Monumental numbers",
    descricao: "Numbers in hero/stats are 180px+ with tight tracking.",
    rule_ref: "typography-monumental-numbers",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Monumental numbers:
Numbers in editorial contexts (stats, counters, dates, prices) are 180px+ with tight tracking (-0.04em). Creates visual hierarchy + memorable presence. Use font-variant-numeric: tabular-nums when values change at runtime.`,
  },
  {
    id: "typography-headline-presence",
    eixo: "typography",
    nome: "Headline with weight",
    descricao: "Hero headlines are clamp 48px+, medium+, tracking-tight, balanced.",
    rule_ref: "typography-headline-presence",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Headline presence:
Hero headlines have real visual weight — minimum clamp(48px, 7vw, 110px) + font-weight 500-600 + letter-spacing -0.02em + text-wrap: balance. Small + light = zero impact. Don't use sub-30px for primary titles.`,
  },
  {
    id: "typography-serif-editorial",
    eixo: "typography",
    nome: "Editorial serif",
    descricao: "Use serif in long-form content. Not in operational UI.",
    rule_ref: "typography-serif-editorial-only",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Serif editorial only:
Use serif fonts in long-form content, manifestos, blockquotes, editorial copy — NOT in operational UI, dashboards, data displays. Italic accent is one word or phrase, never the default style.`,
  },
  {
    id: "typography-weight-variety",
    eixo: "typography",
    nome: "Weight variety",
    descricao: "400/500/600/700 gradation. Not just 400 + 700.",
    rule_ref: "typography-weight-variety",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Weight variety:
Hierarchy by weight needs real gradation: Regular (400) body, Medium (500) sub-headers, Semibold (600) main headers, Bold (700) display. Only 400+700 = binary without nuance and signals lack of care.`,
  },
  {
    id: "typography-tabular-nums",
    eixo: "typography",
    nome: "Tabular numbers",
    descricao: "Numbers that change at runtime align by column. No layout shift.",
    rule_ref: "typography-tabular-nums",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `TYPOGRAPHY — Tabular nums:
Any number that changes at runtime (prices, metrics, timers, counters) uses font-variant-numeric: tabular-nums to avoid micro layout shift. Static labels can use proportional figures freely.`,
  },

  // ─── LAYOUT (composition) ─────────────────────────────────────────
  {
    id: "layout-bento-asymmetric",
    eixo: "layout",
    nome: "Asymmetric bento",
    descricao: "Cards of varied sizes (1fr vs 2fr, rowspans). Built-in hierarchy.",
    rule_ref: "layout-bento-asymmetric",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `LAYOUT — Bento asymmetric:
Use a bento grid: cards of varied sizes (1fr vs 2fr, rowspans, colspans). A uniform 3-col grid is feature-SaaS slop. Bento has built-in visual hierarchy — one card "dominates" (2x2), others support. Ratio between largest and smallest: 2-3x.`,
  },
  {
    id: "layout-editorial-asymmetric",
    eixo: "layout",
    nome: "Editorial asymmetry",
    descricao: "Empty centre. Content hugs one edge. Negative space is active.",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `LAYOUT — Editorial asymmetric:
The centre of the screen is EMPTY or neutral. Main content hugs ONE edge (left 65%, right empty; or top 70% / bottom empty). Negative space is an ACTIVE composition element, not leftover. In UI, that means a single side column instead of a centred card.`,
  },
  {
    id: "layout-progressive-disclosure",
    eixo: "layout",
    nome: "Progressive disclosure",
    descricao: "Primary path visible. Details behind tabs/steps/disclosure.",
    rule_ref: "layout-progressive-disclosure-first",
    aplica: { categorias: ["interface"] },
    prompt_addon: `LAYOUT — Progressive disclosure first:
Organise the layout by priority. The primary path is VISIBLE first. Advanced details sit behind disclosure (accordion, tabs, "show more"). Not "everything at once". Reduces overwhelm + creates discovery.`,
  },
  {
    id: "layout-broken-grid",
    eixo: "layout",
    nome: "Broken grid",
    descricao: "Establish a grid. Break it in 1-2 deliberate spots.",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `LAYOUT — Broken grid:
Establish a clear grid (12-col or 8-col) and break it at 1-2 specific spots: one element overflows 1-2 cols, or one element is misaligned vertically by ±8-16px. The break is INTENTIONAL and minimal. 90% of the layout respects the grid; 10% violates it deliberately.`,
  },

  // ─── SURFACES ────────────────────────────────────────────────────
  {
    id: "surfaces-grain-overlay",
    eixo: "surfaces",
    nome: "Grain overlay",
    descricao: "Single fixed grain across viewport. Not per component.",
    rule_ref: "surfaces-grain-overlay",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `SURFACES — Grain overlay:
Apply grain texture ONCE as a fixed overlay covering the full viewport (not per component). SVG <feTurbulence baseFrequency="0.6-0.9" numOctaves="2"/> with opacity 0.03-0.06 over a solid surface. Performance + consistency. Don't rely on the mix-blend-overlay cliché.`,
  },
  {
    id: "surfaces-shadow-layering-3",
    eixo: "surfaces",
    nome: "Three-layer shadow",
    descricao: "Ring 1px + lift 8-12px + ambient 24-40px. Never one strong shadow.",
    rule_ref: "surfaces-shadow-layering-3",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `SURFACES — Shadow layering 3:
Depth comes from MULTIPLE soft layered shadows:
- Ring (1px solid, alpha 0.05) — definition
- Lift (8-12px blur, 4px y-offset, alpha 0.08) — separation from bg
- Ambient (24-40px blur, 12px y-offset, alpha 0.04) — atmosphere
Never one strong shadow. Warm undertone aligned with palette.`,
  },
  {
    id: "surfaces-texture-required",
    eixo: "surfaces",
    nome: "Subtle texture required",
    descricao: "Flat solid bgs feel sterile. Grain or micro-pattern adds material feel.",
    rule_ref: "surfaces-texture-required",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `SURFACES — Texture required:
Flat solid colour backgrounds feel sterile and AI-generated. Apply subtle grain (0.03-0.06 opacity) or micro-pattern (diagonal lines 0.5px every 4-8px) for material feel. A "clean" bg should HAVE texture, not LACK it.`,
  },
  {
    id: "surfaces-off-black",
    eixo: "surfaces",
    nome: "Off-black, never #000",
    descricao: "Use #0a0a0a, #121212, or a warm off-black. Never pure black.",
    rule_ref: "surfaces-off-black-always",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `SURFACES — Off-black always:
Text, icons, borders, dark surfaces use off-black: #0a0a0a, #121212, or a warm off-black. NEVER #000 absolute. Off-black allows depth (visible shadow), integrates with warm/cool palettes, avoids hard optical edges. Pure black is a template flag.`,
  },
  {
    id: "surfaces-halftone-print",
    eixo: "surfaces",
    nome: "Halftone print",
    descricao: "Circular dots simulate offset print. Density via opacity.",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `SURFACES — Halftone:
Apply a halftone overlay (variable-size circular dots) over a solid surface. CSS radial-gradient (repeating) with background-size 6-10px. Dot colour is a darker shade of the bg. Density reflects tone via opacity gradient.`,
  },

  // ─── ANTI-SLOP EXTRA — opt-in toggles ────────────────────────────
  // Format presets cover the common cases. These are extras users can
  // enable globally on top of those.
  {
    id: "anti-emoji-muleta",
    eixo: "anti-slop",
    nome: "No emoji crutch",
    descricao: "Emoji in headlines, alts, CTAs = lazy. Use SVG icons.",
    rule_ref: "anti-slop-emoji-muleta",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Emoji crutch:
FORBIDDEN: emoji in headlines, alts, CTAs, decorations ("🚀 Launch", "💡 Idea"). Emoji in UI = lazy creativity, AI fingerprint. Use SVG icons (Phosphor, Radix, Lucide) or geometric chars (▶ ◉ ▦ ◆) when appropriate.`,
  },
  {
    id: "anti-glass-everywhere",
    eixo: "anti-slop",
    nome: "No decorative glass",
    descricao: "backdrop-filter: blur only with reason. Decorative use forbidden.",
    rule_ref: "anti-slop-glass-everywhere",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Glass everywhere:
FORBIDDEN: backdrop-filter: blur + transparency used decoratively on any card/modal/panel. Glass needs a REASON (overlay on rich content, sticky bar on scroll). Decorative use is AI fingerprint. Use solid bg + defined border instead.`,
  },
  {
    id: "anti-gradient-text",
    eixo: "anti-slop",
    nome: "No gradient text-clip",
    descricao: "background-clip: text + gradient. Decorative, hurts scannability.",
    rule_ref: "anti-slop-gradient-text-decorative",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Gradient text decorative:
FORBIDDEN: background-clip: text + linear-gradient to "decorate" headlines, accents, or nav. Reduces scannability, rarely communicates anything, fingerprint of SaaS 2023. Use weight/size/solid colour for emphasis.`,
  },
  {
    id: "anti-icon-tile-above-heading",
    eixo: "anti-slop",
    nome: "No icon tile above heading",
    descricao: "Coloured tile (40-64px) with centred icon above a heading. AI feature-card.",
    rule_ref: "anti-slop-icon-tile-above-heading",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Icon tile above heading:
FORBIDDEN: coloured tile (40-64px rounded) with centred icon ABOVE the heading inside cards. Universal AI feature-card pattern. Alternatives: inline icon next to title, left-aligned icon with text, or no icon at all.`,
  },
  {
    id: "anti-identical-card-grids",
    eixo: "anti-slop",
    nome: "No identical card grids",
    descricao: "N same-size cards (icon + heading + body) = SaaS template.",
    rule_ref: "anti-slop-identical-card-grids",
    aplica: { categorias: ["interface", "social"] },
    prompt_addon: `ANTI-SLOP — Identical card grids:
FORBIDDEN: N same-size cards with icon + heading + body repeated in symmetric grid (3-col, 4-col). Differential hierarchy required — one card dominates, others support. Use bento, mixed-size, or single-column with hierarchy.`,
  },
  {
    id: "anti-side-stripe-borders",
    eixo: "anti-slop",
    nome: "No coloured border-left",
    descricao: "border-left/right >1px coloured on cards/alerts. AI fingerprint.",
    rule_ref: "anti-slop-side-stripe-borders",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Side stripe borders:
FORBIDDEN: border-left/right > 1px as a coloured accent on cards/alerts/callouts. Most recognisable AI fingerprint. To differentiate types, use icon, badge, weight, or subtle bg tint. Never a coloured side stripe.`,
  },
  {
    id: "anti-everything-centered",
    eixo: "anti-slop",
    nome: "No centred-by-default",
    descricao: "Centre-align everywhere is generic. Hierarchy needs intentional alignment.",
    rule_ref: "anti-slop-everything-centered",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Everything centered:
FORBIDDEN: centre-align text everywhere by default. Centre is generic or childish without purpose. Use INTENTIONAL alignment for hierarchy — left default, centre when earned (eyebrow + headline in a centred hero, OR a brutalist statement). In lists, dashboards, cards = always left.`,
  },
  {
    id: "anti-monospace-tech-shorthand",
    eixo: "anti-slop",
    nome: "Monospace must serve a purpose",
    descricao: "Mono = code/data/machine. Decorative use is lazy stereotype.",
    rule_ref: "anti-slop-monospace-as-tech-shorthand",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Monospace as tech shorthand:
FORBIDDEN: monospace to "signal technical" in eyebrows, tags, decorative badges without real purpose. Mono = code, data, machine output, kbd shortcuts. In other contexts it's a lazy stereotype. If you need a "technical feel", use weight/case/spacing instead.`,
  },
  {
    id: "anti-ai-purple-blue",
    eixo: "anti-slop",
    nome: "No AI purple/blue gradient",
    descricao: "Purple-to-blue/lila gradient is the AI default fingerprint.",
    rule_ref: "anti-slop-lila-ban",
    aplica: { categorias: ["video", "interface", "social"] },
    prompt_addon: `ANTI-SLOP — Lila ban:
FORBIDDEN: purple-blue gradient, fuchsia→purple bg, violet CTAs. The most universal AI-generated UI fingerprint. Pick a different palette — earth tones, mono with one accent, or anything earned.`,
  },
];

// ─── User overrides — merged on top of defaults ─────────────────────
//
// The arrays above are READ-ONLY defaults. The user can edit any field
// through Settings → Formats / Directions. Overrides are stored as
// partial objects keyed by id and live in the global config under
// `format_overrides` / `direction_overrides`. App.tsx pushes them in
// on boot via setFormatOverrides / setDirectionOverrides; consumers
// (modal, composePrompt, settings UI) ALWAYS go through the effective
// getters below — never the raw FORMATOS / DIRECTIONS arrays.
export type FormatoOverride = Partial<
  Pick<Formato, "nome" | "descricao" | "prompt_prefix" | "anti_slop">
>;
export type DirectionOverride = Partial<Pick<Direction, "nome" | "descricao" | "prompt_addon">>;

let formatOverrides: Record<string, FormatoOverride> = {};
let directionOverrides: Record<string, DirectionOverride> = {};
let disabledFormatIds = new Set<string>();
let disabledDirectionIds = new Set<string>();
let customFormats: Formato[] = [];
let customDirections: Direction[] = [];

export function setFormatOverrides(next: Record<string, FormatoOverride>): void {
  formatOverrides = next ?? {};
}
export function setDirectionOverrides(next: Record<string, DirectionOverride>): void {
  directionOverrides = next ?? {};
}
export function setDisabledFormatIds(ids: string[]): void {
  disabledFormatIds = new Set(ids ?? []);
}
export function setDisabledDirectionIds(ids: string[]): void {
  disabledDirectionIds = new Set(ids ?? []);
}
export function isFormatDisabled(id: string): boolean {
  return disabledFormatIds.has(id);
}
export function isDirectionDisabled(id: string): boolean {
  return disabledDirectionIds.has(id);
}

export function setCustomFormats(arr: Formato[]): void {
  customFormats = Array.isArray(arr) ? [...arr] : [];
}
export function setCustomDirections(arr: Direction[]): void {
  customDirections = Array.isArray(arr) ? [...arr] : [];
}
export function getCustomFormats(): Formato[] {
  return [...customFormats];
}
export function getCustomDirections(): Direction[] {
  return [...customDirections];
}
export function isCustomFormat(id: string): boolean {
  return customFormats.some((f) => f.id === id);
}
export function isCustomDirection(id: string): boolean {
  return customDirections.some((d) => d.id === id);
}
export function getFormatOverrides(): Record<string, FormatoOverride> {
  return { ...formatOverrides };
}
export function getDirectionOverrides(): Record<string, DirectionOverride> {
  return { ...directionOverrides };
}

function mergeFormato(f: Formato): Formato {
  const o = formatOverrides[f.id];
  if (!o) return f;
  return {
    ...f,
    nome: o.nome ?? f.nome,
    descricao: o.descricao ?? f.descricao,
    prompt_prefix: o.prompt_prefix ?? f.prompt_prefix,
    anti_slop: Array.isArray(o.anti_slop) ? o.anti_slop : f.anti_slop,
  };
}
function mergeDirection(d: Direction): Direction {
  const o = directionOverrides[d.id];
  if (!o) return d;
  return {
    ...d,
    nome: o.nome ?? d.nome,
    descricao: o.descricao ?? d.descricao,
    prompt_addon: o.prompt_addon ?? d.prompt_addon,
  };
}

/** Effective format list (defaults + overrides applied + customs appended). */
export function getEffectiveFormatos(): Formato[] {
  return [...FORMATOS.map(mergeFormato), ...customFormats];
}
/** Effective direction list (defaults + overrides applied + customs appended). */
export function getEffectiveDirections(): Direction[] {
  return [...DIRECTIONS.map(mergeDirection), ...customDirections];
}
/** True if the user has overridden any field on this format. */
export function isFormatOverridden(id: string): boolean {
  const o = formatOverrides[id];
  if (!o) return false;
  return Object.values(o).some((v) => v !== undefined);
}
/** True if the user has overridden any field on this direction. */
export function isDirectionOverridden(id: string): boolean {
  const o = directionOverrides[id];
  if (!o) return false;
  return Object.values(o).some((v) => v !== undefined);
}

// ─── Selectors / helpers (use effective lists) ──────────────────────
export function formatosByCategoria(catId: CategoriaId): Formato[] {
  return getEffectiveFormatos()
    .filter((f) => f.categoria === catId)
    .filter((f) => !isFormatDisabled(f.id));
}

export function directionsForFormato(formato: Formato): Direction[] {
  return getEffectiveDirections().filter((d) => {
    if (isDirectionDisabled(d.id)) return false;
    const okCat = d.aplica.categorias.includes(formato.categoria);
    const okFormato =
      !d.aplica.formatos ||
      d.aplica.formatos.length === 0 ||
      d.aplica.formatos.includes(formato.id);
    return okCat && okFormato;
  });
}

export function getFormatoById(id: string): Formato | undefined {
  const base = FORMATOS.find((f) => f.id === id);
  if (base) return mergeFormato(base);
  return customFormats.find((f) => f.id === id);
}

export function getDirectionsByIds(ids: string[]): Direction[] {
  return ids
    .map((id) => {
      const base = DIRECTIONS.find((d) => d.id === id);
      if (base) return mergeDirection(base);
      return customDirections.find((d) => d.id === id);
    })
    .filter((d): d is Direction => Boolean(d));
}

/**
 * Per-project canvas overrides. When set, applyTemplateVars uses these
 * values instead of the format's defaults — so {{ratio}}, {{duration}},
 * {{viewport}}, {{fps}} all reflect the user's choice in the modal,
 * and the editor pre-selects the matching ratio in the Video tab.
 *
 * Every field is optional: only set what the user actually customised.
 * Empty CanvasOverrides === stick with the format defaults.
 *
 * Field semantics by category:
 * - video: ratio, duration, fps used. slides ignored.
 * - interface: viewport optional (override of {{viewport}}); ratio/duration ignored.
 * - social.carousel: ratio + slides used.
 * - social.og-image: nothing user-tunable; size is fixed.
 */
export interface CanvasOverrides {
  ratio?: string;
  duration?: number;
  fps?: number;
  viewport?: string;
  slides?: number;
}

/**
 * Selection persisted per project. Anti-slop is opt-in — items the user
 * has actively enabled go to the prompt; everything else is ignored.
 *
 * Backwards-compat note: older projects may have `removedAntiSlop` set
 * (auto-applied minus removed). When migrating, treat as empty.
 */
export interface DirectionSelection {
  formatoId: string;
  directionIds: string[];
  /** Anti-slop items (from the format's preset list) the user opted IN to. */
  enabledAntiSlop: string[];
  /** User-added prohibitions. */
  customAntiSlop: string[];
  /** Per-project canvas overrides. Optional; absent = format defaults. */
  canvas?: CanvasOverrides;
  /** @deprecated kept for back-compat with projects created on the old
   *  opt-out semantics. New code should use enabledAntiSlop. */
  removedAntiSlop?: string[];
}

// Map ratio strings to viewport pixel sizes (matches dev-bridge.mjs
// RATIO_DIMS). Used when substituting {{viewport}} in prompts.
function viewportFromRatio(ratio: string): string {
  switch (ratio) {
    case "9:16":
      return "1080×1920";
    case "1:1":
      return "1080×1080";
    case "1.91:1":
      return "1200×630";
    case "4k":
    case "16:9_4k":
      return "3840×2160";
    default:
      return "1920×1080";
  }
}

// Substitute {{duration}}, {{frames}}, {{ratio}}, {{viewport}}, {{fps}},
// {{slides}} in a prompt body. Format defaults are merged with optional
// per-project canvas overrides — the user's tweaks in the modal flow
// straight into the AI prompt without requiring a re-edit of the YAML.
function applyTemplateVars(text: string, formato: Formato, canvas?: CanvasOverrides): string {
  const fps = canvas?.fps ?? 30;
  const dur = canvas?.duration ?? formato.canvas.duration;
  const ratio = canvas?.ratio ?? formato.canvas.ratio;
  const viewport = canvas?.viewport ?? viewportFromRatio(ratio);
  const slides = canvas?.slides ?? 5;
  // Split "1920×1080" / "1920x1080" into width + height integers so prompts
  // can drop the exact body dimensions without restating them per format.
  const dim = viewport.match(/(\d+)\s*[×x]\s*(\d+)/);
  const viewportW = dim ? dim[1] : "1920";
  const viewportH = dim ? dim[2] : "1080";
  return text
    .replace(/\{\{duration\}\}/g, String(dur))
    .replace(/\{\{frames\}\}/g, String(Math.max(0, Math.round(dur * fps))))
    .replace(/\{\{fps\}\}/g, String(fps))
    .replace(/\{\{ratio\}\}/g, ratio)
    .replace(/\{\{viewport\}\}/g, viewport)
    .replace(/\{\{viewport_w\}\}/g, viewportW)
    .replace(/\{\{viewport_h\}\}/g, viewportH)
    .replace(/\{\{slides\}\}/g, String(slides));
}

// Compose final user-side prompt: format prefix + enabled anti-slop +
// selected directions + raw user input. Template vars are substituted
// against the format's canvas (default duration / ratio). The user's
// request — passed as userPrompt — overrides the default duration when
// it specifies one; the prompt body explicitly tells the AI to honour
// the user.
export function composePrompt(selection: DirectionSelection, userPrompt: string): string {
  const f = getFormatoById(selection.formatoId);
  if (!f) return userPrompt;

  const dirs = getDirectionsByIds(selection.directionIds);

  const enabledFromPreset = f.anti_slop.filter((s) => selection.enabledAntiSlop.includes(s));
  const allAntiSlop = [...enabledFromPreset, ...selection.customAntiSlop];

  const canvas = selection.canvas;
  const parts: string[] = [];
  parts.push(applyTemplateVars(f.prompt_prefix, f, canvas).trim());

  if (allAntiSlop.length > 0) {
    parts.push("ANTI-SLOP — always respect:\n" + allAntiSlop.map((s) => `- ${s}`).join("\n"));
  }

  for (const d of dirs) {
    parts.push(applyTemplateVars(d.prompt_addon, f, canvas).trim());
  }

  if (userPrompt.trim()) {
    parts.push(`USER REQUEST:\n${userPrompt.trim()}`);
  }

  return parts.join("\n\n");
}
