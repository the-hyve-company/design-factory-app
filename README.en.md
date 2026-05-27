<p align="right">
  <a href="README.md"><img alt="Português" src="https://img.shields.io/badge/lang-Portugu%C3%AAs-green.svg"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/readme/assets/df-cover.png" alt="Design Factory" width="100%">
</p>

# Design Factory

Design with AI without always starting from an empty prompt.

<p>
  <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"></a>
  <a href="package.json"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg"></a>
  <a href="docs/providers.md"><img alt="Multi-provider" src="https://img.shields.io/badge/providers-multi--model-ff5524.svg"></a>
</p>

Design Factory is a local-first, open-source workspace for generating and
editing HTML artifacts with AI. Each project starts with preconfigured direction
(canvas, format, rules, design system, skills) before the first output. You can
work with multiple models in the same project.

---

## Get started

First, install these two free programs (skip any you already have):

- **Node.js** (version 20 or newer) — the engine that runs the app. Download it
  from [nodejs.org](https://nodejs.org/) and click the big **LTS** button. Open
  the downloaded file and click through to install.
- **Git** — used to download and update the project. Get it from
  [git-scm.com/downloads](https://git-scm.com/downloads).

You also need at least one AI CLI (such as Claude Code) or an API key — that's
what generates the designs.

With both installed, open a terminal and run:

```bash
git clone https://github.com/the-hyve-company/design-factory.git
cd design-factory
npm install
npm run dev:web
```

The launcher boots the app and opens your browser at `http://localhost:1420`. If
the port is busy, it picks another and prints the URL.

No terminal needed: after cloning, double-click `start.command` (macOS) or
`start.bat` (Windows). The first run installs dependencies and opens the app. To
update, use `update.command` / `update.bat`.

Once it opens, go to Settings → Providers. CLIs you already have logged in show
as connected; BYOK keys are optional. Create a project, give it context,
generate, then refine with tweaks, comments, and edits. Walkthrough in
[docs/quickstart.md](docs/quickstart.md).

---

## Status

Design Factory is early. The local path above is the tested, recommended one.

| Area | State |
| --- | --- |
| HTML generation, projects, versions | stable |
| Multi-provider picker (CLI / BYOK / local) | stable |
| Design systems, tweaks, comments, inline edit | stable |
| Embedded terminal | experimental |

---

## Providers

| Class | Examples | Notes |
| --- | --- | --- |
| CLI agents | Claude Code, Codex, Gemini, Opencode, Kimi | the local daemon spawns them |
| BYOK APIs | Anthropic, OpenAI, Gemini, OpenRouter | keys stay local |
| Local server | Ollama | offline |

Tokens live in `~/.config/design-factory/` or your environment. The browser
never touches provider secrets; the daemon runs them. Canonical source:
[docs/providers.md](docs/providers.md).

---

## Architecture

A React app (UI, flow, preview, settings) plus a Node daemon (filesystem,
provider execution, SSE streams, terminal). Stack: React 18, Vite, TypeScript,
Zod, Node 20 HTTP/SSE, Vitest.

```txt
src/          React app
apps/daemon/  Local Node bridge
docs/         Documentation
skills/       Reusable instruction blocks
projects/     Local work (gitignored)
```

---

## Commands

```bash
npm run dev:web     # app + daemon (opens the browser)
npm run build       # TypeScript + Vite
npm test            # Vitest
```

Before a PR: `npx tsc --noEmit && npm test && npm run build`.

---

## Contributing

The method has to stay inspectable and forkable. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and [docs/providers.md](docs/providers.md).
Open areas: provider adapters, design-system ingestion, artifact editing, visual
quality gates, docs, and tests.

---

## License

[Apache License 2.0](LICENSE) © The HYVE Company. Use, fork, study, and adapt.
Read [NOTICE](NOTICE) before reusing the HYVE or Design Factory marks: the
license covers code and docs, the marks stay reserved.
