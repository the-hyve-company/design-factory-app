// Anthropic API adapter — BYOK, no CLI spawn.
//
// Proxies api.anthropic.com/v1/messages with the user's saved token.
// Default model = claude-sonnet-4-6 (the current sonnet). Token storage
// at ~/.config/design-factory/anthropic.json (chmod 600), or
// ANTHROPIC_API_KEY env override.
//
// Capabilities: streaming, multimodal. No tools (BYOK skips Claude Code's
// tool-use orchestration — for that, use the `claude` adapter). No
// sessions (API is stateless). No MCP, no Path A.
//
// @file providers/anthropic.mjs

import { extractImageAttachments } from "../lib/image-attachments.mjs";

/** @type {import("./types.mjs").ProviderAdapter} */
const anthropic = {
  id: "anthropic",
  label: "Anthropic API",
  // beta. Direct API path (no CLI dependency) tested for stream +
  // once. No tools / sessions on this surface by design.
  readiness: "beta",
  capabilities: {
    streaming: true,
    tools: false,
    multimodal: true,
    sessions: false,
    mcp: false,
    // Anthropic API direct: text stream only, no tool loop in the
    // daemon's pipeAnthropicStream. Runtime parses <artifact>.
    fileWrite: "artifact",
  },

  async stream(req, res, deps) {
    const { readJson, getAnthropicToken, pipeAnthropicStream } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getAnthropicToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "no Anthropic API key configured. PUT /config/anthropic { token } or export ANTHROPIC_API_KEY.",
        }),
      );
      return;
    }
    const { prompt, systemPrompt, model, maxTokens } = body;
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
    // Inline any [attached image: PATH] markers as base64 vision blocks —
    // the API can't read the user's disk like the CLI providers can.
    const { text: userText, images } = extractImageAttachments(prompt);
    const userContent =
      images.length > 0
        ? [
            { type: "text", text: userText },
            ...images.map((im) => ({
              type: "image",
              source: { type: "base64", media_type: im.mime, data: im.base64 },
            })),
          ]
        : prompt;
    const apiBody = {
      model: model && model !== "default" ? model : "claude-sonnet-4-6",
      max_tokens: maxTokens || 8192,
      messages: [{ role: "user", content: userContent }],
      stream: true,
    };
    if (systemPrompt) apiBody.system = systemPrompt;
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `anthropic api → ${apiBody.model}` })}\n\n`,
    );
    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(apiBody),
      });
      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "");
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: `anthropic api ${upstream.status}: ${errText.slice(0, 500)}` })}\n\n`,
        );
        res.end();
        return;
      }
      await pipeAnthropicStream(upstream, res);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
      res.end();
    }
  },

  async once(req, res, deps) {
    const { readJson, getAnthropicToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getAnthropicToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no Anthropic API key configured" }));
      return;
    }
    const { prompt, systemPrompt, model, maxTokens } = body;
    const apiBody = {
      model: model && model !== "default" ? model : "claude-sonnet-4-6",
      max_tokens: maxTokens || 8192,
      messages: [{ role: "user", content: typeof prompt === "string" ? prompt : "" }],
    };
    if (systemPrompt) apiBody.system = systemPrompt;
    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(apiBody),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: text.slice(0, 1000) }));
        return;
      }
      const parsed = JSON.parse(text);
      const out = (parsed.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
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

export default anthropic;
