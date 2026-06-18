// Auditor gate — Durable Chat Journal + Visible Persistence State
//
// External audit (2026-05-08) identified the chat-persistence model as P0:
// HTML artifact survived a turn, conversation did not. Schema permits robust
// persistence (chat-turns.ts), but the runtime treats it as best-effort
// side-effect, not as journal-before-provider.
//
// Audit recommendations folded into this file:
//
//   FASE 1 — contention (each item is one test below):
//     1. Save state visible in chat (saving / saved / failed / recovered)
//     2. No silent persistence failures (no .catch(() => {}) on writes)
//     3. Origin guard fatal (banner if app served from any port other than
//        the bridge-allowed origins)
//     4. Persist turn BEFORE provider call (user msg + ai.status="running"
//        lands on disk before /<provider>/stream fires)
//     5. Local recovery fallback (IndexedDB or localStorage mirror per
//        df:recovery-chat:{projectId}:{threadId})
//
//   FASE 2 — architectural (journal-as-truth):
//     - .df/chat/{threadId}/journal.ndjson (append-only events)
//     - .df/chat/{threadId}/latest.json (derived snapshot)
//     - .df/chat/{threadId}/index.json (metadata + integrity)
//
// Tests below are .todo for items that depend on Fase 1 implementation,
// .fails for invariants that fail TODAY by design (proves bug), and
// active for invariants that can be checked statically right now.
//
// Each test that flips from .todo / .fails to active in a future PR is
// the gate that PR has to pass. This file is the contract.
//
// References:
//   - docs/audits/chat-persistence-2026-05-08.md (auditor verdict, paste)
//   - src/lib/chat-turns.ts (turn schema)
//   - src/lib/claude-bridge.ts (appendChatTurn / writeChatSnapshot)
//   - src/screens/EditorScreen.tsx (handleSend — current source of truth)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChatJsonl, type Turn } from "./chat-turns";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

describe("[gate] Durable Chat Journal — auditor verdict 2026-05-08", () => {
  // ── FASE 1 #1 — save-state visible ────────────────────────────────────
  // Active gate: ChatMessage component renders a persist badge for any
  // non-default outcome ("saved" stays implicit so a healthy chat is
  // visually clean; "saving" / "recovered" / "failed" surface as small
  // inline labels under the user bubble).
  it("[Fase 1 #1] ChatMessage renders persist-state badges for non-default outcomes", () => {
    const src = readFileSync(resolve(repoRoot, "src/components/ChatMessage.tsx"), "utf8");
    expect(src).toMatch(
      /persistStatus\??:\s*"saving"\s*\|\s*"saved"\s*\|\s*"recovered"\s*\|\s*"failed"/,
    );
    expect(src).toMatch(/chat-msg-persist--saving/);
    expect(src).toMatch(/chat-msg-persist--recovered/);
    expect(src).toMatch(/chat-msg-persist--failed/);
    // Wired through from EditorScreen.
    const editor = readFileSync(resolve(repoRoot, "src/screens/EditorScreen.tsx"), "utf8");
    expect(editor).toMatch(/persistStatus=\{msg\.persist_status\}/);
  });

  // ── FASE 1 #2 — no silent persistence failures ───────────────────────
  // Static check: no `.catch(() => {})` on persistence-critical writes.
  // Active TODAY (initial state baselined; this test guards against
  // regression while Fase 1 reduces the count to zero).
  it("[Fase 1 #2] persistence-critical files never silence write failures", () => {
    // Auditor flagged these specifically (paste verbatim from verdict):
    //   "appendChatTurn, writeChatSnapshot, writeProjectMeta e similares
    //    não podem terminar em .catch(() => {}) sem surfaceError ou aviso
    //    visível."
    //
    // We grep the call sites — appendChatTurn already has surfaceError
    // wired (line ~931), but call sites in EditorScreen / useProjects
    // may still swallow.
    const filesToCheck = [
      "src/screens/EditorScreen.tsx",
      "src/hooks/useProjects.ts",
      "src/App.tsx",
    ];
    type Offender = { file: string; line: number; snippet: string };
    const offenders: Offender[] = [];
    // Auditor expansion (post-#115 review): the original list missed
    // writeGlobalConfig + a few siblings, so silent catches on those
    // calls slipped through (App.tsx:256 + EditorScreen.tsx:1630 were
    // both `writeGlobalConfig({...}).catch(() => {})` until this PR).
    // The list below is the audit's canonical persistence-write
    // surface — any new write fn that lands on disk + may fail
    // silently MUST be added here so the gate enforces a `warn(...)`
    // handler.
    const persistenceWriteFns = [
      "appendChatTurn",
      "writeChatSnapshot",
      "writeProjectMeta",
      "writeGlobalConfig",
      "writeCustomCommand",
      "writeCustomSkill",
      "setSetting",
      "writeFile",
      "mkdirViaBridge",
    ];
    for (const f of filesToCheck) {
      const src = readFileSync(resolve(repoRoot, f), "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Pattern: a persistence write followed within ~3 lines by a
        // silent .catch(() => {})
        const calls = persistenceWriteFns.find((fn) => line.includes(fn + "("));
        if (!calls) continue;
        // Look ahead 3 lines for the silent catch.
        const window = lines.slice(i, i + 4).join(" ");
        if (/\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(window)) {
          offenders.push({ file: f, line: i + 1, snippet: line.trim().slice(0, 100) });
        }
      }
    }
    // Hardened: zero silent catches on persistence-critical writes.
    // Baseline of 42 was pinned in PR #109 (hotfix to undo the
    // tautological `<= offenders.length` original); PR #112 dropped
    // every offender to a `warn(ctx)` handler from `@/lib/error-surface`.
    // From now on this gate is `.toBe(0)` — any new silent catch on a
    // persistence call fails the build.
    expect(
      offenders.length,
      `silent .catch(() => {}) detected on persistence calls — replace with .catch(warn("<context>")):\n${offenders.map((o) => `  ${o.file}:${o.line} — ${o.snippet}`).join("\n")}`,
    ).toBe(0);
  });

  // ── FASE 1 #3 — origin guard ─────────────────────────────────────────
  // Active gate: origin-guard exposes the canonical allow-list (parity
  // with daemon's DEFAULT_ALLOWED_ORIGINS), and App.tsx mounts the
  // banner. Behavioural coverage (rejects localhost:3000, accepts the
  // canonical origins, handles null/empty) lives in
  // origin-guard.test.ts; this gate just enforces the contract surface
  // so a future PR can't silently delete the layer.
  it("[Fase 1 #3] origin-guard exposes canonical origins and is mounted in App", () => {
    const guard = readFileSync(resolve(repoRoot, "src/lib/origin-guard.ts"), "utf8");
    expect(guard).toMatch(/ALLOWED_BRIDGE_ORIGINS/);
    expect(guard).toMatch(/http:\/\/localhost:1420/);
    expect(guard).toMatch(/http:\/\/127\.0\.0\.1:1420/);
    // Daemon parity — the canonical origins must match the daemon's
    // DEFAULT_ALLOWED_ORIGINS list. If a future PR adds an origin to one
    // side, this gate forces the other side to follow.
    const daemon = readFileSync(resolve(repoRoot, "apps/daemon/src/index.mjs"), "utf8");
    expect(daemon).toMatch(
      /DEFAULT_ALLOWED_ORIGINS\s*=\s*\[[\s\S]*?http:\/\/localhost:1420[\s\S]*?http:\/\/127\.0\.0\.1:1420/,
    );

    // Mount: the banner has to render on the App tree, not just exist.
    const banner = readFileSync(resolve(repoRoot, "src/components/OriginGuardBanner.tsx"), "utf8");
    expect(banner).toMatch(/checkCurrentOrigin/);
    const app = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");
    expect(app).toMatch(/<OriginGuardBanner\s*\/>/);
  });

  // ── FASE 1 #4 — turn-before-provider ─────────────────────────────────
  // The core invariant the auditor flagged. Today: handleSend awaits the
  // durable persist (persistOrRecoverTurn → daemon write or local
  // recovery) BEFORE invoking the provider stream. Original contract
  // ("appendChatTurn at start, not end") still holds — the call routes
  // through the persistInitialTurn helper now.
  //
  // Static gate: read EditorScreen.tsx, locate handleSend, assert that
  // the FIRST persistInitialTurn call appears BEFORE the FIRST provider
  // invocation (sendUserTurn / spawnStream / streamProvider). Mock-fetch
  // ordering tests would require rendering the whole editor; the source
  // contract is what matters and is the cheaper assertion.
  it("[Fase 1 #4] handleSend persists turn BEFORE invoking provider.stream", () => {
    const src = readFileSync(resolve(repoRoot, "src/screens/EditorScreen.tsx"), "utf8");
    // Slice the handleSend body — bounded large window covers the
    // whole function. We look for the FIRST `persistInitialTurn(` call
    // (the helper added after the bubble setMessages) and the FIRST
    // provider invocation (v2 sendUserTurn / legacy spawnStream /
    // streamProvider). The helper internally awaits persistOrRecoverTurn
    // which races appendChatTurn against a 500ms timeout with local
    // recovery fallback — chat-persist.test.ts covers the runtime
    // ordering; this gate just locks the source-level shape.
    const startIdx = src.indexOf("const handleSend = async");
    expect(startIdx, "handleSend not found in EditorScreen.tsx").toBeGreaterThan(0);
    const body = src.slice(startIdx, startIdx + 60_000);

    // Skip the helper definition itself — match a CALL site (newline-
    // anchored, `await persistInitialTurn(`) instead of the `const
    // persistInitialTurn =` declaration that lives at the top of
    // handleSend.
    const persistAt = body.search(/await\s+persistInitialTurn\(/);
    const sendUserTurnAt = body.indexOf("sendUserTurn(");
    const spawnStreamAt = body.indexOf("spawnStream(");
    const streamProviderAt = body.indexOf("streamProvider(");
    const candidates = [sendUserTurnAt, spawnStreamAt, streamProviderAt].filter((i) => i >= 0);
    const providerAt = candidates.length > 0 ? Math.min(...candidates) : -1;

    expect(
      persistAt,
      "persistInitialTurn must be awaited inside handleSend",
    ).toBeGreaterThanOrEqual(0);
    expect(providerAt, "no provider invocation found in handleSend window").toBeGreaterThanOrEqual(
      0,
    );
    expect(persistAt, "persistInitialTurn must precede the provider invocation").toBeLessThan(
      providerAt,
    );
  });

  // ── FASE 1 #4 (audit close-out) — comment batch path ─────────────────
  // Auditor flagged that PR #115 left sendCommentBatch with
  // `if (projectSlug) { void persistOrRecoverTurn(...) }` — the void
  // call let the user bubble appear before any durable write, and the
  // projectSlug guard bypassed persistence entirely (the helper already
  // handles null slug by going to recovery). This gate locks the fix
  // shape: the batch path MUST `await persistOrRecoverTurn(` BEFORE
  // `invokeSearchReplaceEdit(` (or fallback applyStyle), and there
  // must be NO `void persistOrRecoverTurn(` anywhere in the function.
  it("[audit close-out] sendCommentBatch awaits durable persist before invokeSearchReplaceEdit", () => {
    const src = readFileSync(resolve(repoRoot, "src/screens/EditorScreen.tsx"), "utf8");
    const startIdx = src.indexOf("const sendCommentBatch = useCallback");
    expect(startIdx, "sendCommentBatch not found in EditorScreen.tsx").toBeGreaterThan(0);
    // sendCommentBatch is ~150 lines — bound the slice generously.
    const body = src.slice(startIdx, startIdx + 8_000);

    const persistAt = body.search(/await\s+persistOrRecoverTurn\(/);
    const providerAt = body.indexOf("invokeSearchReplaceEdit(");

    expect(
      persistAt,
      "sendCommentBatch must `await persistOrRecoverTurn(...)`",
    ).toBeGreaterThanOrEqual(0);
    expect(providerAt, "sendCommentBatch must invoke a provider call").toBeGreaterThanOrEqual(0);
    expect(persistAt, "persistOrRecoverTurn must precede invokeSearchReplaceEdit").toBeLessThan(
      providerAt,
    );

    // Hard-disallow the buggy shape from PR #115. If a future PR
    // accidentally reverts to `void persistOrRecoverTurn(...)` inside
    // sendCommentBatch, this assertion fails.
    expect(body).not.toMatch(/void\s+persistOrRecoverTurn\(/);
  });

  // ── FASE 1 #5 — local recovery fallback ──────────────────────────────
  // Active gate: chat-recovery exposes the localStorage roundtrip and
  // chat-persist wires it as the fallback path. Behavioural coverage
  // (timeout + http-fail + no-slug → recovered) lives in chat-persist.test.ts;
  // this gate just enforces the contract surface so a future PR can't
  // silently drop the recovery layer.
  it("[Fase 1 #5] chat-recovery + chat-persist expose the fallback contract", () => {
    const recovery = readFileSync(resolve(repoRoot, "src/lib/chat-recovery.ts"), "utf8");
    expect(recovery).toMatch(/df:recovery-chat/);
    expect(recovery).toMatch(/export function saveRecovery/);
    expect(recovery).toMatch(/export function readRecovery/);
    expect(recovery).toMatch(/export function clearRecovery/);

    const persist = readFileSync(resolve(repoRoot, "src/lib/chat-persist.ts"), "utf8");
    expect(persist).toMatch(/saveRecovery\(/);
    // Helper must race against a timeout — bounded latency is half of
    // why this layer exists. The default knob lives next to the constant.
    expect(persist).toMatch(/timeoutMs/);
    // Status union covers every outcome the UI may render.
    expect(persist).toMatch(/PersistStatus\s*=\s*"saved"\s*\|\s*"recovered"\s*\|\s*"failed"/);
  });

  // ── FASE 2 — architectural journal ───────────────────────────────────
  it.todo(
    "[Fase 2] .df/chat/{threadId}/journal.ndjson exists and is append-only with typed events",
  );
  it.todo("[Fase 2] .df/chat/{threadId}/latest.json is regenerated as derived view of journal");
  it.todo("[Fase 2] .df/chat/{threadId}/index.json carries integrity + last_turn_id + turn_count");

  // ── Auditor's six obligatory test scenarios ──────────────────────────
  it.todo(
    "[scenario 1/6] new project + initial prompt → journal contains turn_started before first done",
  );
  it.todo(
    "[scenario 2/6] reload mid-stream → user message appears, partial AI shows as interrupted/running",
  );
  it.todo(
    "[scenario 3/6] generation with file → artifact_written event linked to turn_id in journal",
  );
  // Fase 2 (audit verdict 2026-05-08, post-#110 review): "sync on
  // reconnect" — recovery entries that landed in localStorage during a
  // daemon outage have to flush back to disk on the next opportunity
  // (boot, focus, online). Behavioural coverage in
  // chat-recovery-sync.test.ts; this gate just locks the contract
  // surface (worker exists + boot trigger wired in App).
  it("[scenario 4/6] daemon offline → recovery local saves AND sync on reconnect is wired", () => {
    const sync = readFileSync(resolve(repoRoot, "src/lib/chat-recovery-sync.ts"), "utf8");
    expect(sync).toMatch(/export async function syncRecoveryQueue/);
    expect(sync).toMatch(/export function startRecoverySync/);
    // Triggers: boot pass, window focus, online event.
    expect(sync).toMatch(/window\.addEventListener\("focus"/);
    expect(sync).toMatch(/window\.addEventListener\("online"/);
    // Mounted in App at boot — without this the worker never runs.
    const app = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");
    expect(app).toMatch(/startRecoverySync\(\)/);
  });
  it.todo("[scenario 5/6] wrong origin → app blocks or warns, no chat persists if not allowed");
  it.todo("[scenario 6/6] project switch → turn from project A never lands in project B journal");
});

// Companion describe — invariants that ARE active today and must stay green.
// These are the parts that already work; Fase 1/2 must not regress them.

describe("[gate] persistence baseline that already works", () => {
  it("appendChatTurn surfaces failures via surfaceError (line ~931 of claude-bridge.ts)", () => {
    const src = readFileSync(resolve(repoRoot, "src/lib/claude-bridge.ts"), "utf8");
    // Both branches (HTTP non-OK and thrown error) must call surfaceError.
    expect(src).toMatch(/surfaceError\([^)]*`appendChatTurn\(/);
  });

  it("writeChatSnapshot surfaces failures via surfaceError", () => {
    const src = readFileSync(resolve(repoRoot, "src/lib/claude-bridge.ts"), "utf8");
    expect(src).toMatch(/surfaceError\([^)]*`writeChatSnapshot\(/);
  });

  it("AiStatus type and TurnAiSchema enum stay in lockstep (parity gate)", () => {
    // Audit P1.1 (post-#116 review): the TS type in chat-turns.ts and
    // the Zod enum in schemas.ts MUST list the exact same status
    // values. Pre-2026-05-08 they had drifted —
    //   chat-turns.ts: ["running","done","error","cancelled"]
    //   schemas.ts:    ["done","error","incomplete"]
    // — and turns emitted by turn-pipeline with `cancelled` were
    // silently rejected by safeWriteOrThrow at appendChatTurn time.
    // The canonical lifecycle is now:
    //   "running" | "done" | "error" | "cancelled" | "interrupted"
    // (interrupted reserved for the upcoming stream-lifecycle audit
    // idle-watchdog work.)
    const expected = ["running", "done", "error", "cancelled", "interrupted"] as const;

    const turnsSrc = readFileSync(resolve(repoRoot, "src/lib/chat-turns.ts"), "utf8");
    // Pull the literal union out of the source — order-insensitive.
    const tsMatch = turnsSrc.match(/export type AiStatus\s*=\s*([^;]+);/);
    expect(tsMatch, "AiStatus type not found in chat-turns.ts").not.toBeNull();
    const tsValues = (tsMatch![1].match(/"[a-z]+"/g) ?? []).map((s) => s.slice(1, -1)).sort();
    expect(tsValues).toEqual([...expected].sort());

    const schemaSrc = readFileSync(resolve(repoRoot, "src/lib/schemas.ts"), "utf8");
    // Find the TurnAiSchema status enum and pull its members.
    const schemaMatch = schemaSrc.match(/status:\s*z\.enum\(\[([^\]]+)\]\)/);
    expect(schemaMatch, "TurnAiSchema status enum not found").not.toBeNull();
    const schemaValues = (schemaMatch![1].match(/"[a-z]+"/g) ?? [])
      .map((s) => s.slice(1, -1))
      .sort();
    expect(schemaValues).toEqual([...expected].sort());

    // Pre-2026-05-08 dead value — must not come back.
    expect(schemaValues).not.toContain("incomplete");
  });

  it("FileView sanitizes markdown before dangerouslySetInnerHTML", () => {
    // Audit P1.2 (post-#116 review): markdown rendered via marked.parse
    // + dangerouslySetInnerHTML is XSS surface when the source comes
    // from agent output, imported docs, or any untrusted file. Locking
    // the shape so a future refactor can't silently drop the sanitizer.
    const src = readFileSync(resolve(repoRoot, "src/components/FileView.tsx"), "utf8");
    expect(src).toMatch(/renderMarkdownSafe/);
    const helper = readFileSync(resolve(repoRoot, "src/lib/safe-markdown.ts"), "utf8");
    expect(helper).toMatch(/import DOMPurify from "dompurify"/);
    expect(helper).toMatch(/DOMPurify\.sanitize\(/);
    // The dangerouslySetInnerHTML site must consume the sanitised
    // string, not the raw marked output.
    expect(src).not.toMatch(/dangerouslySetInnerHTML[\s\S]{0,160}__html:\s*marked\.parse/);
  });

  it("FileView iframe sandbox does NOT allow-same-origin", () => {
    // Audit P1.3: `allow-scripts allow-same-origin` is the most
    // permissive combo — script + parent-origin access. For user-
    // opened HTML files we want scripts to run (animations /
    // interactivity render) but with a unique opaque origin so the
    // script can't reach into the app's localStorage / cookies /
    // IndexedDB. Compare with src/runtime/runtime-p0.ts which already
    // uses this posture.
    const src = readFileSync(resolve(repoRoot, "src/components/FileView.tsx"), "utf8");
    expect(src).not.toMatch(/sandbox=("|')allow-scripts allow-same-origin/);
    expect(src).toMatch(/FILE_PREVIEW_SANDBOX\s*=\s*"allow-scripts"/);
  });

  it("preview tab keeps the iframe mounted across canvas tab switches", () => {
    // User repro 2026-05-08: switching to Files / Terminal / file tab
    // unmounted the preview iframe — return to preview re-rendered fresh
    // (lost scroll, DOM state, JS heap, load handler ran again). Other
    // tabs already preserved state via display toggle. The fix wraps the
    // preview tree in a div whose `display` toggles based on whether
    // the active tab is preview — iframe stays mounted, only its
    // visibility changes.
    const src = readFileSync(resolve(repoRoot, "src/screens/EditorScreen.tsx"), "utf8");
    // Old bug shape — `{currentTab?.kind === "preview" && (` directly
    // wrapping the iframe tree. If a future PR reverts to this shape,
    // the iframe gets unmounted again.
    expect(src).not.toMatch(/\{\s*currentTab\?\.kind\s*===\s*"preview"\s*&&\s*\(/);
    // New shape — the wrapper toggles display based on preview kind.
    expect(src).toMatch(
      /display:\s*currentTab\?\.kind\s*===\s*"preview"\s*\?\s*"flex"\s*:\s*"none"/,
    );
  });

  it("handleReload re-reads canonical file from disk before re-mounting iframe", () => {
    // Repro 2026-05-08: user asked the agent for a tweak, agent
    // edited the file via Edit tool, disk had the new HTML, but the DF
    // preview kept showing the old version after Refresh because
    // handleReload only bumped iframeKey without touching React state.
    // File-manager-from-OS showed the new version (reads disk directly),
    // proving the divergence. The fix: refresh always re-hydrates from
    // disk first, then re-mounts.
    const src = readFileSync(resolve(repoRoot, "src/screens/EditorScreen.tsx"), "utf8");
    const idx = src.indexOf("const handleReload = ");
    expect(idx, "handleReload not found in EditorScreen.tsx").toBeGreaterThan(0);
    const body = src.slice(idx, idx + 3000);
    expect(body).toMatch(/readFileViaBridge\(primaryPath\)/);
    expect(body).toMatch(/setIframeHtml\(fromDisk\)/);
    expect(body).toMatch(/setIframeKey\(\(k\)\s*=>\s*k\s*\+\s*1\)/);
  });

  it("useClaude wires the idle watchdog + suspicious-done detector", () => {
    // Stream Lifecycle audit (post-#118 review). User repro on 3d21:
    // turn t1778263371490 ended with status=done + 4-char "Você" + zero
    // tools (suspicious-done); turn t1778267104005 stayed streaming
    // forever (idle stream). Both modes need the runtime hooks the
    // useClaude hook gained in this PR — locking the wiring shape so
    // a future refactor can't silently drop either detector.
    const src = readFileSync(resolve(repoRoot, "src/hooks/useClaude.ts"), "utf8");
    expect(src).toMatch(/from "@\/lib\/stream-lifecycle"/);
    expect(src).toMatch(/createIdleWatchdog\(/);
    expect(src).toMatch(/isSuspiciousDone\(/);
    // The status union must include "interrupted" — added so the chat
    // surface can distinguish a watchdog-terminated stream from an
    // explicit cancel ("idle") or provider error ("error").
    expect(src).toMatch(/GenerationStatus\s*=[^;]*"interrupted"/);
    // Watchdog must stop on done/error/cancel paths so a finished
    // stream can't fire a delayed interrupt.
    const stopOccurrences = (src.match(/watchdogRef\.current\?\.stop\(\)/g) ?? []).length;
    expect(
      stopOccurrences,
      "watchdog must be stopped in done/error/cancel paths",
    ).toBeGreaterThanOrEqual(3);
  });
});

// ─── parseChatJsonl dedupe contract — added in PR #108 hotfix ──────────────
// handleSend now writes the same turn id twice: once with ai:null when the
// user sends, and again with the terminal ai state when the stream ends.
// parseChatJsonl must collapse those two lines into a single Turn so the
// chat shows one bubble per turn, with the terminal state. Auditor flagged
// the absence of these tests in the #108 review.

describe("[gate] parseChatJsonl dedupes by turn id (last-occurrence wins)", () => {
  const placeholderTurn: Turn = {
    id: "t-dedup-1",
    ts: 1_700_000_000_000,
    user: { text: "hello", attachments: [], verb: null },
    ai: null,
  };
  const terminalTurn: Turn = {
    id: "t-dedup-1",
    ts: 1_700_000_000_500,
    user: { text: "hello", attachments: [], verb: null },
    ai: {
      text: "hi back",
      tools: [],
      status: "done",
    },
  };

  it("placeholder + terminal with same id collapses to one terminal turn", () => {
    const parsed = parseChatJsonl([placeholderTurn, terminalTurn]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t-dedup-1");
    expect(parsed[0].ai).not.toBeNull();
    expect(parsed[0].ai?.status).toBe("done");
    expect(parsed[0].ai?.text).toBe("hi back");
  });

  it("preserves first-seen chronological order across multiple deduped turns", () => {
    const a1: Turn = { id: "a", ts: 1, user: { text: "first" }, ai: null };
    const b1: Turn = { id: "b", ts: 2, user: { text: "second" }, ai: null };
    const a2: Turn = {
      id: "a",
      ts: 3,
      user: { text: "first" },
      ai: { text: "ans-a", tools: [], status: "done" },
    };
    const b2: Turn = {
      id: "b",
      ts: 4,
      user: { text: "second" },
      ai: { text: "ans-b", tools: [], status: "done" },
    };
    // Disk sequence: a placeholder, b placeholder, a terminal, b terminal.
    // After dedup the chat must read [a-final, b-final] in that order
    // (first-seen wins for position; latest-seen wins for content).
    const parsed = parseChatJsonl([a1, b1, a2, b2]);
    expect(parsed.map((t) => t.id)).toEqual(["a", "b"]);
    expect(parsed[0].ai?.text).toBe("ans-a");
    expect(parsed[1].ai?.text).toBe("ans-b");
  });

  it("a terminal-only turn (no preceding placeholder) is unaffected by dedup", () => {
    // Older turns on disk pre-#108 only have the end-of-stream write.
    // Dedup must not silently drop them.
    const parsed = parseChatJsonl([terminalTurn]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ai?.status).toBe("done");
  });
});
