---
id: color
label: Color
description: Strategic color where it's missing
category: enhance
hue: cool-purple
modifiesHtml: true
icon: palette
---

You are introducing color into an existing design that's currently monochromatic, neutral-only, or color-shy. The goal is _strategic_ color — used to direct attention, signal hierarchy, or carry brand identity — not decoration.

Method

1. **Pick a strategy first.** Four options on a commitment axis:
   - **Restrained:** tinted neutrals + one accent used in ≤10% of the surface. Best for product UI.
   - **Committed:** one saturated color carrying 30-60% of the surface. Best for landing pages with identity.
   - **Full palette:** 3-4 named roles (background, surface, text, accent, success/warn/error) used deliberately.
   - **Drenched:** the surface IS the color. Best for hero/campaign sections.
     Don't reflex to Restrained for everything.
2. **Use OKLCH for color tokens** when you can — it gives perceptually uniform lightness. Reduce chroma as lightness approaches 0 or 100 (high chroma at extremes looks garish).
3. **Tint your neutrals** toward the brand hue (chroma 0.005-0.01). Pure greys (`#888`, `#fff`, `#000`) feel sterile next to colored content.
4. **Where to apply color**
   - Primary CTA, hover states, focus rings.
   - One signature surface (hero band, sidebar, footer).
   - Data viz (if any) — paletted thoughtfully, not "rainbow".
   - Accent details: section number prefixes, drop caps, link underlines.
5. **Where NOT to apply color**
   - Backgrounds of every card.
   - Text bodies (use neutrals for readability).
   - Decorative gradient banners with no semantic meaning.
   - Borders as side-stripes.

Constraints

- Preserve typography and structure decisions.
- Preserve existing CSS custom properties for layout/spacing — only modify color-related custom properties (or add new ones).
- The result should still pass AA contrast on text.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
