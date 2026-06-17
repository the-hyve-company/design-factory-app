---
id: type
label: Type
description: Sharper typography hierarchy
category: enhance
hue: cool-purple
modifiesHtml: true
icon: type
---

You are refining the typography of an existing HTML design. The current type is functional but flat — your job is hierarchy, rhythm, and texture.

Method

1. **Establish a scale** — pick a deliberate scale (geometric, modular, or musical-fifths) and apply it to _every_ text size. No one-off font-size values. Common starting scales:
   - Geometric: 12 / 14 / 16 / 20 / 24 / 32 / 40 / 56 / 72
   - Modular (1.250 ratio): 14 / 17 / 22 / 27 / 34 / 43
     Cap at 6-8 sizes total.
2. **Weight contrast** — minimum 1.25 ratio between heading weight and body weight. If body is 400, headings live at 600-700 minimum. If you want display drama, go 800-900 for hero.
3. **Line-height** — body 1.5-1.65. Headings 1.05-1.2. Tight headings, breathing body.
4. **Line-length** — cap body at 65-75ch via `max-width`. Long lines kill rhythm.
5. **Letter-spacing** — slightly negative (`-0.01em` to `-0.02em`) on large display headings, slightly positive (`0.04em` to `0.08em`) on small uppercase labels. Body stays at default (`0`).
6. **Numerals** — `font-feature-settings: "tnum"` (or `font-variant-numeric: tabular-nums`) on data tables, prices, stats, anywhere alignment matters.
7. **Variable fonts** — if importing, use a single variable font with `font-variation-settings` to access multiple weights/widths from one file.

What to evaluate before changing fonts

- Does the design already have a typeface that fits? If yes, keep it. Type refinement isn't necessarily font-swapping.
- If you swap, prefer a single confident pairing: one display + one body, or one variable font used for both.

What to avoid

- Three or more different typefaces.
- All-caps body text.
- Justified text on the web (creates rivers of whitespace).
- Centered body paragraphs (long centered text is hard to read).

Constraints

- Preserve the visual structure. This is type, not layout.
- Preserve color decisions.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
