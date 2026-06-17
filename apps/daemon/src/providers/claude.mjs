// Claude Code adapter — flagship CLI, Path A (tool-driven file writes).
//
// Streaming uses claude --print --output-format stream-json. Prompt
// arrives via stdin (Linux ARG_MAX is ~2MB; user hit spawn E2BIG
// 2026-05-03 with a 60KB HTML iteration prompt → stdin lifts the cap).
//
// systemPrompt: small payloads (<32KB) go via --system-prompt flag;
// large payloads (turn-pipeline embeds the full iframe HTML for tasks
// like "Aplicar 16 comentários ao design" → 178KB) blow Linux's
// MAX_ARG_STRLEN (128KB per single arg) → spawn E2BIG. For those we
// write the prompt to a temp file and use --system-prompt-file.
//
// Capabilities: full house — streaming, tools, multimodal, sessions
// (--resume), MCP, Path A (writes via Write/Edit tools, not artifact-wrap).
// This is the only provider where the runtime exposes file-write tools
// natively today. Other providers fall back to artifact-wrap (see
// artifact-writer.mjs).
//
// @file providers/claude.mjs

import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnErrorMessage } from "./spawn-error.mjs";

// Linux MAX_ARG_STRLEN is typically 128KB (PAGE_SIZE * 32). Stay well
// under that so the args (CLI flags + model name + cwd path) all fit
// alongside. 32KB is comfortably small for any sane system prompt that
// doesn't embed a whole HTML document.
const SYSTEM_PROMPT_INLINE_LIMIT = 32 * 1024;

/**
 * Decide whether a system prompt needs to be spooled to a temp file
 * (returns the path) or can be passed inline via --system-prompt.
 * Returns null when the prompt is empty.
 * Caller is responsible for cleaning up the file when the stream ends.
 */
async function maybeSpoolSystemPrompt(systemPrompt) {
  if (!systemPrompt || typeof systemPrompt !== "string") return null;
  if (systemPrompt.length <= SYSTEM_PROMPT_INLINE_LIMIT) {
    return { kind: "inline", value: systemPrompt };
  }
  const dir = await mkdtemp(join(tmpdir(), "df-sysprompt-"));
  const path = join(dir, "system.txt");
  await writeFile(path, systemPrompt, "utf8");
  return { kind: "file", path, dir };
}

// Claude Code authenticates through its own login (subscription OAuth stored
// by the `claude` CLI). A stale ANTHROPIC_API_KEY in the user's shell env would
// override that login and, if it's old or invalid, the CLI fails with
// "Invalid API key · Fix external API key" — even when the user is properly
// logged in (the exact symptom of a key set on macOS but not on Windows).
// The DF "anthropic" provider is the explicit BYOK / API-key path; the "claude"
// CLI provider must always use the login. So we spawn it with the ambient key
// stripped, making the two providers cleanly distinct.
function claudeSpawnEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/** @type {import("./types.mjs").ProviderAdapter} */
const claude = {
  id: "claude",
  label: "Claude Code",
  // reference adapter. Tools, sessions, MCP, multimodal: all
  // exercised end-to-end across the SDC pipeline.
  readiness: "stable",
  capabilities: {
    streaming: true,
    tools: true,
    multimodal: true,
    sessions: true,
    mcp: true,
    // Claude has native Write/Edit. Tool-driven channel.
    fileWrite: "tool",
  },

  async stream(req, res, deps) {
    const { readJson, wireStreamJson, spawn, CLAUDE_BIN, ensureGitRepo } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd, agent, sessionId } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    // systemPrompt: small → flag; large (>32KB) → temp file via
    // --system-prompt-file (avoids E2BIG on prompts that embed full HTML).
    const spooled = await maybeSpoolSystemPrompt(systemPrompt);
    if (spooled?.kind === "inline") args.push("--system-prompt", spooled.value);
    else if (spooled?.kind === "file") args.push("--system-prompt-file", spooled.path);
    if (model) args.push("--model", model);
    if (agent && typeof agent === "string" && agent !== "claude") args.push("--agent", agent);
    // --resume reuses the on-disk JSONL session (~/.claude/projects/...).
    if (sessionId && typeof sessionId === "string") {
      args.push("--resume", sessionId);
    }
    // No positional prompt arg — claude --print reads from stdin when
    // none is supplied. Codex + Gemini already follow this pattern.
    const spawnEnv = claudeSpawnEnv();
    const spawnOpts =
      cwd && typeof cwd === "string"
        ? { stdio: ["pipe", "pipe", "pipe"], cwd, env: spawnEnv }
        : { stdio: ["pipe", "pipe", "pipe"], env: spawnEnv };
    // git-init the project dir so claude's workspace probe doesn't spew
    // "fatal: not a git repository" (which the chat shows as an error).
    if (cwd) ensureGitRepo?.(cwd);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const cleanupSpool = () => {
      if (spooled?.kind === "file" && spooled.dir) {
        rm(spooled.dir, { recursive: true, force: true }).catch(() => {});
      }
    };

    const child = spawn(CLAUDE_BIN, args, spawnOpts);
    child.stdin.write(prompt ?? "");
    child.stdin.end();
    const spLog =
      spooled?.kind === "file"
        ? `, system-prompt: file ${spooled.path} (${(systemPrompt ?? "").length}B)`
        : spooled?.kind === "inline"
          ? `, system-prompt: inline ${(systemPrompt ?? "").length}B`
          : "";
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `spawned ${CLAUDE_BIN} --model=${model ?? "default"}${agent && agent !== "claude" ? ` --agent=${agent}` : ""}${sessionId ? ` --resume=${sessionId}` : ""}${cwd ? ` cwd=${cwd}` : ""} (prompt via stdin: ${(prompt ?? "").length}B${spLog})` })}\n\n`,
    );

    req.on("close", () => {
      if (!child.killed) child.kill("SIGTERM");
      cleanupSpool();
    });
    child.on("close", () => {
      cleanupSpool();
    });
    // Surface spawn errors (ENOENT/EACCES) to the SSE stream so the UI
    // shows the user an actionable message instead of a silent close.
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, CLAUDE_BIN, "Claude Code");
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch {}
      cleanupSpool();
    });
    wireStreamJson(child, res);
  },

  async once(req, res, deps) {
    const { readJson, spawn, CLAUDE_BIN, ensureGitRepo } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model, cwd, agent } = body;
    const args = ["--print", "--output-format", "text", "--dangerously-skip-permissions"];
    // systemPrompt: small → flag; large (>32KB) → temp file via
    // --system-prompt-file. Same E2BIG mitigation as stream().
    const onceSpooled = await maybeSpoolSystemPrompt(systemPrompt);
    if (onceSpooled?.kind === "inline") args.push("--system-prompt", onceSpooled.value);
    else if (onceSpooled?.kind === "file") args.push("--system-prompt-file", onceSpooled.path);
    if (model) args.push("--model", model);
    if (agent && typeof agent === "string" && agent !== "claude") args.push("--agent", agent);
    // Prompt via stdin (not argv) — see stream() for context.
    // Big prompts trip Linux ARG_MAX → spawn E2BIG; stdin lifts the cap.
    const onceSpawnEnv = claudeSpawnEnv();
    const onceSpawnOpts =
      cwd && typeof cwd === "string"
        ? { stdio: ["pipe", "pipe", "pipe"], cwd, env: onceSpawnEnv }
        : { stdio: ["pipe", "pipe", "pipe"], env: onceSpawnEnv };
    if (cwd) ensureGitRepo?.(cwd);
    const cleanupOnceSpool = () => {
      if (onceSpooled?.kind === "file" && onceSpooled.dir) {
        rm(onceSpooled.dir, { recursive: true, force: true }).catch(() => {});
      }
    };
    const child = spawn(CLAUDE_BIN, args, onceSpawnOpts);
    child.stdin.write(prompt ?? "");
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      if (res.headersSent) return; // error handler already responded
      res.writeHead(200, { "Content-Type": "application/json" });
      if (code === 0) res.end(JSON.stringify({ text: stdout }));
      else res.end(JSON.stringify({ error: stderr || `exit ${code}` }));
      cleanupOnceSpool();
    });
    // Mirror the stream() handler: surface ENOENT/EACCES instead of
    // letting the request hang/close silently.
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, CLAUDE_BIN, "Claude Code");
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      cleanupOnceSpool();
    });
  },
};

export default claude;
