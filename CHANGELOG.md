# Changelog

All notable changes to Design Factory are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] — 2026-06-01

### Fixed

- **Design system · `design.md` upload** — the upload source now saves the
  file **verbatim** instead of routing it through an LLM normalization pass
  that reordered and summarized the markdown (it was silently shrinking
  uploaded design systems). Extraction from CSS / sites / repos stays in the
  folder/url/github sources, where it belongs.
- **Model picker (Claude)** — removed the hard-coded version numbers from the
  Claude aliases (`opus`/`sonnet`/`haiku`), so the picker no longer shows a
  stale version (e.g. "opus 4.7") after the CLI updates. The alias always
  resolves to the latest model; the real resolved version (e.g. "opus 4.8")
  now annotates the picker once a turn reports it.

## [0.1.0] — Initial public release

First open-source release under [Apache License 2.0](LICENSE). Local-first,
multi-provider, model-agnostic.

### Workspace

- React + Vite app on `localhost:1420`, Node 20 daemon on `localhost:1421`.
  Loopback bind, no telemetry.
- Project files under `projects/{slug}/` with atomic writes, rolling backup,
  and a gitignored `.df/` metadata folder.
- Multi-thread chat and per-project snapshots persisted under `.df/`.

### Providers

Ten adapters behind one SSE protocol:

- **CLI agents** spawned by the daemon: Claude Code, Codex, Gemini, Opencode,
  Kimi.
- **BYOK HTTP APIs**, keys stored locally: Anthropic, OpenAI, Gemini,
  OpenRouter.
- **Local server**: Ollama.

Each adapter carries a readiness badge (`stable` / `beta` / `experimental`)
surfaced in the picker.

### Direction and editing

- Per-project direction (canvas, format, rules, design system, skills) compiled
  before the first output, previewable in the New Project modal.
- Live HTML preview with DOM patching that preserves scroll, forms, and
  animations across model updates.
- Tweaks panel, inline text edit, comments, and slash actions.
- Settings for providers, design systems, skills, theme tokens, and an
  embedded terminal (experimental).

### Ships with

- 10 curated design systems and 6 starter skills.
- Docs: quickstart, providers, troubleshooting, agent contract.
- Cross-platform launchers (`start` / `update` for macOS and Windows).
