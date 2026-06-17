// inline-edit-bridge.test.ts — IIFE source + injection helper tests.
//
// The IIFE itself is a string of JavaScript that runs inside the iframe,
// so we can't directly invoke its functions from Node. Instead we:
//   1. Assert structural shape of the IIFE source (presence of new
//      handlers + message types added in Sprints B and C).
//   2. Test the injection helper roundtrips HTML correctly.
//   3. Test the parent-side listener filters by source id and event.source.

import { describe, it, expect, vi } from "vitest";
import {
  INLINE_EDIT_LISTENER_SOURCE,
  INLINE_EDIT_BRIDGE_SOURCE_ID,
  injectInlineEditListenerIntoHtml,
  listenInlineEditFromIframe,
  type InlineEditIncomingMessage,
} from "./inline-edit-bridge";

describe("INLINE_EDIT_LISTENER_SOURCE — Sprint B/C coverage", () => {
  it("includes the new style keys in the kebab-case map", () => {
    // Sprint A/B: all of these should be wired so el.style.setProperty
    // applies the correct CSS property name + important priority.
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'text-align'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'line-height'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'letter-spacing'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'opacity'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'padding'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'margin'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'border-width'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'border-style'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'border-color'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'border-radius'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'width'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'height'");
  });

  it("uses setProperty with important priority", () => {
    // Without !important, class rules using !important would win.
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'important'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("setProperty");
  });

  it("reads computed styles for the full property set", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.textAlign");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.lineHeight");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.letterSpacing");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.opacity");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.padding");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.margin");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.borderWidth");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.borderStyle");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.borderColor");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.borderRadius");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.width");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("cs.height");
  });

  it("declares the isTextOnly helper for 2-click promotion (Sprint C)", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("function isTextOnly(");
    // The check is a single child + nodeType 3.
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("childNodes.length !== 1");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("nodeType === 3");
  });

  it("declares startInlineTextEdit / endInlineTextEdit (Sprint C)", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("function startInlineTextEdit(");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("function endInlineTextEdit(");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("contenteditable");
  });

  it("emits text-changed on blur of an in-place edit (Sprint C)", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("df:inline-edit:text-changed");
  });

  it("registers blur + keydown listeners on activate (Sprint C)", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("addEventListener('blur'");
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("addEventListener('keydown'");
  });

  it("handles ESC to end inline edit OR clear selection (Sprint C)", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain("'Escape'");
  });

  it("stamps every outgoing message with the bridge source id", () => {
    expect(INLINE_EDIT_LISTENER_SOURCE).toContain(INLINE_EDIT_BRIDGE_SOURCE_ID);
  });
});

describe("injectInlineEditListenerIntoHtml", () => {
  it("appends the script before the last </body>", () => {
    const html = "<!DOCTYPE html><html><head></head><body><h1>x</h1></body></html>";
    const out = injectInlineEditListenerIntoHtml(html);
    expect(out).toContain('data-df="inline-edit-bridge"');
    // Script comes before the closing body tag.
    const scriptIdx = out.indexOf('data-df="inline-edit-bridge"');
    const bodyCloseIdx = out.lastIndexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it("falls back to append when no </body> exists", () => {
    const html = "<!DOCTYPE html><div>partial</div>";
    const out = injectInlineEditListenerIntoHtml(html);
    expect(out).toContain('data-df="inline-edit-bridge"');
    expect(out.startsWith(html)).toBe(true);
  });

  it("preserves the original HTML around the injection", () => {
    const html = "<!DOCTYPE html><html><body><h1>title</h1></body></html>";
    const out = injectInlineEditListenerIntoHtml(html);
    expect(out).toContain("<h1>title</h1>");
    expect(out).toContain("</body>");
  });
});

describe("listenInlineEditFromIframe", () => {
  function makeIframe(): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    return iframe;
  }

  it("invokes the handler for messages stamped with our source id", () => {
    const iframe = makeIframe();
    const handler = vi.fn();
    const unsub = listenInlineEditFromIframe(iframe, handler);

    // Synthesize a message with event.source === iframe.contentWindow.
    // happy-dom gives us a real contentWindow.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: INLINE_EDIT_BRIDGE_SOURCE_ID,
          type: "df:inline-edit:deselect",
        },
        source: iframe.contentWindow,
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    iframe.remove();
  });

  it("forwards the new text-changed message variant (Sprint C)", () => {
    const iframe = makeIframe();
    const handler = vi.fn();
    const unsub = listenInlineEditFromIframe(iframe, handler);

    const payload: InlineEditIncomingMessage = {
      type: "df:inline-edit:text-changed",
      path: "h1[1]",
      text: "Hello edited",
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: INLINE_EDIT_BRIDGE_SOURCE_ID, ...payload },
        source: iframe.contentWindow,
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "df:inline-edit:text-changed",
      path: "h1[1]",
      text: "Hello edited",
    });
    unsub();
    iframe.remove();
  });

  it("ignores messages from a different iframe", () => {
    const iframe = makeIframe();
    const other = makeIframe();
    const handler = vi.fn();
    const unsub = listenInlineEditFromIframe(iframe, handler);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: INLINE_EDIT_BRIDGE_SOURCE_ID,
          type: "df:inline-edit:deselect",
        },
        source: other.contentWindow,
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    unsub();
    iframe.remove();
    other.remove();
  });

  it("ignores messages without our source id", () => {
    const iframe = makeIframe();
    const handler = vi.fn();
    const unsub = listenInlineEditFromIframe(iframe, handler);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "some-other-bridge",
          type: "df:inline-edit:deselect",
        },
        source: iframe.contentWindow,
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    unsub();
    iframe.remove();
  });

  it("unsubscribe stops further calls", () => {
    const iframe = makeIframe();
    const handler = vi.fn();
    const unsub = listenInlineEditFromIframe(iframe, handler);
    unsub();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: INLINE_EDIT_BRIDGE_SOURCE_ID,
          type: "df:inline-edit:deselect",
        },
        source: iframe.contentWindow,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    iframe.remove();
  });
});
