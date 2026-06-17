# Troubleshooting

Common failures and how to recover. If your case isn't here, file an
[issue](https://github.com/the-hyve-company/design-factory-app/issues)
with the steps you took, the provider you were using, and any error
text from the app or the daemon log.

---

## Daemon

### The app loads but every prompt errors

The Node daemon isn't running. `npm run dev:web` should start both the
daemon and Vite together. If you're running them separately, make sure
`npm run bridge` is up before you send a prompt.

Verify with:

```bash
curl -i http://localhost:1421/healthz
```

A 200 response means the daemon is reachable. Anything else, restart
it.

### Port 1421 is busy

Something else is bound to the daemon's port. Find what's there:

```bash
lsof -i :1421
```

Stop the offending process, or set a different port for the daemon
via `DF_BRIDGE_PORT=1422 npm run bridge` and update the frontend in
`src/lib/claude-bridge.ts` if you customise the URL there.

### Port 1420 is busy

`npm run dev:web` resolves this automatically: if 1420 (web) or 1421 (daemon)
is taken, it picks the next free port for each and prints the real URL in the
banner (**▸ Abra:**). Just open whatever it shows — the daemon's CORS and the
origin guard follow the chosen port. To force a specific web port directly:

```bash
npm run dev -- --port 1430
```

**Leftover processes after closing the window:** always stop the dev server
with `q` or `Ctrl+C` (not by closing the window with the X) — on Windows a
window close can't be caught, so the daemon and Vite keep running and hold
their ports. As a safety net the daemon self-exits after ~5 min idle
(`DF_IDLE_SHUTDOWN_MS`, set to `0` to disable), so orphans clear on their own.

---

## Providers

### "Provider not connected" or "needs-auth"

Open **Settings > Providers**. Each card shows a status pill and a
helper command. Copy the command and run it in your terminal, then
hit **Refresh** on the card.

### CLI installed but the app says "not-installed"

The daemon spawns the CLI by name (e.g. `claude`, `codex`,
`gemini`). If the binary isn't on the PATH visible to the daemon
process, it won't be detected even if it's on your shell PATH.

Either:

- Add the binary to your shell's default PATH and restart the
  terminal, then re-run `npm run dev:web`.
- Or set the explicit path via the matching env var (see
  [docs/providers.md](providers.md) → "CLI Setup" for the
  `DF_*_BIN` variable per provider).

### CLI authenticates but prompts return empty

OAuth sessions for Claude Code, Codex, and Gemini CLI time out. Run
the provider's status command:

```bash
claude /status
codex login status
gemini  # interactive; check the active account
```

If the session has expired, re-authenticate via the helper command in
**Settings > Providers**.

### BYOK API token rejected

Confirm the env var is reaching the daemon process — env vars set in
your shell aren't automatically inherited by an already-running
daemon. Stop and restart `npm run dev:web` after setting any new env.

For tokens stored on disk:

```bash
ls -l ~/.config/design-factory/
```

Files should be `chmod 600`. If a write went through but the app still
rejects the token, the file may be malformed JSON — open it and check.

### Where does the config dir live?

The canonical location is `~/.config/design-factory/` (XDG-compliant).
Earlier builds used `~/.design-factory/`; the daemon migrates legacy
content automatically on first run if the canonical dir is empty. You
will see a one-line log when migration happens:

```
[config-dir] migrated N item(s) from .../.design-factory to .../.config/design-factory
```

To use a different location (service deployments, multi-user setups),
set `DF_CONFIG_DIR` before starting the daemon:

```bash
DF_CONFIG_DIR=/path/to/shared/config npm run dev:web
```

### Ollama says "no models pulled"

```bash
ollama pull llama3.2
```

Then click **Refresh** in the model picker. Ollama's HTTP server has
to be running too:

```bash
ollama serve
```

(macOS users typically have a launchd agent that starts it
automatically; Linux users may need to start it manually.)

### Ollama: "<model> does not support chat"

The selected model has no chat template — it's a completion-only GGUF
import or an embedding model (`bge-*`, `nomic-embed-*`). DF talks to
Ollama over `/api/chat`, which those can't serve. The picker greys
non-chat models out; pick an instruct model instead:

```bash
ollama pull llama3.2        # or qwen2.5-coder, qwen3, mistral, gemma2
```

### Ollama result ignores half the prompt / generic template

Symptom: you asked for something specific, the model returned a bland
generic page that misses the request and ignores the current file.

Cause: Ollama's default context window is **4096 tokens**, and DF's
system-prompt stack alone can exceed that — Ollama then silently
truncates, dropping the current file and part of your message before
the model reads them. DF requests a larger window by default
(`DF_OLLAMA_NUM_CTX`, 16384), so make sure you're on a current build.
On a roomy GPU you can raise it:

```bash
DF_OLLAMA_NUM_CTX=32768 npm run dev:web
```

### Ollama reasoning text leaks into the HTML

Reasoning models (qwen3, deepseek-r1, gpt-oss) can spill chain-of-thought
into the output. DF enables Ollama's native `think` channel so reasoning
is kept separate from the answer. If you still see it (or want faster,
non-reasoning generation), disable thinking:

```bash
DF_OLLAMA_THINK=0 npm run dev:web
```

### Ollama: "unreachable" mid-turn on a big model

A large model (e.g. 32B with thinking) can take minutes to cold-load
and emit its first token. The streaming chat path handles this; the
non-streaming `/once` path (some auxiliary features) can abort after
~5 minutes with a bogus "unreachable" even though the server is fine.
Warm the model first (one quick prompt), lower `DF_OLLAMA_NUM_CTX`,
turn off thinking, or use a smaller model.

---

## Artifacts and writes

### "Artifact not written" or empty file

The provider returned text but it didn't satisfy the artifact
contract — either the first non-whitespace character of the file
didn't match the extension, or the response had multiple `<artifact>`
blocks (the runtime rejects multi-artifact turns).

Open the chat error bubble — the daemon's diagnostic is included.
Common causes:

- The model emitted prose with no code. Re-prompt asking for the
  document.
- The model wrote a code fence inside chat instead of a Write call or
  `<artifact>` block. Switch providers, or re-prompt explicitly:
  "write the file directly".

### Writes outside `projects/<slug>/` rejected

The daemon scopes every write under `projects/<slug>/` via
`assertPathInScope`. Path traversal attempts return `PATH_INVALID`.
This is intentional. If a model is trying to write to your home
directory or a system path, the daemon will refuse.

---

## Strict sandbox caveat

The preview iframe defaults to **permissive** sandbox
(`allow-scripts allow-same-origin`) because four DOM-coupled features
need same-origin access:

- Inline text edit
- Comment-mode click handler
- In-place patch DOM mutation
- The animated-scene transport bridge

Opt into strict sandbox via:

```
http://localhost:1420/?strictSandbox=1
```

or

```js
localStorage.setItem("DF_STRICT_SANDBOX", "1");
```

Strict mode disables the four features above. See
[SECURITY.md](../SECURITY.md) → "Iframe sandbox model" for the full
threat model.

---

## Build and tests

### `npx tsc --noEmit` fails

The TypeScript compiler is the first gate. If a fresh clone doesn't
typecheck, you're either on a non-Node-20 toolchain or `npm install`
didn't fully resolve. Try:

```bash
node --version       # must be >= 20
rm -rf node_modules
npm ci
npx tsc --noEmit
```

### `npm test` fails on a clean clone

Same reset path, then:

```bash
npm test
```

If a specific test still fails, file an issue with the failing test
name and the output — that's a regression, not an environment
problem.

### `npm run build` fails

Vite's production build is stricter than dev. Common causes:

- A new module isn't tree-shakeable. Vite will surface the import
  chain.
- A type-only import was used in a value position. Switch to
  `import type` if appropriate.

Open an issue with the full Vite error if you hit something opaque.

---

## When all else fails

The daemon log is the source of truth. Every spawn, FS write, and SSE
frame is traced with `[<scope>] <event>`. Run:

```bash
npm run bridge 2>&1 | tee daemon.log
```

Reproduce the failure, then attach the relevant slice of `daemon.log`
to your issue.
