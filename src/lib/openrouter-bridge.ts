// OpenRouter bridge — HTTP/SSE client for the daemon's /openrouter/* endpoints.
// OpenRouter is a OpenAI-compatible proxy that fans out to 200+ models
// (open-weights + paid). The daemon translates OpenAI's `data: {...}\n\n`
// SSE format into the same event vocabulary the other adapters use.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface OpenrouterConfig extends ClaudeConfig {
  // No OpenRouter-specific knobs yet — model is passed through ClaudeConfig.model
}

async function streamOpenrouterViaBridge(
  prompt: string,
  config: OpenrouterConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/openrouter/stream`, {
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

export function streamOpenrouter(
  prompt: string,
  config: OpenrouterConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamOpenrouterViaBridge(prompt, config, callbacks);
}

export async function openrouterOnce(
  prompt: string,
  config: OpenrouterConfig = {},
): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/openrouter/once`, {
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

/** Token storage: GET reports tokenSet without revealing the value, PUT writes
 *  the token to ~/.design-factory/openrouter.json (chmod 600). Env var
 *  OPENROUTER_API_KEY takes precedence so power users can shell-export. */
export async function getOpenrouterTokenStatus(): Promise<{
  tokenSet: boolean;
  source: "env" | "disk" | null;
}> {
  const res = await fetch(`${BRIDGE_URL}/config/openrouter`);
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  return res.json();
}

export async function setOpenrouterToken(token: string): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/config/openrouter`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `bridge HTTP ${res.status}`);
  }
}

/** Fetch the public OpenRouter model list. Empty array if unreachable. */
export async function fetchOpenrouterModels(): Promise<{ id: string; sub: string }[]> {
  try {
    const res = await fetch(`${BRIDGE_URL}/openrouter/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { id: string; sub: string }[] };
    return body.models ?? [];
  } catch {
    return [];
  }
}
