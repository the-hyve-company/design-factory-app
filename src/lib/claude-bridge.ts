// DesignFactory is web+dev-bridge only. Tauri scaffolding was cut.
// UnlistenFn kept as a zero-arg disposer so existing stream return
// shapes stay identical.
export type UnlistenFn = () => void;

// ─── Dev bridge (browser preview) ─────────────────────────────────────────
//
// When running under `npm run dev` (vite in a plain browser) Tauri IPC is
// absent. The dev bridge in scripts/dev-bridge.mjs exposes the local `claude`
// CLI over HTTP/SSE. We detect it at module load so the UI can tell the
// user whether the browser preview is "live" or just mock.

function resolveBridgeUrl(): string {
  // Tauri desktop app: the Rust shell picks a free port and injects it as
  // window.__DF_BRIDGE_PORT__ before any app JS runs, so we never depend on a
  // fixed port colliding with something else on the machine.
  if (typeof window !== "undefined") {
    const p = (window as unknown as { __DF_BRIDGE_PORT__?: number }).__DF_BRIDGE_PORT__;
    if (typeof p === "number" && p > 0) return `http://127.0.0.1:${p}`;
  }
  // dev:web launcher sets VITE_BRIDGE_URL; otherwise the dev default.
  const env =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BRIDGE_URL;
  return env || "http://127.0.0.1:1421";
}

export const BRIDGE_URL: string = resolveBridgeUrl();
const IS_TEST =
  typeof process !== "undefined" &&
  process.env?.VITEST === "true";

type BridgeStatus = { available: boolean; url: string; checkedAt: number };

let bridgeStatus: BridgeStatus = { available: false, url: BRIDGE_URL, checkedAt: 0 };
let probePromise: Promise<BridgeStatus> | null = null;

async function probeBridge(): Promise<BridgeStatus> {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const controller = new AbortController();
      // 4s (was 1500ms): under load the daemon can be slow to answer /healthz
      // while it's busy spawning provider CLIs. A too-tight timeout flipped
      // bridgeAvailable to false transiently and made the UI think the bridge
      // had died mid-session. 4s is still well under any human-perceptible
      // "is it dead?" threshold but tolerates spawn-induced latency.
      const timer = setTimeout(() => controller.abort(), 4000);
      // /healthz is canonical; /ping is kept as alias for backward compat
      // with older daemons. Try canonical first, fall back transparently.
      let res = await fetch(`${BRIDGE_URL}/healthz`, { signal: controller.signal });
      if (!res.ok && res.status === 404) {
        res = await fetch(`${BRIDGE_URL}/ping`, { signal: controller.signal });
      }
      clearTimeout(timer);
      const ok = res.ok;
      bridgeStatus = { available: ok, url: BRIDGE_URL, checkedAt: Date.now() };
    } catch {
      bridgeStatus = { available: false, url: BRIDGE_URL, checkedAt: Date.now() };
    } finally {
      probePromise = null;
    }
    return bridgeStatus;
  })();
  return probePromise;
}

export const getBridgeStatus = () => bridgeStatus;
export const refreshBridgeStatus = () => probeBridge();

// Initial probe (fire and forget).
if (typeof window !== "undefined" && !IS_TEST) void probeBridge();

export interface StreamMeta {
  model?: string;
  ttftMs?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  stopReason?: string;
}

export interface StreamResult extends StreamUsage {
  durationMs?: number;
  durationApiMs?: number;
  costUsd?: number;
  numTurns?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  isError: boolean;
  content: string;
}

export interface ClaudeStreamEvent {
  type:
    | "text" | "meta" | "usage" | "result" | "done" | "error"
    | "tool_call" | "tool_result"
    | "session"        // carries the CLI's session_id for --resume
    | "auth_required"; // stderr matched an auth-failure pattern
  content?: string;
  error?: string;
  meta?: StreamMeta;
  usage?: StreamUsage;
  result_info?: StreamResult;
  tool_call?: ToolCall;
  tool_result?: ToolResult;
  /** Populated on "session" events — CLI session id for the next `--resume`. */
  session_id?: string;
  /** Populated on "auth_required" events. */
  auth_required?: boolean;
}

export interface ClaudeConfig {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Working directory the claude CLI is spawned in. */
  cwd?: string;
  /** Agent alias to pass via --agent (e.g. 'canvas'). */
  agent?: string;
  /**
   * When present, the spawn runs `claude --resume <sessionId>` — reuses the
   * on-disk JSONL transcript (~/.claude/projects/<slug>/<id>.jsonl) instead
   * of re-receiving a plain-text concat of prior turns. Only honoured by the
   * Claude agent — other providers ignore the field.
   */
  sessionId?: string;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
  onMeta?: (meta: StreamMeta) => void;
  onUsage?: (usage: StreamUsage) => void;
  onResult?: (result: StreamResult) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  /**
   * Invoked exactly once per Claude stream when the CLI emits its init event
   * carrying a session_id. Caller is expected to persist this against the
   * active project so the next turn can pass `--resume <id>`.
   */
  onSession?: (sessionId: string) => void;
  /**
   * Invoked once when stderr matches an auth-failure pattern. UI should
   * show a "Run `claude login`" banner; no auto-retry from here.
   */
  onAuthRequired?: (detail: string) => void;
}

// ─── Streaming ────────────────────────────────────────────────────────────

async function streamViaBridge(
  prompt: string,
  config: ClaudeConfig,
  callbacks: StreamCallbacks
): Promise<UnlistenFn> {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/claude/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: config.systemPrompt,
          model: config.model,
          cwd: config.cwd,
          agent: config.agent,
          sessionId: config.sessionId,
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
      let reportedError: string | null = null;
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
          const logMsg = (level: string, message: string) =>
            window.dispatchEvent(new CustomEvent("df-dev-log", { detail: { level, message } }));

          if (event === "text" && typeof data.content === "string") {
            full += data.content;
            callbacks.onText(data.content);
            if (full.length % 2000 < data.content.length) {
              logMsg("debug", `streaming — ${full.length.toLocaleString()} chars accumulated`);
            }
          } else if (event === "meta") {
            callbacks.onMeta?.(data as StreamMeta);
            logMsg("info", `meta — model=${data.model ?? "?"}, ttft=${data.ttftMs ?? "?"}ms, cache_read=${data.cacheReadTokens ?? 0}, cache_create=${data.cacheCreationTokens ?? 0}`);
          } else if (event === "usage") {
            callbacks.onUsage?.(data as StreamUsage);
            logMsg("info", `usage — in=${data.inputTokens ?? 0} out=${data.outputTokens ?? 0} stop=${data.stopReason ?? "?"}`);
          } else if (event === "tool_call") {
            callbacks.onToolCall?.(data as ToolCall);
            logMsg("info", `tool_call — ${data.name}`);
          } else if (event === "tool_result") {
            callbacks.onToolResult?.(data as ToolResult);
            logMsg("info", `tool_result — ${data.isError ? "error" : "ok"} ${(data.content ?? "").slice(0, 60)}`);
          } else if (event === "session" && typeof data.sessionId === "string") {
            callbacks.onSession?.(data.sessionId);
            logMsg("info", `session_id=${data.sessionId}`);
          } else if (event === "auth_required") {
            const detail = typeof data.detail === "string" && data.detail
              ? data.detail
              : "Run `claude login` in your terminal.";
            callbacks.onAuthRequired?.(detail);
            logMsg("warn", `auth_required — ${detail}`);
          } else if (event === "result") {
            callbacks.onResult?.(data as StreamResult);
            const cost = typeof data.costUsd === "number" ? `$${data.costUsd.toFixed(4)}` : "?";
            logMsg("info", `result — duration=${data.durationMs ?? "?"}ms, cost=${cost}, turns=${data.numTurns ?? "?"}`);
          } else if (event === "done") {
            logMsg("info", `done — total ${full.length.toLocaleString()} chars`);
            callbacks.onDone(typeof data.content === "string" ? data.content : full);
            return;
          } else if (event === "error") {
            reportedError = data.error ?? "bridge error";
            logMsg("error", `stream error — ${reportedError}`);
            callbacks.onError(reportedError || "bridge error");
            return;
          } else if (event === "log") {
            window.dispatchEvent(new CustomEvent("df-dev-log", { detail: data }));
          }
        }
      }
      if (!reportedError) callbacks.onDone(full);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      callbacks.onError(String(err));
    }
  })();
  return () => controller.abort();
}

export async function streamClaude(
  prompt: string,
  config: ClaudeConfig,
  callbacks: StreamCallbacks
): Promise<UnlistenFn> {
  // BUG-18: do NOT pre-gate on probeBridge() here. probeBridge shares a
  // singleton `probePromise` with the 8s health-check interval; under load
  // (e.g. creating a second project while the first's CLI is still settling)
  // /healthz can exceed the probe's timeout, the shared promise resolves
  // `available: false`, and this function would call onError + return WITHOUT
  // ever POSTing to /claude/stream. Net symptom: the turn silently stalled —
  // "calling sendUserTurn" in the trace, then nothing, no stream call, ~3/16
  // E2E runs. The probe was only a nicety to print a friendlier "run npm run
  // bridge" hint; streamViaBridge's fetch already rejects loudly (→ onError)
  // if the bridge is genuinely unreachable, so the gate was redundant AND the
  // flake source. Just attempt the stream.
  return streamViaBridge(prompt, config, callbacks);
}

export async function claudeOnce(
  prompt: string,
  config: ClaudeConfig = {}
): Promise<string> {
  const status = await probeBridge();
  if (!status.available) {
    throw new Error(
      `dev bridge not reachable at ${BRIDGE_URL}. Run \`npm run bridge\` (or use \`npm run dev:web\`).`
    );
  }
  const res = await fetch(`${BRIDGE_URL}/claude/once`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      systemPrompt: config.systemPrompt,
      model: config.model,
      cwd: config.cwd,
      agent: config.agent,
    }),
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.text ?? "";
}

export async function getClaudeVersion(): Promise<string | null> {
  return null;
}

// ─── Filesystem / dialog (Tauri-only; browser stubs) ──────────────────────

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export type FolderResult = { path: string; entries: FsEntry[] } | { error: string };

export async function listFolder(path?: string, showHidden?: boolean): Promise<FolderResult> {
  try {
    const url = new URL(`${BRIDGE_URL}/fs/list`);
    if (path) url.searchParams.set("path", path);
    if (showHidden) url.searchParams.set("showHidden", "1");
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => null);
    if (!res.ok) return { error: data?.error || `HTTP ${res.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

export async function copyDirViaBridge(from: string, to: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/copy-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    return r.ok;
  } catch { return false; }
}

export async function moveDirViaBridge(from: string, to: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/move-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    return r.ok;
  } catch { return false; }
}

export async function writeBinaryViaBridge(path: string, base64: string): Promise<{ path: string; size: number } | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/write-base64`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, base64 }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function mkdirViaBridge(path: string): Promise<boolean> {
  try {
    const url = new URL(`${BRIDGE_URL}/fs/mkdir`);
    url.searchParams.set("path", path);
    const res = await fetch(url.toString(), { method: "POST" });
    return res.ok;
  } catch { return false; }
}

/** Recursively remove a file or folder inside the projects/ root. Scoped
 *  server-side via assertPathInScope. Used by the Files-tab gallery. */
export async function removeFsEntryViaBridge(path: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return r.ok;
  } catch { return false; }
}

export interface FsFile { path: string; size: number; mtime: number; isText: boolean; content: string }

export async function readFileViaBridge(path: string): Promise<FsFile | null> {
  try {
    const url = new URL(`${BRIDGE_URL}/fs/read`);
    url.searchParams.set("path", path);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    // Bridge returns `{ found: false }` for missing files (soft-200 so the
    // browser console doesn't log a failed resource). Treat as null so
    // callers don't have to special-case it.
    if (data && data.found === false) return null;
    return data;
  } catch { return null; }
}

/** Validates a string is real HTML, not a base64 data URI the bridge
 *  may have returned for a file mis-detected as binary. User repro
 *  2026-05-18: Claude generated HTML with UTF-8 box-drawing chars
 *  (`┄`), bridge classified as binary, iframe rendered the data URI as
 *  plain text. Daemon fix anchored on file extension; this guard is
 *  defense-in-depth so callers can't accidentally feed a base64 string
 *  to setIframeHtml. */
export function isUsableHtmlContent(s: string | null | undefined): s is string {
  if (typeof s !== "string") return false;
  if (s.length < 50) return false;
  if (s.startsWith("data:")) return false;
  const trimmed = s.replace(/^﻿/, "").trimStart().slice(0, 200).toLowerCase();
  return trimmed.includes("<!doctype") || trimmed.includes("<html") || trimmed.includes("<svg") || trimmed.includes("<?xml");
}

/**
 * Global folder-picker deferred. Components that need browser-mode
 * filesystem navigation should render <FolderPickerModal /> themselves.
 * In Tauri mode, this still hits the native dialog.
 *
 * The function resolves to null in browser mode so callers fall back to
 * their own modal flow. Previously this was a window.prompt() which the
 * user flagged as broken UX.
 */
export async function openFolderDialog(): Promise<string | null> {
  return null;
}

export async function readProjectFiles(_folderPath: string): Promise<string[]> {
  return [];
}

export async function readFile(_filePath: string): Promise<string> {
  throw new Error("readFile not supported in browser preview");
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  // Browser preview: hit the dev bridge. Throw loud on failure — the old
  // silent blob-download fallback produced "DS exists but design.md is
  // empty" bugs because callers thought the write succeeded.
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/fs/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
    });
  } catch (e) {
    throw new Error(`Bridge unreachable at ${BRIDGE_URL} — can't persist ${filePath}. Start the dev bridge or run the Tauri app. (${String(e)})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bridge write failed (${res.status}) for ${filePath}: ${body.slice(0, 200)}`);
  }
}

// ─── DS-setup helpers ────────────────────────────────────────────────────

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
  stargazersCount: number;
}

export async function ghHasToken(): Promise<{ hasToken: boolean; source: string | null }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/gh/token`);
    if (!r.ok) return { hasToken: false, source: null };
    const data = await r.json();
    return { hasToken: !!data.hasToken, source: data.source ?? null };
  } catch { return { hasToken: false, source: null }; }
}

export interface GhDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  expiresIn: number;
}

export async function ghDeviceStart(): Promise<GhDeviceFlowStart | { error: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/gh/device/start`, { method: "POST" });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

export type GhDevicePollStatus =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "ok"; tokenType?: string; scope?: string }
  | { status: "error"; error: string };

export async function ghDevicePoll(deviceCode: string): Promise<GhDevicePollStatus> {
  try {
    const r = await fetch(`${BRIDGE_URL}/gh/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { status: "error", error: data?.error || `HTTP ${r.status}` };
    return data as GhDevicePollStatus;
  } catch (e) { return { status: "error", error: String(e) }; }
}

export async function ghDeviceLogout(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/gh/device/logout`, { method: "POST" });
    return r.ok;
  } catch { return false; }
}

export async function ghListRepos(opts: { search?: string; pat?: string; limit?: number } = {}): Promise<{ repos: GithubRepo[] } | { error: string }> {
  try {
    const url = new URL(`${BRIDGE_URL}/gh/repos`);
    if (opts.search) url.searchParams.set("search", opts.search);
    if (opts.pat) url.searchParams.set("pat", opts.pat);
    if (opts.limit) url.searchParams.set("limit", String(opts.limit));
    const r = await fetch(url.toString());
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

export async function gitSnapshot(cwd: string, label?: string): Promise<{ tag: string; sha: string; message: string } | { error: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/git/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, label }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

export async function gitShallowClone(repoUrl: string, pat?: string): Promise<{ path: string; slug: string } | { error: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/git/shallow-clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: repoUrl, pat }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

export async function gitCleanup(path: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/git/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * List project folders under <repoRoot>/projects/. Filesystem is the
 * source of truth for which projects exist — the DB only carries metadata
 * (name, mode, timestamps, html cache) for slugs the bridge finds on disk.
 * Returns null when the bridge is unreachable so callers can fall back.
 */
export interface FsProject {
  slug: string;
  path: string;
  htmlFile: string | null;
  mtime: number;
}
export async function listProjectsFromFilesystem(): Promise<FsProject[] | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/list-projects`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data?.projects)) return null;
    return data.projects as FsProject[];
  } catch { return null; }
}

/**
 * Global user config — cross-project prefs stored at
 * <home>/.design-factory/config.json. Theme, default provider + model,
 * skills custom path, built-in prompt overrides live here so a device
 * hop (sync via Dropbox/rsync) carries them along without the DB.
 *
 * Reads return the current snapshot (empty object if the file doesn't
 * exist yet). Writes are patch-merge: undefined/null/"" values are
 * dropped so cleared settings vanish from disk instead of persisting
 * as falsy entries.
 */
export interface GlobalConfig {
  theme?: "dark" | "light";
  /** UI language preference. Covers the New Project modal and
   *  Settings; the rest of the app migrates progressively. Defaults
   *  to pt-BR when unset. Mirrors GlobalConfigSchema in
   *  lib/schemas.ts. The `xx` value is a debug pseudo-locale,
   *  DEV-only. */
  language?: "pt" | "en" | "xx";
  default_provider?:
    | "claude" | "codex" | "gemini" | "opencode" | "kimi"
    | "anthropic" | "openai" | "gemini-api" | "openrouter"
    | "ollama";
  model?: string;
  skills_custom_path?: string;
  builtin_prompts?: Record<string, string>;
  /** Single user-controlled accent color (hex), applied app-wide via
   *  `--df-accent-user` CSS variable. Empty = use token default. */
  accent_color?: string;
  /** Per-id partial overrides for FORMATOS in direction-data. Each value
   *  is a Partial<Formato> — fields the user has edited. Defaults stay
   *  read-only in code; this map is merged on top at runtime. */
  format_overrides?: Record<string, {
    nome?: string;
    descricao?: string;
    prompt_prefix?: string;
    anti_slop?: string[];
  }>;
  /** Per-id partial overrides for DIRECTIONS in direction-data. */
  direction_overrides?: Record<string, {
    nome?: string;
    descricao?: string;
    prompt_addon?: string;
  }>;
  /** User-authored formats. Stored alongside the built-ins; the Settings
   *  editor allows creation, edit, delete (built-ins can only be edited or
   *  disabled). Each shape mirrors Formato exactly. */
  custom_formats?: Array<{
    id: string;
    categoria: "video" | "interface" | "social";
    nome: string;
    descricao: string;
    canvas: { ratio: string; duration: number };
    prompt_prefix: string;
    anti_slop: string[];
  }>;
  /** User-authored directions. Same lifecycle as custom_formats. */
  custom_directions?: Array<{
    id: string;
    eixo: "motion" | "typography" | "layout" | "surfaces" | "anti-slop";
    nome: string;
    descricao: string;
    aplica: { categorias: Array<"video" | "interface" | "social">; formatos?: string[] };
    prompt_addon: string;
  }>;
  /** canonical: Canvas (aspect ratio / responsive) presets. */
  custom_canvas_presets?: Array<{
    id: string;
    name: string;
    ratio: string;
    width: number;
    height: number;
    unit?: "px" | "mm";
    hint?: string;
  }>;
  /** canonical: Format taxonomy (output category × subitem). */
  custom_format_categories?: Array<{
    id: string;
    label: string;
    hint?: string;
    items: Array<{ id: string; label: string; descriptor?: string }>;
  }>;
  /** canonical: unified Direction taxonomy (taste + anti-slop). */
  custom_direction_categories?: Array<{
    id: string;
    label: string;
    hint?: string;
    items: Array<{ id: string; label: string; descriptor?: string }>;
  }>;
  /** Flat list of user-authored rules in the hyve-taste format. The
   *  picker layer reads from this field; the older
   *  `custom_direction_categories` is preserved for backward read but
   *  ignored on write. */
  custom_rules?: Array<{
    id: string;
    title: string;
    category: string;
    description?: string;
    builtin: boolean;
  }>;
  /** Builtin rule overrides — partial patches keyed by id. Lets the
   *  user rename or re-categorize a builtin rule without losing it. */
  builtin_rule_overrides?: Record<string, { title?: string; description?: string; category?: string }>;
  /** user-authored rule categories — net-new rule
   *  categories beyond the framework defaults. */
  custom_rule_categories?: Array<{ id: string; label: string; hint?: string }>;
  /** rename overrides for builtin rule categories.
   *  Keyed by category id. */
  rule_category_overrides?: Record<string, string>;
  /** builtin items the user permanently hid via
   *  "Excluir permanentemente". Distinct from disabled_* (soft hide) — these
   *  disappear from the Padrões list entirely until reset. */
  hidden_builtin_canvas_presets?: string[];
  hidden_builtin_format_items?: string[];
  hidden_builtin_format_categories?: string[];
  hidden_builtin_rules?: string[];
  hidden_builtin_rule_categories?: string[];
  hidden_builtin_commands?: string[];
}

export async function readGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/config/read`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const cfg = data?.config ?? {};
    // Validate. Bad config from disk drops to {} rather than poisoning
    // downstream consumers. Issues are logged via surfaceError.
    const parsed = safeRead(GlobalConfigSchema, cfg, "readGlobalConfig");
    return (parsed ?? {}) as GlobalConfig;
  } catch (e) {
    surfaceError(e, "readGlobalConfig");
    return null;
  }
}

export async function writeGlobalConfig(patch: Partial<GlobalConfig>): Promise<GlobalConfig | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/config/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return (data?.config ?? null) as GlobalConfig | null;
  } catch { return null; }
}

// ─── Editorial commands (verbs) ─────────────────────────────────────────
// Custom + override files live at ~/.design-factory/commands/{id}.md.
// Built-in defaults are bundled (src/runtime/verbs/*.md compiled at build
// time via Vite ?raw imports). The registry merges both sets at runtime.

export async function listCustomCommands(): Promise<{ id: string; body: string }[]> {
  try {
    const r = await fetch(`${BRIDGE_URL}/commands/list`);
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    return Array.isArray(data?.commands) ? data.commands : [];
  } catch { return []; }
}

export async function writeCustomCommand(id: string, body: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/commands/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, body }),
    });
    return r.ok;
  } catch { return false; }
}

export async function deleteCustomCommand(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/commands/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Design systems list — scans design-systems/*<slug>/design.md under the
 * repo root and returns one entry per folder. Replaces the db-backed
 * `design_systems` array so the UI reflects whatever is on disk without
 * a parallel bookkeeping cache. Returns null when bridge unreachable.
 */
export interface FsDesignSystem {
  slug: string;
  name: string;
  path: string;
  designMdPath: string;
  mtime: number;
  /** Absolute path to an optional cover image next to design.md. The
   *  daemon scans cover.{png,jpg,jpeg,webp} and emits the first match;
   *  absent when the user didn't upload one. */
  coverPath?: string;
  /** Absolute path to preview.html generated via the Generate Preview
   *  modal. Daemon scans this alongside the cover. */
  previewPath?: string;
}

export async function listDesignSystemsFromFilesystem(): Promise<FsDesignSystem[] | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/list-design-systems`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data?.designSystems)) return null;
    return data.designSystems as FsDesignSystem[];
  } catch { return null; }
}

/**
 * Chat persistence per-thread, filesystem-canonical. One JSONL file per
 * thread at projects/{slug}/.df/chat/{threadId}.jsonl. Append-only on
 * save, full-read on thread switch. DB's tmsg:{threadId} stays as the
 * secondary cache for offline / Tauri paths.
 */
export interface ChatLogEntry {
  role: "user" | "assistant";
  text: string;
  is_design?: boolean;
  ts: number;
  parts_json?: string;
}

export async function appendChatMessage(
  slug: string,
  threadId: string,
  message: ChatLogEntry,
): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/chat-append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, threadId, message }),
    });
    return r.ok;
  } catch { return false; }
}

export async function readChatMessages(
  slug: string,
  threadId: string,
): Promise<ChatLogEntry[] | null> {
  try {
    const r = await fetch(
      `${BRIDGE_URL}/fs/chat-read?slug=${encodeURIComponent(slug)}&threadId=${encodeURIComponent(threadId)}`,
    );
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data?.messages)) return null;
    // Coerce legacy disk lines (role:"claude") to the modern shape so
    // callers can rely on the type. JSONL on disk is append-only — old
    // entries stay as written until a future migration rewrites them.
    // (Provider Handoff Layer v0, 2026-05-03.)
    const coerced = (data.messages as unknown[]).map((raw): ChatLogEntry => {
      const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const legacyClaude = m.role === "claude";
      return {
        role: legacyClaude ? "assistant" : (m.role as ChatLogEntry["role"]),
        text: typeof m.text === "string" ? m.text : "",
        is_design: m.is_design === true ? true : undefined,
        ts: typeof m.ts === "number" ? m.ts : Date.now(),
        parts_json: typeof m.parts_json === "string" ? m.parts_json : undefined,
      };
    });
    return coerced;
  } catch { return null; }
}

/**
 * Read the chat log as Turn[] (auto-converts legacy line-per-message files
 * to the turn schema in place on first read).
 */
import type { Turn } from "./chat-turns";
import {
  ChatReadTurnsResponseSchema,
  TurnSchema,
  GlobalConfigSchema,
  ProjectMetaSchema,
  safeRead,
  safeWriteOrThrow,
} from "./schemas";
import { surfaceError } from "./error-surface";

export async function readChatTurns(
  slug: string,
  threadId: string,
): Promise<{ turns: Turn[]; migrated: boolean } | null> {
  try {
    const r = await fetch(
      `${BRIDGE_URL}/fs/chat-read-turns?slug=${encodeURIComponent(slug)}&threadId=${encodeURIComponent(threadId)}`,
    );
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const parsed = safeRead(ChatReadTurnsResponseSchema, data, `readChatTurns(${slug})`);
    if (!parsed) return null;
    return { turns: parsed.turns as Turn[], migrated: !!parsed.migrated };
  } catch (e) {
    surfaceError(e, `readChatTurns(${slug})`);
    return null;
  }
}

/**
 * Mirror the full in-memory message array to disk on every change. The
 * append-only chat.jsonl only writes finalized turns — this snapshot is
 * how we recover partial conversations from abandoned streams or page
 * reloads. Caller is expected to debounce. See chat-load fallback.
 */
export async function writeChatSnapshot(
  slug: string,
  threadId: string,
  messages: unknown[],
): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/chat-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, threadId, messages }),
    });
    if (!r.ok) {
      surfaceError(`HTTP ${r.status}`, `writeChatSnapshot(${slug})`);
      return false;
    }
    return true;
  } catch (e) {
    surfaceError(e, `writeChatSnapshot(${slug})`);
    return false;
  }
}

export async function readChatSnapshot(
  slug: string,
  threadId: string,
): Promise<unknown[] | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/chat-snapshot?slug=${encodeURIComponent(slug)}&threadId=${encodeURIComponent(threadId)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data?.messages) ? (data.messages as unknown[]) : null;
  } catch (e) {
    surfaceError(e, `readChatSnapshot(${slug})`);
    return null;
  }
}

/**
 * Append a complete turn to the JSONL log. Called once per turn at the
 * moment the AI side reaches a terminal state (done / error / cancelled).
 */
export async function appendChatTurn(
  slug: string,
  threadId: string,
  turn: Turn,
): Promise<boolean> {
  try {
    // Validate before sending — catches bugs where we'd persist a turn
    // that's missing required fields. Throws on schema mismatch.
    safeWriteOrThrow(TurnSchema, turn, `appendChatTurn(${slug})`);
    const r = await fetch(`${BRIDGE_URL}/fs/chat-append-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, threadId, turn }),
    });
    if (!r.ok) {
      // Capture the bridge's response body so the user sees WHY it
      // rejected, not just the HTTP code. Bridge logs the same on its
      // side via console.warn since 2026-04-29.
      let detail = "";
      try { detail = await r.text(); } catch {}
      console.error(`[appendChatTurn] HTTP ${r.status} for ${slug}/${threadId}, turn=${turn.id}`, detail.slice(0, 300));
      surfaceError(`HTTP ${r.status}: ${detail.slice(0, 120)}`, `appendChatTurn(${slug})`);
      return false;
    }
    return true;
  } catch (e) {
    surfaceError(e, `appendChatTurn(${slug})`);
    return false;
  }
}

export interface ChatThreadSummary {
  threadId: string;
  mtime: number;
  msgCount: number;
  firstMsg: string;
}

/** List the chat threads on disk for a project (.df/chat/*.jsonl). */
export async function listChatThreads(slug: string): Promise<ChatThreadSummary[]> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/chat-list?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return [];
    const body = (await r.json()) as { threads?: ChatThreadSummary[] };
    return body.threads ?? [];
  } catch (e) {
    surfaceError(e, `listChatThreads(${slug})`);
    return [];
  }
}

/**
 * Wipe the chat for a project (both the JSONL log and the snapshot
 * mirror). User-triggered via the Clear chat button.
 */
export async function clearChatLog(slug: string, threadId: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/chat-clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, threadId }),
    });
    return r.ok;
  } catch (e) {
    surfaceError(e, `clearChatLog(${slug})`);
    return false;
  }
}

/**
 * Per-project metadata. Canonical record lives at
 * projects/{slug}/.df/meta.json so a folder clone is a complete backup.
 * The DB entry is a secondary cache (still wired for Tauri + quick reads).
 */
export interface ProjectMeta {
  id: string;
  name: string;
  mode: "wireframe" | "hifi";
  created_at: number;
  updated_at: number;
  ds_path?: string;
  ds_name?: string;
  start_mode?: "prototype" | "slide" | "template" | "other";
  /** Composed user prompt at creation: formato.prompt_prefix + anti_slop +
   *  selected directions + user input. Stored so user can audit afterwards. */
  initial_user_prompt?: string;
  /** Free-text user input alone, before composition (so user can compare). */
  initial_raw_prompt?: string;
  /** Direction selection JSON snapshot at creation time. Used by the
   *  "view full prompt" modal to break down what was composed. */
  initial_direction_selection?: {
    formatoId: string;
    directionIds: string[];
    customAntiSlop: string[];
    removedAntiSlop: string[];
  } | null;
  /** Aspect ratio chosen by the user in the Video tab. Persisted here so the
   *  ratio survives across machines and browsers, and so cover thumbnails +
   *  Present mode can render at the right shape. */
  video_ratio?: "16:9" | "9:16" | "1:1" | "4k";
}

export async function readProjectMeta(slug: string): Promise<ProjectMeta | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/project-meta?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data?.meta) return null;
    const parsed = safeRead(ProjectMetaSchema, data.meta, `readProjectMeta(${slug})`);
    return (parsed ?? null) as ProjectMeta | null;
  } catch (e) {
    surfaceError(e, `readProjectMeta(${slug})`);
    return null;
  }
}

export async function writeProjectMeta(slug: string, meta: ProjectMeta): Promise<boolean> {
  try {
    safeWriteOrThrow(ProjectMetaSchema, meta, `writeProjectMeta(${slug})`);
    const r = await fetch(`${BRIDGE_URL}/fs/project-meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, meta }),
    });
    if (!r.ok) {
      surfaceError(`HTTP ${r.status}`, `writeProjectMeta(${slug})`);
      return false;
    }
    return true;
  } catch (e) {
    surfaceError(e, `writeProjectMeta(${slug})`);
    return false;
  }
}

/**
 * Remove a project folder at <repoRoot>/projects/<slug>/. Scoped so the
 * bridge endpoint can't escape the projects root. Caller also deletes the
 * DB entry + associated keys (html:/versions:/chat:) via db.deleteProject.
 */
export async function removeProjectFolder(slug: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/remove-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Remove a design system folder (rm -rf design-systems/<slug>). Without
 * this the UI's "remove DS" only touched the in-memory list — and the
 * focus-reconcile would re-add the folder by rescanning disk. Now it's
 * a real delete.
 */
export async function removeDsFolder(slug: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/remove-ds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Transcribe a recorded audio blob via the bridge's Groq Whisper proxy.
 * Returns the transcribed text, or an error message string prefixed with
 * "[error] " so the caller can surface it inline. Null when the browser
 * can't reach the bridge at all (offline).
 */
export async function transcribeAudio(blob: Blob): Promise<string | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/audio/transcribe`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return `[error] ${data?.error ?? `HTTP ${r.status}`}`;
    return typeof data.text === "string" ? data.text : "";
  } catch (e) {
    return `[error] ${String(e)}`;
  }
}

/**
 * Fetch absolute workspace anchors from the bridge. Used to seed defaults in
 * the UI (projectsFolder, workspace_root) without ever writing a literal `~`
 * into paths — tilde doesn't get expanded by the syscall-based writes the
 * bridge uses, and literal `~/design-factory/...` has bitten us (ends up as
 * `/root/design-factory/...` when Claude CLI resolves `~` under a different
 * HOME). Returns null when the bridge is unreachable.
 */
export interface WorkspaceInfo {
  repoRoot: string;
  home: string;
  projectsDir: string;
  designSystemsDir: string;
}

export async function fetchWorkspaceInfo(): Promise<WorkspaceInfo | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/workspace-info`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data?.repoRoot) return null;
    return data as WorkspaceInfo;
  } catch { return null; }
}

/**
 * Ensure and return the persistent directory for a DS's design.md, rooted
 * under the bridge's cwd at design-systems/<slug>/. GitHub + upload sources
 * write here instead of ephemeral caches, so design.md survives reloads.
 * Returns null when the bridge is unreachable (Tauri mode gets a separate
 * anchor later).
 */
export async function designSystemsDir(slug: string): Promise<string | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/design-systems-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data?.path ?? null;
  } catch { return null; }
}

// ─── Skills registry (source-classified) ─────────────────────────────────
//
// Source: df (user-managed — <repoRoot>/skills/ canonical, with
// <repoRoot>/.claude/skills/ as legacy compat), project (cwd/.claude),
// global (~/.claude/skills), builtin (DF actions).

export type SkillSource = "df" | "project" | "global" | "builtin";

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  description?: string | null;
  body: string;
  source: SkillSource;
  path?: string | null;
  requires: string[];
  override_trigger?: string | null;
  version?: string | null;
  body_hash: string;
}

export interface SkillSourceBucket {
  path?: string | null;
  count?: number;
  items?: Skill[];
}

export interface SkillsRegistry {
  cwd: string;
  scanned_at: number;
  sources: Record<SkillSource, SkillSourceBucket>;
  truncated?: boolean;
}

export async function fetchSkillsRegistry(
  cwd: string | null,
): Promise<SkillsRegistry | null> {
  const effectiveCwd = cwd || "";
  try {
    const u = new URL(`${BRIDGE_URL}/skills/registry`);
    u.searchParams.set("cwd", effectiveCwd);
    const r = await fetch(u.toString());
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export interface CreateSkillInput {
  name: string;
  trigger?: string;
  description?: string | null;
  body: string;
  requires?: string[];
  override?: boolean;
  version?: string | null;
  /** Additional files to land beside SKILL.md inside the skill folder.
   *  Keys are folder-relative paths ("references/intro.md",
   *  "scripts/run.sh", "assets/diagram.svg"). Values are base64-encoded
   *  bytes — text files included. The daemon refuses any key that
   *  contains `..`, starts with `/`, or matches `SKILL.md` (the SKILL.md
   *  copy comes from `body` so re-emit is avoided). */
  extraFiles?: Record<string, string>;
  /** Force the on-disk skill folder name. Defaults to the slug derived
   *  from the trigger or name. Used by ZIP import so the install folder
   *  mirrors the ZIP's top folder (or the .zip filename). */
  forceSlug?: string;
}

export type UpdateSkillInput = Partial<CreateSkillInput>;

/** Create a new df-source skill. Returns the resulting record on success. */
export async function installSkill(input: CreateSkillInput): Promise<Skill | { error: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data as Skill;
  } catch (e) { return { error: String(e) }; }
}

/** Edit an existing df-source skill (by id). */
export async function updateSkill(id: string, patch: UpdateSkillInput): Promise<Skill | { error: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data as Skill;
  } catch (e) { return { error: String(e) }; }
}

/** Delete a df-source skill (by id). Idempotent. */
export async function deleteSkill(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  } catch { return false; }
}

/** Parse YAML frontmatter from a SKILL.md text blob. Used for import previews. */
export function parseSkillMarkdown(raw: string): {
  name: string | null;
  description: string | null;
  trigger: string | null;
  requires: string[];
  override: boolean;
  version: string | null;
  body: string;
} {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fm = fmMatch ? fmMatch[1] : "";
  const body = fmMatch ? raw.slice(fmMatch[0].length).trimStart() : raw;
  const pick = (key: string): string | null => {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
    const m = fm.match(re);
    if (!m) return null;
    return m[1].trim().replace(/^["'](.*)["']$/, "$1");
  };
  const pickList = (key: string): string[] => {
    const re = new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, "m");
    const m = fm.match(re);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().replace(/^["'](.*)["']$/, "$1")).filter(Boolean);
  };
  return {
    name: pick("name"),
    description: pick("description"),
    trigger: pick("trigger"),
    requires: pickList("requires"),
    override: (pick("override") ?? "").toLowerCase() === "true",
    version: pick("version"),
    body,
  };
}

export async function fetchUrlViaBridge(url: string): Promise<{ url: string; status: number; contentType: string | null; html: string; size: number } | { error: string }> {
  try {
    const u = new URL(`${BRIDGE_URL}/fetch-url`);
    u.searchParams.set("url", url);
    const r = await fetch(u.toString());
    const data = await r.json().catch(() => null);
    if (!r.ok) return { error: data?.error || `HTTP ${r.status}` };
    return data;
  } catch (e) { return { error: String(e) }; }
}

// ─── Filesystem-backed project versions ──
// Each version is one JSON file under `<repoRoot>/projects/<slug>/.df/versions/<vid>.json`.
// The on-disk shape mirrors the in-app `Version` type from EditorScreen.tsx.
// Daemon endpoints: see apps/daemon/src/index.mjs (search "Filesystem-backed
// project versions"). All four helpers return null on bridge / network /
// JSON failures so the caller can fall back to the legacy DB cache.

export interface BridgeVersion {
  id: string;
  html: string;
  name?: string;
  note?: string;
  createdAt: number;
  auto: boolean;
}

export async function listProjectVersions(slug: string): Promise<BridgeVersion[] | null> {
  if (!slug) return null;
  try {
    const r = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(slug)}/versions`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.versions)) return null;
    return data.versions as BridgeVersion[];
  } catch { return null; }
}

export async function saveProjectVersion(slug: string, version: BridgeVersion): Promise<boolean> {
  if (!slug || !version || typeof version.id !== "string" || typeof version.html !== "string") return false;
  try {
    const r = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(slug)}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    return r.ok;
  } catch { return false; }
}

export async function readProjectVersion(slug: string, vid: string): Promise<BridgeVersion | null> {
  if (!slug || !vid) return null;
  try {
    const r = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(vid)}`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return (data && typeof data === "object" && data.version && typeof data.version === "object")
      ? (data.version as BridgeVersion)
      : null;
  } catch { return null; }
}

export async function deleteProjectVersion(slug: string, vid: string): Promise<boolean> {
  if (!slug || !vid) return false;
  try {
    const r = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(vid)}`, {
      method: "DELETE",
    });
    return r.ok;
  } catch { return false; }
}

// ─── DB types ──────────────────────────────────────────────────────────────

export interface DbProject {
  id: string;
  name: string;
  path: string;
  mode: "wireframe" | "hifi";
  created_at: number;
  updated_at: number;
  /**
   * Persisted Claude CLI session id — set after the first stream on this
   * project receives its init event. Subsequent spawns pass this back via
   * `sessionId` on ClaudeConfig → translates to `claude --resume <id>`.
   */
  session_id?: string | null;
}

export interface DbMessage {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  is_design: boolean;
  created_at: number;
  /**
   * Structured turn blocks serialized as JSON. When set, the renderer reads
   * the typed array (text / tool_call / tool_result / question) instead of
   * `content`. Nullable for backward compat with pre-v2 rows.
   */
  parts_json?: string | null;
}

export type ChatBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; callId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; callId: string; output: string; isError: boolean }
  | { type: "question"; header: string; question: string; options: { label: string; description?: string }[] };

export interface DbSession {
  id: string;
  project_id: string;
  session_id: string;
  cwd?: string | null;
  started_at: number;
}

// ─── DB commands ───────────────────────────────────────────────────────────
//
// In browser preview we fall back to localStorage so projects, messages and
// settings still persist across refreshes (no cross-device sync).

const LS_KEY = "design-factory:dev-db:v1";

export interface DbSkill {
  id: string;
  name: string;
  trigger: string;
  description: string | null;
  body: string;
  source: SkillSource;
  path: string | null;
  requires: string[];
  override_trigger: string | null;
  version: string | null;
  body_hash: string;
  installed_at: number;
  updated_at: number;
}

type LocalDb = {
  projects: DbProject[];
  messages: Record<string, DbMessage[]>;
  settings: Record<string, string>;
  skills: DbSkill[];
  sessions: DbSession[];
};

const EMPTY_DB = (): LocalDb => ({
  projects: [], messages: {}, settings: {}, skills: [], sessions: [],
});

function readLocal(): LocalDb {
  if (typeof localStorage === "undefined") return EMPTY_DB();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_DB();
    const parsed = JSON.parse(raw);
    // Forward-compat migration: every field is defaulted so upgrading from
    // a DF build that didn't know about modes/sessions doesn't lose rows.
    return {
      projects: parsed.projects ?? [],
      messages: parsed.messages ?? {},
      settings: parsed.settings ?? {},
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return EMPTY_DB();
  }
}

function writeLocal(db: LocalDb) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  catch {}
}

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const db = {
  getProjects: async (): Promise<DbProject[]> => {
    const d = readLocal();
    return [...d.projects].sort((a, b) => b.updated_at - a.updated_at);
  },
  createProject: async (name: string, path: string, mode: string): Promise<DbProject> => {
    const d = readLocal();
    const now = Date.now();
    const p: DbProject = { id: uuid(), name, path, mode: (mode as "wireframe" | "hifi"), created_at: now, updated_at: now };
    d.projects.unshift(p);
    writeLocal(d);
    return p;
  },
  touchProject: async (id: string): Promise<void> => {
    const d = readLocal();
    const p = d.projects.find((x) => x.id === id);
    if (p) { p.updated_at = Date.now(); writeLocal(d); }
  },
  updateProject: async (id: string, fields: Partial<Pick<DbProject, "name" | "path" | "mode">>): Promise<void> => {
    // Tauri side: fall back to touchProject — the command isn't wired yet.
    // Browser side: localStorage direct mutation.
    const d = readLocal();
    const p = d.projects.find((x) => x.id === id);
    if (!p) return;
    if (fields.name !== undefined) p.name = fields.name;
    if (fields.path !== undefined) p.path = fields.path;
    if (fields.mode !== undefined) p.mode = fields.mode;
    p.updated_at = Date.now();
    writeLocal(d);
  },
  deleteProject: async (id: string): Promise<void> => {
    const d = readLocal();
    d.projects = d.projects.filter((x) => x.id !== id);
    delete d.messages[id];
    writeLocal(d);
  },
  getMessages: async (projectId: string): Promise<DbMessage[]> => {
    return readLocal().messages[projectId] ?? [];
  },
  saveMessage: async (projectId: string, role: string, content: string, isDesign: boolean): Promise<DbMessage> => {
    const d = readLocal();
    const m: DbMessage = {
      id: uuid(),
      project_id: projectId,
      role: (role as "user" | "assistant"),
      content,
      is_design: isDesign,
      created_at: Date.now(),
    };
    d.messages[projectId] = [...(d.messages[projectId] ?? []), m];
    writeLocal(d);
    return m;
  },
  saveMessageStructured: async (
    projectId: string,
    role: string,
    content: string,
    parts: ChatBlock[],
    isDesign: boolean,
  ): Promise<DbMessage> => {
    const parts_json = JSON.stringify(parts);
    const d = readLocal();
    const m: DbMessage = {
      id: uuid(),
      project_id: projectId,
      role: (role as "user" | "assistant"),
      content, is_design: isDesign,
      created_at: Date.now(),
      parts_json,
    };
    d.messages[projectId] = [...(d.messages[projectId] ?? []), m];
    writeLocal(d);
    return m;
  },
  setProjectSession: async (projectId: string, sessionId: string | null): Promise<void> => {
    const d = readLocal();
    const p = d.projects.find((x) => x.id === projectId);
    if (p) { p.session_id = sessionId; p.updated_at = Date.now(); writeLocal(d); }
  },
  getProjectSession: async (projectId: string): Promise<string | null> => {
    const d = readLocal();
    return d.projects.find((x) => x.id === projectId)?.session_id ?? null;
  },
  logSession: async (projectId: string, sessionId: string, cwd?: string | null): Promise<DbSession> => {
    const d = readLocal();
    const row: DbSession = { id: uuid(), project_id: projectId, session_id: sessionId, cwd: cwd ?? null, started_at: Date.now() };
    d.sessions.push(row);
    writeLocal(d);
    return row;
  },
  getSessions: async (projectId: string): Promise<DbSession[]> => {
    const d = readLocal();
    return d.sessions.filter((s) => s.project_id === projectId)
      .sort((a, b) => b.started_at - a.started_at);
  },
  getSetting: async (key: string): Promise<string | null> => {
    return readLocal().settings[key] ?? null;
  },
  setSetting: async (key: string, value: string): Promise<void> => {
    const d = readLocal();
    d.settings[key] = value;
    writeLocal(d);
  },
};

/**
 * Thin wrapper around the Tauri `path_exists` command. In browser preview
 * we cannot reliably stat an arbitrary host path, so we always return true
 * — the UI's "missing path" banner is Tauri-only.
 */
export async function pathExists(_path: string): Promise<boolean> {
  return true;
}

// ─── Debug log ─────────────────────────────────────────────────────────────

export interface DebugLogEntry {
  timestamp: number;
  level: "info" | "debug" | "warn" | "error";
  message: string;
}

export async function listenDebugLog(
  handler: (entry: DebugLogEntry) => void
): Promise<UnlistenFn> {
  // Browser preview: catch dev-bridge SSE log events relayed via window.
  const h = (e: Event) => {
    const detail = (e as CustomEvent).detail as Partial<DebugLogEntry>;
    handler({
      timestamp: Date.now(),
      level: (detail?.level as DebugLogEntry["level"]) ?? "info",
      message: detail?.message ?? "",
    });
  };
  window.addEventListener("df-dev-log", h);
  return () => window.removeEventListener("df-dev-log", h);
}
