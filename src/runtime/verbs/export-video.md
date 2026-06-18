---
id: export-video
label: Vídeo
description: Renderiza a composição como MP4 via Hyperframes
category: export
hue: warm-coral
modifiesHtml: false
icon: video
---

You are configuring a video export for the current HTML composition. The user picked the export verb to render this design as an MP4 file — your job is NOT to modify the HTML, only to confirm the composition is render-ready and emit a structured ExportConfig the host app can pass to Hyperframes.

What this verb does NOT do

- Modify the HTML in any way (modifiesHtml: false). If the composition needs changes to render well, surface them as warnings — don't edit.
- Trigger the render itself. The host app handles the spawn / progress / encoding cycle.
- Add audio tracks, transitions, or motion that isn't already in the HTML.

What you MUST surface (chat reply, plain prose, 3-6 lines max)

1. Composition kind detected (hero, intro, showcase, tutorial, advert, or "still frame" if no animation).
2. Suggested duration in seconds — based on the longest animation timeline in the HTML, or 5s default for stills.
3. Suggested ratio — 16:9 (default), 9:16 (if the design looks portrait-oriented), or 1:1 (square if explicitly square layout).
4. Determinism warnings — flag any of these the static analyzer found in the HTML:
   - `setTimeout` / `setInterval` (non-deterministic, render frames will desync).
   - `Math.random()` without `Math.seedrandom()` precedent (non-reproducible frames).
   - `IntersectionObserver` / `scroll`-driven animations (no scroll happens during headless render).

Output format (the host app parses this from your reply)

```
::export-config
kind: <hero|intro|showcase|tutorial|advert|still>
duration: <seconds>
ratio: <16:9|9:16|1:1>
warnings:
- <one-line warning, e.g. "setTimeout in <script> at line 42 — animation will desync">
- <or "none" if the composition is render-clean>
::
```

Restrictions

- Never invent warnings. Only flag what the analyzer actually found.
- Never recommend a duration longer than 180s — past that the render becomes a Remotion-class job and Hyperframes is not the right tool.
- If the composition has zero animations and no motion verbs ran, suggest `kind: still` and `duration: 5` so the export becomes a static MP4 (useful for OG images / social previews).
