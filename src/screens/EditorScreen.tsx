import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useClaude } from "@/hooks/useClaude";
import { slugFromPath } from "@/lib/project-files";
import { Logo } from "@/components/Logo";
import { AgentPicker } from "@/components/AgentPicker";
import { ChatHistoryDropdown } from "@/components/ChatHistoryDropdown";
import {
  BRIDGE_URL,
  writeFile,
  db,
  refreshBridgeStatus,
  gitSnapshot,
  writeBinaryViaBridge,
  pathExists,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectMeta,
  writeProjectMeta,
  listProjectVersions,
  saveProjectVersion,
  deleteProjectVersion,
  type ChatBlock,
} from "@/lib/claude-bridge";
import { useSkillRegistry } from "@/hooks/useSkillRegistry";
function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

// Tight m:ss form for the in-flight status banner — the legacy formatter
// above renders "1m 03s" (decorative), this one renders "1:03" so the
// counter sits cleanly inside a row of small mono labels.
function formatTurnElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTurnTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
  return tokens.toString();
}

import { TabCornerLeft, TabCornerRight } from "@/components/TabCorner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { RatioChangeConfirmModal } from "@/components/RatioChangeConfirmModal";
import { RatioRegenOverlay } from "@/components/RatioRegenOverlay";
// Vercel publish + GitHub auth are not part of the current public
// surface. Users publish manually via `vercel deploy` in the terminal
// until a future wave reintegrates a publish dialog with polished UX.
import { regenerateForRatio, RegenError } from "@/runtime/ratio-regen";
import { parseArtifact } from "@/runtime/artifact-processor";
import {
  startTurn as recStartTurn,
  endTurn as recEndTurn,
  record as recordTurn,
  attachProjectSlug as recAttachSlug,
} from "@/lib/turn-recorder";
import {
  buildTweaksPrompt,
  parseTweaksResponse,
  TWEAKS_SYSTEM_PROMPT,
  workspaceContextPreamble,
  looksLikeQuestion,
  GENERATE_CORE_SYSTEM,
  REFINE_SYSTEM,
  type ProjectContext,
} from "@/runtime/prompt-invoker";
import { migrateLegacyChatMessages } from "@/lib/migrations";
import {
  readProviderSessions,
  upsertProviderSession,
  EMPTY_PROVIDER_SESSIONS,
} from "@/lib/provider-sessions";
import type { ProviderSessions } from "@/lib/schemas";
import { ProviderIdSchema } from "@/lib/schemas";
import { getBuiltinPrompt } from "@/runtime/builtin-prompts";
import { loadAllVerbs, matchVerb, type Verb } from "@/runtime/verbs/registry";
import { listCustomCommands } from "@/lib/claude-bridge";
import { ActiveVerbPill } from "@/components/ActiveVerbPill";
import { CommandLibrary } from "@/components/CommandLibrary";
// The VideoTab editor is not part of the current public surface — video
// presets in NewProject and mp4 export from Share remain, but scene
// editing and manipulation are deferred to a future wave.
import { CanvasStage } from "@/components/CanvasStage";
import { DfLoader } from "@/components/DfLoader";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import type { EditOverrides } from "@/components/EditDrawer";
import { InlineEditPanel } from "@/components/InlineEditPanel";
import {
  injectInlineEditListenerIntoHtml,
  listenInlineEditFromIframe,
  postInlineEditToIframe,
  type InlineEditSelectPayload,
  type InlineEditStyles,
} from "@/runtime/inline-edit-bridge";
import { TerminalDrawer } from "@/components/TerminalDrawer";
import { SlashMenu } from "@/components/SlashMenu";
import { findMatches, triggerAtCursor, type SlashCommand } from "@/components/slash-data";
import {
  invokeSearchReplaceEdit,
  applyPatches,
  applyPatchesToDom,
  type HtmlPatch,
} from "@/runtime/patch-invoker";
import { sendUserTurn, isTurnPipelineV2Enabled } from "@/runtime/send-user-turn";
import { assembleTurnBlocks, type TurnPreviewBlock } from "@/runtime/turn-pipeline";
import { FileManager } from "@/components/FileManager";
import { ChatMessage, ChatAttachmentChips, type ToolUseRecord } from "@/components/ChatMessage";
import { FileView } from "@/components/FileView";
import { PromptConsole } from "@/components/PromptConsole";
// ElementInspectorPanel is not mounted in EditorScreen for the current
// public surface; its component file is preserved so a later wave can
// reactivate it. The element overlay injector still runs (no-op on iframe
// contents) so the preview HTML stays unchanged regardless of reactivation.
import { injectOverlayIntoHtml } from "@/runtime/element-overlay";
// PreviewSandboxBadge is mounted (sandbox posture indicator). The sandbox
// resolution helpers live in its module so posture display + resolution
// share one source of truth.
import {
  PreviewSandboxBadge,
  resolvePreviewSandbox,
  isPermissiveSandbox,
  enablePermissiveSandboxAndReload,
} from "@/components/PreviewSandboxBadge";
import { injectNavGuardIntoHtml } from "@/runtime/viewport-fit";
import { useT, tf } from "@/i18n";
import { injectTweaksListenerIntoHtml, listenTweaksFromIframe } from "@/runtime/tweaks-bridge";
import {
  buildCanonicalPlusBlock,
  describeCanonicalPlus,
  type CanonicalPlusInput,
  type DialDirection,
  type DialKey,
} from "@/runtime/canonical-plus-prompt";
import { readTasteDialOverrides } from "@/components/TasteDialEditor";
import { parseSceneManifest } from "@/runtime/scene-manifest";
import { type DirectionSelection } from "@/data/direction-data";
import { createPortal } from "react-dom";
import {
  readFileViaBridge,
  listFolder,
  readChatMessages,
  readChatTurns,
  appendChatTurn,
  writeChatSnapshot,
  readChatSnapshot,
  type FsEntry,
  type FsFile,
} from "@/lib/claude-bridge";
import { persistOrRecoverTurn } from "@/lib/chat-persist";
import { surfaceError, warn } from "@/lib/error-surface";
import type { Turn } from "@/lib/chat-turns";
import { spawnStream } from "@/runtime/cli-spawner";
import { getProvider } from "@/providers/registry";
import type { ProviderId } from "@/providers/types";
import {
  getModelsForProvider,
  nextModelForProvider,
  isModelForeignToProvider,
  readLastModel,
  writeLastModel,
  writeSeenVersion,
  useLiveModelOptions,
} from "@/providers/model-lists";
import { AttachDsModal } from "@/components/AttachDsModal";
import { ModelRocker } from "@/components/NewProjectFormSkeu";
import { SearchableDropdown } from "@/components/SearchableDropdown";
import { parseDesignSystem } from "@/lib/ds-google";
import { listDesignSystemsFromFilesystem, type FsDesignSystem } from "@/lib/claude-bridge";

// Model catalog + pretty-name helpers live in src/providers/model-lists.ts so
// Settings and EditorScreen stay in sync about what models exist per provider.

interface EditorScreenProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  mode: "wireframe" | "hifi";
  startMode?: "prototype" | "slide" | "template" | "other";
  initialPrompt?: string;
  theme?: "dark" | "light";
  onThemeChange?: (theme: "dark" | "light") => void;
  onHome: () => void;
  onOpenSettings?: () => void;
  onDuplicateProject?: (id: string) => void | Promise<void>;
}

type ChatTab = "chat" | "comments";
// "select" mode (in-iframe element overlay) is not part of the
// current public surface. The element selection bridge (postMessage
// round-trip) is deferred — runtime/element-overlay stays in the
// codebase so the pipe can be reactivated later.
type CanvasMode = "tweaks" | "comment" | "edit";

// — sandbox posture. STRICT (`allow-scripts`) is the default; permissive
// (`allow-scripts allow-same-origin`) is opt-in. Four legacy DOM-coupled
// features (inline Edit, Comment-mode click, in-place patch, VideoTab
// transport) read `iframe.contentDocument` and need permissive — under
// strict the Edit/Comment toggles surface an actionable prompt to enable it
// (the in-place patch degrades to a full reload). Resolution + opt-in helpers
// live in PreviewSandboxBadge. Documented in SECURITY.md § Threat model.
const PREVIEW_SANDBOX = resolvePreviewSandbox();
const PREVIEW_SANDBOX_IS_PERMISSIVE = isPermissiveSandbox(PREVIEW_SANDBOX);

interface CanvasTab {
  id: string;
  name: string;
  // "video" kept in the union so a tab persisted in DB from a previous
  // session still parses cleanly — tabs of that kind are filtered out at
  // render time below and removed from the list on next persist. The
  // Video toolbar pill no longer creates new ones.
  kind: "preview" | "terminal" | "file" | "files" | "video";
  /** For 'file' tabs: path + content */
  filePath?: string;
  fileContent?: string;
  fileIsText?: boolean;
  /** For 'files' tabs: starting folder */
  rootPath?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  /** Provider that produced this message. Always set for assistant
   *  messages from now on; user messages leave it undefined. Legacy
   *  cache entries (role:"assistant") are migrated transparently to
   *  role:"assistant" + provider:"claude" by migrateLegacyChatMessage. */
  provider?: import("@/lib/schemas").ProviderIdValue;
  /** Specific model id within the provider (e.g. "claude-opus-4-7"). */
  model?: string;
  text: string;
  /** files attached to this user turn rendered as a
   *  chip row beside the prose. The agent still receives file content
   *  inline in the prompt — these fields purely drive UI presentation +
   *  rehydration. Legacy messages without `attachments` keep the prepend-
   *  in-text rendering for backward-compat. */
  attachments?: import("@/lib/schemas").ChatAttachment[];
  isDesign?: boolean;
  action?: { label: string; kind: "open-tweaks" };
  tools?: ToolUseRecord[];
  /** True while the provider stream is still active for this message.
   *  Set on creation of the claude placeholder and cleared on onDone/onError.
   *  Drives the "Thinking…" / "Working…" indicator so it stays visible
   *  throughout tool use, not just before the first tool fires. */
  streaming?: boolean;
  /** Editorial verb dispatch (`/polish`, `/bolder` …). When set, the
   *  message renders as a shimmer card instead of plain text and the
   *  bubble carries no "user said /polish" noise. */
  verb?: import("@/components/ChatMessage").VerbState;
  /** Stable identity stamp set ONCE at message creation. */
  ts?: number;
  /** Links the user prompt and its AI response into a single turn. The
   *  persist effect groups messages by this id and writes one Turn record
   *  per group. Hydrate explodes turns back into messages with this id
   *  preserved so the UI can re-group them as turn cards. */
  turn_id?: string;
  /** Auto-checkpoint id taken at the end of this AI response. Lets the
   *  Restore button revert the iframe to exactly what was on screen right
   *  after this turn finished. Persisted on the claude message; the persist
   *  effect copies it into turn.ai.html_snapshot_id. */
  version_id?: string;
  /** turn-pipeline runtime gate report — when present, the
   *  ChatMessage renderer mounts <DoneReportPanel> below the body. Only
   *  populated when the v2 pipeline ran (DF_ENABLE_TURN_PIPELINE_V2=1). */
  doneReport?: import("@/runtime/done-report").DoneReport;
  /** — canonical tool events for this message (provider-agnostic
   *  envelopes from `runtime/tool-events`). When present and non-empty,
   *  ChatMessage renders the collapsed "canonical events" details panel.
   *  Coexists with `tools` (the legacy ledger) for backwards compatibility:
   *  legacy chat snapshots without `toolEvents` keep rendering through
   *  the existing ToolSummary path. Backfilled at read-time by
   *  migrateLegacyToolEvents (src/lib/migrations.ts). */
  toolEvents?: import("@/runtime/tool-events").NormalizedToolEvent[];
  /** Persistence outcome for this turn — set by persistOrRecoverTurn
   *  (chat-persist.ts). Drives a small inline indicator on the user
   *  bubble so a save failure doesn't disappear silently. Only set
   *  for turns sent in this session; turns hydrated from disk leave
   *  it undefined and render no badge. */
  persist_status?: import("@/lib/chat-persist").PersistStatus | "saving";
  /** F1.1 — Per-message stats persisted with the turn so the footer
   *  below each assistant bubble renders even after reload (provider ·
   *  model · duration · in/out tokens · cost). Sourced from the V2
   *  pipeline's StreamResult at finalize; legacy/empty turns leave
   *  them undefined and the footer hides itself. */
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  ttftMs?: number;
}

// Sanitize an inbound message list — used at chat-load time to clean
// historical snapshots. Extracted to `@/lib/chat-sanitizer` so the
// invariants are unit-testable. See that module for
// full documentation of the three sweeps (empty, dedup, leaked-HTML).
import {
  sanitizeMessages as sanitizeMessagesImpl,
} from "@/lib/chat-sanitizer";
function sanitizeMessages(msgs: ChatMessage[]): { messages: ChatMessage[]; cleaned: number } {
  return sanitizeMessagesImpl(msgs);
}

function stamp(m: Omit<ChatMessage, "ts"> & { ts?: number; turn_id?: string }): ChatMessage {
  const ts = m.ts != null ? m.ts : Date.now();
  // turn_id stays whatever the caller provided (so user + claude pair share
  // the same id) — fall back to ts as a stable per-message id when the
  // caller didn't provide one (rare, only for non-paired messages).
  const turn_id = m.turn_id ?? `t${ts}`;
  return { ...m, ts, turn_id };
}

// Thread interface removed — single chat per project after Phase D.

interface Comment {
  id: string;
  selector: string;
  snippet: string;
  text: string;
  createdAt: number;
  sent: boolean;
  // Set false when a DOM patch invalidated the selector (element no longer
  // exists). Default treated as true (undefined = valid). UI shows a warning
  // chip on invalid comments — see Step 8 in the persistent-canvas plan.
  selectorValid?: boolean;
}

interface Version {
  id: string;
  html: string;
  name?: string; // Optional human name — named saves persist indefinitely
  note?: string; // Optional 1-line note explaining the save
  createdAt: number;
  auto: boolean; // true = generated automatically, false = user-named
}

function computeSelector(el: Element): string {
  if (!el || el.nodeType !== 1) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let sel = node.tagName.toLowerCase();
    const cls = (node.getAttribute("class") || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    sel += cls;
    // Disambiguate with :nth-of-type when needed
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        sel += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(sel);
    if (node.id) break;
    node = node.parentElement;
    if (node && ["HTML", "BODY"].includes(node.tagName)) break;
  }
  return parts.join(" > ");
}

// Structural check: does this look like a full HTML document?
// Used to gate the legacy "stream text = final HTML" iframe update
// path, which was hijacking the iframe with chat prose after we moved
// HTML generation behind Write tool calls.
function looksLikeHtmlOutput(s: string): boolean {
  if (!s) return false;
  const trimmed = s.replace(/^﻿/, "").trimStart();
  return /^(<!doctype\b|<html\b|<svg\b|<\?xml\b)/i.test(trimmed);
}

// Read a File as a data URL via FileReader. The old attach path did
// `btoa(String.fromCharCode(...new Uint8Array(buf)))` — spreading a multi-MB
// byte array as function args blows the call stack ("Maximum call stack size
// exceeded") for any image over ~64KB, so image attach silently failed for
// every real photo. FileReader streams it with no stack pressure.
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("file read failed"));
    r.readAsDataURL(f);
  });
}

// Downscale an image to a sane max dimension before it enters a turn. A raw
// 4314×2876 logo became ~250KB of base64 in the agent's context — enough to
// make a tool-CLI provider (Kimi) stall past the turn watchdog ("completed
// without text or artifact") and to blow API vision size limits. 1568px is
// Anthropic's recommended long-edge cap and is plenty for a reference logo /
// palette. Returns the original data URL untouched when already small or if
// anything fails (canvas blocked, decode error).
async function downscaleImageDataUrl(
  dataUrl: string,
  mime: string,
  maxDim = 1568,
): Promise<{ dataUrl: string; mime: string }> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image decode failed"));
      i.src = dataUrl;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h || (w <= maxDim && h <= maxDim)) return { dataUrl, mime };
    const scale = maxDim / Math.max(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl, mime };
    ctx.drawImage(img, 0, 0, cw, ch);
    // Keep PNG for transparency (logos); JPEG for photos to shrink further.
    const outMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
    return { dataUrl: canvas.toDataURL(outMime, 0.92), mime: outMime };
  } catch {
    return { dataUrl, mime };
  }
}

export function EditorScreen({
  projectId,
  projectName,
  projectPath,
  mode,
  startMode = "prototype",
  initialPrompt,
  theme,
  onThemeChange,
  onHome,
  onOpenSettings,
  onDuplicateProject,
}: EditorScreenProps) {
  // subscribe to language changes so the topbar Share menu and any
  // other PT/EN strings re-render when the user flips the toggle in
  // Settings. Ignored cost — useT is a 1-line subscription.
  const { t } = useT();
  const projectFileName = `${(projectName || "untitled")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")}.html`;
  // User ask 2026-05-18: file manager opens as the FIRST tab so the
  // project surface is "files" before anything else. The preview tab is
  // created on-demand when the agent writes an HTML file. Until then the
  // canvas shows the file tree. Fase A — Fase B will create a new preview
  // tab per HTML write instead of reusing "main".
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([
    { id: "files", name: "Files", kind: "files", rootPath: projectPath },
  ]);
  const [activeCanvasTab, setActiveCanvasTab] = useState<string>("files");

  // Keep the primary tab name in sync with projectFileName
  useEffect(() => {
    setCanvasTabs((prev) =>
      prev.map((t) => (t.id === "main" ? { ...t, name: projectFileName } : t)),
    );
  }, [projectFileName]);

  const currentTab = canvasTabs.find((t) => t.id === activeCanvasTab) ?? canvasTabs[0];

  const openFilesTab = useCallback(() => {
    // Reuse an existing 'files' tab if present
    const existing = canvasTabs.find((t) => t.kind === "files");
    if (existing) {
      setActiveCanvasTab(existing.id);
      return;
    }
    const id = `files-${Date.now()}`;
    // Resolve root: prefer projectPath, else settings.workspace_root, else /
    // Project folder is always the root — claude's workspace_root is separate
    // (used for the CLI's cwd, not for browsing project artifacts here).
    const root = projectPath || "~/design-factory";
    setCanvasTabs((prev) => [...prev, { id, name: "files", kind: "files", rootPath: root }]);
    setActiveCanvasTab(id);
  }, [canvasTabs, projectPath]);

  const openFileTab = useCallback(
    async (entry: FsEntry) => {
      // Reload the file content from disk every time — callers include Claude's
      // Write/Edit tool-result hook, which wants the tab to reflect the fresh
      // file. If a tab is already open for this path, update its content + tools
      // state in place and activate it; otherwise push a new tab.
      // Read fresh content from disk. The read can fail transiently (file
      // briefly locked mid-write, bridge hiccup, race). When it does we must
      // STILL focus an already-open tab for this path — bailing here left
      // the click a silent no-op even though the tab existed, which is the
      // "clicking an already-open HTML doesn't open its tab" repro. So don't return on
      // read failure; only skip the content refresh / new-tab creation below.
      const file = await readFileViaBridge(entry.path);
      // If the file is the project's primary HTML (slug.html), it's already
      // represented by the main preview tab — switch to it instead of opening
      // a duplicate file tab. User repro 2026-05-20: opening slug.html via
      // the Files gallery produced two tabs with identical content.
      //
      // 2026-05-26 follow-up: dedup also has to be atomic. The previous
      // implementation read `canvasTabs` from the closure, so two concurrent
      // open calls (React StrictMode double-invoke in dev, or a fast double-
      // click) both saw `existing=undefined` and each appended a fresh tab.
      // Both checks (primary-html short-circuit AND existing-file merge) now
      // run inside the setCanvasTabs callback against `prev`, so the second
      // invocation sees the first one's append.
      // BUG-22: compare paths separator-insensitively. primaryHtmlPath is built
      // with a literal "/" while entry.path comes from the daemon via Node
      // path.join → all "\" on Windows. The raw `===` never matched ("…\dir/file"
      // vs "…\dir\file"), so isPrimary was always false on Windows and the
      // project's primary HTML opened as a DUPLICATE file tab next to the main
      // preview — the "2 tabs do mesmo html" the user kept seeing. Normalize
      // both sides (and the existing-tab filePath check) to forward slashes.
      const normPath = (p: string | null | undefined) =>
        (p || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const entryPathNorm = normPath(entry.path);
      const primaryHtmlPathNorm = projectPath
        ? `${normPath(projectPath)}/${projectFileName}`
        : null;
      const isPrimary = primaryHtmlPathNorm && entryPathNorm === primaryHtmlPathNorm;
      const newId = `file-${Date.now()}`;
      let nextActive: string | null = null;
      setCanvasTabs((prev) => {
        if (isPrimary && prev.some((t) => t.id === "main")) {
          nextActive = "main";
          return prev;
        }
        const existing = prev.find(
          (t) => t.kind === "file" && normPath(t.filePath) === entryPathNorm,
        );
        if (existing) {
          nextActive = existing.id;
          // Refresh content only when the read succeeded; otherwise just
          // focus the existing tab with its current content.
          return file
            ? prev.map((t) =>
                t.id === existing.id
                  ? { ...t, fileContent: file.content, fileIsText: file.isText }
                  : t,
              )
            : prev;
        }
        // Opening a brand-new tab needs content — if the read failed there's
        // nothing to render, so leave tabs untouched for the not-yet-open case.
        if (!file) return prev;
        nextActive = newId;
        return [
          ...prev,
          {
            id: newId,
            name: entry.name,
            kind: "file",
            filePath: entry.path,
            fileContent: file.content,
            fileIsText: file.isText,
          },
        ];
      });
      if (nextActive) setActiveCanvasTab(nextActive);
    },
    [projectPath, projectFileName],
  );

  const addTerminalTab = useCallback(() => {
    const id = `term-${Date.now()}`;
    const termCount = canvasTabs.filter((t) => t.kind === "terminal").length + 1;
    setCanvasTabs((prev) => [...prev, { id, name: `terminal ${termCount}`, kind: "terminal" }]);
    setActiveCanvasTab(id);
  }, [canvasTabs]);

  // openVideoTab removed alongside the Video toolbar pill.

  const closeCanvasTab = useCallback(
    (id: string) => {
      // User rule: always keep at least ONE tab open. Closing the last
      // tab would leave the canvas area empty with nothing to show. HTML
      // preview tab (main) loses its special "can never close" treatment
      // — it can be closed when other tabs exist, and re-created when
      // iframeHtml updates (see effect below).
      setCanvasTabs((prev) => {
        if (prev.length <= 1) return prev; // can't close the last tab
        const next = prev.filter((t) => t.id !== id);
        if (activeCanvasTab === id) setActiveCanvasTab(next[0]?.id ?? "main");
        // If the main (HTML preview) tab was closed, also clear iframe
        // state so reopening from a fresh generation starts clean.
        if (id === "main") {
          setIframeHtml(null);
          setIframeKey((k) => k + 1);
        }
        return next;
      });
    },
    [activeCanvasTab],
  );
  const [chatTab, setChatTab] = useState<ChatTab>("chat");
  // Mode is toggleable: clicking the active pill again deactivates the mode
  // (canvasMode → null = no mode, preview only). Initial state is null so a
  // fresh editor opens in preview-only mode — the user activates a mode
  // explicitly. User ask 2026-05-20.
  const [canvasMode, setCanvasMode] = useState<CanvasMode | null>(null);
  const toggleMode = (mode: CanvasMode) => setCanvasMode((prev) => (prev === mode ? null : mode));

  // Under a strict sandbox the iframe has no allow-same-origin, so Edit and
  // Comment can't reach `contentDocument`. Rather than silently activating a
  // dead mode, we stash which mode the user reached for and surface an
  // actionable prompt to opt into the permissive sandbox (one-time + reload).
  const [sandboxGateFor, setSandboxGateFor] = useState<CanvasMode | null>(null);

  // Returns true if a permissive-only mode (edit/comment) may proceed; false
  // means we surfaced the enable-edit prompt instead of activating it.
  const requirePermissiveSandbox = (mode: CanvasMode): boolean => {
    if (PREVIEW_SANDBOX_IS_PERMISSIVE) return true;
    setSandboxGateFor(mode);
    return false;
  };

  // Bumped whenever the agent completes a file write so the Files panel
  // can auto-refresh its listing without the user clicking Refresh.
  // User ask 2026-05-20.
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const bumpFilesRefresh = useCallback(() => setFilesRefreshKey((k) => k + 1), []);
  // select mode + element selection state removed. The overlay
  // injector still runs (preview HTML unchanged), so the round-trip can
  // be re-enabled by restoring the listener + UI without touching
  // generated artifacts.
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  // The Vercel publish UI is not part of the current public surface;
  // users run `vercel deploy` in the terminal themselves. The
  // showPublishDialog state has been removed accordingly.
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [input, setInput] = useState("");
  // Chat mode — Ask vs Edit. The explicit toggle has been removed;
  // chat mode is locked to "auto" and the looksLikeQuestion heuristic
  // in prompt-invoker decides ask vs edit per message.
  const [chatMode] = useState<"auto" | "ask" | "edit">("auto");
  const [iframeHtml, setIframeHtml] = useState<string | null>(null);
  // Files-first canvas (user ask 2026-05-18): when the agent first
  // writes HTML, materialise the preview tab. Until then the canvas
  // shows the file tree only. Fase A — single shared "main" preview.
  // Fase B will fork this per filePath so each Write opens its own tab.
  useEffect(() => {
    if (!iframeHtml || iframeHtml.length < 50) return;
    setCanvasTabs((prev) => {
      if (prev.some((t) => t.id === "main")) return prev;
      return [...prev, { id: "main", name: projectFileName, kind: "preview" }];
    });
    // Surface the preview when it first materialises. Without this the tab
    // appears but the canvas stays on the Files tree and the user has to
    // click it (reported: the tab appeared but didn't open
    // automatically). Only switch from the default Files tab, so later edits
    // don't yank the user off a tab they navigated to on purpose.
    setActiveCanvasTab((cur) => (cur === "files" ? "main" : cur));
  }, [iframeHtml, projectFileName]);
  // ─── Persistent canvas ─────────────────────────────────────────
  // What the <iframe srcDoc> attribute sees. Mirrors iframeHtml by
  // default, but DOM in-place patches set iframeHtml WITHOUT updating
  // iframeSrcDoc — so the iframe doesn't reload (its DOM already
  // reflects the patch).
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Multi-thread per project. Each thread = one .df/chat/{threadId}.jsonl
  // file on disk. User picks via the "+ New chat / past chats" dropdown
  // in the chat header. Persists across reloads via localStorage keyed by
  // projectId; falls back to the legacy "main" thread for older projects.
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    if (!projectId) return "main";
    try {
      const saved = window.localStorage.getItem(`df:active-thread:${projectId}`);
      if (saved && /^[A-Za-z0-9._-]+$/.test(saved)) return saved;
    } catch {}
    return "main";
  });
  useEffect(() => {
    if (!projectId) return;
    try {
      window.localStorage.setItem(`df:active-thread:${projectId}`, activeThreadId);
    } catch {}
  }, [projectId, activeThreadId]);
  // Re-hydrate when the user navigates between projects — each project
  // has its own active-thread localStorage key.
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = window.localStorage.getItem(`df:active-thread:${projectId}`);
      setActiveThreadId(saved && /^[A-Za-z0-9._-]+$/.test(saved) ? saved : "main");
    } catch {
      setActiveThreadId("main");
    }
  }, [projectId]);
  const [iframeKey, setIframeKey] = useState(0);
  // Resizable chat column — edge-drag, no visible handle. Persisted in localStorage.
  // Default is the minimum so the canvas gets maximum room out of the box.
  const CHAT_MIN = 420;
  const CHAT_MAX = 820;
  const CHAT_DEFAULT = CHAT_MIN;
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof localStorage === "undefined") return CHAT_DEFAULT;
    const raw = Number(localStorage.getItem("df-chat-width"));
    return raw >= CHAT_MIN && raw <= CHAT_MAX ? raw : CHAT_DEFAULT;
  });
  const chatWidthRef = useRef(chatWidth);
  useEffect(() => {
    chatWidthRef.current = chatWidth;
  }, [chatWidth]);
  const [presenting, setPresenting] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentTarget, setCommentTarget] = useState<{ selector: string; snippet: string } | null>(
    null,
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // ─── Persistent canvas ─────────────────────────────────────────
  // Captures iframe scrollY before srcDoc replaces; the load handler
  // below restores it. Applies to all srcDoc-changing paths: regen,
  // version restore, reload, and (as fallback) failed DOM in-place
  // patches.
  const pendingScrollRestoreRef = useRef<number | null>(null);
  // RAF token for debounced scroll persistence (saves to db.setSetting per project).
  const scrollSaveScheduledRef = useRef<number | null>(null);
  // When true, the next iframeHtml change skips updating iframeSrcDoc (the DOM
  // already reflects the new HTML via direct mutation, so the iframe should
  // NOT reload). Set by setIframeContent after a successful DOM in-place patch.
  const suppressNextReloadRef = useRef(false);
  // Patch path (invokeSearchReplaceEdit) uses spawnOnce and bypasses
  // useClaude. This local state keeps the global processing bar visible
  // while the request is in flight.
  const [manualBusy, setManualBusy] = useState<string | null>(null);
  // Re-check all comment selectors against current iframe DOM. Marks comments
  // whose selector no longer matches with selectorValid: false. Called after
  // any DOM patch (in-place) or srcDoc reload (replace). Soft-marks only;
  // user sees a warning chip and can re-anchor manually (see Step 8).
  const validateCommentSelectorsAll = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    setComments((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.sent) return c;
        let stillExists = true;
        try {
          stillExists = doc.querySelector(c.selector) !== null;
        } catch {
          // querySelector throws on syntactically invalid selectors — treat as invalid.
          stillExists = false;
        }
        const wasValid = c.selectorValid !== false;
        if (wasValid !== stillExists) {
          changed = true;
          return { ...c, selectorValid: stillExists };
        }
        return c;
      });
      return changed ? next : prev;
    });
  }, []);
  // Unified iframe content updater. Tries DOM in-place patch first when mode=
  // 'patch'; falls back to srcDoc replace + scroll preservation. Other paths
  // (generate, version restore, reload, history undo/redo) keep calling
  // setIframeHtml directly — the mirror effect below picks them up automatically.
  const setIframeContent = useCallback(
    (next: { html: string; mode?: "replace" | "patch"; patches?: HtmlPatch[] }) => {
      const iframe = iframeRef.current;
      const mode = next.mode ?? "replace";

      if (mode === "patch" && next.patches && next.patches.length > 0 && iframe?.contentDocument) {
        const result = applyPatchesToDom(iframe, next.patches);
        if (!("failedAt" in result)) {
          // DOM patched successfully — sync state without triggering srcDoc reload.
          suppressNextReloadRef.current = true;
          setIframeHtml(next.html);
          validateCommentSelectorsAll();
          return;
        }
        // Fall through to replace path on partial / failed patch.
      }

      if (iframe?.contentWindow) {
        try {
          pendingScrollRestoreRef.current = iframe.contentWindow.scrollY;
        } catch {
          // strict sandbox → cross-origin frame; scroll position is unreadable.
        }
      }
      setIframeHtml(next.html);
    },
    [validateCommentSelectorsAll],
  );
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);
  const [dsPath, setDsPath] = useState<string | null>(null);
  const [dsName, setDsName] = useState<string | null>(null);
  // Cached content of the selected DS's design.md. Read once on dsPath change
  // and threaded into ProjectContext.designSystemMarkdown so every system
  // prompt inlines the tokens. Without this the agent only sees the path
  // and silently ignores the DS.
  const [dsMarkdown, setDsMarkdown] = useState<string | null>(null);
  // F2.1 — Attach DS mid-project. Toolbar button opens this modal so the
  // user can pick / replace / detach a DS without restarting.
  const [attachDsOpen, setAttachDsOpen] = useState(false);
  // Composer-toolbar pickers (user ask 2026-05-21): mirror the NewProject
  // modal's 3 dropdowns (Provider / Model / DS) inside the chat input bar
  // so the user switches CLI, model, and DS without leaving the prompt.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [dsDropdownOpen, setDsDropdownOpen] = useState(false);
  const dsDropdownRef = useRef<HTMLDivElement>(null);
  const dsIconTriggerRef = useRef<HTMLButtonElement>(null);
  const [designSystems, setDesignSystems] = useState<FsDesignSystem[]>([]);
  const [dsSwatchCache, setDsSwatchCache] = useState<Record<string, string[]>>({});
  // providerStatus removed — AgentPicker fetches its own status; chat
  // input bar no longer hosts the provider picker.
  useEffect(() => {
    void listDesignSystemsFromFilesystem().then((list) => {
      if (list) setDesignSystems(list);
    });
  }, []);
  useEffect(() => {
    // 4-swatch palette cache, mirrored from NewProject so the DS dropdown
    // shows the brand colors next to each library entry.
    designSystems.forEach(async (ds) => {
      if (dsSwatchCache[ds.path]) return;
      try {
        const content = await readFileViaBridge(ds.designMdPath);
        if (!content) return;
        const text =
          typeof content === "string"
            ? content
            : ((content as { content?: string })?.content ?? "");
        const parsed = parseDesignSystem(text);
        const hexes = parsed.colors
          .slice(0, 4)
          .map((c) => c.hex)
          .filter(Boolean);
        if (hexes.length > 0) setDsSwatchCache((prev) => ({ ...prev, [ds.path]: hexes }));
      } catch {
        /* swallow — best effort */
      }
    });
  }, [designSystems]); // eslint-disable-line react-hooks/exhaustive-deps
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  // editOverrides was the global !important presets store driving the
  // old EditDrawer. Replaced by InlineEditPanel (element-scoped inline
  // edits). The const stays so the EditOverrides type import has a
  // referenced consumer; downstream callsites have all been removed.
  void ({} as EditOverrides);
  // Inline-edit selection state — driven by postMessage from the
  // iframe's runtime when canvasMode === "edit". null while nothing
  // selected (panel hidden). dirty flips true after the first
  // apply-style/apply-text and back to false on save.
  // Loaded once on mount from db.settings (`tasteDial:${dial}:${side}`).
  // Forwarded to buildCanonicalPlusBlock on every turn so the user's
  // edits in Settings → Taste actually show up in the system prompt.
  const [tasteDialOverrides, setTasteDialOverrides] = useState<
    Partial<Record<DialKey, Partial<DialDirection>>>
  >({});
  const [inlineEditSelection, setInlineEditSelection] = useState<InlineEditSelectPayload | null>(
    null,
  );
  const [inlineEditDirty, setInlineEditDirty] = useState(false);
  const [inlineEditSaving, setInlineEditSaving] = useState(false);
  // Iframe bounding rect — re-measured on selection so the floating
  // InlineEditPanel can translate the iframe-local selection rect into
  // viewport coordinates. Re-measured on window resize while in edit
  // mode so the panel follows iframe-layout changes (sidebar
  // collapse/expand, devtools open, etc).
  const [inlineEditIframeRect, setInlineEditIframeRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!inlineEditSelection) {
      // No selection → no need to track. Clearing helps the panel hide
      // immediately when selection clears too.
      if (inlineEditIframeRect) setInlineEditIframeRect(null);
      return;
    }
    const measure = () => {
      const r = iframeRef.current?.getBoundingClientRect() ?? null;
      setInlineEditIframeRect(r);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // We intentionally do not depend on inlineEditIframeRect — that
    // would cause an infinite measure loop. The cleanup re-runs only
    // when selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineEditSelection]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [saveVersionName, setSaveVersionName] = useState("");
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("opus");
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("claude");
  // Gate the auto-send effect on this — the async readGlobalConfig() call
  // that hydrates default_provider can resolve after the auto-send timer
  // would have fired, causing the first turn of a new project to route to
  // `claude` even when the user picked Codex / Gemini / etc in the new-
  // project modal. The auto-send waits for hydration so the right provider
  // gets the seed prompt.
  const [providerHydrated, setProviderHydrated] = useState(false);
  // Canonical+ payload loaded from db.setting `canonicalPlus:${projectId}`.
  // Persisted by App.tsx in handleCreateProject from the NewProject modal.
  // Read once on project mount and rebuilt into a system-prompt block via
  // buildCanonicalPlusBlock(). The block carries Format + Rules + Taste —
  // these used to be discarded after the modal submit. User ask
  // 2026-05-11: "garantir que estao sendo injetados no prompt inicial".
  // Tracked separately from `assistantTurnsSinceMount` so we can scope the
  // injection to the project's FIRST turn (subsequent turns rely on the
  // session id / chat history).
  const [canonicalPlusPayload, setCanonicalPlusPayload] = useState<CanonicalPlusInput | null>(null);
  // Which canonical+ elements are still injected into the turn. Each shows a
  // removable chip in the composer (like the DS chip); × deactivates it so
  // it stops being injected — the user typically wants Format/Rules/Taste to
  // shape the FIRST prompt then steps back on refines. Persisted per project.
  const [canonicalActive, setCanonicalActive] = useState<{
    format: boolean;
    rules: boolean;
    taste: boolean;
  }>({ format: true, rules: true, taste: true });
  // `canonicalPlusInjectedRef` + the companion `canonicalPlusInjected:${id}`
  // persistent flag were dropped 2026-05-17 (audit P0-C). The block is now
  // injected as a compact summary into the system prompt on EVERY turn, so
  // there's no longer a "did we deliver it once" question to track.
  // PromptConsole-on-editor surface was retired 2026-05-15 — duplicate
  // of the existing FullPromptModal pill on the toolbar. State removed;
  // PromptConsole remains used only by the NewProject modal.
  const [tweaksLoading, setTweaksLoading] = useState(false);
  const [tweaksRequest, setTweaksRequest] = useState("");
  const [showTweaksRequest, setShowTweaksRequest] = useState(false);
  // Abort handle for the currently-running tweaks stream, so the send button
  // can double as a Stop while tweaksLoading is true.
  const tweaksAbortRef = useRef<(() => void) | null>(null);
  // BUG-CANCEL: the Assistant / @agent flow (`sendSkillCommand`) streams via
  // `provider.stream()` DIRECTLY inside a `new Promise`, OUTSIDE the useClaude
  // controller — so its `status` never flips to "streaming" and the STOP
  // button never appeared. `agentStreaming` mirrors the tweaks `*Loading`
  // pattern so the STOP button surfaces; `agentAbortRef` holds the
  // `provider.stream()` unlisten so STOP (and unmount cleanup) can abort the
  // daemon SSE without leaking the stream.
  const [agentStreaming, setAgentStreaming] = useState(false);
  const agentAbortRef = useRef<(() => void) | null>(null);
  // BUG-CANCEL: raw unlisten kept separately so the unmount cleanup can close
  // the SSE WITHOUT touching React state (agentAbortRef's handler calls
  // setState, which would warn on an unmounted component). Cleared by the same
  // paths that clear agentAbortRef.
  const agentUnlistenRef = useRef<(() => void) | null>(null);
  // BUG-CANCEL: on unmount, abort any in-flight Assistant / @agent stream so we
  // don't leak the daemon SSE. Raw unlisten only — no setState.
  useEffect(() => {
    return () => {
      try {
        agentUnlistenRef.current?.();
      } catch {}
      agentUnlistenRef.current = null;
    };
  }, []);
  const tweaksAnchorRef = useRef<HTMLDivElement>(null);
  // Web Speech API for realtime dictation. Browser-native (Chrome/Edge/
  // Safari). Streams transcript into the chat input as the user speaks —
  // no wait-until-stop. The current input is preserved as a "baseline"
  // when recording starts, so dictated speech appends instead of replacing.
  const recognitionRef = useRef<unknown>(null);
  const recognitionBaselineRef = useRef<string>("");
  const [isRecording, setIsRecording] = useState(false);
  // Video tab onboarding state removed alongside the editor.

  // Editorial verbs registry — built-ins from src/runtime/verbs/* + customs
  // and overrides from ~/.design-factory/commands/*. Loads once on mount;
  // re-fetched after CRUD writes via the bus event below.
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [activeVerb, setActiveVerb] = useState<Verb | null>(null);
  const [showCommandLibrary, setShowCommandLibrary] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const all = await loadAllVerbs(
          async () => listCustomCommands(),
          async () => {
            try {
              const cfg = await (await import("@/lib/claude-bridge")).readGlobalConfig();
              const arr = (cfg as Record<string, unknown> | null)?.commands_disabled;
              return Array.isArray(arr) ? (arr as string[]) : [];
            } catch {
              return [];
            }
          },
          async () => {
            try {
              const { db } = await import("@/lib/claude-bridge");
              const raw = await db.getSetting("commands_hidden_builtins").catch(() => null);
              if (!raw) return [];
              const arr = JSON.parse(raw);
              return Array.isArray(arr) ? (arr as string[]) : [];
            } catch {
              return [];
            }
          },
        );
        if (!cancelled) setVerbs(all);
      } catch (e) {
        console.warn("[verbs] load failed", e);
      }
    };
    void load();
    const onChanged = () => {
      void load();
    };
    window.addEventListener("df-verbs-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("df-verbs-changed", onChanged);
    };
  }, []);
  // originalToken preserves what the user actually typed before navigation
  // (e.g. "/can") so Escape restores it. During arrow navigation the input
  // briefly shows the highlighted trigger while the cursor + start position
  // stay anchored to the typed token.
  const [slashState, setSlashState] = useState<{
    token: string;
    start: number;
    hi: number;
    originalToken: string;
  } | null>(null);
  // answeredQuestions maps a question block's raw text -> the label the
  // user picked. Once answered, the buttons disable and a follow-up
  // prompt is auto-sent so Claude can continue. Keyed by raw text so
  // questions in different messages don't collide.
  const [answeredQuestions, setAnsweredQuestions] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<
    Array<{ name: string; size: number; content: string; mime: string; preview?: string }>
  >([]);
  // Drag-active flag for the chat composer. Toggled by onDragOver/onDragLeave.
  const [composerDragActive, setComposerDragActive] = useState(false);
  // True when the chat log is scrolled away from the bottom while messages
  // are still streaming. The "↓ jump to latest" pill renders only then.
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Claude CLI session id for this project. Populated from `projects.session_id`
  // on mount; updated when the first turn of a fresh project receives its
  // init event. When non-null AND the active agent is claude, subsequent
  // turns run `claude --resume <id>` (no history concat in the prompt).
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  // Provider Handoff Layer v1: per-provider session map persisted to
  // `.df/provider-sessions.json`. Each entry has its own sessionId +
  // artifact_version_seen. The legacy `claudeSessionId` above is the
  // claude-only mirror — kept so existing call sites work unchanged.
  // When a v2 refactor migrates the chat to the handoff builder we drop
  // the mirror and read straight from this map.
  // providerSessions value is not currently read in JSX (the Fresh
  // button was the sole reader). The setter is still wired so the map
  // stays in sync with disk for future surfaces (Settings panel,
  // command palette). Underscore prefix silences the unused-var lint.
  const [, setProviderSessions] = useState<ProviderSessions>(EMPTY_PROVIDER_SESSIONS);
  // "Run claude login" banner — set by onAuthRequired. Dismiss on next
  // successful stream init.
  const [authRequiredBanner, setAuthRequiredBanner] = useState<string | null>(null);
  // Shown when the project's disk path no longer exists. Offers [Browse…] to
  // pick a new folder for the project record.
  const [missingPathBanner, setMissingPathBanner] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the current iframe HTML already has a df-tweaks-panel built in
  const hasBuiltInTweaks = (iframeHtml ?? "").includes("df-tweaks-panel");
  // ─── Video project detection + lifted ratio ──────────────────────────
  // Two signals mark a project as "video":
  //   1. HTML carries the scene manifest contract (data-scene + script).
  //   2. The user has the Video tab open (explicit user intent).
  // Either is enough — old projects pre-date the contract but the user
  // still wants the canvas to letterbox to the chosen aspect.
  const sceneManifestForCanvas = useMemo(
    () => (iframeHtml ? parseSceneManifest(iframeHtml) : null),
    [iframeHtml],
  );
  const hasVideoTab = canvasTabs.some((t) => t.kind === "video");
  const isVideoProject = !!sceneManifestForCanvas || hasVideoTab;
  // Lifted ratio state — the Video tab inspector mutates this and the
  // editor canvas letterbox aspect mirrors it. Canonical persistence is
  // .df/meta.json (travels with the project folder); localStorage is
  // legacy and migrated on first load.
  type VideoRatioId = "16:9" | "9:16" | "1:1" | "4k";
  const ratioStorageKey = projectId ? `df-video-ratio:${projectId}` : null;
  const isVideoRatio = (v: unknown): v is VideoRatioId =>
    v === "16:9" || v === "9:16" || v === "1:1" || v === "4k";
  const [videoRatio, setVideoRatio] = useState<VideoRatioId>(() => {
    // Initial render uses the same heuristic as before. The mount effect
    // below replaces this with meta.json (canonical) or migrates from
    // localStorage when present.
    if (iframeHtml && /sticky|scroll-snap|@scroll-timeline/i.test(iframeHtml)) return "9:16";
    return "16:9";
  });
  // Tracks whether a user (or the canvas-from-modal pre-select) actually
  // chose a ratio. Until that flag flips, we don't persist — otherwise the
  // mount default would overwrite a real value before it loads.
  const ratioPersistTouchedRef = useRef(false);
  // Mount: load video_ratio from .df/meta.json, with one-time migration
  // from the legacy localStorage key on first load.
  useEffect(() => {
    if (!projectId) return;
    const slug = projectPath ? slugFromPath(projectPath) : "";
    if (!slug) return;
    let cancelled = false;
    void (async () => {
      const meta = await readProjectMeta(slug);
      if (cancelled) return;
      if (meta?.video_ratio && isVideoRatio(meta.video_ratio)) {
        setVideoRatio(meta.video_ratio);
        ratioPersistTouchedRef.current = true;
        return;
      }
      // Legacy migration: localStorage was the previous source of truth.
      if (ratioStorageKey && typeof localStorage !== "undefined") {
        let raw: string | null = null;
        try {
          raw = localStorage.getItem(ratioStorageKey);
        } catch {}
        if (isVideoRatio(raw)) {
          setVideoRatio(raw);
          ratioPersistTouchedRef.current = true;
          if (meta) {
            await writeProjectMeta(slug, { ...meta, video_ratio: raw });
          }
          try {
            localStorage.removeItem(ratioStorageKey);
          } catch {}
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath, ratioStorageKey]);
  // Persist to .df/meta.json on every user-initiated change.
  useEffect(() => {
    if (!ratioPersistTouchedRef.current) return;
    if (!projectId) return;
    const slug = projectPath ? slugFromPath(projectPath) : "";
    if (!slug) return;
    let cancelled = false;
    void (async () => {
      const current = await readProjectMeta(slug);
      if (cancelled || !current) return;
      if (current.video_ratio === videoRatio) return;
      await writeProjectMeta(slug, { ...current, video_ratio: videoRatio });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath, videoRatio]);
  // Numeric aspect for JS sizing (CSS aspect-ratio + max-* combo silently
  // fails when both width AND height are 100% — the constraint takes over
  // and the ratio is dropped). Same pattern VideoTab uses.
  const videoAspectNum =
    videoRatio === "9:16"
      ? 9 / 16
      : videoRatio === "1:1"
        ? 1 / 1
        : videoRatio === "4k"
          ? 16 / 9
          : 16 / 9;
  // Wrap iframe content so html/body fill the letterbox, regardless of
  // any fixed dimensions inside the original markup. Plain HTML projects
  // skip wrapping so site layouts continue to flow naturally.
  // For video projects, we render the iframe at its INTRINSIC viewport
  // (1080×1920 for 9:16, etc) and scale via the wrapper. So the HTML
  // arrives unmodified — no viewport-fit shim that fights the inner
  // layout's absolute positioning. The shim is still used by the Video
  // tab letterbox preview which doesn't have intrinsic-size wrapping.
  // — inject the postMessage bridges into the preview HTML so
  // tweaks (real-time CSS-var updates) and element selection work even
  // when sandbox is strict. Both injectors are no-ops on non-HTML
  // content (they append at end-of-doc when </body> is missing, which
  // is harmless for the parent's perspective). They DO NOT touch the
  // file on disk — preview-rewrite only.
  const iframeSrcDocFinal = useMemo(() => {
    if (!iframeSrcDoc) return iframeSrcDoc;
    let out = iframeSrcDoc;
    out = injectTweaksListenerIntoHtml(out);
    out = injectInlineEditListenerIntoHtml(out);
    out = injectOverlayIntoHtml(out);
    out = injectNavGuardIntoHtml(out);
    return out;
  }, [iframeSrcDoc]);
  // Activate / deactivate the inline-edit bridge whenever canvasMode
  // crosses the "edit" boundary, and subscribe to incoming messages.
  //
  // 2026-05-19 — Sprint A re-skin: the drawer is now a fixed right
  // sidebar instead of a floating panel anchored to the selected
  // element. The previous viewport-rect caching (iframeBoundingRect +
  // recomputeIframeRect + window.resize listener) was deleted since
  // the panel no longer needs viewport coordinates.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (canvasMode !== "edit") return; // bridge stays inert outside edit mode
    // Wait a tick so the iframe's injected listener is attached. The
    // listener installs synchronously in the script tag at end-of-body,
    // but the activate message racing the iframe load can land before
    // the listener exists. The tweaks bridge has the same pattern.
    const sendActivate = () => postInlineEditToIframe(iframe, { type: "df:inline-edit:activate" });
    const t = window.setTimeout(sendActivate, 80);
    const unsub = listenInlineEditFromIframe(iframe, (msg) => {
      if (msg.type === "df:inline-edit:select") {
        setInlineEditSelection(msg.payload);
      } else if (msg.type === "df:inline-edit:deselect") {
        setInlineEditSelection(null);
      } else if (msg.type === "df:inline-edit:ack") {
        if (msg.ack === "apply-style" || msg.ack === "apply-text") {
          setInlineEditDirty(true);
        }
      } else if (msg.type === "df:inline-edit:text-changed") {
        // 2-click in-place text edit just blurred. Persist via the
        // canonical apply-text path so the drawer textarea, the iframe
        // DOM, and the eventual save round-trip all agree on the same
        // string. Mirror the selection's text field so the drawer's
        // textarea reflects the new value on next render.
        handleInlineEditApplyText(msg.path, msg.text);
        setInlineEditSelection((prev) =>
          prev && prev.path === msg.path ? { ...prev, text: msg.text } : prev,
        );
      } else if (msg.type === "df:inline-edit:html") {
        // Save round-trip resolution — handled by handleInlineEditSave
        // via a one-shot listener installed there. This branch
        // intentionally no-ops so the global listener doesn't double-
        // handle the save payload.
      }
    });
    return () => {
      window.clearTimeout(t);
      unsub();
      postInlineEditToIframe(iframe, { type: "df:inline-edit:deactivate" });
      setInlineEditSelection(null);
      setInlineEditDirty(false);
    };
  }, [canvasMode, iframeKey]);

  const handleInlineEditApplyStyle = useCallback((path: string, styles: InlineEditStyles) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    postInlineEditToIframe(iframe, { type: "df:inline-edit:apply-style", path, styles });
    setInlineEditDirty(true);
  }, []);

  const handleInlineEditApplyText = useCallback((path: string, text: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    postInlineEditToIframe(iframe, { type: "df:inline-edit:apply-text", path, text });
    setInlineEditDirty(true);
  }, []);

  const handleInlineEditSave = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe || !projectPath || !projectFileName) return;
    const htmlPath = `${projectPath.replace(/\/$/, "")}/${projectFileName}`;
    setInlineEditSaving(true);
    // One-shot listener for the get-html response. Set up FIRST so we
    // don't race the iframe's reply.
    const unsub = listenInlineEditFromIframe(iframe, (msg) => {
      if (msg.type !== "df:inline-edit:html") return;
      unsub();
      (async () => {
        try {
          await writeFile(htmlPath, msg.html);
          setInlineEditDirty(false);
          setToast("inline edits saved");
        } catch (e) {
          surfaceError(e, "inline-edit-save");
        } finally {
          setInlineEditSaving(false);
        }
      })();
    });
    postInlineEditToIframe(iframe, { type: "df:inline-edit:get-html" });
  }, [projectPath, projectFileName]);

  const handleInlineEditCancel = useCallback(() => {
    // Discard live edits by reloading the iframe from disk (the canvas
    // has its own load pipeline keyed off iframeKey; bumping it forces
    // a fresh hydrate). The bridge auto-deactivates on canvasMode
    // change, but we want to stay in edit mode — just reset.
    setInlineEditSelection(null);
    setInlineEditDirty(false);
    setIframeKey((k) => k + 1);
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  // Auto-grow the composer with its content: reset to auto so scrollHeight
  // reflects the true content height, then clamp to the CSS max (after which
  // it scrolls). Runs on every input change, including programmatic ones
  // (slash insert, seed prompt). The box is bottom-anchored, so growing the
  // field visually expands upward.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [input]);
  const chatInputBoxRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const {
    output,
    status,
    error,
    modelName,
    result,
    tools,
    applyStyle,
    runVerb,
    cancel: cancelStream,
    reset,
  } = useClaude();

  // Live mirrors of state the auto-send poller reads at fire time. Kept in
  // refs so the polling loop (which lives outside the React render cycle)
  // always sees the current value without re-subscribing. See the auto-send
  // effect (BUG-16/17) for why polling beats a single timer here.
  const inputRef = useRef("");
  const statusRef = useRef(status);
  const bridgeAvailableRef = useRef<boolean | null>(null);
  statusRef.current = status; // cheap, runs every render — always current
  inputRef.current = input;
  bridgeAvailableRef.current = bridgeAvailable;

  // Humanized "what's happening on the canvas right now" label. Drives
  // the streaming banner pinned over the iframe. Resolution order:
  //   1. Most recent in-flight tool on the streaming assistant message
  //      (Read/Write/Edit/Bash/etc with file/path arguments).
  //   2. Tweaks build in progress.
  //   3. Generic "generating preview…" while text streams without tools.
  // Mid-stream write tracker — populated by the FS poller below; the
  // canvasStatusLabel uses this to surface the leaf filename of any HTML/
  // asset mutated mid-turn (covers CLIs whose tool events DF can't parse).
  const [lastWrittenFile, setLastWrittenFile] = useState<{ name: string; ts: number } | null>(null);

  const canvasStatusLabel = useMemo(() => {
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && last.streaming) {
      const tools = last.tools ?? [];
      // Walk backwards — pick the most recent tool that hasn't completed.
      for (let i = tools.length - 1; i >= 0; i--) {
        const tool = tools[i];
        if (tool.result) continue;
        const name = tool.name;
        const inp = (tool.input ?? {}) as Record<string, unknown>;
        const filePath =
          (typeof inp.file_path === "string" && inp.file_path) ||
          (typeof inp.path === "string" && inp.path) ||
          (typeof inp.filename === "string" && inp.filename) ||
          "";
        const fileLeaf = filePath ? filePath.split("/").pop() || filePath : "";
        if (name === "Read" || name === "ReadFile") {
          return fileLeaf ? tf("chat.tool.verb.read.one", fileLeaf) : t("chat.status.reading");
        }
        if (name === "Write") {
          return fileLeaf ? tf("chat.tool.verb.write.one", fileLeaf) : t("chat.status.writing");
        }
        if (name === "Edit" || name === "MultiEdit") {
          return fileLeaf ? tf("chat.tool.verb.edit.one", fileLeaf) : t("chat.status.editing");
        }
        if (name === "Bash") return t("chat.status.bash");
        if (name === "Glob" || name === "Grep") return t("chat.status.searching");
        if (name === "WebFetch" || name === "WebSearch") return t("chat.status.fetching");
        // Unknown tool — show its raw name rather than nothing.
        return name;
      }
      // Streaming assistant message but no in-flight tool right now —
      // text already accumulating means the model is mid-response;
      // empty means it's still thinking. Avoids the "Iniciando…" fallback
      // sticking for the entire V2 turn (which never flips useClaude's
      // legacy `status === streaming`). User repro 2026-05-20.
      //
      // Filesystem activity wins over the generic "generating" label:
      // when the FS poller detects a fresh write during the turn, surface
      // the actual file leaf. Works for ANY CLI regardless of whether it
      // emits tool events DF can parse (covers Kimi/Codex/Gemini cases
      // where tools[] is empty but the file IS being written).
      if (lastWrittenFile) {
        return tf("chat.tool.verb.write.one", lastWrittenFile.name);
      }
      if (typeof last.text === "string" && last.text.trim().length > 0) {
        return t("chat.status.generating");
      }
      return t("chat.status.thinking");
    }
    if (manualBusy) return t("chat.status.editing");
    if (tweaksLoading) return t("chat.status.thinking");
    if (status === "streaming") return t("chat.status.generating");
    return t("chat.status.starting");
  }, [messages, status, tweaksLoading, manualBusy, lastWrittenFile, t, tf]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  // Keyboard shortcuts hint overlay (?) — separate state from cmd-palette
  // because they serve different audiences (palette = action search;
  // overlay = "what shortcuts exist?").
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Latest-handlers ref so the keydown listener can call functions
  // declared LATER in this component without recreating the listener
  // on every render.
  const undoRedoRef = useRef<{ undo: () => void; redo: () => void } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditableField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target as HTMLElement).isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCmdPalette((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setShowCmdPalette(false);
        setShowExportMenu(false);
        setShowModelMenu(false);
        setShowShortcuts(false);
        setPresenting(false);
        return;
      }
      // Cmd/Ctrl + Z / Shift+Z — undo/redo. Always wins over textarea
      // browser default for the canvas history (textarea undo still
      // works inside the chat input itself because we eat the event
      // here only when the user isn't typing in a field).
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        if (inEditableField) return;
        e.preventDefault();
        const handlers = undoRedoRef.current;
        if (e.shiftKey) handlers?.redo();
        else handlers?.undo();
        return;
      }
      if (inEditableField) return;
      // Space — play/pause the video transport.
      if (e.code === "Space") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("df:transport", { detail: { action: "playToggle" } }));
        return;
      }
      // Arrow keys — frame-step scrub. Shift+Arrow = 1s jump, plain = ~33ms.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const stepMs = e.shiftKey ? 1000 : 33;
        const dir = e.key === "ArrowRight" ? 1 : -1;
        window.dispatchEvent(
          new CustomEvent("df:transport", { detail: { action: "step", deltaMs: dir * stepMs } }),
        );
        return;
      }
      // ? — open shortcuts overlay.
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load persisted model selection. Filesystem config is canonical;
  // DB only kicks in when the bridge is offline / Tauri path.
  //
  // User QA 2026-05-15: "selecionei kimi code cli, escolhi model no
  // modal ... mas no chat diz claude e no prompt box diz opus".
  // Root cause: the original guard whitelisted only Claude model ids
  // ("opus" / "sonnet" / "haiku") so any non-Claude pick (kimi,
  // codex, etc) fell through silently and the UI showed the hard-coded
  // default "opus". Model ids are owned by the provider, not the
  // EditorScreen — any non-empty string is valid; rendering layers
  // know how to label it.
  useEffect(() => {
    (async () => {
      const fromFs = await readGlobalConfig();
      const m = fromFs?.model ?? (await db.getSetting("model").catch(() => null));
      if (typeof m === "string" && m.trim().length > 0) {
        setSelectedModel(m);
      }
    })();
  }, []);

  // Load claude session_id for this project. If set, subsequent turns pass
  // `--resume <id>` instead of re-sending the whole transcript. Fails silent
  // — a null value just means the first turn will seed the session.
  useEffect(() => {
    if (!projectId) return;
    db.getProjectSession(projectId)
      .then((sid) => {
        if (sid) setClaudeSessionId(sid);
      })
      .catch(() => {});
  }, [projectId]);

  // Provider Handoff Layer v1: persistence helper declared early so the
  // send-path closures can capture it. The slug it relies on is computed
  // further down (around line 1552, derived from projectPath) — we read
  // it via a ref so the order doesn't matter.
  const projectSlugRef = useRef<string | null>(null);
  const persistProviderSession = useCallback(
    (sid: string) => {
      setClaudeSessionId(sid);
      const slug = projectSlugRef.current;
      if (!slug) return;
      void upsertProviderSession(slug, selectedProvider, { sessionId: sid })
        .then(setProviderSessions)
        .catch(() => {});
    },
    [selectedProvider],
  );

  // Verify the project's on-disk path still exists. Renamed / moved folders
  // surface as a dismissible banner with [Browse…] instead of failing later
  // inside a tool call. Tauri-only — browser preview skips the check.
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    pathExists(projectPath)
      .then((exists) => {
        if (cancelled) return;
        setMissingPathBanner(exists ? null : projectPath);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // Re-probe the dev bridge when the tab/window comes back to foreground.
  // Matches the pattern the CLAUDE.md notes after flaky SSH port-forwards.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) {
        refreshBridgeStatus().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Load design system setup + workspace + default agent.
  // Per-project cwd override (`cwd:{projectId}`) takes precedence over the
  // global `workspace_root`. If neither is set, `workspaceRoot` stays null and
  // claude spawns in the project folder.
  useEffect(() => {
    db.getSetting("ds_path")
      .then((p) => setDsPath(p))
      .catch(() => {});
    db.getSetting("ds_name")
      .then((n) => setDsName(n))
      .catch(() => {});
    // User QA 2026-05-15: same root cause as the model guard above —
    // the original whitelist only knew 4 provider ids. V1 beta ships 10
    // (claude, codex, gemini, opencode, kimi, anthropic, openai,
    // gemini-api, openrouter, ollama); the schema enum below is the
    // single source of truth.
    (async () => {
      const fromFs = await readGlobalConfig();
      const p =
        fromFs?.default_provider ?? (await db.getSetting("default_provider").catch(() => null));
      const parsed = ProviderIdSchema.safeParse(p);
      if (parsed.success) {
        setSelectedProvider(parsed.data);
      }
      setProviderHydrated(true);
    })();
    // AgentPicker (header dropdown) fires df:provider-change with the new
    // ProviderId when the user picks a different agent. Listen so chat
    // dispatch picks up the change without a reload.
    const onProviderChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { providerId?: ProviderId } | undefined;
      const parsed = ProviderIdSchema.safeParse(detail?.providerId);
      if (parsed.success) {
        setSelectedProvider(parsed.data);
      }
    };
    window.addEventListener("df:provider-change", onProviderChange);
    (async () => {
      const override = projectId ? await db.getSetting(`cwd:${projectId}`).catch(() => null) : null;
      if (override) {
        setWorkspaceRoot(override);
      } else {
        const global = await db.getSetting("workspace_root").catch(() => null);
        setWorkspaceRoot(global || null);
      }
    })();
    return () => {
      window.removeEventListener("df:provider-change", onProviderChange);
    };
  }, [projectId, projectPath]);

  // Re-sync ds_path/ds_name on window focus — user may change DS in
  // Home while the editor is open; picks up the switch on return.
  //
  // User QA 2026-05-17: "tive que recarregar a pagina pra aparecer
  // o html, e qnd recarreguei o ds mudou de hyve para spotify". Root
  // cause: this handler ALWAYS overwrote dsPath with the GLOBAL
  // `ds_path` setting, even when the current project had a per-project
  // DS pick in canonicalPlus:${id}.designSystem. On reload, focus
  // fired, the global (stale "Spotify" from a prior session) replaced
  // the project's HYVE pick.
  //
  // Fix: prefer the project-level pick first. Only fall back to the
  // global setting when the project has no per-project DS — which is
  // the original "I changed Settings in Home tab" scenario the handler
  // was written for.
  useEffect(() => {
    const onFocus = async () => {
      try {
        if (projectId) {
          const raw = await db.getSetting(`canonicalPlus:${projectId}`).catch(() => null);
          if (raw) {
            const parsed = JSON.parse(raw) as { designSystem?: string | null };
            if (parsed?.designSystem && typeof parsed.designSystem === "string") {
              setDsPath(parsed.designSystem);
              // BUG-28: separator-agnostic — a Windows DS path uses
              // backslashes, so split("/").pop() returned the WHOLE path
              // and the DS chip showed the caminho instead of the name.
              const slug = slugFromPath(parsed.designSystem) || null;
              if (slug) setDsName(slug);
              return;
            }
          }
        }
        // No per-project DS pick → fall back to the global setting.
        const p = await db.getSetting("ds_path").catch(() => null);
        const n = await db.getSetting("ds_name").catch(() => null);
        setDsPath(p);
        setDsName(n);
      } catch {
        // any failure → leave existing state alone, don't reset to global.
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId]);

  // Load design.md content when dsPath changes. Cache the markdown so
  // every ProjectContext build inlines it. Path conventions:
  //   {dsPath}/design.md  (primary, @google/design.md spec)
  //   {dsPath}/DESIGN.md  (fallback for uppercase)
  useEffect(() => {
    if (!dsPath) {
      setDsMarkdown(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const candidates = [
        `${dsPath.replace(/\/$/, "")}/design.md`,
        `${dsPath.replace(/\/$/, "")}/DESIGN.md`,
      ];
      for (const p of candidates) {
        try {
          const file = await readFileViaBridge(p);
          if (cancelled) return;
          if (
            file &&
            typeof file === "object" &&
            "content" in file &&
            typeof file.content === "string" &&
            file.content.length > 0
          ) {
            setDsMarkdown(file.content);
            return;
          }
        } catch {}
      }
      // Not found — still flag as "has DS" but without content, prompt will
      // fall back to "read design.md yourself" path.
      if (!cancelled) setDsMarkdown(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [dsPath]);

  // Old EditDrawer hydrate/persist removed alongside the drawer (user
  // ask 2026-05-11: drawer compete com Tweaks, opções ruins, vamos
  // remover). The new InlineEditPanel persists by writing the actual
  // HTML file via the Save button — no per-project localStorage layer.

  // ─── Persistent canvas effects ─────────────────────────────────
  // Mirror iframeHtml -> iframeSrcDoc, unless setIframeContent has
  // flagged the next change to suppress reload (DOM was already
  // patched in place).
  useEffect(() => {
    if (suppressNextReloadRef.current) {
      suppressNextReloadRef.current = false;
      return;
    }
    setIframeSrcDoc(iframeHtml);
  }, [iframeHtml]);

  // Restore pending scroll position after every iframe load. pendingScrollRestoreRef
  // is set by setIframeContent (replace path), handleReload, and the per-project
  // scroll-restore effect on project mount. Runs before editOverrides re-apply
  // (declared below) — so the scroll snap happens, then style overrides paint.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      try {
        const win = iframe.contentWindow;
        const target = pendingScrollRestoreRef.current;
        if (win && target !== null) {
          win.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
          pendingScrollRestoreRef.current = null;
        }
      } catch {
        // strict sandbox → cross-origin frame; can't restore scroll.
      }
      // Edge case 6.1: re-validate comment selectors after every reload.
      // Covers Versions restore, generate, tweaks panel injection, etc.
      validateCommentSelectorsAll();
    };
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [iframeKey, iframeSrcDoc, validateCommentSelectorsAll]);

  // Link-guard. Generated HTML often carries <a href> nav links. Because the
  // preview is an about:srcdoc document under allow-same-origin, relative and
  // same-origin hrefs resolve against the app origin (localhost:1420) and a
  // click navigates the iframe straight into DF's own routes, escaping the
  // preview. We intercept navigation clicks: in-page hash anchors scroll as
  // usual; external http(s) links open in a new tab; relative / same-origin
  // paths are blocked. Inactive in comment mode, where the comment handler
  // already preventDefaults every click.
  useEffect(() => {
    if (canvasMode === "comment") return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cleanup: (() => void) | null = null;
    const attach = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const onClick = (e: MouseEvent) => {
          const target = e.target as Element | null;
          const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!anchor) return;
          const raw = anchor.getAttribute("href") || "";
          if (raw === "" || raw.startsWith("#")) return; // in-page scroll
          e.preventDefault();
          e.stopPropagation();
          if (/^https?:\/\//i.test(raw)) {
            window.open(anchor.href, "_blank", "noopener,noreferrer");
          }
          // Relative / same-origin paths fall through: blocked, no navigation.
        };
        doc.addEventListener("click", onClick, true);
        cleanup = () => doc.removeEventListener("click", onClick, true);
      } catch {
        // cross-origin (strict sandbox) or document not ready
      }
    };
    if (iframe.contentDocument?.readyState === "complete") attach();
    else iframe.addEventListener("load", attach);
    return () => {
      iframe.removeEventListener("load", attach);
      cleanup?.();
    };
  }, [canvasMode, iframeKey, iframeSrcDoc]);

  // Persist iframe scrollY per (project, canvas tab) so reopening the project
  // (or switching between canvas tabs) lands the user back at the position they
  // left. Debounced via rAF — single write per frame.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !projectId) return;
    const tabKey = `iframe-scroll:${projectId}:${activeCanvasTab}`;
    const onScroll = () => {
      if (scrollSaveScheduledRef.current !== null) return;
      scrollSaveScheduledRef.current = requestAnimationFrame(() => {
        scrollSaveScheduledRef.current = null;
        let y = 0;
        try {
          y = iframe.contentWindow?.scrollY ?? 0;
        } catch {
          return; // strict sandbox → cross-origin frame; scroll unreadable.
        }
        db.setSetting(tabKey, String(y)).catch(warn("setSetting:tabKey"));
      });
    };
    const attach = () => {
      try {
        iframe.contentWindow?.addEventListener("scroll", onScroll, { passive: true });
      } catch {
        // strict sandbox → cross-origin frame; can't observe scroll.
      }
    };
    iframe.addEventListener("load", attach);
    attach();
    return () => {
      iframe.removeEventListener("load", attach);
      try {
        iframe.contentWindow?.removeEventListener("scroll", onScroll);
      } catch {
        /* cross-origin frame already torn down */
      }
      if (scrollSaveScheduledRef.current !== null) {
        cancelAnimationFrame(scrollSaveScheduledRef.current);
        scrollSaveScheduledRef.current = null;
      }
    };
  }, [projectId, activeCanvasTab, iframeKey]);

  // On project mount, queue the saved scroll position so the next iframe load
  // restores it. iframe load happens after iframeHtml is hydrated from disk.
  useEffect(() => {
    if (!projectId) return;
    const tabKey = `iframe-scroll:${projectId}:${activeCanvasTab}`;
    db.getSetting(tabKey)
      .then((raw) => {
        if (typeof raw !== "string") return;
        const y = Number(raw);
        if (!Number.isFinite(y)) return;
        pendingScrollRestoreRef.current = y;
      })
      .catch(() => {});
  }, [projectId, activeCanvasTab]);

  // OLD: two useEffects injected <style id="__df-edit-overrides__"> with
  // buildEditCss(editOverrides) — drove the !important global Dark/
  // Cyber/Pastel/etc presets. Removed alongside EditDrawer (user ask
  // 2026-05-11). The inline-edit panel writes inline styles directly
  // on selected elements via the postMessage bridge — no global
  // override layer needed.

  // Load versions for this project.
  //
  // versions are now canonical on disk
  // at <projectPath>/.df/versions/<vid>.json. The DB blob remains as a
  // last-resort cache (covers the bridge being down OR a legacy project
  // that was created before this migration). Resolution order:
  //   1. Filesystem (daemon listProjectVersions) — authoritative if non-empty
  //   2. DB cache + lazy-migrate — push each cached version to disk in
  //      the background so the FS becomes authoritative on next load
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const slug = slugFromPath(projectPath ?? "");

    (async () => {
      // 1. Try filesystem first
      if (slug) {
        const fromFs = await listProjectVersions(slug).catch(() => null);
        if (cancelled) return;
        if (fromFs && fromFs.length > 0) {
          setVersions(fromFs as Version[]);
          // Refresh the DB cache so subsequent boots stay fast even if the
          // bridge briefly drops. Best-effort.
          db.setSetting(`versions:${projectId}`, JSON.stringify(fromFs)).catch(
            warn("setSetting:versions::projectId"),
          );
          return;
        }
      }
      // 2. Fall back to DB cache
      try {
        const raw = await db.getSetting(`versions:${projectId}`);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        setVersions(parsed);
        // Lazy migration: push each cached version to disk in the
        // background. Best-effort; failures are silent (the DB cache is
        // still authoritative). Subsequent loads will then read from FS.
        if (slug) {
          void (async () => {
            for (const v of parsed) {
              if (!v || typeof v.id !== "string" || typeof v.html !== "string") continue;
              await saveProjectVersion(slug, {
                id: v.id,
                html: v.html,
                ...(v.name ? { name: v.name } : {}),
                ...(v.note ? { note: v.note } : {}),
                createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
                auto: typeof v.auto === "boolean" ? v.auto : true,
              }).catch(() => false);
            }
          })();
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath]);

  const persistVersions = useCallback(
    (list: Version[]) => {
      setVersions(list);
      if (projectId)
        db.setSetting(`versions:${projectId}`, JSON.stringify(list)).catch(
          warn("setSetting:versions::projectId"),
        );
      // mirror to filesystem. Best-effort — DB cache is still the
      // synchronous source. We diff against the previous list inside the
      // callback would be more efficient, but persistVersions is called
      // O(N) times per session (N = number of named saves + auto checkpoints
      // for the project) and each call is at most one extra POST per new
      // version, so N writes total is acceptable.
      const slug = slugFromPath(projectPath ?? "");
      if (slug) {
        void (async () => {
          for (const v of list) {
            await saveProjectVersion(slug, {
              id: v.id,
              html: v.html,
              ...(v.name ? { name: v.name } : {}),
              ...(v.note ? { note: v.note } : {}),
              createdAt: v.createdAt,
              auto: v.auto,
            }).catch(() => false);
          }
        })();
      }
    },
    [projectId, projectPath],
  );

  // Helper used by verb runs, approval detection, and post-generate hooks.
  // Skips consecutive dupes; caps auto entries at 20 (named are unbounded).
  const autoCheckpoint = useCallback(
    (html: string, label?: string) => {
      if (!projectId || !html || html.trim().length < 40) return;
      const slug = slugFromPath(projectPath ?? "");
      setVersions((prev) => {
        const lastAuto = [...prev].reverse().find((v) => v.auto);
        if (lastAuto && lastAuto.html === html) return prev;
        const next: Version = {
          id: crypto.randomUUID(),
          html,
          createdAt: Date.now(),
          auto: true,
          ...(label ? { name: label } : {}),
        };
        const kept = [...prev, next];
        const autoCount = kept.filter((v) => v.auto).length;
        let final = kept;
        let prunedIds: string[] = [];
        if (autoCount > 20) {
          let dropped = 0;
          final = kept.filter((v) => {
            if (v.auto && dropped < autoCount - 20) {
              dropped += 1;
              prunedIds.push(v.id);
              return false;
            }
            return true;
          });
        }
        db.setSetting(`versions:${projectId}`, JSON.stringify(final)).catch(
          warn("setSetting:versions::projectId"),
        );
        // mirror to filesystem (best-effort).
        if (slug) {
          void saveProjectVersion(slug, {
            id: next.id,
            html: next.html,
            ...(next.name ? { name: next.name } : {}),
            createdAt: next.createdAt,
            auto: next.auto,
          }).catch(() => false);
          // Drop the pruned files so disk doesn't grow unbounded.
          for (const pid of prunedIds) {
            void deleteProjectVersion(slug, pid).catch(() => false);
          }
        }
        return final;
      });
    },
    [projectId, projectPath],
  );

  // Approval-phrase detector — when the user signals satisfaction, snap a
  // checkpoint so they can return to the approved state later. Bilingual.
  const APPROVAL_RE =
    /\b(perfeito|perfect|ficou bom|isso mesmo|ta perfeito|approved|aprovado|love it|exactly|ship it|pode deployar|ta otimo|ta ótimo|excelente)\b/i;

  // Pending checkpoint label — set right before an async operation that
  // will update iframeHtml. The effect below fires the checkpoint as
  // soon as the new html lands, then clears the pending flag.
  const pendingCheckpointRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingCheckpointRef.current) return;
    if (!iframeHtml) return;
    autoCheckpoint(iframeHtml, pendingCheckpointRef.current);
    pendingCheckpointRef.current = null;
  }, [iframeHtml, autoCheckpoint]);

  // Load comments for this project
  useEffect(() => {
    if (!projectId) return;
    db.getSetting(`comments:${projectId}`)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setComments(parsed);
        } catch {}
      })
      .catch(() => {});
  }, [projectId]);

  const persistComments = useCallback(
    (list: Comment[]) => {
      setComments(list);
      if (projectId)
        db.setSetting(`comments:${projectId}`, JSON.stringify(list)).catch(
          warn("setSetting:comments::projectId"),
        );
    },
    [projectId],
  );

  // Inject click handler into iframe when Comment mode is active (same-origin via allow-same-origin)
  useEffect(() => {
    if (canvasMode !== "comment" || !iframeHtml) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cleanup: (() => void) | null = null;
    const attach = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        const handler = (e: MouseEvent) => {
          const target = e.target as Element | null;
          if (!target) return;
          // Skip clicks on the in-HTML tweaks panel and the edit-override style tag
          if (target.closest && target.closest("#df-tweaks-panel")) return;
          if ((target as HTMLElement).id === "__df-edit-overrides__") return;
          e.preventDefault();
          e.stopPropagation();
          const selector = computeSelector(target);
          const snippet = (target.outerHTML || "").slice(0, 140).replace(/\s+/g, " ");
          setCommentTarget({ selector, snippet });
          setShowCommentInput(true);
        };
        doc.addEventListener("click", handler, true);
        // Visual feedback: subtle outline on hover while in comment mode
        const hoverIn = (e: Event) => {
          const el = e.target as HTMLElement | null;
          if (!el) return;
          if (el.closest && el.closest("#df-tweaks-panel")) return;
          el.dataset.__dfPrevOutline = el.style.outline;
          el.style.outline = "2px solid #ef5d3b";
          el.style.outlineOffset = "2px";
          el.style.cursor = "crosshair";
        };
        const hoverOut = (e: Event) => {
          const el = e.target as HTMLElement | null;
          if (!el) return;
          if (el.closest && el.closest("#df-tweaks-panel")) return;
          el.style.outline = el.dataset.__dfPrevOutline ?? "";
          el.style.outlineOffset = "";
          el.style.cursor = "";
        };
        doc.body.addEventListener("mouseover", hoverIn, true);
        doc.body.addEventListener("mouseout", hoverOut, true);

        cleanup = () => {
          doc.removeEventListener("click", handler, true);
          doc.body.removeEventListener("mouseover", hoverIn, true);
          doc.body.removeEventListener("mouseout", hoverOut, true);
        };
      } catch {
        // cross-origin or not ready yet
      }
    };

    // Attach after iframe loads (srcDoc re-renders trigger new load)
    if (iframe.contentDocument?.readyState === "complete") {
      attach();
    } else {
      iframe.addEventListener("load", attach);
    }
    return () => {
      iframe.removeEventListener("load", attach);
      cleanup?.();
    };
  }, [canvasMode, iframeHtml, iframeKey]);

  // element overlay bridge effects removed.
  // The listener / select-mode push / inspector cleanup all served the
  // "select" canvas mode that no longer ships. Restoring is a matter of
  // bringing back the listener + ElementInspectorPanel render — the
  // injector still runs in iframeSrcDocFinal so the preview side of the
  // bridge is intact.

  // — handle df:resize from the in-iframe tweaks bridge. We
  // don't strictly NEED this when the iframe is sized by its parent
  // CanvasStage, but it's the documented escape hatch for any future
  // canvas where height-fits-content matters (e.g. the strict-sandbox
  // dashboard preview). Currently a no-op observer; logging surface
  // for diagnostics.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const unsub = listenTweaksFromIframe(iframe, (msg) => {
      if (msg.type === "df:resize") {
        // Reserved hook — wire to setIframeHeight when needed.
      }
    });
    return () => unsub();
  }, [iframeKey]);

  // Close the slash menu when the user clicks outside the chat input
  // box. Without this, the menu persists after focus moves elsewhere.
  useEffect(() => {
    if (!slashState) return;
    const handler = (e: MouseEvent) => {
      const box = chatInputBoxRef.current;
      if (!box) return;
      if (!box.contains(e.target as Node)) setSlashState(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [slashState]);

  // When iframeHtml becomes non-null but the main (HTML preview) tab was
  // previously closed, re-add it so new generations surface as a tab again.
  // Complements closeCanvasTab's new "main can be closed" behavior.
  useEffect(() => {
    if (!iframeHtml) return;
    setCanvasTabs((prev) => {
      if (prev.some((t) => t.id === "main")) return prev;
      return [{ id: "main", name: projectFileName, kind: "preview" }, ...prev];
    });
  }, [iframeHtml, projectFileName]);

  // Safety net: on regular-flow completion (done/error), clear streaming on
  // any claude message still marked as streaming. Covers bridge disconnects
  // that bypass onDone/onError. DOESN'T fire during skill flow since skills
  // don't transition `status` (they manage their own lifecycle inside
  // sendSkillCommand). This only catches the regular generate/refine path.
  useEffect(() => {
    if (status !== "done" && status !== "error") return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.role === "assistant" && m.streaming) {
          changed = true;
          return { ...m, streaming: false };
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, [status]);

  // Probe dev bridge status
  useEffect(() => {
    let cancelled = false;
    const probe = () =>
      refreshBridgeStatus().then((s) => {
        if (!cancelled) setBridgeAvailable(s.available);
      });
    probe();
    const interval = window.setInterval(probe, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Seed prompt from example (one-time per PROJECT, persisted in db so HMR
  // re-mount doesn't re-fire the auto-send and overwrite user's work).
  // User reported 2026-04-27: "ele mandou o prompt inicial denovo,
  // sobrescreveu minha solicitacoes de tweaks e voltou pra versao antiga
  // do html". Root cause: in-memory refs reset across HMR re-mounts.
  const seededRef = useRef(false);
  const autoSendRef = useRef(false);
  const [autoSentHydrated, setAutoSentHydrated] = useState(false);
  // Direction selection persisted at project creation. Read on mount and
  // surfaced to handleSend so every iteration preserves the format prefix
  // (scene contract, anti-slop, directions) — without this, follow-ups
  // strip the format context and the AI drifts off the preset.
  const [projectDirection, setProjectDirection] = useState<DirectionSelection | null>(null);
  // Tracks whether the user has manually picked a ratio for this project.
  // Once they do, projectDirection.canvas.ratio stops auto-overriding it.
  const ratioUserOverriddenRef = useRef(false);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await db.getSetting(`directionSelection:${projectId}`);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as DirectionSelection;
        if (parsed && typeof parsed.formatoId === "string") setProjectDirection(parsed);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  // When direction loads (or changes), pre-seed videoRatio from canvas
  // override. ratioPersistTouchedRef gates this — if the mount effect
  // already loaded a value from meta.json (or migrated from localStorage),
  // the flag is set and we don't override it here.
  useEffect(() => {
    if (!projectDirection || ratioUserOverriddenRef.current) return;
    if (ratioPersistTouchedRef.current) return;
    const ratio = projectDirection.canvas?.ratio;
    if (ratio && isVideoRatio(ratio) && ratio !== videoRatio) {
      setVideoRatio(ratio);
      // Mark touched so the persist effect writes this canvas-derived
      // value to .df/meta.json. Without this, the next mount falls back
      // to the heuristic and the canvas pre-select is silently lost.
      ratioPersistTouchedRef.current = true;
    }
  }, [projectDirection, videoRatio]);
  const setVideoRatioWithOverride = useCallback((next: VideoRatioId) => {
    ratioUserOverriddenRef.current = true;
    ratioPersistTouchedRef.current = true;
    setVideoRatio(next);
  }, []);

  // F2.1 — Attach / detach DS mid-project. Reads current meta.json,
  // patches ds_path + ds_name (or clears them on null), writes back.
  // Triggers a re-read of the design.md content via the dsPath effect
  // so the next prompt's system message inlines the new tokens.
  const handleAttachDs = useCallback(
    async (ds: FsDesignSystem | null) => {
      const slug = projectPath ? slugFromPath(projectPath) : "";
      if (!slug) {
        setAttachDsOpen(false);
        return;
      }
      const next = ds ? { path: ds.path, name: ds.name } : { path: null, name: null };
      setDsPath(next.path);
      setDsName(next.name);
      try {
        const current = await readProjectMeta(slug);
        if (current) {
          await writeProjectMeta(slug, {
            ...current,
            ds_path: next.path ?? undefined,
            ds_name: next.name ?? undefined,
          });
        }
      } catch (err) {
        console.warn("[ds-attach] writeProjectMeta failed", err);
      }
      setAttachDsOpen(false);
    },
    [projectPath],
  );

  // Ratio-change state machine.
  // The Video tab inspector requests a ratio change instead of applying it
  // directly; this state owns the modal/overlay/regen lifecycle so a click
  // never destroys content without confirmation.
  type RatioChangeState =
    | { phase: "idle" }
    | { phase: "confirming"; targetRatio: VideoRatioId }
    | {
        phase: "regenerating";
        targetRatio: VideoRatioId;
        tokensCount: number;
        startedAt: number;
        abort: () => void;
        backup: string;
      }
    | { phase: "error"; message: string };
  const [ratioChange, setRatioChange] = useState<RatioChangeState>({ phase: "idle" });

  // onRatioChangeRequest helper removed alongside VideoTab — the
  // ratio-regen state machine below (onConfirmRatioChange / onCancelConfirm)
  // remains so a future surface can re-wire the request entry point.

  const onCancelConfirm = useCallback(() => {
    setRatioChange({ phase: "idle" });
  }, []);

  const onConfirmRatioChange = useCallback(() => {
    if (ratioChange.phase !== "confirming") return;
    const targetRatio = ratioChange.targetRatio;
    const html = iframeHtml ?? "";
    const slug = projectPath ? slugFromPath(projectPath) : "";
    if (!slug || !projectPath) {
      setRatioChange({
        phase: "error",
        message: "Projeto sem path resolvido — não consigo regenerar.",
      });
      return;
    }

    const { promise, abort } = regenerateForRatio({
      slug,
      projectPath,
      html,
      oldRatio: videoRatio,
      newRatio: targetRatio,
      config: { model: selectedModel, agent: selectedProvider, cwd: projectPath },
      onTokens: (count) => {
        setRatioChange((prev) =>
          prev.phase === "regenerating" ? { ...prev, tokensCount: count } : prev,
        );
      },
    });

    setRatioChange({
      phase: "regenerating",
      targetRatio,
      tokensCount: 0,
      startedAt: Date.now(),
      abort,
      backup: html,
    });

    promise
      .then((result) => {
        // Success — orchestrator already wrote the file and meta.json.
        setIframeHtml(result.html);
        setVideoRatioWithOverride(targetRatio);
        setRatioChange({ phase: "idle" });
      })
      .catch((err: unknown) => {
        const reason = err instanceof RegenError ? err.message : String(err);
        // Restore from in-memory backup. writeFile is defensive — even if the
        // orchestrator never persisted (cancel before onDone), this ensures
        // disk matches the iframe state the user saw before clicking.
        const htmlPath = `${projectPath.replace(/\/$/, "")}/${projectFileName}`;
        writeFile(htmlPath, html).catch((e) => {
          console.warn("[ratio-regen] restore writeFile failed (continuing):", e);
        });
        setIframeHtml(html);
        // Cancel is a deliberate user action — stay quiet (idle) instead of
        // surfacing an error toast.
        if (err instanceof RegenError && err.kind === "cancelled") {
          setRatioChange({ phase: "idle" });
        } else {
          setRatioChange({ phase: "error", message: reason });
        }
      });
  }, [
    ratioChange,
    iframeHtml,
    projectPath,
    videoRatio,
    selectedModel,
    selectedProvider,
    setVideoRatioWithOverride,
  ]);

  const onCancelRegen = useCallback(() => {
    if (ratioChange.phase !== "regenerating") return;
    ratioChange.abort();
    // The promise's catch path will restore + transition to idle. We do
    // nothing else here — abort triggers the cancelled rejection.
  }, [ratioChange]);

  // Auto-clear error after 5s (plan §4.4).
  useEffect(() => {
    if (ratioChange.phase !== "error") return;
    const id = window.setTimeout(() => {
      setRatioChange({ phase: "idle" });
    }, 5000);
    return () => window.clearTimeout(id);
  }, [ratioChange.phase]);
  // Hydrate guards from per-project setting on mount. Until this resolves,
  // the seed + auto-send effects below are gated so they can't race the db read.
  useEffect(() => {
    if (!projectId) {
      // No project — no persisted guard. Original in-memory behavior is fine
      // because there's no project to "lose" work in.
      setAutoSentHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const flag = await db.getSetting(`auto-sent:${projectId}`);
        if (!cancelled && flag === "true") {
          seededRef.current = true;
          autoSendRef.current = true;
        }
      } catch {}
      if (!cancelled) setAutoSentHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  useEffect(() => {
    if (!autoSentHydrated) return;
    if (initialPrompt && !seededRef.current) {
      seededRef.current = true;
      setInput(initialPrompt);
      textareaRef.current?.focus();
    }
  }, [initialPrompt, autoSentHydrated]);

  // Hydrate taste dial overrides from db.settings once on mount —
  // Settings → Taste persists each low/high string under
  // `tasteDial:${dial}:${side}`. Re-runs whenever projectId changes
  // even though the overrides are global; cheap and keeps the editor's
  // saves visible on the next turn without forcing a reload.
  useEffect(() => {
    let cancelled = false;
    void readTasteDialOverrides()
      .then((overrides) => {
        if (!cancelled) setTasteDialOverrides(overrides);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load canonicalPlus payload saved by App.tsx when the project was
  // created. Lives in the db.setting slot `canonicalPlus:${projectId}`.
  // Parsed verbatim — the schema lives in canonical-plus-prompt.ts.
  //
  // The summary form of this payload now ships in the system prompt of
  // every turn (see prompt-invoker.buildGenerate/RefineSystem). The
  // legacy `canonicalPlusInjected:` marker (one-shot delivery gate)
  // was dropped 2026-05-17 as part of audit P0-C and is intentionally
  // NOT read on mount anymore.
  //
  // User bug repro 2026-05-15: "comecei um projeto colocando dials
  // de taste e design system, mas pegou so meu prompt". Root cause —
  // `ds_path` is a GLOBAL setting (one DS for the whole app) while
  // canonical+ persists the per-project DS choice inside the payload
  // (`canonicalPlus.designSystem`). The fix below bridges the gap:
  // when the project was created with a DS pick, we seed dsPath /
  // dsName from the payload so the EditorScreen → ProjectContext
  // pipeline picks it up on the very first turn.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    db.getSetting(`canonicalPlus:${projectId}`)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as CanonicalPlusInput & {
            designSystem?: string | null;
          };
          setCanonicalPlusPayload(parsed);
          // Bridge per-project DS pick into the dsPath/dsName state
          // EditorScreen consumes when composing turns. The global
          // ds_path setting is a stale leftover from older flows —
          // canonical+ is the source of truth from the modal onward.
          if (parsed.designSystem && typeof parsed.designSystem === "string") {
            setDsPath(parsed.designSystem);
            // Derive a friendly name from the slug if dsName wasn't
            // explicitly carried — the markdown loader picks up the
            // full identity from the path. BUG-28: separator-agnostic so
            // a Windows backslash path doesn't leak the whole caminho.
            const slug = slugFromPath(parsed.designSystem) || null;
            if (slug) setDsName(slug);
          }
          // User QA 2026-05-15: the model pick from the NewProject
          // modal was being dropped because the global model-load
          // useEffect only read from FS config + db key, never from
          // canonicalPlus. Mirror the DS bridge: when the project was
          // created with an explicit model id, honor it on mount.
          // BUG-24: only honor cpModel if it's actually valid for the
          // project's provider. The modal could persist a stale model
          // (e.g. "opus") that doesn't belong to the chosen provider
          // (e.g. kimi); applying it here — async, so it lands AFTER the
          // synchronous provider-reset effect — re-introduced the foreign
          // model and crashed the turn downstream. canonicalPlus now
          // carries `provider`; validate against it. Legacy payloads
          // without provider keep the old unconditional behavior (the
          // reset effect + daemon guards cover them).
          const cpModel = (parsed as { model?: unknown }).model;
          const cpProvider = (parsed as { provider?: unknown }).provider;
          if (typeof cpModel === "string" && cpModel.trim().length > 0) {
            const provParse = ProviderIdSchema.safeParse(cpProvider);
            // Only reject a model that genuinely belongs to a DIFFERENT
            // provider (the opus→kimi leak). Custom/live ids (openrouter,
            // ollama, codex custom input) live in no static catalog and must
            // still be honored — the old membership check dropped them and
            // silently reset to the provider default. Legacy payloads with no
            // provider keep the unconditional apply.
            const foreign = provParse.success
              ? isModelForeignToProvider(cpModel, provParse.data)
              : false;
            if (!foreign) {
              setSelectedModel(cpModel);
              // Sync the provider's "last model" to the project's choice. The
              // [selectedProvider] reset effect fires on the claude→project
              // provider switch at mount and resets the model to
              // nextModelForProvider(provider, readLastModel(provider)).
              // Without this write, readLastModel can hold a stale value from a
              // previous session (e.g. Qwen), the two effects race, the stale
              // value wins, and the model silently flips off the project's
              // choice on open (the GLM→Qwen-on-open bug). Writing here makes
              // the reset effect converge to the project's model — same
              // ordering rule as the retry handler (writeLastModel first).
              if (provParse.success) writeLastModel(provParse.data, cpModel);
            }
          }
        } catch {
          /* malformed JSON in setting — ignore, treat as no canonical+ */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load the per-project canonical+ active toggles (which of Format/Rules/
  // Taste are still injected). Defaults to all-on for projects created
  // before this setting existed.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    db.getSetting(`canonicalActive:${projectId}`)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Partial<{
            format: boolean;
            rules: boolean;
            taste: boolean;
          }>;
          setCanonicalActive((prev) => ({
            format: parsed.format ?? prev.format,
            rules: parsed.rules ?? prev.rules,
            taste: parsed.taste ?? prev.taste,
          }));
        } catch {
          /* malformed — keep defaults */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Deactivate a canonical+ element (Format/Rules/Taste) + persist. Mirrors
  // the DS chip's detach affordance.
  const deactivateCanonical = useCallback(
    (key: "format" | "rules" | "taste") => {
      setCanonicalActive((prev) => {
        const next = { ...prev, [key]: false };
        if (projectId)
          db.setSetting(`canonicalActive:${projectId}`, JSON.stringify(next)).catch(
            warn("setSetting:canonicalActive"),
          );
        return next;
      });
    },
    [projectId],
  );

  // (The per-turn filtered canonical+ payload is computed inside handleSend
  // from a fresh disk read — see the canonicalSummary block there — to dodge
  // the first-turn hydration race.)

  // Chip metadata (labels/counts) for the composer chips.
  const canonicalChips = useMemo(
    () => (canonicalPlusPayload ? describeCanonicalPlus(canonicalPlusPayload) : null),
    [canonicalPlusPayload],
  );

  // Editable system core (Settings → Prompts) for the inspector, loaded when
  // it opens so the preview matches what the live turn now injects.
  const [inspectorCore, setInspectorCore] = useState("");
  useEffect(() => {
    if (!showFullPrompt) return;
    let cancelled = false;
    getBuiltinPrompt(
      iframeHtml ? "refine" : "generate",
      iframeHtml ? REFINE_SYSTEM : GENERATE_CORE_SYSTEM,
      projectId,
    )
      .then((c) => {
        if (!cancelled) setInspectorCore(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showFullPrompt, iframeHtml, projectId]);

  // The exact blocks the engine would assemble for the next turn, for the
  // toolbar "Prompt" inspector. Built via assembleTurnBlocks (same builders
  // as the live prepare()) from the live state, so it matches what's sent.
  // Only computed while the inspector is open.
  const inspectorBlocks = useMemo<TurnPreviewBlock[]>(() => {
    if (!showFullPrompt) return [];
    const dirBlock = canonicalPlusPayload
      ? buildCanonicalPlusBlock(
          {
            ...canonicalPlusPayload,
            format: canonicalActive.format ? canonicalPlusPayload.format : undefined,
            rules: canonicalActive.rules ? canonicalPlusPayload.rules : undefined,
            taste: canonicalActive.taste ? canonicalPlusPayload.taste : undefined,
          },
          tasteDialOverrides,
        )
      : "";
    return assembleTurnBlocks(
      {
        userMessage: input.trim() || "(sua próxima mensagem)",
        providerId: selectedProvider,
        projectId: projectId ?? "",
        threadId: "main",
        mode: "chat",
        context: {
          projectPath: projectPath || "~/design-factory/projeto",
          primaryFile: projectFileName,
          workspaceRoot: workspaceRoot ?? projectPath ?? undefined,
          iframeHtml: iframeHtml ?? undefined,
          designSystem: {
            path: dsPath ?? undefined,
            name: dsName ?? undefined,
            markdown: dsMarkdown ?? undefined,
          },
          model: selectedModel,
        },
      },
      (() => {
        const extras = [inspectorCore, dirBlock].filter(Boolean).join("\n\n");
        return extras ? { preambleExtras: extras } : {};
      })(),
    );
  }, [
    showFullPrompt,
    inspectorCore,
    canonicalPlusPayload,
    canonicalActive,
    tasteDialOverrides,
    input,
    selectedProvider,
    projectId,
    projectPath,
    projectFileName,
    workspaceRoot,
    iframeHtml,
    dsPath,
    dsName,
    dsMarkdown,
    selectedModel,
  ]);

  const handleModelChange = useCallback(
    (m: string) => {
      setSelectedModel(m);
      setShowModelMenu(false);
      // Mirror into per-provider last-model key + shared `model` key + FS config.
      writeLastModel(selectedProvider, m);
      void writeGlobalConfig({ model: m }).catch(warn("writeGlobalConfig:model"));
      db.setSetting("model", m).catch(warn("setSetting:model"));
    },
    [selectedProvider],
  );

  // Record the REAL model the provider reported (modelName, from the `meta`
  // stream event via useClaude) against the alias the user picked. Closes
  // the "alias + real version" loop: the claude picker shows "opus" (the
  // always-latest alias) and, once a turn completes, annotates it with the
  // resolved "opus 4.8" — instead of a hard-coded label that goes stale.
  useEffect(() => {
    if (modelName && selectedProvider && selectedModel) {
      writeSeenVersion(selectedProvider, selectedModel, modelName);
    }
  }, [modelName, selectedProvider, selectedModel]);

  // Live model probe for ollama + openrouter (falls back to static catalog
  // for everything else and on probe failure). User hit a bug where the
  // static Codex list contained speculative IDs the provider rejected —
  // using the live probe wherever possible eliminates that whole class.
  const {
    options: currentModelOptions,
    loading: modelsLoading,
    source: modelsSource,
  } = useLiveModelOptions(selectedProvider);
  const [customModelInput, setCustomModelInput] = useState("");

  // Force-reset selectedModel whenever the provider changes — even if the
  // current model id coincidentally appears in the new provider's list.
  // User repro 2026-05-20: switching from Anthropic API (model
  // "claude-opus-4-7") to Codex/Kimi kept the claude id and the chat
  // metadata kept rendering "claude-opus-4-7" even though the actual
  // request went to a different CLI. The reset always lands on the
  // remembered-for-this-provider model first, falling back to the catalog
  // default.
  useEffect(() => {
    if (getModelsForProvider(selectedProvider).length === 0) return;
    // Live-catalog providers (ollama, openrouter, BYOK APIs) expose models the
    // static fallback list doesn't know about, so resolve the next model via
    // the shared helper instead of validating against the static list — that
    // validation silently reset a live pick (e.g. a freshly `ollama pull`ed
    // gemma) back to the catalog default (ollama → "llama3.2"). Strict
    // validation stays for static-only providers (the 2026-05-20 repro above).
    const next = nextModelForProvider(selectedProvider, readLastModel(selectedProvider));
    if (next && next !== selectedModel) setSelectedModel(next);
  }, [selectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved HTML + history for this project. Filesystem is the source
  // of truth — projects/{slug}/{slug}.html is canonical. We resolve the
  // iframe content in this cascade:
  //   1. <projectPath>/<projectFileName> on disk  (primary, filesystem)
  //   2. first .html in <projectPath>/            (filesystem fallback, if
  //      projectFileName doesn't match — legacy projects or user-renamed)
  //   3. db.getSetting("html:{projectId}")        (last-known cache, only
  //      when the bridge is offline / Tauri hasn't wired fs yet)
  // Without step 1 the iframe stays blank right after project creation
  // until Claude's first Write fires — the file exists on disk but
  // nobody told the UI to read it.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      // Try the filesystem first.
      let fromDisk: string | null = null;
      if (projectPath) {
        const primaryPath = `${projectPath.replace(/\/+$/, "")}/${projectFileName}`;
        try {
          const f = await readFileViaBridge(primaryPath);
          if (
            f &&
            typeof f === "object" &&
            "content" in f &&
            typeof (f as FsFile).content === "string"
          ) {
            fromDisk = (f as FsFile).content;
          }
        } catch {}
        if (!fromDisk) {
          // Primary path missed — scan the folder for any .html file and
          // use the first one. Covers the "first html in the folder"
          // so a user-renamed or Claude-chose-different-name
          // file still lands in the iframe.
          try {
            const listing = await listFolder(projectPath);
            if (listing && !("error" in listing)) {
              const firstHtml = listing.entries.find((e) => !e.isDir && /\.html?$/i.test(e.name));
              if (firstHtml) {
                const f = await readFileViaBridge(firstHtml.path);
                if (
                  f &&
                  typeof f === "object" &&
                  "content" in f &&
                  typeof (f as FsFile).content === "string"
                ) {
                  fromDisk = (f as FsFile).content;
                }
              }
            }
          } catch {}
        }
      }
      if (cancelled) return;
      if (fromDisk) {
        setIframeHtml(fromDisk);
        lastPushedOutputRef.current = fromDisk;
        // Refresh the DB cache so subsequent mounts still hydrate fast
        // even if the bridge is offline.
        void db.setSetting(`html:${projectId}`, fromDisk).catch(warn("setSetting:html::projectId"));
      } else {
        // Filesystem had nothing — fall back to the cached DB snapshot.
        const cached = await db.getSetting(`html:${projectId}`).catch(() => null);
        if (cancelled) return;
        if (cached) {
          setIframeHtml(cached);
          lastPushedOutputRef.current = cached;
        }
      }
      // History stack is DB-only today (not worth writing versions to disk
      // yet — the file itself is the latest, named versions are in DB).
      const raw = await db.getSetting(`history:${projectId}`).catch(() => null);
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHistory(parsed);
          const idx = parsed.length - 1;
          setHistoryIndex(idx);
          historyIndexRef.current = idx;
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // Re-run if the project's disk identity changes (slug rename or
    // migration); iframe follows the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectPath, projectFileName]);

  // Hydrate canvas tabs from any tab-*.html files the user attached
  // at project-creation time (NewProject modal).
  //
  // HomeScreen.handleCreateFromNpModal writes the primary HTML to
  // {slug}.html (handled by the existing iframe effect above) and
  // any additional HTMLs to tab-{N}-{slug}.html. This effect scans
  // for those and pushes file-tabs into canvasTabs so the editor
  // surfaces them.
  //
  // Idempotent: dedups against any tab-*.html already present in
  // canvasTabs (skips when its filePath matches). Runs once per
  // projectId / projectPath change.
  useEffect(() => {
    if (!projectId || !projectPath) return;
    let cancelled = false;
    (async () => {
      const listing = await listFolder(projectPath);
      if (!listing || "error" in listing || cancelled) return;
      const tabFiles = listing.entries.filter(
        (e) => !e.isDir && /^tab-\d+-.+\.html?$/i.test(e.name),
      );
      if (tabFiles.length === 0) return;
      // Sort by leading number so tab-2-* sits before tab-10-*.
      tabFiles.sort((a, b) => {
        const ai = Number(a.name.match(/^tab-(\d+)-/)?.[1] ?? "0");
        const bi = Number(b.name.match(/^tab-(\d+)-/)?.[1] ?? "0");
        return ai - bi;
      });
      // Also read the primary HTML so we can dedupe tab-N files whose
      // content matches it (user repro 2026-05-20: same HTML attached
      // twice during project creation produced an identical tab-2-*.html,
      // surfaced as a duplicate tab on every reload).
      let primaryHtml: string | null = null;
      try {
        const primaryPath = `${projectPath.replace(/\/+$/, "")}/${projectFileName}`;
        const pf = await readFileViaBridge(primaryPath);
        if (pf && pf.isText && typeof pf.content === "string") primaryHtml = pf.content;
      } catch {}
      const normalize = (s: string) => s.replace(/\s+/g, "").trim();
      const primaryNormalized = primaryHtml ? normalize(primaryHtml) : null;

      const newEntries: CanvasTab[] = [];
      const seenContent = new Set<string>();
      for (const entry of tabFiles) {
        const file = await readFileViaBridge(entry.path);
        if (!file) continue;
        // Skip if content matches the primary HTML — same attachment was
        // sent twice during project creation.
        if (file.isText && primaryNormalized) {
          const n = normalize(file.content);
          if (n === primaryNormalized) continue;
          // Also dedupe among the tab-N files themselves (3+ identical
          // attachments).
          if (seenContent.has(n)) continue;
          seenContent.add(n);
        }
        newEntries.push({
          id: `tab-attach-${entry.name}`,
          name: entry.name,
          kind: "file",
          filePath: entry.path,
          fileContent: file.content,
          fileIsText: file.isText,
        });
      }
      if (cancelled || newEntries.length === 0) return;
      setCanvasTabs((prev) => {
        const known = new Set(prev.map((p) => p.filePath).filter(Boolean));
        const additions = newEntries.filter((n) => !n.filePath || !known.has(n.filePath));
        if (additions.length === 0) return prev;
        return [...prev, ...additions];
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectPath]);

  // Threads were flattened to one chat per project (Phase D). activeThreadId
  // is hardcoded to "main" so chat persistence lands at
  //   projects/{slug}/.df/chat/main.jsonl
  // The threads[] state, switcher UI, createNewThread/deleteThread helpers
  // were removed. If a user wants to fork a conversation they clone the
  // project folder — keeps model and filesystem aligned.

  // Slug derived from projectPath — matches projects/{slug}/ convention
  // used by the bridge's filesystem endpoints. Memo so the chat effects
  // can depend on a stable string.
  const projectSlug = useMemo(() => {
    if (!projectPath) return null;
    return slugFromPath(projectPath) || null;
  }, [projectPath]);

  // Provider Handoff Layer v1: mirror the slug into a ref so callbacks
  // declared above projectSlug (persistProviderSession) and below it can
  // both read the current value without restructuring the file. Also
  // hydrates `.df/provider-sessions.json` whenever the slug changes.
  useEffect(() => {
    projectSlugRef.current = projectSlug;
    recAttachSlug(projectSlug);
    if (!projectSlug) {
      setProviderSessions(EMPTY_PROVIDER_SESSIONS);
      return;
    }
    void readProviderSessions(projectSlug).then(setProviderSessions);
  }, [projectSlug]);

  // Persistence is by TURN identity. Messages share a turn_id (user prompt
  // and its claude response, including any "Design generated" terminal or
  // patch summary, all carry the same id). The persist effect groups
  // messages by turn_id, builds a Turn record for each complete group, and
  // appends it as ONE JSONL line. Refs (not state) so the persist effect
  // reads them synchronously without closure staleness.
  const persistedTurnIdsRef = useRef<Set<string>>(new Set());
  const chatHydratedRef = useRef(false);
  const chatLoadIdRef = useRef(0);
  const [chatHydratedTrigger, setChatHydratedTrigger] = useState(0);

  // Reset on thread switch — wipe the dedup Set and the hydration flag so
  // the next hydrate seeds a clean baseline.
  useEffect(() => {
    chatHydratedRef.current = false;
    persistedTurnIdsRef.current = new Set();
  }, [projectId, activeThreadId]);

  // Load messages whenever active thread changes. Prefer the new turn-
  // based endpoint (which auto-migrates legacy line-per-message files in
  // place). Fall back to the legacy reader if the bridge hasn't been
  // restarted yet, then to the DB tmsg cache for offline / Tauri.
  //
  // Uses a monotonic loadId ref instead of a per-effect `cancelled` local
  // so that StrictMode's mount-unmount-mount dance can't ever leave us in
  // a state where neither async resolves with cancelled=false. The latest
  // load ID always wins; older ones bail.
  useEffect(() => {
    if (!projectId || !activeThreadId) return;
    // BUG-20: hydrate at most ONCE per project mount. This effect lists
    // projectSlug in its deps (slug is a useMemo off projectPath, which
    // resolves/changes shortly after a new project navigates in). Without
    // this guard, the slug change RE-RAN hydration mid-conversation: it read
    // chat from disk, the just-sent turn wasn't persisted yet (the persist
    // effect is async/debounced), so `loaded` came back empty and the code
    // below called setMessages([]) — wiping the live user+assistant bubbles
    // off-screen and showing the "O que vamos construir?" empty state despite
    // a turn being in flight. That's the intermittent "message doesn't appear"
    // the user hit. chatHydratedRef resets only on projectId/thread change
    // (the effect above), so this still re-hydrates correctly on real
    // project/thread switches.
    if (chatHydratedRef.current) return;
    // Don't attempt (or mark hydrated) until the slug is resolved — otherwise
    // the first run with a falsy slug would wipe to [] and lock out the real
    // load once the slug arrives.
    if (!projectSlug) return;
    chatLoadIdRef.current += 1;
    const myLoadId = chatLoadIdRef.current;
    (async () => {
      let loaded: ChatMessage[] | null = null;
      const writtenTurnIds = new Set<string>();

      if (projectSlug) {
        const turnsResult = await readChatTurns(projectSlug, activeThreadId);
        if (turnsResult) {
          loaded = [];
          let i = 0;
          for (const turn of turnsResult.turns) {
            writtenTurnIds.add(turn.id);
            const baseTs = typeof turn.ts === "number" ? turn.ts : ++i;
            // rehydrate attachments so chat reload renders the chip row
            // instead of regressing to the inline-text behavior. Older turns
            // without `attachments` keep the legacy text-prepend look (their
            // text already carries the markdown raw).
            const rehydratedAttachments =
              Array.isArray(turn.user?.attachments) && turn.user.attachments.length > 0
                ? turn.user.attachments.map((a) => ({
                    name: a.name,
                    size: a.size,
                    mime: a.mime,
                    // Attachment.kind is optional in the on-disk schema for
                    // backward-compat; default unknowns to "binary" so the
                    // chip glyph stays sensible.
                    kind: (a.kind ?? "binary") as "image" | "text" | "html" | "binary",
                    path: a.path,
                    content: a.content,
                  }))
                : undefined;
            loaded.push({
              role: "user",
              text: turn.user?.text ?? "",
              attachments: rehydratedAttachments,
              ts: baseTs,
              turn_id: turn.id,
              verb: turn.user?.verb
                ? {
                    id: turn.user.verb.id,
                    label: turn.user.verb.label,
                    category: turn.user.verb.category as
                      | "evaluate"
                      | "refine"
                      | "direction"
                      | "enhance"
                      | "fix"
                      | "export",
                    modifiesHtml: turn.user.verb.modifiesHtml,
                    status: "done",
                    elapsedMs: turn.ai?.duration_ms,
                  }
                : undefined,
            });
            if (turn.ai) {
              // F1.1 — rehydrate per-message stats from disk so the
              // permanent footer renders immediately on reload. Tokens
              // are stored as a nested `{ in, out }` on the turn (schema
              // optional); flatten back into the message fields here.
              const aiTokensRaw = (turn.ai as unknown as { tokens?: { in?: number; out?: number } })
                .tokens;
              const aiCostUsd = (turn.ai as unknown as { cost_usd?: number }).cost_usd;
              const aiTtftMs = (turn.ai as unknown as { ttft_ms?: number }).ttft_ms;
              loaded.push({
                role: "assistant",
                provider: turn.ai.provider ?? "claude",
                model: turn.ai.model,
                text: turn.ai.text ?? "",
                isDesign: turn.ai.is_design,
                tools: Array.isArray(turn.ai.tools) ? turn.ai.tools : undefined,
                ts: baseTs + 1,
                turn_id: turn.id,
                streaming: false,
                version_id: turn.ai.html_snapshot_id,
                durationMs:
                  typeof turn.ai.duration_ms === "number" ? turn.ai.duration_ms : undefined,
                tokensIn: typeof aiTokensRaw?.in === "number" ? aiTokensRaw.in : undefined,
                tokensOut: typeof aiTokensRaw?.out === "number" ? aiTokensRaw.out : undefined,
                costUsd: typeof aiCostUsd === "number" ? aiCostUsd : undefined,
                ttftMs: typeof aiTtftMs === "number" ? aiTtftMs : undefined,
              });
            }
          }
        } else {
          // Bridge probably hasn't been restarted yet — fall back to the
          // per-message reader so the chat still hydrates.
          const fromFs = await readChatMessages(projectSlug, activeThreadId);
          if (fromFs) {
            // readChatMessages already coerces legacy role:"claude" → "assistant"
            // (see Provider Handoff Layer v0). Tag provider for assistant turns
            // so older chats render with a Claude badge.
            loaded = fromFs.map(
              (m, i): ChatMessage => ({
                role: m.role,
                provider: m.role === "assistant" ? "claude" : undefined,
                text: m.text,
                isDesign: m.is_design,
                ts: typeof m.ts === "number" ? m.ts : i + 1,
                turn_id: `legacy-${typeof m.ts === "number" ? m.ts : i}`,
              }),
            );
          }
        }
      }
      // Bail only when a NEWER load has started. Cleanup of the previous
      // effect run does not bump the id, so StrictMode doesn't strand us.
      if (myLoadId !== chatLoadIdRef.current) {
        return;
      }
      // Recovery cascade for chat history:
      //   1. chat.jsonl turns (canonical, finalized)
      //   2. chat.snapshot.json (full-state mirror, includes partial streams)
      //   3. db.setting tmsg cache (last-resort, IndexedDB-only)
      // The bridge can't distinguish "missing" from "empty" jsonl, so we
      // always probe deeper sources when the canonical disk path is empty.
      if (loaded && loaded.length > 0) {
        // BUG (chat reload incomplete): the append-only jsonl can LAG the
        // full-state snapshot — a turn that finalized into the snapshot but
        // not yet into jsonl. The old code used jsonl whenever it was
        // non-empty and never consulted the snapshot, so reload dropped the
        // latest turn(s). Probe the snapshot too and keep whichever has MORE
        // messages.
        const snap = await readChatSnapshot(projectSlug, activeThreadId).catch(() => null);
        if (myLoadId !== chatLoadIdRef.current) return;
        const snapValid = Array.isArray(snap)
          ? ((snap as Array<Record<string, unknown>>).filter(
              (m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.text === "string",
            ) as unknown as ChatMessage[])
          : [];
        const useSnap = snapValid.length > loaded.length;
        const { messages: sanitized } = sanitizeMessages(useSnap ? snapValid : loaded);
        setMessages(sanitized);
        // If we adopted the snapshot, the extra turns aren't in jsonl yet —
        // leave dedup empty so the persist effect re-emits them to disk.
        persistedTurnIdsRef.current = useSnap ? new Set() : writtenTurnIds;
      } else if (projectSlug) {
        const snap = await readChatSnapshot(projectSlug, activeThreadId).catch(() => null);
        if (myLoadId !== chatLoadIdRef.current) return;
        if (Array.isArray(snap) && snap.length > 0) {
          // Drop entries that don't fit the ChatMessage contract (role +
          // text required) — old snapshots may have stray dev-test items
          // with `kind` instead of `role`, or partial writes from before
          // the schema settled. Filtering here keeps the UI from rendering
          // empty bubbles for items the renderer can't switch on.
          const valid = (snap as Array<Record<string, unknown>>).filter(
            (m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.text === "string",
          ) as unknown as ChatMessage[];
          const dropped = snap.length - valid.length;
          if (dropped > 0)
            console.warn("[chat-load] dropped", dropped, "malformed snapshot entries");
          const { messages: sanitized } = sanitizeMessages(valid);
          setMessages(sanitized);
          // Snapshot turns may not be in chat.jsonl yet — leave dedup empty
          // so the persist effect re-emits finalized turns to disk.
          persistedTurnIdsRef.current = new Set();
        } else {
          const rawNew = await db
            .getSetting(`tmsg:${projectId}:${activeThreadId}`)
            .catch(() => null);
          const rawLegacy = rawNew
            ? null
            : await db.getSetting(`tmsg:${activeThreadId}`).catch(() => null);
          const raw = rawNew ?? rawLegacy;
          if (myLoadId !== chatLoadIdRef.current) return;
          try {
            const parsed = raw ? JSON.parse(raw) : [];
            // Migrate legacy role:"claude" → role:"assistant" + provider:"claude"
            // (Provider Handoff Layer v0). Transparent — old caches produced
            // before 2026-05-03 keep loading without manual cleanup.
            const migrated = migrateLegacyChatMessages(parsed) as ChatMessage[];
            const safe = Array.isArray(migrated) ? migrated : [];
            // BUG-20: disk + snapshot + cache all empty = fresh project. Do NOT
            // clobber whatever is already in memory — the auto-send may have
            // already pushed the seed turn's user+placeholder before this async
            // read resolved. Adopt the cache only if it actually has rows;
            // otherwise preserve the in-flight conversation.
            setMessages((prev) => (safe.length > 0 ? safe : prev));
            persistedTurnIdsRef.current = new Set();
          } catch {
            setMessages((prev) => prev); // preserve in-memory on parse failure
            persistedTurnIdsRef.current = new Set();
          }
        }
      } else {
        setMessages([]);
        persistedTurnIdsRef.current = new Set();
      }
      chatHydratedRef.current = true;
      setChatHydratedTrigger((n) => n + 1);
      db.setSetting(`activeThread:${projectId}`, activeThreadId).catch(
        warn("setSetting:activeThread::projectId"),
      );
    })();
  }, [projectId, activeThreadId, projectSlug]);

  // Persist by turn. Group messages by turn_id; for every complete group
  // (user + at least one terminal-state claude OR a user with a verb that
  // resolved), build a Turn and append it once. Set guards re-runs.
  useEffect(() => {
    if (!projectId || !activeThreadId) return;
    if (!chatHydratedRef.current) return;
    // Per-project cache. Old code used a shared key (`tmsg:${activeThreadId}`)
    // which was overwritten every project switch — fixed here so each
    // project keeps its own cache and recovery from cache is reliable.
    db.setSetting(
      `tmsg:${projectId}:${activeThreadId}`,
      JSON.stringify(messages.slice(-200)),
    ).catch(warn("setSetting:tmsg::projectId::activeThreadId"));
    if (!projectSlug) return;

    const written = persistedTurnIdsRef.current;
    const groups = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const id = m.turn_id;
      if (!id) continue;
      if (written.has(id)) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(m);
    }
    if (groups.size === 0) return;

    // Build turns from groups. A group persists when:
    //   - claude is non-streaming AND verb (if any) has resolved, OR
    //   - the turn is older than 30s — best-effort capture so streams
    //     that error out / get abandoned still land on disk. Without
    //     this fallback, projects whose first generation never flipped
    //     `streaming: false` on claude (or whose verb status got stuck)
    //     went to disk empty — the cause of the missing-chat reports.
    //   - we always require a user message; pure-claude orphans skip.
    const STALE_TURN_MS = 30_000;
    const now = Date.now();
    const readyTurns: Turn[] = [];
    for (const [turn_id, msgs] of groups.entries()) {
      const userMsg = msgs.find((m) => m.role === "user");
      if (!userMsg) continue;
      const claudes = msgs.filter((m) => m.role === "assistant");
      const anyStreamingClaude = claudes.some((c) => c.streaming);
      const turnTs = typeof userMsg.ts === "number" ? userMsg.ts : now;
      const isStale = now - turnTs > STALE_TURN_MS;
      const verbStatus = userMsg.verb?.status;
      const verbStillRunning = verbStatus === "running";
      // Skip while in normal in-flight state. Stale turns persist regardless.
      if ((anyStreamingClaude || verbStillRunning) && !isStale) continue;
      // Pick the most informative claude (the LAST one that has text or
      // tools or isDesign) — collapses the streaming placeholder + the
      // terminal "Design generated" + any patch summary into one ai field.
      const claudeText = claudes
        .map((c) => c.text)
        .filter(Boolean)
        .join("\n\n");
      const isDesign = claudes.some((c) => c.isDesign);
      const tools: ToolUseRecord[] = [];
      for (const c of claudes) if (c.tools && c.tools.length) tools.push(...c.tools);
      // Skip turns where neither side has any persistable signal yet.
      if (!userMsg.text && !claudeText && !isDesign && tools.length === 0 && !userMsg.verb)
        continue;
      // Fix (Bug 4): if the assistant existed (has provider/model)
      // but produced no text/tools/isDesign signal, persist a fallback
      // marker so reload doesn't see a "missing" assistant. Without this
      // the turn round-trips as ai.text="" and sanitizeMessages used to
      // drop it. The marker is visible in chat as "[empty response]".
      const hasAssistantEvidence = claudes.some((c) => c.provider || c.model);
      const persistedClaudeText =
        claudeText ||
        (hasAssistantEvidence && tools.length === 0 && !isDesign ? "[empty response]" : "");

      const turn: Turn = {
        id: turn_id,
        ts: userMsg.ts ?? Date.now(),
        user: {
          text: userMsg.text,
          // persist attachment metadata so chat hydration can re-render
          // the chip row instead of regressing to inline text. Skip the
          // `content` field on disk for image attachments — the file lives
          // in `.df-attachments/` already, the chip just needs `path`.
          attachments:
            userMsg.attachments && userMsg.attachments.length > 0
              ? userMsg.attachments.map((a) => ({
                  name: a.name,
                  size: a.size,
                  mime: a.mime,
                  kind: a.kind,
                  path: a.path,
                  // Drop bulky inline content for images (path is canonical);
                  // keep it for text/html so re-opens render the chip preview.
                  content: a.kind === "image" ? undefined : a.content,
                }))
              : undefined,
          verb: userMsg.verb
            ? {
                id: userMsg.verb.id,
                label: userMsg.verb.label,
                category: userMsg.verb.category ?? "refine",
                modifiesHtml: !!userMsg.verb.modifiesHtml,
              }
            : null,
        },
        ai:
          claudes.length > 0
            ? (() => {
                // F1.1 — Pull permanent stats from the LAST assistant msg in the
                // group (V2 finalize populates these). Falls back to verb timing
                // for legacy verb dispatches that don't carry tokens/cost.
                const finalClaude = claudes[claudes.length - 1];
                const statDurationMs =
                  typeof finalClaude?.durationMs === "number"
                    ? finalClaude.durationMs
                    : userMsg.verb?.elapsedMs;
                const tokensIn = finalClaude?.tokensIn;
                const tokensOut = finalClaude?.tokensOut;
                return {
                  text: persistedClaudeText,
                  tools,
                  // Provider Handoff Layer v1: persist which model spoke this
                  // turn so the badge re-renders correctly after reload. Pulled
                  // off the FIRST assistant msg in the group — they all share
                  // the same provider within a single turn.
                  provider: claudes[0]?.provider,
                  model: claudes[0]?.model,
                  is_design: isDesign,
                  status: (verbStatus === "failed" ? "error" : "done") as "error" | "done",
                  duration_ms: statDurationMs,
                  tokens:
                    typeof tokensIn === "number" || typeof tokensOut === "number"
                      ? { in: tokensIn, out: tokensOut }
                      : undefined,
                  cost_usd: finalClaude?.costUsd,
                  ttft_ms: finalClaude?.ttftMs,
                  error: claudes.find((c) => c.text.startsWith("[error]"))?.text,
                  html_snapshot_id: claudes.find((c) => c.version_id)?.version_id,
                };
              })()
            : null,
      };
      readyTurns.push(turn);
    }
    if (readyTurns.length === 0) return;

    // Reserve ids synchronously so a concurrent effect run skips them.
    for (const t of readyTurns) written.add(t.id);

    void (async () => {
      for (const turn of readyTurns) {
        const ok = await appendChatTurn(projectSlug, activeThreadId, turn).catch((e) => {
          console.error("[chat] appendChatTurn threw:", e);
          return false;
        });
        if (!ok) {
          console.warn(
            "[chat] appendChatTurn failed for turn",
            turn.id,
            "slug:",
            projectSlug,
            "thread:",
            activeThreadId,
          );
        }
      }
    })();
  }, [messages, activeThreadId, projectId, projectSlug, chatHydratedTrigger]);

  // Full-state snapshot — debounced mirror of the entire messages array
  // to disk. The append-only chat.jsonl above only writes finalized turns;
  // this snapshot survives abandoned streams, page reloads, and partial
  // generations. chat-load reads it as a fallback when chat.jsonl is empty.
  // No streaming/hydration gate — we want the most-recent state on disk.
  useEffect(() => {
    if (!projectSlug || !activeThreadId) {
      return;
    }
    if (messages.length === 0) return;
    const handle = window.setTimeout(() => {
      void writeChatSnapshot(projectSlug, activeThreadId, messages).catch((e) =>
        console.error("[snapshot] threw:", e),
      );
    }, 600);
    return () => window.clearTimeout(handle);
  }, [messages, projectSlug, activeThreadId]);

  // createNewThread / switchThread / deleteThread removed — single
  // chat per project. Fork = duplicate the project folder.

  // Legacy db.messages migration REMOVED 2026-04-27. The effect previously
  // read from the pre-threads `db.messages` table and dumped its contents
  // into state via setMessages — but it never bumped `persistedCountRef`,
  // so the persist effect downstream saw a tail of length N and re-appended
  // the ENTIRE legacy history to the canonical JSONL. User reported the
  // chat re-running every prompt; evidence in projects/unicode/.df/chat/
  // main.jsonl showed the exact same 5-message block re-appended in fast
  // succession (timestamps 1777316410479..1777316411292) every time the
  // editor remounted. JSONL is canonical now (since chat-threads landed in
  // earlier iterations) so the migration is a net negative — disable.

  // Live-update iframe while streaming — legacy flow where the LLM's
  // raw text stream WAS the final HTML. In the Claude-Code-with-tools
  // era, `output` holds the chat prose ("Pronto — 5 variações...") and
  // the HTML arrives via a Write tool_call handled in onToolResult.
  // Gate by structure so chat prose doesn't clobber the disk-sourced
  // iframe content.
  useEffect(() => {
    if (status === "streaming" && output && looksLikeHtmlOutput(output)) {
      setIframeHtml(output);
    }
  }, [status, output]);

  // On done: finalize iframe, push history, persist to disk, add chat message
  const historyIndexRef = useRef(-1);
  const lastPushedOutputRef = useRef<string | null>(null);
  // BUG-29: iframeHtml at the moment a turn starts. The done-effect uses it to
  // tell whether THIS turn actually produced/changed a design — `iframeHtml`
  // alone is session-global and stays populated from a prior turn, so a thin
  // empty response would otherwise be mislabeled "Design generated".
  const designBaselineRef = useRef<string | null>(null);

  // Live tool chips: while the main generate/applyStyle stream is running,
  // mirror useClaude's tool state onto the current streaming assistant
  // message so ChatMessage.tsx can render them inline. Without this, tool
  // chips only appear on the terminal "Design generated" message and the
  // user has no visibility into what Claude's doing mid-turn. The skill
  // path (sendSkillCommand) already mirrors locally via liveTools — this
  // covers the gap for everything else.
  useEffect(() => {
    if (status !== "streaming") return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      // Only target the empty placeholder the handleSend path pushed —
      // never overwrite a finalized message.
      if (!last || last.role !== "assistant" || last.isDesign || !last.streaming) return prev;
      const next = [...prev];
      const streamingText = output || last.text;
      next[next.length - 1] = {
        ...last,
        text: streamingText,
        tools: tools.length > 0 ? [...tools] : last.tools,
      };
      return next;
    });
  }, [status, tools, output]);

  // Clear the streaming flag when the stream ends — covers both the "Design
  // generated" case (handled in its own effect) AND the pure-text response
  // case where no iframe update happens and the isDesign marker never fires.
  useEffect(() => {
    if (status === "done" || status === "error") {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant" || !last.streaming) return prev;
        const next = [...prev];
        // Copy the final tools snapshot — the streaming mirror effect bails
        // the instant status leaves "streaming", so a tool_call/result that
        // lands right at `done` can otherwise be lost.
        const finalTools = tools.length > 0 ? [...tools] : last.tools;
        const hasText = Boolean(last.text && last.text.trim());
        const hasTools = Boolean(finalTools && finalTools.length > 0);
        // BUG-29: tool-based generation (Claude/Codex/Kimi write the HTML via
        // the Write tool) emits no HTML *text* output, so the "Design
        // generated" effect — gated on looksLikeHtmlOutput(output) — never
        // fires. With no prose either, the placeholder stays empty and the
        // persist layer drops empty assistant messages, so the chat shows no
        // AI response even though the preview updated from disk (and a reload
        // brings nothing back). When a design exists for this turn, finalize
        // the empty placeholder as a "Design generated" message so it renders
        // and persists. iframeHtml is in deps so this re-runs once the async
        // onToolResult disk-read sets it, even if it lands after `done`.
        // BUG-29 follow-up: require the design to have CHANGED this turn
        // (iframeHtml differs from the pre-turn baseline), so a thin/empty
        // response after a prior design isn't mislabeled "Design generated".
        const designChangedThisTurn =
          Boolean(iframeHtml) && iframeHtml !== designBaselineRef.current;
        if (status === "done" && !hasText && !hasTools && designChangedThisTurn) {
          next[next.length - 1] = {
            ...last,
            text: "Design generated",
            isDesign: true,
            streaming: false,
          };
        } else {
          next[next.length - 1] = { ...last, tools: finalTools, streaming: false };
        }
        return next;
      });
    }
  }, [status, tools, iframeHtml]);

  useEffect(() => {
    // Same gate: only hydrate the iframe from the raw text stream when
    // it actually looks like an HTML document. Otherwise onToolResult
    // (which re-reads from disk after Write) owns the iframe state and
    // chat prose stays in the chat panel.
    if (
      status === "done" &&
      output &&
      looksLikeHtmlOutput(output) &&
      lastPushedOutputRef.current !== output
    ) {
      lastPushedOutputRef.current = output;
      setIframeHtml(output);

      // Push snapshot to history (trim forward history if user generated after undo)
      setHistory((prev) => {
        const idx = historyIndexRef.current;
        const base = idx >= 0 ? prev.slice(0, idx + 1) : [];
        const next = [...base, output];
        const newIdx = next.length - 1;
        historyIndexRef.current = newIdx;
        setHistoryIndex(newIdx);
        return next;
      });

      // Pre-generate the version id BEFORE the setMessages + setVersions
      // calls so both end up referencing the same checkpoint. The claude
      // message's `version_id` is what powers the per-turn Restore button.
      const versionId = crypto.randomUUID();
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isDesign) return prev;
        // Snapshot any tool_use events that fired during this generation
        const snapshot = tools.length > 0 ? [...tools] : undefined;
        // Inherit the streaming claude's turn_id so the persist layer pairs
        // this terminal "Design generated" with the user prompt of the same
        // turn (instead of starting its own turn).
        const turn_id = last?.turn_id;
        const done: ChatMessage = stamp({
          role: "assistant",
          provider: selectedProvider,
          model: selectedModel,
          text: "Design generated",
          isDesign: true,
          tools: snapshot,
          streaming: false,
          turn_id,
          version_id: versionId,
        });
        // Replace the empty claude placeholder (pushed at send) rather than
        // appending — otherwise the chat shows Thinking placeholder + Done.
        if (last?.role === "assistant" && !last.text && !last.isDesign) {
          return [...prev.slice(0, -1), done];
        }
        return [...prev, done];
      });
      if (projectId) {
        // Structured turn persistence — when tools fired during this generation,
        // save the message as typed blocks so a reload still shows the tool
        // chips. Fall back to legacy saveMessage when no tools (lighter row).
        if (tools.length > 0) {
          const parts: ChatBlock[] = [
            { type: "text", content: "Design generated" },
            ...tools.flatMap((t) => {
              const blocks: ChatBlock[] = [
                { type: "tool_call", callId: t.id, name: t.name, input: t.input },
              ];
              if (t.result) {
                blocks.push({
                  type: "tool_result",
                  callId: t.id,
                  output: t.result.content,
                  isError: t.result.isError,
                });
              }
              return blocks;
            }),
          ];
          db.saveMessageStructured(projectId, "assistant", "Design generated", parts, true).catch(
            () => {
              // Fall back to legacy write if structured save somehow fails (e.g.
              // older build of the Rust side). Data is never lost.
              db.saveMessage(projectId, "assistant", "Design generated", true).catch(() => {});
            },
          );
        } else {
          db.saveMessage(projectId, "assistant", "Design generated", true).catch(() => {});
        }
        // Persist HTML for resume
        db.setSetting(`html:${projectId}`, output).catch(warn("setSetting:html::projectId"));
        // Auto-checkpoint: keep last 20 auto saves + all named saves unbounded
        const autoCheckpointSlug = slugFromPath(projectPath ?? "");
        setVersions((prev) => {
          const next: Version = {
            id: versionId,
            html: output,
            createdAt: Date.now(),
            auto: true,
          };
          // drop consecutive auto dupes (same html as last auto)
          const lastAuto = [...prev].reverse().find((v) => v.auto);
          if (lastAuto && lastAuto.html === output) return prev;
          const kept = [...prev, next];
          const autoCount = kept.filter((v) => v.auto).length;
          // mirror to filesystem (best-effort).
          if (autoCheckpointSlug) {
            void saveProjectVersion(autoCheckpointSlug, {
              id: next.id,
              html: next.html,
              createdAt: next.createdAt,
              auto: next.auto,
            }).catch(() => false);
          }
          if (autoCount > 20) {
            // drop oldest auto (preserve all named)
            let dropped = 0;
            const prunedIds: string[] = [];
            const pruned = kept.filter((v) => {
              if (v.auto && dropped < autoCount - 20) {
                dropped += 1;
                prunedIds.push(v.id);
                return false;
              }
              return true;
            });
            db.setSetting(`versions:${projectId}`, JSON.stringify(pruned)).catch(
              warn("setSetting:versions::projectId"),
            );
            // drop pruned auto-checkpoint files from disk too.
            if (autoCheckpointSlug) {
              for (const pid of prunedIds) {
                void deleteProjectVersion(autoCheckpointSlug, pid).catch(() => false);
              }
            }
            return pruned;
          }
          db.setSetting(`versions:${projectId}`, JSON.stringify(kept)).catch(
            warn("setSetting:versions::projectId"),
          );
          return kept;
        });
      }

      // Materialize the generated HTML in the project folder so the file
      // manager + external tools see it. Tauri writes via Rust; browser
      // preview writes via bridge /fs/write.
      const filePath = `${projectPath || "~/design-factory/projeto"}/${projectFileName}`;
      writeFile(filePath, output).catch(warn("writeFile:filePath"));

      // Per-turn snapshot — disk safety net independent of the in-app
      // version history. Keeps the last N snapshots under .history/ next
      // to the primary file. Retention is controlled by the
      // snapshot_history setting, default ON.
      if (projectPath) {
        void (async () => {
          const enabled = await db.getSetting("snapshot_history").catch(() => null);
          if (enabled === "off" || enabled === "false") return;
          const isoSafe = new Date().toISOString().replace(/[:.]/g, "-");
          const historyDir = `${projectPath}/.history`;
          const snapshotPath = `${historyDir}/${isoSafe}.html`;
          // writeFile will create intermediate dirs via Tauri plugin-fs.
          try {
            const { mkdirViaBridge } = await import("@/lib/claude-bridge");
            await mkdirViaBridge(historyDir).catch(warn("mkdirViaBridge:historyDir"));
            await writeFile(snapshotPath, output).catch(warn("writeFile:snapshotPath"));
          } catch {
            // Snapshot is best-effort — never block the main flow.
          }
        })();
      }
    }
  }, [status, output, projectPath, projectId]);

  // Persist history stack whenever it changes
  useEffect(() => {
    if (!projectId || history.length === 0) return;
    db.setSetting(`history:${projectId}`, JSON.stringify(history.slice(-10))).catch(
      warn("setSetting:history::projectId"),
    );
  }, [history, projectId]);

  // Safety net: when a stream finishes and the iframe is STILL empty, try
  // reading the project's primary file from disk. Covers the case where
  // the agent wrote the HTML via a tool call but neither onToolCall (path
  // mismatch) nor the "Design generated" branch (output didn't look like
  // HTML — agent only streamed prose) refreshed the iframe. Reported
  // that generation finished but the HTML didn't appear on a regenerated
  // session — this catches it from the file-system side.
  //
  // QA follow-up: the page had to be reloaded for the HTML to appear,
  // even when running with Claude. The single 200ms delay was too
  // tight for slower providers (codex's exec, kimi's -w indexing, big
  // BYOK turns) — the file landed on disk a beat after the safety net
  // fired, the read returned no content, and the user had to F5 to
  // trigger the initial-load useEffect on remount. Retries cover that.
  useEffect(() => {
    if (status !== "done") return;
    if (iframeHtml && iframeHtml.length > 50) return;
    if (!projectPath || !projectFileName) return;
    const filePath = `${projectPath.replace(/\/$/, "")}/${projectFileName}`;
    let cancelled = false;
    void (async () => {
      // Retry schedule (ms): 200 / 800 / 2000 / 4000 — covers slow
      // providers + big files. Total budget ~7s in the worst case.
      // Stops as soon as the file lands AND has real HTML in it.
      const delays = [200, 600, 1200, 2000];
      for (const delay of delays) {
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        try {
          const fresh = await readFileViaBridge(filePath);
          if (!fresh || typeof fresh !== "object") continue;
          if (!("content" in fresh) || typeof (fresh as FsFile).content !== "string") continue;
          const html = (fresh as FsFile).content;
          if (!html || html.length < 50) continue;
          setIframeHtml(html);
          lastPushedOutputRef.current = html;
          if (projectId)
            void db.setSetting(`html:${projectId}`, html).catch(warn("setSetting:html::projectId"));
          return;
        } catch {
          // file not ready yet — try next interval
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, iframeHtml, projectPath, projectFileName, projectId]);

  // Auto-scroll behaviour. Default = follow the stream. We turn it off only
  // if the user manually scrolls up during a streaming turn — then a "jump
  // to latest" pill surfaces. Critical: the "near-bottom" decision MUST be
  // captured BEFORE the new message lands in the DOM, otherwise the new
  // content's growth makes every position look "scrolled up" and we'd stop
  // following the stream the moment the first chunk arrives.
  const wasNearBottomRef = useRef(true);
  const NEAR_BOTTOM_PX = 80;

  const handleChatLogScroll = useCallback(() => {
    const el = chatLogRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
    if (distanceFromBottom <= 16) setShowJumpToLatest(false);
  }, []);

  // F2.4 — Intelligent auto-scroll. Track whether any assistant
  // message is currently streaming so the "jump to latest" pill also
  // appears during V2-pipeline turns (Codex / Gemini / OpenRouter),
  // where useClaude.status stays "idle" because the legacy hook is
  // reset() before the V2 turn. Without this signal, users who scroll
  // up mid-V2-stream never saw the catch-up affordance.
  const isAnyMsgStreaming = messages.some((m) => m.streaming);
  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToLatest(false);
    } else if (status === "streaming" || isAnyMsgStreaming) {
      setShowJumpToLatest(true);
    }
  }, [messages, status, isAnyMsgStreaming]);

  const jumpChatToLatest = useCallback(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  // On stream error, push the error into chat as a Claude message.
  const errorPushedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status === "error") {
      if (error && errorPushedRef.current !== error) {
        errorPushedRef.current = error;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const err: ChatMessage = stamp({
            role: "assistant",
            text: `[error] ${error}`,
            streaming: false,
            turn_id: last?.turn_id,
          });
          // Replace the Thinking placeholder on error so we don't leave a
          // dangling empty slot above the error.
          if (last?.role === "assistant" && !last.text && !last.isDesign) {
            return [...prev.slice(0, -1), err];
          }
          return [...prev, err];
        });
      }
    } else {
      errorPushedRef.current = null;
    }
  }, [status, error]);

  /**
   * Called when the user picks an option in an embedded `::question`
   * block inside a claude message. Records the answer so the UI disables
   * the buttons, then auto-sends a follow-up prompt so claude can continue
   * the turn with the picked label.
   */
  const handleQuestionAnswer = (_msgIndex: number, msgText: string, label: string) => {
    // Parse blocks from the exact text so we find the raw block the user
    // clicked. We key answeredQuestions by raw block to allow multiple
    // questions per message + avoid collision between messages.
    const re = /::question\s*\n[\s\S]*?\n::/g;
    const rawBlocks = msgText.match(re) ?? [];
    // If a specific block isn't identifiable, fall back to the message text.
    const rawKey = rawBlocks[0] ?? msgText;
    setAnsweredQuestions((prev) => ({ ...prev, [rawKey]: label }));
    // Auto-send a follow-up so Claude sees the answer. User expectation
    // matches how Claude Code renders AskUserQuestion elsewhere: click =
    // next turn continues with the selection.
    setInput(`I picked: ${label}`);
    // Defer send so state updates land
    requestAnimationFrame(() => {
      handleSendRef.current();
    });
  };

  const handleSend = async (overrideText?: string) => {
    // BUG-17: the auto-send poller passes the seed text explicitly. Relying
    // on the `input` closure was racy — handleSendRef is rebound in a post-
    // paint effect, so the poller could invoke a handleSend captured from a
    // render where `input` was still "" (right after a project remount),
    // making this guard early-return silently. The seed then never sent
    // (~3/16 runs stalled with only /healthz in the net log). An explicit
    // override sidesteps the closure entirely.
    const sourceText = (overrideText ?? input).trim();
    if (!sourceText || status === "streaming") return;
    const visibleText = sourceText;
    // One turn id binds the user prompt + every claude artifact this send
    // produces (streaming placeholder, "Design generated" terminal, patch
    // summary, error fallback). The persist effect groups by turn_id and
    // writes one Turn JSONL line per group.
    const turnId = `t${Date.now()}`;

    // AUDIT Fase 1 #4 + #5 — durable turn write with bounded latency and
    // local recovery. Each handleSend path (verb / skill / chat) awaits
    // this helper BEFORE invoking the provider so a tab close in the
    // race window can't lose the conversation. The helper races the
    // daemon write against a 500ms timeout; on timeout / http-fail /
    // missing slug it mirrors the turn into localStorage via
    // chat-recovery and returns "recovered". The user bubble's
    // persist_status badge surfaces the outcome ("saving" → terminal).
    // surfaceError fires on any "failed" result so the user sees a
    // toast instead of silent data loss.
    const persistInitialTurn = async (id: string, user: Turn["user"]): Promise<void> => {
      const result = await persistOrRecoverTurn(projectSlug, projectId ?? null, activeThreadId, {
        id,
        ts: Date.now(),
        user,
        ai: null,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "user" && m.turn_id === id ? { ...m, persist_status: result.status } : m,
        ),
      );
      if (result.status === "failed") {
        surfaceError(
          new Error(`turn ${id} could not be persisted (${result.reason ?? "unknown"})`),
          "persistInitialTurn",
          "error",
        );
      }
    };
    // Approval detection: if the user message reads like satisfaction
    // (PT/EN), snapshot the current iframeHtml as a named checkpoint
    // before continuing. Best-effort; never blocks the send.
    if (APPROVAL_RE.test(visibleText) && iframeHtml) {
      autoCheckpoint(iframeHtml, "approved");
    }
    // Chat attachments split into chip metadata vs. agent payload.
    // Chat history stores `attachments[]` separately and renders chips;
    // the agent still receives the file content inline in the prompt
    // sent to the provider (CLIs only accept a single string), but
    // message.text stays clean. `attachmentsForChip` is what gets
    // persisted and rendered; `userMsg` is what gets sent to the
    // agent. They diverge intentionally.
    let userMsg = visibleText;
    let attachmentsForChip: import("@/lib/schemas").ChatAttachment[] | undefined;
    if (attachedFiles.length > 0) {
      attachmentsForChip = attachedFiles.map((f): import("@/lib/schemas").ChatAttachment => {
        const isImage = f.mime.startsWith("image/");
        const isHtml = f.mime === "text/html" || /\.html?$/i.test(f.name);
        const isTextLike =
          !isImage &&
          (f.mime.startsWith("text/") ||
            /^application\/(json|javascript|xml)/.test(f.mime) ||
            /\.(md|ts|tsx|jsx|js|json|yml|yaml|txt|csv|css)$/i.test(f.name));
        return {
          name: f.name,
          size: f.size,
          mime: f.mime,
          kind: isHtml ? "html" : isImage ? "image" : isTextLike ? "text" : "binary",
          // For images, `f.content` is an absolute on-disk path; reuse it as
          // the chip's `path`. For text/html, `f.content` is inline content.
          path: isImage ? f.content : undefined,
          content: isImage ? undefined : f.content,
        };
      });
      // Build the inline prompt block sent to the provider (unchanged shape so
      // existing model behavior is preserved). This block does NOT land in
      // message.text — only in the prompt string the agent sees.
      const attachBlock = attachedFiles
        .map((f) => {
          if (f.mime.startsWith("image/")) {
            // Detect absolute paths cross-platform — POSIX (`/`, `~`) AND Windows
            // (`C:\…`, `\\server\share`). Without the Windows branch, image
            // attachments written to .df-attachments/ on Windows leaked through
            // as `[image: x.svg attached as data URL]\nC:\...\x.svg` and the agent
            // had no way to read the file.
            const isAbsPath = /^[A-Za-z]:[\\/]|^[\\/]/.test(f.content) || f.content.startsWith("~");
            if (isAbsPath) {
              return `[attached image: ${f.content}]`;
            }
            return `[image: ${f.name} (${(f.size / 1024).toFixed(0)}kb) attached as data URL]\n${f.content}`;
          }
          return `--- ${f.name} (${(f.size / 1024).toFixed(0)}kb) ---\n${f.content}\n--- end of ${f.name} ---`;
        })
        .join("\n\n");
      userMsg = `${attachBlock}\n\n${userMsg}`;
      setAttachedFiles([]);
    }

    // Canonical+ injection moved 2026-05-17 (audit P0-C). The full
    // block previously prepended to userMsg on the first turn is
    // GONE — that path lost force on every iteration after turn 1.
    // Instead, prompt-invoker.buildGenerate/RefineSystem now drops a
    // compact 3-5 line Project Direction Summary into the system
    // prompt of EVERY turn, sourced from ctx.canonicalPlus +
    // ctx.dialOverrides (set above). The full block builder is kept
    // for future use (e.g., a "show full direction" diagnostic) but
    // is no longer wired into the runtime hot path.

    // ──── Editorial verb dispatch (intercept BEFORE generic slash routing) ────
    // `/polish`, `/bolder`, `/calmer` and friends are HYVE editorial
    // verbs registered in src/runtime/verbs/registry.ts. They must
    // intercept BEFORE the slash-command path below — otherwise the
    // user sees "/polish" as their own chat bubble plus an empty
    // Claude placeholder, and the verb fires through the generic
    // skill route with no system prompt. The verb dispatch swallows
    // the literal command and surfaces an "activating verb" affordance
    // instead, then runs the verb's associated prompt.
    const verbHit = matchVerb(visibleText, verbs);
    if (verbHit) {
      if (!iframeHtml) {
        showToast(t("editor.toast.generateFirst"));
        return;
      }
      setInput("");
      setActiveVerb(verbHit.verb);
      // Single shimmer-card message replaces the user bubble + claude
      // placeholder pair. For modify verbs, "Design generated" appends
      // after the card on done. For read-only verbs (review, check) we
      // ALSO push a claude streaming placeholder — that's where the
      // prose result needs to land.
      let verbIndex = -1;
      const verbReadOnly = !verbHit.verb.modifiesHtml;
      const verbTurnId = `t${Date.now()}`;
      setMessages((prev) => {
        verbIndex = prev.length;
        const next: ChatMessage[] = [
          ...prev,
          stamp({
            role: "user",
            text: `/${verbHit.verb.id}`,
            verb: {
              id: verbHit.verb.id,
              label: verbHit.verb.label,
              status: "running",
              modifiesHtml: verbHit.verb.modifiesHtml,
              category: verbHit.verb.category,
            },
            turn_id: verbTurnId,
            persist_status: "saving",
          }),
        ];
        if (verbReadOnly) {
          next.push(
            stamp({
              role: "assistant",
              provider: selectedProvider,
              model: selectedModel,
              text: "",
              streaming: true,
              turn_id: verbTurnId,
            }),
          );
        }
        return next;
      });
      // Await the durable persist before the provider call so closing the
      // tab in the race window can't lose the verb context (audit Fase 1
      // #4 + #5). On timeout / failure the helper falls back to local
      // recovery and updates the bubble's persist_status badge.
      await persistInitialTurn(verbTurnId, {
        text: `/${verbHit.verb.id}`,
        verb: {
          id: verbHit.verb.id,
          label: verbHit.verb.label,
          category: verbHit.verb.category,
          modifiesHtml: verbHit.verb.modifiesHtml,
        },
      });
      const verbStartedAt = Date.now();
      const verbCtx = {
        projectId,
        projectPath: projectPath || "~/design-factory/projeto",
        primaryFile: projectFileName,
        mode,
        conversationHistory: [],
        hasDesignSystem: Boolean(dsPath),
        designSystemPath: dsPath,
        designSystemName: dsName,
        designSystemMarkdown: dsMarkdown,
        cwd: workspaceRoot ?? projectPath ?? undefined,
        currentHtml: iframeHtml ?? undefined,
        model: selectedModel,
        sessionId: selectedProvider === "claude" ? claudeSessionId : null,
      };
      const verbSideChannels = {
        onSession: (sid: string) => {
          persistProviderSession(sid);
          setAuthRequiredBanner(null);
          if (projectId) {
            db.setProjectSession(projectId, sid).catch(() => {});
            db.logSession(projectId, sid, workspaceRoot ?? undefined).catch(() => {});
          }
        },
        onAuthRequired: (detail: string) => setAuthRequiredBanner(detail),
      };
      try {
        await runVerb(
          {
            id: verbHit.verb.id,
            systemPrompt: verbHit.verb.systemPrompt,
            modifiesHtml: verbHit.verb.modifiesHtml,
            args: verbHit.args,
          },
          verbCtx,
          verbSideChannels,
        );
        if (verbHit.verb.modifiesHtml && iframeHtml) {
          autoCheckpoint(iframeHtml, `after ${verbHit.verb.label.toLowerCase()}`);
        }
        setMessages((prev) =>
          prev.map((m, i) =>
            i === verbIndex && m.verb
              ? {
                  ...m,
                  verb: { ...m.verb, status: "done", elapsedMs: Date.now() - verbStartedAt },
                }
              : m,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[verb] /${verbHit.verb.id} failed`, e);
        setMessages((prev) =>
          prev.map((m, i) =>
            i === verbIndex && m.verb
              ? {
                  ...m,
                  verb: {
                    ...m.verb,
                    status: "failed",
                    errorMsg: msg.slice(0, 120),
                    elapsedMs: Date.now() - verbStartedAt,
                  },
                }
              : m,
          ),
        );
      } finally {
        setActiveVerb(null);
      }
      return;
    }

    // Slash / @ commands route to a chat-text flow: response stays as a chat
    // message, no iframe update. Matches how the Claude Code CLI behaves when
    // you invoke a skill — the answer is text, not HTML.
    const isCommand = /^[\/@]/.test(visibleText);
    if (isCommand) {
      // Expand slash commands client-side. The Claude CLI's `--prompt` flag
      // does NOT process slash commands (those only work in interactive chat).
      // So `/my-skill:option` sent as prompt text reaches the model
      // as literal and triggers "Unknown command". Fix: rewrite the prompt to
      // include the skill's body content inline before dispatch.
      let expandedMsg = userMsg;
      const slashMatch = visibleText.match(/^\/([a-zA-Z0-9:_-]+)(\s+([\s\S]*))?$/);
      if (slashMatch) {
        const trigger = "/" + slashMatch[1];
        const args = (slashMatch[3] ?? "").trim();
        const skill = registrySkills.find((s) => s.trigger === trigger);
        if (skill && skill.body) {
          expandedMsg = [
            `# Skill: ${skill.name}`,
            skill.description ? `_${skill.description}_` : "",
            "",
            "---",
            "",
            skill.body.trim(),
            "",
            "---",
            "",
            args
              ? `## User request\n\n${args}`
              : "## User request\n\n(no additional args — execute the skill with defaults)",
          ]
            .filter(Boolean)
            .join("\n");
          // Keep the visibleText in the message history (so it reads nicely),
          // but send the expanded payload to the LLM.
        }
      }
      setInput("");
      setMessages((prev) => [
        ...prev,
        stamp({
          role: "user",
          text: visibleText,
          attachments: attachmentsForChip,
          turn_id: turnId,
          persist_status: "saving",
        }),
        stamp({
          role: "assistant",
          provider: selectedProvider,
          model: selectedModel,
          text: "",
          streaming: true,
          turn_id: turnId,
        }),
      ]);
      if (projectId) db.saveMessage(projectId, "user", visibleText, false).catch(() => {});
      // Await durable persist before sendSkillCommand so a tab close
      // before the skill returns can't drop the user's command.
      await persistInitialTurn(turnId, {
        text: visibleText,
        attachments: attachmentsForChip,
      });
      await sendSkillCommand(expandedMsg);
      return;
    }

    setInput("");
    // Start a fresh turn recorder so every SSE event + state change for
    // this prompt is observable in the TurnTimelinePanel + persisted to
    // .df/sessions/{turnId}.jsonl for offline replay.
    recStartTurn(turnId, { provider: selectedProvider, model: selectedModel });
    // BUG-29: snapshot the pre-turn HTML so the done-effect can tell if this
    // turn actually changed the design (vs. a stale iframe from a prior turn).
    designBaselineRef.current = iframeHtml;
    recordTurn("client", "handleSend", {
      visibleText_preview: visibleText.slice(0, 80),
      provider: selectedProvider,
      model: selectedModel,
    });
    // Push user message + an empty claude placeholder so the Thinking… state
    // is visible from send through first streaming chunk. Without the
    // placeholder, the chat shows nothing between user message and first
    // chunk and the user has no feedback.
    setMessages((prev) => [
      ...prev,
      stamp({
        role: "user",
        text: visibleText,
        attachments: attachmentsForChip,
        turn_id: turnId,
        persist_status: "saving",
      }),
      stamp({
        role: "assistant",
        provider: selectedProvider,
        model: selectedModel,
        text: "",
        streaming: true,
        turn_id: turnId,
      }),
    ]);
    if (projectId) {
      db.saveMessage(projectId, "user", visibleText, false).catch(() => {});
    }
    // AUDIT Fase 1 #4 + #5 — durable persist (race against 500ms
    // timeout, fallback to local recovery) before the provider call.
    // The bubble's persist_status badge surfaces saved / recovered /
    // failed; failure also fires surfaceError for a toast. Provider
    // stream begins only after this resolves.
    await persistInitialTurn(turnId, {
      text: visibleText,
      attachments: attachmentsForChip,
      verb: null,
    });
    const conversationHistory = messages
      .filter((m) => !m.isDesign)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      }));

    // turn pipeline V2 (DF_ENABLE_TURN_PIPELINE_V2=1). When the
    // flag is on, route through the modular `sendUserTurn()` instead of
    // the legacy three-path fan-out below. The flag default is OFF until
    // the user explicitly opts in, so this path stays cold during the
    // legacy rollout and zero-regression check.
    if (isTurnPipelineV2Enabled()) {
      // V2 pipeline doesn't drive useClaude.runStream. Reset legacy stream
      // telemetry so old model/token/cost data cannot bleed into summaries;
      // the global processing bar remains the live indicator during V2 turns.
      reset();
      // BUG-19: patch the streaming placeholder by turn_id, NOT by a captured
      // index. The old `claudeIdx = messages.length + 1` read messages.length
      // from a possibly-stale closure (right after a project remount the chat
      // goes empty→hydrated, and the auto-send fires handleSend via a ref whose
      // closure may predate the latest committed messages). When claudeIdx
      // pointed past the array, every `next[claudeIdx] = …` was a silent no-op:
      // the stream returned "PONG" cleanly (confirmed in traces: stream
      // returned chars=4 errored=false) but the text never landed in a visible
      // bubble, so the placeholder stayed streaming:true forever and the user/
      // E2E saw a "stall" despite a perfect backend round-trip. Matching on the
      // stable turnId is immune to index drift.
      const patchAssistant = (updater: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) => {
          let found = false;
          const next = prev.map((m) => {
            if (!found && m.role === "assistant" && m.turn_id === turnId) {
              found = true;
              return updater(m);
            }
            return m;
          });
          return next;
        });
      };
      let accumulated = "";
      const liveTools: ToolUseRecord[] = [];
      // Canonical+ (Format/Rules/Taste) summary for THIS turn. The V2
      // pipeline's prepare() injects opts.prepare.preambleExtras into the
      // system prompt — without this the modal's Format/Rules/Taste picks
      // never reached the model (they were only on the dead legacy ctx).
      // Read the payload FRESH from disk: the first turn is auto-sent and can
      // fire before the canonicalPlusPayload state hydrates (async load), so
      // relying on component state dropped the direction on the most
      // important turn. Fall back to state if the read misses.
      let canonicalForTurn = canonicalPlusPayload;
      if (projectId) {
        const raw = await db.getSetting(`canonicalPlus:${projectId}`).catch(() => null);
        if (raw) {
          try {
            canonicalForTurn = JSON.parse(raw) as CanonicalPlusInput;
          } catch {
            /* keep state */
          }
        }
      }
      const filteredCanonical: CanonicalPlusInput | null = canonicalForTurn
        ? {
            ...canonicalForTurn,
            format: canonicalActive.format ? canonicalForTurn.format : undefined,
            rules: canonicalActive.rules ? canonicalForTurn.rules : undefined,
            taste: canonicalActive.taste ? canonicalForTurn.taste : undefined,
          }
        : null;
      // Inject the FULL canonical+ block, not the compact summary. The summary
      // lists rule IDs ("Constraints: co-no-raw-black") + bare taste
      // adjectives, which the model can't act on — that's why directions
      // "didn't apply" even when reaching the prompt. The full block carries
      // the format prompt text, each rule's localized title+description, and
      // the full dial phrases. Heavier, but the composer chips let the user
      // turn it off after the first prompt.
      const canonicalSummary = filteredCanonical
        ? buildCanonicalPlusBlock(filteredCanonical, tasteDialOverrides)
        : "";
      recordTurn("client", "canonical+", {
        hasPayload: !!canonicalForTurn,
        blockLen: canonicalSummary.length,
        head: canonicalSummary.slice(0, 200),
      });
      // The editable system core (Settings → Prompts). Generation gets the
      // generate core; an edit (existing HTML) gets the refine core. Wired
      // here so editing in Settings actually affects the V2 turn — before,
      // these were only read by the dead legacy path. Falls back to the
      // shipped default when the user hasn't customised it.
      const editableCore = await getBuiltinPrompt(
        iframeHtml ? "refine" : "generate",
        iframeHtml ? REFINE_SYSTEM : GENERATE_CORE_SYSTEM,
        projectId,
      ).catch(() => "");
      const preambleExtras = [editableCore, canonicalSummary].filter(Boolean).join("\n\n");
      const v2Result = await sendUserTurn(
        {
          userMessage: userMsg,
          providerId: selectedProvider,
          projectId: projectId ?? "",
          threadId: "main",
          mode:
            chatMode === "ask" || (chatMode === "auto" && looksLikeQuestion(visibleText))
              ? "ask"
              : "chat",
          context: (() => {
            // If the active canvas tab is an HTML file tab, treat THAT as
            // the agent's edit target — its content goes into iframeHtml,
            // its filename becomes primaryFile. Without this, the agent
            // operates on the main slug.html even when the user is clearly
            // working on another HTML in a file tab. User repro
            // 2026-05-20: "tem q identificar aba aberta como objetivo do
            // q quer editar".
            const fileTabHtml =
              currentTab?.kind === "file" &&
              currentTab.fileIsText !== false &&
              /\.html?$/i.test(currentTab.filePath ?? "") &&
              typeof currentTab.fileContent === "string"
                ? currentTab.fileContent
                : null;
            const fileTabName =
              fileTabHtml && currentTab?.filePath
                ? (currentTab.filePath.split("/").pop() ?? projectFileName)
                : null;
            return {
              projectPath: projectPath || "~/design-factory/projeto",
              primaryFile: fileTabName ?? projectFileName,
              // workspaceRoot drives the spawn cwd for tool-capable providers
              // (codex/kimi/opencode). Fall back to projectPath when the user
              // hasn't set a global workspace — without this, codex inherits
              // the daemon's cwd (worktree) and its sandbox blocks writes to
              // PROJECT_PATH. User repro 2026-05-20.
              workspaceRoot: workspaceRoot ?? projectPath ?? undefined,
              iframeHtml: fileTabHtml ?? iframeHtml ?? undefined,
              designSystem: {
                path: dsPath ?? undefined,
                name: dsName ?? undefined,
                markdown: dsMarkdown ?? undefined,
              },
              model: selectedModel,
              sessionId: selectedProvider === "claude" ? claudeSessionId : null,
              history: conversationHistory,
            };
          })(),
        },
        {
          ...(preambleExtras ? { prepare: { preambleExtras } } : {}),
          sideChannels: {
            onText: (chunk) => {
              accumulated += chunk;
              patchAssistant((m) => ({
                ...m,
                text: accumulated,
                tools: liveTools.length > 0 ? [...liveTools] : m.tools,
              }));
            },
            onToolCall: (call) => {
              const idx = liveTools.findIndex((t) => t.id === call.id);
              if (idx >= 0)
                liveTools[idx] = { ...liveTools[idx], name: call.name, input: call.input };
              // F2.2 — stamp startedAt on first sighting so each chip can
              // render the relative `t+X.Xs` offset from the turn's ts.
              // Duplicate stream events (Claude emits content_block_stop +
              // message terminal back-to-back) keep the original anchor.
              else
                liveTools.push({
                  id: call.id,
                  name: call.name,
                  input: call.input,
                  startedAt: Date.now(),
                });
              patchAssistant((m) => ({ ...m, tools: [...liveTools] }));
            },
            onToolResult: (tr) => {
              const idx = liveTools.findIndex((t) => t.id === tr.id);
              if (idx >= 0)
                liveTools[idx] = {
                  ...liveTools[idx],
                  result: { content: tr.content, isError: tr.isError },
                };
              patchAssistant((m) => ({ ...m, tools: [...liveTools] }));
            },
            onSessionId: (sid) => {
              persistProviderSession(sid);
              setAuthRequiredBanner(null);
              if (projectId) {
                db.setProjectSession(projectId, sid).catch(() => {});
                db.logSession(projectId, sid, workspaceRoot ?? undefined).catch(() => {});
              }
            },
            onAuthRequired: (detail) => setAuthRequiredBanner(detail),
          },
        },
      );
      // Final patch into the placeholder slot — set the canonical text +
      // doneReport + tools +  toolEvents from the v2 result.
      const finalAssistant = v2Result.messages[0];
      // F1.1 — pull per-message stats from the StreamResult so the
      // permanent footer below the bubble can render (provider · model
      // · duration · tokens · cost). Falls back to the TurnResult's
      // wall-clock duration if the provider didn't surface its own.
      const v2Usage = finalAssistant?.usage;
      const v2DurationMs =
        typeof v2Usage?.durationMs === "number"
          ? v2Usage.durationMs
          : typeof v2Result.duration_ms === "number"
            ? v2Result.duration_ms
            : undefined;
      if (finalAssistant) {
        patchAssistant((m) => ({
          ...m,
          text: finalAssistant.text,
          streaming: false,
          tools:
            finalAssistant.tools && finalAssistant.tools.length > 0
              ? [...finalAssistant.tools]
              : m.tools,
          doneReport: finalAssistant.doneReport,
          // provider-tagged canonical events. Empty array means a text-only
          // provider — keep the existing field rather than spread an empty
          // array (keeps the cached message payload compact).
          toolEvents:
            finalAssistant.toolEvents && finalAssistant.toolEvents.length > 0
              ? finalAssistant.toolEvents
              : m.toolEvents,
          // F1.1 — Permanent stats footer fields.
          durationMs: v2DurationMs,
          tokensIn: typeof v2Usage?.inputTokens === "number" ? v2Usage.inputTokens : undefined,
          tokensOut: typeof v2Usage?.outputTokens === "number" ? v2Usage.outputTokens : undefined,
          costUsd: typeof v2Usage?.costUsd === "number" ? v2Usage.costUsd : undefined,
        }));
      }
      if (projectId && finalAssistant?.text) {
        db.saveMessage(projectId, "assistant", finalAssistant.text, false).catch(() => {});
      }
      // Re-hydrate iframeHtml from disk after V2 finalises. Non-Claude
      // CLIs (Codex/Kimi/Gemini/Opencode) write files via their own
      // tools without emitting events DF can parse — so the agent says
      // "done" but the iframe is still stale. Reading the primary HTML
      // back from disk closes the loop. User repro 2026-05-20:
      // "nao ta atualizando html automatico ao finalizar, to tendo q
      // voltar em files e clicar no arquivo".
      if (projectPath) {
        try {
          const primaryPath = `${projectPath.replace(/\/+$/, "")}/${projectFileName}`;
          const f = await readFileViaBridge(primaryPath);
          if (f && f.isText && typeof f.content === "string" && f.content.length >= 50) {
            if (f.content !== iframeHtml) {
              setIframeHtml(f.content);
              lastPushedOutputRef.current = f.content;
              if (projectId) {
                db.setSetting(`html:${projectId}`, f.content).catch(
                  warn("setSetting:html:post-v2"),
                );
              }
            }
          }
        } catch (err) {
          warn("post-v2:rehydrate-iframe")(err);
        }
        // Bump the Files refresh so the gallery picks up any new files the
        // CLI wrote (even ones DF doesn't track via tool events).
        bumpFilesRefresh();
      }
      // V2 ran end-to-end — return so the legacy fan-out below stays inert.
      return;
    }
  };

  // Dynamic skill / command list scanned from the project's filesystem
  // (canonical `<repoRoot>/skills/`, plus legacy `<repoRoot>/.claude/skills/`
  // walked read-only for compat). useSkillRegistry hook handles
  // scan-on-cwd-change + throttled focus rescan.
  //
  // Bug: installed skills weren't being shown.
  // Previous `slashScanCwd = workspaceRoot || projectPath || null` fell
  // back to `projectPath` (the project's own folder, e.g.
  // `.../projects/untitled-xyz`) when no global workspace_root was set.
  // The daemon then scanned `<projectPath>/skills/`, which doesn't
  // exist → registry returned zero items and the dropup showed no
  // installed skills. Now we only pass workspaceRoot explicitly; the
  // daemon's empty-cwd path auto-resolves via `git rev-parse
  // --git-common-dir`, which finds the canonical `<repoRoot>/skills/`
  // for any caller inside the tree.
  const slashScanCwd = workspaceRoot || null;
  const { skills: registrySkills } = useSkillRegistry(slashScanCwd);
  const dynamicCommands = useMemo<SlashCommand[]>(() => {
    const list: SlashCommand[] = [];

    // User ask 2026-05-21: "quero so os editorial verbs e agora
    // devem se chamar commands". Two surfaces remain in the dropup:
    //
    //   • "Commands" — the nine editorial agents shipped with DF
    //     (polish, rewrite, simplify, reinforce, animate, type,
    //     color, review-pass, check). The local variable is still
    //     called `verbs` because the runtime module that loads them
    //     is `runtime/verbs/registry.ts`; only the user-facing
    //     category label was renamed.
    //   • "Skills" — user-authored skills scanned from
    //     `<repoRoot>/skills/` via the registry. These are the
    //     imports/installs the user actually owns.
    //
    // App handlers (`/tweaks`, `/edit`, `/export`, `/present`,
    // `/terminal`) live on the canvas toolbar pill row instead, and
    // the Claude passthrough triggers (`/init`, `/review`) were
    // dropped from the taxonomy entirely.
    for (const v of verbs) {
      if (v.disabled) continue;
      list.push({
        id: `verb-${v.id}`,
        trigger: `/${v.id}`,
        label: v.label,
        description: v.description,
        category: "Commands",
      });
    }

    for (const s of registrySkills) {
      list.push({
        id: s.id,
        trigger: s.trigger,
        label: s.name,
        description: s.description || s.path || s.id,
        category: "Skills",
        withArgs: true,
      });
    }

    return list;
  }, [verbs, registrySkills]);

  // Matches are computed from originalToken (what user actually typed)
  // NOT from the live token. Arrow navigation rewrites input to show the
  // highlighted trigger, but we don't want that rewrite to refilter the list
  // — otherwise the list collapses to the single selected option and further
  // arrow nav breaks. Matches only change when the user TYPES.
  const slashMatches = useMemo(
    () => (slashState ? findMatches(slashState.originalToken, dynamicCommands) : []),
    [slashState?.originalToken, dynamicCommands],
  );

  const insertSlashCommand = useCallback(
    (cmd: SlashCommand, opts?: { addArgsSpace?: boolean }) => {
      if (!slashState) return;
      const addArgsSpace = opts?.addArgsSpace ?? false;
      const start = slashState.start;
      const before = input.slice(0, start);
      const after = input.slice(start + slashState.token.length);
      const insert = addArgsSpace && cmd.withArgs ? `${cmd.trigger} ` : cmd.trigger;
      const next = before + insert + after;
      setInput(next);
      setSlashState(null);
      // Restore cursor after the inserted trigger
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          const pos = before.length + insert.length;
          el.focus();
          el.setSelectionRange(pos, pos);
        }
      });
    },
    [slashState, input],
  );

  // Live preview helper — rewrites the input so it shows the highlighted
  // trigger without committing the slashState. Used by arrow navigation.
  const previewHighlight = (state: typeof slashState, nextHi: number) => {
    if (!state || !slashMatches[nextHi]) return;
    const before = input.slice(0, state.start);
    const after = input.slice(state.start + state.token.length);
    const newTrigger = slashMatches[nextHi].trigger;
    const next = before + newTrigger + after;
    setInput(next);
    // Keep slashState.token in sync with what's now under the cursor, so
    // further keystrokes keep matching the same set of skills.
    setSlashState({ ...state, token: newTrigger, hi: nextHi });
    // Restore cursor position to end of the trigger.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = state.start + newTrigger.length;
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashState && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        previewHighlight(slashState, (slashState.hi + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        previewHighlight(
          slashState,
          (slashState.hi - 1 + slashMatches.length) % slashMatches.length,
        );
        return;
      }
      // Enter inserts the highlighted trigger into the prompt and closes the
      // menu. The user reviews the filled command and presses Enter again to
      // send — Tab still inserts with a trailing space if the skill takes args.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertSlashCommand(slashMatches[slashState.hi]);
        return;
      }
      // Tab inserts + keeps focus with trailing space for args.
      if (e.key === "Tab") {
        e.preventDefault();
        insertSlashCommand(slashMatches[slashState.hi], { addArgsSpace: true });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Restore the originally typed token so user doesn't lose what they wrote.
        const before = input.slice(0, slashState.start);
        const after = input.slice(slashState.start + slashState.token.length);
        setInput(before + slashState.originalToken + after);
        setSlashState(null);
        return;
      }
    }
    // Plain Enter sends; Shift+Enter inserts newline (default textarea behaviour).
    // Cmd/Ctrl+Enter preserved as a power-user alias.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sendSkillCommand = useCallback(
    async (prompt: string) => {
      // Route through the selected provider. Agent selection happens ONLY via
      // `@agent-name` mention at the start of the prompt — there's no global
      // default agent setting anymore. Claude is the only provider that honours
      // --agent; others degrade to plain text.
      let routedAgent: string | undefined;
      let effectivePrompt = prompt;
      const mentionMatch = prompt.match(/^@([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
      if (mentionMatch) {
        routedAgent = mentionMatch[1].toLowerCase();
        effectivePrompt = (mentionMatch[2] ?? "").trim() || "Hi.";
      }

      // Prepend conversation history so follow-up commands see prior context.
      // Parity with invokeGenerateBase (regular chat) which already does this.
      // Excludes the two messages just pushed (current user + empty claude
      // placeholder) so we don't echo them back.
      const historyLines = messages
        .slice(0, Math.max(0, messages.length - 2))
        .filter((m) => !m.isDesign)
        .map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
        .filter((line) => line.trim())
        .join("\n");
      if (historyLines) {
        effectivePrompt = `${historyLines}\n\nUser: ${effectivePrompt}`;
      }

      // Build the system prompt so skills + @agent invocations see the
      // same workspace context as regular generate/refine — including the
      // ::question protocol that replaces AskUserQuestion + the PROJECT_PATH
      // hint. Without this, Claude hits the forbidden harness tools AND has
      // no idea where the project files live.
      const skillCtx: ProjectContext = {
        projectId,
        projectPath: projectPath || "~/design-factory/projeto",
        primaryFile: projectFileName,
        mode,
        conversationHistory: [], // already inlined above
        hasDesignSystem: Boolean(dsPath),
        designSystemPath: dsPath,
        designSystemName: dsName,
        designSystemMarkdown: dsMarkdown,
        cwd: workspaceRoot ?? projectPath ?? undefined,
        currentHtml: iframeHtml ?? undefined,
        model: selectedModel,
      };
      const preamble = workspaceContextPreamble(skillCtx);
      // Inline the current HTML (if present) so skills that need to "look at"
      // the project see the actual content, not just the path.
      const currentFileBlock = iframeHtml
        ? `\n\n## Current ${projectFileName} content\n\n\`\`\`html\n${iframeHtml}\n\`\`\`\n`
        : "";
      const skillSystemPrompt = `${preamble}${currentFileBlock}`;

      const provider = getProvider(selectedProvider) ?? getProvider("claude")!;
      const isClaude = provider.meta.id === "claude";
      let accumulated = "";
      const liveTools: ToolUseRecord[] = [];
      try {
        // Credential gate (defense in depth): never dispatch to a provider
        // that isn't ready (no API key, server offline). Without this the
        // daemon rejects the request and the user sees a cryptic
        // "bridge HTTP 400" instead of an actionable message.
        const st = await provider.status();
        if (st.status !== "connected") {
          const detail = st.detail ?? "credencial ausente ou serviço indisponível";
          const msg = `${provider.meta.label} não está pronto: ${detail}. Configure em Settings → Providers.`;
          recordTurn("client", "provider_not_ready", { provider: provider.meta.id, status: st.status }, { level: "warn" });
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, text: `[error] ${msg}`, streaming: false };
            }
            return next;
          });
          showToast(msg);
          recEndTurn({ reason: "error" });
          return;
        }
        // BUG-CANCEL: mark this flow as streaming so the STOP button surfaces
        // (status from useClaude never flips for this direct-stream path).
        setAgentStreaming(true);
        await new Promise<void>((resolve) => {
          // BUG-CANCEL: capture the unlisten so STOP / unmount can abort the
          // daemon SSE. `provider.stream` returns Promise<UnlistenFn>; wire it
          // into agentAbortRef once the stream is actually listening (same
          // pattern as tweaksAbortRef). The abort closes the stream + resolves
          // the outer Promise so the turn unwinds cleanly.
          const streamPromise = provider.stream(
            effectivePrompt,
            {
              model: selectedModel,
              cwd: workspaceRoot ?? projectPath ?? undefined,
              systemPrompt: skillSystemPrompt,
              ...(isClaude && routedAgent ? { agent: routedAgent } : {}),
            },
            {
              onText: (t) => {
                accumulated += t;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant")
                    next[next.length - 1] = { ...last, text: accumulated, tools: [...liveTools] };
                  return next;
                });
              },
              onToolCall: (call) => {
                recordTurn("tool", "tool_call", {
                  id: call.id,
                  name: call.name,
                  file_path: (call.input?.file_path ?? call.input?.path) as string | undefined,
                  liveToolsBefore: liveTools.length,
                });
                // Dedup por id — CLI/bridge podem emitir o mesmo tool_call duas
                // vezes (stream_event content_block_stop + message terminal).
                // User reportou "Claude pensando duplicado" em 2026-04-23.
                const existing = liveTools.findIndex((t) => t.id === call.id);
                if (existing >= 0) {
                  liveTools[existing] = {
                    ...liveTools[existing],
                    name: call.name,
                    input: call.input,
                  };
                } else {
                  // F2.2 — stamp startedAt on first sighting (same pattern as
                  // the V2 onToolCall above).
                  liveTools.push({
                    id: call.id,
                    name: call.name,
                    input: call.input,
                    startedAt: Date.now(),
                  });
                }
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant")
                    next[next.length - 1] = { ...last, tools: [...liveTools] };
                  return next;
                });
              },
              onToolResult: (tr) => {
                recordTurn("tool", "tool_result", {
                  id: tr.id,
                  isError: tr.isError,
                  content_len: typeof tr.content === "string" ? tr.content.length : 0,
                });
                const idx = liveTools.findIndex((t) => t.id === tr.id);
                if (idx >= 0)
                  liveTools[idx] = {
                    ...liveTools[idx],
                    result: { content: tr.content, isError: tr.isError },
                  };
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant")
                    next[next.length - 1] = { ...last, tools: [...liveTools] };
                  return next;
                });
                // W9+ (slimmed 2026-05-03): refresh the iframe when Claude
                // writes the primary HTML, but DON'T auto-open a code tab.
                // Auto-opening duplicated tabs (raw vs resolved path bypassed
                // openFileTab's dedup → 2-3 tabs per turn). Code view now via
                // FileManager click only — preview already shows the result.
                if (!tr.isError && idx >= 0) {
                  const call = liveTools[idx];
                  const toolName = call.name;
                  const rawPath = (call.input?.file_path ?? call.input?.path) as string | undefined;
                  if ((toolName === "Write" || toolName === "Edit") && rawPath) {
                    const isHtml = /\.(html?|svg)$/i.test(rawPath);
                    // Some providers send a relative path (just the filename)
                    // even though they wrote into the project cwd. Resolve
                    // against projectPath when not absolute so the bridge read
                    // hits the right file.
                    const resolvedPath = rawPath.startsWith("/")
                      ? rawPath
                      : projectPath
                        ? `${projectPath.replace(/\/$/, "")}/${rawPath.replace(/^\.?\//, "")}`
                        : rawPath;
                    const inProject = projectPath && resolvedPath.startsWith(projectPath);
                    recordTurn("iframe", "tool_result_reload_attempt", {
                      toolName,
                      rawPath,
                      resolvedPath,
                      projectPath,
                      isHtml,
                      inProject,
                    });
                    if (isHtml && !inProject) {
                      recordTurn(
                        "iframe",
                        "blocked_path_not_in_project",
                        {
                          rawPath,
                          projectPath,
                        },
                        { level: "warn" },
                      );
                    }
                    if (isHtml && inProject) {
                      void (async () => {
                        // Retry with small backoff — codex/kimi/big BYOK writes
                        // can land on disk a beat after the tool_result fires,
                        // making the first read return empty content. User
                        // QA 2026-05-18 reported "Writing teste-gooey.html"
                        // shown but iframe stayed empty until manual reload.
                        const delays = [0, 200, 500, 1200];
                        for (const delay of delays) {
                          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
                          try {
                            const fresh = await readFileViaBridge(resolvedPath);
                            if (
                              fresh &&
                              typeof fresh === "object" &&
                              "content" in fresh &&
                              typeof (fresh as FsFile).content === "string"
                            ) {
                              const html = (fresh as FsFile).content;
                              if (html && html.length >= 50) {
                                recordTurn("iframe", "hydrated_from_tool_result", {
                                  resolvedPath,
                                  bytes: html.length,
                                  delay,
                                });
                                setIframeHtml(html);
                                lastPushedOutputRef.current = html;
                                if (projectId)
                                  void db
                                    .setSetting(`html:${projectId}`, html)
                                    .catch(warn("setSetting:html::projectId"));
                                return;
                              }
                            }
                          } catch {
                            /* file not ready yet — next interval */
                          }
                        }
                        recordTurn(
                          "iframe",
                          "tool_result_reload_failed_after_retries",
                          {
                            resolvedPath,
                            delays_tried: delays,
                          },
                          { level: "warn" },
                        );
                      })();
                    }
                  }
                }
              },
              onDone: (full) => {
                const finalText = full || accumulated;
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant") {
                    next[next.length - 1] = {
                      ...last,
                      text: finalText || "(no response)",
                      tools: liveTools.length > 0 ? [...liveTools] : undefined,
                      streaming: false,
                    };
                  }
                  return next;
                });
                // Persist with tool blocks when tools fired this turn — without
                // this, a reload drops the tool chips ("Writing teste-gooey.html")
                // even though the file is on disk and the iframe rehydrated.
                // User QA 2026-05-18 — reported "recarreguei e sumiu a
                // mensagem do claude mas abriu o html".
                if (projectId && finalText) {
                  if (liveTools.length > 0) {
                    const parts: ChatBlock[] = [
                      { type: "text", content: finalText },
                      ...liveTools.flatMap((t) => {
                        const blocks: ChatBlock[] = [
                          { type: "tool_call", callId: t.id, name: t.name, input: t.input },
                        ];
                        if (t.result) {
                          blocks.push({
                            type: "tool_result",
                            callId: t.id,
                            output: t.result.content,
                            isError: t.result.isError,
                          });
                        }
                        return blocks;
                      }),
                    ];
                    db.saveMessageStructured(projectId, "assistant", finalText, parts, false).catch(
                      () => {
                        db.saveMessage(projectId, "assistant", finalText, false).catch(() => {});
                      },
                    );
                  } else {
                    db.saveMessage(projectId, "assistant", finalText, false).catch(() => {});
                  }
                }
                // 3rd-layer safety net for iframe hydration. User QA 2026-05-18
                // reported the iframe still empty after Write completed despite
                // the onToolResult retry — likely the bridge never relayed the
                // tool_result SSE for that turn (race vs message_stop), so we
                // walk Write/Edit tools at onDone and try once more from disk.
                const writeTools = liveTools.filter(
                  (t) =>
                    (t.name === "Write" || t.name === "Edit") &&
                    typeof (t.input?.file_path ?? t.input?.path) === "string",
                );
                if (writeTools.length > 0 && projectPath) {
                  void (async () => {
                    for (const t of writeTools) {
                      const raw = (t.input?.file_path ?? t.input?.path) as string;
                      if (!/\.(html?|svg)$/i.test(raw)) continue;
                      const resolved = raw.startsWith("/")
                        ? raw
                        : `${projectPath.replace(/\/$/, "")}/${raw.replace(/^\.?\//, "")}`;
                      if (!resolved.startsWith(projectPath)) continue;
                      const delays = [0, 300, 800];
                      for (const delay of delays) {
                        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
                        try {
                          const fresh = await readFileViaBridge(resolved);
                          if (
                            fresh &&
                            typeof fresh === "object" &&
                            "content" in fresh &&
                            typeof (fresh as FsFile).content === "string"
                          ) {
                            const html = (fresh as FsFile).content;
                            if (html && html.length >= 50 && lastPushedOutputRef.current !== html) {
                              recordTurn("iframe", "hydrated_from_onDone_sweep", {
                                resolved,
                                bytes: html.length,
                                delay,
                              });
                              setIframeHtml(html);
                              lastPushedOutputRef.current = html;
                              if (projectId)
                                void db
                                  .setSetting(`html:${projectId}`, html)
                                  .catch(warn("setSetting:html::projectId"));
                              return;
                            }
                          }
                        } catch {
                          /* retry */
                        }
                      }
                    }
                  })();
                }
                // Artifact-channel providers (Kimi, BYOK Anthropic/OpenAI/Gemini/
                // OpenRouter, Ollama, OpenCode) wrap the HTML in
                // <artifact identifier=... type=... title=...>...</artifact>
                // inside the text stream — they don't fire Write tool calls. Parse
                // the final text and hydrate iframe + persist the HTML to the
                // project file. User QA 2026-05-18 — Kimi turn left iframe
                // empty until manual reload, despite the artifact being in finalText.
                if (finalText && finalText.includes("<artifact")) {
                  void (async () => {
                    try {
                      const parsed = await parseArtifact(finalText);
                      if (parsed.status !== "artifact") {
                        recordTurn(
                          "artifact",
                          "parse_non_artifact",
                          {
                            status: parsed.status,
                            reason: "reason" in parsed ? parsed.reason : undefined,
                            text_len: finalText.length,
                          },
                          { level: "warn" },
                        );
                        return;
                      }
                      const isHtml =
                        /html/i.test(parsed.artifact.type) ||
                        /\.(html?|svg)$/i.test(parsed.artifact.identifier);
                      if (!isHtml) {
                        recordTurn("artifact", "parsed_non_html", {
                          type: parsed.artifact.type,
                          identifier: parsed.artifact.identifier,
                        });
                        return;
                      }
                      const html = parsed.artifact.content;
                      if (!html || html.length < 50) {
                        recordTurn("artifact", "parsed_too_short", { bytes: html?.length ?? 0 });
                        return;
                      }
                      if (lastPushedOutputRef.current === html) {
                        recordTurn("artifact", "duplicate_skip", { bytes: html.length });
                        return;
                      }
                      recordTurn("artifact", "hydrated_iframe", {
                        bytes: html.length,
                        identifier: parsed.artifact.identifier,
                      });
                      setIframeHtml(html);
                      lastPushedOutputRef.current = html;
                      if (projectId)
                        void db
                          .setSetting(`html:${projectId}`, html)
                          .catch(warn("setSetting:html::projectId"));
                      // Persist to the project file so the disk version matches
                      // what the iframe shows — reloads and Files-tab opens read
                      // the same source of truth.
                      if (projectPath && projectFileName) {
                        const target = `${projectPath.replace(/\/$/, "")}/${projectFileName}`;
                        await writeFile(target, html).catch((e) => {
                          recordTurn(
                            "artifact",
                            "write_file_failed",
                            { target, err: String(e) },
                            { level: "error" },
                          );
                        });
                      }
                    } catch (e) {
                      recordTurn("artifact", "parse_threw", { err: String(e) }, { level: "error" });
                    }
                  })();
                }
                recordTurn("client", "onDone", {
                  text_len: finalText?.length ?? 0,
                  tools_count: liveTools.length,
                  has_artifact: finalText?.includes("<artifact") ?? false,
                });
                recEndTurn({ reason: "done" });
                // BUG-CANCEL: stream finished on its own — clear the abort
                // handle + streaming flag so STOP disappears and we don't
                // hold a stale unlisten.
                agentAbortRef.current = null;
                agentUnlistenRef.current = null;
                setAgentStreaming(false);
                resolve();
              },
              onError: (err) => {
                recordTurn(
                  "client",
                  "onError",
                  { err: String(err).slice(0, 200) },
                  { level: "error" },
                );
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant") {
                    next[next.length - 1] = { ...last, text: `[error] ${err}`, streaming: false };
                  }
                  return next;
                });
                // Disk-sweep fallback: when the stream errored AFTER a Write
                // tool to project HTML already ran, the SDK skips the
                // tool_result callback and the canvas stays empty even
                // though the file is on disk. User hit this with the
                // 'audit' project on 2026-04-29 — claude rate-limit between
                // Write success and tool_result, html landed but iframe
                // never refreshed, user had to open Files manually.
                // Sweep ALL Write/Edit calls in liveTools — the tool_result
                // not having fired means we don't know which succeeded, so
                // try to read each candidate; first successful HTML wins.
                const writes = liveTools.filter(
                  (t) =>
                    (t.name === "Write" || t.name === "Edit") &&
                    typeof t.input?.file_path === "string" &&
                    /\.(html?)$/i.test(t.input.file_path as string),
                );
                if (writes.length > 0 && projectPath) {
                  void (async () => {
                    for (const w of writes) {
                      const fp = (w.input?.file_path ?? w.input?.path) as string | undefined;
                      if (!fp || !fp.startsWith(projectPath)) continue;
                      try {
                        const fresh = await readFileViaBridge(fp);
                        if (
                          fresh &&
                          typeof fresh === "object" &&
                          "content" in fresh &&
                          typeof (fresh as FsFile).content === "string"
                        ) {
                          const html = (fresh as FsFile).content;
                          if (html && html.length > 0) {
                            recordTurn("iframe", "hydrated_from_error_sweep", {
                              fp,
                              bytes: html.length,
                            });
                            setIframeHtml(html);
                            lastPushedOutputRef.current = html;
                            if (projectId)
                              void db
                                .setSetting(`html:${projectId}`, html)
                                .catch(warn("setSetting:html::projectId"));
                            break;
                          }
                        }
                      } catch (e) {
                        recordTurn(
                          "iframe",
                          "error_sweep_read_failed",
                          { fp, err: String(e) },
                          { level: "warn" },
                        );
                      }
                    }
                  })();
                }
                recEndTurn({ reason: "error" });
                // BUG-CANCEL: clear the abort handle + streaming flag on error.
                agentAbortRef.current = null;
                agentUnlistenRef.current = null;
                setAgentStreaming(false);
                resolve();
              },
            },
          );
          // BUG-CANCEL: wire the abort into the ref once the stream is actually
          // listening. Clicking STOP closes the daemon SSE (unlisten), marks
          // the in-flight assistant message as interrupted (without breaking
          // it), clears the streaming flag, and resolves the outer Promise so
          // the turn unwinds. If the stream fails to start, surface the error
          // and unwind too.
          streamPromise.then(
            (unlisten) => {
              agentUnlistenRef.current = unlisten;
              agentAbortRef.current = () => {
                try {
                  unlisten();
                } catch {}
                agentAbortRef.current = null;
                agentUnlistenRef.current = null;
                setAgentStreaming(false);
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant" && last.streaming) {
                    next[next.length - 1] = {
                      ...last,
                      text: `${last.text || ""}${last.text ? "\n\n" : ""}_[interrompido]_`,
                      streaming: false,
                    };
                  }
                  return next;
                });
                recEndTurn({ reason: "cancelled" });
                resolve();
              };
            },
            (err) => {
              // stream() rejected before listening — nothing to abort.
              agentAbortRef.current = null;
              agentUnlistenRef.current = null;
              setAgentStreaming(false);
              recordTurn(
                "client",
                "stream_start_failed",
                { err: String(err).slice(0, 200) },
                { level: "error" },
              );
              resolve();
            },
          );
        });
      } catch (e) {
        showToast(`Command failed: ${String(e).slice(0, 80)}`);
        // Make absolutely sure the streaming flag clears even if the stream
        // throws before onError fires (bridge crash, abort, etc).
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, streaming: false };
          }
          return next;
        });
      } finally {
        // BUG-CANCEL: belt-and-suspenders — whatever path unwound the turn
        // (done / error / cancel / throw), the STOP affordance must clear and
        // the abort handle must not linger.
        agentAbortRef.current = null;
        agentUnlistenRef.current = null;
        setAgentStreaming(false);
      }
    },
    [
      selectedModel,
      selectedProvider,
      workspaceRoot,
      projectId,
      showToast,
      projectPath,
      projectFileName,
      mode,
      dsPath,
      startMode,
      iframeHtml,
      messages,
    ],
  );

  // Save image files to the project folder (`.df-attachments/`) and
  // reference them by absolute path in the prompt. Claude picks them
  // up via its Read tool. The unified attach handler treats image as
  // just one kind of attachment — no separate button. Routing by
  // MIME type:
  //   - image/*  → save to project's .df-attachments/, reference by
  //                path (5MB limit; large image files supported)
  //   - text/*   → inline as text content (500kb limit)
  //   - other    → inline as data URL (500kb limit)
  // Hard ceiling for any single dropped/pasted file. Below this we still
  // apply per-kind limits (5MB for images written to disk, 500kb for inline
  // text/binary) — but anything above the ceiling is rejected up front so a
  // 50MB video / PSD / zip can't run through arrayBuffer() and freeze the UI
  // before the per-kind branch rejects it.
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
  const handleAttach = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const newOnes: Array<{
        name: string;
        size: number;
        content: string;
        mime: string;
        preview?: string;
      }> = [];
      for (const f of Array.from(files)) {
        if (f.size > MAX_ATTACHMENT_BYTES) {
          showToast(
            `${f.name} too large (>${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB) — skip`,
          );
          continue;
        }
        const mime = f.type || "application/octet-stream";
        const isImage = mime.startsWith("image/");
        if (isImage) {
          if (!projectPath) {
            showToast(t("editor.toast.saveFirst"));
            continue;
          }
          if (f.size > 5 * 1024 * 1024) {
            showToast(`${f.name} too large (>5MB)`);
            continue;
          }
          const rawDataUrl = await fileToDataUrl(f);
          // Downscale huge images so the agent isn't handed a 12-megapixel
          // logo (which stalled Kimi past the turn watchdog and breaks API
          // vision limits). Falls back to the original on any failure.
          const { dataUrl, mime: outMime } = await downscaleImageDataUrl(rawDataUrl, mime);
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const ext =
            outMime === "image/jpeg"
              ? "jpg"
              : outMime === "image/png"
                ? "png"
                : f.name.split(".").pop() || "png";
          const baseName = f.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
          const safeName = `${Date.now().toString(36)}-${baseName}.${ext}`;
          const dir = `${projectPath.replace(/\/$/, "")}/.df-attachments`;
          const diskPath = `${dir}/${safeName}`;
          const written = await writeBinaryViaBridge(diskPath, base64);
          if (!written) {
            showToast(`Failed to save ${f.name}`);
            continue;
          }
          newOnes.push({
            name: f.name,
            size: f.size,
            content: diskPath,
            mime: outMime,
            preview: dataUrl,
          });
        } else {
          if (f.size > 500 * 1024) {
            showToast(`${f.name} too large (>500kb)`);
            continue;
          }
          const isText =
            mime.startsWith("text/") ||
            /^(application\/(json|javascript|xml|html))/.test(mime) ||
            /\.(md|ts|tsx|jsx|js|json|yml|yaml|txt|csv|html|css)$/i.test(f.name);
          let content: string;
          if (isText) content = await f.text();
          else content = await fileToDataUrl(f);
          newOnes.push({ name: f.name, size: f.size, content, mime });
        }
      }
      setAttachedFiles((prev) => [...prev, ...newOnes]);
      if (newOnes.length)
        showToast(`Attached ${newOnes.length} file${newOnes.length === 1 ? "" : "s"}`);
    },
    [projectPath, showToast],
  );

  // Auto-send seeded prompt once bridge is ready (browser) or immediately in Tauri.
  //
  // The ref dance looks verbose but each piece earns its keep:
  //   handleSendRef  — keeps a fresh pointer to handleSend without putting the
  //                    closure in the effect deps (would re-run every render).
  //   autoSendRef    — single-fire guard across StrictMode double-mount.
  //   250ms timeout  — lets the textarea commit the seed + gives the bridge
  //                    probe a tick to settle before firing the stream.
  const handleSendRef = useRef(handleSend);
  useEffect(() => {
    handleSendRef.current = handleSend;
  });
  // BUG-16/17: auto-send the seed prompt on a new project. The previous
  // single-setTimeout(250) approach was fragile: the effect cleanup cancels
  // the pending timer whenever ANY dep re-emits, and if the timer was lost in
  // that window the seed silently never sent (~1-3/16 E2E runs stalled with
  // "first turn never produced a response", only /healthz in the network log).
  //
  // Robust replacement: a self-contained polling loop that re-checks the
  // guards every 300ms for up to ~8s and fires handleSend exactly once when
  // all are green. It owns its own lifecycle (single interval, single guard
  // ref) and does NOT depend on the React effect re-running, so dep churn
  // can't strand it. Runs once per project mount (key={project.id} remounts
  // reset the ref).
  useEffect(() => {
    if (!autoSentHydrated || !providerHydrated) return;
    if (autoSendRef.current) return;
    if (!initialPrompt) return;

    let cancelled = false;
    const startedAt = Date.now();
    const DEADLINE_MS = 8000;
    const POLL_MS = 300;

    const tick = () => {
      if (cancelled || autoSendRef.current) return;
      // Preconditions re-read fresh each tick. NOTE: we deliberately do NOT
      // gate on bridgeAvailableRef here. The bridge health probe uses a
      // 1500ms AbortController timeout and, under load (many sequential CLI
      // spawns), /healthz can exceed that and flip bridgeAvailable to false
      // transiently. Gating auto-send on it stranded the seed in ~5/16 E2E
      // runs ("stream-stalled", only /healthz in the net log). handleSend →
      // sendUserTurn → streamViaBridge already does its own probeBridge() and
      // surfaces a real error if the bridge is genuinely down, so the gate
      // here was both redundant and the source of the flake.
      // The seed text IS initialPrompt — always available. We deliberately
      // do NOT require inputRef to be populated first (that depends on the
      // separate seed effect having run setInput, another async hop that
      // could lag past the deadline). Gate only on status being idle.
      const ready = !!initialPrompt && statusRef.current === "idle";
      if (ready) {
        autoSendRef.current = true;
        if (projectId)
          db.setSetting(`auto-sent:${projectId}`, "true").catch(
            warn("setSetting:auto-sent::projectId"),
          );
        // Pass the seed text explicitly (BUG-17) so handleSend doesn't depend
        // on its possibly-stale `input` closure or the seed effect timing.
        const sendText = inputRef.current.trim() || initialPrompt;
        handleSendRef.current(sendText);
        return;
      }
      if (Date.now() - startedAt > DEADLINE_MS) {
        // Give up quietly; the user can still send manually. Surfacing an
        // error here would be noise for the common "bridge a bit slow" case.
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };
    // Kick off after a short beat so the seed input + provider state settle.
    const starter = window.setTimeout(tick, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(starter);
    };
  }, [initialPrompt, projectId, autoSentHydrated, providerHydrated]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  const handleSaveVersion = useCallback(() => {
    if (!iframeHtml) {
      showToast(t("editor.toast.nothingToSave"));
      return;
    }
    const name = saveVersionName.trim() || new Date().toLocaleString();
    const next: Version = {
      id: crypto.randomUUID(),
      html: iframeHtml,
      name,
      createdAt: Date.now(),
      auto: false,
    };
    persistVersions([...versions, next]);
    setSaveVersionName("");
    setShowSaveVersion(false);
    showToast(`Saved as "${name}"`);
    // Also snapshot the project folder to git so the version is recoverable
    // via the CLI — a real branchable checkpoint, not just a localStorage row.
    if (projectPath) {
      gitSnapshot(projectPath, name)
        .then((r) => {
          if (r && !("error" in r)) {
            // Quiet success — tag sits in the repo. No extra toast.
          }
        })
        .catch(() => {});
    }
  }, [iframeHtml, saveVersionName, versions, persistVersions, showToast, projectPath]);

  const handleRestoreVersion = useCallback(
    (v: Version) => {
      if (!v?.html) return;
      setIframeHtml(v.html);
      setHistory((prev) => {
        const idx = historyIndexRef.current;
        const base = idx >= 0 ? prev.slice(0, idx + 1) : [];
        const next = [...base, v.html];
        historyIndexRef.current = next.length - 1;
        setHistoryIndex(next.length - 1);
        return next;
      });
      lastPushedOutputRef.current = v.html;
      if (projectId)
        db.setSetting(`html:${projectId}`, v.html).catch(warn("setSetting:html::projectId"));
      setShowVersions(false);
      showToast(`Restored: ${v.name ?? new Date(v.createdAt).toLocaleString()}`);
    },
    [projectId, showToast],
  );

  // Per-turn Restore: user clicks the Restore button on a previous AI
  // response → revert iframe AND drop a marker turn into the chat so the
  // history shows clearly "we rolled back". Doesn't truncate later turns
  // (user explicitly chose this — "mantém histórico").
  const handleRestoreFromTurn = useCallback(
    (versionId: string) => {
      const v = versions.find((x) => x.id === versionId);
      if (!v) {
        showToast(t("editor.toast.snapshotNotFound"));
        return;
      }
      handleRestoreVersion(v);
      const markerTurnId = `t${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        stamp({ role: "user", text: "(restored)", turn_id: markerTurnId }),
        stamp({
          role: "assistant",
          text: `Rolled back to ${new Date(v.createdAt).toLocaleString()}`,
          turn_id: markerTurnId,
          isDesign: true,
          version_id: v.id,
        }),
      ]);
    },
    [versions, handleRestoreVersion, showToast],
  );

  const handleDeleteVersion = useCallback(
    (id: string) => {
      persistVersions(versions.filter((v) => v.id !== id));
      // explicit drop on disk so the deleted version doesn't reappear
      // on the next list (persistVersions only writes the SURVIVING set,
      // it doesn't know which file to remove).
      const slug = slugFromPath(projectPath ?? "");
      if (slug) {
        void deleteProjectVersion(slug, id).catch(() => false);
      }
    },
    [versions, persistVersions, projectPath],
  );

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    historyIndexRef.current = idx;
    lastPushedOutputRef.current = history[idx]; // avoid re-pushing on restore
    setIframeHtml(history[idx]);
  }, [canUndo, historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    historyIndexRef.current = idx;
    lastPushedOutputRef.current = history[idx];
    setIframeHtml(history[idx]);
  }, [canRedo, historyIndex, history]);

  // Keep the keyboard handler's undo/redo ref in sync with the latest
  // useCallback-stable functions. Cheaper than re-binding the listener.
  useEffect(() => {
    undoRedoRef.current = { undo: handleUndo, redo: handleRedo };
  }, [handleUndo, handleRedo]);

  // Switch to a different chat thread (or a brand-new one). The chat-load
  // useEffect already keys on activeThreadId; setting it triggers the
  // hydrate path (or empty-state for a fresh threadId).
  const handleSwitchThread = useCallback(
    (nextThreadId: string) => {
      if (!nextThreadId || nextThreadId === activeThreadId) return;
      setMessages([]);
      persistedTurnIdsRef.current = new Set();
      setActiveThreadId(nextThreadId);
      showToast(nextThreadId === "main" ? "Switched to main chat" : "Switched chat");
    },
    [activeThreadId, showToast],
  );

  const handleReload = useCallback(async () => {
    // Preserve the user's scroll position across the manual reload — the load
    // handler in the persistent-canvas effects above will restore it.
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      try {
        pendingScrollRestoreRef.current = iframe.contentWindow.scrollY;
      } catch {
        // strict sandbox → cross-origin frame; scroll position is unreadable.
      }
    }
    // Re-read the canonical file from disk before re-mounting the iframe.
    // Without this, the agent's Edit tool (or any out-of-band writer like
    // a code editor or git checkout) updates the disk while React state
    // still holds the old HTML — the user hits Refresh, the iframe key
    // bumps, but srcDoc is still the stale string we cached on first
    // hydrate. Repro 2026-05-08: user asked for a tweak, agent
    // confirmed the edit, file on disk had the new version, DF preview
    // kept showing the old. Opening the file from the OS file manager
    // (which reads disk directly) showed the new version.
    //
    // We mirror the boot hydration cascade: primary file → first .html
    // in the project folder → DB cache. The DB cache fallback is
    // exercised only when the bridge is offline; in that case the
    // refresh truly can't see fresh disk contents and we surface the
    // failure via the existing setSetting warn handler.
    if (projectId && projectPath) {
      let fromDisk: string | null = null;
      const primaryPath = `${projectPath.replace(/\/+$/, "")}/${projectFileName}`;
      try {
        const f = await readFileViaBridge(primaryPath);
        if (
          f &&
          typeof f === "object" &&
          "content" in f &&
          typeof (f as FsFile).content === "string"
        ) {
          fromDisk = (f as FsFile).content;
        }
      } catch {}
      if (!fromDisk) {
        try {
          const listing = await listFolder(projectPath);
          if (listing && !("error" in listing)) {
            const firstHtml = listing.entries.find((e) => !e.isDir && /\.html?$/i.test(e.name));
            if (firstHtml) {
              const f = await readFileViaBridge(firstHtml.path);
              if (
                f &&
                typeof f === "object" &&
                "content" in f &&
                typeof (f as FsFile).content === "string"
              ) {
                fromDisk = (f as FsFile).content;
              }
            }
          }
        } catch {}
      }
      if (fromDisk && fromDisk !== iframeHtml) {
        setIframeHtml(fromDisk);
        lastPushedOutputRef.current = fromDisk;
        void db.setSetting(`html:${projectId}`, fromDisk).catch(warn("setSetting:html:reload"));
      }
    }
    setIframeKey((k) => k + 1);
  }, [projectId, projectPath, projectFileName, iframeHtml]);

  // ─── Share menu — 3 unified options. ────────────────────────────
  // All toast strings and button labels are translated via useT / tf
  // so the menu follows the same i18n discipline as NewProject and
  // Settings.
  //
  // The older "HTML standalone" and "Download bundle" options have
  // collapsed into a single "Download .zip" — with the Project Files
  // registry shipping per-project folders (HTML + .df/ metadata +
  // assets), a single-file export no longer represents the project.
  // The zip of the whole folder is the canonical handoff. Daemon
  // endpoint: GET /projects/:slug/zip (see apps/daemon/src/index.mjs).

  const handleShareDownloadZip = useCallback(async () => {
    setShowExportMenu(false);
    if (!projectId) {
      showToast(t("editor.share.toast.no.project"));
      return;
    }
    // Fix (Bug 1, regression report): the daemon's
    // GET /projects/:slug/zip expects the *folder slug* (the basename of
    // projectPath, e.g. "gooey", "df-lp"). The frontend used to pass
    // `projectId` here — but projectId is a `crypto.randomUUID()` set in
    // useProjects.addProject(), unrelated to the folder name on disk. The
    // daemon then ran toLowerCase()+slug-normalize on the UUID and looked
    // up <repoRoot>/projects/<uuid>/, which never exists → 404 "project
    // not found". Use the folder slug derived from projectPath instead.
    const folderSlug = projectPath ? slugFromPath(projectPath) || "" : "";
    if (!folderSlug) {
      showToast(t("editor.share.toast.no.project"));
      return;
    }
    showToast(t("editor.share.toast.zip.preparing"));
    try {
      // Browser handles the streaming download via <a download> + GET URL.
      // Letting the daemon set Content-Disposition keeps the filename in
      // sync with the slug even if projectName drifts from the folder.
      const safe =
        projectName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "design";
      const url = `${BRIDGE_URL}/projects/${encodeURIComponent(folderSlug)}/zip`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
      showToast(t("editor.share.toast.zip.done"));
    } catch (e) {
      showToast(tf("editor.share.toast.zip.failed", String(e).slice(0, 60)));
    }
  }, [projectId, projectName, projectPath, showToast, t, tf]);

  // Active-tab-aware HTML download. Resolves the HTML for whichever
  // tab is currently active: the main preview tab uses iframeHtml +
  // projectFileName; a "file" tab with a .html path uses its loaded
  // fileContent + the basename. Other tabs (files gallery, terminal,
  // non-HTML file) return null and the menu hides the entry.
  const activeHtmlForDownload = useMemo<{ html: string; filename: string } | null>(() => {
    if (!currentTab) return null;
    if (currentTab.id === "main") {
      if (!iframeHtml) return null;
      return { html: iframeHtml, filename: projectFileName || "index.html" };
    }
    if (
      currentTab.kind === "file" &&
      currentTab.filePath &&
      currentTab.fileIsText &&
      /\.html?$/i.test(currentTab.filePath)
    ) {
      const html = currentTab.fileContent ?? "";
      if (!html) return null;
      const base = currentTab.filePath.split("/").filter(Boolean).pop() || "index.html";
      return { html, filename: base };
    }
    return null;
  }, [currentTab, iframeHtml, projectFileName]);

  const handleShareDownloadHtml = useCallback(() => {
    setShowExportMenu(false);
    if (!activeHtmlForDownload) {
      showToast(t("editor.share.toast.no.design"));
      return;
    }
    try {
      const blob = new Blob([activeHtmlForDownload.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = activeHtmlForDownload.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 100);
      showToast(t("editor.share.toast.html.done"));
    } catch (e) {
      showToast(tf("editor.share.toast.zip.failed", String(e).slice(0, 60)));
    }
  }, [activeHtmlForDownload, showToast, t, tf]);

  const handleShareSaveTemplate = useCallback(() => {
    setShowExportMenu(false);
    if (!iframeHtml) {
      showToast(t("editor.share.toast.no.design"));
      return;
    }
    try {
      const raw = localStorage.getItem("df:templates") || "[]";
      const arr = JSON.parse(raw) as Array<{
        id: string;
        name: string;
        html: string;
        createdAt: number;
      }>;
      arr.unshift({
        id: `tpl-${Date.now().toString(36)}`,
        name: projectName,
        html: iframeHtml,
        createdAt: Date.now(),
      });
      localStorage.setItem("df:templates", JSON.stringify(arr.slice(0, 50)));
      showToast(tf("editor.share.toast.template.saved", projectName));
    } catch (e) {
      showToast(tf("editor.share.toast.template.failed", String(e).slice(0, 60)));
    }
  }, [iframeHtml, projectName, showToast, t]);

  const handleShareDuplicate = useCallback(() => {
    setShowExportMenu(false);
    if (!onDuplicateProject) {
      showToast(t("editor.share.toast.duplicate.unavail"));
      return;
    }
    void onDuplicateProject(projectId);
    showToast(tf("editor.share.toast.duplicating", projectName));
  }, [onDuplicateProject, projectId, projectName, showToast, t]);

  // User ask 2026-05-21: "no compartilhar projeto tivesse uma opcao
  // de ver arquivo local, o q aconteceria se eu to por ssh?".
  //
  // The daemon runs server-side (Docker container, VPS, whatever). When
  // the user reaches the UI via SSH-forwarded browser, there is no
  // "local file" to open — the file lives in the remote filesystem.
  // The most useful affordance is therefore: copy the absolute project
  // path so the user can `cd <path>` from an SSH terminal, or use
  // their VS Code remote, or feed the path to any other tool. Toast
  // copy explains the SSH case so it's obvious why this isn't a
  // "Reveal in Finder" button.
  const handleShareCopyPath = useCallback(() => {
    setShowExportMenu(false);
    if (!projectPath) {
      showToast(t("editor.share.toast.no.project"));
      return;
    }
    const text = projectPath;
    const fallbackCopy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch {
        return false;
      }
    };
    const done = (ok: boolean) => {
      if (ok) showToast(`Caminho copiado: ${text}`);
      else showToast(`Não foi possível copiar. Caminho: ${text}`);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard
        .writeText(text)
        .then(() => done(true))
        .catch(() => done(fallbackCopy()));
    } else {
      done(fallbackCopy());
    }
  }, [projectPath, showToast, t]);

  // Reveal the project folder in the OS file manager. Daemon spawns
  // `open` (macOS) / `explorer` (Windows) / `xdg-open` (Linux) on the
  // resolved absolute path. Falls back to copying the path when the
  // bridge is unreachable or the opener errored — the user always has a
  // path to act on even when GUI integration breaks (SSH, headless).
  const handleShareOpenFolder = useCallback(async () => {
    setShowExportMenu(false);
    if (!projectPath) {
      showToast(t("editor.share.toast.no.project"));
      return;
    }
    const { openFolderViaBridge } = await import("@/lib/claude-bridge");
    const res = await openFolderViaBridge(projectPath);
    if ("error" in res) {
      showToast(`Não consegui abrir a pasta — ${res.error}. Caminho: ${projectPath}`);
      return;
    }
    showToast(`Abrindo ${res.opened}`);
  }, [projectPath, showToast, t]);

  // handlePublishSuccess + handleShareExportMp4 are not part of the
  // current public surface. Users publish manually via `vercel deploy`
  // in the terminal (CLI is already documented in
  // /docs/quickstart.md). MP4 was a disabled placeholder anyway.

  // Resolve which HTML the Tweaks flow should operate on. User ask
  // 2026-05-20: projects can be multi-doc + multi-html — Tweaks should
  // honour whichever HTML tab is active, not just the main preview.
  const tweaksHtmlSource = ():
    | null
    | { kind: "main"; html: string }
    | { kind: "file"; html: string; tabId: string; filePath: string } => {
    if (
      currentTab?.kind === "file" &&
      currentTab.fileIsText !== false &&
      typeof currentTab.fileContent === "string" &&
      /\.html?$/i.test(currentTab.filePath ?? "")
    ) {
      return {
        kind: "file",
        html: currentTab.fileContent,
        tabId: currentTab.id,
        filePath: currentTab.filePath!,
      };
    }
    if (iframeHtml) return { kind: "main", html: iframeHtml };
    return null;
  };

  const handleOpenTweaks = useCallback(() => {
    // Open the prompt panel unconditionally — the user may want to
    // describe an intent before generating any HTML. The submit handler
    // will surface a soft warning if there's nothing to tweak.
    setShowTweaksRequest((v) => !v);
  }, []);

  useEffect(() => {
    if (!showTweaksRequest) return;
    const onPointer = (e: PointerEvent) => {
      const anchor = tweaksAnchorRef.current;
      if (!anchor) return;
      if (anchor.contains(e.target as Node)) return;
      setShowTweaksRequest(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowTweaksRequest(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showTweaksRequest]);

  const handleGenerateTweaks = useCallback(async () => {
    const request = tweaksRequest.trim();
    setShowTweaksRequest(false);
    const source = tweaksHtmlSource();
    if (!source) {
      showToast(t("editor.toast.openHtmlFirst"));
      return;
    }
    setTweaksLoading(true);

    // Surface the tweaks request as a real chat message so the user
    // sees what's happening while it runs.
    const requestLabel = request || "all visual aspects";
    const tweaksTurnId = `t${Date.now()}`;
    const userMsg: ChatMessage = stamp({
      role: "user",
      text: `[tweaks] ${requestLabel}`,
      turn_id: tweaksTurnId,
    });
    setMessages((prev) => [...prev, userMsg]);
    if (projectId) db.saveMessage(projectId, "user", userMsg.text, false).catch(() => {});

    const placeholderIdx = Date.now();
    const placeholder: ChatMessage = stamp({
      role: "assistant",
      provider: selectedProvider,
      model: selectedModel,
      text: `Analyzing design and generating tweak controls...`,
      turn_id: tweaksTurnId,
    });
    setMessages((prev) => [...prev, placeholder]);
    setChatTab("chat");

    const prompt = buildTweaksPrompt(request, source.html);
    // Honor user override for the tweaks system prompt (Settings → Built-in
    // prompts). Falls back to TWEAKS_SYSTEM_PROMPT when no override is set.
    const tweaksSystem = await getBuiltinPrompt("tweaks", TWEAKS_SYSTEM_PROMPT);
    let accumulated = "";
    let cancelled = false;
    try {
      await new Promise<void>((resolve) => {
        // Route Tweaks through the active provider — pre-fix was hard-coded
        // to streamClaude regardless of selectedProvider, so Tweaks always
        // hit /claude/stream even when the user had Codex/Kimi/Gemini
        // selected. Symptom: header said "Codex" but request bombed in
        // claude (quota / auth) and DF was stuck on "Analyzing…" forever.
        // User audit 2026-05-20.
        const maybeUnlisten = spawnStream(
          "tweaks",
          prompt,
          tweaksSystem,
          {
            onText: (t) => {
              accumulated += t;
              // Live progress in the placeholder message (truncated)
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && last.text.startsWith("Analyzing")) {
                  next[next.length - 1] = {
                    ...last,
                    text: `Analyzing design and generating tweak controls... (~${Math.round(accumulated.length / 4).toLocaleString()} tokens)`,
                  };
                }
                return next;
              });
            },
            onDone: () => {
              tweaksAbortRef.current = null;
              resolve();
            },
            onError: (err) => {
              tweaksAbortRef.current = null;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && last.text.startsWith("Analyzing")) {
                  next[next.length - 1] = { ...last, text: `[error] ${err}` };
                }
                return next;
              });
              resolve();
            },
          },
          {
            providerId: selectedProvider,
            model: selectedModel,
            cwd: workspaceRoot ?? projectPath ?? undefined,
          },
        );
        // spawnStream returns Promise<UnlistenFn>. Wire the abort into the
        // ref once the stream is actually listening.
        void maybeUnlisten.then((unlisten) => {
          tweaksAbortRef.current = () => {
            cancelled = true;
            try {
              unlisten();
            } catch {}
            tweaksAbortRef.current = null;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last.text.startsWith("Analyzing")) {
                next[next.length - 1] = { ...last, text: "Tweaks cancelled." };
              }
              return next;
            });
            resolve();
          };
        });
      });
      if (cancelled) {
        return;
      }
      void placeholderIdx; // unused aside from distinct identity above

      const cfg = parseTweaksResponse(accumulated);
      if (!cfg) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.text.startsWith("Analyzing")) {
            next[next.length - 1] = {
              ...last,
              text: `Tweaks generation failed — Claude response wasn't valid JSON. Try a more focused request.`,
            };
          }
          return next;
        });
        return;
      }

      if (source.kind === "main") {
        setIframeHtml(cfg.refactoredHtml);
        setHistory((prev) => {
          const idx = historyIndexRef.current;
          const base = idx >= 0 ? prev.slice(0, idx + 1) : [];
          const next = [...base, cfg.refactoredHtml];
          historyIndexRef.current = next.length - 1;
          setHistoryIndex(next.length - 1);
          return next;
        });
        lastPushedOutputRef.current = cfg.refactoredHtml;
        if (projectId) {
          db.setSetting(`html:${projectId}`, cfg.refactoredHtml).catch(
            warn("setSetting:html::projectId"),
          );
        }
      } else {
        // File-tab Tweaks — write to disk + update the file tab's content so
        // FileView re-renders with the new HTML. Don't touch the canonical
        // iframeHtml / project history — those belong to the main preview.
        try {
          await writeFile(source.filePath, cfg.refactoredHtml);
        } catch (e) {
          warn("writeFile:tweaks-file-tab")(e);
        }
        setCanvasTabs((prev) =>
          prev.map((t) =>
            t.id === source.tabId ? { ...t, fileContent: cfg.refactoredHtml, fileIsText: true } : t,
          ),
        );
      }

      const readyMsg = cfg.summary
        ? `Tweaks panel ready — ${cfg.summary} Panel lives in the bottom-right of the preview.`
        : `Tweaks panel ready. Controls live in the bottom-right of the preview; adjust them directly there.`;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.text.startsWith("Analyzing")) {
          next[next.length - 1] = { ...last, text: readyMsg };
        }
        return next;
      });
      if (projectId) db.saveMessage(projectId, "assistant", readyMsg, false).catch(() => {});
    } catch (e) {
      showToast(`Tweaks failed: ${String(e).slice(0, 80)}`);
    } finally {
      setTweaksLoading(false);
      setTweaksRequest("");
    }
  }, [tweaksRequest, iframeHtml, currentTab, selectedModel, projectId, showToast]);

  const handleCanvasClick = useCallback(() => {
    // Now handled by the injected iframe listener (sets commentTarget + opens popup).
    // This wrapper-level click is kept as no-op for non-iframe clicks in the stage.
  }, []);

  const handleSaveComment = useCallback(() => {
    const text = commentDraft.trim();
    if (!text) {
      setShowCommentInput(false);
      setCommentTarget(null);
      return;
    }
    const next: Comment = {
      id: crypto.randomUUID(),
      selector: commentTarget?.selector ?? "body",
      snippet: commentTarget?.snippet ?? "",
      text,
      createdAt: Date.now(),
      sent: false,
    };
    persistComments([...comments, next]);
    setCommentDraft("");
    setCommentTarget(null);
    setShowCommentInput(false);
    setChatTab("comments");
    showToast(`Comment pinned · ${comments.length + 1} queued`);
  }, [commentDraft, commentTarget, comments, persistComments, showToast]);

  /** Scroll iframe preview to the commented element and pulse-outline it briefly. */
  const handleJumpToComment = useCallback(
    (c: Comment) => {
      if (!iframeRef.current) return;
      try {
        const doc = iframeRef.current.contentDocument;
        if (!doc) return;
        const el = doc.querySelector(c.selector) as HTMLElement | null;
        if (!el) {
          showToast(t("editor.toast.elementNotFound"));
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash: inject a short-lived outline class
        const key = `__df-jump-${Date.now()}`;
        el.setAttribute("data-df-jump", key);
        const style = doc.createElement("style");
        style.textContent = `[data-df-jump="${key}"] {
        outline: 3px solid #5faa54 !important;
        outline-offset: 3px !important;
        transition: outline-color 800ms ease;
      }`;
        doc.head.appendChild(style);
        window.setTimeout(() => {
          try {
            el.removeAttribute("data-df-jump");
            style.remove();
          } catch {}
        }, 1400);
      } catch {}
    },
    [showToast],
  );

  const handleSaveEditedComment = useCallback(
    (id: string) => {
      const text = editingCommentDraft.trim();
      if (!text) {
        setEditingCommentId(null);
        return;
      }
      setComments((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, text, sent: false } : c));
        persistComments(next);
        return next;
      });
      setEditingCommentId(null);
      setEditingCommentDraft("");
    },
    [editingCommentDraft, persistComments],
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      persistComments(comments.filter((c) => c.id !== id));
    },
    [comments, persistComments],
  );

  const sendCommentBatch = useCallback(
    async (toSend: Comment[]) => {
      if (!iframeHtml || toSend.length === 0) return;
      const instruction =
        toSend.length === 1
          ? `Apply this comment. Target element: ${toSend[0].selector}\nComment: ${toSend[0].text}`
          : [
              "Apply these comments to the HTML. Each comment targets a specific element via CSS selector.",
              "",
              ...toSend.map((c, i) => `${i + 1}. Selector: ${c.selector}\n   Comment: ${c.text}`),
            ].join("\n");
      // Mark these as sent
      const sentIds = new Set(toSend.map((c) => c.id));
      persistComments(comments.map((c) => (sentIds.has(c.id) ? { ...c, sent: true } : c)));
      setChatTab("chat");

      // User repro 2026-05-08: comment batch was applied but the chat
      // showed nothing — patch path only stamped a terminal assistant note,
      // applyStyle fallback streamed into limbo, and neither created the
      // user-side bubble that would let the user see what they sent.
      // Without that bubble the chat history reads as a stray AI line
      // ("mensagem cortada"). Here we mirror handleSend's setup: stamp
      // a user message that summarises the batch, push an assistant
      // streaming placeholder (turn_id-paired), and persist the user
      // turn through the same durable layer the audit Fase 1 wired up.
      const turnId = `tcomm-${Date.now().toString(36)}`;
      const visibleText =
        toSend.length === 1
          ? `Aplicar comentário · ${toSend[0].text.slice(0, 80)}`
          : `Aplicar ${toSend.length} comentários ao design`;
      setMessages((prev) => [
        ...prev,
        stamp({ role: "user", text: visibleText, turn_id: turnId, persist_status: "saving" }),
        stamp({
          role: "assistant",
          provider: selectedProvider,
          model: selectedModel,
          text: "",
          streaming: true,
          turn_id: turnId,
        }),
      ]);
      // Auditor follow-up to PR #115 (P0.1): the previous version
      // used a fire-and-forget call wrapped in `if (projectSlug)`,
      // which was wrong on two axes — the user bubble could appear
      // before any durable write (fire-and-forget = no await), and
      // projectSlug==null bypassed persistence entirely (the helper
      // already handles null slug by going straight to local recovery).
      // Both contracts (Audit Fase 1 #4 turn-before-provider +
      // Fase 1 #5 recovery-on-no-slug) were leaking on this path.
      //
      // Fix: await the helper (so the provider stream doesn't fire before
      // the turn is durable somewhere), and pass slug as nullable so the
      // helper's no-slug → recovery branch kicks in for projects that
      // haven't been hydrated yet. surfaceError already covers the failed
      // path inside persistInitialTurn-style helpers; we mirror the chat
      // path's badge semantics for parity.
      const persistResult = await persistOrRecoverTurn(
        projectSlug ?? null,
        projectId ?? null,
        activeThreadId,
        {
          id: turnId,
          ts: Date.now(),
          user: { text: visibleText, attachments: [], verb: null },
          ai: null,
        },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "user" && m.turn_id === turnId
            ? { ...m, persist_status: persistResult.status }
            : m,
        ),
      );
      if (persistResult.status === "failed") {
        surfaceError(
          new Error(
            `comment batch turn ${turnId} could not be persisted (${persistResult.reason ?? "unknown"})`,
          ),
          "sendCommentBatch[persist]",
          "error",
        );
      }

      const ctx = {
        projectId,
        projectPath: projectPath || "~/design-factory/projeto",
        primaryFile: projectFileName,
        mode,
        conversationHistory: [],
        hasDesignSystem: Boolean(dsPath),
        designSystemPath: dsPath,
        designSystemName: dsName,
        designSystemMarkdown: dsMarkdown,
        cwd: workspaceRoot ?? projectPath ?? undefined,
        currentHtml: iframeHtml,
        model: selectedModel,
        providerId: selectedProvider,
        sessionId: selectedProvider === "claude" ? claudeSessionId : null,
      };

      // Fix (Bug 2, regression report): "qnd usei comments e
      // patch ele duplicou o conteudo no mesmo html inves de editar". Old
      // path went straight to `applyStyle` (full-regen via REFINE_SYSTEM),
      // which asks the LLM to emit the FULL modified HTML. With long docs
      // the model occasionally APPENDS instead of REPLACES — the section
      // it changed lands at the end while the original survives intact,
      // doubling the visible content. The chat-path (handleSend) already
      // mitigates this by trying `invokeSearchReplaceEdit` (small JSON
      // search/replace patches) first, then falling back to applyStyle
      // only when no patches fit. We mirror that here so comment-mode
      // edits are surgical when possible.
      try {
        setManualBusy("patching...");
        const patchResp = await invokeSearchReplaceEdit(instruction, ctx).catch(() => null);
        setManualBusy(null);
        const applied =
          patchResp && patchResp.patches.length > 0
            ? applyPatches(iframeHtml, patchResp.patches)
            : null;
        if (applied && "applied" in applied && applied.html) {
          // Successful patch — update iframe + history + persist, identical
          // to handleSend's patch branch. Skips the full applyStyle stream.
          setIframeContent({
            html: applied.html,
            mode: "patch",
            patches: patchResp!.patches,
          });
          setHistory((prev) => {
            const idx = historyIndexRef.current;
            const base = idx >= 0 ? prev.slice(0, idx + 1) : [];
            const next = [...base, applied.html];
            historyIndexRef.current = next.length - 1;
            setHistoryIndex(next.length - 1);
            return next;
          });
          lastPushedOutputRef.current = applied.html;
          if (projectId) {
            db.setSetting(`html:${projectId}`, applied.html).catch(
              warn("setSetting:html::projectId"),
            );
          }
          if (projectPath) {
            // BUG-31: persist to projectFileName, not {slug}.html (see the
            // search-replace path) — avoids the duplicate ghost HTML when the
            // project name and folder slug differ.
            const filePath = `${projectPath.replace(/\/$/, "")}/${projectFileName}`;
            writeFile(filePath, applied.html).catch((e) => {
              console.warn("[comment-patch] failed to persist to disk", filePath, e);
            });
          }
          const summary =
            patchResp!.summary ||
            `Applied ${applied.applied} patch(es) to ${toSend.length} comment(s)`;
          const note = `Comments resolvidos · ${summary}`;
          // Replace the streaming assistant placeholder with the resolved
          // note in-place — keeping the same turn_id pairs the assistant
          // bubble with the user bubble we stamped at the top of the
          // function. Without this the bubble would either stay empty
          // ("Thinking…") forever or the new note would land as a
          // separate orphan assistant entry.
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant" && m.turn_id === turnId
                ? { ...m, text: note, streaming: false }
                : m,
            ),
          );
          if (projectId) {
            db.saveMessage(projectId, "assistant", note, false).catch(
              warn("saveMessage:comment-patch"),
            );
          }
          return;
        }
      } catch (e) {
        setManualBusy(null);
        console.warn("[comment-patch] patch path threw, falling back to applyStyle", e);
      }

      // Fallback: full-regen via applyStyle (legacy behavior).
      await applyStyle(instruction, ctx, {
        onSession: (sid: string) => {
          persistProviderSession(sid);
          setAuthRequiredBanner(null);
          if (projectId) {
            db.setProjectSession(projectId, sid).catch(() => {});
            db.logSession(projectId, sid, workspaceRoot ?? undefined).catch(() => {});
          }
        },
        onAuthRequired: (detail: string) => setAuthRequiredBanner(detail),
      });
    },
    [
      iframeHtml,
      comments,
      persistComments,
      applyStyle,
      projectId,
      projectPath,
      projectFileName,
      mode,
      dsPath,
      dsName,
      dsMarkdown,
      startMode,
      workspaceRoot,
      selectedModel,
      selectedProvider,
      claudeSessionId,
      persistProviderSession,
      setIframeContent,
    ],
  );

  const handleSendComments = useCallback(async () => {
    await sendCommentBatch(comments.filter((c) => !c.sent));
  }, [sendCommentBatch, comments]);

  const handleSendOneComment = useCallback(
    async (id: string) => {
      const c = comments.find((x) => x.id === id);
      if (!c || c.sent) return;
      await sendCommentBatch([c]);
    },
    [sendCommentBatch, comments],
  );

  const handleClearSentComments = useCallback(() => {
    persistComments(comments.filter((c) => !c.sent));
  }, [comments, persistComments]);

  const handlePaletteAction = useCallback(
    (id: string) => {
      setShowCmdPalette(false);
      switch (id) {
        case "generate":
          setInput("Generate a base design for ");
          textareaRef.current?.focus();
          break;
        case "style":
          if (!iframeHtml) {
            showToast(t("editor.toast.generateFirst"));
            return;
          }
          setInput("Apply style: ");
          textareaRef.current?.focus();
          break;
        case "component":
          if (!iframeHtml) {
            showToast(t("editor.toast.generateFirst"));
            return;
          }
          setInput("Add component: ");
          textareaRef.current?.focus();
          break;
        case "export":
          setShowExportMenu(true);
          break;
        case "undo":
          handleUndo();
          break;
        case "redo":
          handleRedo();
          break;
      }
    },
    [iframeHtml, handleUndo, handleRedo, showToast],
  );

  const hasContent = messages.length > 0 || status === "streaming";

  // User QA 2026-05-15: "nem aparece o loader" during the first
  // prompt. Root cause — `status === "streaming"` only flips on once
  // `runStream` is invoked. In between submit and the stream actually
  // starting (provider spawn, prompt compose, network round-trip)
  // there's a measurable gap where the canvas would render its empty
  // state. Bridge: detect the in-flight assistant message in the
  // chat (handleSend appends `{ role: "assistant", streaming: true }`
  // synchronously) so the loader fires the moment the user clicks
  // send, regardless of how slow the stream is to actually open.
  const isProcessingTurn = useMemo(() => {
    if (status === "streaming" || tweaksLoading || manualBusy) return true;
    if (messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return !!(last && last.role === "assistant" && last.streaming);
  }, [status, tweaksLoading, manualBusy, messages]);

  // ─── Rich turn telemetry ────────────────────────────────────────────────
  // Provider parity for in-flight feedback. useClaude only updates its
  // counters during legacy `runStream` (claude-only). V2 (sendUserTurn —
  // Kimi/Codex/Gemini/OpenRouter/…) leaves the legacy counters frozen, so
  // user repro 2026-05-20: "fica dizendo só Iniciando ou Criando código
  // sem mostrar nada de processamento, tempo, tokens".
  //
  // Derive everything from messages[last] + a wall-clock tick. Works
  // identically for every provider — anchored on the streaming flag set by
  // handleSend.
  const [turnElapsedMs, setTurnElapsedMs] = useState(0);
  useEffect(() => {
    if (!isProcessingTurn) {
      setTurnElapsedMs(0);
      return;
    }
    const start = Date.now();
    setTurnElapsedMs(0);
    const id = window.setInterval(() => setTurnElapsedMs(Date.now() - start), 500);
    return () => window.clearInterval(id);
  }, [isProcessingTurn]);

  const turnStats = useMemo(() => {
    if (!isProcessingTurn) return null;
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    const text = last.text ?? "";
    const tokens = text.length > 0 ? Math.round(text.length / 4) : 0;
    const tools = last.tools ?? [];
    const completed = tools.filter((tool) => tool.result).length;
    // Live text excerpt — last ~80 chars stripped of fences for the
    // unobtrusive preview line under the status label.
    const trimmed = text
      .trim()
      .replace(/^```[\s\S]*?\n/, "")
      .replace(/```$/, "");
    const previewSource = trimmed.slice(-110).replace(/\s+/g, " ").trim();
    return {
      tokens,
      toolsTotal: tools.length,
      toolsCompleted: completed,
      preview: previewSource,
      provider: last.provider ?? null,
      model: last.model ?? null,
    };
  }, [isProcessingTurn, messages]);

  // Auto-refresh the Files gallery whenever the agent completes a tool call
  // (Write/Edit/Bash/etc may have written files) and whenever a streaming
  // turn ends. User ask 2026-05-20: "auto-refresh do Files quando agente
  // escreve arquivo novo".
  const lastAssistantToolCount = useMemo(() => {
    if (messages.length === 0) return 0;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return 0;
    return (last.tools ?? []).filter((tool) => tool.result).length;
  }, [messages]);
  useEffect(() => {
    bumpFilesRefresh();
  }, [lastAssistantToolCount, status, bumpFilesRefresh]);

  // Filesystem activity poller — runs only while a turn is in flight.
  // Polls the project folder every 2.5s and surfaces the most recently
  // mutated HTML/SVG/asset filename as `lastWrittenFile`. This closes the
  // status-feedback gap for non-Claude CLIs (Kimi/Codex/Gemini) that
  // write files but don't emit tool events DF can parse. User ask
  // 2026-05-20: "vamos pensar nisso… melhorar esses status a partir de
  // logs". State declaration lives above canvasStatusLabel (so the memo
  // can read it).
  useEffect(() => {
    if (!isProcessingTurn || !projectPath) {
      // Clear the marker when the turn finishes — stale info from a
      // previous turn shouldn't bleed into the next status banner.
      setLastWrittenFile(null);
      return;
    }
    let cancelled = false;
    let baseline: Record<string, number> = {};
    let firstPass = true;
    const poll = async () => {
      try {
        const data = await listFolder(projectPath);
        if (cancelled || !data || "error" in data) return;
        const current: Record<string, number> = {};
        for (const e of data.entries) {
          if (!e.isDir) current[e.path] = e.mtime;
        }
        if (firstPass) {
          baseline = current;
          firstPass = false;
          return;
        }
        // Find the file whose mtime is newer than its baseline (or didn't
        // exist before). Pick the most recently touched one for display.
        let newest: { name: string; ts: number } | null = null;
        for (const [path, mtime] of Object.entries(current)) {
          const prev = baseline[path];
          if (prev === undefined || mtime > prev) {
            const leaf = path.split("/").pop() ?? path;
            if (!newest || mtime > newest.ts) newest = { name: leaf, ts: mtime };
          }
        }
        if (newest) setLastWrittenFile(newest);
        baseline = current;
      } catch {
        /* swallow — polling is best-effort */
      }
    };
    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isProcessingTurn, projectPath]);

  // F3.3 — Inline flash when a file is written. The poller above already
  // surfaces the most-recently-mutated file name; this effect catches
  // changes to that and pushes a transient "X.html escrito" toast that
  // self-dismisses after 3s. Helps the user see the factory work
  // landing on disk in real-time, not just inside the status banner.
  const [recentWriteFlash, setRecentWriteFlash] = useState<{ name: string; at: number } | null>(
    null,
  );
  const lastFlashedFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastWrittenFile) {
      lastFlashedFileRef.current = null;
      return;
    }
    if (lastFlashedFileRef.current === lastWrittenFile.name) return;
    lastFlashedFileRef.current = lastWrittenFile.name;
    setRecentWriteFlash({ name: lastWrittenFile.name, at: Date.now() });
    const id = window.setTimeout(() => setRecentWriteFlash(null), 3000);
    return () => window.clearTimeout(id);
  }, [lastWrittenFile]);

  return (
    <div className="screen" data-active="true">
      {/* Auth + missing-path banners. Both render unconditionally at the top
          so they're readable regardless of which pane the user is in.
          Each has a compact dismiss in the corner. */}
      {authRequiredBanner && (
        <div
          role="alert"
          style={{
            padding: "8px 16px",
            background: "#f0a500",
            color: "#1a1a1a",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
          }}
        >
          <span>
            <strong>Claude CLI not authenticated.</strong> {authRequiredBanner}{" "}
            <a
              href="https://code.claude.com/docs/en/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1a1a1a", textDecoration: "underline" }}
            >
              docs
            </a>
          </span>
          <button
            onClick={() => setAuthRequiredBanner(null)}
            aria-label="Dismiss auth banner"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 4px",
              color: "#1a1a1a",
            }}
          >
            ×
          </button>
        </div>
      )}
      {missingPathBanner && (
        <div
          role="alert"
          style={{
            padding: "8px 16px",
            background: "#cc3a3a",
            color: "#fff",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
          }}
        >
          <span>
            <strong>Project path not found:</strong> {missingPathBanner}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={async () => {
                const { openFolderDialog } = await import("@/lib/claude-bridge");
                const newPath = await openFolderDialog();
                if (newPath && projectId) {
                  await db.updateProject(projectId, { path: newPath }).catch(() => {});
                  setMissingPathBanner(null);
                }
              }}
              style={{
                background: "#fff",
                color: "#1a1a1a",
                border: "none",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Browse…
            </button>
            <button
              onClick={() => setMissingPathBanner(null)}
              aria-label="Dismiss missing path banner"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                padding: "0 4px",
                color: "#fff",
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="editor">
        {/* TOPBAR */}
        <header
          className="editor-topbar"
          style={{ gridTemplateColumns: `${chatWidth}px 1fr auto` }}
        >
          <div className="topbar-floor" />

          {/* LEFT — home + chat tabs */}
          <div className="topbar-left">
            <button
              className="topbar-home"
              title={t("editor.tooltip.allProjects")}
              onClick={onHome}
            >
              <Logo size={16} />
            </button>
            <nav className="topbar-chat-tabs">
              {(["chat", "comments"] as const).map((tab) => (
                <button
                  key={tab}
                  className="topbar-chat-tab"
                  aria-selected={chatTab === tab}
                  onClick={() => setChatTab(tab)}
                >
                  {chatTab === tab && (
                    <>
                      <TabCornerLeft outerColor="var(--df-bg-section)" />
                      <TabCornerRight outerColor="var(--df-bg-section)" />
                    </>
                  )}
                  {tab === "chat" ? "Chat" : "Comments"}
                </button>
              ))}
            </nav>
            {/* Thread switcher removed in Phase D — one chat per project. */}
          </div>

          {/* CENTER — file tabs */}
          <div className="topbar-center">
            {canvasTabs.map((t) => {
              const active = activeCanvasTab === t.id;
              return (
                <div
                  key={t.id}
                  className="topbar-file-tab"
                  aria-selected={active}
                  onClick={() => setActiveCanvasTab(t.id)}
                  style={{ cursor: "pointer" }}
                >
                  {active && (
                    <>
                      <TabCornerLeft outerColor="var(--df-bg-base)" />
                      <TabCornerRight outerColor="var(--df-bg-base)" />
                    </>
                  )}
                  {t.kind === "terminal" ? (
                    <svg
                      className="topbar-file-tab-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  ) : t.kind === "video" ? (
                    <svg
                      className="topbar-file-tab-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m22 8-6 4 6 4V8Z" />
                      <rect x="2" y="6" width="14" height="12" rx="2" />
                    </svg>
                  ) : (
                    <svg
                      className="topbar-file-tab-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                  <span className="topbar-file-tab-name">{t.name}</span>
                  <button
                    className="topbar-file-tab-close"
                    aria-label="Close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeCanvasTab(t.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* RIGHT — Agent picker + Share menu + theme toggle + avatar.
              ThemeToggle has a fixed position in every screen — right of all
              utility actions, immediately before the avatar. */}
          <div className="topbar-right">
            {/* Provider picker stays on the topbar (user ask 2026-05-21:
                "o provider tava bom na topbar"). Only Model + DS moved
                to the chat input bar. */}
            <AgentPicker />
            {/* The "Fresh" button is intentionally absent here.
                clearProviderSession() lives in @/lib/provider-sessions
                and can be re-exposed via Settings or a command
                palette action when a clearer surface for it is
                decided. */}
            <div style={{ position: "relative" }}>
              <button
                className="df-btn df-btn--primary"
                title={t("editor.share.button.title")}
                onClick={() => setShowExportMenu((v) => !v)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                {t("editor.share.button")}
                <svg
                  className="btn-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    width: 10,
                    height: 10,
                    opacity: 0.7,
                    transform: showExportMenu ? "rotate(180deg)" : "none",
                    transition: "transform 120ms ease",
                  }}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {showExportMenu && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 99 }}
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      minWidth: 260,
                      background: "var(--df-surface-elevated)",
                      borderRadius: "var(--df-r-lg)",
                      boxShadow: "var(--df-shadow-card)",
                      overflow: "hidden",
                      zIndex: 100,
                      animation: "df-dropdown-fade 120ms ease-out",
                    }}
                  >
                    {/* Share menu items. HTML standalone surfaces only
                        when the active canvas tab is an HTML file
                        (main preview or a .html file tab). Sub-line
                        descriptions were dropped on user ask
                        2026-05-22 — labels stand on their own. */}
                    {[
                      ...(activeHtmlForDownload
                        ? [
                            {
                              id: "html",
                              label: t("editor.share.html.label"),
                              handler: handleShareDownloadHtml,
                              disabled: false,
                              icon: (
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                              ),
                            },
                          ]
                        : []),
                      {
                        id: "zip",
                        label: t("editor.share.zip.label"),
                        handler: handleShareDownloadZip,
                        disabled: false,
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 8v13H3V8" />
                            <path d="M1 3h22v5H1z" />
                            <path d="M10 12h4" />
                          </svg>
                        ),
                      },
                      {
                        id: "template",
                        label: t("editor.share.template.label"),
                        handler: handleShareSaveTemplate,
                        disabled: false,
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                          </svg>
                        ),
                      },
                      {
                        id: "duplicate",
                        label: t("editor.share.duplicate.label"),
                        handler: handleShareDuplicate,
                        disabled: false,
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                        ),
                      },
                      {
                        id: "openfolder",
                        label: "Abrir pasta do projeto",
                        handler: handleShareOpenFolder,
                        disabled: !projectPath,
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
                          </svg>
                        ),
                      },
                      {
                        id: "copypath",
                        label: "Copiar caminho do projeto",
                        handler: handleShareCopyPath,
                        disabled: !projectPath,
                        icon: (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        ),
                      },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={opt.handler}
                        disabled={opt.disabled}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "24px 1fr",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "10px 14px",
                          background: "none",
                          border: "none",
                          color: "var(--df-text-primary)",
                          fontSize: "var(--df-text-sm)",
                          cursor: opt.disabled ? "not-allowed" : "pointer",
                          textAlign: "left",
                          opacity: opt.disabled ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!opt.disabled)
                            e.currentTarget.style.background = "var(--df-interactive-hover)";
                        }}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                      >
                        <span
                          style={{
                            display: "grid",
                            placeItems: "center",
                            color: "var(--df-text-muted)",
                          }}
                        >
                          {opt.icon}
                        </span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {theme && onThemeChange && <ThemeToggle theme={theme} onChange={onThemeChange} />}
            <button
              className="editor-avatar"
              title={t("editor.tooltip.settings")}
              onClick={onOpenSettings}
              style={{ cursor: onOpenSettings ? "pointer" : "default" }}
            >
              N
            </button>
          </div>
        </header>

        {/* BODY */}
        <div className="editor-body" style={{ gridTemplateColumns: `${chatWidth}px 1fr` }}>
          {/* SIDEBAR */}
          <aside className="editor-sidebar">
            {/* Edge drag — invisible 6px strip on the right border. Uses pointer
                events + setPointerCapture so mouseup-outside-window never leaves
                a stale listener (which used to cause hover-still-moves bug). */}
            <div
              onPointerDown={(e) => {
                if (e.button !== 0) return; // left button only
                const target = e.currentTarget;
                target.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const startW = chatWidthRef.current;
                document.body.style.userSelect = "none";
                document.body.style.cursor = "col-resize";
                const onMove = (ev: PointerEvent) => {
                  if (ev.pointerId !== e.pointerId) return;
                  const next = Math.max(
                    CHAT_MIN,
                    Math.min(CHAT_MAX, startW + (ev.clientX - startX)),
                  );
                  setChatWidth(next);
                };
                const finish = () => {
                  target.removeEventListener("pointermove", onMove);
                  target.removeEventListener("pointerup", finish);
                  target.removeEventListener("pointercancel", finish);
                  target.removeEventListener("lostpointercapture", finish);
                  try {
                    target.releasePointerCapture(e.pointerId);
                  } catch {}
                  document.body.style.userSelect = "";
                  document.body.style.cursor = "";
                  try {
                    localStorage.setItem("df-chat-width", String(chatWidthRef.current));
                  } catch {}
                };
                target.addEventListener("pointermove", onMove);
                target.addEventListener("pointerup", finish);
                target.addEventListener("pointercancel", finish);
                target.addEventListener("lostpointercapture", finish);
              }}
              style={{
                position: "absolute",
                top: 0,
                right: -3,
                bottom: 0,
                width: 6,
                cursor: "col-resize",
                zIndex: 20,
                background: "transparent",
                touchAction: "none",
              }}
              aria-label="Resize chat column"
            />
            {/* Chat history button — floats top-right of the chat panel,
                independent of which sub-view (chat / comments) is active. */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 14,
                zIndex: 1200,
              }}
            >
              <ChatHistoryDropdown
                projectSlug={projectSlug ?? ""}
                activeThreadId={activeThreadId}
                onSwitch={handleSwitchThread}
              />
            </div>
            {chatTab === "comments" ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "72px var(--df-sp-4) var(--df-sp-4)",
                  }}
                >
                  {comments.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "var(--df-sp-6) var(--df-sp-2)" }}>
                      <div
                        style={{
                          color: "var(--df-text-secondary)",
                          fontSize: "var(--df-text-sm)",
                          marginBottom: 4,
                        }}
                      >
                        No comments yet
                      </div>
                      <div
                        style={{
                          color: "var(--df-text-faint)",
                          fontSize: "var(--df-text-xs)",
                          lineHeight: 1.5,
                        }}
                      >
                        Switch to Comment mode in the canvas toolbar, then click any element in the
                        preview to pin a note.
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: "var(--df-sp-3)" }}
                    >
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "10px 12px 44px 12px",
                            background: "var(--df-surface-raised)",
                            border: `1px solid ${c.sent ? "var(--df-border-subtle)" : "var(--df-border-strong)"}`,
                            borderRadius: "var(--df-r-md)",
                            opacity: c.sent ? 0.55 : 1,
                            position: "relative",
                          }}
                        >
                          <button
                            onClick={() => handleJumpToComment(c)}
                            title="Jump to element in preview"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              width: "100%",
                              textAlign: "left",
                              padding: 0,
                              marginBottom: 4,
                              marginRight: 24,
                              background: "transparent",
                              border: "none",
                              fontFamily: "var(--df-font-mono)",
                              fontSize: "var(--df-text-xs)",
                              color: "var(--df-text-faint)",
                              cursor: "pointer",
                              overflow: "hidden",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color = "var(--df-text-muted)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "var(--df-text-faint)")
                            }
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              style={{ flexShrink: 0 }}
                            >
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                            </svg>
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.selector}
                            </span>
                            {c.sent && (
                              <span style={{ marginLeft: 4, color: "var(--df-text-faint)" }}>
                                · sent
                              </span>
                            )}
                          </button>
                          {editingCommentId === c.id ? (
                            <textarea
                              autoFocus
                              value={editingCommentDraft}
                              onChange={(e) => setEditingCommentDraft(e.target.value)}
                              onBlur={() => handleSaveEditedComment(c.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                                  handleSaveEditedComment(c.id);
                                if (e.key === "Escape") {
                                  setEditingCommentId(null);
                                  setEditingCommentDraft("");
                                }
                              }}
                              style={{
                                width: "100%",
                                minHeight: 48,
                                padding: 6,
                                background: "var(--df-bg-base)",
                                border: "1px solid var(--df-border-subtle)",
                                borderRadius: "var(--df-r-sm)",
                                color: "var(--df-text-primary)",
                                fontSize: "var(--df-text-sm)",
                                fontFamily: "inherit",
                                lineHeight: 1.4,
                                resize: "vertical",
                              }}
                            />
                          ) : (
                            <div
                              onClick={() => {
                                setEditingCommentId(c.id);
                                setEditingCommentDraft(c.text);
                              }}
                              title="Click to edit"
                              style={{
                                fontSize: "var(--df-text-sm)",
                                color: "var(--df-text-primary)",
                                lineHeight: 1.4,
                                cursor: "text",
                                minHeight: 20,
                              }}
                            >
                              {c.text}
                            </div>
                          )}
                          <button
                            onClick={() => handleDeleteComment(c.id)}
                            title="Delete comment"
                            style={{
                              position: "absolute",
                              top: 6,
                              right: 6,
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              background: "transparent",
                              border: "none",
                              color: "var(--df-text-faint)",
                              fontSize: 14,
                              cursor: "pointer",
                            }}
                          >
                            ×
                          </button>
                          {!c.sent && (
                            <button
                              onClick={() => handleSendOneComment(c.id)}
                              disabled={status === "streaming"}
                              title="Send this comment to Claude"
                              style={{
                                position: "absolute",
                                right: 10,
                                bottom: 8,
                                padding: "4px 10px",
                                fontSize: "var(--df-text-xs)",
                                fontFamily: "var(--df-font-mono)",
                                background: "var(--df-text-primary)",
                                color: "var(--df-bg-base)",
                                border: "none",
                                borderRadius: "var(--df-r-sm)",
                                cursor: status === "streaming" ? "not-allowed" : "pointer",
                                opacity: status === "streaming" ? 0.4 : 1,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              Send
                              <svg
                                width="9"
                                height="9"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m5 12 14 0" />
                                <path d="m13 6 6 6-6 6" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    padding: "var(--df-sp-3) var(--df-sp-4)",
                    borderTop: "1px solid var(--df-border-subtle)",
                    display: "flex",
                    gap: "var(--df-sp-2)",
                    alignItems: "center",
                  }}
                >
                  <button
                    className="df-btn df-btn--primary"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={handleSendComments}
                    disabled={
                      comments.filter((c) => !c.sent).length === 0 || status === "streaming"
                    }
                  >
                    Send {comments.filter((c) => !c.sent).length || ""} to Claude
                  </button>
                  {comments.some((c) => c.sent) && (
                    <button
                      className="df-btn df-btn--secondary"
                      onClick={handleClearSentComments}
                      title="Clear sent comments"
                      style={{ fontSize: "var(--df-text-xs)" }}
                    >
                      Clear sent
                    </button>
                  )}
                </div>
              </div>
            ) : hasContent ? (
              <div
                className="chat-log"
                ref={chatLogRef}
                onScroll={handleChatLogScroll}
                style={{ position: "relative" }}
              >
                {/* F3.3 — Transient flash when the FS poller catches a new
                    file write. Self-dismisses after 3s. Positioned over the
                    chat log so it doesn't push existing messages around. */}
                {recentWriteFlash && (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      position: "sticky",
                      top: 8,
                      alignSelf: "center",
                      zIndex: 5,
                      pointerEvents: "none",
                      margin: "0 auto 8px",
                      padding: "5px 12px",
                      background: "var(--df-surface-raised)",
                      border: "1px solid var(--df-border-subtle)",
                      borderRadius: 999,
                      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 10,
                      color: "var(--df-text-secondary)",
                      letterSpacing: "0.04em",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: "fit-content",
                      animation: "df-write-flash 280ms ease-out",
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span style={{ color: "var(--df-text-primary)", fontWeight: 500 }}>
                      {recentWriteFlash.name}
                    </span>
                    <span style={{ opacity: 0.6 }}>escrito</span>
                  </div>
                )}
                <style>{`
                  @keyframes df-write-flash {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
                {messages.map((msg, i) => {
                  const prev = i > 0 ? messages[i - 1] : null;
                  // Provider switch separator. Rendered ONLY at the
                  // boundary where the provider actually changed —
                  // never on every assistant bubble. Trigger: prev was
                  // assistant from provider X and current carries a
                  // different provider Y. Reuses the session-break
                  // visual vocabulary so the chat keeps one rule for
                  // continuity breaks.
                  const isProviderSwitch =
                    !!prev &&
                    prev.role === "assistant" &&
                    !!prev.provider &&
                    !!msg.provider &&
                    prev.provider !== msg.provider;
                  // Session break. When the gap between two
                  // consecutive messages exceeds 1h AND the new
                  // message opens a new user turn (so we don't break
                  // mid-AI-stream), render a thin horizontal rule
                  // with "Continuou em {time}". Helps the user
                  // scroll-browse long histories. Skipped when
                  // timestamps are missing (legacy snapshots).
                  const SESSION_GAP_MS = 60 * 60 * 1000;
                  const isSessionBreak =
                    !!prev &&
                    msg.role === "user" &&
                    typeof prev.ts === "number" &&
                    typeof msg.ts === "number" &&
                    msg.ts - prev.ts > SESSION_GAP_MS;
                  const breakTime =
                    isSessionBreak && typeof msg.ts === "number"
                      ? new Date(msg.ts).toLocaleString(undefined, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "";
                  return (
                    <div key={i}>
                      {isProviderSwitch && (
                        <div
                          data-testid="chat-provider-switch"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            margin: "16px 0 12px",
                            fontSize: 10,
                            color: "var(--df-text-faint)",
                            fontFamily: "var(--df-font-mono)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          <span
                            style={{ flex: 1, height: 1, background: "var(--df-border-subtle)" }}
                          />
                          <span>{tf("chat.provider.switch", msg.provider ?? "")}</span>
                          <span
                            style={{ flex: 1, height: 1, background: "var(--df-border-subtle)" }}
                          />
                        </div>
                      )}
                      {isSessionBreak && (
                        <div
                          data-testid="chat-session-break"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            margin: "20px 0 16px",
                            fontSize: 10,
                            color: "var(--df-text-faint)",
                            fontFamily: "var(--df-font-mono)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          <span
                            style={{ flex: 1, height: 1, background: "var(--df-border-subtle)" }}
                          />
                          <span>{tf("chat.session.break", breakTime)}</span>
                          <span
                            style={{ flex: 1, height: 1, background: "var(--df-border-subtle)" }}
                          />
                        </div>
                      )}
                      <ChatMessage
                        role={msg.role}
                        provider={msg.provider}
                        model={msg.model}
                        text={msg.text}
                        attachments={msg.attachments}
                        isDesign={msg.isDesign}
                        tools={msg.tools}
                        toolEvents={msg.toolEvents}
                        streaming={msg.streaming}
                        verb={msg.verb}
                        versionId={msg.version_id}
                        doneReport={msg.doneReport}
                        persistStatus={msg.persist_status}
                        durationMs={msg.durationMs}
                        tokensIn={msg.tokensIn}
                        tokensOut={msg.tokensOut}
                        costUsd={msg.costUsd}
                        ttftMs={msg.ttftMs}
                        turnStartedAt={msg.ts}
                        onRestore={handleRestoreFromTurn}
                        answeredQuestions={answeredQuestions}
                        onAnswerQuestion={(answer) => handleQuestionAnswer(i, msg.text, answer)}
                        onOpenSettings={onOpenSettings}
                        onRetry={() => {
                          // BUG-RETRY-MODEL: re-send with the provider + model of
                          // THE TURN BEING RETRIED, not the current global pick.
                          // `handleSend` reads selectedProvider/selectedModel, so
                          // if the global state drifted (live catalog reloaded /
                          // user re-selected) the retry would silently swap the
                          // model (GLM → Qwen). The assistant message (`msg`)
                          // carries the original provider/model.
                          //
                          // Order matters: writeLastModel(provider, model) FIRST,
                          // so the [selectedProvider] effect (~line 2687) — which
                          // fires when we setSelectedProvider and recomputes via
                          // nextModelForProvider(provider, readLastModel(provider))
                          // — resolves back to msg.model instead of the catalog
                          // default. setSelectedModel then lands the same value,
                          // so every code path converges on the original pick.
                          if (msg.provider) {
                            if (msg.model) {
                              writeLastModel(msg.provider, msg.model);
                            }
                            setSelectedProvider(msg.provider);
                          }
                          if (msg.model) {
                            setSelectedModel(msg.model);
                          }
                          // Find the last user message before this error and re-send it.
                          // Walks backward from this index so error mid-thread retries the
                          // turn that produced it, not whichever was last globally.
                          for (let j = i - 1; j >= 0; j--) {
                            if (messages[j].role === "user") {
                              setInput(messages[j].text);
                              // Defer send so the input + provider/model state land
                              // first (and the [selectedProvider] reset effect runs)
                              // before handleSend reads them.
                              window.setTimeout(() => {
                                void handleSendRef.current();
                              }, 0);
                              return;
                            }
                          }
                        }}
                      />
                    </div>
                  );
                })}
                {status === "done" && result && (
                  <div
                    style={{
                      marginTop: "var(--df-sp-3)",
                      padding: "8px 12px",
                      background: "var(--df-surface-raised)",
                      border: "1px solid var(--df-border-subtle)",
                      borderRadius: "var(--df-r-md)",
                      fontFamily: "var(--df-font-mono)",
                      fontSize: "var(--df-text-xs)",
                      color: "var(--df-text-muted)",
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      lineHeight: 1.5,
                    }}
                  >
                    {modelName && <span>{modelName}</span>}
                    {typeof result.durationMs === "number" && (
                      <span>· {formatDuration(result.durationMs)}</span>
                    )}
                    {typeof result.inputTokens === "number" &&
                      typeof result.outputTokens === "number" && (
                        <span>
                          · {result.inputTokens.toLocaleString()} in /{" "}
                          {result.outputTokens.toLocaleString()} out
                        </span>
                      )}
                    {typeof result.costUsd === "number" && (
                      <span>· ${result.costUsd.toFixed(4)}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Designer-friendly empty state — a centered hero plus
              // four clickable suggestions that seed the input field,
              // instead of a technical "Describe what to create..."
              // line. Keeps the user out of blank-page paralysis and
              // shows the kinds of asks the agent handles well.
              <div
                className="chat-empty"
                data-testid="chat-empty-state"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 18,
                  padding: "10vh 24px",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: "var(--df-tracking-tight)",
                    color: "var(--df-text-primary)",
                    fontFamily: "var(--df-font-display, var(--df-font-sans))",
                  }}
                >
                  {t("chat.empty.title")}
                </div>
                <div
                  style={{
                    fontSize: "var(--df-text-sm)",
                    color: "var(--df-text-secondary)",
                    maxWidth: 360,
                  }}
                >
                  {t("chat.empty.subtitle")}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "center",
                    maxWidth: 520,
                    marginTop: 6,
                  }}
                >
                  {[
                    "chat.empty.suggestion.hero",
                    "chat.empty.suggestion.palette",
                    "chat.empty.suggestion.motion",
                    "chat.empty.suggestion.typography",
                  ].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const label = t(key);
                        setInput(label);
                        // Focus the textarea so user can edit/extend the
                        // suggestion before sending.
                        window.setTimeout(() => textareaRef.current?.focus(), 0);
                      }}
                      style={{
                        padding: "6px 12px",
                        background: "var(--df-surface-raised)",
                        border: "1px solid var(--df-border-subtle)",
                        borderRadius: "var(--df-r-sm)",
                        fontSize: "var(--df-text-xs)",
                        color: "var(--df-text-secondary)",
                        cursor: "pointer",
                        transition: "border-color 200ms",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor = "var(--df-border-strong)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor = "var(--df-border-subtle)")
                      }
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Jump-to-latest pill — surfaces only when the user scrolled up
                during a streaming turn. Clicking returns to the bottom and
                clears the pill. The auto-scroll effect then resumes. */}
            {chatTab === "chat" && showJumpToLatest && (
              <button
                type="button"
                onClick={jumpChatToLatest}
                className="df-btn df-btn--sm"
                style={{
                  position: "absolute",
                  bottom: 96,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  background: "var(--df-surface-raised)",
                  border: "1px solid var(--df-border-subtle)",
                  borderRadius: 999,
                  fontFamily: "var(--df-font-mono)",
                  fontSize: 10,
                  color: "var(--df-text-secondary)",
                  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.35)",
                  cursor: "pointer",
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
                {t("chat.jump.to.latest")}
              </button>
            )}
            {/* User ask 2026-05-21: "queria q essa barra de processamento
                q ta no preview ficassem logo acima do input de prompt sempre,
                q eh onde to recebendo mensagem, sinto falta ali". Banner
                moved here so it sits right above the chat input regardless
                of which canvas tab the user is on. */}
            {chatTab === "chat" && isProcessingTurn && (
              <div
                aria-live="polite"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "8px 14px 9px",
                  background: "var(--df-surface-raised)",
                  borderTop: "1px solid var(--df-border-subtle)",
                  fontSize: "var(--df-text-xs)",
                  color: "var(--df-text-secondary)",
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--df-accent-user, var(--df-accent-ok))",
                      boxShadow:
                        "0 0 0 4px color-mix(in srgb, var(--df-accent-user, var(--df-accent-ok)) 14%, transparent)",
                      animation: "df-global-status-breath 1400ms ease-in-out infinite",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.02em",
                      color: "var(--df-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {canvasStatusLabel}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      color: "var(--df-text-muted)",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span title="Elapsed time">{formatTurnElapsed(turnElapsedMs)}</span>
                    {turnStats && turnStats.tokens > 0 && (
                      <span title="Estimated output tokens">
                        ~{formatTurnTokens(turnStats.tokens)} tok
                      </span>
                    )}
                    {turnStats && turnStats.toolsTotal > 0 && (
                      <span title="Tool calls (completed / total)">
                        {turnStats.toolsCompleted}/{turnStats.toolsTotal} tools
                      </span>
                    )}
                    {turnStats && (turnStats.provider || turnStats.model) && (
                      <span title="Provider · model" style={{ opacity: 0.7 }}>
                        {[turnStats.provider, turnStats.model].filter(Boolean).join("·")}
                      </span>
                    )}
                    {(status === "streaming" || tweaksLoading || agentStreaming) && (
                      <button
                        type="button"
                        // BUG-CANCEL: the Assistant / @agent flow streams outside
                        // useClaude, so route STOP to the right aborter:
                        //   useClaude stream → cancelStream
                        //   tweaks stream    → tweaksAbortRef
                        //   agent/skill stream → agentAbortRef
                        onClick={
                          status === "streaming"
                            ? cancelStream
                            : tweaksLoading
                              ? () => tweaksAbortRef.current?.()
                              : () => agentAbortRef.current?.()
                        }
                        style={{
                          background: "transparent",
                          border: "1px solid var(--df-border-subtle)",
                          padding: "1px 8px",
                          borderRadius: 4,
                          color: "var(--df-text-muted)",
                          fontFamily: "var(--df-font-mono)",
                          fontSize: 10,
                          letterSpacing: "0.06em",
                          cursor: "pointer",
                        }}
                        title="Cancel turn (Esc)"
                      >
                        STOP
                      </button>
                    )}
                  </span>
                </div>
                {turnStats && turnStats.preview && (
                  <div
                    style={{
                      fontFamily: "var(--df-font-body)",
                      fontSize: 11,
                      color: "var(--df-text-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingLeft: 17,
                      opacity: 0.85,
                    }}
                  >
                    {turnStats.preview}
                  </div>
                )}
                <style>{`
                  @keyframes df-global-status-breath {
                    0%, 100% { opacity: 0.55; transform: scale(0.85); }
                    50%      { opacity: 1;    transform: scale(1.15); }
                  }
                `}</style>
              </div>
            )}
            {/* Chat input — only when on Chat tab */}
            {chatTab === "chat" && (
              <div className="chat-input">
                <div
                  ref={chatInputBoxRef}
                  className={`chat-input-box${composerDragActive ? " is-drag-active" : ""}`}
                  style={{
                    position: "relative",
                    outline: composerDragActive
                      ? "2px dashed var(--df-accent-user, var(--df-accent-ok))"
                      : undefined,
                    outlineOffset: composerDragActive ? -4 : undefined,
                    transition: "outline-color 120ms var(--df-ease-out)",
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types?.includes("Files")) {
                      e.preventDefault();
                      setComposerDragActive(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    // Only deactivate when the cursor truly leaves the box.
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setComposerDragActive(false);
                  }}
                  onDrop={(e) => {
                    // Always clear the drag-active state — even when the
                    // drop carried no files, the overlay must not stay
                    // stuck after the user lets go.
                    setComposerDragActive(false);
                    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
                    e.preventDefault();
                    void handleAttach(e.dataTransfer.files);
                  }}
                >
                  {slashState && slashMatches.length > 0 && (
                    <SlashMenu
                      matches={slashMatches}
                      highlightIdx={slashState.hi}
                      onSelect={insertSlashCommand}
                      onHover={(idx) =>
                        setSlashState((prev) => (prev ? { ...prev, hi: idx } : prev))
                      }
                      anchor={chatInputBoxRef.current}
                    />
                  )}
                  {(dsName ||
                    attachedFiles.length > 0 ||
                    !!(canonicalChips?.format && canonicalActive.format) ||
                    !!(canonicalChips && canonicalChips.rulesCount > 0 && canonicalActive.rules) ||
                    !!(
                      canonicalChips &&
                      canonicalChips.tasteCount > 0 &&
                      canonicalActive.taste
                    )) && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        padding: "10px 14px 0",
                      }}
                    >
                      {dsName && (
                        // Removable DS pill — clicking × detaches the
                        // design system mid-project. The user can
                        // re-pick from Settings or from the project
                        // setup.
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            background: "var(--df-tint-ok)",
                            border: "1px solid var(--df-border-subtle)",
                            borderRadius: "var(--df-r-sm)",
                            fontFamily: "var(--df-font-mono)",
                            fontSize: 10,
                            color: "var(--df-accent-ok)",
                            maxWidth: 220,
                          }}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ flexShrink: 0 }}
                          >
                            <circle cx="13.5" cy="6.5" r="2.5" />
                            <circle cx="17.5" cy="10.5" r="2.5" />
                            <circle cx="8.5" cy="7.5" r="2.5" />
                            <circle cx="6.5" cy="12.5" r="2.5" />
                            <path d="M12 2a10 10 0 1 0 0 20 4 4 0 0 1 0-8 2 2 0 0 0 0-4Z" />
                          </svg>
                          <span
                            style={{
                              color: "var(--df-text-faint)",
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                            }}
                          >
                            DS
                          </span>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={dsPath ?? dsName}
                          >
                            {dsName}
                          </span>
                          <button
                            onClick={() => {
                              setDsPath(null);
                              setDsName(null);
                              setDsMarkdown(null);
                              db.setSetting("ds_path", "").catch(warn("setSetting:ds_path"));
                              db.setSetting("ds_name", "").catch(warn("setSetting:ds_name"));
                              // BUG-30: also strip designSystem from the
                              // per-project canonicalPlus on disk. Otherwise the
                              // window `focus` handler re-reads canonicalPlus and
                              // re-attaches the DS — detach didn't stick across a
                              // tab switch. Rewrite the payload without the DS.
                              if (projectId) {
                                void db
                                  .getSetting(`canonicalPlus:${projectId}`)
                                  .then((raw) => {
                                    if (!raw) return;
                                    try {
                                      const cp = JSON.parse(raw) as Record<string, unknown>;
                                      if ("designSystem" in cp) {
                                        delete cp.designSystem;
                                        return db.setSetting(
                                          `canonicalPlus:${projectId}`,
                                          JSON.stringify(cp),
                                        );
                                      }
                                    } catch {
                                      /* malformed — leave as-is */
                                    }
                                  })
                                  .catch(warn("detach:canonicalPlus"));
                              }
                              showToast(t("editor.toast.dsDetached"));
                            }}
                            title="Detach design system"
                            style={{
                              color: "var(--df-text-faint)",
                              fontSize: 11,
                              cursor: "pointer",
                              padding: "0 2px",
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )}
                      {canonicalChips?.format && canonicalActive.format && (
                        <PromptChip
                          tag="Formato"
                          label={canonicalChips.format}
                          title={t("editor.chip.deactivate")}
                          onRemove={() => deactivateCanonical("format")}
                        />
                      )}
                      {canonicalChips && canonicalChips.rulesCount > 0 && canonicalActive.rules && (
                        <PromptChip
                          tag="Regras"
                          label={String(canonicalChips.rulesCount)}
                          title={t("editor.chip.deactivate")}
                          onRemove={() => deactivateCanonical("rules")}
                        />
                      )}
                      {canonicalChips && canonicalChips.tasteCount > 0 && canonicalActive.taste && (
                        <PromptChip
                          tag="Taste"
                          label={String(canonicalChips.tasteCount)}
                          title={t("editor.chip.deactivate")}
                          onRemove={() => deactivateCanonical("taste")}
                        />
                      )}
                      {attachedFiles.length > 0 && (
                        <ChatAttachmentChips
                          attachments={attachedFiles.map((f) => {
                            const isImage = f.mime.startsWith("image/");
                            const isHtml = f.mime === "text/html" || /\.html?$/i.test(f.name);
                            const isTextLike =
                              !isImage &&
                              (f.mime.startsWith("text/") ||
                                /^application\/(json|javascript|xml)/.test(f.mime) ||
                                /\.(md|ts|tsx|jsx|js|json|yml|yaml|txt|csv|css)$/i.test(f.name));
                            return {
                              name: f.name,
                              size: f.size,
                              mime: f.mime,
                              kind: (isHtml
                                ? "html"
                                : isImage
                                  ? "image"
                                  : isTextLike
                                    ? "text"
                                    : "binary") as "image" | "text" | "html" | "binary",
                              path: isImage ? f.content : undefined,
                              content: isImage ? undefined : f.content,
                              preview: f.preview,
                            };
                          })}
                          onRemove={(idx) =>
                            setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                          align="start"
                        />
                      )}
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    className="chat-input-field"
                    placeholder={
                      canvasMode === "edit"
                        ? t("editor.input.placeholder.edit")
                        : iframeHtml
                          ? t("editor.input.placeholder.change")
                          : t("editor.input.placeholder.create")
                    }
                    value={input}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInput(v);
                      const cur = e.target.selectionStart ?? v.length;
                      const t = triggerAtCursor(v, cur);
                      setSlashState(t ? { ...t, hi: 0, originalToken: t.token } : null);
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={async (e) => {
                      const items = e.clipboardData?.items;
                      if (!items || items.length === 0) return;
                      const files: File[] = [];
                      for (const it of Array.from(items)) {
                        if (it.kind === "file") {
                          const f = it.getAsFile();
                          if (f) files.push(f);
                        }
                      }
                      if (files.length === 0) return; // text paste flows normally
                      e.preventDefault();
                      const dt = new DataTransfer();
                      files.forEach((f) => dt.items.add(f));
                      await handleAttach(dt.files);
                    }}
                  />
                  <div className="chat-input-bar">
                    <div className="chat-input-bar-left">
                      {/* Commands library button removed 2026-05-21 — typing
                          `/` already opens the slash menu, so a second
                          affordance was redundant. */}
                      <button
                        className="df-btn df-btn--icon"
                        title={t("editor.tooltip.attach")}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m21 12-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                        </svg>
                      </button>
                      {/* DS palette picker — user ask 2026-05-21:
                          "design system quero que seja so um icon junto de
                          attachments". Icon-only trigger; popover reuses
                          the same SearchableDropdown the NewProject DS
                          dropdown is built on, so the visual + behavior
                          stay consistent. Active state lights an accent
                          color when a DS is attached. */}
                      <button
                        ref={dsIconTriggerRef}
                        className="df-btn df-btn--icon"
                        title={dsName ? `DS: ${dsName} — click to switch` : "Attach Design System"}
                        onClick={() => {
                          if (designSystems.length === 0) setAttachDsOpen(true);
                          else setDsDropdownOpen((s) => !s);
                        }}
                        style={dsPath ? { color: "var(--df-accent)" } : undefined}
                        aria-haspopup="listbox"
                        aria-expanded={dsDropdownOpen}
                      >
                        {/* Palette icon */}
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="13.5" cy="6.5" r="1.5" />
                          <circle cx="17.5" cy="10.5" r="1.5" />
                          <circle cx="8.5" cy="7.5" r="1.5" />
                          <circle cx="6.5" cy="12.5" r="1.5" />
                          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.992 6.012 17.461 2 12 2z" />
                        </svg>
                      </button>
                      <SearchableDropdown<FsDesignSystem>
                        open={dsDropdownOpen && designSystems.length > 0}
                        onClose={() => setDsDropdownOpen(false)}
                        items={[
                          ...designSystems.map(
                            (
                              ds,
                            ): import("@/components/SearchableDropdown").SearchableDropdownItem<FsDesignSystem> => {
                              const swatches = (dsSwatchCache[ds.path] ?? []).slice(0, 4);
                              const padded = [
                                ...swatches,
                                ...Array(Math.max(0, 4 - swatches.length)).fill(
                                  "var(--df-surface-raised)",
                                ),
                              ];
                              return {
                                id: ds.path,
                                label: ds.name,
                                sub: ds.path.split("/").slice(-2).join("/"),
                                searchText: `${ds.path} ${ds.slug ?? ""}`,
                                payload: ds,
                                leading: (
                                  <span className="cnp-ds-dropdown-swatches" aria-hidden>
                                    {padded.map((sw, i) => (
                                      <span
                                        key={i}
                                        className="cnp-ds-dropdown-sw"
                                        style={{ background: sw }}
                                      />
                                    ))}
                                  </span>
                                ),
                              };
                            },
                          ),
                          { id: "__ds_more__", label: "More design systems…", footerAction: true },
                        ]}
                        selectedId={dsPath}
                        onPick={(it) => {
                          if (it.footerAction) {
                            setAttachDsOpen(true);
                          } else {
                            const ds = designSystems.find((d) => d.path === it.id);
                            void handleAttachDs(ds ?? null);
                          }
                          setDsDropdownOpen(false);
                        }}
                        onClear={() => {
                          void handleAttachDs(null);
                          setDsDropdownOpen(false);
                        }}
                        clearLabel="Detach DS"
                        searchPlaceholder="Search design systems…"
                        emptyTemplate="No matches"
                        ariaLabel="Design Systems"
                        anchor="top-start"
                        width={280}
                        searchThreshold={6}
                        popoverRef={dsDropdownRef}
                        triggerRef={dsIconTriggerRef}
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => {
                          handleAttach(e.target.files);
                          e.target.value = "";
                        }}
                      />

                      <button
                        className="df-btn df-btn--icon"
                        title={isRecording ? "Stop dictation" : "Dictate (realtime)"}
                        onClick={async () => {
                          if (isRecording) {
                            // Stop active recognition. onend handler will flip state.
                            try {
                              (recognitionRef.current as { stop: () => void } | null)?.stop();
                            } catch {
                              /* already stopped */
                            }
                            return;
                          }
                          // Prefer Web Speech API (realtime, in-browser, free).
                          // Fallback: MediaRecorder + Groq Whisper on stop.
                          const SR =
                            (
                              window as unknown as {
                                SpeechRecognition?: new () => unknown;
                                webkitSpeechRecognition?: new () => unknown;
                              }
                            ).SpeechRecognition ??
                            (window as unknown as { webkitSpeechRecognition?: new () => unknown })
                              .webkitSpeechRecognition;
                          if (SR) {
                            try {
                              recognitionBaselineRef.current = (
                                textareaRef.current?.value ?? input
                              ).replace(/\s+$/, "");
                              const r = new SR() as {
                                continuous: boolean;
                                interimResults: boolean;
                                lang: string;
                                onresult: (e: {
                                  resultIndex: number;
                                  results: { isFinal: boolean; 0: { transcript: string } }[] & {
                                    length: number;
                                  };
                                }) => void;
                                onerror: (e: { error: string }) => void;
                                onend: () => void;
                                start: () => void;
                                stop: () => void;
                              };
                              r.continuous = true;
                              r.interimResults = true;
                              // Match the Brazilian-Portuguese user by default. If
                              // we need EN later, expose a setting.
                              r.lang = "pt-BR";

                              let finalText = "";

                              r.onresult = (e) => {
                                let interim = "";
                                for (let i = e.resultIndex; i < e.results.length; i++) {
                                  const t = e.results[i][0].transcript;
                                  if (e.results[i].isFinal) finalText += t;
                                  else interim += t;
                                }
                                const baseline = recognitionBaselineRef.current;
                                const combined =
                                  (baseline ? baseline + " " : "") +
                                  (finalText + interim).trimStart();
                                setInput(combined);
                              };

                              r.onerror = (e) => {
                                if (e.error === "no-speech" || e.error === "aborted") return;
                                showToast(`Voice: ${e.error}`);
                              };

                              r.onend = () => {
                                setIsRecording(false);
                                recognitionRef.current = null;
                              };

                              recognitionRef.current = r;
                              setIsRecording(true);
                              r.start();
                              return;
                            } catch (e) {
                              showToast(`Voice setup failed: ${String(e).slice(0, 80)}`);
                              return;
                            }
                          }
                          showToast(t("editor.toast.dictationUnsupported"));
                        }}
                        style={isRecording ? { color: "var(--df-accent-danger)" } : undefined}
                      >
                        {isRecording ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        ) : (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="chat-input-bar-right">
                      {/* User ask 2026-05-21 (revised): only the Model
                          dropdown lives in the input bar (NewProject styling).
                          Provider stays on the topbar (AgentPicker); DS moved
                          to a palette icon on the LEFT of the input bar. */}
                      <ModelRocker
                        provider={selectedProvider}
                        model={selectedModel}
                        open={modelMenuOpen}
                        onToggle={() => setModelMenuOpen((s) => !s)}
                        onPick={(id) => {
                          handleModelChange(id);
                          setModelMenuOpen(false);
                        }}
                        menuRef={modelMenuRef}
                        anchor="top-start"
                        compact
                      />
                      {/* Legacy model-selector retained below in a hidden
                          fragment so the old portal-based menu (used by
                          older tests / external callers) keeps working
                          while we migrate. Wrap in a display:none span. */}
                      <span style={{ display: "none" }}>
                        <button
                          ref={modelBtnRef}
                          className="model-selector"
                          title={t("editor.tooltip.switchModel")}
                          onClick={() => setShowModelMenu((v) => !v)}
                        >
                          <span className="model-selector-dot" />
                          <span>
                            {currentModelOptions.find((o) => o.id === selectedModel)?.label ??
                              selectedModel}
                          </span>
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              opacity: 0.6,
                              transform: showModelMenu ? "rotate(180deg)" : "none",
                              transition: "transform 120ms ease",
                            }}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        {showModelMenu &&
                          modelBtnRef.current &&
                          createPortal(
                            <>
                              <div
                                style={{ position: "fixed", inset: 0, zIndex: 99 }}
                                onClick={() => setShowModelMenu(false)}
                              />
                              <div
                                style={(() => {
                                  const r = modelBtnRef.current!.getBoundingClientRect();
                                  return {
                                    position: "fixed",
                                    bottom: window.innerHeight - r.top + 6,
                                    left: Math.max(8, r.right - 220),
                                    minWidth: 220,
                                    background: "var(--df-surface-elevated)",
                                    borderRadius: "var(--df-r-lg)",
                                    boxShadow: "var(--df-shadow-card)",
                                    overflow: "hidden",
                                    zIndex: 100,
                                    animation: "df-dropdown-fade 120ms ease-out",
                                  } as React.CSSProperties;
                                })()}
                              >
                                {/* Source banner — be transparent about whether the list
                                  was probed live or fell back to the static catalog.
                                  Users hit a Codex bug where a static-only ID didn't
                                  exist on his account; making the source explicit
                                  helps him decide whether to trust the list. */}
                                <div
                                  style={{
                                    padding: "8px 12px",
                                    fontSize: 10,
                                    fontFamily: "var(--df-font-mono)",
                                    color: "var(--df-text-faint)",
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                    borderBottom: "1px solid var(--df-border-subtle)",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 8,
                                  }}
                                >
                                  <span>
                                    {modelsLoading
                                      ? "probing…"
                                      : modelsSource === "live"
                                        ? `live · ${currentModelOptions.length}`
                                        : `catalog · ${currentModelOptions.length}`}
                                  </span>
                                  {modelsSource === "static" &&
                                    (selectedProvider === "ollama" ||
                                      selectedProvider === "openrouter") && (
                                      <span style={{ color: "var(--df-accent-warn)" }}>
                                        probe failed
                                      </span>
                                    )}
                                </div>
                                {currentModelOptions.length === 0 ? (
                                  <div
                                    style={{
                                      padding: "10px 14px",
                                      fontSize: "var(--df-text-xs)",
                                      fontFamily: "var(--df-font-mono)",
                                      color: "var(--df-text-faint)",
                                      lineHeight: 1.55,
                                    }}
                                  >
                                    No models configured.
                                  </div>
                                ) : (
                                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                                    {currentModelOptions.map((m) => (
                                      <button
                                        key={m.id}
                                        onClick={() => handleModelChange(m.id)}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          width: "100%",
                                          padding: "9px 12px",
                                          background:
                                            m.id === selectedModel
                                              ? "var(--df-interactive-hover)"
                                              : "none",
                                          border: "none",
                                          color: "var(--df-text-primary)",
                                          fontSize: "var(--df-text-sm)",
                                          cursor: "pointer",
                                          textAlign: "left",
                                        }}
                                      >
                                        <span
                                          style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            flex: 1,
                                            minWidth: 0,
                                          }}
                                        >
                                          {m.label}
                                        </span>
                                        <span
                                          style={{
                                            fontFamily: "var(--df-font-mono)",
                                            fontSize: "var(--df-text-xs)",
                                            color: "var(--df-text-faint)",
                                            flexShrink: 0,
                                            marginLeft: 12,
                                          }}
                                        >
                                          {m.sub}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {/* Custom model input — escape hatch for any provider.
                                  Power user knows the exact id; just paste + enter. */}
                                <div
                                  style={{
                                    borderTop: "1px solid var(--df-border-subtle)",
                                    padding: "8px 10px",
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="text"
                                    value={customModelInput}
                                    onChange={(e) => setCustomModelInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && customModelInput.trim()) {
                                        handleModelChange(customModelInput.trim());
                                        setCustomModelInput("");
                                        setShowModelMenu(false);
                                      }
                                    }}
                                    placeholder={t("editor.input.modelIdPlaceholder")}
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      background: "var(--df-bg-base)",
                                      border: "1px solid var(--df-border-subtle)",
                                      borderRadius: "var(--df-r-sm)",
                                      padding: "5px 8px",
                                      fontSize: 11,
                                      fontFamily: "var(--df-font-mono)",
                                      color: "var(--df-text-primary)",
                                      outline: "none",
                                    }}
                                    spellCheck={false}
                                  />
                                  <button
                                    type="button"
                                    className="df-tactile df-tactile--sm"
                                    onClick={() => {
                                      if (!customModelInput.trim()) return;
                                      handleModelChange(customModelInput.trim());
                                      setCustomModelInput("");
                                      setShowModelMenu(false);
                                    }}
                                    disabled={!customModelInput.trim()}
                                  >
                                    use
                                  </button>
                                </div>
                              </div>
                            </>,
                            document.body,
                          )}
                      </span>
                      <button
                        className="chat-input-send"
                        data-disabled={
                          status !== "streaming" &&
                          !tweaksLoading &&
                          !agentStreaming &&
                          !input.trim()
                        }
                        // BUG-CANCEL: send button doubles as Cancel during any
                        // in-flight stream — including the Assistant / @agent
                        // flow (agentStreaming), which streams outside useClaude.
                        onClick={
                          status === "streaming"
                            ? cancelStream
                            : tweaksLoading
                              ? () => tweaksAbortRef.current?.()
                              : agentStreaming
                                ? () => agentAbortRef.current?.()
                                : () => {
                                    void handleSend();
                                  }
                        }
                        title={
                          status === "streaming" || tweaksLoading || agentStreaming
                            ? "Cancel (Esc)"
                            : "Send (⌘↵)"
                        }
                      >
                        {status === "streaming" || tweaksLoading || agentStreaming ? (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="none"
                          >
                            <rect x="6" y="6" width="12" height="12" rx="1.5" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m5 12 14 0" />
                            <path d="m13 6 6 6-6 6" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* CANVAS */}
          <section className="editor-canvas">
            <div className="canvas-toolbar">
              <div className="toolbar-group">
                <button
                  className="df-btn df-btn--icon"
                  title={iframeHtml ? "Reload preview" : "Check disk for new HTML"}
                  onClick={handleReload}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                </button>
                <button
                  className="df-btn df-btn--icon"
                  title={t("editor.tooltip.undo")}
                  onClick={handleUndo}
                  disabled={!canUndo}
                  style={!canUndo ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                  </svg>
                </button>
                <button
                  className="df-btn df-btn--icon"
                  title={t("editor.tooltip.redo")}
                  onClick={handleRedo}
                  disabled={!canRedo}
                  style={!canRedo ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 7v6h-6" />
                    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
                  </svg>
                </button>
                <button
                  className="df-btn df-btn--icon"
                  title={t("editor.tooltip.versionHistory")}
                  onClick={() => setShowVersions(true)}
                  disabled={!iframeHtml}
                  style={!iframeHtml ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 3v5h5" />
                    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                    <path d="M12 7v5l4 2" />
                  </svg>
                </button>
                <button
                  className="df-btn df-btn--icon"
                  title={t("editor.tooltip.saveVersion")}
                  onClick={() => setShowSaveVersion(true)}
                  disabled={!iframeHtml}
                  style={!iframeHtml ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                </button>
              </div>
              {/* Launch tools — each opens a new canvas tab */}
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <ToolbarPill id="terminal" label="Terminal" active={false} onClick={addTerminalTab}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </ToolbarPill>
                <ToolbarPill id="files" label="Files" active={false} onClick={openFilesTab}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </ToolbarPill>
                {/* Video toolbar pill removed — editing is not part of the
                    current public surface. Video presets continue to live
                    in NewProject; export to MP4 is a Share menu placeholder. */}
              </div>
              {/* Modes — change behavior on canvas */}
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <div ref={tweaksAnchorRef} style={{ position: "relative", display: "inline-flex" }}>
                  <ToolbarPill
                    id="tweaks"
                    label="Tweaks"
                    active={canvasMode === "tweaks"}
                    onClick={() => {
                      // Tweaks pill is dual-purpose: it toggles the canvas mode
                      // (off → tweaks, tweaks → off) AND opens the prompt card.
                      // The prompt card is the primary action — always show it,
                      // even when toggling off, so the user can still issue
                      // a tweak request without re-clicking.
                      toggleMode("tweaks");
                      handleOpenTweaks();
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="4" x2="4" y1="21" y2="14" />
                      <line x1="4" x2="4" y1="10" y2="3" />
                      <line x1="12" x2="12" y1="21" y2="12" />
                      <line x1="12" x2="12" y1="8" y2="3" />
                      <line x1="20" x2="20" y1="21" y2="16" />
                      <line x1="20" x2="20" y1="12" y2="3" />
                      <line x1="2" x2="6" y1="14" y2="14" />
                      <line x1="10" x2="14" y1="8" y2="8" />
                      <line x1="18" x2="22" y1="16" y2="16" />
                    </svg>
                  </ToolbarPill>
                  {showTweaksRequest && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: 0,
                        width: 380,
                        background: "var(--df-surface-elevated)",
                        borderRadius: "var(--df-r-2xl)",
                        boxShadow: "var(--df-shadow-card)",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        zIndex: 100,
                        animation: "df-verb-pill-in 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "var(--df-text-xs)",
                          color: "var(--df-text-muted)",
                          lineHeight: 1.45,
                        }}
                      >
                        {hasBuiltInTweaks ? "Add or adjust knobs." : "Build a tweaks panel."} Leave
                        blank for a comprehensive set.
                      </div>
                      <textarea
                        autoFocus
                        className="chat-input-field"
                        placeholder={t("editor.input.tweaksPlaceholder")}
                        value={tweaksRequest}
                        onChange={(e) => setTweaksRequest(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            handleGenerateTweaks();
                          }
                        }}
                        style={{ minHeight: 64, resize: "vertical", fontSize: "var(--df-text-xs)" }}
                      />
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: "var(--df-sp-2)",
                        }}
                      >
                        <button
                          className="df-btn df-btn--secondary"
                          onClick={() => setShowTweaksRequest(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="df-btn df-btn--primary"
                          onClick={handleGenerateTweaks}
                          disabled={tweaksLoading}
                        >
                          {tweaksLoading ? "Building..." : hasBuiltInTweaks ? "Update" : "Build"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <ToolbarPill
                  id="comment"
                  label="Comment"
                  active={canvasMode === "comment"}
                  onClick={() => {
                    // Strict sandbox → Comment can't reach contentDocument.
                    // Surface the enable-edit prompt instead of a dead mode.
                    if (canvasMode !== "comment" && !requirePermissiveSandbox("comment")) return;
                    // Comment + Edit only work against the main iframe. When the
                    // user is on a file tab and the main tab also exists, auto-
                    // switch so the activation is visible. If the file tab IS
                    // the only HTML surface (no main yet), promote it to main
                    // by copying its content into iframeHtml — this materialises
                    // the main tab and lets the user edit inline. The open
                    // tab needs to be recognized as the active target.
                    if (canvasMode !== "comment") {
                      if (canvasTabs.some((t) => t.id === "main")) {
                        setActiveCanvasTab("main");
                      } else if (
                        currentTab?.kind === "file" &&
                        currentTab.fileIsText !== false &&
                        /\.html?$/i.test(currentTab.filePath ?? "") &&
                        typeof currentTab.fileContent === "string"
                      ) {
                        setIframeHtml(currentTab.fileContent);
                        // main tab auto-created by the iframeHtml effect; the
                        // activeCanvasTab swap follows in the next render via
                        // the effect order. Force it now too so feedback is
                        // immediate.
                        setActiveCanvasTab("main");
                      }
                    }
                    toggleMode("comment");
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </ToolbarPill>
                {/* Select pill is not part of the current public surface. */}
                <ToolbarPill
                  id="edit"
                  label="Edit"
                  active={canvasMode === "edit"}
                  onClick={() => {
                    // Strict sandbox → inline Edit can't reach contentDocument.
                    // Surface the enable-edit prompt instead of a dead mode.
                    if (canvasMode !== "edit" && !requirePermissiveSandbox("edit")) return;
                    if (canvasMode !== "edit") {
                      if (canvasTabs.some((t) => t.id === "main")) {
                        setActiveCanvasTab("main");
                      } else if (
                        currentTab?.kind === "file" &&
                        currentTab.fileIsText !== false &&
                        /\.html?$/i.test(currentTab.filePath ?? "") &&
                        typeof currentTab.fileContent === "string"
                      ) {
                        setIframeHtml(currentTab.fileContent);
                        setActiveCanvasTab("main");
                      }
                    }
                    toggleMode("edit");
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="14" height="18" rx="1" />
                    <line x1="7" y1="8" x2="13" y2="8" />
                    <line x1="7" y1="12" x2="13" y2="12" />
                    <line x1="7" y1="16" x2="10" y2="16" />
                  </svg>
                </ToolbarPill>
                <ToolbarPill
                  id="prompt"
                  label="Prompt"
                  active={false}
                  onClick={() => setShowFullPrompt(true)}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="9" y1="13" x2="15" y2="13" />
                    <line x1="9" y1="17" x2="15" y2="17" />
                    <line x1="9" y1="9" x2="11" y2="9" />
                  </svg>
                </ToolbarPill>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: "var(--df-sp-2)" }}>
                <button
                  className="df-btn df-btn--ghost df-btn--sm"
                  onClick={() => {
                    if (!iframeHtml) {
                      showToast(t("editor.toast.generateFirst"));
                      return;
                    }
                    setPresenting(true);
                  }}
                  disabled={!iframeHtml}
                  title="Present fullscreen (Esc to exit)"
                  style={!iframeHtml ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Present
                </button>
              </div>
            </div>

            {/* Global processing indicator moved 2026-05-21: user
                wanted it right above the chat input so it sits where
                he reads incoming messages, not on the canvas side
                that's mostly the iframe preview. The banner now lives
                inside the chat panel just before <div class="chat-input">.
                Search for `df-global-status-breath` to find the live
                JSX (single source of truth now). */}

            {/* Persist non-preview tabs (keep their state while hidden). */}
            {canvasTabs
              .filter((t) => t.kind !== "preview")
              .map((tab) => {
                const visible = tab.id === activeCanvasTab;
                const style: React.CSSProperties = {
                  flex: 1,
                  minHeight: 0,
                  display: visible ? "flex" : "none",
                  flexDirection: "column",
                };
                if (tab.kind === "terminal") {
                  return (
                    <div key={tab.id} style={{ ...style, position: "relative" }}>
                      <TerminalDrawer inline onClose={() => closeCanvasTab(tab.id)} />
                    </div>
                  );
                }
                if (tab.kind === "files") {
                  return (
                    <div key={tab.id} style={style}>
                      <FileManager
                        initialPath={tab.rootPath ?? "/"}
                        onOpen={openFileTab}
                        onClose={() => closeCanvasTab(tab.id)}
                        refreshKey={filesRefreshKey}
                      />
                    </div>
                  );
                }
                if (tab.kind === "file") {
                  return (
                    <div key={tab.id} style={style}>
                      <FileView
                        name={tab.name}
                        path={tab.filePath ?? ""}
                        content={tab.fileContent ?? ""}
                        isText={tab.fileIsText !== false}
                      />
                    </div>
                  );
                }
                if (tab.kind === "video") {
                  // legacy video tabs (from older sessions) render as
                  // an empty placeholder so existing state stays parseable.
                  // Closing the tab removes it permanently from .df state.
                  return (
                    <div
                      key={tab.id}
                      style={{
                        ...style,
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "32px",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: 360,
                          textAlign: "center",
                          color: "var(--df-text-muted)",
                          fontSize: "var(--df-text-sm)",
                          lineHeight: 1.5,
                        }}
                      >
                        <p>Video editing is deferred to a later wave.</p>
                        <p style={{ marginTop: 12 }}>
                          Close this tab to remove it from the project.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            {/* Preview tab slot (iframe + overlays, loader, or empty state).
                User repro 2026-05-08: switching tabs (Files / Terminal /
                file open) used to UNMOUNT the preview iframe — it re-rendered
                fresh on return, losing scroll, DOM state, JS heap, and
                triggering the load handler again. Other tabs above
                (lines ~5760-5812) already preserve state via
                `display: visible ? "flex" : "none"` toggle; the preview
                slot was the inconsistent one.
                Fix: render the preview tree always, toggle visibility via
                the wrapper's `display`. The iframe stays mounted across
                tab switches, JS state and scroll persist. */}
            <div
              className="canvas-tab-slot canvas-tab-slot--preview"
              style={{
                flex: 1,
                minHeight: 0,
                display: currentTab?.kind === "preview" ? "flex" : "none",
                flexDirection: "column",
              }}
            >
              {iframeHtml ? (
                <div
                  className="canvas-stage"
                  style={{
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                  }}
                >
                  {/* Streaming overlay removed 2026-05-20. The sweeping light
                    band was gated on `status === "streaming"` which only
                    triggers for Claude's legacy runStream path — V2 turns
                    (Codex/Kimi/Gemini/API providers) never lit it up, so
                    the canvas had inconsistent "fábrica trabalhando" cues
                    across providers. User repro: "meio quebrado, muito
                    rápido, faz sentido?". Single source of truth for in-
                    flight feedback is now the global status banner at the
                    top of the canvas (driven by isProcessingTurn). */}
                  {canvasMode && canvasMode !== "tweaks" && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--df-sp-2)",
                        padding: "8px 14px",
                        background: "var(--df-surface-raised)",
                        borderBottom: "1px solid var(--df-border-subtle)",
                        fontSize: "var(--df-text-xs)",
                        color: "var(--df-text-secondary)",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--df-font-mono)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--df-text-primary)",
                          fontWeight: 600,
                        }}
                      >
                        {canvasMode}
                      </span>
                      <span>
                        {canvasMode === "comment" &&
                          "click anywhere on the preview to leave a note"}
                        {canvasMode === "edit" &&
                          "click an element in the preview to edit it inline"}
                      </span>
                    </div>
                  )}
                  <CanvasStage
                    isVideoProject={isVideoProject}
                    aspectNum={videoAspectNum}
                    ratioId={isVideoProject ? videoRatio : undefined}
                    onClick={handleCanvasClick}
                    cursor={canvasMode === "comment" ? "crosshair" : "default"}
                  >
                    <iframe
                      key={`preview-${iframeKey}-${isVideoProject ? videoRatio : "html"}`}
                      ref={iframeRef}
                      srcDoc={iframeSrcDocFinal ?? undefined}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        background: "white",
                        display: "block",
                      }}
                      title="preview"
                      sandbox={PREVIEW_SANDBOX}
                    />
                  </CanvasStage>
                  {/* Posture badge shows ONLY under permissive sandbox — a
                    visible reminder that isolation is reduced. Strict (the
                    default) stays clean. */}
                  {PREVIEW_SANDBOX_IS_PERMISSIVE && (
                    <PreviewSandboxBadge sandbox={PREVIEW_SANDBOX} warnIfPermissive />
                  )}
                  {/* Actionable gate: when the user reaches for Edit/Comment
                    under a strict sandbox, offer the one-time opt-in instead
                    of silently activating a mode that can't reach the iframe. */}
                  {sandboxGateFor && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 6,
                        display: "grid",
                        placeItems: "center",
                        background: "color-mix(in srgb, var(--df-bg-base) 70%, transparent)",
                        pointerEvents: "auto",
                      }}
                      onClick={() => setSandboxGateFor(null)}
                    >
                      <div
                        role="dialog"
                        aria-label={t("editor.sandbox.gate.title")}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          maxWidth: 360,
                          padding: 20,
                          background: "var(--df-bg-elevated, var(--df-bg-base))",
                          border: "1px solid var(--df-border-subtle)",
                          borderRadius: "var(--df-r-md, 8px)",
                          boxShadow: "0 8px 28px color-mix(in srgb, var(--df-bg-base) 60%, black)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 14,
                            color: "var(--df-text-primary)",
                          }}
                        >
                          {t("editor.sandbox.gate.title")}
                        </strong>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: "var(--df-text-muted)",
                          }}
                        >
                          {tf(
                            "editor.sandbox.gate.body",
                            sandboxGateFor === "edit" ? "Edit" : "Comment",
                          )}
                        </p>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => setSandboxGateFor(null)}
                            style={{
                              padding: "7px 12px",
                              fontSize: 13,
                              background: "transparent",
                              color: "var(--df-text-muted)",
                              border: "1px solid var(--df-border-subtle)",
                              borderRadius: "var(--df-r-sm, 4px)",
                              cursor: "pointer",
                            }}
                          >
                            {t("editor.sandbox.gate.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => enablePermissiveSandboxAndReload()}
                            style={{
                              padding: "7px 12px",
                              fontSize: 13,
                              fontWeight: 600,
                              background: "var(--df-accent)",
                              color: "var(--df-accent-contrast, var(--df-bg-base))",
                              border: "1px solid var(--df-accent)",
                              borderRadius: "var(--df-r-sm, 4px)",
                              cursor: "pointer",
                            }}
                          >
                            {t("editor.sandbox.gate.enable")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Canvas-pinned status pill removed 2026-05-20 — the global
                    processing banner above (rendered right after canvas-toolbar)
                    is the single source of truth across every tab. User
                    repro: status was appearing twice on the preview tab. */}
                  {isProcessingTurn && !iframeHtml && (
                    // Fresh project: no prior artifact to keep visible. Keep
                    // the bloom centred so the empty canvas doesn't look
                    // dead, but lighter alpha so the banner above reads
                    // first. Uses isProcessingTurn (not raw status) so the
                    // loader pops in the moment the user clicks send,
                    // before the upstream stream actually opens.
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 4,
                        background: "color-mix(in srgb, var(--df-bg-base) 92%, transparent)",
                        display: "grid",
                        placeItems: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <DfLoader relation="bloom" size={220} />
                    </div>
                  )}
                  {canvasMode === "edit" && iframeHtml && (
                    <InlineEditPanel
                      selection={inlineEditSelection}
                      iframeRect={inlineEditIframeRect}
                      onApplyStyle={handleInlineEditApplyStyle}
                      onApplyText={handleInlineEditApplyText}
                      onSave={handleInlineEditSave}
                      onCancel={handleInlineEditCancel}
                      dirty={inlineEditDirty}
                      saving={inlineEditSaving}
                    />
                  )}
                  {/* v23: ElementInspectorPanel render removed alongside select mode. */}
                </div>
              ) : isProcessingTurn ? (
                <div
                  style={{
                    flex: 1,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--df-bg-base)",
                  }}
                >
                  <DfLoader relation="bloom" size={260} />
                </div>
              ) : (
                <div className="canvas-empty">
                  <div className="canvas-empty-inner">
                    <svg
                      className="canvas-empty-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div className="canvas-empty-title">{projectName || "New project"}</div>
                    <div className="canvas-empty-sub">
                      Describe what to create in the chat. Claude will generate your design.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Regen overlay — appears over the canvas while a ratio
                regen stream is in flight. Scoped to .editor-canvas so
                the chat panel and topbar stay usable. */}
            <RatioRegenOverlay
              visible={ratioChange.phase === "regenerating"}
              targetRatio={ratioChange.phase === "regenerating" ? ratioChange.targetRatio : "16:9"}
              tokensCount={ratioChange.phase === "regenerating" ? ratioChange.tokensCount : 0}
              startedAt={ratioChange.phase === "regenerating" ? ratioChange.startedAt : Date.now()}
              onCancel={onCancelRegen}
            />
          </section>
        </div>

        {/* Debug log no longer renders inline — it lives inside the
            Diagnostics drawer (scope=dev-log), opened via the Inspector
            button in the footer or ⌘⇧D. */}
      </div>

      {/* CMD PALETTE */}
      {showCmdPalette && (
        <div className="cmd-overlay" onClick={() => setShowCmdPalette(false)}>
          <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cmd-search">
              <svg
                className="cmd-search-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="cmd-search-input"
                placeholder={t("editor.cmd.searchPlaceholder")}
                autoFocus
              />
              <span className="cmd-kbd">Esc</span>
            </div>
            <div className="cmd-section">
              <div className="cmd-section-title">Actions</div>
              {[
                { id: "generate", label: "Generate base design" },
                { id: "style", label: "Apply style" },
                { id: "component", label: "Add component" },
                { id: "export", label: "Export..." },
                { id: "undo", label: "Undo" },
                { id: "redo", label: "Redo" },
              ].map((item) => (
                <button
                  key={item.id}
                  className="cmd-item"
                  onClick={() => handlePaletteAction(item.id)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div className="cmd-item-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  <span className="cmd-item-label">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="cmd-footer">
              <span className="cmd-footer-hint">
                <span className="cmd-kbd">↑↓</span> navigate
              </span>
              <span className="cmd-footer-hint">
                <span className="cmd-kbd">↵</span> select
              </span>
              <span className="cmd-footer-hint">
                <span className="cmd-kbd">Esc</span> close
              </span>
            </div>
          </div>
        </div>
      )}

      {/* PRESENT FULLSCREEN */}
      {presenting && iframeHtml && (
        <div
          className="present-stage"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 500,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="present-exit"
            onClick={() => setPresenting(false)}
            title={t("editor.present.exit")}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              zIndex: 502,
              padding: "7px 14px",
              background: "#fff",
              border: "none",
              color: "#000",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              fontWeight: 600,
              borderRadius: "var(--df-r-md)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
            }}
          >
            {t("editor.present.exit")}
          </button>
          {/* Letterbox stage — keeps the iframe at the project's chosen
              aspect (9:16 stays vertical, 1:1 stays square, 16:9/4k stay
              wide) and centres it on the black backdrop instead of
              stretching the content to fill the viewport. */}
          <div
            style={{
              aspectRatio:
                videoRatio === "9:16" ? "9 / 16" : videoRatio === "1:1" ? "1 / 1" : "16 / 9",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "100%",
              height: "100%",
              display: "flex",
            }}
          >
            <iframe
              srcDoc={iframeSrcDocFinal ?? undefined}
              style={{ width: "100%", height: "100%", border: "none", background: "white" }}
              title="present"
              sandbox={PREVIEW_SANDBOX}
            />
          </div>
        </div>
      )}

      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* PublishDialog is not part of the current public surface.
       *  Vercel publish deferred to v2. Users now run `vercel deploy` in
       *  the terminal — CLI is already part of the dev environment. */}

      {/* Aspect ratio change confirmation — gates every regen request. */}
      <RatioChangeConfirmModal
        open={ratioChange.phase === "confirming"}
        oldRatio={videoRatio}
        targetRatio={ratioChange.phase === "confirming" ? ratioChange.targetRatio : videoRatio}
        onCancel={onCancelConfirm}
        onConfirm={onConfirmRatioChange}
      />

      {/* Inline error after a failed regen — auto-clears after 5s. */}
      {ratioChange.phase === "error" && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 600,
            padding: "10px 16px",
            background: "var(--df-accent-danger, #b94a48)",
            color: "#fff",
            fontFamily: "var(--df-font-mono)",
            fontSize: "var(--df-text-xs)",
            borderRadius: "var(--df-r-md)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            maxWidth: "min(560px, 90vw)",
          }}
        >
          {ratioChange.message}
        </div>
      )}

      <PromptConsole
        open={showFullPrompt}
        onClose={() => setShowFullPrompt(false)}
        projectName={projectName}
        userPrompt={input.trim() || undefined}
        designSystem={dsPath}
        format={canonicalPlusPayload?.format ?? null}
        formatLabel={canonicalChips?.format ?? undefined}
        rules={canonicalPlusPayload?.rules}
        taste={canonicalPlusPayload?.taste}
        dialOverrides={tasteDialOverrides}
        provider={selectedProvider}
        model={selectedModel}
        engineBlocks={inspectorBlocks}
      />

      {/* F2.1 — Attach DS mid-project modal. Owns no persistence — the
          parent handler reads/writes meta.json and updates dsPath/dsName. */}
      <AttachDsModal
        open={attachDsOpen}
        currentDsPath={dsPath}
        onSelect={handleAttachDs}
        onClose={() => setAttachDsOpen(false)}
      />

      {/* VERSION HISTORY PANEL */}
      {showVersions && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--df-surface-overlay)",
            backdropFilter: "blur(14px) saturate(1.02)",
            WebkitBackdropFilter: "blur(14px) saturate(1.02)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setShowVersions(false)}
        >
          <div
            style={{
              width: 560,
              maxHeight: "80vh",
              background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-3xl)",
              boxShadow: "var(--df-shadow-card)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "var(--df-sp-4) var(--df-sp-5)",
                borderBottom: "1px solid var(--df-border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "var(--df-text-md)", fontWeight: 600 }}>
                  Version history
                </div>
                <div
                  style={{
                    fontSize: "var(--df-text-xs)",
                    color: "var(--df-text-muted)",
                    marginTop: 2,
                  }}
                >
                  {versions.length} version{versions.length === 1 ? "" : "s"} ·{" "}
                  {versions.filter((v) => !v.auto).length} named ·{" "}
                  {versions.filter((v) => v.auto).length} auto
                </div>
              </div>
              <button
                className="df-btn df-btn--secondary"
                onClick={() => {
                  setShowVersions(false);
                  setShowSaveVersion(true);
                }}
                style={{ fontSize: "var(--df-text-xs)" }}
              >
                Save current as...
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "var(--df-sp-3) var(--df-sp-4)" }}>
              {versions.length === 0 ? (
                <div
                  style={{
                    padding: "var(--df-sp-6) 0",
                    textAlign: "center",
                    color: "var(--df-text-faint)",
                    fontSize: "var(--df-text-sm)",
                  }}
                >
                  No versions yet. Saves happen automatically on every generation.
                </div>
              ) : (
                [...versions].reverse().map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--df-sp-3)",
                      padding: "10px 12px",
                      borderRadius: "var(--df-r-md)",
                      background:
                        v.html === iframeHtml ? "var(--df-interactive-hover)" : "transparent",
                      border: "1px solid transparent",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: v.auto ? "var(--df-text-faint)" : "#5faa54",
                        flexShrink: 0,
                      }}
                      title={v.auto ? "auto save" : "named save"}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "var(--df-text-sm)",
                          color: "var(--df-text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v.name ?? (v.auto ? "auto" : "saved")}
                        {v.html === iframeHtml && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: "var(--df-text-xs)",
                              color: "var(--df-text-faint)",
                              fontFamily: "var(--df-font-mono)",
                            }}
                          >
                            · current
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--df-text-xs)",
                          color: "var(--df-text-faint)",
                          fontFamily: "var(--df-font-mono)",
                        }}
                      >
                        {new Date(v.createdAt).toLocaleString()} · ~
                        {Math.round(v.html.length / 4).toLocaleString()} tokens
                      </div>
                    </div>
                    <button
                      className="df-btn df-btn--secondary"
                      style={{ fontSize: "var(--df-text-xs)", padding: "4px 10px" }}
                      onClick={() => handleRestoreVersion(v)}
                      disabled={v.html === iframeHtml}
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => handleDeleteVersion(v.id)}
                      title="Delete version"
                      style={{
                        width: 22,
                        height: 22,
                        background: "transparent",
                        border: "none",
                        color: "var(--df-text-faint)",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SAVE VERSION DIALOG */}
      {showSaveVersion && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--df-surface-overlay)",
            backdropFilter: "blur(14px) saturate(1.02)",
            WebkitBackdropFilter: "blur(14px) saturate(1.02)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 210,
          }}
          onClick={() => setShowSaveVersion(false)}
        >
          <div
            style={{
              width: 420,
              background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-3xl)",
              boxShadow: "var(--df-shadow-card)",
              padding: "var(--df-sp-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--df-sp-3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "var(--df-text-md)", fontWeight: 600 }}>Save version</div>
            <div
              style={{
                fontSize: "var(--df-text-xs)",
                color: "var(--df-text-muted)",
                lineHeight: 1.5,
              }}
            >
              Name this save so you can restore it later. Named versions are kept indefinitely;
              auto-saves are capped at 20.
            </div>
            <input
              autoFocus
              className="df-input"
              type="text"
              placeholder="e.g. before color rework"
              value={saveVersionName}
              onChange={(e) => setSaveVersionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveVersion();
                if (e.key === "Escape") setShowSaveVersion(false);
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--df-sp-2)" }}>
              <button
                className="df-btn df-btn--secondary"
                onClick={() => setShowSaveVersion(false)}
              >
                Cancel
              </button>
              <button className="df-btn df-btn--primary" onClick={handleSaveVersion}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <ActiveVerbPill verb={activeVerb} />

      <CommandLibrary
        open={showCommandLibrary}
        verbs={verbs}
        onClose={() => setShowCommandLibrary(false)}
        onPick={(v, sendNow) => {
          setShowCommandLibrary(false);
          if (sendNow) {
            // Shift-click: stage the bare slash command in the input and
            // fire handleSend after React flushes. Dispatch in handleSend
            // picks it up via matchVerb.
            setInput(`/${v.id}`);
            requestAnimationFrame(() => {
              handleSendRef.current?.();
            });
          } else {
            // Click: insert into the input, focus the textarea, leave the
            // user to add focus context (e.g. "/polish hero only").
            setInput((prev) => {
              const trimmed = prev.trim();
              return trimmed ? `${trimmed} /${v.id} ` : `/${v.id} `;
            });
            requestAnimationFrame(() => {
              textareaRef.current?.focus();
            });
          }
        }}
      />

      {/* COMMENT POPUP */}
      {showCommentInput && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 150,
          }}
          onClick={() => {
            setShowCommentInput(false);
            setCommentTarget(null);
          }}
        >
          <div
            style={{
              width: 460,
              background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-3xl)",
              boxShadow: "var(--df-shadow-card)",
              padding: "var(--df-sp-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--df-sp-3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "var(--df-text-sm)", fontWeight: 600 }}>Pin a comment</div>
            {commentTarget && (
              <div
                style={{
                  padding: "6px 10px",
                  background: "var(--df-surface-raised)",
                  border: "1px solid var(--df-border-subtle)",
                  borderRadius: "var(--df-r-sm)",
                  fontFamily: "var(--df-font-mono)",
                  fontSize: "var(--df-text-xs)",
                  color: "var(--df-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {commentTarget.selector}
              </div>
            )}
            <textarea
              autoFocus
              className="chat-input-field"
              placeholder="What to note about this element..."
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSaveComment();
                }
                if (e.key === "Escape") {
                  setShowCommentInput(false);
                  setCommentTarget(null);
                }
              }}
              style={{ minHeight: 96, resize: "vertical" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--df-sp-2)",
              }}
            >
              <span style={{ fontSize: "var(--df-text-xs)", color: "var(--df-text-faint)" }}>
                ⌘↵ to save · comments batch in the Comments tab
              </span>
              <div style={{ display: "flex", gap: "var(--df-sp-2)" }}>
                <button
                  className="df-btn df-btn--secondary"
                  onClick={() => {
                    setShowCommentInput(false);
                    setCommentTarget(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="df-btn df-btn--primary"
                  onClick={handleSaveComment}
                  disabled={!commentDraft.trim()}
                >
                  Pin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--df-surface-elevated)",
            boxShadow: "var(--df-shadow-card)",
            padding: "10px 18px",
            borderRadius: "var(--df-r-lg)",
            fontSize: "var(--df-text-sm)",
            color: "var(--df-text-primary)",
            zIndex: 200,
          }}
        >
          {toast}
        </div>
      )}

      {/* Direction inspector lives on the toolbar's existing "Prompt"
       * pill (FullPromptModal). PromptConsole on this surface was
       * removed 2026-05-15 to avoid the duplicate-button noise —
       * PromptConsole stays in the NewProject modal for the pre-start
       * preview flow. */}
    </div>
  );
}

function ToolbarPill({
  label,
  active,
  onClick,
  children,
}: {
  id?: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="df-btn df-btn--ghost df-btn--sm"
      data-active={active}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {label}
    </button>
  );
}

// Removable canonical+ chip (Format / Rules / Taste) in the chat composer.
// Mirrors the DS pill but in a neutral tint; the × deactivates the element
// so it stops being injected into the turn.
function PromptChip({
  tag,
  label,
  title,
  onRemove,
}: {
  tag: string;
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        background: "var(--df-surface-raised)",
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-sm)",
        fontFamily: "var(--df-font-mono)",
        fontSize: 10,
        color: "var(--df-text-secondary)",
        maxWidth: 220,
      }}
    >
      <span
        style={{
          color: "var(--df-text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          flexShrink: 0,
        }}
      >
        {tag}
      </span>
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={label}
      >
        {label}
      </span>
      <button
        onClick={onRemove}
        title={title}
        style={{
          color: "var(--df-text-faint)",
          fontSize: 11,
          cursor: "pointer",
          padding: "0 2px",
          background: "none",
          border: "none",
        }}
      >
        ×
      </button>
    </span>
  );
}
