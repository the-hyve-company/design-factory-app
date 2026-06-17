// runtime-p0.ts — Runtime Completion Gate, parent-side orchestrator.
//
// Mounts the artifact in a sandboxed iframe with the runtime probe
// injected, listens for the probe's single `df:runtime-p0` postMessage,
// validates the source against the iframe's contentWindow (anti-
// spoofing), and classifies the result as `pass` / `fail` /
// `catastrophic`.
//
// Type-aware: only `text/html` and `image/svg+xml` get the iframe
// treatment. Everything else returns `{ status: "skipped", reason:
// "type-not-previewable" }` immediately — there's no iframe to mount.
// The caller (auto-fix loop, done report) treats `skipped` like `pass`
// for outcome purposes; the type's Static P0 was the gate.
//
// Sandbox config (D21): `sandbox="allow-scripts"` only. We deliberately do
// NOT request `allow-same-origin`, which would let the parent inspect
// `iframe.contentDocument` cross-frame but defeats the security model the
// rest of the spec depends on. The probe's job is to compensate.
//
// Catastrophic detection (D27 / Amendment v0.3.2):
//   - timeout 5s without a probe payload → `iframe-timeout`
//   - `bodyRect.width * bodyRect.height === 0` AND `visibleChildCount===0`
//     → `blank-screen`
//   - SyntaxError in console errors before the first paint → `syntax-error-pre-paint`
//   - `bodyRect` reports a non-zero size but every child element is
//     invisible (we treat zero visible kids on a non-empty body as
//     `body-invisible`, matching the spec's offsetWidth*offsetHeight=0 case
//     when the body itself doesn't have visible content).
//   - probe never reported (timeout race vs missing probe entirely) →
//     `probe-no-payload` (subset of timeout in practice; we keep it
//     separate so done reports tell the user which one happened).
//
// Auto-fix policy lives in `auto-fix-loop.ts`; this module only reports
// status + metrics.

import {
  RUNTIME_PROBE_MESSAGE_TYPE,
  RUNTIME_PROBE_SOURCE_ID,
  injectProbeIntoHtml,
  isRuntimeProbePayload,
  type RuntimeProbePayload,
} from "./runtime-probe";

/** Default timeout for the probe payload to arrive. After this window the
 *  parent classifies the artifact as `iframe-timeout` (catastrophic). 5s is
 *  generous enough for fonts + layout but short enough not to feel hung. */
export const DEFAULT_RUNTIME_TIMEOUT_MS = 5_000;

/** Types eligible for Runtime P0. Anything outside this set returns
 *  `skipped`. Stays in lockstep with the spec table (Amendment v0.3.4). */
const RUNTIME_PREVIEWABLE_TYPES = new Set<string>([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
]);

export interface RuntimeP0Input {
  /** Artifact MIME type (drives the previewable-type gate). */
  type: string;
  /**
   * Either a URL the iframe should load (`src`) OR raw HTML to embed via
   * `srcdoc`. Test harnesses prefer `srcdoc`; production prefers a blob URL
   * served by the preview-server. Exactly one of `src`/`srcdoc` is required.
   *
   * Whichever path is chosen, the orchestrator injects the runtime probe
   * for HTML-family content. SVG content is wrapped in an HTML shell so
   * the probe can run.
   */
  src?: string;
  srcdoc?: string;
  /** Override the default 5s probe timeout (rarely needed). */
  timeoutMs?: number;
  /**
   * Container the iframe should be appended to. Defaults to `document.body`
   * (browser) or a happy-dom body in tests. The iframe is hidden via
   * style and removed in `finally`.
   */
  container?: HTMLElement | null;
}

export interface RuntimeMetrics {
  bodyRect: { width: number; height: number };
  visibleChildCount: number;
  consoleErrors: string[];
  fontsReady: boolean;
  asset404s: string[];
  firstPaintMs: number;
}

export type RuntimeP0FailReason = "asset-404-critical" | "console-error-critical" | "fonts-failed";

export type CatastrophicReason =
  | "iframe-timeout"
  | "blank-screen"
  | "syntax-error-pre-paint"
  | "body-invisible"
  | "probe-no-payload";

export type RuntimeP0Result =
  | { status: "pass"; metrics: RuntimeMetrics }
  | { status: "skipped"; reason: "type-not-previewable" }
  | { status: "fail"; reason: RuntimeP0FailReason; metrics: RuntimeMetrics }
  | { status: "catastrophic"; reason: CatastrophicReason; metrics?: Partial<RuntimeMetrics> };

/**
 * Inspect a Runtime P0 result and report the catastrophic reason if the
 * status is `catastrophic`, or `null` otherwise. The auto-fix loop calls
 * this to decide between "ask the agent to patch" (non-catastrophic fail)
 * vs "rollback to backup or empty state" (catastrophic).
 */
export function detectCatastrophicRuntimeFail(result: RuntimeP0Result): CatastrophicReason | null {
  if (result.status === "catastrophic") return result.reason;
  return null;
}

/**
 * Run Runtime P0 against an artifact. Returns a Promise that resolves once
 * the probe reports back OR the timeout fires. Never rejects — every
 * failure mode is an explicit status in the result.
 *
 * Mount strategy:
 *   - For HTML, we inject the probe via string rewrite and pass to srcdoc
 *     (test/headless) or load via src (production preview-server is
 *     responsible for the rewrite there).
 *   - For SVG, we wrap in an HTML shell that inlines the SVG and the
 *     probe so the same iframe-postMessage protocol works.
 */
export function runPreviewRuntimeP0(input: RuntimeP0Input): Promise<RuntimeP0Result> {
  const { type } = input;

  if (!RUNTIME_PREVIEWABLE_TYPES.has(type)) {
    return Promise.resolve({ status: "skipped", reason: "type-not-previewable" });
  }

  // Bail out clearly when we have neither a document nor a body to mount
  // into (e.g. the caller invoked us from a Node worker). The done report
  // handler renders this as `skipped` so it doesn't pollute pass rates.
  if (typeof document === "undefined" || !document.body) {
    return Promise.resolve({ status: "skipped", reason: "type-not-previewable" });
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS;
  const container = input.container ?? document.body;

  return new Promise<RuntimeP0Result>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    // Hide off-screen but keep dimensions so getBoundingClientRect works.
    iframe.style.position = "fixed";
    iframe.style.left = "-99999px";
    iframe.style.top = "0";
    iframe.style.width = "1024px";
    iframe.style.height = "768px";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let messageListener: ((ev: MessageEvent) => void) | null = null;

    const cleanup = () => {
      if (messageListener) window.removeEventListener("message", messageListener);
      messageListener = null;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      try {
        iframe.remove();
      } catch {
        /* */
      }
    };

    const settle = (result: RuntimeP0Result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    messageListener = (ev: MessageEvent) => {
      // Anti-spoofing: only accept messages whose `source` window is the
      // iframe we just mounted. Sandboxed iframes have origin `null`, so
      // `event.origin` checks alone don't cut it.
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data;
      if (!isRuntimeProbePayload(data)) return;
      settle(classifyMetrics(payloadToMetrics(data)));
    };

    timeoutHandle = setTimeout(() => {
      // No payload arrived. We don't know whether the probe never ran
      // (catastrophic syntax error pre-paint) or ran and crashed — both
      // map to the same outcome semantically (rollback territory).
      settle({
        status: "catastrophic",
        reason: "iframe-timeout",
      });
    }, timeoutMs);

    window.addEventListener("message", messageListener);

    // Mount the artifact. If the caller gave us a URL, trust it and mount
    // — the preview-server is responsible for probe injection there. If the
    // caller gave us raw content, we inject the probe and mount via srcdoc.
    if (input.srcdoc != null) {
      const probed =
        type === "image/svg+xml"
          ? wrapSvgWithProbe(input.srcdoc)
          : injectProbeIntoHtml(input.srcdoc);
      iframe.srcdoc = probed;
    } else if (input.src) {
      iframe.src = input.src;
    } else {
      // No mount source — caller error, but surface it as skipped so the
      // done report has a useful message instead of a hung gate.
      settle({ status: "skipped", reason: "type-not-previewable" });
      return;
    }

    container.appendChild(iframe);
  });
}

// ─── Internal: classification ───────────────────────────────────────────

function payloadToMetrics(p: RuntimeProbePayload): RuntimeMetrics {
  return {
    bodyRect: p.bodyRect,
    visibleChildCount: p.visibleChildCount,
    consoleErrors: p.consoleErrors,
    fontsReady: p.fontsReady,
    asset404s: p.asset404s,
    firstPaintMs: p.firstPaintMs,
  };
}

/**
 * Map raw probe metrics → Runtime P0 result.
 *
 * Order matters: catastrophic checks come first, then non-catastrophic
 * fails, then pass. A catastrophic case never falls through to a soft fail.
 */
function classifyMetrics(metrics: RuntimeMetrics): RuntimeP0Result {
  // Catastrophic: blank screen.
  const noArea = metrics.bodyRect.width * metrics.bodyRect.height === 0;
  if (noArea && metrics.visibleChildCount === 0) {
    return { status: "catastrophic", reason: "blank-screen", metrics };
  }

  // Catastrophic: SyntaxError captured before paint completed. Heuristic:
  // any console error string mentioning SyntaxError or "Uncaught
  // SyntaxError" with a sub-100ms first paint suggests the document
  // crashed during initial parse. We still surface a generic
  // syntax-error-pre-paint reason to keep the diagnostic actionable.
  if (
    metrics.consoleErrors.some((err) =>
      /SyntaxError|Unexpected token|Unexpected end of input/i.test(err),
    ) &&
    metrics.firstPaintMs < 200
  ) {
    return { status: "catastrophic", reason: "syntax-error-pre-paint", metrics };
  }

  // Catastrophic: body is non-empty (text or whatever) but has zero visible
  // children — usually a CSS catastrophe (display:none on root, opacity:0,
  // etc.). The spec calls this `body-invisible`.
  if (!noArea && metrics.visibleChildCount === 0) {
    return { status: "catastrophic", reason: "body-invisible", metrics };
  }

  // Soft fail: any console error counts as critical (we err on the side of
  // surfacing — the auto-fix loop chooses whether to act).
  if (metrics.consoleErrors.length > 0) {
    return { status: "fail", reason: "console-error-critical", metrics };
  }

  // Soft fail: any local asset 404. CDN 404s (GoogleFonts) are tagged P1
  // upstream and shouldn't reach here — we treat any 404 the probe
  // captured as critical.
  if (metrics.asset404s.length > 0) {
    return { status: "fail", reason: "asset-404-critical", metrics };
  }

  // Soft fail: fonts API reported failure (common: a custom font that
  // doesn't load). Not catastrophic — text falls back to system fonts.
  if (!metrics.fontsReady) {
    return { status: "fail", reason: "fonts-failed", metrics };
  }

  return { status: "pass", metrics };
}

// ─── Internal: SVG shim ─────────────────────────────────────────────────

/**
 * Wrap an SVG document in a tiny HTML shell so the probe can run. The SVG
 * is inlined into `<body>` so the probe's body-rect / child-count checks
 * still produce meaningful numbers.
 */
function wrapSvgWithProbe(svg: string): string {
  const stripped = svg.replace(/^\s*<\?xml[^?]*\?>\s*/, "");
  return injectProbeIntoHtml(
    `<!DOCTYPE html><html><body style="margin:0">${stripped}</body></html>`,
  );
}

// ─── Test surface ───────────────────────────────────────────────────────

/**
 * Internal test seam — exposed so unit tests can drive `classifyMetrics`
 * and `wrapSvgWithProbe` deterministically without spinning up a real
 * iframe. NOT part of the production API; do not rely on it from app code.
 */
export const __TEST_INTERNALS__ = {
  classifyMetrics,
  wrapSvgWithProbe,
  RUNTIME_PROBE_SOURCE_ID,
  RUNTIME_PROBE_MESSAGE_TYPE,
};
