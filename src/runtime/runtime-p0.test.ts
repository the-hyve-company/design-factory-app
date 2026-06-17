import { describe, it, expect } from "vitest";
import {
  runPreviewRuntimeP0,
  detectCatastrophicRuntimeFail,
  __TEST_INTERNALS__,
  type RuntimeMetrics,
} from "./runtime-p0";
import { RUNTIME_PROBE_SOURCE_ID, RUNTIME_PROBE_MESSAGE_TYPE } from "./runtime-probe";

const { classifyMetrics, wrapSvgWithProbe } = __TEST_INTERNALS__;

function metrics(overrides: Partial<RuntimeMetrics> = {}): RuntimeMetrics {
  return {
    bodyRect: { width: 1024, height: 768 },
    visibleChildCount: 4,
    consoleErrors: [],
    fontsReady: true,
    asset404s: [],
    firstPaintMs: 220,
    ...overrides,
  };
}

describe("classifyMetrics — happy path", () => {
  it("returns pass when nothing is wrong", () => {
    const r = classifyMetrics(metrics());
    expect(r.status).toBe("pass");
  });
});

describe("classifyMetrics — catastrophic", () => {
  it("flags blank-screen when body has no area and zero visible kids", () => {
    const r = classifyMetrics(metrics({ bodyRect: { width: 0, height: 0 }, visibleChildCount: 0 }));
    expect(r.status).toBe("catastrophic");
    if (r.status === "catastrophic") expect(r.reason).toBe("blank-screen");
  });

  it("flags syntax-error-pre-paint on early SyntaxError", () => {
    const r = classifyMetrics(
      metrics({
        consoleErrors: ["Uncaught SyntaxError: Unexpected token '}'"],
        firstPaintMs: 80,
      }),
    );
    expect(r.status).toBe("catastrophic");
    if (r.status === "catastrophic") expect(r.reason).toBe("syntax-error-pre-paint");
  });

  it("flags body-invisible when body has area but no visible children", () => {
    const r = classifyMetrics(metrics({ visibleChildCount: 0 }));
    expect(r.status).toBe("catastrophic");
    if (r.status === "catastrophic") expect(r.reason).toBe("body-invisible");
  });

  it("does NOT classify late SyntaxError as catastrophic", () => {
    // After the first 200ms, a SyntaxError no longer counts as
    // pre-paint — it's a runtime issue, not a render-blocker.
    const r = classifyMetrics(
      metrics({
        consoleErrors: ["SyntaxError: thrown by handler"],
        firstPaintMs: 800,
      }),
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("console-error-critical");
  });
});

describe("classifyMetrics — soft fails", () => {
  it("flags console-error-critical for any console error", () => {
    const r = classifyMetrics(metrics({ consoleErrors: ["TypeError: foo is undefined"] }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("console-error-critical");
  });

  it("flags asset-404-critical for any local asset 404", () => {
    const r = classifyMetrics(metrics({ asset404s: ["/missing.png"] }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("asset-404-critical");
  });

  it("flags fonts-failed when fonts API reported failure", () => {
    const r = classifyMetrics(metrics({ fontsReady: false }));
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("fonts-failed");
  });
});

describe("detectCatastrophicRuntimeFail", () => {
  it("returns the catastrophic reason when status is catastrophic", () => {
    expect(
      detectCatastrophicRuntimeFail({
        status: "catastrophic",
        reason: "iframe-timeout",
      }),
    ).toBe("iframe-timeout");
  });

  it("returns null on pass", () => {
    expect(
      detectCatastrophicRuntimeFail({
        status: "pass",
        metrics: metrics(),
      }),
    ).toBe(null);
  });

  it("returns null on soft fail", () => {
    expect(
      detectCatastrophicRuntimeFail({
        status: "fail",
        reason: "fonts-failed",
        metrics: metrics({ fontsReady: false }),
      }),
    ).toBe(null);
  });

  it("returns null on skipped", () => {
    expect(
      detectCatastrophicRuntimeFail({
        status: "skipped",
        reason: "type-not-previewable",
      }),
    ).toBe(null);
  });
});

describe("runPreviewRuntimeP0 — type gate", () => {
  it("skips for text/markdown", async () => {
    const r = await runPreviewRuntimeP0({ type: "text/markdown", srcdoc: "# hi" });
    expect(r.status).toBe("skipped");
  });

  it("skips for application/json", async () => {
    const r = await runPreviewRuntimeP0({ type: "application/json", srcdoc: "{}" });
    expect(r.status).toBe("skipped");
  });

  it("skips for text/css", async () => {
    const r = await runPreviewRuntimeP0({ type: "text/css", srcdoc: "body{}" });
    expect(r.status).toBe("skipped");
  });
});

describe("runPreviewRuntimeP0 — iframe lifecycle", () => {
  it("times out as catastrophic when no probe payload arrives", async () => {
    // We mount but bypass probe execution by passing srcdoc with no
    // </body> hook AND a sandbox-blocked context (we can't easily disable
    // scripts here, so we set a very short timeout and a static page that
    // never satisfies the probe — but since happy-dom DOES execute scripts,
    // we deliberately use src= to a URL that never loads).
    //
    // happy-dom's iframe doesn't fetch external URLs, so an unreachable
    // src effectively never triggers `load` and the probe never runs.
    const r = await runPreviewRuntimeP0({
      type: "text/html",
      src: "about:blank",
      timeoutMs: 50,
    });
    expect(r.status).toBe("catastrophic");
    if (r.status === "catastrophic") {
      expect(["iframe-timeout", "probe-no-payload"]).toContain(r.reason);
    }
  });

  it("returns skipped when neither src nor srcdoc is provided", async () => {
    const r = await runPreviewRuntimeP0({ type: "text/html" });
    expect(r.status).toBe("skipped");
  });

  it("accepts a forged probe payload only when source matches the iframe contentWindow", async () => {
    // Fire a postMessage from window itself BEFORE we mount; runPreviewRuntimeP0
    // should ignore it (source mismatch) and time out.
    const fakeListener = setTimeout(() => {
      // Anti-spoofing test: parent window posts a fake payload to itself.
      window.postMessage(
        {
          source: RUNTIME_PROBE_SOURCE_ID,
          type: RUNTIME_PROBE_MESSAGE_TYPE,
          bodyRect: { width: 800, height: 600 },
          visibleChildCount: 99,
          consoleErrors: [],
          fontsReady: true,
          asset404s: [],
          firstPaintMs: 100,
        },
        "*",
      );
    }, 5);
    const r = await runPreviewRuntimeP0({
      type: "text/html",
      src: "about:blank",
      timeoutMs: 80,
    });
    clearTimeout(fakeListener);
    // Whatever happens, the spoof must not be accepted as a pass.
    expect(r.status).not.toBe("pass");
  });
});

describe("wrapSvgWithProbe", () => {
  it("strips XML prolog and wraps SVG in HTML shell", () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>`;
    const wrapped = wrapSvgWithProbe(svg);
    expect(wrapped).toContain("<!DOCTYPE html>");
    expect(wrapped).toContain("<svg");
    expect(wrapped).not.toMatch(/<\?xml/);
    expect(wrapped).toContain("df-runtime-probe");
  });
});
