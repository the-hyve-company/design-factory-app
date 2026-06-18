// Anthropic API BYOK bridge — talks to the daemon's /anthropic/* endpoints,
// which proxy api.anthropic.com using a token persisted at
// ~/.design-factory/anthropic.json (or ANTHROPIC_API_KEY env var).
//
// This is the BYOK fallback path: when no Claude Code CLI is installed but
// the user has an Anthropic API key, they can still use the app. The
// stream events are translated by the daemon to the same SSE shape as the
// other providers — frontend stays agnostic.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface AnthropicConfig extends ClaudeConfig {
  /** Override max_tokens. Daemon defaults to 8192. */
  maxTokens?: number;
}

async function streamAnthropicViaBridge(
  prompt: string,
  config: AnthropicConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/anthropic/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: config.systemPrompt,
          model: config.model,
          maxTokens: config.maxTokens,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        callbacks.onError(
          `bridge HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
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
          } else if (event === "meta" && data) {
            callbacks.onMeta?.(data);
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

export function streamAnthropic(
  prompt: string,
  config: AnthropicConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamAnthropicViaBridge(prompt, config, callbacks);
}

export async function anthropicOnce(prompt: string, config: AnthropicConfig = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/anthropic/once`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      systemPrompt: config.systemPrompt,
      model: config.model,
      maxTokens: config.maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`bridge HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json()) as { text?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.text ?? "";
}

// Token management — Settings UI uses these to read state and persist a
// token without ever transmitting the actual value back to the browser.
export interface AnthropicTokenState {
  tokenSet: boolean;
  source: "env" | "disk" | null;
}

export async function getAnthropicTokenState(): Promise<AnthropicTokenState> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/anthropic`);
    if (!res.ok) return { tokenSet: false, source: null };
    return (await res.json()) as AnthropicTokenState;
  } catch {
    return { tokenSet: false, source: null };
  }
}

export async function saveAnthropicToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/anthropic`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
