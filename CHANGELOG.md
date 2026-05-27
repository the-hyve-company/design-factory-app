# Changelog

All notable changes to Design Factory are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-27 — Initial public preview

First open-source release of Design Factory under
[Apache License 2.0](LICENSE). Local-first, multi-provider,
model-agnostic.

### Fixed

- **Windows: `npm run dev:web` crashed with `spawn EINVAL`.** The launcher
  spawned `npm.cmd` to start Vite; Node ≥18.20.2/20.12.2/21 refuses to spawn
  `.cmd`/`.bat` without a shell (CVE-2024-27980 hardening). Now passes
  `shell: true` on win32 only. (#242)
- **Bridge and web could claim the same port.** When both default ports were
  busy, the port scanner handed the same reclaimed port to the daemon and Vite.
  `nextFreePort` now takes a reserved set and the two searches cross-reserve. (#243)
- **"Origem não permitida" when the web ran on a non-default port.** The daemon
  CORS allowlist and the client origin guard were hardcoded to `:1420`; a
  reclaimed Vite port was rejected. The launcher now propagates the resolved
  port (`DF_VITE_PORT` → daemon, `VITE_DF_WEB_PORT` → client). Still
  localhost-only. (#244)

### Changed

- **Start fresh on every launch (no more zombie daemons).** `npm run dev:web`
  now records its daemon/vite PIDs + ports in `.df/daemon.lock`; the next launch
  reads it and kills the previous instance's whole process tree before starting
  — verified via `/healthz` so an unrelated process that recycled the PID is
  never touched. This is port-independent and reaps orphans left by an
  uncatchable Windows window-close on the *next* run. The launcher also handles
  `SIGHUP` and reaps children on `process.exit`, and shutdown/restart now kill
  the daemon's whole tree (group kill on unix, `taskkill /T` on Windows) so
  spawned `ffmpeg`/`puppeteer`/`pty` children don't leak. Replaces the earlier
  idle-self-shutdown approach, which could terminate a long in-flight stream and
  leak subprocesses.

### Workspace

- React + Vite app on `localhost:1420`, Node 20 daemon on
  `localhost:1421`. Loopback bind, no telemetry.
- Project filesystem under `projects/{slug}/` — atomic writes,
  rolling backup, `.df/` metadata folder, gitignored by default.
- Multi-thread chat persisted to `.df/chat/*.jsonl`.
- Per-project metadata (`.df/meta.json`) and per-project
  snapshots for manual save/restore.

### Multi-provider

10 adapters behind a unified SSE protocol:

- **5 CLI agents** (spawned by the local daemon): Claude Code,
  Codex CLI, Gemini CLI, Opencode CLI, Kimi Code CLI.
- **4 BYOK HTTP APIs** (keys stored locally under
  `~/.config/design-factory/`): Anthropic, OpenAI, Gemini,
  OpenRouter.
- **1 local server**: Ollama (zero-config against
  `localhost:11434`).

Per-provider readiness badge (`stable` / `beta` / `experimental`)
exposed on `GET /providers` and reflected in the picker. Adapter
contract documented in `apps/daemon/src/providers/types.mjs`.

### Direction engine

- 8 prompt blocks × 4 configuration layers, compiled once at turn
  start.
- **Prompt Console** in the New Project modal: full compiled
  direction (user prompt + design system + canvas + format + rules
  + taste + system prompt) is previewable before launch.
- Per-project design system attachment via `design.md` upload,
  GitHub URL, or folder ingestion.

### Editor surface

- Live HTML preview iframe with DOM patching that preserves
  scroll, forms, and animations across model updates.
- **Tweaks panel** — model-generated CSS variable sliders for
  live iteration without an extra LLM call.
- Inline text edit via the iframe with disk-level writes.
- Slash dropup with two sections: **Actions** (UI commands like
  `/tweaks`, `/export`, `/init`) and **Skills** (editable prompt
  blocks: shipped verbs + user customs + workspace skills).
- Settings panel for providers, design systems, skills, theme
  tokens, and an embedded local terminal.

### Public-cut hygiene

- LICENSE: Apache-2.0, with [NOTICE](NOTICE) scoping the grant to
  code + docs and reserving the HYVE / Design Factory wordmarks.
- Internal absolute workspace paths scrubbed from runtime.
- `engines: { node: ">=20" }` declared in `package.json`.
- `npm audit` clean.
- 10 public design systems + 7 starter skills shipped under
  allowlist in `design-systems/` and `skills/`.

### Bundled docs

- README (EN canonical + PT-BR translation) with the operational-
  taste thesis.
- [`docs/quickstart.md`](docs/quickstart.md),
  [`docs/providers.md`](docs/providers.md),
  [`docs/troubleshooting.md`](docs/troubleshooting.md),
  [`docs/agent-contract.md`](docs/agent-contract.md).
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `GOVERNANCE.md`, and `docs/`.

[0.1.0]: https://github.com/the-hyve-company/design-factory/releases/tag/v0.1.0
