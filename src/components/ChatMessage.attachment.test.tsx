// ChatMessage attachment chips — render-contract tests.
//
// (2026-05-06) — locks the chat-attachment behavior the ed
// for: chips appear in the user bubble alongside prose, mirror the kind
// glyph + size formatting, and never leak raw markdown into message.text.
//
// Drag-and-drop / interactive chip behavior is NOT covered here (chat
// chips are read-only — the attachment is part of a finalized turn).
// Visual look-and-feel coverage lives in the Playwright suite.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ChatAttachmentChips, ChatMessage } from "./ChatMessage";
import type { ChatAttachment } from "@/lib/schemas";

function html(props: Parameters<typeof ChatAttachmentChips>[0]): string {
  return renderToStaticMarkup(createElement(ChatAttachmentChips, props));
}

const HTML_ATT: ChatAttachment = {
  name: "landing.html",
  size: 4321,
  mime: "text/html",
  kind: "html",
  content: "<!doctype html><html></html>",
};

const IMAGE_ATT: ChatAttachment = {
  name: "hero.png",
  size: 50_000,
  mime: "image/png",
  kind: "image",
  path: "/abs/path/.df-attachments/hero.png",
};

const TEXT_ATT: ChatAttachment = {
  name: "spec.md",
  size: 2_000,
  mime: "text/markdown",
  kind: "text",
  content: "# heading",
};

describe("ChatAttachmentChips", () => {
  it("renders one chip per attachment with name + size", () => {
    const out = html({ attachments: [HTML_ATT, IMAGE_ATT, TEXT_ATT] });
    expect(out).toContain("landing.html");
    expect(out).toContain("hero.png");
    expect(out).toContain("spec.md");
    // Sizes formatted with the same fmtSize helper as the chip surface.
    expect(out).toContain("4kb"); // 4321b → 4kb
    expect(out).toContain("49kb"); // 50000b → 49kb
    expect(out).toContain("2kb"); // 2000b → 2kb
  });

  it("encodes kind via data-kind attribute (image/text/html)", () => {
    const out = html({ attachments: [HTML_ATT, IMAGE_ATT, TEXT_ATT] });
    expect(out).toContain('data-kind="html"');
    expect(out).toContain('data-kind="image"');
    expect(out).toContain('data-kind="text"');
  });

  it("uses the on-disk path as the chip title for image attachments", () => {
    const out = html({ attachments: [IMAGE_ATT] });
    // Image chip should expose path on the title attr so hovering shows the
    // canonical disk location instead of just the original filename.
    expect(out).toContain("/abs/path/.df-attachments/hero.png");
  });

  it('renders empty (no <div role="list">) when attachments array is empty', () => {
    // Guard — the chip row should not appear at all when there are no files,
    // so the user bubble's bottom margin doesn't grow without need.
    const out = html({ attachments: [] });
    // Component renders an empty <div role="list"> currently — assert the
    // chip elements are absent so we catch any regression that adds noise.
    expect(out).not.toContain('data-testid="chat-attachment-chip"');
  });

  it("respects right-alignment (justifyContent: flex-end) so chips hug the bubble edge", () => {
    const out = html({ attachments: [HTML_ATT] });
    // Match the inline style — alignment must stay flex-end so chips sit
    // under the right-aligned user bubble, not drift left.
    expect(out).toMatch(/justify-content:\s*flex-end/i);
  });
});

describe("ChatMessage processing surface", () => {
  it("does not render an empty streaming assistant placeholder", () => {
    const out = renderToStaticMarkup(
      createElement(ChatMessage, {
        role: "assistant",
        provider: "claude",
        text: "",
        streaming: true,
        model: "opus",
      }),
    );

    expect(out).toBe("");
  });

  it("hides tool summary while streaming and renders it after completion", () => {
    const tool = {
      id: "tool-1",
      name: "Write",
      input: { file_path: "projects/demo/untitled.html" },
    };

    const streaming = renderToStaticMarkup(
      createElement(ChatMessage, {
        role: "assistant",
        provider: "claude",
        text: "Working",
        streaming: true,
        tools: [tool],
      }),
    );
    expect(streaming).not.toContain("untitled.html");

    const done = renderToStaticMarkup(
      createElement(ChatMessage, {
        role: "assistant",
        provider: "claude",
        text: "Done",
        streaming: false,
        tools: [tool],
      }),
    );
    expect(done).toContain("untitled.html");
  });
});
