# Design Factory — Biblioteca de rules (spec)

> Spec da biblioteca completa de craft rules do DF (~131). Fonte para portar pro
> `rules-taxonomy.ts`. Construída do nosso jeito a partir da research
> (`2026-06-26-df-craft-enforcement.md` §5).

## Schema

`id` · `title` · `category` · `tier` (P0/P1/P2) · `core` (sempre-on?) · `check` (detector grep no
`static-p0`?). Corpo = **✗ o que não fazer** / **✓ o que fazer no lugar**, com o valor concreto
quando importa. Sem fonte, sem explicação longa.

- **Tier:** `P0` must-fix · `P1` should-fix · `P2` polish.
- **core:** default de fábrica (14) — vem habilitada e pré-preenche o picker; editável em config
  (`default_rule_ids`) e por projeto. Resto é opt-in. (Piso anti-slop real = `static-p0`, separado.)
- **check:** `static-p0` detecta por regex → sinaliza + auto-fix (nunca bloqueia em gosto).
- description em EN (voz do modelo; i18n PT no `builtin-labels.ts` ao portar).

## Categorias (~131)

anti-slop (13) · typography (15) · color (14) · motion (15) · layout (12) · depth (8) ·
states (10) · forms (9) · imagery (6) · icons (4) · a11y (10) · copy (6) · i18n-rtl (4) ·
laws-of-ux (6).

**Core (14, sempre-on):** `as-no-generic-ai-gradient` · `as-no-decorative-emojis` ·
`ty-limited-type-scale` · `ty-weight-for-hierarchy` · `ty-comfortable-measure` ·
`co-few-colors-neutral-base` · `co-no-raw-black` · `ly-generous-spacing` · `ly-clear-hierarchy` ·
`de-consistent-radius` · `mo-gpu-only-props` · `mo-honor-reduced-motion` · `st-design-empty-error` ·
`a11y-contrast-aa`.

---

## anti-slop (13)

#### `as-no-shadcn-default` — Override the default shadcn/Tailwind look
`P0` · core: no · check: heuristic
✗ Default zinc/slate neutrals + indigo accent + `0.5rem` radius on everything.
✓ Override four axes: accent hue, the `--radius` scale, the display font, the neutral ramp.

#### `as-no-generic-ai-gradient` — No generic AI gradient
`P0` · **core: yes** · check: yes
✗ Two-stop violet→blue / blue→cyan / indigo→pink gradient on hero or background.
✓ Flat surface; or a same-family ramp (hue shift ≤30°) that marks real hierarchy.

#### `as-no-gradient-text` — No gradient-filled headline text
`P0` · core: no · check: yes
✗ `background-clip:text` with a multi-hue gradient on headings.
✓ Solid token color; size + weight carry it. If intentional, one per page, unset on `::selection`.

#### `as-no-unprompted-glow` — No unprompted neon glow
`P1` · core: no · check: yes
✗ `box-shadow:0 0 …` halos / glowing `text-shadow` as ambient decoration.
✓ Glow only on a genuinely active/recording/pressed element; depth via a real elevation shadow.

#### `as-no-decorative-emojis` — No emojis as icons
`P0` · **core: yes** · check: yes
✗ Emoji icons/bullets (🚀 ⚡ ✨ 🔥 🎯) in `<h*>`, `<button>`, `<li>`, `class*="icon"`.
✓ One monoline SVG set, 1.6–1.8px stroke, `currentColor`; emphasis via type weight.

#### `as-no-invented-decoration` — No invented decoration
`P1` · core: no · check: no
✗ Gradients, glows, blurs, particle fields added for their own sake.
✓ Drop any effect that, if removed, loses no information; let type + spacing carry it.

#### `as-no-default-glassmorphism` — No default glassmorphism
`P1` · core: no · check: yes
✗ `backdrop-filter:blur()` frost on cards, headers, and modals at once.
✓ Solid surfaces; glass on 1-2 semantic surfaces only (fixed nav, modal scrim), where content sits behind.

#### `as-no-effect-stacking` — No stacked effects
`P1` · core: no · check: no
✗ Shadow + gradient + blur + border + glow piled on one element.
✓ One treatment per element; depth from a single elevation system.

#### `as-no-aurora-bg` — No aurora / mesh / blob background
`P1` · core: no · check: yes
✗ Animated multi-`radial-gradient` aurora or drifting `filter:blur` color blobs.
✓ Solid surface; tension from layout, not a moving backdrop.

#### `as-no-decorative-bg-pattern` — No decorative background pattern
`P2` · core: no · check: yes
✗ Tiled dot-grids, blueprint grids, decorative wave/blob SVGs as filler.
✓ Plain surface; whitespace as structure (pattern only if it encodes real data).

#### `as-no-tasteful-default-cliche` — Avoid the "tasteful default" cliché
`P1` · core: no · check: no
✗ Reflexive cream `#F4F1EA`+serif+sage, "near-black+acid-green", or broadsheet-hairline looks.
✓ A palette/voice grounded in the subject; justify a known look as a deliberate choice.

#### `as-break-perfect-symmetry` — Break perfect symmetry with intention
`P2` · core: no · check: no
✗ Evenly-weighted, perfectly symmetric layout, identical rhythm top-to-bottom.
✓ Alternate density (one tight section, one breathing); anchor with a deliberate asymmetry.

#### `as-soul-80-20` — 80% proven, 20% distinctive
`P1` · core: no · check: no
✗ A flawless but anonymous template with zero risk.
✓ One signature move — a bold type/color call, an unexpected proportion, product-specific microcopy.

---

## typography (15)

#### `ty-limited-type-scale` — Use a limited type scale
`P0` · **core: yes** · check: yes
✗ Arbitrary font sizes (17px, 22px, 29px…).
✓ One scale: 12/14/16/18/20/24/30/36/48/64.

#### `ty-weight-for-hierarchy` — Weight, not just size, builds hierarchy
`P1` · **core: yes** · check: yes
✗ Hierarchy by size alone; body weights below 400.
✓ Weights 400/500/600/700; pair size + weight; never <400 for text.

#### `ty-comfortable-measure` — Keep a comfortable measure
`P1` · **core: yes** · check: yes
✗ Body lines spanning the full container width.
✓ 45–75 characters (~66); `max-width: 65ch` on text blocks.

#### `ty-body-min-16` — Body text ≥16px
`P1` · core: no · check: yes
✗ Body copy below 16px.
✓ 16–18px body; 14px only for secondary/meta labels.

#### `ty-line-height` — Line-height by role
`P1` · core: no · check: yes
✗ One tight line-height on everything.
✓ Body 1.5; headings 1.1–1.25 (tighter as size grows).

#### `ty-no-default-fonts` — No default system fonts
`P1` · core: no · check: yes
✗ Inter / Roboto / Arial / Times / Open Sans / Montserrat / bare `system-ui` as the brand face.
✓ A deliberately chosen display + text pairing; system stack only as fallback.

#### `ty-display-font-on-headings` — Headings use the display face
`P0` · core: no · check: yes
✗ Hardcoded Inter/system on `h1`/`h2` when a display font is set.
✓ `var(--font-display)` on headings; `var(--font-text)` on body.

#### `ty-text-wrap` — Tidy wrapping
`P2` · core: no · check: yes
✗ Ragged, orphan-heavy headline wraps.
✓ `text-wrap: balance` on headings, `pretty` on body.

#### `ty-font-smoothing` — Smooth text on dark
`P2` · core: no · check: no
✗ Heavy-looking text on dark surfaces.
✓ `-webkit-font-smoothing: antialiased` for light-on-dark.

#### `ty-smart-quotes` — Curly quotes and apostrophes
`P1` · core: no · check: yes
✗ Straight `'` `"` in rendered copy.
✓ Curly `" "` `' '` and proper apostrophes.

#### `ty-tabular-nums` — Tabular figures for data
`P2` · core: no · check: yes
✗ Proportional figures in tables, timers, prices, counters.
✓ `font-variant-numeric: tabular-nums` so digits align.

#### `ty-no-hover-type-shift` — Don't reflow type on hover
`P2` · core: no · check: yes
✗ `font-size` / `font-weight` / `text-transform` changing on `:hover`.
✓ Shift color/opacity/background only; reserve weight as a static layout slot.

#### `ty-underline-links-only` — Underline means link
`P2` · core: no · check: yes
✗ Underline as decoration on non-links.
✓ Underline reserved for `<a>`; emphasis via weight/color.

#### `ty-no-bold-italic-stack` — One emphasis axis at a time
`P2` · core: no · check: yes
✗ Bold + italic stacked on the same run.
✓ Pick one emphasis axis; reserve the other.

#### `ty-sentence-case` — Sentence case for UI
`P2` · core: no · check: no
✗ Title Case or ALL CAPS across headings, buttons, labels.
✓ Sentence case; ALL CAPS only on tiny labels with letter-spacing.

---

## color (14)

#### `co-few-colors-neutral-base` — Few colors, neutral base
`P1` · **core: yes** · check: no
✗ Many competing hues across the screen.
✓ 70–90% neutrals + one accent (5–10%) + semantic (0–5%).

#### `co-no-raw-black` — No pure black or white
`P0` · **core: yes** · check: yes
✗ `#000` / `#fff` as bg or fg.
✓ Dark: bg `#0f0f0f`, fg `#f0f0f0`. Light: bg `#fafafa`, fg `#111111`.

#### `co-accent-sparingly` — Ration the accent
`P1` · core: no · check: yes
✗ Accent on links, CTA, chips, rings all at once.
✓ ≤2 visible accent uses per screen (links and rings count).

#### `co-one-accent` — One accent only
`P1` · core: no · check: no
✗ A second invented accent hue.
✓ Single `--accent`; extra meaning via `--success` / `--warn` / `--danger`.

#### `co-oklch` — Author color in OKLCH
`P1` · core: no · check: yes
✗ `hex` / `rgb` / `hsl` for color decisions and ramps.
✓ `oklch()` — perceptual lightness, controllable chroma/hue.

#### `co-chroma-budget` — Budget the chroma
`P2` · core: no · check: no
✗ Saturated "neutrals" and huge fully-saturated fills.
✓ Neutrals C≈0; accent C≤0.20; large fills low chroma.

#### `co-semantic-token-names` — Name tokens by purpose
`P2` · core: no · check: yes
✗ `--blue-500`, `--green-500`.
✓ `--accent`, `--success` — named by role, not hue.

#### `co-no-tailwind-indigo` — No default Tailwind indigo
`P0` · core: no · check: yes
✗ `#6366f1` `#4f46e5` `#4338ca` `#3730a3` `#8b5cf6` `#7c3aed` `#a855f7` as accent.
✓ The brief's `--accent`. (A `var(--accent)` that resolves to indigo is fine — it's intentional.)

#### `co-functional-gradient` — Gradients separate, don't decorate
`P1` · core: no · check: no
✗ Decorative gradient filling empty space.
✓ Gradient only to separate hierarchy (header→body, CTA), same family, hue shift ≤30°.

#### `co-dark-translucent-borders` — Translucent borders on dark
`P2` · core: no · check: yes
✗ Solid dark borders on dark surfaces.
✓ `1px rgba(255,255,255,0.08)` — reads as structure without noise.

#### `co-12-step-ramp` — A 12-step role ramp
`P2` · core: no · check: no
✗ Ad-hoc tints invented per component.
✓ A 12-step scale with fixed roles (bg, subtle, ui, border, solid, text…); each decision picks a step.

#### `co-hover-active-from-ramp` — States step the ramp
`P2` · core: no · check: no
✗ Random hover/active colors.
✓ Hover/active = next step on the ramp, not a new color.

#### `co-state-by-token` — Semantic states use tokens
`P1` · core: no · check: yes
✗ Raw red/green for error/success.
✓ `--danger` / `--success` / `--warn`; pair with icon + text (not color alone).

#### `co-no-pure-saturated-on-white` — Tame brand color for text
`P2` · core: no · check: no
✗ Bright brand accent as body-text color (fails contrast).
✓ Darken to a 600-level shade for text; reserve the bright variant for fills.

---

## motion (15)

#### `mo-gpu-only-props` — Animate only compositor props
`P0` · **core: yes** · check: yes
✗ Animating `width`/`height`/`top`/`left`/`margin` (layout thrash).
✓ Only `transform` / `opacity` / `filter` / `clip-path`.

#### `mo-honor-reduced-motion` — Honor reduced motion
`P0` · **core: yes** · check: yes
✗ Transforms/parallax with no reduced-motion path.
✓ `@media (prefers-reduced-motion: reduce)` strips axis motion; keep opacity/color crossfades.

#### `mo-no-transition-all` — Never `transition: all`
`P1` · core: no · check: yes
✗ `transition: all`.
✓ Name the exact properties (`transform`, `opacity`).

#### `mo-duration-by-type` — Duration by interaction type
`P1` · core: no · check: yes
✗ One long duration on everything.
✓ 50–100ms instant · 150ms default · 200–300ms entering · 300–500ms cross-screen.

#### `mo-micro-under-500` — Microinteractions <500ms
`P1` · core: no · check: yes
✗ >500ms on hover/press/toggle/validation.
✓ Keep non-navigation motion <500ms; frequent (seen 50×/session) ≤200ms.

#### `mo-ease-out-enter` — Ease-out in, accelerate out
`P1` · core: no · check: no
✗ `linear`/`ease-in` on entrances; exit slower than enter.
✓ Ease-out on enter, accelerate on exit, exit ≤ enter duration.

#### `mo-curve-vs-spring` — Curve vs spring by property
`P2` · core: no · check: no
✗ A timing curve on physical `scale`/position; a spring on opacity.
✓ Curve for opacity/color; spring for position/scale/rotation/gesture.

#### `mo-m3-easing` — Use the real M3 easing
`P2` · core: no · check: yes
✗ `cubic-bezier(0.4,0,0.2,1)` labeled "Material 3" (that's M2/legacy).
✓ M3 standard `cubic-bezier(0.2,0,0,1)` — front-loaded, settles on target.

#### `mo-press-scale` — Sane press scale
`P2` · core: no · check: yes
✗ `scale(0.8)` on press (collapses).
✓ 0.90–0.97; ~2px travel reads as a real press.

#### `mo-dialog-not-scale-zero` — Dialogs don't grow from zero
`P2` · core: no · check: no
✗ Modal animating from `scale(0)`.
✓ `scale(0.96)→1` + opacity; subtle, not a pop.

#### `mo-linear-only-loops` — `linear` only for loops
`P2` · core: no · check: yes
✗ `linear` timing on one-shot transitions.
✓ `linear` only for spinners/continuous loops; eased everywhere else.

#### `mo-will-change-sparingly` — `will-change` with restraint
`P2` · core: no · check: yes
✗ `will-change: all` or on many idle elements.
✓ Only on an element about to animate; remove after.

#### `mo-selective-reveal` — Reveal sparingly on scroll
`P1` · core: no · check: no
✗ Universal fade-up on every section on scroll.
✓ One restrained reveal where it earns attention; content visible by default.

#### `mo-no-endless-loop` — No endless ambient motion
`P2` · core: no · check: no
✗ Infinite background loops; spinner forever.
✓ Cap cycles; cancel on route change; pause control for motion >5s; spinner→progress at 60s.

#### `mo-css-spring` — Spring feel without a framework
`P2` · core: no · check: no
✗ "Springy" motion faked with a long ease (sluggish).
✓ CSS `linear()` easing for real spring feel on a single property (~1.3kB, no JS).

---

## layout (12)

#### `ly-generous-spacing` — Generous, intentional spacing
`P1` · **core: yes** · check: no
✗ Cramped, evenly-distributed elements with no breathing room.
✓ Generous whitespace; group by proximity, separate by gap.

#### `ly-clear-hierarchy` — One clear focal point
`P1` · **core: yes** · check: no
✗ Flat layout where everything competes equally.
✓ One primary focal point per view; de-emphasize the rest.

#### `ly-spacing-scale` — Spacing on a scale
`P1` · core: no · check: yes
✗ Arbitrary margins/paddings (13px, 27px…).
✓ 4/8/12/16/24/32/48/64.

#### `ly-padding-ratio` — Horizontal padding > vertical
`P2` · core: no · check: yes
✗ Equal H/V padding on buttons/chips.
✓ Horizontal ≈ 2× vertical.

#### `ly-dont-center-everything` — Don't center everything
`P1` · core: no · check: no
✗ All text and blocks center-aligned.
✓ Left-align body and long text; center only short hero/empty states.

#### `ly-no-hero-three-card` — Break the hero + 3-card cliché
`P1` · core: no · check: no
✗ Centered hero followed by a row of three identical feature cards.
✓ Vary one section — asymmetric split, full-bleed quote, inline demo.

#### `ly-no-uniform-bento` — No uniform bento grid
`P2` · core: no · check: no
✗ A grid of equal-size bento tiles, equal weight.
✓ Size cells by importance; let the grid express hierarchy.

#### `ly-grid-system` — Align to a grid
`P2` · core: no · check: no
✗ Ad-hoc widths and misaligned columns.
✓ A 12-column grid with consistent gutters; align to it.

#### `ly-concentric-radius` — Concentric corner radii
`P2` · core: no · check: yes
✗ Same radius on an inner element and its padded container.
✓ Outer radius = inner radius + padding.

#### `ly-vary-density` — Vary section density
`P2` · core: no · check: no
✗ Identical vertical rhythm down the whole page.
✓ Alternate tight and breathing sections for intentional pace.

#### `ly-optical-alignment` — Align optically
`P2` · core: no · check: no
✗ Pure metric centering of icons/glyphs/play buttons.
✓ Nudge for optical balance (triangles, type with descenders).

#### `ly-no-fake-logo-cloud` — No filler logo cloud
`P2` · core: no · check: no
✗ A gray "Trusted by" logo row as decoration.
✓ Real logos, or drop the section.

---

## depth (8)

#### `de-consistent-radius` — One radius system
`P1` · **core: yes** · check: yes
✗ Mixed corner radii across components.
✓ One `--radius` scale; concentric for nested elements.

#### `de-shadow-blur-ratio` — Soft, plausible shadows
`P2` · core: no · check: yes
✗ Hard shadows with blur ≈ offset and high alpha.
✓ Blur ≈ 2× offset, low alpha; light comes from one direction.

#### `de-no-shadow-dark` — No drop shadows on dark
`P2` · core: no · check: yes
✗ `box-shadow` for elevation on dark surfaces (invisible/muddy).
✓ Depth via a lighter surface + translucent border on dark.

#### `de-shadow-over-border` — Shadow beats heavy border
`P2` · core: no · check: no
✗ Thick borders to separate cards.
✓ A subtle multi-layer shadow (or a hairline) reads cleaner than a heavy border.

#### `de-nested-brightness` — Gentle nesting steps
`P2` · core: no · check: no
✗ Big brightness jumps between nested containers.
✓ ≤12% brightness step (dark) / ≤7% (light) per nesting level.

#### `de-single-elevation-system` — One elevation scale
`P1` · core: no · check: no
✗ Random shadow values per element.
✓ A fixed elevation scale (sm/md/lg); pick a level, don't invent.

#### `de-image-outline` — Hairline edge on images
`P2` · core: no · check: no
✗ Images floating with no edge definition.
✓ `1px rgba(0,0,0,0.1)` inset/outline to seat them on the surface.

#### `de-one-treatment` — One depth treatment per element
`P1` · core: no · check: no
✗ Shadow + border + gradient + glow stacked on one element.
✓ Choose one depth treatment.

---

## states (10)

#### `st-design-empty-error` — Design every state, not just happy path
`P1` · **core: yes** · check: no
✗ Only the populated, success view.
✓ Design empty, loading, error, and success states too.

#### `st-eight-states` — Cover interactive states
`P1` · core: no · check: no
✗ Components with only a default state.
✓ default / hover / active / focus / disabled / loading / error / selected as needed.

#### `st-loading-pattern` — Right loading pattern
`P2` · core: no · check: no
✗ Blank screen or layout jump while loading.
✓ Skeleton when layout is known; spinner when not; escalate spinner→progress at 60s.

#### `st-optimistic-ui` — Optimistic, then confirm
`P2` · core: no · check: no
✗ Blocking the UI until the server responds.
✓ Update optimistically; motion confirms a change, never performs it.

#### `st-selected-not-hover` — Selected ≠ hover
`P1` · core: no · check: no
✗ Selected state looks like transient hover.
✓ Selected = persistent bg-tint + weight; hover = lighter, transient.

#### `st-active-no-state-lines` — Active by fill, not bars
`P2` · core: no · check: no
✗ Colored left/top bar to mark active.
✓ Active = bg-tint + weight + (optional) icon; no decorative state line.

#### `st-focus-visible` — Visible keyboard focus
`P1` · core: no · check: yes
✗ `outline: none` with no replacement.
✓ `:focus-visible` ring, ≥3:1 contrast, ≥2px.

#### `st-disabled-legible` — Disabled stays readable
`P2` · core: no · check: no
✗ Disabled = low opacity only (unreadable, no semantics).
✓ Reduced emphasis + `not-allowed` cursor + `aria-disabled`; keep it legible.

#### `st-error-actionable` — Errors say what to do
`P2` · core: no · check: no
✗ "An error occurred."
✓ What happened + how to fix + a way forward.

#### `st-empty-onboards` — Empty state onboards
`P2` · core: no · check: no
✗ "No data" dead end.
✓ Explain what goes here + a primary action to fill it.

---

## forms (9)

#### `fo-label-every-input` — Every input has a real label
`P0` · core: no · check: yes
✗ Placeholder as the only label.
✓ `<label for>` always; placeholder shows an example, not the name.

#### `fo-error-wiring` — Wire errors to the field
`P1` · core: no · check: no
✗ Error text floating, unconnected to the input.
✓ `aria-describedby` + `aria-invalid="true"` + `role="alert"` on the message.

#### `fo-inline-validation` — Validate inline, on blur
`P2` · core: no · check: no
✗ Errors only on submit, summarized at the top.
✓ Validate on blur; show the error next to the field.

#### `fo-error-actionable` — Actionable field errors
`P1` · core: no · check: no
✗ "Invalid input."
✓ "Email must include @ and a domain."

#### `fo-no-redundant-entry` — Don't re-ask known data
`P2` · core: no · check: no
✗ Re-asking data the user already gave in the same flow (WCAG 3.3.7).
✓ Carry it forward or offer a select; autofill alone doesn't satisfy it.

#### `fo-correct-input-types` — Correct input types
`P2` · core: no · check: yes
✗ `type="text"` for email/number/tel/date.
✓ Right `type` + `inputmode` + `autocomplete`.

#### `fo-no-reset-button` — No destructive reset
`P2` · core: no · check: no
✗ A "Reset"/"Clear" button beside Submit.
✓ Drop it; accidental data loss outweighs the rare use.

#### `fo-submit-state` — Guard the submit
`P2` · core: no · check: no
✗ Submit clickable repeatedly during request.
✓ Disable + loading state on submit; prevent double-send.

#### `fo-mark-optional` — Mark optional, not asterisk soup
`P2` · core: no · check: no
✗ Asterisks on most fields.
✓ Assume required; label the few optional ones "(optional)".

---

## imagery (6)

#### `im-no-stock-cdn` — No placeholder image CDNs
`P1` · core: no · check: yes
✗ `unsplash.com` / `placehold.co` / `picsum.photos` / `placekitten.com`.
✓ Real assets, or a labeled local placeholder.

#### `im-aspect-ratio` — Reserve image space
`P2` · core: no · check: yes
✗ Images with no dimensions (layout shift on load).
✓ Set `aspect-ratio` + `object-fit: cover`.

#### `im-no-distortion` — Never distort images
`P2` · core: no · check: yes
✗ Stretching via mismatched `width`/`height`.
✓ `object-fit: cover`; crop, don't squash.

#### `im-overlay-legible` — Keep text on images legible
`P2` · core: no · check: no
✗ Text laid directly over a busy photo.
✓ A scrim, gradient, blur, or duotone behind the text.

#### `im-subtle-outline` — Seat images on the surface
`P2` · core: no · check: no
✗ Photos blending into the background edge.
✓ `1px rgba(0,0,0,0.1)` outline to define the edge.

#### `im-consistent-treatment` — One image treatment
`P2` · core: no · check: no
✗ Mixed radii, ratios, and filters across images.
✓ One consistent treatment (radius, ratio, filter) per surface.

---

## icons (4)

#### `ic-monoline-stroke` — One monoline icon set
`P1` · core: no · check: yes
✗ Mixed icon styles / heavy random weights.
✓ One set, 1.6–1.8px stroke, on a 24px grid.

#### `ic-currentcolor` — Icons inherit color
`P2` · core: no · check: yes
✗ Hardcoded fills on icons.
✓ `stroke`/`fill: currentColor` so they theme with text.

#### `ic-clarify-not-decorate` — Icons clarify, not decorate
`P1` · core: no · check: no
✗ An icon on every list item as decoration.
✓ Icons only where they speed scanning; the text label stays.

#### `ic-optical-size` — Optically size and align
`P2` · core: no · check: no
✗ Icons mismatched to text size / off the baseline.
✓ Size to the adjacent text; align optically to the cap height.

---

## a11y (10)

#### `a11y-contrast-aa` — Meet WCAG 2.2 AA contrast
`P0` · **core: yes** · check: yes
✗ Body text below 4.5:1.
✓ 4.5:1 body · 3:1 large (≥18pt/14pt bold) & non-text · inclusive (exactly 4.5:1 passes).

#### `a11y-focus-visible` — Keep focus visible
`P0` · core: no · check: yes
✗ `outline: none` killing keyboard focus.
✓ `:focus-visible` indicator, ≥3:1, ≥2px perimeter.

#### `a11y-keyboard` — Fully keyboard-operable
`P1` · core: no · check: no
✗ Click-only handlers; positive `tabindex` reordering.
✓ Everything reachable/operable by keyboard in DOM order; no `tabindex>0`.

#### `a11y-native-elements` — Native elements first
`P1` · core: no · check: yes
✗ `<div role="button">` / bare `<a>` with click handler.
✓ `<button>` for actions, `<a href>` for navigation; ARIA only when nothing native fits.

#### `a11y-alt-text` — Text alternatives
`P1` · core: no · check: yes
✗ `<img>` without `alt`; icon-only button with no label.
✓ `alt` for content, `alt=""` for decorative, `aria-label` on icon buttons.

#### `a11y-html-lang` — Declare the language
`P1` · core: no · check: yes
✗ `<html>` with no `lang`.
✓ `<html lang="…">`; inner `lang` on sub-tree switches.

#### `a11y-heading-order` — Sane heading order
`P1` · core: no · check: no
✗ Skipped levels (`h1`→`h3`); heading level chosen by size.
✓ One `<h1>`, no skips; style the level you mean independently of size.

#### `a11y-landmarks` — Use landmarks
`P2` · core: no · check: yes
✗ A page built from `<div>`s only.
✓ `<header>` `<nav>` `<main>` `<aside>` `<footer>`.

#### `a11y-no-invent-aria` — Never invent ARIA
`P2` · core: no · check: no
✗ Guessed `aria-*` (ARIA pages average more errors, not fewer).
✓ Native element → restyle native → APG pattern verbatim; last resort only.

#### `a11y-target-size` — Adequate target size
`P1` · core: no · check: yes
✗ Interactive targets below 24×24px.
✓ ≥24×24 (AA floor); 44×44 is the craft commitment.

---

## copy (6)

#### `cp-no-generic-copy` — No generic marketing copy
`P1` · core: no · check: no
✗ "We help teams collaborate", "Welcome", "Get started".
✓ Specific to the product and audience; say what it actually does.

#### `cp-no-fake-metrics` — No invented metrics
`P0` · core: no · check: yes
✗ "10× faster", "99.9% uptime", "3× more productive".
✓ A real source, or a clearly labeled placeholder.

#### `cp-no-em-dash-tell` — Cut the AI punctuation tells
`P1` · core: no · check: yes
✗ Em-dashes (—), `--`, and `...` peppered through copy.
✓ Commas/periods; a real ellipsis `…` only when truly needed.

#### `cp-actionable-buttons` — Verbs on buttons
`P2` · core: no · check: no
✗ "Submit", "Get started", "Click here".
✓ Verb + object: "Start tracking", "Create project".

#### `cp-sentence-case` — Sentence case in UI
`P2` · core: no · check: no
✗ Title Case across UI labels.
✓ Sentence case; reserve caps for tiny labels.

#### `cp-no-filler` — No filler copy
`P1` · core: no · check: yes
✗ `lorem ipsum`, "feature one/two/three", "sample content".
✓ Real copy, or solve the empty section with composition.

---

## i18n-rtl (4)

#### `i18n-logical-properties` — Logical, not physical, properties
`P1` · core: no · check: yes
✗ `margin-left/right`, `left`/`right`, `text-align: left`.
✓ `margin-inline`, `inset-inline`, `text-align: start` so RTL mirrors for free.

#### `i18n-rtl-aware` — Respect direction
`P2` · core: no · check: no
✗ Layout assuming LTR only.
✓ Honor `dir="rtl"`; mirror layout — but not directional icons that map to physical motion.

#### `i18n-locale-format` — Localize numbers and dates
`P2` · core: no · check: no
✗ Hardcoded date/number/currency formats.
✓ `Intl.DateTimeFormat` / `Intl.NumberFormat`.

#### `i18n-room-to-expand` — Leave room for translation
`P2` · core: no · check: no
✗ Tight, fixed-width labels; text baked into images.
✓ Real (translatable) text; allow ~30% expansion without breaking layout.

---

## laws-of-ux (6)

#### `lux-fitts` — Size and place by frequency (Fitts)
`P2` · core: no · check: no
✗ Tiny primary actions far from where the user is.
✓ Bigger, closer targets for frequent/important actions.

#### `lux-hick` — Reduce choices (Hick)
`P1` · core: no · check: no
✗ Twenty equal-weight options at once.
✓ Group, prioritize, and progressively disclose.

#### `lux-miller` — Chunk into groups (Miller)
`P2` · core: no · check: no
✗ A flat list of 9+ nav items.
✓ Chunk into 5±2 groups.

#### `lux-jakob` — Match conventions (Jakob)
`P2` · core: no · check: no
✗ Reinventing cart, search, nav, or form patterns.
✓ Use familiar patterns; spend novelty in the distinctive 20%.

#### `lux-proximity` — Group by proximity (Gestalt)
`P2` · core: no · check: no
✗ Uniform spacing with no grouping.
✓ Related items close; clear gaps between groups.

#### `lux-aesthetic-usability` — Polish helps, doesn't replace
`P2` · core: no · check: no
✗ Relying on looks to mask broken flows.
✓ Polish raises perceived usability — but fix the real usability too.
