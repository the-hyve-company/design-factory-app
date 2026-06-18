// OpenRouter adapter — 200+ open + paid models, OpenAI-compatible API.
//
// BYOK with token at ~/.config/design-factory/openrouter.json or
// OPENROUTER_API_KEY env. Default model = Llama 3.3 70B (free tier).
// Streaming uses standard OpenAI SSE (`data: {choices:[{delta:...}]}`).
//
// Capabilities: streaming. Tools varies by model — set conservative
// false (some models do support tool-use, but the runtime would need
// per-model probing to expose this safely; candidate).
//
// @file providers/openrouter.mjs

import { extractImageAttachments } from "../lib/image-attachments.mjs";

/** @type {import("./types.mjs").ProviderAdapter} */
const openrouter = {
  id: "openrouter",
  label: "OpenRouter API",
  // beta. Stream/once flow tested; quality varies wildly by model
  // (200+ available). Free tier rate limits make end-to-end SDC fragile.
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: false,
    multimodal: false,
    sessions: false,
    mcp: false,
    // OpenRouter is a stateless chat-completion proxy.
    fileWrite: "artifact",
  },

  async stream(req, res, deps) {
    const { readJson, getOpenrouterToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getOpenrouterToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "no OpenRouter API key configured. PUT /config/openrouter { token } or export OPENROUTER_API_KEY.",
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
    // OpenRouter routes to 200+ models, many of which default to wrapping
    // generated code in markdown fences (```html ... ```) instead of the
    // `<artifact>` block the runtime parser expects. Prepend a minimal
    // contract reminder so the iframe-reload path catches the HTML even
    // when the client forgot to inject the full artifact contract. The
    // user's systemPrompt (if any) wins because it comes AFTER ours.
    // User QA 2026-05-18 — openrouter turn emitted markdown fence,
    // UI received zero file output and iframe stayed empty.
    const OR_DEFAULT_CONTRACT =
      'When emitting source files in this session, wrap them in `<artifact identifier="<path>" type="text/html" title="<title>">...complete file...</artifact>` blocks instead of markdown code fences. The runtime parses the artifact tag; markdown fences are dropped.';
    const messages = [];
    messages.push({ role: "system", content: OR_DEFAULT_CONTRACT });
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    // Inline [attached image: PATH] markers as base64 image_url parts
    // (OpenAI-compatible). The routed model must be vision-capable.
    const { text: orUserText, images: orImages } = extractImageAttachments(prompt);
    messages.push(
      orImages.length > 0
        ? {
            role: "user",
            content: [
              { type: "text", text: orUserText },
              ...orImages.map((im) => ({
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
    const apiModel = model && model !== "default" ? model : "google/gemini-2.5-flash-lite";
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `openrouter → ${apiModel}` })}\n\n`,
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
      const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/the-hyve-company/design-factory-app",
          "X-Title": "Design Factory",
        },
        body: JSON.stringify({ model: apiModel, messages, stream: true }),
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: `openrouter HTTP ${upstream.status}: ${errText.slice(0, 500)}` })}\n\n`,
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
            // 1 stabilize: empty completion → error, not silent done.
            if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
            res.write(
              `event: result\ndata: ${JSON.stringify({ durationMs: Date.now() - turnStartedAt })}\n\n`,
            );
            if (full) {
              res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
            } else {
              res.write(
                `event: error\ndata: ${JSON.stringify({ error: "openrouter completed without text or artifact" })}\n\n`,
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
      // 1 stabilize: every turn ends with EXACTLY one final event —
      // success, empty-completion error, or real error. Pre-fix, an upstream
      // that closed the SSE stream without [DONE] AND without text would
      // silently skip emitting anything → frontend hung on the placeholder.
      if (full) {
        if (usage) res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
        res.write(
          `event: result\ndata: ${JSON.stringify({ durationMs: Date.now() - turnStartedAt })}\n\n`,
        );
        res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
      } else {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: "openrouter completed without text or artifact" })}\n\n`,
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
    const { readJson, getOpenrouterToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getOpenrouterToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no OpenRouter API key configured" }));
      return;
    }
    const { prompt, systemPrompt, model } = body;
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: typeof prompt === "string" ? prompt : "" });
    try {
      const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/the-hyve-company/design-factory-app",
          "X-Title": "Design Factory",
        },
        body: JSON.stringify({
          model: model && model !== "default" ? model : "google/gemini-2.5-flash-lite",
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

export default openrouter;
