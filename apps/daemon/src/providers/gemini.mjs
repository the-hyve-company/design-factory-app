// Gemini CLI adapter — Google's local agent.
//
// `gemini --output-format stream-json --skip-trust --yolo` reads from
// stdin when -p is omitted. systemPrompt is prepended (gemini has no
// dedicated system flag in the CLI path).
//
// Capabilities: streaming, multimodal, sessions (--resume <id>, POC v1.1).
// Tools / MCP / Path A all false — gemini CLI doesn't expose tool-use
// to the spawning process, only inline reasoning text.
//
// @file providers/gemini.mjs

import { spawnErrorMessage } from "./spawn-error.mjs";
import { sanitizedSpawnEnv } from "../env-blocklist.mjs";

/** @type {import("./types.mjs").ProviderAdapter} */
const gemini = {
  id: "gemini",
  label: "Gemini CLI",
  // beta. Streaming + sessions verified; tools not exposed by CLI.
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: false,
    multimodal: true,
    sessions: true,
    mcp: false,
    // Gemini CLI emits stream-json text only. Runtime parses the
    // <artifact> block at stream end.
    fileWrite: "artifact",
  },

  async stream(req, res, deps) {
    const { readJson, wireGeminiJson, spawn } = deps;
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
    const GEMINI_BIN = process.env.DF_GEMINI_BIN || "gemini";
    const args = ["--output-format", "stream-json", "--skip-trust", "--yolo"];
    // : gemini --resume <id> resumes the prior conversation by
    // session id (POC v1.1). When resume fails, the canonical handoff
    // already in the prompt covers the gap.
    const useResume = typeof sessionId === "string" && sessionId.length > 0;
    if (useResume) {
      args.push("--resume", sessionId);
    }
    if (model && typeof model === "string" && model !== "default") {
      args.push("--model", model);
    }
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    // Windows .CMD spawn fix — see codex.mjs for the full rationale.
    const spawnOpts = {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: sanitizedSpawnEnv("gemini"),
    };
    if (cwd && typeof cwd === "string") spawnOpts.cwd = cwd;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const child = spawn(GEMINI_BIN, args, spawnOpts);
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `spawned ${GEMINI_BIN} --model=${model ?? "default"}${useResume ? ` --resume=${sessionId}` : ""}${cwd ? ` cwd=${cwd}` : ""}` })}\n\n`,
    );
    child.stdin.write(composed);
    child.stdin.end();

    req.on("close", () => {
      if (!child.killed) child.kill("SIGTERM");
    });
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, GEMINI_BIN, "Gemini CLI");
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      } catch {}
    });
    wireGeminiJson(child, res);
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
    const GEMINI_BIN = process.env.DF_GEMINI_BIN || "gemini";
    const args = ["--skip-trust", "--yolo"];
    if (model && model !== "default") args.push("--model", model);
    const composed = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    const onceSpawnOpts = {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: sanitizedSpawnEnv("gemini"),
    };
    if (cwd) onceSpawnOpts.cwd = cwd;
    const child = spawn(GEMINI_BIN, args, onceSpawnOpts);
    child.stdin.write(composed);
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      if (res.headersSent) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (code === 0) res.end(JSON.stringify({ text: stdout }));
      else res.end(JSON.stringify({ error: stderr || `exit ${code}` }));
    });
    child.on("error", (err) => {
      const msg = spawnErrorMessage(err, GEMINI_BIN, "Gemini CLI");
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  },
};

export default gemini;
