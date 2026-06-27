// Kimi Code CLI adapter — Moonshot AI's kimi-cli spawned in print mode
// (`kimi --print`), the canonical headless flow documented at
// moonshotai.github.io/kimi-cli/en/customization/print-mode.html.
//
// We pipe the prompt via stdin (input-format: text) and parse the
// JSONL output (output-format: stream-json). Tool calls are
// auto-approved with `-y` so the agent doesn't block on confirmations
// in headless contexts. The first kimi run must complete `/login`
// interactively (OAuth flow); after that, this adapter speaks to the
// authenticated CLI directly.
//
// Auth (handled by the CLI itself, not by DF):
//   - `kimi` interactive once → `/login` → OAuth via browser, OR
//   - `MOONSHOT_API_KEY` env var (handled by kimi CLI internally)
//
// Capabilities: streaming, tools (Edit/Write/Bash via kimi-cli's
// native tool layer). fileWrite="tool" — the runtime observes write
// events from the JSONL stream, no <artifact> parsing needed.
//
// @file providers/kimi.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectKimiVersion, kimiVersionHint } from "./kimi-compat.mjs";
import { sanitizedSpawnEnv } from "../env-blocklist.mjs";

const KIMI_BIN_ENV = "DF_KIMI_BIN";

// Probe the installed kimi version on first error, cache, decorate
// future error messages. Cheap (3s timeout, runs once, fire-and-forget on
// the happy path). Awaited inside the error handlers so the hint shows up
// in the first failing turn, not the second.
async function buildKimiErrorPrefix(bin) {
  try {
    const v = await detectKimiVersion(bin);
    const hint = kimiVersionHint(v);
    return hint ? `${hint}\n` : "";
  } catch {
    return "";
  }
}

function resolveBin() {
  return process.env[KIMI_BIN_ENV] || "kimi";
}

// BUG-23: kimi-code 0.2.0 only accepts the prompt as a `-p <arg>` (no stdin
// prompt mode). On Windows the `kimi` shim is a .cmd, so spawning it needs
// shell:true — but cmd.exe then re-splits the multi-word/multi-line prompt
// arg ("say only the word PONG" → 4 args → "too many arguments"). To pass
// argv intact we bypass the .cmd shim and run kimi's real ESM entry through
// node directly (shell:false → Node hands each arg to the child verbatim).
// Falls back to the plain binary (shell on win32) if the entry isn't found
// or DF_KIMI_BIN was overridden.
function resolveKimiSpawn() {
  if (process.platform === "win32" && !process.env[KIMI_BIN_ENV]) {
    const entry = join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "@moonshot-ai",
      "kimi-code",
      "dist",
      "main.mjs",
    );
    if (existsSync(entry)) {
      return { cmd: process.execPath, pre: [entry], useShell: false };
    }
  }
  return { cmd: resolveBin(), pre: [], useShell: process.platform === "win32" };
}

// BUG-23: kimi-code 0.2.0 rewrote the CLI. The old print-mode flags
// (`--print`, `--input-format`, `-w`, and combining `-y` with prompt mode)
// now error: "unknown option '--print'" / "Cannot combine --prompt with
// --yolo". The 0.2.0 contract:
//   -p, --prompt <text>        run one prompt non-interactively (prompt is an
//                              ARG, not stdin; NOT compatible with -y)
//   --output-format stream-json   JSONL events (text comes as {"role":"assistant",
//                              "content":"…"} — a string, which the parser's
//                              string-content fallback already handles)
//   -m, --model <model>        model alias
//   -S/-r <id>                 resume a session
//   cwd                        passed via spawn opts, not a flag
// Prompt mode auto-runs tools without the -y approval gate.
function buildArgs({ model, prompt, sessionId, streamJson }) {
  const args = [];
  if (sessionId && typeof sessionId === "string" && sessionId.length > 0) {
    args.push("-r", sessionId);
  }
  args.push("-p", prompt);
  args.push("--output-format", streamJson ? "stream-json" : "text");
  // BUG-24: only forward a Kimi/Moonshot model alias. When the user switches
  // provider to Kimi without the model picker resetting, a foreign model
  // (e.g. Claude's "opus", Codex's "gpt-5") leaks through. kimi-code 0.2.0
  // hard-fails any model not declared in its config.toml:
  //   config.invalid: Model "opus" is not configured in config.toml
  // Passing an unknown -m therefore CRASHES the whole turn. Drop it and let
  // kimi use its configured default_model instead (verified: no -m streams
  // fine). The frontend should also reset the model on provider change, but
  // this daemon guard makes a stray foreign model non-fatal regardless.
  if (model && model !== "default" && /^(kimi|moonshot)/i.test(model)) {
    args.push("-m", model);
  }
  return args;
}

function composePrompt(systemPrompt, prompt) {
  // Kimi has no --system-prompt flag. Inject inline like codex does.
  if (systemPrompt) {
    return `${systemPrompt}\n\n---\n\n${prompt}`;
  }
  return prompt;
}

/** @type {import("./types.mjs").ProviderAdapter} */
const kimi = {
  id: "kimi",
  label: "Kimi Code CLI",
  // experimental until validated end-to-end against a logged-in kimi
  // install. The adapter spawn + JSONL parse path is mature in pattern
  // (mirrors codex/claude), but no CI smoke against a real account yet.
  readiness: "experimental",
  capabilities: {
    streaming: true,
    tools: true,
    multimodal: false,
    sessions: false,
    mcp: false,
    // kimi-cli executes Edit/Write/Bash via native tool layer.
    // Runtime observes tool events from the stream-json output —
    // no <artifact> contract needed.
    fileWrite: "tool",
  },

  async stream(req, res, deps) {
    const { readJson } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd, sessionId } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const kspawn = resolveKimiSpawn();
    const fullPrompt = composePrompt(systemPrompt, prompt);
    // kimi-code 0.2.0 takes the prompt as a -p ARG (no stdin prompt mode).
    const args = [
      ...kspawn.pre,
      ...buildArgs({ model, prompt: fullPrompt, sessionId, streamJson: true }),
    ];

    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `kimi → ${model || "default"}` })}\n\n`,
    );
    // F-fix: emit canonical meta event so the chat footer (F1.1) shows
    // the real model name, not the literal "default" the picker passed.
    res.write(
      `event: meta\ndata: ${JSON.stringify({ model: model && model !== "default" ? model : "kimi-default" })}\n\n`,
    );

    const turnStartedAt = Date.now();
    let child;
    try {
      child = spawn(kspawn.cmd, args, {
        cwd: cwd && typeof cwd === "string" ? cwd : process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: kspawn.useShell,
        env: sanitizedSpawnEnv("kimi"),
      });
    } catch (err) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `failed to spawn kimi: ${String(err?.message || err)}` })}\n\n`,
      );
      res.end();
      return;
    }

    // kimi-code 0.2.0 reads the prompt from the -p arg (set in buildArgs),
    // not stdin. Close stdin immediately so the CLI doesn't wait on input.
    try {
      child.stdin.end();
    } catch {}

    req.on("close", () => {
      try {
        child.kill("SIGTERM");
      } catch {}
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let full = "";
    let usage = null;
    let closedTerminal = false;

    // kimi always prints `To resume this session: kimi -r <uuid>` to
    // stderr at the end of every run — success OR failure. Stripping
    // it before surfacing stderr to the UI keeps real error messages
    // legible and removes the noisy hint that was leaking into the
    // assistant bubble as "Algo deu errado / To resume this session…".
    const RESUME_HINT_RX = /\n*\s*To resume this session:\s*kimi\s+-r\s+[a-f0-9-]+\s*$/i;
    function cleanStderr(raw) {
      return raw.replace(RESUME_HINT_RX, "").trim();
    }

    function emitDone() {
      if (closedTerminal) return;
      closedTerminal = true;
      if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      // F-fix: emit result with wall-clock duration so the F1.1 footer
      // can render `X.Xs` next to the token counts. Kimi doesn't expose
      // a cost figure (OAuth account, included in subscription), so
      // costUsd is omitted intentionally.
      res.write(
        `event: result\ndata: ${JSON.stringify({ durationMs: Date.now() - turnStartedAt })}\n\n`,
      );
      if (full) {
        res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
      } else {
        // Observed: kimi sometimes produces no output at all.
        // Surface BOTH the friendly message and a short stdout
        // breadcrumb so the next repro shows what the CLI emitted
        // before going silent. Resume-hint already stripped above.
        const stdoutTail = stdoutBuf.trim().slice(0, 300);
        const stderrTail = cleanStderr(stderrBuf).slice(0, 300);
        const breadcrumb = stdoutTail || stderrTail || "no output captured";
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "warn", message: `kimi closed without text. tail: ${breadcrumb.replace(/\n/g, " ⏎ ")}` })}\n\n`,
        );
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: stderrTail || "kimi completed without text or artifact" })}\n\n`,
        );
      }
      res.end();
    }

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        // kimi emits a trailing INFO line `To resume this session:
        // kimi -r <uuid>` on stderr most of the time, but a stray copy
        // on stdout will arrive as non-JSON — drop quietly.
        if (!line.startsWith("{")) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        // Real-world shape (verified against kimi-cli 1.41.0 on 2026-05-15):
        //   {"role":"assistant","content":[
        //     {"type":"think","think":"...","encrypted":null},
        //     {"type":"text","text":"..."},
        //     {"type":"tool_use","id":"...","name":"...","input":{...}},
        //     {"type":"tool_result","tool_use_id":"...","content":"..."}
        //   ]}
        //
        // Earlier (incorrect) parser assumed `content` was a string —
        // it never matched, the run looked silent, and the daemon
        // fired the empty-completion error path even though kimi had
        // returned a real response. Fixed to walk the block array.
        if (evt.role === "assistant" && Array.isArray(evt.content)) {
          for (const block of evt.content) {
            if (!block || typeof block !== "object") continue;
            if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
              full += block.text;
              res.write(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`);
            }
            // "think" blocks are kimi's internal reasoning trace. Not
            // shipped to the chat UI to keep the user-facing reply
            // tight; can promote to a separate event later if we want
            // to render thinking traces.
            // Schema variant A (the one this branch was originally
            // written for): tool blocks inline in `content` array.
            if (block.type === "tool_use") {
              res.write(
                `event: tool_call\ndata: ${JSON.stringify({
                  provider: "kimi",
                  id: block.id ?? null,
                  name: block.name ?? "tool",
                  input: block.input ?? null,
                })}\n\n`,
              );
            }
            if (block.type === "tool_result" && block.tool_use_id) {
              res.write(
                `event: tool_result\ndata: ${JSON.stringify({
                  provider: "kimi",
                  id: block.tool_use_id,
                  content: block.content ?? null,
                })}\n\n`,
              );
            }
          }
        }
        // Schema variant B (verified against kimi-cli 1.41.0 on 2026-05-18):
        // tool calls live in a top-level `tool_calls` array, sibling of
        // `content`, with `function.name` + `function.arguments` (stringified
        // JSON). Without this branch the daemon was dropping every kimi
        // WriteFile silently — file landed on disk, UI never saw the event,
        // iframe stayed empty until manual reload.
        if (evt.role === "assistant" && Array.isArray(evt.tool_calls)) {
          for (const call of evt.tool_calls) {
            if (!call || typeof call !== "object") continue;
            const fn = call.function ?? {};
            const fnName = typeof fn.name === "string" ? fn.name : "tool";
            // Translate kimi's tool names to the UI's canonical Write/Edit/Bash
            // vocabulary so onToolResult's iframe-reload path fires correctly.
            const toolName =
              fnName === "WriteFile"
                ? "Write"
                : fnName === "EditFile" || fnName === "ReplaceInFile"
                  ? "Edit"
                  : fnName === "ReadFile"
                    ? "Read"
                    : fnName === "Bash" || fnName === "Shell"
                      ? "Bash"
                      : fnName === "DeleteFile"
                        ? "Delete"
                        : fnName;
            let input = null;
            if (typeof fn.arguments === "string") {
              try {
                input = JSON.parse(fn.arguments);
              } catch {
                input = { _raw: fn.arguments };
              }
            } else if (fn.arguments && typeof fn.arguments === "object") {
              input = fn.arguments;
            }
            // Normalise param keys: kimi uses `path`; UI expects `file_path`.
            if (
              input &&
              typeof input === "object" &&
              typeof input.path === "string" &&
              !input.file_path
            ) {
              input.file_path = input.path;
            }
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                provider: "kimi",
                id: call.id ?? null,
                name: toolName,
                input,
              })}\n\n`,
            );
          }
        }
        // Schema variant B continued: tool results come as top-level
        // `{"role":"tool","content":"...","tool_call_id":"..."}` events.
        if (evt.role === "tool" && typeof evt.tool_call_id === "string") {
          const isError = typeof evt.content === "string" && /^Error/i.test(evt.content);
          res.write(
            `event: tool_result\ndata: ${JSON.stringify({
              provider: "kimi",
              id: evt.tool_call_id,
              isError,
              content: typeof evt.content === "string" ? evt.content : "",
            })}\n\n`,
          );
        }
        // Fallback for legacy/string content shape (just in case).
        if (evt.role === "assistant" && typeof evt.content === "string" && evt.content.length > 0) {
          full += evt.content;
          res.write(`event: text\ndata: ${JSON.stringify({ content: evt.content })}\n\n`);
        }
        if (evt.usage) {
          // F-fix: emit camelCase shape the frontend parser expects.
          // Kimi's stream-json mirrors OpenAI's snake_case usage block;
          // translate at the daemon edge so every downstream surface
          // (status banner, F1.1 footer) reads the same field names
          // regardless of provider.
          usage = {
            inputTokens: evt.usage.prompt_tokens ?? 0,
            outputTokens: evt.usage.completion_tokens ?? 0,
          };
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });

    child.on("close", async (code) => {
      // kimi exit codes: 0 ok, 1 permanent fail, 75 transient (retry).
      if (code === 0 || code === null) {
        emitDone();
        return;
      }
      if (closedTerminal) return;
      closedTerminal = true;
      // Strip the resume-hint and any ANSI noise so the actual error
      // message from kimi shows up — not the friendly tail Moonshot
      // appends to every run.
      const cleaned = cleanStderr(stderrBuf).slice(0, 500);
      const stdoutTail = stdoutBuf.trim().slice(0, 200);
      const codeLabel = code === 75 ? "transient (retry suggested)" : `code ${code}`;
      const baseError = cleaned || stdoutTail || `kimi exited ${codeLabel}`;
      const prefix = await buildKimiErrorPrefix(kspawn.cmd);
      const errorText = prefix + baseError;
      res.write(
        `event: log\ndata: ${JSON.stringify({ level: "warn", message: `kimi exit ${codeLabel}. stderr: ${cleaned.replace(/\n/g, " ⏎ ").slice(0, 240) || "(empty)"}` })}\n\n`,
      );
      res.write(`event: error\ndata: ${JSON.stringify({ error: errorText })}\n\n`);
      res.end();
    });

    child.on("error", async (err) => {
      if (closedTerminal) return;
      closedTerminal = true;
      const prefix = await buildKimiErrorPrefix(kspawn.cmd);
      const errorText = `${prefix}kimi spawn error: ${String(err?.message || err)}`;
      res.write(`event: error\ndata: ${JSON.stringify({ error: errorText })}\n\n`);
      res.end();
    });
  },

  async once(req, res, deps) {
    const { readJson } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd, noWorkspace } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }

    const kspawn = resolveKimiSpawn();
    const fullPrompt = composePrompt(systemPrompt, prompt);
    // BUG-23: kimi-code 0.2.0 flags — prompt as -p arg, text output, no -y.
    // (`--quiet`/`-w`/stdin were the old kimi-cli contract; gone in 0.2.0.)
    const args = [...kspawn.pre, "-p", fullPrompt, "--output-format", "text"];
    // BUG-24: only forward Kimi/Moonshot model aliases (see buildArgs).
    if (model && model !== "default" && /^(kimi|moonshot)/i.test(model)) args.push("-m", model);

    let child;
    try {
      child = spawn(kspawn.cmd, args, {
        cwd: cwd && typeof cwd === "string" ? cwd : process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: kspawn.useShell,
        env: sanitizedSpawnEnv("kimi"),
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `failed to spawn kimi: ${String(err?.message || err)}` }));
      return;
    }
    try {
      child.stdin.end();
    } catch {}

    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c.toString("utf8");
    });
    child.stderr.on("data", (c) => {
      err += c.toString("utf8");
    });
    child.on("close", async (code) => {
      if (code === 0 && out.trim()) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: out.trim() }));
      } else {
        // Strip kimi's friendly resume hint from stderr — see stream()
        // for the same pattern. Keeps the error message readable.
        const RESUME_HINT_RX = /\n*\s*To resume this session:\s*kimi\s+-r\s+[a-f0-9-]+\s*$/i;
        const cleaned = err.replace(RESUME_HINT_RX, "").trim().slice(0, 1000);
        const prefix = await buildKimiErrorPrefix(kspawn.cmd);
        const errorText = prefix + (cleaned || `kimi exit ${code}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: errorText }));
      }
    });
    child.on("error", async (e) => {
      if (!res.headersSent) {
        const prefix = await buildKimiErrorPrefix(kspawn.cmd);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: prefix + String(e?.message || e) }));
      }
    });
  },
};

export default kimi;
