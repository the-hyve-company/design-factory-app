# Contributing

Design Factory is a React 18 + Vite web app run on `localhost`. The UI is
TypeScript; a Node daemon (`apps/daemon/src/index.mjs`) exposes a multi-
provider adapter layer (10 LLM backends today) and filesystem access over
HTTP/SSE so the browser can talk to them.

## Dev setup

Requirements:

- Node 20 or newer
- At least one provider CLI (see [README.md](README.md))

```bash
git clone https://github.com/the-hyve-company/design-factory-app.git
cd design-factory-app
npm install
```

## Local dev

```bash
npm run dev:web   # starts daemon (:1421) + Vite (:1420) together
# or run them in separate terminals:
npm run bridge    # @df/daemon — node apps/daemon/src/index.mjs
npm run dev       # vite only
```

Open http://localhost:1420 in your browser. Hot reload is Vite-speed; the
daemon needs a manual restart after edits to `apps/daemon/src/index.mjs`.

## Code organization

```
design-factory/
├── src/                    # React + TypeScript UI
│   ├── screens/            # Top-level routes (Home, Editor, Settings, DsPreview)
│   ├── components/         # Reusable UI (modals, pickers, atoms in dfds/)
│   ├── providers/          # LLM adapters (claude, codex, gemini, anthropic) + registry
│   ├── runtime/            # Prompt invokers, CLI spawner, schema validators, scene/timeline parsers
│   ├── lib/                # claude-bridge (HTTP/SSE client), ds-google parser, BYOK tokens, vercel/gemini/codex/anthropic adapters
│   ├── hooks/              # Custom React hooks
│   ├── data/               # direction-data.ts (formats + directions source of truth)
│   └── styles/             # Tokens + global CSS
├── apps/
│   └── daemon/             # @df/daemon workspace — Node HTTP/SSE server
│       └── src/index.mjs   #   Spawns CLIs, file ops, terminal WS, hyperframes invoker
└── docs/                   # User-facing docs (quickstart, releasing, direction)
```

### Provider adapters

Every LLM provider is split into two halves:

- **Daemon adapter** (`apps/daemon/src/providers/{id}.mjs`) — owns the
  spawn / HTTP fetch, the SSE wire shape, the close-path contract.
  Exports a `ProviderAdapter` (see `apps/daemon/src/providers/types.mjs`)
  with `id`, `label`, `capabilities`, optional `readiness`, plus the
  `stream(req, res, deps)` and `once(req, res, deps)` handlers.
- **Frontend adapter** (`src/providers/{id}.ts`) — thin client that
  posts to the daemon's `/{id}/stream` and `/{id}/once` endpoints. Lives
  behind the same `LLMProvider` interface (`src/providers/types.ts`)
  so the chat UI stays provider-agnostic.

Both halves are wired through their own registries:

- Daemon: `apps/daemon/src/providers/index.mjs` — `PROVIDERS` map; the
  HTTP dispatch loop in `apps/daemon/src/index.mjs` auto-routes any
  `POST /<id>/stream` and `POST /<id>/once` to the matching adapter.
  **Zero edits to the dispatcher when adding a new provider.**
- Frontend: `src/providers/registry.ts` — `PROVIDERS` array + the
  `getProvider` / `probeAllProviders` helpers used by AgentPicker.

#### Adding a new provider

1. **Daemon adapter** — `apps/daemon/src/providers/{id}.mjs`:
   - Import the deps shape (`ProviderDeps` typedef).
   - Declare `id`, `label`, `capabilities` (per `ProviderCapabilities`
     in `types.mjs` — be conservative; `false` is the safe default).
   - Declare `readiness: "stable" | "beta" | "experimental"`. New
     adapters start at `"experimental"` until validated against a real
     account/instance end-to-end.
   - Implement `stream(req, res, deps)` and `once(req, res, deps)`.
     Every close path MUST emit exactly one terminal event:
     `event: done` on success, `event: error` on failure or empty
     completion (the contract test in `providers/contract.test.mjs`
     enforces the empty-completion guard).
   - Use the shared wirers (`wireStreamJson` / `wireCodexJson` /
     `wireGeminiJson`) when your provider speaks one of those wire
     formats; otherwise hand-roll SSE in the adapter, mirroring
     `openrouter.mjs` or `ollama.mjs` for OpenAI-compatible APIs.

2. **Daemon registry** — `apps/daemon/src/providers/index.mjs`:
   - Import the new module and add it to the `PROVIDERS` object.
   - Order matters for `listProviders()` (drives picker order). Group
     CLIs first, then APIs, then local servers.

3. **Frontend adapter** — `src/providers/{id}.ts`:
   - Implement `LLMProvider`: `meta`, `capabilities`, `stream()`,
     `once()`, `status()`. `stream()` / `once()` typically delegate to
     a small bridge module under `src/lib/{id}-bridge.ts` (copy from
     `codex-bridge.ts` for OpenAI-shaped APIs).
   - `meta.id` MUST match the daemon adapter's `id` exactly — that's
     how dispatch + UI agree.

4. **Frontend registry** — `src/providers/registry.ts`:
   - Import and append to the `PROVIDERS` array.
   - Update the `ProviderId` union in `src/providers/types.ts`.

5. **Model list** — `src/providers/model-lists.ts` (when applicable).

6. **Documentation**:
   - Add a row to the capability matrix in `docs/providers.md` with
     accurate readiness and capability flags.
   - Update README.md / README.en.md provider lists if the new
     adapter is `stable` or `beta`. Experimental adapters can stay in
     `docs/providers.md` only until promoted.

7. **Tests**:
   - The contract test in `apps/daemon/src/providers/contract.test.mjs`
     auto-asserts every adapter declares a valid `readiness`.
   - If your adapter has its own SSE close path, add a dedicated test
     mirroring the empty-completion guard pattern.

> **What NOT to do**: do NOT add per-provider HTTP routes to
> `apps/daemon/src/index.mjs`. The dispatcher handles routing
> generically — inline per-provider handlers are not accepted.

## Commits

We follow [Conventional Commits][cc]:

```
feat(providers): add xai grok adapter

Body paragraph explaining the why.
```

Prefixes: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`. Scopes name the
subsystem: `providers`, `chat`, `runtime`, `ds`, `bridge`.

[cc]: https://www.conventionalcommits.org/

## PR workflow

1. Fork and branch from `main`: `feat/your-feature`, `fix/your-bug`, etc.
2. Keep commits small and focused. One commit = one reason to change.
3. Run the gates locally before pushing:
   ```bash
   npx tsc --noEmit
   npm test
   npm run build
   ```
4. Open a PR against `main`. Describe the why, not just the what. Link any
   related issues.
5. For UI changes, include a screenshot or screen recording.
6. Wait for review. Rebase if the branch diverges — we prefer linear
   history to merge commits for this repo.

## Testing

The de-facto gates are:

- **`npx tsc --noEmit`** — TypeScript must compile clean.
- **`npm test`** — Vitest must pass.
- **`npm run build`** — Vite production build must succeed.
- **Smoke manual** — the features you touched, exercised on `localhost:1420`.
  Describe what you ran in the PR.

If you're adding new runtime behavior (a new provider, a new skill hook),
add a vitest under the corresponding `src/**/*.test.ts` so others can
reproduce.

## Where to ask

- **Questions / general discussion:** [GitHub Discussions][discussions]
- **Bugs / feature requests:** [GitHub Issues][issues]
- **Security disclosures:** email the maintainer (see `CODE_OF_CONDUCT.md`).

[discussions]: https://github.com/the-hyve-company/design-factory-app/discussions
[issues]: https://github.com/the-hyve-company/design-factory-app/issues

## Code style

- Absolute imports only (`@/providers/registry`, not `../../providers/registry`).
- No `any` in TypeScript — use `unknown` with type guards, or a proper type.
- No hardcoded colors/spacing/radii in component CSS — use `var(--df-*)`
  tokens from `src/styles/global.css`.
- Comments explain _why_, not _what_. Don't add a comment to a line whose
  intent is already obvious from the code.
- No emojis in source files unless the design explicitly calls for them.

Thanks for helping make Design Factory better.
