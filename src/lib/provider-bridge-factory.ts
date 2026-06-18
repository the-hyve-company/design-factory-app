// Generic provider bridge factory — .
//
// Every adapter added (cursor, copilot, crush, aider, qwen,
// deepseek) speaks the same SSE vocabulary at the daemon ("event: text"
// / "event: usage" / "event: error" / "event: done"). Rather than copy-
// paste 100-line bridges per provider (as v0– did for the original
// seven), we factor the shared logic here and let per-provider bridges
// reduce to a 1-line factory call.
//
// This file owns the wire-format coupling. If a provider needs custom
// translation (claude-stream-json, codex JSONL, gemini structured), it
// keeps its hand-written bridge — those continue to live in
// claude-bridge / codex-bridge / gemini-bridge.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface GenericProviderBridge {
  stream: (prompt: string, config: ClaudeConfig, callbacks: StreamCallbacks) => Promise<UnlistenFn>;
  once: (prompt: string, config?: ClaudeConfig) => Promise<string>;
}

/**
 * Factory: returns { stream, once } that hit /<endpoint>/stream and
 * /<endpoint>/once. The daemon must already speak the shared SSE
 * vocabulary (see opencode/openrouter adapter for reference).
 *
 * `endpoint` is the URL slug, NOT including the leading slash. Example:
 *   makeProviderBridge("kimi") → POST /kimi/stream + /kimi/once.
 */
export function makeProviderBridge(endpoint: string): GenericProviderBridge {
  async function stream(
    prompt: string,
    config: ClaudeConfig,
    callbacks: StreamCallbacks,
  ): Promise<UnlistenFn> {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/${endpoint}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            systemPrompt: config.systemPrompt,
            model: config.model,
            cwd: config.cwd,
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
        // 1 stabilize (regression report): when the upstream
        // adapter emits `event: done`, we MUST NOT also fire onDone again
        // from the post-loop fallback below. The pre-fix path emitted
        // onDone twice for any provider that completed normally — the UI
        // saw a duplicate persistence + bubble snapshot. The flag here
        // gates the fallback to ONLY the missing-done case (provider
        // closed the stream without emitting done — possible on adapter
        // bugs or upstream truncation).
        let doneEmitted = false;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              doneEmitted = true;
              callbacks.onDone(typeof data.content === "string" ? data.content : full);
            }
          }
        }
        // Fallback: only fire onDone if the adapter never emitted one. If
        // the stream completed without text AND without an explicit done,
        // surface an empty-completion error instead of silence — see
        // Frente 3 / agent-contract §10.
        if (!doneEmitted) {
          if (full) {
            callbacks.onDone(full);
          } else {
            callbacks.onError("provider completed without text or artifact");
          }
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((err as any)?.name === "AbortError") return;
        callbacks.onError(String(err));
      }
    })();
    return () => {
      try {
        controller.abort();
      } catch {}
    };
  }

  async function once(prompt: string, config: ClaudeConfig = {}): Promise<string> {
    const res = await fetch(`${BRIDGE_URL}/${endpoint}/once`, {
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

  return { stream, once };
}
