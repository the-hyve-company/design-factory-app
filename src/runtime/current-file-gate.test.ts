// current-file-gate.test.ts — audit WS3 `currentfile-block-gate-by-class`.
//
// prepare()/composeSystemBlocks used to inline the ENTIRE current HTML
// into the system prompt for every provider on every edit turn. The
// gate now branches by provider class:
//
//   tool channel (claude/codex/kimi/opencode)  → pointer block: the file
//     is on disk and the provider has a native Read tool.
//   artifact channel, cold turn (anthropic, gemini w/o session) → inline
//     (only way the model sees the file).
//   artifact channel, warm resume (gemini + sessionId) → nothing: the
//     transcript already carries the file the model emitted last turn.

import { describe, it, expect } from "vitest";
import { composeSystemBlocks, shouldInlineCurrentFile } from "./prompt-composer";
import { prepare, type UserTurnInput } from "./turn-pipeline";
import type { ProjectContext } from "./prompt-composer";
import type { ProviderId } from "@/providers/types";

const HTML = "<!DOCTYPE html><html><body><h1>Edit me</h1></body></html>";

function ctxFor(providerId: ProviderId, opts: { html?: boolean; sessionId?: string } = {}) {
  const ctx: ProjectContext = {
    projectId: "gate-app",
    projectPath: "projects/gate-app",
    primaryFile: "index.html",
    mode: "hifi",
    conversationHistory: [],
    hasDesignSystem: false,
    providerId,
  };
  if (opts.html !== false) ctx.currentHtml = HTML;
  if (opts.sessionId) ctx.sessionId = opts.sessionId;
  return ctx;
}

function blockIds(ctx: ProjectContext): string[] {
  return composeSystemBlocks(ctx, { kind: "generate", lang: "en" }).map((b) => b.id);
}

describe("shouldInlineCurrentFile — unit", () => {
  it("tool channel never inlines", () => {
    expect(shouldInlineCurrentFile({ fileWrite: "tool", supportsResume: true }, "sess")).toBe(
      false,
    );
    expect(shouldInlineCurrentFile({ fileWrite: "tool" }, null)).toBe(false);
  });

  it("artifact channel inlines on cold turns", () => {
    expect(shouldInlineCurrentFile({ fileWrite: "artifact" }, null)).toBe(true);
    expect(shouldInlineCurrentFile({ fileWrite: "artifact", supportsResume: true }, null)).toBe(
      true,
    );
    expect(shouldInlineCurrentFile({ fileWrite: "artifact", supportsResume: true }, "")).toBe(true);
  });

  it("artifact channel skips the inline on a warm resume", () => {
    expect(shouldInlineCurrentFile({ fileWrite: "artifact", supportsResume: true }, "sess-1")).toBe(
      false,
    );
  });

  it("a sessionId without supportsResume does not suppress the inline", () => {
    // Stateless providers may still receive a stale sessionId from the
    // wrapper — the capability is the gate, not the id.
    expect(shouldInlineCurrentFile({ fileWrite: "artifact" }, "stale-sess")).toBe(true);
  });

  it("unknown provider defaults to artifact + inline (safest)", () => {
    expect(shouldInlineCurrentFile(undefined, null)).toBe(true);
  });
});

describe("composeSystemBlocks — current-file block by provider class", () => {
  it("claude (tool): pointer block instead of the inline", () => {
    const ids = blockIds(ctxFor("claude"));
    expect(ids).not.toContain("current-file");
    expect(ids).toContain("current-file-pointer");
    const pointer = composeSystemBlocks(ctxFor("claude"), { kind: "generate", lang: "en" }).find(
      (b) => b.id === "current-file-pointer",
    )!;
    expect(pointer.content).toContain("Read PRIMARY_FILE");
    expect(pointer.content).not.toContain(HTML);
  });

  it("codex/kimi/opencode (tool): same pointer treatment", () => {
    for (const id of ["codex", "kimi", "opencode"] as const) {
      const ids = blockIds(ctxFor(id));
      expect(ids, id).not.toContain("current-file");
      expect(ids, id).toContain("current-file-pointer");
    }
  });

  it("anthropic (artifact, stateless): inline stays", () => {
    const blocks = composeSystemBlocks(ctxFor("anthropic"), { kind: "generate", lang: "en" });
    const inline = blocks.find((b) => b.id === "current-file");
    expect(inline).toBeTruthy();
    expect(inline!.content).toContain(HTML);
    expect(blocks.map((b) => b.id)).not.toContain("current-file-pointer");
  });

  it("gemini (artifact + resume) cold start: inline stays", () => {
    const ids = blockIds(ctxFor("gemini"));
    expect(ids).toContain("current-file");
  });

  it("gemini (artifact + resume) warm turn: nothing — transcript has it", () => {
    const ids = blockIds(ctxFor("gemini", { sessionId: "gem-sess-1" }));
    expect(ids).not.toContain("current-file");
    expect(ids).not.toContain("current-file-pointer");
  });

  it("fresh write (no currentHtml): neither block, craft floor present", () => {
    const ids = blockIds(ctxFor("claude", { html: false }));
    expect(ids).not.toContain("current-file");
    expect(ids).not.toContain("current-file-pointer");
    expect(ids).toContain("craft");
  });

  it("isEdit flag on the artifact contract still keys off currentHtml, not the gate", () => {
    // A warm gemini turn drops the inline but is STILL an edit — the
    // contract must keep the F3.2 whole-file emphasis.
    const blocks = composeSystemBlocks(ctxFor("gemini", { sessionId: "gem-sess-1" }), {
      kind: "generate",
      lang: "en",
    });
    const contract = blocks.find((b) => b.id === "contract");
    expect(contract).toBeTruthy();
    expect(contract!.content).toContain("EDIT TURN");
  });
});

describe("prepare() threads the wrapper sessionId into the gate", () => {
  function inputFor(providerId: ProviderId, sessionId?: string | null): UserTurnInput {
    return {
      userMessage: "tweak the header",
      providerId,
      projectId: "gate-app",
      threadId: "main",
      context: {
        projectPath: "projects/gate-app",
        primaryFile: "index.html",
        iframeHtml: HTML,
        ...(sessionId !== undefined ? { sessionId } : {}),
      },
    };
  }

  it("gemini warm turn drops the inline from the sent prompt", () => {
    const warm = prepare(inputFor("gemini", "gem-sess-1"));
    expect(warm.systemPrompt).not.toContain("## Current index.html content");
  });

  it("gemini cold turn keeps the inline in the sent prompt", () => {
    const cold = prepare(inputFor("gemini"));
    expect(cold.systemPrompt).toContain("## Current index.html content");
  });

  it("claude edit turn sends the pointer, not the file", () => {
    const sent = prepare(inputFor("claude", "claude-sess-1"));
    expect(sent.systemPrompt).not.toContain("## Current index.html content");
    expect(sent.systemPrompt).toContain("on disk, not inlined");
  });
});
