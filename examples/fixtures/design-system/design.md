---
name: Smoke DS
description: Minimal design system that exercises the DS import flow.
version: 0.1.0
---

# Smoke DS

A deliberately small `design.md` whose only job is to exercise the
design-system import path end-to-end without leaning on any
production DS. Drop this into the importer to test the import flow.

## Palette

| Token         | OKLCH                    | Hex       | Purpose        |
| ------------- | ------------------------ | --------- | -------------- |
| `--ds-ink`    | `oklch(0.18 0.005 80)`   | `#1a1a17` | Body ink       |
| `--ds-paper`  | `oklch(0.97 0.005 80)`   | `#fafaf7` | Background     |
| `--ds-muted`  | `oklch(0.55 0.005 80)`   | `#6b6b66` | Secondary text |
| `--ds-line`   | `rgba(26, 26, 23, 0.10)` | —         | Hairlines      |
| `--ds-accent` | `oklch(0.55 0.21 270)`   | `#4a3aff` | Single accent  |

One neutral scale, one accent. Anything else is out of scope for
this fixture.

## Typography

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- Mono: `ui-monospace, "SF Mono", Menlo, monospace`
- Size base: 17 px
- Line height base: 1.55
- Numerals: `font-variant-numeric: tabular-nums` on every numeric
  surface (tables, prices, counters, time displays).

## Spacing

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128`

## Radii

`2 / 4 / 8 / 12 / 16`

## Motion

- Default transition: `120ms ease-out`
- Respects `prefers-reduced-motion: reduce` (transitions collapse
  to 0.01ms).

## Anti-patterns

The same banned patterns the shipped 30 default rules call out —
no decorative emojis, no card bars, no raw black, no placeholder
text. The fixture is deliberately conservative.
