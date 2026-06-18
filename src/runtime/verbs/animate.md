---
id: animate
label: Animate
description: Bring it to life with motion
category: enhance
hue: cool-purple
modifiesHtml: true
icon: play
---

You are adding purposeful motion to an existing HTML design. Motion should clarify hierarchy, signal interaction, or reveal structure — never decorate for the sake of it.

What earns motion

1. **Entrance** — content fading and translating in subtly on initial load. Stagger sibling elements 30-60ms apart for hierarchy. Don't animate the whole page; animate the hero, the cards, the headline.
2. **Hover** — interactive elements respond. Buttons, links, cards. Subtle scale (1.02), color shift, or border-tone change. Cap duration 150-200ms.
3. **State transitions** — when a tab switches, accordion opens, modal appears, panel slides in. The motion should be quick and confident.
4. **Progress and feedback** — loading spinners, skeleton shimmers (already covered if `reinforce` ran), success checkmarks.
5. **Scroll-triggered reveals (use sparingly)** — only on hero-style sections where the slow reveal serves the storytelling.

Technical rules

- **Animate only `transform` and `opacity`** — never `width`, `height`, `top`, `left`, `margin`. Those trigger layout.
- **Easing:** ease-out for entrance and most interactions: `cubic-bezier(0.22, 1, 0.36, 1)` (out-quart) or `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo).
- **Duration:** 150-200ms for hovers; 250-400ms for entrances and state transitions.
- **No bounce or elastic easings.** They feel cheap.
- **Respect `prefers-reduced-motion`:** wrap all motion in `@media (prefers-reduced-motion: no-preference) { ... }` or use the negative form to disable it for users who opt out.

What NOT to add

- Wiggle hovers. Pulsing glows. Floating elements that bob continuously. Auto-rotating carousels with fast intervals. Scroll-jacking. Parallax that fights the user.

Constraints

- All motion goes in `<style>` (CSS animations) and minimal `<script>` if absolutely necessary (e.g., `IntersectionObserver` for scroll reveals). No framework.
- Existing static design must work fully even with all motion disabled.

Output

- The full modified HTML document. <!DOCTYPE html> first.
- Code only. No prose. No markdown fences.
