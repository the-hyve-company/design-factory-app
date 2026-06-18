// chat-attachment-schema.test.ts — Zod contract for chat attachment.
//
// (2026-05-06) — guards the schema contract for attachments persisted
// in TurnUserSchema.attachments. Backward-compat is the load-bearing
// promise: any legacy turn on disk MUST keep parsing through TurnSchema
// even though it has no `attachments` field, and any turn with
// attachments MUST round-trip without losing fields.

import { describe, it, expect } from "vitest";
import { ChatAttachmentSchema, TurnSchema, type ChatAttachment } from "./schemas";

describe("ChatAttachmentSchema", () => {
  it("accepts a minimal HTML attachment with content inline", () => {
    const att: ChatAttachment = {
      name: "page.html",
      size: 1024,
      mime: "text/html",
      kind: "html",
      content: "<!doctype html>",
    };
    const parsed = ChatAttachmentSchema.parse(att);
    expect(parsed.name).toBe("page.html");
    expect(parsed.kind).toBe("html");
  });

  it("accepts an image attachment with path-only (content omitted)", () => {
    const att: ChatAttachment = {
      name: "hero.png",
      size: 50_000,
      mime: "image/png",
      kind: "image",
      path: "/abs/.df-attachments/hero.png",
    };
    const parsed = ChatAttachmentSchema.parse(att);
    expect(parsed.path).toBe("/abs/.df-attachments/hero.png");
    expect(parsed.content).toBeUndefined();
  });

  it("defaults kind to 'binary' when omitted", () => {
    // Backward-compat: legacy disks without `kind` parse as binary so
    // chip glyph stays sensible.
    const parsed = ChatAttachmentSchema.parse({
      name: "blob.dat",
      size: 100,
      mime: "application/octet-stream",
    });
    expect(parsed.kind).toBe("binary");
  });

  it("rejects attachments without a name", () => {
    expect(() =>
      ChatAttachmentSchema.parse({
        size: 100,
        mime: "text/plain",
      }),
    ).toThrow();
  });

  it("rejects negative sizes", () => {
    expect(() =>
      ChatAttachmentSchema.parse({
        name: "x",
        size: -1,
        mime: "text/plain",
      }),
    ).toThrow();
  });
});

describe("TurnSchema with attachments", () => {
  it("parses a turn with attachments persisted on the user side", () => {
    const turn = {
      id: "turn-1",
      ts: 1_700_000_000_000,
      user: {
        text: "make this prettier",
        attachments: [
          {
            name: "ref.html",
            size: 4321,
            mime: "text/html",
            kind: "html",
            content: "<html></html>",
          },
          { name: "shot.png", size: 50_000, mime: "image/png", kind: "image", path: "/p/shot.png" },
        ],
      },
      ai: null,
    };
    const parsed = TurnSchema.parse(turn);
    expect(parsed.user.attachments).toHaveLength(2);
    expect(parsed.user.attachments?.[0].kind).toBe("html");
    expect(parsed.user.attachments?.[1].path).toBe("/p/shot.png");
  });

  it("parses a legacy turn (no attachments field) — backward-compat", () => {
    // v0– turns on disk have no `attachments`. This MUST keep parsing
    // or every existing chat history breaks on reload.
    const legacy = {
      id: "turn-0",
      ts: 1_700_000_000_000,
      user: { text: "make a hero" },
      ai: null,
    };
    const parsed = TurnSchema.parse(legacy);
    expect(parsed.user.attachments).toBeUndefined();
    expect(parsed.user.text).toBe("make a hero");
  });

  it("preserves verb metadata when attachments coexist with a verb", () => {
    const turn = {
      id: "turn-2",
      ts: 1_700_000_000_000,
      user: {
        text: "/polish",
        verb: { id: "polish", label: "Polish", category: "refine", modifiesHtml: true },
        attachments: [
          { name: "ref.png", size: 100, mime: "image/png", kind: "image", path: "/r.png" },
        ],
      },
      ai: null,
    };
    const parsed = TurnSchema.parse(turn);
    expect(parsed.user.verb?.id).toBe("polish");
    expect(parsed.user.attachments).toHaveLength(1);
  });
});
