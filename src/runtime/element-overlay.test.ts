import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ELEMENT_OVERLAY_SOURCE,
  ELEMENT_OVERLAY_SOURCE_ID,
  injectOverlayIntoHtml,
  postSelectModeToIframe,
  listenOverlayFromIframe,
  isOverlayIncoming,
  isElementSelectedPayload,
  buildAgentPromptFromSelection,
  type ElementSelectedPayload,
} from "./element-overlay";

function fixture(): ElementSelectedPayload {
  return {
    source: ELEMENT_OVERLAY_SOURCE_ID,
    type: "df:element-selected",
    selector: "main > section:nth-of-type(2) > h2",
    xpath: "/html/body/main/section[2]/h2",
    outerHtml: '<h2 class="title">Hello</h2>',
    parentOuterHtml: '<section><h2 class="title">Hello</h2></section>',
    textContent: "Hello",
    tagName: "h2",
    attrs: { class: "title" },
    boundingBox: { x: 24, y: 48, width: 320, height: 36 },
  };
}

describe("ELEMENT_OVERLAY_SOURCE", () => {
  it("is a self-contained IIFE", () => {
    expect(ELEMENT_OVERLAY_SOURCE.startsWith("(() => {")).toBe(true);
    expect(ELEMENT_OVERLAY_SOURCE.endsWith("})();")).toBe(true);
  });

  it("references the canonical source ID and message types", () => {
    expect(ELEMENT_OVERLAY_SOURCE).toContain(ELEMENT_OVERLAY_SOURCE_ID);
    expect(ELEMENT_OVERLAY_SOURCE).toContain("df:select-mode");
    expect(ELEMENT_OVERLAY_SOURCE).toContain("df:element-selected");
  });

  it("never throws when parsed by `new Function`", () => {
    expect(() => new Function(ELEMENT_OVERLAY_SOURCE)).not.toThrow();
  });

  it("references postMessage but no cross-frame DOM reads", () => {
    expect(ELEMENT_OVERLAY_SOURCE).toContain("postMessage");
    expect(ELEMENT_OVERLAY_SOURCE).not.toContain("parent.document");
    expect(ELEMENT_OVERLAY_SOURCE).not.toContain("top.document");
  });

  it("includes the setInterval re-attach watchdog", () => {
    // Spec failure mode: artifact JS removes our listeners. We defend
    // with a 200ms re-attach loop. Verify it lives in the source.
    expect(ELEMENT_OVERLAY_SOURCE).toContain("setInterval");
    expect(ELEMENT_OVERLAY_SOURCE).toContain("200");
  });
});

describe("injectOverlayIntoHtml", () => {
  it("injects the script just before </body>", () => {
    const html = "<!DOCTYPE html><html><body><h1>hi</h1></body></html>";
    const out = injectOverlayIntoHtml(html);
    const tagOpen = out.indexOf('<script data-df="element-overlay">');
    const bodyClose = out.indexOf("</body>");
    expect(tagOpen).toBeGreaterThan(0);
    expect(tagOpen).toBeLessThan(bodyClose);
    expect(out).toContain(ELEMENT_OVERLAY_SOURCE_ID);
  });

  it("appends the script when </body> is missing", () => {
    const html = "<svg width='10' height='10'></svg>";
    const out = injectOverlayIntoHtml(html);
    expect(out.endsWith("</script>")).toBe(true);
  });
});

describe("isOverlayIncoming / isElementSelectedPayload", () => {
  it("accepts a fully-formed selection payload", () => {
    expect(isOverlayIncoming(fixture())).toBe(true);
    expect(isElementSelectedPayload(fixture())).toBe(true);
  });

  it("accepts a select-mode-ack message", () => {
    expect(
      isOverlayIncoming({
        source: ELEMENT_OVERLAY_SOURCE_ID,
        type: "df:select-mode-ack",
        on: true,
      }),
    ).toBe(true);
  });

  it("rejects payloads with the wrong source", () => {
    const bad = { ...fixture(), source: "df-runtime-probe" } as unknown;
    expect(isOverlayIncoming(bad)).toBe(false);
    expect(isElementSelectedPayload(bad)).toBe(false);
  });

  it("rejects payloads missing required string fields", () => {
    const bad = { ...fixture() } as Record<string, unknown>;
    delete bad["selector"];
    expect(isElementSelectedPayload(bad)).toBe(false);
  });

  it("rejects payloads with malformed boundingBox", () => {
    const bad = { ...fixture(), boundingBox: { x: 0, y: 0, width: "wide", height: 1 } } as unknown;
    expect(isElementSelectedPayload(bad)).toBe(false);
  });

  it("rejects null / non-objects / arrays / unknown types", () => {
    expect(isOverlayIncoming(null)).toBe(false);
    expect(isOverlayIncoming(undefined)).toBe(false);
    expect(isOverlayIncoming(42)).toBe(false);
    expect(isOverlayIncoming("hi")).toBe(false);
    expect(isOverlayIncoming([])).toBe(false);
    expect(isOverlayIncoming({ source: ELEMENT_OVERLAY_SOURCE_ID, type: "unknown" })).toBe(false);
  });
});

describe("postSelectModeToIframe", () => {
  it("posts the toggle to contentWindow", () => {
    const post = vi.fn();
    const fakeIframe = {
      contentWindow: { postMessage: post } as unknown as Window,
    } as unknown as HTMLIFrameElement;
    expect(postSelectModeToIframe(fakeIframe, true)).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: "df:select-mode", on: true }, "*");
  });

  it("returns false when contentWindow is detached", () => {
    const fakeIframe = { contentWindow: null } as unknown as HTMLIFrameElement;
    expect(postSelectModeToIframe(fakeIframe, true)).toBe(false);
  });
});

describe("listenOverlayFromIframe — anti-spoofing", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
  });

  afterEach(() => {
    iframe.remove();
  });

  it("delivers selection payloads from the matching contentWindow", () => {
    const handler = vi.fn();
    const unsubscribe = listenOverlayFromIframe(iframe, handler);
    const payload = fixture();
    window.dispatchEvent(
      new MessageEvent("message", { data: payload, source: iframe.contentWindow }),
    );
    expect(handler).toHaveBeenCalledWith(payload);
    unsubscribe();
  });

  it("ignores messages from foreign source windows", () => {
    const handler = vi.fn();
    const unsubscribe = listenOverlayFromIframe(iframe, handler);
    window.dispatchEvent(new MessageEvent("message", { data: fixture(), source: window }));
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("ignores messages without the overlay source ID", () => {
    const handler = vi.fn();
    const unsubscribe = listenOverlayFromIframe(iframe, handler);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "df-runtime-probe", type: "df:element-selected" },
        source: iframe.contentWindow,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("unsubscribe is idempotent", () => {
    const handler = vi.fn();
    const unsubscribe = listenOverlayFromIframe(iframe, handler);
    unsubscribe();
    unsubscribe();
    window.dispatchEvent(
      new MessageEvent("message", { data: fixture(), source: iframe.contentWindow }),
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Element overlay semantics — eval inside happy-dom", () => {
  // Black-box test: eval the IIFE in this happy-dom window. Because we
  // are same-window, `window.parent === window`, so we intercept its
  // postMessage to observe outgoing payloads.

  let origPost: typeof window.postMessage;
  let sent: unknown[];

  beforeEach(() => {
    sent = [];
    origPost = window.parent.postMessage;
    window.parent.postMessage = ((msg: unknown) => sent.push(msg)) as typeof window.postMessage;
    document.body.innerHTML = '<main><section><h2 id="hello">Hi</h2><p>World</p></section></main>';
  });

  afterEach(() => {
    window.parent.postMessage = origPost;
    document.body.innerHTML = "";
    document.documentElement.classList.remove("__df-select-mode");
    const styleTag = document.getElementById("__df-element-overlay-style__");
    if (styleTag) styleTag.remove();
  });

  it("acks select-mode toggle and adds the documentElement class on enable", () => {
    // eslint-disable-next-line no-new-func
    new Function(ELEMENT_OVERLAY_SOURCE)();
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "df:select-mode", on: true } }),
    );
    const ack = sent.find(
      (m) => (m as Record<string, unknown>)["type"] === "df:select-mode-ack",
    ) as Record<string, unknown> | undefined;
    expect(ack).toBeTruthy();
    expect(ack?.on).toBe(true);
    expect(document.documentElement.classList.contains("__df-select-mode")).toBe(true);
  });

  it("emits df:element-selected on click while select mode is on", () => {
    // eslint-disable-next-line no-new-func
    new Function(ELEMENT_OVERLAY_SOURCE)();
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "df:select-mode", on: true } }),
    );
    const h2 = document.getElementById("hello");
    expect(h2).toBeTruthy();
    h2!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const sel = sent.find(
      (m) => (m as Record<string, unknown>)["type"] === "df:element-selected",
    ) as Record<string, unknown> | undefined;
    expect(sel).toBeTruthy();
    expect(sel?.tagName).toBe("h2");
    expect(sel?.selector).toBe("#hello");
    expect(sel?.textContent).toBe("Hi");
  });

  it("does NOT emit df:element-selected when select mode is off", () => {
    // eslint-disable-next-line no-new-func
    new Function(ELEMENT_OVERLAY_SOURCE)();
    // Explicitly turn select mode OFF first. Earlier tests may have left
    // listeners on `window` with `selectModeOn = true` since IIFE adds
    // a fresh closure each time. Sending the off toggle to all
    // accumulated instances normalises the state.
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "df:select-mode", on: false } }),
    );
    sent.length = 0; // discard the acks above
    document.getElementById("hello")!.click();
    const sel = sent.find((m) => (m as Record<string, unknown>)["type"] === "df:element-selected");
    expect(sel).toBeUndefined();
  });

  it("removes the documentElement class on disable", () => {
    // eslint-disable-next-line no-new-func
    new Function(ELEMENT_OVERLAY_SOURCE)();
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "df:select-mode", on: true } }),
    );
    expect(document.documentElement.classList.contains("__df-select-mode")).toBe(true);
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "df:select-mode", on: false } }),
    );
    expect(document.documentElement.classList.contains("__df-select-mode")).toBe(false);
  });
});

describe("buildAgentPromptFromSelection", () => {
  it("includes selector + truncated outerHtml + intent placeholder", () => {
    const out = buildAgentPromptFromSelection(fixture());
    expect(out).toContain("Selector: main > section:nth-of-type(2) > h2");
    expect(out).toContain("```html");
    expect(out).toContain('<h2 class="title">Hello</h2>');
    expect(out).toContain("{{INTENT}}");
    expect(out).toContain("Modify ONLY the element above");
  });

  it("omits text line when textContent is empty", () => {
    const sel = { ...fixture(), textContent: "" };
    const out = buildAgentPromptFromSelection(sel);
    expect(out).not.toContain("Text:");
  });
});
