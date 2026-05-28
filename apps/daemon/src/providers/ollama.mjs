// Ollama adapter — local weights via http://localhost:11434.
//
// No CLI spawn: Ollama runs as a server. We proxy /api/chat (NDJSON
// stream) and translate each line into the unified SSE shape (event:
// text / event: usage / event: done).
//
// Default model resolution (2026-05-18):
//   1. caller passes a model id → use that.
//   2. caller passes "default" or omits → query /api/tags and pick the
//      first installed model.
//   3. /api/tags unreachable or empty → fall back to "llama3.2:latest".
// This avoids the 404 trap where the legacy hardcoded "llama3.2"
// (no tag) hit Ollama's strict-tag matcher and bounced as
// `ollama HTTP 404` instantly. Surfaced via QA matrix 2026-05-18.
//
// Capabilities: streaming only. No tools (most local models don't
// support function calling reliably), no multimodal, no
// sessions (Ollama is stateless), no MCP, no Path A.
//
// @file providers/ollama.mjs

/**
 * Resolve a usable model id. Caller-supplied wins. "default" / undefined
 * / null trigger /api/tags lookup. Last resort: "llama3.2:latest" so
 * the upstream call at least returns a structured 404 (rather than the
 * misleading no-tag 404).
 */
async function resolveModel(host, caller) {
  if (caller && typeof caller === "string" && caller !== "default") return caller;
  try {
    const r = await fetch(`${host}/api/tags`, { method: "GET" });
    if (!r.ok) return "llama3.2:latest";
    const { models } = await r.json();
    if (Array.isArray(models) && models.length > 0 && typeof models[0]?.name === "string") {
      return models[0].name;
    }
  } catch { /* unreachable — fall through */ }
  return "llama3.2:latest";
}

/** @type {import("./types.mjs").ProviderAdapter} */
const ollama = {
  id: "ollama",
  label: "Ollama",
  // beta. Local server reliably reachable; per-model quality is
  // wildly variable. Local-first story is real, but small-model output
  // doesn't always survive the artifact contract.
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: false,
    multimodal: false,
    sessions: false,
    mcp: false,
    // local Ollama: chat completion only.
    fileWrite: "artifact",
  },

  async stream(req, res, deps) {
    const { readJson } = deps;
    let body;
    try { body = await readJson(req); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    // Default 127.0.0.1 over `localhost` — on Windows / Node 18+
    // `localhost` may resolve to IPv6 (::1) but Ollama only listens
    // on IPv4. Forcing IPv4 here avoids silent "ollama not detected"
    // failures. Users with non-default setups override via DF_OLLAMA_HOST.
    const host = process.env.DF_OLLAMA_HOST || "http://127.0.0.1:11434";
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const resolvedModel = await resolveModel(host, model);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write(`event: log\ndata: ${JSON.stringify({ level: "info", message: `ollama chat model=${resolvedModel}${model && model !== "default" ? "" : " (auto-picked from /api/tags)"}` })}\n\n`);

    const controller = new AbortController();
    req.on("close", () => { try { controller.abort(); } catch {} });

    try {
      const upstream = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedModel, messages, stream: true }),
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: `ollama HTTP ${upstream.status}` })}\n\n`);
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      let usage = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let v;
          try { v = JSON.parse(line); } catch { continue; }
          if (v.message && typeof v.message.content === "string" && v.message.content.length > 0) {
            full += v.message.content;
            res.write(`event: text\ndata: ${JSON.stringify({ content: v.message.content })}\n\n`);
          }
          if (v.done) {
            usage = {
              prompt_tokens: v.prompt_eval_count ?? 0,
              completion_tokens: v.eval_count ?? 0,
              total_tokens: (v.prompt_eval_count ?? 0) + (v.eval_count ?? 0),
            };
          }
        }
      }
      if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      // 1 stabilize: empty-completion → explicit error instead of
      // silent done({content: ""}). Frontend renders red bubble; the
      // user sees the failure, not a "blank assistant reply".
      if (full) {
        res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "ollama completed without text or artifact" })}\n\n`);
      }
      res.end();
    } catch (err) {
      if (err?.name !== "AbortError") {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`);
      }
      res.end();
    }
  },

  async once(req, res, deps) {
    const { readJson } = deps;
    let body;
    try { body = await readJson(req); }
    catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const { prompt, systemPrompt, model } = body;
    if (typeof prompt !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    // Default 127.0.0.1 over `localhost` — on Windows / Node 18+
    // `localhost` may resolve to IPv6 (::1) but Ollama only listens
    // on IPv4. Forcing IPv4 here avoids silent "ollama not detected"
    // failures. Users with non-default setups override via DF_OLLAMA_HOST.
    const host = process.env.DF_OLLAMA_HOST || "http://127.0.0.1:11434";
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const resolvedModel = await resolveModel(host, model);
    try {
      const upstream = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
      });
      const data = await upstream.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      if (!upstream.ok) res.end(JSON.stringify({ error: data.error || `ollama HTTP ${upstream.status}` }));
      else res.end(JSON.stringify({ text: data.message?.content || "" }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  },
};

export default ollama;
