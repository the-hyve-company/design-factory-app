---
name: Claude (Anthropic Marketing)
description: Warm editorial AI-product surface — cream canvas, coral primary, slab-serif display, dark-navy product chrome.
colors:
  primary: "#cc785c"
  primary-active: "#a9583e"
  primary-disabled: "#e6dfd8"
  accent-teal: "#5db8a6"
  accent-amber: "#e8a55a"
  canvas: "#faf9f5"
  surface-soft: "#f5f0e8"
  surface-card: "#efe9de"
  surface-cream-strong: "#e8e0d2"
  surface: "#efe9de"
  surface-dark: "#181715"
  surface-dark-elevated: "#252320"
  surface-dark-soft: "#1f1e1b"
  hairline: "#e6dfd8"
  hairline-soft: "#ebe6df"
  ink: "#141413"
  body-strong: "#252523"
  body: "#3d3d3a"
  muted: "#6c6a64"
  muted-soft: "#8e8b82"
  on-primary: "#ffffff"
  on-surface: "#141413"
  on-dark: "#faf9f5"
  on-dark-soft: "#a09d96"
  success: "#5db872"
  warning: "#d4a017"
  error: "#c64545"
typography:
  display-xl:
    fontFamily: "Copernicus, Tiempos Headline, Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: 64px
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: -1.5px
  display-lg:
    fontFamily: "Copernicus, Tiempos Headline, Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: -1px
  display-md:
    fontFamily: "Copernicus, Tiempos Headline, Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: 36px
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: -0.5px
  display-sm:
    fontFamily: "Copernicus, Tiempos Headline, Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.3px
  h1:
    fontFamily: "Copernicus, Tiempos Headline, Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: 64px
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: -1.5px
  title-lg:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.3
  title-md:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.4
  title-sm:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.4
  body-md:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
  label-caps:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 1.5px
  button:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.0
  nav-link:
    fontFamily: "StyreneB, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    fontFamily: "{typography.button.fontFamily}"
    fontSize: "{typography.button.fontSize}"
    fontWeight: "{typography.button.fontWeight}"
    rounded: "{rounded.md}"
    paddingBlock: 12px
    paddingInline: 20px
    height: 40px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-disabled:
    backgroundColor: "{colors.primary-disabled}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.md}"
    paddingBlock: 12px
    paddingInline: 20px
    height: 40px
  button-secondary-on-dark:
    backgroundColor: "{colors.surface-dark-elevated}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.md}"
    paddingBlock: 12px
    paddingInline: 20px
    height: 40px
  button-icon-circular:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    size: 36px
    rounded: "{rounded.full}"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.md}"
    paddingBlock: 10px
    paddingInline: 14px
    height: 40px
  text-input-focused:
    borderColor: "{colors.primary}"
    outlineColor: "{colors.primary}"
    outlineWidth: 3px
    outlineOpacity: 0.15
  feature-card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  product-mockup-card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  code-window-card:
    backgroundColor: "{colors.surface-dark}"
    codeBackgroundColor: "{colors.surface-dark-soft}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  model-comparison-card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  pricing-tier-card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  pricing-tier-card-featured:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  callout-card-coral:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  cta-band-coral:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    paddingBlock: 64px
    paddingInline: "{spacing.xl}"
  cta-band-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    paddingBlock: 64px
    paddingInline: "{spacing.xl}"
  badge-pill:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    paddingBlock: 4px
    paddingInline: 12px
  badge-coral:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    paddingBlock: 4px
    paddingInline: 12px
    letterSpacing: 1.5px
  category-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    paddingBlock: 8px
    paddingInline: 14px
  category-tab-active:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    paddingBlock: 8px
    paddingInline: 14px
  connector-tile:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.lg}"
    padding: 20px
  cookie-consent-card:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  footer:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-dark-soft}"
    paddingBlock: 64px
---

## Overview

Claude.com is the warmest, most editorially distinct interface in the AI-product category. The design identity rests on three immovable axes: the tinted cream canvas (`{colors.canvas}` — #faf9f5) as the page floor, coral (`{colors.primary}` — #cc785c) as the sole brand accent, and dark navy (`{colors.surface-dark}` — #181715) as the product-chrome surface. No fourth tone is introduced.

The typographic voice is literary: Copernicus (substitutable with Tiempos Headline) at weight 400 with negative letter-spacing for all display headlines, paired with StyreneB (substitutable with Inter) for all body, UI, and label text. The combination reads like a well-edited publication, not a SaaS landing page. Weight never exceeds 500 in the UI layer; display headlines stay at 400.

Surface pacing alternates deliberately across page bands — cream canvas → cream card → dark-navy mockup → coral callout → dark footer. Repeating the same surface in two consecutive bands breaks the rhythm and is explicitly prohibited. The system is built around contrast-via-color-block rather than shadows, and shows actual Claude product chrome (code editors, terminal panels, model comparison tables) rather than abstract marketing illustration.

## Colors

The palette leads with `{colors.primary}` (#cc785c), a warm muted coral that functions as the sole brand voltage. It appears on primary CTA backgrounds and full-bleed callout cards (`{component.callout-card-coral}`). It is scarce on individual elements and generous only at the callout scale. `{colors.primary-active}` (#a9583e) is the press/hover-darker variant; `{colors.primary-disabled}` (#e6dfd8) is the desaturated disabled state.

The canvas tier runs from `{colors.canvas}` (#faf9f5 — page floor, deliberately warm not pure white) through `{colors.surface-soft}` (#f5f0e8 — soft band dividers), `{colors.surface-card}` (#efe9de — feature and content cards), and `{colors.surface-cream-strong}` (#e8e0d2 — selected tabs and emphasized bands). Each step is one perceptual notch darker; the total range is narrow, keeping the cream family unified.

The dark tier covers `{colors.surface-dark}` (#181715 — dominant dark: code cards, footer), `{colors.surface-dark-soft}` (#1f1e1b — inner code block backgrounds), and `{colors.surface-dark-elevated}` (#252320 — elevated panels inside dark areas). These three values handle all dark-surface depth without shadows.

Borders use `{colors.hairline}` (#e6dfd8) for 1px lines on cream surfaces and `{colors.hairline-soft}` (#ebe6df) for near-invisible dividers within the same band. Both are warm — they read as one elevation step rather than ink rules.

Text runs from `{colors.ink}` (#141413 — headlines, primary text) through `{colors.body-strong}` (#252523), `{colors.body}` (#3d3d3a — running text), `{colors.muted}` (#6c6a64 — secondary labels), and `{colors.muted-soft}` (#8e8b82 — captions, copyright). `{colors.on-dark}` (#faf9f5) and `{colors.on-dark-soft}` (#a09d96) invert the hierarchy for dark surfaces. `{colors.on-dark}` deliberately echoes the canvas tone, binding the two surface worlds.

`{colors.accent-teal}` (#5db8a6) and `{colors.accent-amber}` (#e8a55a) are confined to secondary product surfaces — status indicators, category badges — and never compete with the coral primary. Semantic tokens `{colors.success}` (#5db872), `{colors.warning}` (#d4a017), and `{colors.error}` (#c64545) appear only in product and form contexts.

## Typography

The system is built on a hard display/body split that must never blur. Copernicus (or Tiempos Headline) handles every display token — `{typography.display-xl}` through `{typography.display-sm}` — at weight 400 with negative letter-spacing ranging from -0.3px to -1.5px. This negative tracking is not aesthetic decoration; it is structurally required. Copernicus without it reads as off-brand.

`{typography.display-xl}` (64px / 1.05 / -1.5px) is the homepage hero register — "Meet your thinking partner." `{typography.display-lg}` (48px / 1.1 / -1px) anchors major section heads. `{typography.display-md}` (36px / 1.15 / -0.5px) handles sub-section heads and model names. `{typography.display-sm}` (28px / 1.2 / -0.3px) is used for pricing tier names and callout headlines — notably including the CTA headline inside `{component.callout-card-coral}`, keeping serif character at every scale.

StyreneB (or Inter) covers the entire UI layer. `{typography.title-lg}` (22px / 500), `{typography.title-md}` (18px / 500), and `{typography.title-sm}` (16px / 500) handle card titles and emphasized intro text. `{typography.body-md}` (16px / 400 / 1.55) is the default running-text register. `{typography.body-sm}` (14px / 400 / 1.55) serves footer and fine-print copy. `{typography.caption}` (13px / 500) labels badges and captions. `{typography.label-caps}` (12px / 500 / 1.5px tracking) is the uppercase register for category tags and "NEW" labels.

`{typography.button}` (14px / 500 / 1.0 line-height) and `{typography.nav-link}` (14px / 500 / 1.4) complete the UI set. `{typography.code}` (JetBrains Mono / 14px / 400 / 1.6) covers all code blocks and terminal text. Open-source substitutes: Cormorant Garamond 500 (closest to Copernicus), EB Garamond (fallback), Inter (for StyreneB).

## Layout

The base unit is 4px. The spacing scale runs: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px. Major page bands are separated by `{spacing.section}` (96px). Internal card padding is `{spacing.xl}` (32px) for feature, pricing, and model-comparison cards; `{spacing.lg}` (24px) for code-window cards and connector tiles; `{spacing.xxl}` (48px) inside coral callout cards; 64px inside the larger dark CTA bands.

Max content width is 1200px, centered. The hero uses a 6/6 column split (heading stack left, illustration/mockup right). Feature grids run 3-up at desktop, 2-up at tablet, 1-up at mobile. Connector tile grids run 4–6-up at desktop, 2-up at tablet. Pricing grids run 3–4-up at desktop, 1-up at mobile.

Whitespace strategy is editorial: generous internal padding lets the serif display type breathe; uniform 96px band gaps create a long-form magazine pacing rather than a tight marketing template. Horizontal scroll is preferred over line-wrapping for code blocks on narrow viewports.

## Elevation & Depth

The system is color-block first; shadows are rare and minimal. Most depth comes from the cream-versus-dark surface contrast rather than drop shadows. Five elevation levels exist: flat (no shadow, no border — body sections, hero bands, top nav); soft hairline (1px `{colors.hairline}` border — inputs, sub-nav, some cards); `{colors.surface-card}` background with no shadow (feature cards, content cards); `{colors.surface-dark}` background with no shadow (code-editor mockups, model showcase cards); and a faint drop shadow (`0 1px 3px rgba(20,20,19,0.08)`) used only on hover-elevated states.

Dark surface cards carry their own internal depth through product chrome: syntax-highlighted code in muted tones, line numbers in `{colors.muted-soft}`, status bars in `{colors.surface-dark-elevated}`. This internal product detail substitutes for external shadow entirely. The Anthropic spike-mark (4-spoke radial glyph) appears inline as a brand marker. Hero illustrations use line-art with coral and dark-navy strokes on the cream canvas — never photorealistic, never drop-shadowed.

## Shapes

The radius scale is hierarchical by component size and importance. `{rounded.xs}` (4px) is reserved for badge accent details and small dropdowns. `{rounded.sm}` (6px) handles small inline buttons and dropdown items. `{rounded.md}` (8px) is the standard register for CTA buttons, text inputs, and category tabs — the most common shape token. `{rounded.lg}` (12px) covers all content cards: feature cards, pricing tiers, code-window cards, model-comparison cards, connector tiles, callout cards, and CTA bands. `{rounded.xl}` (16px) is reserved for the hero illustration container and the largest marquee components. `{rounded.pill}` / `{rounded.full}` (9999px) applies to badge pills, "NEW" tags, and circular icon buttons.

The philosophy is graduated softness: sharper at small UI elements, rounder at content containers, pill-only for label objects. The system never uses fully sharp (0px) corners; even the smallest tokens carry 4px. Illustrations use the same rounded language — line-art strokes match card radius rather than introducing independent shapes.

## Components

**Buttons:** `{component.button-primary}` is the coral CTA (background `{colors.primary}`, text `{colors.on-primary}`, `{rounded.md}`, 40px height). `{component.button-primary-active}` darkens to `{colors.primary-active}` on press — the only hover/press state the system encodes; nothing else transitions. `{component.button-secondary}` uses `{colors.canvas}` fill with a 1px `{colors.hairline}` border — visually recessive, same geometry as primary. `{component.button-secondary-on-dark}` never inverts to a light fill; it stays at `{colors.surface-dark-elevated}` to remain legible on dark surfaces. `{component.button-icon-circular}` is a 36px circle icon button at `{rounded.full}` with a hairline border.

**Cards:** `{component.feature-card}` (background `{colors.surface-card}`, `{rounded.lg}`, `{spacing.xl}` padding) is the cream content container. `{component.product-mockup-card-dark}` and `{component.code-window-card}` are the dark-surface counterparts showing actual Claude product chrome — code editors, terminal panels, agent interfaces. These are the dominant visual element on developer-focused pages and are preferred over abstract illustration. `{component.callout-card-coral}` is a full-bleed coral card used for the primary CTA; the coral surface IS the emphasis signal. `{component.pricing-tier-card-featured}` flips to `{colors.surface-dark}` to signal the featured plan — the dark surface IS the selection signal, not a badge or ring.

**Inputs:** `{component.text-input}` uses `{colors.canvas}` fill with a 1px `{colors.hairline}` border at `{rounded.md}`. Focus state `{component.text-input-focused}` shifts the border to `{colors.primary}` with a 3px low-alpha coral outer ring.

**Tags:** `{component.badge-pill}` uses `{colors.surface-card}` fill for neutral category labels. `{component.badge-coral}` uses `{colors.primary}` fill with `{typography.label-caps}` uppercase tracking for "NEW" and featured highlights.

**Navigation and Footer:** The top nav is 64px, `{colors.canvas}` background, carrying the Anthropic spike-mark wordmark, horizontal menu in `{typography.nav-link}`, and a right-side cluster with a text-link sign-in and `{component.button-primary}` "Try Claude." `{component.footer}` is always `{colors.surface-dark}` — it never inverts. Footer body text uses `{colors.on-dark-soft}`; the wordmark uses `{colors.on-dark}`.

## Do's and Don'ts

**Do:**

- Anchor every page on `{colors.canvas}` (#faf9f5). Pure white breaks the brand's warmth differentiation.
- Use Copernicus serif at weight 400 with negative letter-spacing for every display token (`{typography.display-xl}` through `{typography.display-sm}`). The negative tracking is not optional.
- Reserve `{colors.primary}` for primary CTAs and `{component.callout-card-coral}` full-bleed moments. Coral used elsewhere dilutes its voltage.
- Show actual Claude product chrome using `{component.product-mockup-card-dark}` and `{component.code-window-card}` rather than abstract marketing illustration.
- Alternate surface modes band-by-band: cream → cream-card → dark-mockup → cream → coral-callout → dark-footer.
- Apply `{spacing.section}` (96px) between every major page band without exception.
- Use the Anthropic spike-mark as the brand wordmark prefix. Never invert it to white-on-dark within the wordmark.
- Apply `{rounded.lg}` (12px) to all content cards and `{rounded.md}` (8px) to all interactive controls.
- Keep `{typography.button}` and `{typography.nav-link}` in StyreneB / Inter. The sans body is the boundary; serifs never enter the UI layer.

**Don't:**

- Don't use cool gray or pure white for the page canvas. Cream is the differentiator.
- Don't bold display type. Copernicus at weight 700 reads as bombastic; the system is locked at 400 for all display tokens.
- Don't introduce cool blue, cyan, or saturated hues as accents. The coral is the sole brand voltage.
- Don't use `{colors.primary}` on every accent detail. Coral is scarce at element scale and generous only at callout-card scale.
- Don't use Inter or StyreneB for display headlines. The serif character is the brand voice; swapping to sans makes Claude indistinguishable from every other AI product.
- Don't repeat the same surface mode in two consecutive bands. Cream → cream is a pacing failure.
- Don't add hover state styling beyond what the system encodes. Only `{component.button-primary-active}` and `{component.text-input-focused}` have defined interactive states.
- Don't introduce a fourth surface tone (no purple cards, no green sections, no gradient fills). Cream + coral + dark navy is the complete surface trinity.
- Don't wrap code lines on narrow viewports. Use horizontal scroll within `{component.code-window-card}` to preserve code legibility.
- Don't drop-shadow cards. Color-block contrast is the depth mechanism; shadows appear only as a faint optional hover enhancement and never as a structural layer.
