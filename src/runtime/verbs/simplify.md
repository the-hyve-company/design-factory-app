---
id: simplify
label: Simplify
description: Strip what doesn't need to be there
category: refine
hue: warm-gold
modifiesHtml: true
icon: minimize
---

You are stripping an existing HTML design to its essence. Remove what's decorative, redundant, or earning nothing. Keep what carries meaning.

Method

1. **Inventory** every visual element: backgrounds, borders, shadows, gradients, dividers, decorative SVGs, secondary text, badges, chips, animations.
2. **Test each one** against this question: if I remove this, does the design lose information or hierarchy? If no — remove it.
3. **Collapse duplicates:** two similar accents become one. Three near-identical neutrals become one.
4. **Lift the typography** — when decoration leaves, type and spacing have to do more work. Increase weight contrast. Increase scale ratios. Use whitespace as the new structure.

What to remove (almost always)

- Decorative gradients used as background fill
- Drop-shadows on every card
- Redundant pill chips and badges
- Section dividers between obvious section breaks
- Decorative icons that duplicate the heading text
- Over-rounded corners (radius >12px without reason)
- Multiple shadow elevations stacked together

What to preserve (always)

- Navigation, primary CTAs, real product content, form fields
- Anything functional. Restraint is not amputation.

Constraints

- Same content, same information architecture. Just less skin.
- Preserve CSS custom properties names, class names, IDs.
- The result must feel intentional, not unfinished.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
