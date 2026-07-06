// stream-wirers.mjs — per-provider stream parsers, extracted from
// index.mjs (audit WS3 `provider-stream-golden-fixtures`).
//
// These four functions translate each provider's NATIVE stream shape
// into the canonical DF SSE vocabulary (session / meta / text /
// tool_call / tool_result / usage / result / done / error /
// auth_required). They are pure with respect to module state — every
// dependency arrives via arguments (child process or upstream
// Response, plus the HTTP res) — which is exactly why they live in
// their own module now: index.mjs starts the HTTP server on import, so
// the parsers were untestable in-place. The golden fixture suite
// (providers/stream-golden.test.mjs) feeds captured/representative
// native streams through these and asserts the normalized events.
//
//   wireStreamJson      claude CLI    --output-format stream-json (NDJSON)
//   wireCodexJson       codex CLI     exec --json (NDJSON items)
//   wireGeminiJson      gemini CLI    --output-format stream-json (NDJSON)
//   pipeAnthropicStream anthropic API SSE (event:/data: frames)
//
// The other six providers parse inside their adapters
// (providers/*.mjs) and are covered by the same golden suite via
// injected deps (fetch stub for the HTTP APIs, deps.spawn fake for
// kimi/opencode).

// Parse claude stream-json → emit SSE session / text / meta / usage / tool_call / tool_result / result / done / error / auth_required.
export function wireStreamJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let got_error = null;
  let stderrBuffer = "";
  let authFlagged = false;
  // content_block index → { type, name?, id?, inputBuf? } so we can accumulate
  // input_json_delta chunks and emit a complete tool_call at content_block_stop.
  const blocks = new Map();
  // Track tool_use_id → content_block index when tool_result surfaces in user turns.
  const toolUseIds = new Map();
  // Per-stream marker: did stream_event deltas already emit text? When
  // --include-partial-messages is OFF (older Claude Code builds, or builds
  // without the flag), text only arrives in the final `assistant` wrapper —
  // we have to emit it from there. When deltas fired, we skip the wrapper
  // to avoid duplication. Tracked per assistant-message-id so multi-turn
  // (tool_use → tool_result → next assistant) works correctly.
  const textStreamedMessages = new Set();
  // Tracks the currently-open assistant message id from the latest
  // `message_start` stream_event. Used so text_delta events can mark
  // the correct id in textStreamedMessages. Previous code derived msgId
  // as `val.parent_tool_use_id ?? val.message?.id` which is wrong:
  // parent_tool_use_id is the PARENT TOOL id (sub-agent context, not
  // an assistant message id), and val.message doesn't exist on
  // stream_event. Result: msgId was always undefined for root assistant
  // text → dedup never fired → wrapper re-emitted → text duplicated.
  let currentStreamMessageId = null;
  // Same idea for tool_use inputs — when stream_event content_block_stop
  // fires a complete tool_call, we mark the id so the wrapper-only path
  // doesn't duplicate it.
  const toolCallEmittedIds = new Set();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;
      // The very first line of a claude stream-json run carries session_id.
      // Pipe it to the UI so it can persist against the current project for
      // the next `--resume` spawn. Firing before any other event keeps the
      // handshake surface small.
      if (t === "system" && val.subtype === "init" && typeof val.session_id === "string") {
        res.write(`event: session\ndata: ${JSON.stringify({ sessionId: val.session_id })}\n\n`);
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: `session_id=${val.session_id}` })}\n\n`,
        );
      }
      if (t === "stream_event") {
        const ev = val.event;
        if (ev?.type === "message_start") {
          const msg = ev.message ?? {};
          // Latch the message id so subsequent text_deltas in this same
          // assistant message can mark it in textStreamedMessages with
          // the SAME id that the final assistant wrapper will use.
          if (typeof msg.id === "string") currentStreamMessageId = msg.id;
          res.write(
            `event: meta\ndata: ${JSON.stringify({
              model: msg.model,
              ttftMs: typeof val.ttft_ms === "number" ? val.ttft_ms : undefined,
              inputTokens: msg.usage?.input_tokens,
              cacheReadTokens: msg.usage?.cache_read_input_tokens,
              cacheCreationTokens: msg.usage?.cache_creation_input_tokens,
            })}\n\n`,
          );
        } else if (ev?.type === "message_stop") {
          currentStreamMessageId = null;
        } else if (ev?.type === "content_block_start") {
          const i = ev.index;
          const cb = ev.content_block ?? {};
          if (cb.type === "tool_use") {
            blocks.set(i, { type: "tool_use", id: cb.id, name: cb.name, inputBuf: "" });
            toolUseIds.set(cb.id, i);
          } else if (cb.type === "thinking") {
            blocks.set(i, { type: "thinking" });
          } else {
            blocks.set(i, { type: cb.type });
          }
        } else if (ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta") {
          const text = ev.delta.text ?? "";
          if (text) {
            full += text;
            res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
            // Mark the currently-open assistant message so the wrapper
            // handler at L702 skips re-emitting these deltas. We use
            // `currentStreamMessageId` (latched at message_start) which
            // matches the wrapper's `val.message.id`. parent_tool_use_id
            // is preserved as a fallback for sub-agent flows that don't
            // emit a top-level message_start.
            const msgId = currentStreamMessageId ?? val.parent_tool_use_id ?? null;
            if (msgId) textStreamedMessages.add(msgId);
          }
        } else if (ev?.type === "content_block_delta" && ev?.delta?.type === "input_json_delta") {
          const i = ev.index;
          const blk = blocks.get(i);
          if (blk && blk.type === "tool_use") {
            blk.inputBuf += ev.delta.partial_json ?? "";
          }
        } else if (ev?.type === "content_block_stop") {
          const i = ev.index;
          const blk = blocks.get(i);
          if (blk && blk.type === "tool_use") {
            let input = {};
            try {
              input = blk.inputBuf ? JSON.parse(blk.inputBuf) : {};
            } catch {
              input = { _raw: blk.inputBuf };
            }
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({ id: blk.id, name: blk.name, input })}\n\n`,
            );
            if (blk.id) toolCallEmittedIds.add(blk.id);
          }
        } else if (ev?.type === "message_delta") {
          const usage = ev.usage ?? {};
          res.write(
            `event: usage\ndata: ${JSON.stringify({
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens,
              cacheCreationTokens: usage.cache_creation_input_tokens,
              stopReason: ev.delta?.stop_reason,
            })}\n\n`,
          );
        }
      } else if (t === "assistant" && val.message && Array.isArray(val.message.content)) {
        // Final assistant wrapper. When --include-partial-messages is ON
        // (newer Claude Code), text already streamed via stream_event
        // deltas — skip to avoid duplication. When OFF (older builds, or
        // when the flag wasn't available at probe time), this is the
        // only place text shows up. Same logic for tool_use blocks.
        const msgId = val.message.id;
        const alreadyStreamedText = msgId && textStreamedMessages.has(msgId);
        for (const block of val.message.content) {
          if (
            block?.type === "text" &&
            typeof block.text === "string" &&
            block.text &&
            !alreadyStreamedText
          ) {
            full += block.text;
            res.write(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`);
          } else if (
            block?.type === "tool_use" &&
            typeof block.id === "string" &&
            !toolCallEmittedIds.has(block.id)
          ) {
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: block.id,
                name: typeof block.name === "string" ? block.name : "",
                input: block.input ?? {},
              })}\n\n`,
            );
            toolCallEmittedIds.add(block.id);
          }
        }
      } else if (t === "user" && Array.isArray(val.message?.content)) {
        // tool_result is nested as a user-turn message in the transcript
        for (const part of val.message.content) {
          if (part?.type === "tool_result") {
            let snippet = "";
            if (typeof part.content === "string") snippet = part.content;
            else if (Array.isArray(part.content)) {
              snippet = part.content
                .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
                .filter(Boolean)
                .join("\n");
            }
            res.write(
              `event: tool_result\ndata: ${JSON.stringify({
                id: part.tool_use_id,
                isError: !!part.is_error,
                content: snippet.slice(0, 2000),
              })}\n\n`,
            );
          }
        }
      } else if (t === "result") {
        if (val.is_error) {
          got_error = val.result || val.api_error_status || "claude CLI reported error";
        } else {
          if (!full && typeof val.result === "string") full = val.result;
          res.write(
            `event: result\ndata: ${JSON.stringify({
              durationMs: val.duration_ms,
              durationApiMs: val.duration_api_ms,
              costUsd: val.total_cost_usd,
              inputTokens: val.usage?.input_tokens,
              outputTokens: val.usage?.output_tokens,
              cacheReadTokens: val.usage?.cache_read_input_tokens,
              cacheCreationTokens: val.usage?.cache_creation_input_tokens,
              stopReason: val.stop_reason,
              numTurns: val.num_turns,
            })}\n\n`,
          );
        }
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    // Forward to the browser debug channel as SSE "log" events (clipped).
    const cleaned = chunk.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!cleaned) return;
    // Bounded accumulation — used by the close handler to replay stderr
    // as a synthetic tool_result when the child dies unexpectedly.
    if (stderrBuffer.length < 16_384) {
      stderrBuffer += cleaned + "\n";
    }
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "warn", message: `claude stderr: ${cleaned.slice(0, 400)}` })}\n\n`,
    );
    // Auth-failure fingerprint. Fire once per stream so the UI doesn't flash
    // the banner repeatedly if the CLI retries internally.
    if (!authFlagged) {
      const lower = cleaned.toLowerCase();
      if (
        lower.includes("not authenticated") ||
        lower.includes("login required") ||
        lower.includes("authentication failed") ||
        / 401(\b|$)/.test(lower)
      ) {
        authFlagged = true;
        res.write(
          `event: auth_required\ndata: ${JSON.stringify({ detail: "Run `claude login` in your terminal." })}\n\n`,
        );
      }
    }
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    // On non-zero exit, surface the accumulated stderr tail as a synthetic
    // tool_result (isError: true) so the user sees the raw crash text
    // in the chat, not just a terse exit-code line.
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (got_error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: got_error })}\n\n`);
    } else if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      const suffix = tail ? ` — stderr: ${tail}` : "";
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `claude exited with code ${code}${suffix}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but no text/Write → silent fail.
      // Surface as error so frontend renders red bubble; don't emit a
      // bogus done({content: ""}) that the chat persists as empty assistant.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "claude completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// ─── Codex stream wiring ─────────────────────────────────────────────
// Translates Codex's `exec --json` event stream into the same SSE events
// the frontend expects from /claude/stream. Event shapes documented at
// https://github.com/openai/codex (item.started/item.completed/turn.*).
//
// The Codex stream is line-delimited JSON; each line is one event. We emit:
//   event: log — for lifecycle markers (thread.started / turn.started)
//   event: meta — model id (extracted from thread.started if present)
//   event: tool_call — command_execution at item.started
//   event: tool_result — command_execution at item.completed
//   event: text — agent_message at item.completed (full text, not deltas)
//   event: usage — turn.completed.usage
//   event: done — when child exits
//   event: error — when child errors or non-zero exit with stderr
export function wireCodexJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let stderrBuffer = "";
  const seenToolUses = new Set();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;

      if (t === "thread.started") {
        // Resume parity (audit WS3 `resume-parity-all-capable`): the
        // thread_id IS the UUID `codex resume <UUID>` takes. Emit the
        // canonical session event so the UI can persist it per-provider —
        // before this, only Claude's wirer surfaced a session id and
        // codex resume was declared but never reachable.
        if (typeof val.thread_id === "string" && val.thread_id.length > 0) {
          res.write(`event: session\ndata: ${JSON.stringify({ sessionId: val.thread_id })}\n\n`);
        }
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: `codex thread ${val.thread_id ?? ""}` })}\n\n`,
        );
        if (val.model) {
          res.write(`event: meta\ndata: ${JSON.stringify({ model: val.model })}\n\n`);
        }
      } else if (t === "turn.started") {
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: "turn running" })}\n\n`,
        );
      } else if (
        t === "item.started" &&
        val.item?.type === "command_execution" &&
        typeof val.item.id === "string"
      ) {
        const item = val.item;
        if (!seenToolUses.has(item.id)) {
          seenToolUses.add(item.id);
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({
              id: item.id,
              name: "Bash",
              input: { command: typeof item.command === "string" ? item.command : "" },
            })}\n\n`,
          );
        }
      } else if (
        t === "item.completed" &&
        val.item?.type === "command_execution" &&
        typeof val.item.id === "string"
      ) {
        const item = val.item;
        if (!seenToolUses.has(item.id)) {
          seenToolUses.add(item.id);
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({
              id: item.id,
              name: "Bash",
              input: { command: typeof item.command === "string" ? item.command : "" },
            })}\n\n`,
          );
        }
        const isError =
          typeof item.exit_code === "number" ? item.exit_code !== 0 : item.status === "failed";
        res.write(
          `event: tool_result\ndata: ${JSON.stringify({
            id: item.id,
            isError,
            content: typeof item.aggregated_output === "string" ? item.aggregated_output : "",
          })}\n\n`,
        );
      } else if (
        (t === "item.started" || t === "item.completed") &&
        val.item?.type === "file_change" &&
        Array.isArray(val.item?.changes) &&
        typeof val.item.id === "string"
      ) {
        // Codex `file_change` items: the CLI writes the file synchronously
        // via its sandboxed FS layer (no Bash, no command_execution event).
        // Without this branch the daemon was dropping every Write/Edit
        // silently — the file landed on disk but the UI never received a
        // tool_call so the iframe stayed empty until manual reload.
        // User QA 2026-05-18 — "comecei projeto com codex, nem veio prompt
        // nem começou a executar" (the prompt DID execute; only the
        // signalling was broken).
        const item = val.item;
        const change = item.changes[0] ?? {};
        const path = typeof change.path === "string" ? change.path : "";
        const kind = typeof change.kind === "string" ? change.kind : "add";
        const toolName = kind === "delete" ? "Delete" : kind === "update" ? "Edit" : "Write";
        if (t === "item.started") {
          if (!seenToolUses.has(item.id)) {
            seenToolUses.add(item.id);
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: item.id,
                name: toolName,
                input: { file_path: path },
              })}\n\n`,
            );
          }
        } else {
          // item.completed — emit tool_call for late-arriving items + result
          if (!seenToolUses.has(item.id)) {
            seenToolUses.add(item.id);
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: item.id,
                name: toolName,
                input: { file_path: path },
              })}\n\n`,
            );
          }
          const isError = item.status && item.status !== "completed";
          res.write(
            `event: tool_result\ndata: ${JSON.stringify({
              id: item.id,
              isError: !!isError,
              content: isError ? `status: ${item.status}` : `${kind} ${path}`,
            })}\n\n`,
          );
        }
      } else if (
        t === "item.completed" &&
        val.item?.type === "agent_message" &&
        typeof val.item.text === "string" &&
        val.item.text.length > 0
      ) {
        // Codex emits each paragraph of the assistant's prose as a separate
        // `agent_message` item. Concatenated without a separator they read as
        // one wall of text ("seções.O projeto ainda...A direção..."). Insert
        // a blank line between non-empty messages so the chat bubble renders
        // each thought as its own paragraph.
        const sep = full && !full.endsWith("\n") ? "\n\n" : "";
        const text = sep + val.item.text;
        full += text;
        res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
      } else if (t === "turn.completed" && val.usage) {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.usage.input_tokens,
            outputTokens: val.usage.output_tokens,
            cacheReadTokens: val.usage.cached_input_tokens,
          })}\n\n`,
        );
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `codex exit ${code}${tail ? ": " + tail : ""}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but empty agent_message stream →
      // silent fail. Surface as error.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "codex completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// ─── Gemini stream wiring ────────────────────────────────────────────
// Translates Gemini's `--output-format stream-json` events into the same
// SSE shape /claude/stream emits. Gemini's vocab is leaner than Codex/Claude:
//   { type: "init", model } → meta
//   { type: "message", role: "assistant", content: "..." } → text (each
//                                                               message is a
//                                                               full chunk)
//   { type: "result", stats: { ... } } → usage
export function wireGeminiJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;

      if (t === "init") {
        // Resume parity (audit WS3 `resume-parity-all-capable`): gemini's
        // init event carries the session id `gemini --resume <id>` takes
        // (field name varies across CLI builds — accept both spellings).
        // Emit the canonical session event so the UI can persist it.
        const gSession = typeof val.session_id === "string" ? val.session_id : val.sessionId;
        if (typeof gSession === "string" && gSession.length > 0) {
          res.write(`event: session\ndata: ${JSON.stringify({ sessionId: gSession })}\n\n`);
        }
        res.write(`event: meta\ndata: ${JSON.stringify({ model: val.model })}\n\n`);
      } else if (
        t === "message" &&
        val.role === "assistant" &&
        typeof val.content === "string" &&
        val.content.length > 0
      ) {
        full += val.content;
        res.write(`event: text\ndata: ${JSON.stringify({ content: val.content })}\n\n`);
      } else if (t === "tool_use" && typeof val.tool_id === "string") {
        // Gemini CLI emits `tool_use` for write_file / read_file / etc. Map
        // write_file → Write so the UI's onToolResult iframe-reload path
        // fires. Without this branch the daemon was dropping every Gemini
        // file write silently — file landed on disk but iframe stayed empty.
        const toolName =
          val.tool_name === "write_file"
            ? "Write"
            : val.tool_name === "edit_file" || val.tool_name === "replace"
              ? "Edit"
              : val.tool_name === "read_file"
                ? "Read"
                : val.tool_name === "run_shell_command" || val.tool_name === "shell"
                  ? "Bash"
                  : val.tool_name === "delete_file"
                    ? "Delete"
                    : (val.tool_name ?? "Unknown");
        const params = val.parameters && typeof val.parameters === "object" ? val.parameters : {};
        // Normalise to UI's expected shape — file_path is the canonical key.
        const input = { ...params };
        if (typeof params.file_path === "string") input.file_path = params.file_path;
        else if (typeof params.path === "string") input.file_path = params.path;
        res.write(
          `event: tool_call\ndata: ${JSON.stringify({
            id: val.tool_id,
            name: toolName,
            input,
          })}\n\n`,
        );
      } else if (t === "tool_result" && typeof val.tool_id === "string") {
        const isError = val.status && val.status !== "success";
        res.write(
          `event: tool_result\ndata: ${JSON.stringify({
            id: val.tool_id,
            isError: !!isError,
            content: typeof val.output === "string" ? val.output : (val.status ?? ""),
          })}\n\n`,
        );
      } else if (t === "result" && val.stats) {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.stats.input_tokens,
            outputTokens: val.stats.output_tokens,
            cacheReadTokens: val.stats.cached,
          })}\n\n`,
        );
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `gemini exit ${code}${tail ? ": " + tail : ""}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but empty assistant message →
      // silent fail.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "gemini completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// Pipe Anthropic API SSE → DF SSE. Anthropic uses standard SSE (event: + data:)
// with their own event vocabulary documented at
// https://docs.anthropic.com/en/api/messages-streaming
export async function pipeAnthropicStream(upstream, res) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepMatch;
    while ((sepMatch = buffer.match(/\r?\n\r?\n/))) {
      const frame = buffer.slice(0, sepMatch.index);
      buffer = buffer.slice(sepMatch.index + sepMatch[0].length);
      if (!frame.trim()) continue;
      let event = "message";
      let dataStr = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!dataStr) continue;
      let val;
      try {
        val = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (event === "message_start" && val.message) {
        res.write(
          `event: meta\ndata: ${JSON.stringify({
            model: val.message.model,
            inputTokens: val.message.usage?.input_tokens,
            cacheReadTokens: val.message.usage?.cache_read_input_tokens,
            cacheCreationTokens: val.message.usage?.cache_creation_input_tokens,
          })}\n\n`,
        );
      } else if (event === "content_block_delta" && val.delta?.type === "text_delta") {
        const text = val.delta.text ?? "";
        if (text) {
          full += text;
          res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
        }
      } else if (event === "message_delta") {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.usage?.input_tokens,
            outputTokens: val.usage?.output_tokens,
            stopReason: val.delta?.stop_reason,
          })}\n\n`,
        );
      } else if (event === "error") {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: val.error?.message ?? "anthropic api error",
          })}\n\n`,
        );
      }
    }
  }
  // 1 stabilize: anthropic API stream completed → emit exactly one
  // terminal event. Empty completion (rare: model returned no text) →
  // explicit error so frontend renders red bubble; never silent done.
  if (full) {
    res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
  } else {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "anthropic completed without text or artifact" })}\n\n`,
    );
  }
  res.end();
}
