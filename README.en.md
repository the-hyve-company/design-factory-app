<p align="right">
  <a href="README.md"><img alt="Português" src="https://img.shields.io/badge/lang-Portugu%C3%AAs-green.svg"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/readme/assets/df-cover.png" alt="Design Factory" width="100%">
</p>

# Design Factory

HYVE's first open-source project.

<p>
  <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"></a>
  <a href="package.json"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg"></a>
  <a href="docs/providers.md"><img alt="Multi-provider" src="https://img.shields.io/badge/providers-multi--model-ff5524.svg"></a>
</p>

An open experiment offering a local workspace that makes context, direction,
and taste more operable inside AI-assisted design. An open-source alternative
to Claude Design and other closed AI-assisted design applications.

---

## What ships in this version

| Area                                                   | State        |
| ------------------------------------------------------ | ------------ |
| Configuration of formats, rules, commands, and prompts | stable       |
| Generation of editable HTML artifacts                  | stable       |
| Design-system ingestion and preview                    | stable       |
| Skill creation and import                              | stable       |
| Tweaks via CSS variables                               | stable       |
| Inline text editing and component property edits       | stable       |
| Comments as structured direction                       | stable       |
| Version snapshots and file manager                     | stable       |
| Public documentation                                   | stable       |
| Embedded terminal                                      | experimental |

---

## Providers

You can mix any combination inside the same project. Tokens live in
`~/.config/design-factory/` or your environment — the browser never touches
provider secrets; the daemon runs them. Canonical source:
[docs/providers.md](docs/providers.md).

| Class        | Providers                                      | Notes                                     |
| ------------ | ---------------------------------------------- | ----------------------------------------- |
| CLI agents   | Claude Code · Codex · Gemini · Opencode · Kimi | the local daemon spawns the logged-in CLI |
| BYOK APIs    | Anthropic · OpenAI · Gemini · OpenRouter       | keys stay local                           |
| Local server | Ollama                                         | offline                                   |

---

## Get started

First, install **Node.js** (version 20 or newer) — the engine that runs the app.
Download it from [nodejs.org](https://nodejs.org/) and click the big **LTS** button.
Open the downloaded file and click through to install.

You also need at least one AI CLI (such as Claude Code) or an API key — that's
what generates the designs.

With Node installed, open a terminal and run:

```bash
npm create design-factory
```

The command downloads the project, installs dependencies and opens the app at
`http://localhost:1420`. If the port is busy, it picks another and prints the URL.

<details>
<summary>Plan B (manual install)</summary>

If `npm create design-factory` fails, install [Git](https://git-scm.com/downloads)
as well and run:

```bash
git clone https://github.com/the-hyve-company/design-factory-app.git
cd design-factory-app
npm install
npm run dev:web
```

</details>

### Day to day (once installed)

**Open Design Factory:**

```bash
npm run dev:web
```

**Update to the latest version:**

```bash
git fetch origin && git reset --hard origin/main && npm install
```

After opening, go to Settings → Providers. CLIs you're already logged into show
as connected; BYOK keys are optional. Create a project, add context, generate,
and refine with tweaks, comments, and edits. Step-by-step in
[docs/quickstart.md](docs/quickstart.md).

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
license covers code and docs, the mark stays reserved.
