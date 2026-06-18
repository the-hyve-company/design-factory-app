// Gemini API BYOK adapter — direct Google AI Studio Chat Completions API
// via the OpenAI-compatible endpoint.
//
// BYOK with token at ~/.config/design-factory/gemini.json or GEMINI_API_KEY
// (or GOOGLE_API_KEY) env. Default model = gemini-2.0-flash. The
// generativelanguage.googleapis.com endpoint speaks OpenAI's wire format
// when called under /v1beta/openai, so the streaming code mirrors the
// OpenAI/OpenRouter adapters exactly.
//
// Distinct from the `gemini` CLI provider — that one uses OAuth via the
// Gemini CLI binary; this one is a direct API call with a key.
//
// @file providers/gemini-api.mjs

import { extractImageAttachments } from "../lib/image-attachments.mjs";

// Default 2026-05-15: gemini-2.5-flash-lite — cheapest GA model with
// reliable free-tier quota. User asked for 3.1-flash-lite but that's
// preview-only with the same free-tier 429s as 2.5 had. Users who want
// 3.1 can pick it from the model dropdown.
const GEMINI_API_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** @type {import("./types.mjs").ProviderAdapter} */
const geminiApi = {
  id: "gemini-api",
  label: "Gemini API",
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
    const { readJson, getGeminiApiToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getGeminiApiToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "no Gemini API key configured. PUT /config/gemini { token } or export GEMINI_API_KEY.",
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
    // Inline [attached image: PATH] markers as base64 image_url parts —
    // Gemini's OpenAI-compat endpoint accepts the same shape.
    const { text: gUserText, images: gImages } = extractImageAttachments(prompt);
    messages.push(
      gImages.length > 0
        ? {
            role: "user",
            content: [
              { type: "text", text: gUserText },
              ...gImages.map((im) => ({
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
    const apiModel = model && model !== "default" ? model : GEMINI_API_DEFAULT_MODEL;
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "info", message: `gemini-api → ${apiModel}` })}\n\n`,
    );
    res.write(`event: meta\ndata: ${JSON.stringify({ model: apiModel })}\n\n`);
    const turnStartedAt = Date.now();

    const controller = new AbortController();
    // F3.1 — Hard 90s ceiling so a hung TLS/DNS resolve doesn't leave the
    // client showing a "thinking" state indefinitely. Observed:
    // a Gemini turn ended with "[error] TypeError: network
    // error" with no further detail because the catch block below
    // stringified the bare TypeError. The ceiling fires an AbortError that
    // we now translate into a designer-friendly message.
    let timeoutFired = false;
    const timeoutHandle = setTimeout(() => {
      timeoutFired = true;
      try {
        controller.abort();
      } catch {}
    }, 90_000);
    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
      try {
        controller.abort();
      } catch {}
    });

    try {
      const upstream = await fetch(GEMINI_API, {
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
          `event: error\ndata: ${JSON.stringify({ error: `gemini-api HTTP ${upstream.status}: ${errText.slice(0, 500)}` })}\n\n`,
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
                `event: error\ndata: ${JSON.stringify({ error: "gemini-api completed without text or artifact" })}\n\n`,
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
            // F-fix: translate OpenAI snake_case → frontend camelCase.
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
          `event: error\ndata: ${JSON.stringify({ error: "gemini-api completed without text or artifact" })}\n\n`,
        );
      }
      res.end();
    } catch (err) {
      // F3.1 — Unwrap the error: undici's bare-looking "TypeError: fetch
      // failed" usually has the actual cause one level deep (Error.cause).
      // Without surfacing that, the client only sees "TypeError: network
      // error" and can't tell whether it's DNS, TLS, timeout, or upstream
      //5xx. The branches below translate the common ones into a
      // designer-friendly message; everything else falls back to the
      // unwrapped chain so the bug report has real signal.
      if (err?.name === "AbortError") {
        if (timeoutFired) {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: "Gemini API timeout (90s). Verifique a conexão ou tente outro modelo." })}\n\n`,
          );
        } else if (!clientClosed) {
          // Aborts without a known cause are rare — surface them so we
          // can investigate. Client-close aborts stay silent (intentional
          // user cancel — there's nothing to render).
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: "Gemini API aborted unexpectedly." })}\n\n`,
          );
        }
      } else {
        const cause = err?.cause;
        const causeMsg = cause?.message || cause?.code || String(cause ?? "");
        const detail =
          causeMsg && causeMsg !== "undefined" && causeMsg !== ""
            ? `${err?.message || err}: ${causeMsg}`
            : String(err?.message || err);
        // Common undici causes get human translations.
        const lower = detail.toLowerCase();
        let surfaced;
        if (lower.includes("enotfound") || lower.includes("eai_again") || lower.includes("dns")) {
          surfaced = `Gemini API DNS error (${detail}). Verifique se o container resolve generativelanguage.googleapis.com.`;
        } else if (
          lower.includes("certificate") ||
          lower.includes("tls") ||
          lower.includes("self-signed")
        ) {
          surfaced = `Gemini API TLS error (${detail}). Verifique CA root certificates.`;
        } else if (
          lower.includes("econnreset") ||
          lower.includes("socket hang up") ||
          lower.includes("etimedout")
        ) {
          surfaced = `Gemini API connection dropped (${detail}). Tente novamente.`;
        } else {
          surfaced = detail;
        }
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: `gemini-api: ${surfaced}` })}\n\n`,
        );
      }
      res.end();
    } finally {
      clearTimeout(timeoutHandle);
    }
  },

  async once(req, res, deps) {
    const { readJson, getGeminiApiToken } = deps;
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = await getGeminiApiToken();
    if (!token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no Gemini API key configured" }));
      return;
    }
    const { prompt, systemPrompt, model } = body;
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: typeof prompt === "string" ? prompt : "" });
    try {
      const upstream = await fetch(GEMINI_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model && model !== "default" ? model : GEMINI_API_DEFAULT_MODEL,
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

export default geminiApi;
