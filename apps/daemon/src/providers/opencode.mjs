// opencode adapter — sst.dev MIT-licensed CLI.
//
// Spawned similarly to claude/codex. opencode supports `run --print`
// for non-interactive output. Streaming today emits raw stdout chunks
// (we don't parse internal events because the JSON shape is non-public
// and varies per release).
//
// Capabilities: streaming, tools (ACP-style native tool loop). —
// fileWrite="tool" since opencode runs Write/Edit/Bash against the
// working directory; the runtime does not parse an `<artifact>` block.
// No multimodal, no sessions, no MCP today. may add ACP JSON-RPC
// parser to surface tool-use events to the bridge.
//
// @file providers/opencode.mjs

import { existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizedSpawnEnv } from "../env-blocklist.mjs";

const OPENCODE_BIN_ENV = "DF_OPENCODE_BIN";

// BUG-25: opencode passes the full composed prompt (systemPrompt +
// canonical+ + contract + user message) as a positional CLI arg. On
// Windows the .cmd/.ps1 shim routes shell:true spawns through cmd.exe,
// whose command line caps at ~8191 chars — real design prompts blow past
// it and the spawn dies with "Linha de comando muito longa". opencode
// ships as a native .exe behind that shim, so resolve it and spawn the
// binary directly (shell:false): native exe means Node has no
// .cmd/CVE-2024-27980 restriction, and CreateProcess raises the limit to
// ~32767 chars. stdin stays "ignore" regardless (piping hangs opencode
// 1.15 — see stream()). Mirrors the kimi.mjs resolveKimiSpawn() guard.
function resolveOpencodeSpawn() {
  if (process.platform === "win32" && !process.env[OPENCODE_BIN_ENV]) {
    const exe = join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "opencode-ai",
      "bin",
      "opencode.exe",
    );
    if (existsSync(exe)) return { cmd: exe, useShell: false };
  }
  return {
    cmd: process.env[OPENCODE_BIN_ENV] || "opencode",
    useShell: process.platform === "win32",
  };
}

/** @type {import("./types.mjs").ProviderAdapter} */
const opencode = {
  id: "opencode",
  label: "Opencode CLI",
  // Experimental. Adapter compiles, contract events emit. Tool-shape
  // is non-Claude (ACP) and the daemon's wirers don't normalize it
  // end-to-end yet — verify before relying on the SDC pipeline.
  readiness: "experimental",
  capabilities: {
    streaming: true,
    tools: true,
    multimodal: false,
    sessions: false,
    mcp: false,
    // opencode `run --print` runs native tools against the working
    // directory; the agent writes files itself. Tool-driven channel.
    fileWrite: "tool",
  },

  async stream(req, res, deps) {
    const { readJson, spawn } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    const ospawn = resolveOpencodeSpawn();
    // opencode 1.15+ flags:
    //   run <message>                       message as positional arg
    //   --format json                       JSONL event stream (vs ANSI TUI default)
    //   --dangerously-skip-permissions      headless tool auto-approval
    //   --model <provider/model>            override the global default
    //   --dir <path>                        working directory
    //
    // Critical: default --format pipes ANSI-coloured TUI output
    // (boxes, separators, escape codes) and the daemon was hanging
    // because the buffered stdout never flushed in non-TTY context.
    // `--format json` emits one JSON object per line as soon as each
    // event happens — deterministic and parseable.
    //
    // Default model: opencode 1.15's global default `openai/gpt-5.5-
    // pro` errors with "not supported when using Codex with a ChatGPT
    // account" for ChatGPT-OAuth credentials. `openai/gpt-5.4-mini-
    // fast` is cheapest + ChatGPT-allowed.
    const args = ["run", "--dangerously-skip-permissions", "--format", "json"];
    const apiModel = model && model !== "default" ? model : "openai/gpt-5.4-mini-fast";
    args.push("--model", apiModel);
    if (cwd && typeof cwd === "string") args.push("--dir", cwd);
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    args.push(composed);
    // stdin MUST be "ignore" — opencode 1.15 blocks waiting on stdin
    // when piped (even with the prompt as a positional arg). Without
    // stdin EOF the child never emits anything. Verified via repro
    // 2026-05-15: piping → 30s hang; ignoring stdin → JSON events
    // flow in ~200ms.
    // Windows .CMD/long-cmdline fix — see resolveOpencodeSpawn() above.
    const spawnOpts = {
      stdio: ["ignore", "pipe", "pipe"],
      shell: ospawn.useShell,
      env: sanitizedSpawnEnv("opencode"),
    };
    if (cwd && typeof cwd === "string") spawnOpts.cwd = cwd;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `opencode → ${apiModel}` })}\n\n`,
    );

    const child = spawn(ospawn.cmd, args, spawnOpts);

    // Handle spawn failure (ENOENT etc) gracefully — without this the
    // daemon process crashes on unhandled 'error' event.
    child.on("error", (err) => {
      const msg =
        err?.code === "ENOENT"
          ? `opencode binary not found in PATH. Install: npm i -g opencode-cli`
          : String(err?.message || err);
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch {}
    });

    req.on("close", () => {
      if (!child.killed) child.kill("SIGTERM");
    });

    // opencode --format json emits one JSON event per line. Real-world
    // shape (verified against opencode 1.15.0 on 2026-05-15):
    //   {"type":"step_start", "sessionID":"...", "part":{...}}
    //   {"type":"text", "part":{"text":"PONG","time":{...}}}
    //   {"type":"step_finish", "part":{"tokens":{...},"cost":0}}
    //
    // Other observed `type` values include `tool_use`, `tool_result`,
    // `error`. We accumulate text + forward tool events; unknown
    // types are silently ignored (forward-compat with newer opencode).
    let stdoutBuf = "";
    let stderr = "";
    let full = "";
    let usage = null;
    let closedTerminal = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line || !line.startsWith("{")) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "text" && evt.part?.text) {
          full += evt.part.text;
          res.write(`event: text\ndata: ${JSON.stringify({ content: evt.part.text })}\n\n`);
        }
        if (evt.type === "tool_use" || evt.type === "tool-use") {
          // OpenCode schema (verified against opencode 1.15.0 on 2026-05-18):
          //   part.tool: "apply_patch" | "read" | "bash" | ...
          //   part.callID: tool call id
          //   part.state.input.patchText: "*** Begin Patch\n*** Add File: PATH\n+content..."
          // The previous parser pulled `evt.part.name` (undefined) and
          // `evt.part.input` (also undefined for apply_patch — it's nested
          // in `state.input`), so the UI received {name:"tool", input:null}
          // and couldn't route the iframe-reload. Translate `apply_patch`
          // into Write/Edit/Delete by extracting the path from patchText.
          const part = evt.part ?? {};
          const rawTool = typeof part.tool === "string" ? part.tool : part.name;
          const stateInput = part.state?.input ?? part.input ?? null;
          let toolName = rawTool ?? "tool";
          let input = stateInput;
          if (
            rawTool === "apply_patch" &&
            stateInput &&
            typeof stateInput === "object" &&
            typeof stateInput.patchText === "string"
          ) {
            const patch = stateInput.patchText;
            const m = patch.match(/\*\*\* (Add|Update|Delete) File:\s*(.+)/);
            if (m) {
              const kind = m[1];
              const filePath = m[2].trim();
              toolName = kind === "Delete" ? "Delete" : kind === "Update" ? "Edit" : "Write";
              input = { file_path: filePath, patchText: patch };
            }
          } else if (rawTool === "write" || rawTool === "write_file") {
            toolName = "Write";
            // most opencode write tools use { path, content } — normalise.
            if (
              stateInput &&
              typeof stateInput === "object" &&
              typeof stateInput.path === "string" &&
              !stateInput.file_path
            ) {
              input = { ...stateInput, file_path: stateInput.path };
            }
          } else if (rawTool === "edit" || rawTool === "edit_file" || rawTool === "replace") {
            toolName = "Edit";
            if (
              stateInput &&
              typeof stateInput === "object" &&
              typeof stateInput.path === "string" &&
              !stateInput.file_path
            ) {
              input = { ...stateInput, file_path: stateInput.path };
            }
          } else if (rawTool === "bash" || rawTool === "shell") {
            toolName = "Bash";
          } else if (rawTool === "read" || rawTool === "read_file") {
            toolName = "Read";
            if (
              stateInput &&
              typeof stateInput === "object" &&
              typeof stateInput.path === "string" &&
              !stateInput.file_path
            ) {
              input = { ...stateInput, file_path: stateInput.path };
            }
          }
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({
              provider: "opencode",
              id: part.callID ?? part.id ?? null,
              name: toolName,
              input,
            })}\n\n`,
          );
          // Some opencode tool steps land as a single `tool_use` event with
          // state.status === "completed" — they never fire a separate
          // tool_result. Emit a synthetic one here so the UI's iframe-reload
          // path (which gates on tool_result) doesn't get stuck waiting.
          if (part.state?.status === "completed") {
            res.write(
              `event: tool_result\ndata: ${JSON.stringify({
                provider: "opencode",
                id: part.callID ?? part.id ?? null,
                isError: false,
                content: typeof part.state.output === "string" ? part.state.output : "completed",
              })}\n\n`,
            );
          }
        }
        if (evt.type === "tool_result" || evt.type === "tool-result") {
          res.write(
            `event: tool_result\ndata: ${JSON.stringify({
              provider: "opencode",
              id: evt.part?.callID ?? evt.part?.tool_use_id ?? evt.part?.id ?? null,
              content: evt.part?.output ?? evt.part?.state?.output ?? evt.part?.content ?? null,
            })}\n\n`,
          );
        }
        if (evt.type === "step_finish" && evt.part?.tokens) {
          const t = evt.part.tokens;
          usage = {
            prompt_tokens: t.input ?? 0,
            completion_tokens: t.output ?? 0,
            total_tokens: t.total ?? 0,
          };
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));

    child.on("close", (code) => {
      if (closedTerminal) return;
      closedTerminal = true;
      if (code === 0) {
        if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
        if (full) {
          res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
        } else {
          const tail = stderr.trim().slice(0, 300) || "no output captured";
          res.write(
            `event: log\ndata: ${JSON.stringify({ level: "warn", message: `opencode closed without text. stderr: ${tail.replace(/\n/g, " ⏎ ")}` })}\n\n`,
          );
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: "opencode completed without text or artifact" })}\n\n`,
          );
        }
      } else {
        const detail = stderr.trim().slice(0, 500) || `opencode exit ${code}`;
        res.write(`event: error\ndata: ${JSON.stringify({ error: detail })}\n\n`);
      }
      try {
        res.end();
      } catch {}
    });
  },

  async once(req, res, deps) {
    const { readJson, spawn } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd } = body;
    if (typeof prompt !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    const ospawn = resolveOpencodeSpawn();
    // See stream() — same args (--format json + --dangerously-skip-
    // permissions + stdin:"ignore"). Default model is the same
    // ChatGPT-OAuth-safe gpt-5.4-mini-fast.
    const args = ["run", "--dangerously-skip-permissions", "--format", "json"];
    const apiModel = model && model !== "default" ? model : "openai/gpt-5.4-mini-fast";
    args.push("--model", apiModel);
    if (cwd && typeof cwd === "string") args.push("--dir", cwd);
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    args.push(composed);
    const onceSpawnOpts = {
      stdio: ["ignore", "pipe", "pipe"],
      shell: ospawn.useShell,
      env: sanitizedSpawnEnv("opencode"),
    };
    if (cwd) onceSpawnOpts.cwd = cwd;
    const child = spawn(ospawn.cmd, args, onceSpawnOpts);

    // Handle ENOENT etc. gracefully
    let spawnError = null;
    child.on("error", (err) => {
      spawnError =
        err?.code === "ENOENT"
          ? `opencode binary not found in PATH. Install: npm i -g opencode-cli`
          : String(err?.message || err);
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: spawnError }));
      }
    });
    let stdout = "";
    let stderr = "";
    let collectedText = "";
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => {
        stdout += c;
        // Walk the JSONL stream and collect text-event payloads. once()
        // returns a single string so streaming events are merged.
        let nl;
        let buf = stdout;
        const lines = buf.split("\n");
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith("{")) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "text" && evt.part?.text) {
              if (!collectedText.endsWith(evt.part.text)) collectedText += evt.part.text;
            }
          } catch {}
        }
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => (stderr += c));
    }
    child.on("close", (code) => {
      if (spawnError) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (code === 0 && collectedText) {
        res.end(JSON.stringify({ text: collectedText }));
      } else if (code === 0) {
        res.end(JSON.stringify({ error: "opencode completed without text or artifact" }));
      } else {
        res.end(JSON.stringify({ error: stderr.trim().slice(0, 500) || `opencode exit ${code}` }));
      }
    });
  },
};

export default opencode;
