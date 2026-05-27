<p align="right">
  <a href="README.md"><img alt="Português" src="https://img.shields.io/badge/lang-Portugu%C3%AAs-green.svg"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/readme/assets/df-cover.png" alt="Design Factory" width="100%">
</p>

# Design Factory

**Create and shape design with AI without starting from an empty prompt.**

<p>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"></a>
  <a href="package.json"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg"></a>
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/the-hyve-company/design-factory/ci.yml?branch=main"></a>
  <a href="docs/providers.md"><img alt="Multi-provider" src="https://img.shields.io/badge/providers-multi--model-ff5524.svg"></a>
</p>

Design Factory is a local-first, open-source workspace to generate, edit
and organize HTML artifacts with AI. Every project starts with
direction: canvas, format, rules, design system, skills and commands
before the first output.

You pick the model for each step, without leaving the project: CLI
agents, BYOK APIs or local models. The result stays in your
environment: files, versions, prompts, comments and tweaks remain
accessible, editable and inspectable.

<p>
  <a href="#quickstart"><img alt="Quickstart" src="https://img.shields.io/badge/▶_Quickstart-1d2128?style=for-the-badge"></a>
  <a href="docs/README.md"><img alt="Docs" src="https://img.shields.io/badge/Docs-1d2128?style=for-the-badge"></a>
  <a href="docs/providers.md"><img alt="Providers" src="https://img.shields.io/badge/Providers-1d2128?style=for-the-badge"></a>
  <a href="CONTRIBUTING.md"><img alt="Contribute" src="https://img.shields.io/badge/Contribute-1d2128?style=for-the-badge"></a>
  <a href="https://github.com/the-hyve-company/design-factory/discussions"><img alt="Discuss" src="https://img.shields.io/badge/Discuss-1d2128?style=for-the-badge"></a>
</p>

---

## What it solves

Most AI design flows start in an empty prompt box.

You describe what you want, get an output, try to fix it in the next
request, and gradually lose context, visual intent, good versions and
control over the final file.

Design Factory organizes that loop in a local project.

Before generating, you set the direction.
During generation, you pick the model.
After the output, you edit, comment, adjust, keep versions and keep
working on real files.

---

## How it works

Design Factory works in three moments.

### 1. Start with direction

A project can begin with:

- canvas and aspect ratio;
- artifact type;
- goal;
- design system;
- references;
- visual constraints;
- quality rules;
- reusable skills and commands.

Instead of asking for "something modern", you declare what modern means
in that project.

### 2. Pick the right model for the step

The provider is not the center of the product.

You can use Claude Code, Codex CLI, Gemini CLI, Opencode, Kimi, BYOK
APIs or local models. The context stays in the project. The model
becomes an execution route.

### 3. Refine without starting over

The first output does not have to be thrown away.

You adjust visual variables, edit text inline, comment on parts of the
result, keep snapshots, compare versions and keep refining the local
file.

The flow is simple:

**context → generation → editing → local version**

---

## What ships in this public preview

Design Factory is early. Some surfaces are stable, some are still
experimental, and the project is being opened so the method can be
tested in public.

| Area | Status | What it does |
| --- | --- | --- |
| Project files | Available | Projects are folders under `projects/` |
| HTML artifact generation | Available | Generate editable HTML outputs from prompts |
| Multi-provider picker | Available | Use CLI agents, BYOK APIs or local providers |
| Design systems | Available | Attach design rules and references to projects |
| Tweaks | Available | Expose CSS variables as sliders and adjust without another LLM call |
| Inline text edit | Available | Edit preview text and write changes to disk |
| Comments / direction loop | Available | Use feedback as structured direction for the next turn |
| Version snapshots | Available | Save and restore manual project states |
| File manager | Available | Inspect and manage project files |
| Embedded terminal | Experimental | Useful for project-level commands; not required for the core loop |
| Provider setup | Available | Detects installed CLIs and stores BYOK API keys only when you choose an API provider |
| Public docs | Available | Quickstart, providers, architecture, smoke runbook, troubleshooting and contributor docs |

---

## Quickstart

There are two ways to run it. Pick based on how much polish you want today.

### ✅ Local (stable — recommended)

This is the proven path — it's what we run every day. Requires **Node 20+** and
at least one provider available.

```bash
git clone https://github.com/the-hyve-company/design-factory.git
cd design-factory
npm install
npm run dev:web
```

Open:

```txt
http://localhost:1420
```

If 1420 is busy, the launcher picks another port automatically and prints the
right URL in the banner. The local daemon runs on `http://localhost:1421`.

### 🧪 Desktop app (experimental — easier, no terminal)

A double-click app with an icon in your taskbar/dock. No terminal, no `npm`.
**It's new and still rough** — expect bugs we're actively fixing.

Download for your OS from the
[Releases page](https://github.com/the-hyve-company/design-factory/releases/latest):

- **Windows:** `Design.Factory_<version>_x64-setup.exe`
- **macOS (Apple Silicon):** `Design.Factory_<version>_aarch64.dmg`

> ⚠️ **The app is not code-signed yet**, so your OS or antivirus *will* warn you
> — and may block it. That's expected for unsigned open-source software: the
> bundled engine is a freshly compiled binary with no reputation yet. The whole
> thing is open source — you can read every line. Code signing is on our roadmap
> and will remove these warnings.

**Windows (SmartScreen):** "Windows protected your PC" → *More info* → *Run
anyway*.

**Windows (antivirus — Kaspersky, Defender, etc.):** some antivirus will
**delete the bundled engine during install** (you'll see an empty install folder
or an "engine not found" error). Pause your antivirus during install **or** add
an exclusion for the install folder (`…\AppData\Local\Programs\Design Factory`)
and the temp folder (`…\AppData\Local\Temp`), then reinstall.

**macOS (Gatekeeper):** right-click the app → *Open* → *Open*. Or System
Settings → Privacy & Security → *Open Anyway*.

If any of this feels like too much friction, use the **Local (stable)** path
above — no warnings there.

### After it opens (either path)

- open **Settings → Providers**;
- if you already have a supported CLI installed and logged in, Design
  Factory detects it and marks the card connected;
- add an API key only if you want to use a BYOK API provider;
- create a project;
- add context, rules or a design system;
- generate an HTML artifact;
- refine with tweaks, comments and edits.

Full walkthrough in [docs/quickstart.md](docs/quickstart.md).

---

## Providers

Design Factory is provider-agnostic by architecture. The app works with
different classes of models:

| Class | Examples | Notes |
| --- | --- | --- |
| CLI agents | Claude Code, Codex CLI, Gemini CLI, Opencode CLI, Kimi Code CLI | Spawned by the local daemon |
| BYOK APIs | Anthropic, OpenAI, Gemini, OpenRouter | Keys stay local |
| Local servers | Ollama | Useful for offline/local experiments |

Provider availability and readiness change quickly. The canonical source
is [docs/providers.md](docs/providers.md).

---

## Token storage

Paid-provider tokens are read locally, from environment variables or
provider config files under:

```txt
~/.config/design-factory/
```

The browser does not access provider secrets directly. The daemon owns
provider execution.

---

## Files and providers

Design Factory is open-source software you run from the repo. The point
is not that it is "local"; it is that the work stays inspectable:

- projects are plain folders under `projects/`;
- generated outputs are HTML/assets you can open or commit;
- CLI providers are discovered from your existing shell setup;
- API keys are optional and only needed for BYOK API providers;
- provider execution goes through the daemon on `localhost`.

That keeps the core workflow simple: use the model you already have
access to, generate a file, inspect it, adjust it, and keep iterating.

---

## Architecture

Design Factory has two main parts.

| Layer | Role |
| --- | --- |
| React app | UI, project flow, preview, settings, design direction, provider picker |
| Node daemon | Filesystem boundary, provider execution, SSE streams, local terminal bridge |

### Core stack

| Layer | Pick |
| --- | --- |
| UI | React 18 + Vite + TypeScript |
| Routing | React Router |
| Validation | Zod |
| Markdown | marked + highlight.js + DOMPurify |
| Terminal | xterm.js |
| Daemon | Node 20 HTTP + SSE |
| Tests | Vitest + Playwright |

### Repository shape

```txt
design-factory/
├── src/              # React app
├── apps/daemon/      # local Node bridge
├── docs/             # public docs
├── skills/           # reusable instruction blocks and commands
├── tests/            # unit + visual tests
└── projects/         # local user work, gitignored
```

For contributor setup and provider details, start with:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/providers.md](docs/providers.md)

---

## Commands

```bash
npm run dev          # Vite only (:1420)
npm run bridge       # Daemon only (:1421)
npm run dev:web      # App + daemon

npm run build        # TypeScript + Vite build
npm run preview      # Serve production build

npm test             # Vitest
npm run test:watch   # Vitest watch
npm run test:ui      # Vitest UI
npm run test:visual  # Playwright visual regression
npm run i18n:audit   # PT-BR ↔ EN coverage audit
```

Recommended gates before opening a PR:

```bash
npx tsc --noEmit
npm test
npm run build
```

---

## Design systems

Design Factory can attach design context to a project so every turn
starts with better constraints.

A design system can include:

- palette;
- typography;
- grid;
- spacing;
- materiality;
- motion rules;
- interaction rules;
- anti-patterns;
- examples and counterexamples.

The goal is to stop asking models for vague qualities like "modern",
"premium" or "clean", and instead declare what those words mean inside
the project.

---

## Tweaks, comments and edits

The post-generation loop is part of the product, not a side feature.

### Tweaks

When an artifact exposes CSS variables, Design Factory can bind them to
sliders. You adjust visual parameters without spending another model
call. For example:

- spacing;
- radius;
- contrast;
- density;
- motion intensity;
- surface depth;
- type scale.

### Comments

Comments turn feedback into direction. Instead of rewriting the whole
prompt, you point at what needs to change and keep the project context
intact.

### Edits

Inline edits handle small changes directly. Not everything needs another
generation.

This is where artistic direction becomes practical: adjust what matters,
preserve what works, and keep the loop moving.

---

## Taste is not a preset

Design Factory does not try to automate visual judgment.

Taste shows up in the choices that go in before generation and the
decisions made after it: references, constraints, design systems,
anti-patterns, comments, edits and preserved versions.

The model generates. The project holds context. You direct.

---

## What this is not

Design Factory is not a Figma replacement, a hosted website builder, a
generic chatbot wrapper, a cloud design platform, a prompt marketplace
or a "make it premium" button. It does not promise to automate taste
away either.

It is an experiment: giving taste, context and direction a stronger
interface inside AI-assisted design.

---

## Contributing

Design Factory is open-source because the method should be inspectable,
forkable and improvable.

We welcome contributions around:

- provider adapters;
- provider workflows;
- design-system ingestion;
- artifact editing;
- visual quality gates;
- documentation;
- examples;
- tests.

Start with:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/providers.md](docs/providers.md)

Before adding a new feature, ask:

- Does it improve direction?
- Does it make output more editable?
- Does it keep provider choice open?
- Does it reduce generic results?

If not, it probably does not belong in the core.

---

## Community

- **Discussions:** use GitHub Discussions for questions, experiments and
  ideas.
- **Issues:** use GitHub Issues for reproducible bugs and scoped feature
  requests.

---

## License

[Apache License 2.0](LICENSE) © The HYVE Company.

Use it, fork it, study it, adapt it under the terms of the
[Apache 2.0 License](LICENSE). Attribution is welcome, not required.
Read the [NOTICE](NOTICE) file before reusing the HYVE or Design Factory
marks: the licence covers code and docs, the brand stays reserved.

---
