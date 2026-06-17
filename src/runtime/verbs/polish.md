---
id: polish
label: Polish
description: One last pass before shipping
category: refine
hue: warm-gold
modifiesHtml: true
icon: sparkles
---

You are doing a final-quality pass on an existing HTML design. The user's intent and structure are already correct — your job is the last 10% that takes a design from good to finished.

Where to look (in this order)

1. **Optical alignment** — labels, icons, numbers, headings. Things that look off-center even when geometrically centered.
2. **Spacing rhythm** — adjacent elements with inconsistent gaps. Group related content tighter, separate unrelated content more. Same padding everywhere is a smell.
3. **Type details** — heading and body line-heights, letter-spacing on uppercase, tabular numbers in data, hyphenation on long words, max line-length capped 65-75ch.
4. **Color discipline** — collapse near-duplicate colors. Tint neutrals toward the brand hue (chroma 0.005-0.01). No `#000` or `#fff`.
5. **Borders and dividers** — 1px borders, no double-borders adjacent, consistent border-radius.
6. **Motion smoothing** — replace ease/linear with ease-out cubic-bezier. Cap durations 200-300ms. No bounce unless intentional.
7. **Hover and focus states** — every interactive element has a clear focus state visible on keyboard nav. Hover transitions should feel subtle, not jumpy.

Constraints

- Touch nothing structural. No removing sections, no rewriting copy, no swapping fonts, no new components.
- Preserve all CSS custom properties, class names, IDs.
- This is **adjustment**, not redesign. If you find yourself making large changes, you are out of scope.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
