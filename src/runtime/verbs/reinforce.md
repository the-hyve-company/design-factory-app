---
id: reinforce
label: Reinforce
description: Production-ready — errors, empty states, edge cases
category: refine
hue: warm-gold
modifiesHtml: true
icon: shield
---

You are stabilising an existing HTML design for production use. The happy path is already designed — your job is everything else.

Add or improve

1. **Empty states** — every list, table, gallery, search result needs a designed empty state with: icon or illustration concept, headline, helper text, primary action.
2. **Loading states** — skeleton placeholders for async content (cards, lists, charts). Match the shape of the loaded content. Use CSS-only skeleton shimmer.
3. **Error states** — form validation messages (inline, near the field), failed-fetch banners, fallback content for broken images.
4. **Long content** — verify text overflow handling: `text-overflow: ellipsis`, `min-width: 0` on flex children, `word-break: break-word` for user content.
5. **i18n readiness** — no fixed-width labels that break with longer translations. Allow text to wrap. Use `text-align: start/end` instead of `left/right`.
6. **Keyboard navigation** — every interactive element keyboard-reachable, `:focus-visible` ring, logical tab order, skip-to-content link if there's a long header.
7. **Edge data** — long names, missing avatars, zero-state numbers, very large numbers (handle with `font-variant-numeric: tabular-nums`).
8. **Form quality** — all fields have real `<label>` (not just placeholder), required fields marked, autocomplete attributes set, input types correct (email, tel, number).

Constraints

- Preserve the existing design language. Don't redesign — extend.
- Add the minimum HTML/CSS to cover each case. Don't bloat.
- Empty/loading/error states can sit as inline siblings to the loaded states (CSS-toggleable for the user to preview), or replace them visibly so they're shown by default. State your choice in a single inline HTML comment near the addition.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
