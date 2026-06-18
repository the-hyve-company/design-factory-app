// process-artifacts.ts — runtime consumer that glues the parser core
// to the daemon's /fs/write/artifact endpoint. Used as one stage of
// the modular `sendUserTurn()` pipeline, and also callable directly
// by EditorScreen at stream-end.
//
// Why this lives in src/runtime/ (not src/lib/): the parser is core
// (D18). Anything that DEPENDS on the parser plus a single network call
// is still core enough to keep here so a future headless / CLI runner can
// reuse it without dragging React.
//
// capability-driven dispatch:
//   - `fileWrite === "tool"` providers (Claude Code, Codex CLI,
//     Opencode, Kimi): caller skips this function — native tool calls
//     already wrote the bytes.
//   - `fileWrite === "artifact"` providers (Gemini CLI, Anthropic API,
//     OpenAI API, Gemini API, OpenRouter API, Ollama): caller invokes
//     us. The capability gate now lives in `turn-stages/process-
//     artifacts.ts`; this module is the canonical parser+writer.
//
// Idempotency: if a tool-driven Write somehow ran AND a textual
// <artifact> showed up in the same turn (shouldn't happen, but defensive),
// the daemon's hash-based idempotency check makes the second write a
// no-op. We surface `noop: true` to the UI so the chat doesn't double-log.

import { BRIDGE_URL } from "@/lib/claude-bridge";
import { parseArtifact, type ParseResult, type ArtifactBlock } from "./artifact-processor";

export interface ProcessArtifactsOptions {
  /** Hard cap on artifact body bytes. Defaults to the parser's 5 MiB. */
  maxBytes?: number;
  /** Override the bridge base URL. Tests inject a localhost:port mock. */
  bridgeUrl?: string;
  /** Skill-specific override of the daemon's Static P0 byte floor. */
  minBytes?: number;
  /** Intent hint passed to the daemon's `resolveArtifactTarget()`,
   *  forwarded directly into the request body.
   *  Daemon is authoritative — if intent conflicts with path, the daemon
   *  returns INTENT_PATH_CONFLICT (HTTP 422). Use cases:
   *    - User typed "cria uma variação" → `intent: "variant"`
   *    - User typed "salva como doc" → `intent: "doc"`
   *    - User typed "sobrescreve o principal" → `intent: "override"`
   *  Skipped (left undefined) when the parser has no signal — the daemon
   *  falls back to path-only inference. */
  intent?: "override" | "variant" | "doc" | "prompt" | "data" | "asset";
}

export type ProcessArtifactsOutcome =
  | {
      status: "skipped";
      reason: "no-artifact" | "feature-disabled" | "provider-uses-write";
      cleanedText: string;
    }
  | { status: "rejected"; reason: ParseRejection; cleanedText: string }
  | {
      status: "written";
      finalPath: string;
      hash: string;
      backupPath: string | null;
      noop: boolean;
      cleanedText: string;
      /** : role assigned by the daemon's resolver. Absent when the
       *  project-files feature is disabled. */
      role?: string;
      /** : did the daemon update activeFile to this path? */
      setActive?: boolean;
      /** : did the daemon update primaryFile to this path? */
      setPrimary?: boolean;
      /** : was this a path that didn't yet exist in the registry? */
      isNewFile?: boolean;
      /** : did the runtime gate need to preview after this write? */
      previewAfterWrite?: boolean;
    }
  | {
      status: "write-failed";
      httpStatus: number;
      error: string;
      code: string | null;
      cleanedText: string;
    };

export type ParseRejection =
  | "multiple-artifacts"
  | "unclosed-artifact"
  | "oversize"
  | "invalid-attributes";

interface DaemonWriteResponse {
  ok?: boolean;
  finalPath?: string;
  hash?: string;
  backupPath?: string | null;
  noop?: boolean;
  hashHintMismatch?: boolean;
  // fields — present only when DF_ENABLE_PROJECT_FILES=1 on the
  // daemon. Absent on legacy flag-off paths.
  role?: string;
  setActive?: boolean;
  setPrimary?: boolean;
  isNewFile?: boolean;
  previewAfterWrite?: boolean;
  // Error shape:
  error?: string;
  code?: string;
  reason?: string;
}

/**
 * Parse the assistant turn text and, when an artifact is present, POST it
 * to the daemon for atomic write. Returns a structured outcome the caller
 * can render in the chat.
 *
 * the capability gate (was: feature flag + `requiresArtifactWrap`)
 * lives in the stage layer (`turn-stages/process-artifacts.ts`). This
 * function is the canonical parser+writer; callers reach it only when
 * the active provider is artifact-driven.
 *
 * Caller is responsible for deciding WHEN to invoke this:
 *   - At stream-end (preferred — full text available, no torn parses).
 *   - During stream IF the parser supports tail-partial (current parser
 *     does not; §1 calls that out as scope).
 */
export async function processArtifacts(
  fullText: string,
  opts: ProcessArtifactsOptions = {},
): Promise<ProcessArtifactsOutcome> {
  const result = await parseArtifact(fullText, { maxBytes: opts.maxBytes });
  return await dispatchParseResult(result, opts);
}

/**
 * Lower-level entry point used by tests and by the EditorScreen when it
 * already has a parser result in hand (e.g. from a streaming parser). Skips
 * the feature flag check — Path A callers should never reach here.
 */
export async function dispatchParseResult(
  result: ParseResult,
  opts: ProcessArtifactsOptions = {},
): Promise<ProcessArtifactsOutcome> {
  if (result.status === "none") {
    return { status: "skipped", reason: "no-artifact", cleanedText: result.cleanedText };
  }
  if (result.status === "rejected") {
    return { status: "rejected", reason: result.reason, cleanedText: result.cleanedText };
  }
  return await postToDaemon(result.artifact, result.cleanedText, opts);
}

async function postToDaemon(
  artifact: ArtifactBlock,
  cleanedText: string,
  opts: ProcessArtifactsOptions,
): Promise<ProcessArtifactsOutcome> {
  const url = (opts.bridgeUrl || BRIDGE_URL) + "/fs/write/artifact";
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: artifact.identifier,
        type: artifact.type,
        content: artifact.content,
        contentHash: artifact.contentHash,
        ...(opts.minBytes != null ? { minBytes: opts.minBytes } : {}),
        ...(opts.intent != null ? { intent: opts.intent } : {}),
      }),
    });
  } catch (err) {
    return {
      status: "write-failed",
      httpStatus: 0,
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
      code: "NETWORK",
      cleanedText,
    };
  }

  let payload: DaemonWriteResponse | null = null;
  try {
    payload = (await response.json()) as DaemonWriteResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      status: "write-failed",
      httpStatus: response.status,
      error: payload?.error || `daemon returned HTTP ${response.status}`,
      code: payload?.code ?? null,
      cleanedText,
    };
  }
  return {
    status: "written",
    finalPath: payload?.finalPath || artifact.identifier,
    hash: payload?.hash || artifact.contentHash,
    backupPath: payload?.backupPath ?? null,
    noop: !!payload?.noop,
    cleanedText,
    // fields are forwarded only when the daemon supplied them
    // (i.e. project-files feature is enabled on the daemon side).
    ...(payload?.role !== undefined ? { role: payload.role } : {}),
    ...(payload?.setActive !== undefined ? { setActive: payload.setActive } : {}),
    ...(payload?.setPrimary !== undefined ? { setPrimary: payload.setPrimary } : {}),
    ...(payload?.isNewFile !== undefined ? { isNewFile: payload.isNewFile } : {}),
    ...(payload?.previewAfterWrite !== undefined
      ? { previewAfterWrite: payload.previewAfterWrite }
      : {}),
  };
}
