// OpenAI BYOK adapter — direct OpenAI Chat Completions API.
//
// BYOK with token at ~/.config/design-factory/openai.json or
// OPENAI_API_KEY env. Default model = gpt-4o-mini. Streaming uses
// standard OpenAI SSE (`data: {choices:[{delta:...}]}`).
//
// @file providers/openai.mjs

import { extractImageAttachments } from "../lib/image-attachments.mjs";

const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";

/** @type {import("./types.mjs").ProviderAdapter} */
const openai = {
  id: "openai",
  label: "OpenAI API",
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: false,
    multimodal: false,
    sessions: false,
    mcp: false,
    fileWrite: "artifact",
  },

  async stream(req, res, deps) {
    const { readJson, getOpenaiToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getOpenaiToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "no OpenAI API key configured. PUT /config/openai { token } or export OPENAI_API_KEY.",
        }),
      );
      return;
    }
    const { prompt, systemPrompt, model } = body;
    if (typeof prompt !== "string" || !prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt required" }));
      return;
    }
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    // Inline [attached image: PATH] markers as base64 image_url parts.
    const { text: userText, images } = extractImageAttachments(prompt, {
      isInScope: deps.imagePathInScope,
    });
    messages.push(
      images.length > 0
        ? {
            role: "user",
            content: [
              { type: "text", text: userText },
              ...images.map((im) => ({
                type: "image_url",
                image_url: { url: `data:${im.mime};base64,${im.base64}` },
              })),
            ],
          }
        : { role: "user", content: prompt },
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    const apiModel = model && model !== "default" ? model : OPENAI_DEFAULT_MODEL;
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `openai → ${apiModel}` })}\n\n`,
    );
    res.write(`event: meta\ndata: ${JSON.stringify({ model: apiModel })}\n\n`);
    const turnStartedAt = Date.now();

    const controller = new AbortController();
    req.on("close", () => {
      try {
        controller.abort();
      } catch {}
    });

    try {
      const upstream = await fetch(OPENAI_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: apiModel, messages, stream: true }),
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: `openai HTTP ${upstream.status}: ${errText.slice(0, 500)}` })}\n\n`,
        );
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
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") {
            if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
            res.write(
              `event: result\ndata: ${JSON.stringify({ durationMs: Date.now() - turnStartedAt })}\n\n`,
            );
            if (full) {
              res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
            } else {
              res.write(
                `event: error\ndata: ${JSON.stringify({ error: "openai completed without text or artifact" })}\n\n`,
              );
            }
            res.end();
            return;
          }
          let v;
          try {
            v = JSON.parse(dataStr);
          } catch {
            continue;
          }
          const delta = v.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            res.write(`event: text\ndata: ${JSON.stringify({ content: delta })}\n\n`);
          }
          if (v.usage) {
            // F-fix: translate to camelCase frontend parser shape.
            usage = {
              inputTokens: v.usage.prompt_tokens ?? 0,
              outputTokens: v.usage.completion_tokens ?? 0,
            };
          }
        }
      }
      if (full) {
        if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
        res.write(
          `event: result\ndata: ${JSON.stringify({ durationMs: Date.now() - turnStartedAt })}\n\n`,
        );
        res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
      } else {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: "openai completed without text or artifact" })}\n\n`,
        );
      }
      res.end();
    } catch (err) {
      if (err?.name !== "AbortError") {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`,
        );
      }
      res.end();
    }
  },

  async once(req, res, deps) {
    const { readJson, getOpenaiToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getOpenaiToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no OpenAI API key configured" }));
      return;
    }
    const { prompt, systemPrompt, model } = body;
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: typeof prompt === "string" ? prompt : "" });
    try {
      const upstream = await fetch(OPENAI_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model && model !== "default" ? model : OPENAI_DEFAULT_MODEL,
          messages,
        }),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: text.slice(0, 1000) }));
        return;
      }
      const parsed = JSON.parse(text);
      const out = parsed.choices?.[0]?.message?.content ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: out }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  },
};

export default openai;
