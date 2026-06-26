// Gemini bridge — HTTP/SSE client for the daemon's /gemini/* endpoints.
// Mirrors claude-bridge / codex-bridge so the provider adapter can swap them
// transparently. Daemon translates Gemini's stream-json events into the same
// SSE event vocabulary so the parser stays generic.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export type GeminiConfig = ClaudeConfig;

async function streamGeminiViaBridge(
  prompt: string,
  config: GeminiConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/gemini/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: config.systemPrompt,
          model: config.model,
          cwd: config.cwd,
          // : when present, daemon spawns `gemini --resume <id>`
          // instead of fresh start. Falls back to canonical-handoff on
          // resume failure (see prepare-turn-context.ts).
          sessionId: config.sessionId ?? undefined,
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
          } else if (event === "meta" && data) {
            callbacks.onMeta?.(data);
          } else if (event === "usage" && data) {
            callbacks.onUsage?.(data);
          } else if (event === "tool_call" && data) {
            callbacks.onToolCall?.(data);
          } else if (event === "tool_result" && data) {
            callbacks.onToolResult?.(data);
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

export function streamGemini(
  prompt: string,
  config: GeminiConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamGeminiViaBridge(prompt, config, callbacks);
}

export async function geminiOnce(prompt: string, config: GeminiConfig = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/gemini/once`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      systemPrompt: config.systemPrompt,
      model: config.model,
      cwd: config.cwd,
    }),
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = (await res.json()) as { text?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.text ?? "";
}
