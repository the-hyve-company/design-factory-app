// Codex bridge — HTTP/SSE client for the daemon's /codex/* endpoints.
// Mirrors claude-bridge's surface so the provider adapter can swap them
// transparently. The unified ClaudeStreamEvent / StreamCallbacks shapes
// from claude-bridge are reused — daemon translates Codex's `exec --json`
// events into the same SSE event vocabulary, so the parser logic here
// stays in lockstep with the Claude one.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface CodexConfig extends ClaudeConfig {
  /** Codex-specific reasoning effort: minimal | low | medium | high. */
  reasoning?: "default" | "minimal" | "low" | "medium" | "high";
}

async function streamCodexViaBridge(
  prompt: string,
  config: CodexConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/codex/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: config.systemPrompt,
          model: config.model,
          cwd: config.cwd,
          reasoning: config.reasoning,
          // : when present, daemon spawns `codex resume <UUID>`
          // instead of `codex exec`. Falls back to canonical-handoff on
          // resume failure (see prepare-turn-context.ts).
          sessionId: config.sessionId ?? undefined,
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

export function streamCodex(
  prompt: string,
  config: CodexConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamCodexViaBridge(prompt, config, callbacks);
}

export async function codexOnce(prompt: string, config: CodexConfig = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/codex/once`, {
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
