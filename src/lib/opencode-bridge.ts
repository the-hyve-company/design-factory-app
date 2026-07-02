// opencode bridge — HTTP/SSE client for the daemon's /opencode/* endpoints.
// opencode (sst.dev) is an MIT-licensed agent CLI similar to Claude Code /
// Codex. The daemon spawns `opencode run --format json` and forwards the
// JSONL events as SSE: text chunks PLUS `tool_call` / `tool_result` frames
// (the daemon already coerces opencode's ACP tool vocabulary — apply_patch/
// write/edit/bash/read — into the canonical Write/Edit/Bash/Read shape with
// `file_path` inputs; see apps/daemon/src/providers/opencode.mjs).
//
// This client used to parse only text/error/done, silently dropping the
// tool frames — which is why opencode escaped the tool-channel craft net
// (audit WS1 `craft-net-10-10`: "opencode emits no tool events" was true
// only of THIS parser). Now the frames are forwarded to onToolCall /
// onToolResult so the pipeline's post-finalize read-back (the same
// mechanism that covers Codex path-only writes) reaches opencode too.

import {
  BRIDGE_URL,
  type ClaudeConfig,
  type StreamCallbacks,
  type UnlistenFn,
} from "@/lib/claude-bridge";

export interface OpencodeConfig extends ClaudeConfig {
  // No opencode-specific knobs yet
}

async function streamOpencodeViaBridge(
  prompt: string,
  config: OpencodeConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/opencode/stream`, {
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
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        callbacks.onError(body?.error ?? `bridge HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      // opencode sometimes emits tool frames with a null callID. Synthesize
      // a stable per-stream id for calls so downstream dedup/normalization
      // (which requires a string id) doesn't drop the Write events the
      // craft net needs. Results with no id have nothing to correlate to
      // and are dropped — harmless, the craft net keys off tool_call.
      let syntheticToolSeq = 0;
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
          } else if (event === "tool_call" && data && typeof data.name === "string") {
            callbacks.onToolCall?.({
              id:
                typeof data.id === "string" && data.id
                  ? data.id
                  : `opencode-call-${++syntheticToolSeq}`,
              name: data.name,
              input:
                data.input && typeof data.input === "object" && !Array.isArray(data.input)
                  ? data.input
                  : {},
            });
          } else if (event === "tool_result" && data && typeof data.id === "string" && data.id) {
            callbacks.onToolResult?.({
              id: data.id,
              isError: data.isError === true,
              content: typeof data.content === "string" ? data.content : "",
            });
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

export function streamOpencode(
  prompt: string,
  config: OpencodeConfig,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  return streamOpencodeViaBridge(prompt, config, callbacks);
}

export async function opencodeOnce(prompt: string, config: OpencodeConfig = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/opencode/once`, {
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
