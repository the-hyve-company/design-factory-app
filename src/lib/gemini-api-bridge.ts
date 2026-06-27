// Gemini API bridge — HTTP/SSE client for the daemon's /gemini-api/*
// endpoints. Direct Google AI Studio Chat Completions via the
// OpenAI-compatible endpoint, BYOK key.
//
// Distinct from the `gemini` CLI provider: the CLI uses OAuth via the
// gemini binary; this bridge talks to generativelanguage.googleapis.com
// with an API key.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface GeminiApiConfig extends ClaudeConfig {}

async function streamGeminiApiViaBridge(
  prompt: string,
  config: GeminiApiConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/gemini-api/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: config.systemPrompt,
          model: config.model,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        callbacks.onError(body?.error ?? `bridge HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.trim()) continue;
          let event = "message";
          let dataStr = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          let data: any;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          if (event === "text" && typeof data.content === "string") {
            full += data.content;
            callbacks.onText(data.content);
          } else if (event === "usage" && data) {
            callbacks.onUsage?.(data);
          } else if (event === "error") {
            callbacks.onError(data.error ?? "Unknown error");
          } else if (event === "done") {
            callbacks.onDone(typeof data.content === "string" ? data.content : full);
          }
        }
      }
      if (full) callbacks.onDone(full);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      callbacks.onError(String(err));
    }
  })();
  return () => {
    try {
      controller.abort();
    } catch {}
  };
}

export function streamGeminiApi(
  prompt: string,
  config: GeminiApiConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamGeminiApiViaBridge(prompt, config, callbacks);
}

export async function geminiApiOnce(prompt: string, config: GeminiApiConfig = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/gemini-api/once`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      systemPrompt: config.systemPrompt,
      model: config.model,
    }),
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { text?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.text ?? "";
}

/** Token storage: GET reports tokenSet without revealing the value, PUT
 *  writes it to ~/.design-factory/gemini.json (chmod 600). Env vars
 *  GEMINI_API_KEY / GOOGLE_API_KEY take precedence. */
export async function getGeminiApiTokenStatus(): Promise<{
  tokenSet: boolean;
  source: "env" | "disk" | null;
}> {
  const res = await fetch(`${BRIDGE_URL}/config/gemini`);
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  return res.json();
}

export async function setGeminiApiToken(token: string): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/config/gemini`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `bridge HTTP ${res.status}`);
  }
}
