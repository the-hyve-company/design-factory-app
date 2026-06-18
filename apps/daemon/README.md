# @df/daemon

Local HTTP/SSE server that exposes CLI agents and filesystem operations to the
browser UI. Runs on `localhost:1421`.

## Endpoints

- `GET /ping` — health check
- `GET /healthz` — readiness probe (used by `dev:web` startup)
- `POST /{provider}/stream` — spawn the provider and stream output (SSE).
  Providers: claude, codex, gemini, opencode, kimi, anthropic, openai,
  gemini-api, openrouter, ollama (auto-routed via the registry)
- `POST /{provider}/once` — one-shot completion, return final string
- `POST /fs/*` — filesystem ops (read, write, list, etc.)
- `POST /git/*` — git ops (snapshot, log, etc.)
- `POST /gh/*` — GitHub OAuth + repo ops
- `POST /hyperframes/render` — spawn `hyperframes` for video export
- `WS /terminal` — pty for the in-app terminal

## Run standalone

```bash
node src/index.mjs
```

Or from the repo root:

```bash
npm run bridge          # alias for `npm start -w @df/daemon`
npm run dev:web         # daemon + vite together
```

## Architecture

Single file (`src/index.mjs`) — Node `http` + `ws`. Lazy-imports heavy
optional deps (`node-pty`, `puppeteer`, `hyperframes`) only when the
matching endpoint fires, so the daemon starts fast even if a native
build failed.

## Future

Possible refactors (not yet scheduled):

- Convert to TypeScript with an esbuild build step
- Split the single file into `routes/`, `providers/`, `fs/`, `git/`, `gh/` modules

The multi-provider adapter layer already ships — non-Claude CLIs and APIs
(Codex, Gemini, Opencode, Kimi, Anthropic, OpenAI, OpenRouter, Ollama)
plug in through the provider registry in `src/providers/`.
