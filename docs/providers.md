# Provider Matrix

Design Factory ships with **10 providers**: five CLI agents, four BYOK
HTTP APIs, and one local server. Each provider is a swappable adapter
behind the same SSE protocol.

The provider screen is meant to be low-friction:

- installed and authenticated CLIs are detected automatically;
- missing CLIs show install/auth helper commands;
- API keys are only required for BYOK API providers;
- Ollama only needs a local server and at least one pulled model.

The picker (top-right header) lists every registered provider, greys
out unavailable paths, and badges each row with its release readiness
so you can see the verified path before committing.

## Roster

CLI agents (spawn local binary):

- **Claude Code** — `npm i -g @anthropic-ai/claude-code`
- **Codex CLI** — `npm i -g @openai/codex`
- **Gemini CLI** — `npm i -g @google/gemini-cli`
- **Opencode CLI** — `npm i -g opencode-cli`
- **Kimi Code CLI** — `curl -LsSf https://code.kimi.com/install.sh | bash`

API adapters (BYOK HTTP):

- **Anthropic API** — Claude models direct (`ANTHROPIC_API_KEY`)
- **OpenAI API** — `OPENAI_API_KEY`
- **Gemini API** — `GEMINI_API_KEY`
- **OpenRouter API** — proxy to 200+ models (`OPENROUTER_API_KEY`)

Local server:

- **Ollama** — open-weights models running on `localhost:11434`

Adding a new provider = drop one file in `apps/daemon/src/providers/`
(mjs adapter) + one in `src/providers/` (TS frontend) + register both.
No edits to the dispatch hot path. See `CONTRIBUTING.md` § Provider
adapters.

---

## Capability Matrix

| Provider           | Type  | Readiness    | Streaming |   Tools    |  Sessions  | MCP | Multimodal | File write | Auth              |
| ------------------ | ----- | ------------ | :-------: | :--------: | :--------: | :-: | :--------: | :--------: | ----------------- |
| **Claude Code**    | CLI   | stable       |    yes    |    yes     |    yes     | yes |    yes     |    tool    | `claude login`    |
| **Codex CLI**      | CLI   | beta         |    yes    | yes (Bash) | yes (1.1+) | no  |    yes     |    tool    | `codex login`     |
| **Gemini CLI**     | CLI   | beta         |    yes    |     no     |    yes     | no  |    yes     |  artifact  | `gemini login`    |
| **Opencode CLI**   | CLI   | experimental |    yes    |    yes     |     no     | no  |     no     |    tool    | `opencode auth`   |
| **Kimi Code CLI**  | CLI   | experimental |    yes    |    yes     |     no     | yes |    yes     |    tool    | `kimi` → `/login` |
| **Anthropic API**  | API   | beta         |    yes    |     no     |     no     | no  |    yes     |  artifact  | BYOK token        |
| **OpenAI API**     | API   | beta         |    yes    |     no     |     no     | no  |     no     |  artifact  | BYOK token        |
| **Gemini API**     | API   | beta         |    yes    |     no     |     no     | no  |    yes     |  artifact  | BYOK token        |
| **OpenRouter API** | API   | beta         |    yes    |     no     |     no     | no  |     no     |  artifact  | BYOK token        |
| **Ollama**         | local | beta         |    yes    |     no     |     no     | no  |     no     |  artifact  | none (local)      |

Capabilities are **declarative** in the adapter file (`capabilities`
object on the default export). The runtime and UI read these to decide
what to expose. `false` means unsupported, not "unknown".

### Readiness

- `stable` — reference path. The full capability matrix is exercised
  end-to-end. Chat and the runtime can rely on this adapter without
  caveats.
- `beta` — core stream/once flow validated. Some declared capabilities
  (resume, multimodal, MCP) are untested at scale.
- `experimental` — adapter compiles and emits the contract events but
  is unverified against a live target. Use at your own risk; expect
  rough edges. Treat declared capabilities as aspirational until
  proven.

New adapters default to `experimental` until validated against a real
account or instance end-to-end.

### File-write channel

Two channels:

- `tool` — the provider chains native Write/Edit calls; the runtime
  observes the tool-event stream.
- `artifact` — the provider streams text and ends with one
  `<artifact>` block; the runtime parses it and writes via
  `/fs/write/artifact`.

The runtime picks the channel from the adapter's `capabilities.fileWrite`
field. Agents do not need to detect this themselves — see
[`docs/agent-contract.md`](agent-contract.md) §2.

---

## CLI Setup

### Claude Code

- Install: `npm i -g @anthropic-ai/claude-code`
- Auth: `claude login`
- Env override: `DF_CLAUDE_BIN`

### Codex CLI

- Install: `npm i -g @openai/codex`
- Auth: `codex login` (OpenAI account)
- Env override: `DF_CODEX_BIN`

### Gemini CLI

- Install: `npm i -g @google/gemini-cli`
- Auth: `gemini login` (Google account)
- Env override: `DF_GEMINI_BIN`

### Opencode CLI

- Install: `npm i -g opencode-cli`
- Auth: `opencode auth` (provider-agnostic)
- Env override: `DF_OPENCODE_BIN`

### Kimi Code CLI

- Install: `curl -LsSf https://code.kimi.com/install.sh | bash`
- Auth: run `kimi` interactively once and `/login` (OAuth via browser),
  or set `MOONSHOT_API_KEY` before spawn — the kimi CLI handles auth
  itself, DF does not store the credential.
- Env override: `DF_KIMI_BIN`
- Default model: `kimi-latest` (auto-pick by Moonshot)
- **Tested CLI versions:** `0.2.0 ≤ v < 0.3.0`. The adapter targets the
  0.2.x flag contract (`-p <text>` prompt, `--output-format stream-json`).
  Older `0.1.x` builds use a different CLI surface (`--print`,
  `--input-format`) and will fail with `unknown option '--print'`.
  Newer releases (0.3+) are untested — the daemon surfaces a hint in the
  error message when the detected version is outside this window.
  Upgrade with the install command above.

---

## API Setup (BYOK)

### Anthropic API

- Token sources: `ANTHROPIC_API_KEY` env, or PUT `/config/anthropic`
  to write `~/.config/design-factory/anthropic.json`
- Default model: `claude-sonnet-4-6`

### OpenAI API

- Token sources: `OPENAI_API_KEY` env, or PUT `/config/openai`
- Default model: `gpt-4o-mini`

### Gemini API

- Token sources: `GEMINI_API_KEY` env, or PUT `/config/gemini-api`
- Default model: `gemini-1.5-flash`

### OpenRouter API

- Token sources: `OPENROUTER_API_KEY` env, or PUT `/config/openrouter`
- Default model: `meta-llama/llama-3.3-70b-instruct:free`

---

## Local

### Ollama

- Install: `brew install ollama` then `ollama serve`
- Default endpoint: `http://localhost:11434` (override:
  `DF_OLLAMA_HOST`)
- Pull a model: `ollama pull llama3.3:70b`

**Use an instruct model, not a base/embedding one.** DF talks to Ollama over
`/api/chat`, so the model needs a chat template. Completion-only GGUF imports
and embedding models (`bge-*`, `nomic-embed-*`) have none and bounce with
`"<model>" does not support chat`. DF probes each model via `/api/show` and
greys non-chat models out in the picker. Known-good: `llama3.2`,
`qwen2.5-coder`, `qwen3`, `mistral`, `gemma2`.

**Tuning env (optional):**

| Var                 | Default                             | Effect                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DF_OLLAMA_HOST`    | `127.0.0.1` → `localhost` → `[::1]` | Explicit host:port; skips probing.                                                                                                                                                                                                                                                                                               |
| `DF_OLLAMA_NUM_CTX` | `16384`                             | Context window requested per turn, clamped to the model's max. DF's system-prompt stack (preamble + craft + output contract + current file + history) easily exceeds Ollama's bare 4096 default, which silently truncates the prompt — the model never sees your actual ask. Raise on a roomy GPU; lower if you hit VRAM limits. |
| `DF_OLLAMA_THINK`   | `auto`                              | `auto`/`1` = enable thinking on reasoning models (qwen3, deepseek-r1, gpt-oss); reasoning goes to a separate channel and never leaks into the HTML. `0` = force off (faster, lower quality). No effect on non-reasoning models.                                                                                                  |

**VRAM note for big models.** A 32B model at Q4 plus a 16k context fills a 24GB
GPU (≈22GB weights + KV cache). It still runs, but cold-load + a long thinking
phase can take minutes on the first turn; subsequent turns reuse the loaded
model. If first-token latency is painful, drop `DF_OLLAMA_NUM_CTX`, turn off
thinking (`DF_OLLAMA_THINK=0`), or use a smaller model (e.g. `qwen2.5-coder` 7B/14B).
The chat UI streams, so it surfaces output as it arrives; the non-streaming
`/once` path (used by some auxiliary features) can still hit a ~5-minute client
timeout on very slow turns — prefer streaming generation for large models.

---

## Endpoints

### `GET /providers`

Lists every registered provider with declared capabilities, a runtime
`available` flag (true = installed for CLIs / token present for APIs),
and the readiness badge. The picker uses this as its single source of
truth.

```json
{
  "providers": [
    {
      "id": "claude",
      "label": "Claude Code",
      "capabilities": {},
      "readiness": "stable",
      "available": true,
      "version": "1.0.84"
    },
    {
      "id": "codex",
      "label": "Codex CLI",
      "capabilities": {},
      "readiness": "beta",
      "available": true,
      "version": "1.1.5"
    },
    {
      "id": "kimi",
      "label": "Kimi Code CLI",
      "capabilities": {},
      "readiness": "experimental",
      "available": false
    }
  ]
}
```

### `GET /providers/:id`

Single-provider lookup. 404 on unknown id.

### `POST /:id/stream`

SSE endpoint per provider. Accepts
`{ prompt, systemPrompt?, model?, cwd? }`. Emits
`event: text|usage|error|done` frames.

### `POST /:id/once`

Non-streaming sibling of `/stream`. Returns `{ text }` or
`{ error }`.

---

## Notes

### Anthropic programmatic billing

Anthropic bills programmatic Claude usage separately from
subscription chat. Apps that spawn the `claude` CLI (DF included)
consume a monthly programmatic credit equal to the subscription
value; overage bills at standard API rates.

Since DF is provider-agnostic, switching providers is a one-click
move in the picker: the **Anthropic API** adapter (BYOK
pay-as-you-go), any of the other four CLIs (Codex, Gemini, Opencode,
Kimi), or local Ollama all consume the same compiled direction.

---

## Architecture

Adapter contract: `apps/daemon/src/providers/types.mjs` (JSDoc typedef).

Dispatch loop: `apps/daemon/src/index.mjs` auto-routes any
`POST /<id>/stream` and `POST /<id>/once` to the matching adapter.
Adding a new provider requires zero edits to the dispatcher.

Frontend mirror: `src/providers/registry.ts` registers per-provider
TypeScript modules that hit the daemon endpoints via
`src/lib/provider-bridge-factory.ts` (generic SSE bridge) or
hand-written bridges for providers with non-canonical wire formats
(claude-stream-json, codex JSONL, gemini structured).
