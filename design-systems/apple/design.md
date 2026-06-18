---
name: Apple Web
description: Photography-first catalog design language — reverent product presentation, single blue accent, alternating full-bleed tiles, zero decorative chrome.
colors:
  primary: "#0066cc"
  primary-focus: "#0071e3"
  primary-on-dark: "#2997ff"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  canvas: "#ffffff"
  canvas-parchment: "#f5f5f7"
  surface-pearl: "#fafafc"
  surface-tile-1: "#272729"
  surface-tile-2: "#2a2a2c"
  surface-tile-3: "#252527"
  surface-black: "#000000"
  surface-chip-translucent: "#d2d2d7"
  ink: "#1d1d1f"
  body: "#1d1d1f"
  body-on-dark: "#ffffff"
  body-muted: "#cccccc"
  ink-muted-80: "#333333"
  ink-muted-48: "#7a7a7a"
  divider-soft: "#f0f0f0"
  hairline: "#e0e0e0"
typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.28px
  display-lg:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: 0px
  display-md:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.47
    letterSpacing: -0.374px
  lead:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: 0.196px
  lead-airy:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 24px
    fontWeight: 300
    lineHeight: 1.5
    letterSpacing: 0px
  tagline:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: 0.231px
  body-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: -0.374px
  body-md:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: -0.374px
  dense-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 2.41
    letterSpacing: 0px
  button-large:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.0
    letterSpacing: 0px
  caption:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: -0.224px
  caption-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: -0.224px
  button-utility:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.29
    letterSpacing: -0.224px
  nav-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.12px
  fine-print:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.12px
  micro-legal:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: -0.08px
  label-caps:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.0
    letterSpacing: 0.08px
rounded:
  none: 0px
  xs: 5px
  sm: 8px
  md: 11px
  lg: 18px
  pill: 9999px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 17px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "11px 22px"
  button-primary-active:
    backgroundColor: "{colors.primary}"
    transform: "scale(0.95)"
  button-primary-focus:
    outline: "2px solid {colors.primary-focus}"
  button-secondary-pill:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    border: "1px solid {colors.primary}"
    rounded: "{rounded.pill}"
    padding: "11px 22px"
  button-dark-utility:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
  button-pearl-capsule:
    backgroundColor: "{colors.surface-pearl}"
    textColor: "{colors.ink-muted-80}"
    border: "3px solid {colors.divider-soft}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-store-hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  button-icon-circular:
    backgroundColor: "{colors.surface-chip-translucent}"
    rounded: "{rounded.full}"
    width: "44px"
    height: "44px"
  product-tile-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.section}"
  product-tile-parchment:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.section}"
  product-tile-dark:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
    padding: "{spacing.section}"
  product-tile-dark-2:
    backgroundColor: "{colors.surface-tile-2}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
    padding: "{spacing.section}"
  product-tile-dark-3:
    backgroundColor: "{colors.surface-tile-3}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
    padding: "{spacing.section}"
  store-utility-card:
    backgroundColor: "{colors.canvas}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  configurator-option-chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "12px 16px"
  configurator-option-chip-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "2px solid {colors.primary-focus}"
    rounded: "{rounded.pill}"
    padding: "12px 16px"
  search-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.divider-soft}"
    rounded: "{rounded.pill}"
    padding: "12px 20px"
    height: "44px"
  global-nav:
    backgroundColor: "{colors.surface-black}"
    textColor: "{colors.on-dark}"
    height: "44px"
  sub-nav-frosted:
    backgroundColor: "{colors.canvas-parchment}"
    backdropFilter: "saturate(180%) blur(20px)"
    height: "52px"
  floating-sticky-bar:
    backgroundColor: "{colors.canvas-parchment}"
    backdropFilter: "saturate(180%) blur(20px)"
    height: "64px"
    padding: "12px 32px"
  footer:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink-muted-80}"
    padding: "64px"
---

## Overview

Apple's web design language is a museum-gallery catalog: the wall disappears and the product takes over. Every surface is a stack of edge-to-edge full-bleed tiles — alternating `{colors.canvas}` or `{colors.canvas-parchment}` against `{colors.surface-tile-1}` near-black — with the color shift itself acting as the section divider. No borders, no decorative gradients, no shadows on UI chrome. Density is unusually low; each tile occupies roughly one viewport.

The interactive vocabulary is deliberately narrow. One accent — `{colors.primary}` Action Blue (#0066cc) — carries every link, every CTA, every focus ring. Two button shapes: full-pill (`{rounded.pill}`) for primary actions, compact rect (`{rounded.sm}`) for utility. Typography is SF Pro Display for headlines with aggressive negative tracking; SF Pro Text for everything else at 17px rather than the SaaS-standard 16px. The result is a system that scales from iPhone buy page to environmental sustainability editorial without changing a single token.

**Personality:** reverent, minimal, photography-first, single-accent confident.

## Colors

The palette leads with `{colors.primary}` (#0066cc) — the sole interactive signal across every surface. Its siblings, `{colors.primary-focus}` (#0071e3) and `{colors.primary-on-dark}` (#2997ff), exist only to maintain legibility in focus rings and on dark tile backgrounds respectively; they are never used decoratively.

Surface architecture operates on two modes. Light mode uses `{colors.canvas}` (#ffffff) as the primary canvas and `{colors.canvas-parchment}` (#f5f5f7) as the alternating rhythm tile and footer ground. The delta between them is intentional and subtle — just enough to signal a section change without adding chrome. `{colors.surface-pearl}` (#fafafc) appears only inside secondary button fills where a visible button surface needs to register against the parchment ground.

Dark mode tiles are a tight three-step near-black ladder: `{colors.surface-tile-1}` (#272729) is the primary dark canvas, `{colors.surface-tile-2}` (#2a2a2c) creates micro-step separation when two dark tiles stack, and `{colors.surface-tile-3}` (#252527) anchors the bottom of the stack and video frames. `{colors.surface-black}` (#000000) pure black is reserved exclusively for the global nav bar and full-bleed video voids — the only place true black appears.

Text is `{colors.ink}` (#1d1d1f) on all light surfaces — chosen over pure black to keep the reading experience photographic rather than printed. On dark surfaces, `{colors.body-on-dark}` (#ffffff) carries primary copy; `{colors.body-muted}` (#cccccc) handles secondary copy where white would be too loud. Disabled and legal text use `{colors.ink-muted-48}` (#7a7a7a).

Hairlines exist at two strengths: `{colors.hairline}` (#e0e0e0) for visible card borders in store grids, and `{colors.divider-soft}` (#f0f0f0) — functionally `rgba(0,0,0,0.04)` — for the near-invisible ring on pearl buttons. No decorative gradients exist anywhere in the system; atmospheric depth is purely photographic.

## Typography

The typographic system runs two faces: **SF Pro Display** for sizes where the letter-pressed headline cadence matters, and **SF Pro Text** for everything at or below 21px. Both resolve to system-ui on non-Apple platforms; Inter at 600 weight with `font-feature-settings: "ss03"` is the documented fallback substitute.

`{typography.hero-display}` (56px / 600 / 1.07 / -0.28px) is the entry voice — the signature "Apple tight" headline. The negative letter-spacing is load-bearing; removing it breaks the brand feel immediately. `{typography.display-lg}` (40px / 600 / 1.10 / 0px) drives every product tile headline. `{typography.display-md}` (34px / 600 / 1.47 / -0.374px) handles section-level heads at the SF Pro Text scale boundary.

`{typography.lead}` (28px / 400 / 1.14 / +0.196px) is the product tile subcopy voice — one of the few places tracking goes positive, giving a slightly airy subcaption feel that contrasts the tight headline above. `{typography.lead-airy}` (24px / 300 / 1.5 / 0px) introduces the rare weight 300, used on editorial surfaces (the environment page) to signal atmosphere rather than assertion.

`{typography.body-md}` (17px / 400 / 1.47 / -0.374px) is the default paragraph — one pixel larger than SaaS convention. `{typography.body-strong}` (17px / 600) handles inline emphasis without breaking rhythm. `{typography.dense-link}` (17px / 400 / 2.41 / 0px) is specific to footer link columns: the 2.41 line-height is intentional, not a bug — it makes dense-stacked navigation links scannable without visual noise.

`{typography.caption}` (14px / 400 / 1.43 / -0.224px) and `{typography.button-utility}` (14px / 400 / 1.29 / -0.224px) share scale but differ in line-height for their respective contexts. `{typography.nav-link}` and `{typography.fine-print}` share the 12px / -0.12px spec. `{typography.micro-legal}` (10px) is the floor. Weight 500 is deliberately absent; the ladder is 300 / 400 / 600 / 700 only.

## Layout

The base unit is 8px. Sub-base values (2, 4, 5, 6, 7px) appear only in tight typographic adjustments; structural layout always snaps to the scale: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 17px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 80px.

Product tiles use `{spacing.section}` (80px) as vertical padding and stack edge-to-edge with zero gap. The color change provides the section break; no margin gutter is inserted between tiles. Utility card padding is `{spacing.lg}` (24px). Buttons use 8–11px vertical and 15–22px horizontal padding depending on button grammar.

Content max-width varies by surface intent: ~980px for editorial/environmental text-heavy sections, ~1440px for store product grids, and true full-bleed for homepage product tiles. Column patterns range from single-centered-stack (product tile hero) to 2-column (side-by-side tiles) to 3–5 column utility grids (store, accessories). Gutters between utility grid cards are 20–24px. Every tile begins with at least 64px of air above its headline; product renders never have adjacent content closer than 40px.

Breakpoints: 1440px (content lock), 1068px (small-desktop), 834px (tablet landscape), 735px (tablet portrait), 640px (phone), 419px (small phone). Utility grids collapse 5-col → 4-col → 3-col → 2-col → 1-col through those breakpoints. Hero typography cascades: `{typography.hero-display}` (56px) → 40px at 1068px → 34px at 640px → 28px at 419px.

## Elevation & Depth

Apple's elevation model has four levels and one ironclad rule.

**Flat** — No shadow, no border. Applies to every full-bleed tile, the global nav, the footer, and body copy sections. The vast majority of the page lives here.

**Soft hairline** — `1px rgba(0,0,0,0.08)` border. Applied to store utility cards and the sub-nav frosted separator. Signals card containment without visual weight.

**Backdrop blur** — `backdrop-filter: saturate(180%) blur(20px)` on `{component.sub-nav-frosted}` (parchment at 80% opacity) and `{component.floating-sticky-bar}`. Creates a "floating over content" layer signal that is functional, not decorative.

**Product shadow** — `rgba(0,0,0,0.22) 3px 5px 30px 0`. The single drop-shadow in the entire system. Applied exclusively to photographic product renders resting on a tile surface — never to cards, buttons, or text. Its purpose is to give the product physical weight against the canvas, not to signal UI hierarchy.

Hierarchy between sections is conveyed entirely through surface-color alternation (`{component.product-tile-light}` ↔ `{component.product-tile-dark}`), not through elevation. No card lifts on hover. No shadow-on-hover. The system trusts color contrast alone to create depth.

## Shapes

Corner radius operates on four clearly separated grammars; mixing them breaks the visual language.

`{rounded.none}` (0px) is for full-bleed product tiles exclusively. Tiles are rectangular and edge-to-edge; rounding would break the edge-filling effect.

`{rounded.sm}` (8px) applies to compact utility actions: dark utility buttons (`{component.button-dark-utility}`), inline card imagery. Small but present — enough to signal "pressable" without softening.

`{rounded.md}` (11px) is rare: used only for `{component.button-pearl-capsule}`. It sits between the utility rect and the pill and should not be introduced elsewhere.

`{rounded.lg}` (18px) defines the store and accessories card grid. It signals "browsable container" — friendlier than the utility rect but not pill-shaped. Used on `{component.store-utility-card}`.

`{rounded.pill}` (9999px) is the primary action signal. Every element that should read as "the main thing to tap" uses it: `{component.button-primary}`, `{component.button-secondary-pill}`, `{component.configurator-option-chip}`, `{component.search-input}`, the floating sticky bar CTA. The full capsule IS the interaction grammar.

`{rounded.full}` (9999px / 50%) applies to circular icon controls (`{component.button-icon-circular}`) that float over photography. Same math as pill; the distinction is semantic — circles are icon-only floating controls.

Hero and product-tile imagery is always full-bleed rectangular (`{rounded.none}`). Rounding appears only on inline card imagery (`{rounded.sm}`) and grid card containers (`{rounded.lg}`).

## Components

**Global nav (`{component.global-nav}`)** — 44px, `{colors.surface-black}`, `{typography.nav-link}` (12px / 400 / -0.12px). The only true-black surface. Links run edge-to-edge at ~20px spacing; search and bag icons right-aligned. Collapses to hamburger at 834px.

**Sub-nav frosted (`{component.sub-nav-frosted}`)** — 52px, `{colors.canvas-parchment}` at 80% opacity, `backdrop-filter: saturate(180%) blur(20px)`. Left: product category in `{typography.tagline}` (21px / 600). Right: inline links in `{typography.button-utility}` + a persistent `{component.button-primary}` CTA.

**Button primary (`{component.button-primary}`)** — `{colors.primary}` fill, `{colors.on-primary}` text, `{rounded.pill}`, 11px × 22px padding, `{typography.body-md}` (17px / 400). Active: `transform: scale(0.95)`. Focus: `2px solid {colors.primary-focus}` outline. The full-capsule radius is non-negotiable — it is the brand action signal.

**Button secondary pill (`{component.button-secondary-pill}`)** — Ghost variant: transparent fill, `{colors.primary}` text and 1px border, same pill radius and padding as primary. Used as the second CTA when two pills appear together ("Learn more" / "Buy").

**Button dark utility (`{component.button-dark-utility}`)** — `{colors.ink}` fill, `{colors.on-dark}` text, `{rounded.sm}`, 8px × 15px padding, `{typography.button-utility}`. Active: `scale(0.95)`. Used in global nav (Sign In, Bag).

**Button pearl capsule (`{component.button-pearl-capsule}`)** — `{colors.surface-pearl}` fill, `{colors.ink-muted-80}` text, `3px solid {colors.divider-soft}` border (functions as a soft ring), `{rounded.md}`, `{typography.caption}`. Product-card secondary action.

**Button icon circular (`{component.button-icon-circular}`)** — 44 × 44px, `{colors.surface-chip-translucent}` at ~64% alpha, `{rounded.full}`. Floats over photography for carousel and image controls.

**Product tiles** — `{component.product-tile-light}`, `{component.product-tile-parchment}`, `{component.product-tile-dark}`, `{component.product-tile-dark-2}`, `{component.product-tile-dark-3}` all share the same content stack: product name in `{typography.display-lg}` → tagline in `{typography.lead}` → two CTA buttons → product render with product-shadow. They differ only in background color. `{rounded.none}` on all — tiles are always edge-to-edge.

**Store utility card (`{component.store-utility-card}`)** — `{colors.canvas}`, `1px solid {colors.hairline}`, `{rounded.lg}`, `{spacing.lg}` padding. Top: 1:1 product image with `{rounded.sm}` inner radius. Below: `{typography.body-strong}` name, `{typography.body-md}` price, `{component.text-link}` CTA. No card shadow; product render carries the product-shadow.

**Configurator chips** — `{component.configurator-option-chip}` uses `{rounded.pill}`, `{typography.caption}`, 12px × 16px padding. Selected state (`{component.configurator-option-chip-selected}`) upgrades border to `2px solid {colors.primary-focus}`.

**Search input (`{component.search-input}`)** — `{rounded.pill}`, `{colors.canvas}`, `1px solid {colors.divider-soft}`, 44px height, `{typography.body-md}`. Pill shape matches the primary CTA grammar — search is treated as a primary action.

**Floating sticky bar (`{component.floating-sticky-bar}`)** — Frosted parchment bar at viewport bottom during scroll. 64px height, `{colors.canvas-parchment}` at 80% opacity with backdrop blur. Left: running price in `{typography.body-md}`. Right: `{component.button-primary}`.

**Footer (`{component.footer}`)** — `{colors.canvas-parchment}`, `{colors.ink-muted-80}` body, 64px vertical padding. Link columns in `{typography.dense-link}` (17px / 400 / **2.41** line-height). Column headings in `{typography.caption-strong}` (14px / 600). Legal row in `{typography.fine-print}` with `{colors.ink-muted-48}`.

## Do's and Don'ts

### Do

- Use `{colors.primary}` (#0066cc) for every interactive element — links, pill CTAs, focus rings — and nothing else. The single accent is the system's identity.
- Apply negative letter-spacing (`-0.28px` to `-0.374px`) to every headline at 17px and above. The "Apple tight" tracking is load-bearing; it defines the display voice.
- Set body copy at `{typography.body-md}` (17px / 400 / 1.47). The 17px base and 1.47 line-height are both brand signals — do not reduce either.
- Alternate `{component.product-tile-light}` (or parchment) and `{component.product-tile-dark}` for full-bleed section rhythm. The color change is the divider; no border or margin gap is needed.
- Reserve `{rounded.pill}` for any element that must read as a primary action: main CTAs, configurator chips, search input, sticky bar CTA.
- Apply the product-shadow (`rgba(0,0,0,0.22) 3px 5px 30px`) only to photographic product renders resting on a surface canvas.
- Use `transform: scale(0.95)` as the active/press micro-interaction on every button. It is the system-wide press signal.
- Keep `{component.global-nav}` on `{colors.surface-black}` — true black is reserved exclusively for the global nav.
- Use `{colors.primary-on-dark}` (#2997ff) for in-copy links on dark tile surfaces and `{colors.primary}` (#0066cc) for in-copy links on light surfaces.

### Don't

- Don't introduce a second accent color. Every interactive element routes through `{colors.primary}`.
- Don't apply shadows to cards, buttons, or text. Shadow belongs to product photography alone.
- Don't use CSS gradients as decorative backgrounds. Atmosphere is photographic, never tokenized.
- Don't use weight 500. The weight ladder is 300 / 400 / 600 / 700; mid-weight always uses 600.
- Don't round full-bleed tiles. `{rounded.none}` is mandatory; rounding breaks the edge-to-edge section grammar.
- Don't tighten `{typography.body-md}` line-height below 1.47. The editorial leading is a brand constant.
- Don't insert margins between stacked tiles. Zero gap, zero border — the color change is the break.
- Don't use `{colors.primary-on-dark}` (#2997ff) on light surfaces — it is a dark-tile-only variant and will appear off-brand against `{colors.canvas}` or `{colors.canvas-parchment}`.
- Don't mix radius grammars: `{rounded.sm}` for compact utility, `{rounded.lg}` for browsable cards, `{rounded.pill}` for primary actions, `{rounded.full}` for circular controls. Nothing in between except the deliberate `{rounded.md}` on pearl capsule buttons.
- Don't add hover elevation (shadow lift, background shift) to utility cards — the system has no hover-state chrome. Interaction is signaled by cursor change and active-scale press only.
