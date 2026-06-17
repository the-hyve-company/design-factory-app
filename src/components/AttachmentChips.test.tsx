// AttachmentChips.test.tsx — render-contract tests using renderToStaticMarkup.
//
// (2026-05-06) — covers the user-level guarantees of the chip surface:
//   · Empty list → empty render (no <div> noise around the textarea).
//   · First chip carries the PRINCIPAL badge, subsequent chips don't.
//   · HTML attachments get the is-html marker (whether by mime or extension).
//   · Each chip exposes a remove button with the localized aria label.
//
// Drag-and-drop is NOT tested here because happy-dom doesn't fire native
// HTML5 drag events through React synthetic handlers — that path is
// covered by the Playwright visual suite.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AttachmentChips, isHtmlAttachment } from "./AttachmentChips";
import type { ComposerAttachment } from "./NewProjectChatComposer";

function html(props: Parameters<typeof AttachmentChips>[0]): string {
  return renderToStaticMarkup(createElement(AttachmentChips, props));
}

const HTML_ATT: ComposerAttachment = {
  name: "landing.html",
  size: 4321,
  mime: "text/html",
  content: "<!doctype html><html></html>",
  kind: "text",
};

const HTML_BY_EXT_ATT: ComposerAttachment = {
  name: "page.html",
  size: 1024,
  // Browser handed it as octet-stream — must still be detected.
  mime: "application/octet-stream",
  content: "data:application/octet-stream;base64,PCFkb2N0eXBlPg==",
  kind: "binary",
};

const IMAGE_ATT: ComposerAttachment = {
  name: "hero.png",
  size: 50_000,
  mime: "image/png",
  content: "data:image/png;base64,iVBOR...",
  kind: "image",
};

const TEXT_ATT: ComposerAttachment = {
  name: "spec.md",
  size: 2_000,
  mime: "text/markdown",
  content: "# Spec\n",
  kind: "text",
};

describe("AttachmentChips — render contract", () => {
  it("returns empty string when no attachments", () => {
    expect(html({ attachments: [], onRemove: () => {}, onReorder: () => {} })).toBe("");
  });

  it("renders one chip per attachment with name + size + remove button", () => {
    const out = html({
      attachments: [HTML_ATT, IMAGE_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    expect(out).toContain("landing.html");
    expect(out).toContain("hero.png");
    expect(out).toContain("4kb");
    expect(out).toContain("49kb");
    expect(out).toContain('aria-label="Remover landing.html"');
    expect(out).toContain('aria-label="Remover hero.png"');
  });

  it("marks the first chip as primary (PRINCIPAL badge) and skips it on the rest", () => {
    const out = html({
      attachments: [HTML_ATT, IMAGE_ATT, TEXT_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    // The first chip gets data-primary="true" + the badge text.
    const firstChipPrimary = out.indexOf('data-primary="true"');
    expect(firstChipPrimary).toBeGreaterThan(-1);
    // Only one PRINCIPAL badge in the markup — secondary chips don't carry it.
    const matches = out.match(/PRINCIPAL/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("flags HTML attachments via mime AND filename extension", () => {
    const out = html({
      attachments: [HTML_ATT, HTML_BY_EXT_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    // Both chips carry data-html="true".
    const htmlMatches = out.match(/data-html="true"/g) ?? [];
    expect(htmlMatches.length).toBe(2);
  });

  it("does not flag images or text-only attachments as HTML", () => {
    const out = html({
      attachments: [IMAGE_ATT, TEXT_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    expect(out).not.toContain('data-html="true"');
    expect(out).toContain('data-html="false"');
  });

  it("makes chips draggable only when there are 2+ attachments", () => {
    const oneChip = html({
      attachments: [HTML_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    expect(oneChip).not.toContain('draggable="true"');

    const manyChips = html({
      attachments: [HTML_ATT, IMAGE_ATT, TEXT_ATT],
      onRemove: () => {},
      onReorder: () => {},
    });
    const draggable = manyChips.match(/draggable="true"/g) ?? [];
    expect(draggable.length).toBe(3);
  });
});

describe("isHtmlAttachment — predicate", () => {
  it("returns true for text/html mime", () => {
    expect(isHtmlAttachment(HTML_ATT)).toBe(true);
  });

  it("returns true for .html extension regardless of mime", () => {
    expect(isHtmlAttachment(HTML_BY_EXT_ATT)).toBe(true);
    expect(
      isHtmlAttachment({
        ...IMAGE_ATT,
        name: "weird.htm",
      }),
    ).toBe(true);
  });

  it("returns false for non-HTML attachments", () => {
    expect(isHtmlAttachment(IMAGE_ATT)).toBe(false);
    expect(isHtmlAttachment(TEXT_ATT)).toBe(false);
  });
});
