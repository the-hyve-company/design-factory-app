// Ollama bridge — HTTP/SSE client for the daemon's /ollama/* endpoints.
// Ollama runs as a server on :11434 (no CLI spawn), so the daemon proxies
// /api/chat (stream + non-stream) and /api/tags (model list). NDJSON lines
// from Ollama are translated by the daemon into the same SSE event vocabulary
// the other adapters use.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface OllamaConfig extends ClaudeConfig {
  // No Ollama-specific knobs yet — model is passed through ClaudeConfig.model
}

async function streamOllamaViaBridge(
  prompt: string,
  config: OllamaConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/ollama/stream`, {
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
        callbacks.onError(`bridge HTTP ${res.status}`);
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
          try { data = JSON.parse(dataStr); } catch { continue; }
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
    try { controller.abort(); } catch {}
  };
}

export function streamOllama(
  prompt: string,
  config: OllamaConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamOllamaViaBridge(prompt, config, callbacks);
}

export async function ollamaOnce(
  prompt: string,
  config: OllamaConfig = {},
): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/ollama/once`, {
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

/** List models installed in the local Ollama server. Empty array if Ollama
 *  is not running or no models pulled. */
export async function fetchOllamaModels(): Promise<{ id: string; sub: string }[]> {
  try {
    const res = await fetch(`${BRIDGE_URL}/ollama/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { id: string; sub: string }[] };
    return body.models ?? [];
  } catch {
    return [];
  }
}

/** Detailed status — distinguishes server-offline from server-up-no-models.
 *  The status() panel surfaces the specific failure so the user can act
 *  (start Ollama vs. `ollama pull <model>`). */
export interface OllamaStatus {
  models: { id: string; sub: string }[];
  /** Daemon-side error string when the probe failed (ECONNREFUSED,
   *  timeout, or HTTP non-200). Null when models came back successfully. */
  error: string | null;
  /** Which host the daemon actually reached, when successful. Helps
   *  diagnose DF_OLLAMA_HOST overrides + IPv4/IPv6/localhost issues. */
  host: string | null;
  /** Hosts the daemon attempted in order. Empty when DF_OLLAMA_HOST was
   *  set (only one attempt). */
  triedHosts: string[];
}

export async function fetchOllamaStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${BRIDGE_URL}/ollama/models`);
    if (!res.ok) {
      return { models: [], error: `daemon HTTP ${res.status}`, host: null, triedHosts: [] };
    }
    const body = (await res.json()) as {
      models?: { id: string; sub: string }[];
      error?: string;
      host?: string;
      triedHosts?: string[];
    };
    return {
      models: body.models ?? [],
      error: body.error ?? null,
      host: body.host ?? null,
      triedHosts: body.triedHosts ?? [],
    };
  } catch (e) {
    return { models: [], error: String(e), host: null, triedHosts: [] };
  }
}
