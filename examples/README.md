# Examples

A handful of finished HTML artifacts generated inside Design Factory.
Each one is a single self-contained file — open it in any browser to
see what the app produces, or load it into a new project to use as a
starting point.

| File                      | What it is                                                                           | Surface       |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `landing-hero.html`       | Editorial product hero with a paragraph stack, a CTA, and a tabular-nums stat row    | Marketing     |
| `pricing-card.html`       | Three-tier pricing block with the middle plan promoted via depth, no decorative bars | Marketing     |
| `dashboard-stat-row.html` | KPI row pattern — tabular figures, scoped delta colors, no card bars                 | Internal tool |

Each example follows the 30 default rules shipped with DF (no decorative
emojis, no invented decoration, palette derives from the established
neutrals + one accent, tabular nums on every numeric, etc).

To open: `open examples/landing-hero.html` (or double-click in Finder).
To remix: copy the file into a new project's folder under
`projects/<slug>/<slug>.html` and start a fresh chat over it.

## `fixtures/`

Stable, minimal artefacts that exercise the importer flow (design-system
import and skill ZIP import) without relying on third-party design.md URLs
or whatever ZIPs happen to be in the user's skills folder.

| Path                                | What                                           | Used by                              |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `fixtures/design-system/design.md`  | Smoke DS — palette, type, spacing, radii       | Step 9 — DS import via "Pasta local" |
| `fixtures/skills/minimal-skill.zip` | Minimal `/smoke-skill` skill, two-file payload | Step 10 — Skill ZIP import           |
| `fixtures/skills/minimal-skill/`    | Unzipped source used to regenerate the zip     | reference only                       |

If you tweak the fixtures, re-zip `minimal-skill/` before committing
so the runbook keeps passing on a fresh clone.
