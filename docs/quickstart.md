# Quickstart

From clone to first generated design in about five minutes.

## Requirements

- Node 20+
- At least one provider available — pick any of the 5 CLIs (Claude
  Code, Codex CLI, Gemini CLI, Opencode CLI, Kimi Code CLI), the 4
  BYOK APIs (Anthropic, OpenAI, Gemini, OpenRouter), or local Ollama

## Install

```bash
git clone https://github.com/the-hyve-company/design-factory-app.git
cd design-factory-app
npm install
```

## Run

```bash
npm run dev:web   # starts the daemon (:1421) + Vite (:1420) together
```

Open `http://localhost:1420`.

If you'd rather run the two halves in separate terminals:

```bash
npm run bridge    # @df/daemon — node apps/daemon/src/index.mjs
npm run dev       # vite only
```

## First provider setup

You need at least one provider connected. The app will run with zero
installed, but every prompt will error until one is reachable. Pick
whichever matches how you already pay for (or run) an LLM:

```bash
# Claude Code (Max plan, OAuth)
npm i -g @anthropic-ai/claude-code
claude /login

# Codex CLI (ChatGPT Plus / Pro / Team, OAuth)
npm i -g @openai/codex
codex login

# Gemini CLI (free tier: 60 rpm, 1000 rpd, Flash only)
npm i -g @google/gemini-cli
gemini            # interactive — pick "Sign in with Google"

# Opencode CLI (provider-agnostic)
npm i -g opencode-cli
opencode auth     # interactive — pick a provider

# Kimi Code CLI (OAuth via Moonshot, or MOONSHOT_API_KEY env)
curl -LsSf https://code.kimi.com/install.sh | bash
kimi              # interactive once — /login → OAuth via browser

# Ollama (local, no account)
# https://ollama.com/download
ollama pull llama3.2
```

Open **Settings → Providers** in the app:

- For **CLIs**, Design Factory checks your PATH and auth state. If
  Claude Code, Codex CLI, Gemini CLI, Opencode CLI, or Kimi Code CLI
  is installed and logged in, the card marks it as connected. If not,
  the card shows the exact command to install or authenticate it.
- For **BYOK APIs** (Anthropic, OpenAI, Gemini, OpenRouter), paste a
  key only if you want to use that API path. You do not need an API key
  when you are using an already-authenticated CLI. Keys persist to
  `~/.config/design-factory/{provider}.json` with `chmod 600`.
- For **Ollama**, start the local server and pull a model. No app key
  is required.

## First project

1. Home screen → **New project** (top-right).
2. Name it anything.
3. Pick a **mode**: `prototype` (live HTML, default), `slide` (deck
   layout), or `template` (reusable scaffold with inline comments).
4. Pick a **provider**. The default comes from Settings > Providers.
5. Type an initial prompt in the bottom field — a one-liner is enough.
6. Hit **Create**. The editor opens with your prompt already sent.

## Where files are written

```
projects/{slug}/
├── {slug}.html          ← the entry file the iframe renders
├── tab-1-foo.html       ← optional secondary tabs
├── assets/              ← images, fonts, anything the HTML imports
└── .df/                 ← app-managed metadata (do not edit by hand)
    ├── meta.json
    ├── chat.jsonl
    └── versions/{vid}.json
```

`projects/` lives at the repo root and is gitignored — your work is
yours.

## Chat basics

The chat pane on the left is a regular thread; the iframe on the right
is live and updates every time the model sends back an HTML document.

- **Enter** sends. **Shift+Enter** inserts a newline.
- Typing **`/`** opens the skills menu. Arrow up/down navigates,
  Enter inserts the highlighted command into the prompt (it does
  not send). Press Enter again to send, or keep typing to add args
  before sending. Tab inserts with a trailing space for args.
- The model selector in the prompt box filters to models your current
  provider supports. Switching providers remembers your last-picked
  model per provider.

## Common errors

- **"Provider not connected"** — open Settings > Providers, copy the
  helper command, run it in your terminal.
- **"Could not read .../design.md"** — re-import the design system.
- **Ollama "no models pulled"** — run `ollama pull llama3.2` (or any
  other model), then click **Refresh** in the model picker.
- **Claude / Codex prompt returns empty** — run `claude /status` or
  `codex login status`; OAuth sessions time out.

More cases: [docs/troubleshooting.md](troubleshooting.md).

## Keyboard shortcuts

| Action                       | Shortcut                        |
| ---------------------------- | ------------------------------- |
| Send prompt                  | `Enter`                         |
| Newline in prompt            | `Shift+Enter`                   |
| Open skills menu             | `/` at start of prompt          |
| Toggle tweaks panel collapse | `Esc` (inside the iframe)       |
| Open settings                | Click the gear icon (top-right) |
| Close modal                  | `Esc`                           |

## Next

- Read [CONTRIBUTING.md](../CONTRIBUTING.md) if you want to hack on the
  app itself.
- Browse `skills/` for examples of skills you can adapt.
- File issues and feature requests on
  [GitHub](https://github.com/the-hyve-company/design-factory-app/issues).
