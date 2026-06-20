# DesignFactory DS — how to build with it

A skeuomorphic, factory-tactile design system: warm olive-grey surfaces, real
light physics (inset top highlights + layered drops), no gradients/glows. Build
with the real components from `window.DFDS.*`; style your own layout glue with
the `--df-*` tokens below.

## Setup — theme attribute, no provider

Theming is a **CSS attribute, not a React provider**. Tokens are defined on
`:root, [data-theme="dark"]` (the default) and `[data-theme="light"]`. To render
correctly:

1. Load the DS stylesheet (`styles.css` — it pulls the full token + component
   CSS closure and the Geist / Geist Mono webfonts).
2. Set the theme on an ancestor: `<html data-theme="dark">` (or `"light"`), or a
   wrapper `<div data-theme="light">…</div>`. Nesting a `data-theme` div
   re-scopes the theme for its subtree — that's how a card can show both.

No `<Provider>` wrapper is needed; components read CSS variables directly. Put
real content on a `var(--df-bg-base)` surface — components are tuned for that
background, not white.

## Styling idiom — `--df-*` tokens

The components are pre-styled. For YOUR layout glue, use these token families
(do not invent hex values — the palette is monochrome warm olive-grey + a single
accent):

- **Surfaces** (back→front): `--df-bg-sunken`, `--df-bg-base`, `--df-bg-section`,
  `--df-surface-raised`, `--df-surface-elevated`, `--df-surface-overlay`
- **Text**: `--df-text-primary`, `--df-text-secondary`, `--df-text-muted`,
  `--df-text-faint`, `--df-text-inverse`, `--df-text-on-tactile`
- **Borders** (1px solid only): `--df-border-subtle`, `--df-border-strong`,
  `--df-border-divider`
- **Radius**: `--df-r-sm`, `--df-r-md`, `--df-r-lg`, `--df-r-xl`
- **Type**: `--df-font-sans` / `--df-font-display` (Geist), `--df-font-mono`
  (Geist Mono — use for technical identifiers, sizes, slugs)
- **Accent / semantic** (used sparingly, never on surfaces):
  `--df-accent-user` (warm gold), `--df-accent-ok`, `--df-accent-warn`,
  `--df-accent-danger`, `--df-accent-info`
- **Depth** (the skeu feel): `--df-shadow-card`, `--df-shadow-button-tactile`
  (+ `-hover` / `-pressed`), `--df-skeu-top-light`

There are no Tailwind/utility classes to compose with. Component-internal class
names (`.df-modal`, `.skeu-toggle`, `.skeu-hero`, `.home-pcard`, …) belong to the
components — don't hand-write markup against them; render the component instead.

## Where the truth lives

- The stylesheet `styles.css` and its `@import` closure (`_ds_bundle.css`) define
  every token and component style — read it before styling.
- Per-component API + usage: `components/<group>/<Name>/<Name>.d.ts` (props
  contract) and `<Name>.prompt.md` (how to compose it). Groups: controls,
  buttons, overlays, surfaces, feedback, brand, visual.

## Idiomatic snippet

```tsx
// A settings panel on the DS surface, dark theme.
<div data-theme="dark" style={{ background: "var(--df-bg-base)", padding: 24,
  fontFamily: "var(--df-font-sans)", color: "var(--df-text-primary)" }}>
  <DFDS.SkeuHero kicker="SETTINGS" title="Appearance" size="md" />
  <div style={{ display: "flex", flexDirection: "column", gap: 12,
    marginTop: 16, padding: 16, background: "var(--df-surface-raised)",
    border: "1px solid var(--df-border-subtle)", borderRadius: "var(--df-r-lg)" }}>
    <DFDS.SkeuToggle on onChange={() => {}} label="Auto-save snapshots" />
    <DFDS.CustomSelect value="16:9" options={[{ value: "16:9", label: "16 : 9" }]}
      onChange={() => {}} />
  </div>
</div>
```
