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

import {
  resolveOllamaHost,
  getModelCapabilities,
  resolveNumCtx,
  parseEnvThink,
} from "./ollama-host.mjs";

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
  } catch {
    /* unreachable — fall through */
  }
  return "llama3.2:latest";
}

/** Turn a low-level fetch failure into an actionable message. Undici surfaces
 *  a connection refusal as a bare "fetch failed", which hides the real cause
 *  (Ollama not running, or listening on a different host/port). */
function ollamaErrorMessage(err, host) {
  const raw = String(err?.message || err);
  const code = String(err?.cause?.code || err?.code || "");
  const isConn =
    raw === "fetch failed" ||
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|UND_ERR/.test(`${raw} ${code}`);
  if (isConn) {
    return `Ollama unreachable at ${host} — is it running? Start it with \`ollama serve\` (or set DF_OLLAMA_HOST if it listens elsewhere).`;
  }
  return raw;
}

/** Actionable message for a model that has no chat template (embedding models,
 *  raw completion-only GGUF imports). These bounce /api/chat as
 *  `400 "<model>" does not support chat`. The capability probe guards this
 *  before we call /api/chat, but we phrase it once here for both call paths
 *  and as a fallback when the probe was unavailable. */
function noChatMessage(model) {
  return `O modelo "${model}" não suporta chat (é completion-only ou um modelo de embedding). Rode \`ollama pull llama3.2\` (ou outro modelo instruct, ex: qwen2.5-coder) e selecione-o no seletor de modelo.`;
}

/** True when an upstream error string is Ollama's does-not-support-chat 400.
 *  Safety net for when the capability probe gave its permissive fallback. */
function isNoChatError(text) {
  return /does not support (chat|generate)/i.test(String(text || ""));
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
    try {
      body = await readJson(req);
    } catch (e) {
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
    // Resolve the working Ollama host (probes 127.0.0.1 → localhost → [::1],
    // or DF_OLLAMA_HOST). Shared with detection so the model picker and the
    // chat call always reach the same server — otherwise the picker could
    // list models from one host while generation "fetch failed" on another.
    // See providers/ollama-host.mjs.
    const host = await resolveOllamaHost();
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const resolvedModel = await resolveModel(host, model);
    // Probe the model: chat capability (guard), thinking capability (auto),
    // and max context (clamp). See providers/ollama-host.mjs.
    const caps = await getModelCapabilities(host, resolvedModel);
    const numCtx = resolveNumCtx(caps.maxContext, process.env.DF_OLLAMA_NUM_CTX);
    // think:true routes reasoning to message.thinking (kept out of
    // message.content, so it never leaks into the artifact). Only enable
    // when the user hasn't opted out AND the model actually supports it.
    const think = parseEnvThink(process.env.DF_OLLAMA_THINK) && caps.thinking;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    // Guard: completion-only / embedding models have no chat template and
    // bounce /api/chat as `400 "<model>" does not support chat`. Surface an
    // actionable error before the upstream call instead of the cryptic 400.
    if (!caps.chat) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: noChatMessage(resolvedModel) })}\n\n`,
      );
      res.end();
      return;
    }

    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `ollama chat model=${resolvedModel}${model && model !== "default" ? "" : " (auto-picked from /api/tags)"} · num_ctx=${numCtx}${think ? " · thinking" : ""}` })}\n\n`,
    );

    const controller = new AbortController();
    req.on("close", () => {
      try {
        controller.abort();
      } catch {}
    });

    try {
      const upstream = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // num_ctx lifts Ollama's 4096 default so the DF system-prompt stack
        // (preamble + craft + output contract + current file + history) isn't
        // silently truncated before the model reads the user's actual ask.
        // think routes reasoning to message.thinking when enabled+supported.
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          stream: true,
          think,
          options: { num_ctx: numCtx },
        }),
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        // Safety net: if the probe's permissive fallback let a no-chat model
        // through, the upstream 400 body carries "does not support chat".
        let detail = `ollama HTTP ${upstream.status}`;
        try {
          const errText = await upstream.text();
          if (isNoChatError(errText)) detail = noChatMessage(resolvedModel);
        } catch {
          /* keep the generic HTTP status */
        }
        res.write(`event: error\ndata: ${JSON.stringify({ error: detail })}\n\n`);
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
          try {
            v = JSON.parse(line);
          } catch {
            continue;
          }
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
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: "ollama completed without text or artifact" })}\n\n`,
        );
      }
      res.end();
    } catch (err) {
      if (err?.name !== "AbortError") {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: ollamaErrorMessage(err, host) })}\n\n`,
        );
      }
      res.end();
    }
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
    const { prompt, systemPrompt, model } = body;
    if (typeof prompt !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    // Resolve the working Ollama host (probes 127.0.0.1 → localhost → [::1],
    // or DF_OLLAMA_HOST). Shared with detection so the model picker and the
    // chat call always reach the same server — otherwise the picker could
    // list models from one host while generation "fetch failed" on another.
    // See providers/ollama-host.mjs.
    const host = await resolveOllamaHost();
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const resolvedModel = await resolveModel(host, model);
    const caps = await getModelCapabilities(host, resolvedModel);
    if (!caps.chat) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: noChatMessage(resolvedModel) }));
      return;
    }
    const numCtx = resolveNumCtx(caps.maxContext, process.env.DF_OLLAMA_NUM_CTX);
    const think = parseEnvThink(process.env.DF_OLLAMA_THINK) && caps.thinking;
    try {
      const upstream = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          stream: false,
          think,
          options: { num_ctx: numCtx },
        }),
      });
      const data = await upstream.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      if (!upstream.ok) {
        const detail = isNoChatError(data?.error)
          ? noChatMessage(resolvedModel)
          : data.error || `ollama HTTP ${upstream.status}`;
        res.end(JSON.stringify({ error: detail }));
      } else {
        res.end(JSON.stringify({ text: data.message?.content || "" }));
      }
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: ollamaErrorMessage(err, host) }));
    }
  },
};

export default ollama;
