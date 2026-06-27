// Codex CLI adapter — OpenAI's local agent.
//
// `codex exec --json` reads prompt from stdin (we use `-` positional).
// systemPrompt is prepended with a separator since codex has no
// dedicated --system-prompt flag.
//
// Capabilities: streaming, tools (Bash + tool-driven file writes via the
// daemon's wireCodexJson normalizer), multimodal, native sessions via
// `codex resume <UUID>` (1.1+). When resume fails, the runtime's pipeline
// error path triggers the canonical-handoff fallback (/ spec
// §D34). — fileWrite="tool" so the runtime observes write-side tool
// events and skips `<artifact>` parsing.
//
// @file providers/codex.mjs

import { spawnErrorMessage } from "./spawn-error.mjs";
import { sanitizedSpawnEnv } from "../env-blocklist.mjs";

// BUG-24: when the model picker doesn't reset on provider switch, a
// Claude-only alias (opus/sonnet/haiku/claude-*) leaks into the codex
// turn as `--model opus`, which OpenAI rejects and aborts the run. Codex
// model ids are open-ended (gpt-5, o3, …) so we can't whitelist, but
// Claude aliases are unambiguously never valid for codex — drop them and
// let codex use its configured default. Mirrors the kimi.mjs guard.
function isForeignClaudeModel(model) {
  return typeof model === "string" && /^(claude|opus|sonnet|haiku)/i.test(model);
}

/** @type {import("./types.mjs").ProviderAdapter} */
const codex = {
  id: "codex",
  label: "Codex CLI",
  // beta. Stream + tools + 1.1+ session resume validated. Full
  // matrix coverage (multimodal, longer turns) still light.
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: true,
    multimodal: true,
    sessions: true,
    mcp: false,
    // codex command_execution coerced into normalized tool events.
    fileWrite: "tool",
  },

  async stream(req, res, deps) {
    const { readJson, wireCodexJson, spawn } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd, reasoning, sessionId } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    const CODEX_BIN = process.env.DF_CODEX_BIN || "codex";
    // (spec §/ D34): when sessionId is present and
    // non-empty, codex 1.1+ supports `codex resume <UUID> [PROMPT]`. We
    // still pipe the prompt via stdin (consistent with the no-resume
    // path), so we add `resume <UUID>` BEFORE the rest of the args. When
    // the resume fails (UUID expired/invalid), the codex process exits
    // non-zero and the canonical handoff fallback kicks in (handled by
    // the runtime's pipeline error path).
    // BUG-21: codex's workspace-write sandbox (`--full-auto`) is broken on
    // Windows — every sandboxed child spawn fails with
    //   ERROR codex_core::exec: windows sandbox: spawn setup refresh
    // so codex can't even run `Get-Content` to READ the project's HTML,
    // silently falls back to "regenerate from scratch", and clobbers the
    // user's in-progress file. There is no working OS sandbox for codex on
    // Windows yet, so bypass it there (the daemon already scopes file ops,
    // and this is a local desktop tool the user explicitly drives). macOS/
    // Linux keep the real workspace-write sandbox.
    const sandboxArgs =
      process.platform === "win32"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--full-auto", "-c", "sandbox_workspace_write.network_access=true"];
    const useResume = typeof sessionId === "string" && sessionId.length > 0;
    const args = useResume
      ? ["resume", sessionId, "--json", "--skip-git-repo-check", ...sandboxArgs]
      : ["exec", "--json", "--skip-git-repo-check", ...sandboxArgs];
    if (cwd && typeof cwd === "string") {
      args.push("-C", cwd);
    }
    if (model && typeof model === "string" && model !== "default" && !isForeignClaudeModel(model)) {
      args.push("--model", model);
    }
    if (reasoning && typeof reasoning === "string" && reasoning !== "default") {
      args.push("-c", `model_reasoning_effort="${reasoning}"`);
    }
    args.push("-"); // read prompt from stdin
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    // Windows: npm-installed CLIs (codex/gemini/opencode/kimi) ship as
    // .CMD wrappers. Node 18.20+ refuses to spawn .cmd/.bat without a
    // shell (CVE-2024-27980 hardening) → "spawn ENOENT" even though the
    // binary resolves correctly via PATHEXT. shell: true on win32 only
    // routes the spawn through cmd.exe so the .CMD wrapper executes.
    const spawnOpts = {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: sanitizedSpawnEnv("codex"),
    };
    if (cwd && typeof cwd === "string") spawnOpts.cwd = cwd;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const child = spawn(CODEX_BIN, args, spawnOpts);
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `spawned ${CODEX_BIN} ${useResume ? `resume ${sessionId}` : "exec"} --model=${model ?? "default"}${cwd ? ` cwd=${cwd}` : ""}` })}\n\n`,
    );
    child.stdin.write(composed);
    child.stdin.end();

    req.on("close", () => {
      if (!child.killed) child.kill("SIGTERM");
    });
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, CODEX_BIN, "Codex CLI");
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch {}
    });
    wireCodexJson(child, res);
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
    const CODEX_BIN = process.env.DF_CODEX_BIN || "codex";
    // BUG-21: bypass codex's broken Windows sandbox here too (see stream()).
    const onceSandboxArgs =
      process.platform === "win32"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--full-auto"];
    const args = ["exec", "--json", "--skip-git-repo-check", ...onceSandboxArgs];
    if (cwd) args.push("-C", cwd);
    if (model && model !== "default" && !isForeignClaudeModel(model)) args.push("--model", model);
    args.push("-");
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    const onceSpawnOpts = {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: sanitizedSpawnEnv("codex"),
    };
    if (cwd) onceSpawnOpts.cwd = cwd;
    const child = spawn(CODEX_BIN, args, onceSpawnOpts);
    child.stdin.write(composed);
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    let collected = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
      // Parse JSONL on the fly to extract agent_message text
      let buf = stdout;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const v = JSON.parse(line);
          if (
            v.type === "item.completed" &&
            v.item?.type === "agent_message" &&
            typeof v.item.text === "string"
          ) {
            collected += v.item.text;
          }
        } catch {}
      }
      stdout = buf;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      if (res.headersSent) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (code === 0) res.end(JSON.stringify({ text: collected }));
      else res.end(JSON.stringify({ error: stderr || `exit ${code}` }));
    });
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, CODEX_BIN, "Codex CLI");
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  },
};

export default codex;
