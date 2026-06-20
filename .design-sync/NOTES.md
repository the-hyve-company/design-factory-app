# design-sync notes — Design Factory DS

Repo-specific gotchas for syncing this design system to claude.ai/design.
Project: **Design Factory DS** (`8ce5d524-7df3-4193-95e6-03d2390720dc`).

## What this sync is

- **This repo is the DF *app*, not a packaged component library.** The synced
  surface is a hand-curated set of **19 reusable DS pieces** from
  `src/components/` (controls, buttons, modal, surfaces, feedback, brand,
  visual). App-coupled components (chat, file manager, screens, providers,
  terminal, canvas) are deliberately excluded.
- `shape: package`, **synth-entry** mode: there is no `dist/` component-library
  build. The converter bundles straight from `src/` via a hand-authored entry.

## Build / re-sync commands

There is **no `cfg.buildCmd`** — esbuild bundles the TS source directly. Build:

```
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --entry ./.design-sync/df-entry.ts --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

Driver (re-sync): same but `node .ds-sync/resync.mjs … --entry ./.design-sync/df-entry.ts --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`.
Always pass `--entry ./.design-sync/df-entry.ts` — without it the converter
synth-globs ALL of `src/` (the whole app) into the bundle.

## Repo-specific config decisions

- **`df-entry.ts` is hand-maintained.** It re-exports exactly the curated set
  AND side-effect-imports the stylesheets that carry the design language into
  `_ds_bundle.css` (`global.css` → tokens+components, `np-canonical-plus.css`,
  `np-v8.css`, `skeu-hero.css`; `searchable-dropdown.css` is self-imported by
  its component). To add/remove a component you must edit **df-entry.ts +
  componentSrcMap + dtsPropsFor + docsMap + groups/** together.
- **`dtsPropsFor` is hand-written for ALL 19.** Synth-entry mode does NOT extract
  props from `.tsx` (no shipped `.d.ts`), so every component fell back to
  `[key: string]: unknown` without it. These contracts can drift from source —
  if a component's real props change, update `dtsPropsFor` by hand.
- **Geist fonts shipped** (user's choice, 2026-06-20). `cfg.extraFonts` →
  `.design-sync/geist-fonts.css` → `.design-sync/fonts/*-Variable.woff2`
  (committed; copied from the npm `geist` package's variable fonts). The tokens
  call for Geist/Geist Mono; without shipping, designs render system-ui.
- **Grouping via docsMap stubs** (`.design-sync/groups/*.md`, frontmatter
  `category`) → controls/buttons/overlays/surfaces/feedback/brand/visual.
- **`source-kit.mjs` is FORKED** (`.design-sync/overrides/`, declared in
  `cfg.libOverrides`): only change vs upstream is adding `'dfds'` to
  `GENERIC_DIR`, so the `src/components/dfds/*` primitives recategorize via
  docsMap instead of all landing in a `dfds` group. The fork's relative imports
  point at `../../.ds-sync/lib/*` and ts-morph at
  `../../.ds-sync/node_modules/ts-morph/dist/ts-morph.js` — re-copy `.ds-sync`
  before any re-sync so those resolve.
- **`guidelinesGlob: []`** — suppressed; the default would upload the app's
  `docs/` (agent-contract, architecture, …) which are NOT DS guidelines.
- **Overlays/wide cards** via `cfg.overrides`: DfModal + SearchableDropdown =
  `cardMode: single` (+viewport); SkeuHero, ModalClose, AskUserQuestion,
  CharacterCover, DfLoader, EntityCard, PreviewSandboxBadge = `cardMode: column`
  (their preview surfaces are wider than a grid cell).

## Known render warns (triaged — not new on re-sync)

- **`[TOKENS_MISSING]`**: `--df-bg-raised, --df-text-tertiary, --df-motion-base,
  --df-accent, --df-border` — referenced but not defined in the shipped CSS.
  These are either set at runtime by the app (e.g. `--df-accent` per user pick)
  or used only by app CSS outside the synced components. All previews render
  correctly (verified on the contact sheets), so non-blocking.

## Environment

- Render check uses the **repo's** `playwright@1.59.1` + cached
  `chromium-1217` (`~/.cache/ms-playwright`). No install needed; resolves from
  `./node_modules` because `.ds-sync` has no playwright.

## Re-sync risks (watch-list)

- **The fork** (`overrides/source-kit.mjs`) can rot against upstream
  `lib/source-kit.mjs`. On re-sync, diff them and re-apply the one-line
  `GENERIC_DIR` change if upstream moved.
- **`dtsPropsFor` drift**: hand-written contracts won't track source prop
  changes — re-verify if components were edited.
- **`df-entry.ts` drift**: a component added to the curated idea but not added
  here silently won't sync; one removed from src will fail the bundle.
- **Geist woff2** are committed snapshots from npm `geist` — not refetched.
- **Interaction-only states skipped**: CustomSelect / ColorPickerPopover open
  menus are internal `useState` (can't force open statically) — previews show
  the trigger. TactileIconBtn must carry an icon child or it renders near-blank
  (the preview supplies real SVG icons).
