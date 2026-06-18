import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TWEAKS_LISTENER_SOURCE,
  TWEAKS_BRIDGE_SOURCE_ID,
  injectTweaksListenerIntoHtml,
  postTweaksToIframe,
  listenTweaksFromIframe,
  isTweaksIncoming,
  createThrottledTweaksSender,
} from "./tweaks-bridge";

describe("TWEAKS_LISTENER_SOURCE", () => {
  it("is a self-contained IIFE", () => {
    expect(TWEAKS_LISTENER_SOURCE.startsWith("(() => {")).toBe(true);
    expect(TWEAKS_LISTENER_SOURCE.endsWith("})();")).toBe(true);
  });

  it("references the canonical source ID and message types", () => {
    expect(TWEAKS_LISTENER_SOURCE).toContain(TWEAKS_BRIDGE_SOURCE_ID);
    expect(TWEAKS_LISTENER_SOURCE).toContain("df:tweaks:update");
    expect(TWEAKS_LISTENER_SOURCE).toContain("df:tweaks:reset");
    expect(TWEAKS_LISTENER_SOURCE).toContain("df:tweaks:export");
    expect(TWEAKS_LISTENER_SOURCE).toContain("df:resize");
  });

  it("never throws when parsed by `new Function`", () => {
    expect(() => new Function(TWEAKS_LISTENER_SOURCE)).not.toThrow();
  });

  it("references postMessage but no cross-frame DOM reads", () => {
    // Strict-sandbox compliance: the listener lives INSIDE the iframe
    // and must not assume access to `parent.document` / `top.document`.
    expect(TWEAKS_LISTENER_SOURCE).toContain("postMessage");
    expect(TWEAKS_LISTENER_SOURCE).not.toContain("parent.document");
    expect(TWEAKS_LISTENER_SOURCE).not.toContain("top.document");
  });
});

describe("injectTweaksListenerIntoHtml", () => {
  it("injects the listener just before </body>", () => {
    const html = "<!DOCTYPE html><html><body><h1>hi</h1></body></html>";
    const out = injectTweaksListenerIntoHtml(html);
    const bodyClose = out.indexOf("</body>");
    const tagOpen = out.indexOf('<script data-df="tweaks-bridge">');
    expect(tagOpen).toBeGreaterThan(0);
    expect(tagOpen).toBeLessThan(bodyClose);
    expect(out).toContain(TWEAKS_BRIDGE_SOURCE_ID);
  });

  it("appends the listener when </body> is missing", () => {
    const html = "<svg width='10' height='10'></svg>";
    const out = injectTweaksListenerIntoHtml(html);
    expect(out.endsWith("</script>")).toBe(true);
  });

  it("uses the LAST </body> when multiple appear (defense vs <pre>)", () => {
    const html =
      "<!DOCTYPE html><html><body><pre>example: &lt;/body&gt;</pre>" + "<p>real</p></body></html>";
    const out = injectTweaksListenerIntoHtml(html);
    const preEnd = out.indexOf("</pre>");
    const tagOpen = out.indexOf('<script data-df="tweaks-bridge">');
    expect(tagOpen).toBeGreaterThan(preEnd);
  });
});

describe("isTweaksIncoming", () => {
  it("accepts a well-formed update ack", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:ack",
        ack: "update",
      }),
    ).toBe(true);
  });

  it("accepts a well-formed reset ack", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:ack",
        ack: "reset",
      }),
    ).toBe(true);
  });

  it("accepts a well-formed export-result", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:export-result",
        cssVars: { "--bg": "red" },
        cssText: ":root { --bg: red; }",
      }),
    ).toBe(true);
  });

  it("accepts a well-formed resize report", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:resize",
        height: 800,
      }),
    ).toBe(true);
  });

  it("rejects payloads with wrong source", () => {
    expect(
      isTweaksIncoming({
        source: "df-runtime-probe",
        type: "df:tweaks:ack",
        ack: "update",
      }),
    ).toBe(false);
  });

  it("rejects payloads with bad ack value", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:ack",
        ack: "bogus",
      }),
    ).toBe(false);
  });

  it("rejects export-result without cssText", () => {
    expect(
      isTweaksIncoming({
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:export-result",
        cssVars: {},
      }),
    ).toBe(false);
  });

  it("rejects null / non-objects / arrays / unknown types", () => {
    expect(isTweaksIncoming(null)).toBe(false);
    expect(isTweaksIncoming(undefined)).toBe(false);
    expect(isTweaksIncoming(42)).toBe(false);
    expect(isTweaksIncoming("hi")).toBe(false);
    expect(isTweaksIncoming([])).toBe(false);
    expect(isTweaksIncoming({ source: TWEAKS_BRIDGE_SOURCE_ID, type: "unknown" })).toBe(false);
  });
});

describe("postTweaksToIframe", () => {
  it("calls iframe.contentWindow.postMessage with the payload", () => {
    const post = vi.fn();
    const fakeIframe = {
      contentWindow: { postMessage: post } as unknown as Window,
    } as unknown as HTMLIFrameElement;
    postTweaksToIframe(fakeIframe, {
      type: "df:tweaks:update",
      cssVars: { "--accent": "#ef5d3b" },
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toEqual({
      type: "df:tweaks:update",
      cssVars: { "--accent": "#ef5d3b" },
    });
    expect(post.mock.calls[0]?.[1]).toBe("*");
  });

  it("no-ops when contentWindow is null", () => {
    const fakeIframe = { contentWindow: null } as unknown as HTMLIFrameElement;
    expect(() => postTweaksToIframe(fakeIframe, { type: "df:tweaks:reset" })).not.toThrow();
  });
});

describe("listenTweaksFromIframe — anti-spoofing", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
  });

  afterEach(() => {
    iframe.remove();
  });

  it("receives messages whose source matches the iframe contentWindow", () => {
    const handler = vi.fn();
    const unsubscribe = listenTweaksFromIframe(iframe, handler);
    const payload = {
      source: TWEAKS_BRIDGE_SOURCE_ID,
      type: "df:tweaks:ack" as const,
      ack: "update" as const,
    };
    // happy-dom: dispatch a MessageEvent with the iframe's contentWindow
    // as the source. We have to construct it manually because window.postMessage
    // doesn't fire same-window listeners with the contentWindow as ev.source.
    const ev = new MessageEvent("message", {
      data: payload,
      source: iframe.contentWindow,
    });
    window.dispatchEvent(ev);
    expect(handler).toHaveBeenCalledWith(payload);
    unsubscribe();
  });

  it("ignores messages from foreign windows (spoofing defense)", () => {
    const handler = vi.fn();
    const unsubscribe = listenTweaksFromIframe(iframe, handler);
    const payload = {
      source: TWEAKS_BRIDGE_SOURCE_ID,
      type: "df:tweaks:ack" as const,
      ack: "update" as const,
    };
    const ev = new MessageEvent("message", {
      data: payload,
      source: window, // wrong source — should be iframe.contentWindow
    });
    window.dispatchEvent(ev);
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("ignores messages without the tweaks-bridge source ID", () => {
    const handler = vi.fn();
    const unsubscribe = listenTweaksFromIframe(iframe, handler);
    // A spoof attempt where the attacker controls the source window but
    // forgets the bridge stamp. Example: the runtime probe firing into
    // the same parent.
    const ev = new MessageEvent("message", {
      data: {
        source: "df-runtime-probe",
        type: "df:tweaks:ack",
        ack: "update",
      },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(ev);
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("unsubscribe stops further deliveries and is idempotent", () => {
    const handler = vi.fn();
    const unsubscribe = listenTweaksFromIframe(iframe, handler);
    unsubscribe();
    unsubscribe();
    const ev = new MessageEvent("message", {
      data: {
        source: TWEAKS_BRIDGE_SOURCE_ID,
        type: "df:tweaks:ack" as const,
        ack: "update" as const,
      },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(ev);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("createThrottledTweaksSender", () => {
  it("coalesces multiple rapid updates into a single rAF flush", async () => {
    const post = vi.fn();
    const fakeIframe = {
      contentWindow: { postMessage: post } as unknown as Window,
    } as unknown as HTMLIFrameElement;
    const send = createThrottledTweaksSender(fakeIframe);
    send({ "--a": "1" });
    send({ "--b": "2" });
    send({ "--a": "3" });
    expect(post).not.toHaveBeenCalled();
    // Wait for the rAF flush. happy-dom advances rAF on the next macrotask.
    await new Promise((r) => setTimeout(r, 32));
    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0]?.[0] as { cssVars: Record<string, string> };
    expect(call.cssVars).toEqual({ "--a": "3", "--b": "2" });
  });
});

describe("Tweaks listener semantics — eval inside happy-dom", () => {
  // Black-box test: actually eval the listener IIFE inside this happy-dom
  // window. Because we eval directly, `window.parent === window`, so we
  // can intercept its postMessage to observe outgoing acks.
  //
  // Each test re-evals into a fresh happy-dom-style sandbox via Function.
  it("applies cssVars to the document root when receiving df:tweaks:update", async () => {
    const sent: unknown[] = [];
    // We intercept postMessage on `window.parent` — same-window in the
    // happy-dom test environment, so this is observable from here.
    const origPost = window.parent.postMessage;
    window.parent.postMessage = ((msg: unknown) => sent.push(msg)) as typeof window.postMessage;
    try {
      // eslint-disable-next-line no-new-func
      new Function(TWEAKS_LISTENER_SOURCE)();
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "df:tweaks:update", cssVars: { "--accent": "#ef5d3b" } },
        }),
      );
      // Style tag should now exist with our var.
      const el = document.getElementById("__df-tweaks-overlay__");
      expect(el).not.toBeNull();
      expect((el as HTMLStyleElement).textContent).toContain("--accent: #ef5d3b !important");
      // We expect at least one ack and one resize.
      const acks = sent.filter(
        (m) =>
          (m as Record<string, unknown>)["type"] === "df:tweaks:ack" &&
          (m as Record<string, unknown>)["source"] === TWEAKS_BRIDGE_SOURCE_ID,
      );
      expect(acks.length).toBeGreaterThan(0);
    } finally {
      window.parent.postMessage = origPost;
      // Cleanup so other tests start fresh.
      const el = document.getElementById("__df-tweaks-overlay__");
      if (el) el.remove();
    }
  });

  it("removes the overlay style on df:tweaks:reset", async () => {
    // eslint-disable-next-line no-new-func
    new Function(TWEAKS_LISTENER_SOURCE)();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "df:tweaks:update", cssVars: { "--bg": "red" } },
      }),
    );
    expect(document.getElementById("__df-tweaks-overlay__")).not.toBeNull();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "df:tweaks:reset" } }));
    expect(document.getElementById("__df-tweaks-overlay__")).toBeNull();
  });

  it("export returns the accumulated cssText", () => {
    const sent: unknown[] = [];
    const origPost = window.parent.postMessage;
    window.parent.postMessage = ((msg: unknown) => sent.push(msg)) as typeof window.postMessage;
    try {
      // eslint-disable-next-line no-new-func
      new Function(TWEAKS_LISTENER_SOURCE)();
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "df:tweaks:update", cssVars: { "--a": "1", "--b": "2" } },
        }),
      );
      window.dispatchEvent(new MessageEvent("message", { data: { type: "df:tweaks:export" } }));
      const exp = sent.find(
        (m) => (m as Record<string, unknown>)["type"] === "df:tweaks:export-result",
      ) as { cssText: string; cssVars: Record<string, string> } | undefined;
      expect(exp).toBeTruthy();
      expect(exp?.cssText).toContain("--a: 1");
      expect(exp?.cssText).toContain("--b: 2");
      expect(exp?.cssVars).toEqual({ "--a": "1", "--b": "2" });
    } finally {
      window.parent.postMessage = origPost;
      const el = document.getElementById("__df-tweaks-overlay__");
      if (el) el.remove();
    }
  });
});
