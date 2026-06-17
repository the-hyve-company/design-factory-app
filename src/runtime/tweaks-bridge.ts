// tweaks-bridge.ts — deliverable 1.
//
// Bidirectional bridge between the DF UI and the preview iframe for
// real-time CSS-variable tweaks, without iframe srcdoc reload.
//
// Spec v0.3.4 §/ Amendment v0.3.3 sandbox spec:
//   - Iframe runs with `sandbox="allow-scripts"` (NO `allow-same-origin`
//     in the strict default). Parent therefore CANNOT read or mutate
//     `iframe.contentDocument` cross-frame.
//   - All communication flows over `window.postMessage` with origin
//     `"*"` (sandboxed iframes have origin `null`, so a string origin
//     check is meaningless — we validate `event.source` against the
//     iframe's `contentWindow` instead).
//
// Two halves live here:
//   - `TWEAKS_LISTENER_SOURCE` — the IIFE injected INTO the iframe.
//     Listens for `df:tweaks:update` / `df:tweaks:reset` /
//     `df:tweaks:export` and mutates `document.documentElement.style`.
//   - `postTweaksToIframe` / `listenTweaksFromIframe` — parent-side
//     helpers that send and receive messages with anti-spoofing.
//
// Latency target: <50ms from slider change to paint, vs ~500ms when the
// user used to wait for srcdoc reload + repaint.

/**
 * Wire-format types. The discriminated union keeps the parent and the
 * in-iframe listener agreed on a finite vocabulary; anything else is
 * treated as foreign and ignored.
 */
export type TweaksOutgoingMessage =
  | { type: "df:tweaks:update"; cssVars: Record<string, string> }
  | { type: "df:tweaks:reset" }
  | { type: "df:tweaks:export" };

export type TweaksIncomingMessage =
  | { type: "df:tweaks:export-result"; cssVars: Record<string, string>; cssText: string }
  | { type: "df:tweaks:ack"; ack: "update" | "reset" }
  | { type: "df:resize"; height: number };

export type TweaksMessage = TweaksOutgoingMessage | TweaksIncomingMessage;

/**
 * Source identifier the iframe stamps on every payload. The parent
 * filters incoming messages on this so we don't collide with the runtime
 * probe (`df-runtime-probe`), the element overlay (`df-element-overlay`),
 * or any other postMessage feature.
 */
export const TWEAKS_BRIDGE_SOURCE_ID = "df-tweaks-bridge";

/**
 * The in-iframe listener IIFE. Self-contained — no imports, no module
 * scope, safe to inject into arbitrary HTML via `<script>...</script>`.
 *
 * Behaviour:
 *   - Tracks every CSS var it has set so `df:tweaks:reset` can revert
 *     them (we can't observe vars set by the artifact's own stylesheet,
 *     so reset only undoes our overrides — never the design's defaults).
 *   - On `df:tweaks:export`, serialises the current overlay into a
 *     `:root { --x: y; }` block the user can copy.
 *   - Re-installs `MutationObserver` belt-and-suspenders: if the
 *     artifact's code wipes our `<style>` tag, we put it back. Same
 *     pattern as the element overlay's `setInterval` re-attach.
 *   - Reports body height via `df:resize` after each update — replaces
 *     the cross-frame `iframe.contentDocument.body.scrollHeight` read
 *     that the strict-sandbox model forbids.
 */
export const TWEAKS_LISTENER_SOURCE = `(() => {
  var SOURCE = 'df-tweaks-bridge';
  var STYLE_ID = '__df-tweaks-overlay__';
  var ownedVars = Object.create(null);

  function ensureStyleEl() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.tagName === 'STYLE') return el;
    el = document.createElement('style');
    el.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
    return el;
  }

  function rebuildStyleText() {
    var lines = [':root {'];
    for (var key in ownedVars) {
      if (Object.prototype.hasOwnProperty.call(ownedVars, key)) {
        lines.push('  ' + key + ': ' + ownedVars[key] + ' !important;');
      }
    }
    lines.push('}');
    return lines.join('\\n');
  }

  function applyVars(cssVars) {
    if (!cssVars || typeof cssVars !== 'object') return;
    for (var key in cssVars) {
      if (!Object.prototype.hasOwnProperty.call(cssVars, key)) continue;
      var val = cssVars[key];
      if (typeof val !== 'string' && typeof val !== 'number') continue;
      ownedVars[String(key)] = String(val);
    }
    var el = ensureStyleEl();
    el.textContent = rebuildStyleText();
  }

  function resetVars() {
    ownedVars = Object.create(null);
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function exportVars() {
    var snapshot = {};
    for (var key in ownedVars) {
      if (Object.prototype.hasOwnProperty.call(ownedVars, key)) snapshot[key] = ownedVars[key];
    }
    return { cssVars: snapshot, cssText: rebuildStyleText() };
  }

  function send(msg) {
    try {
      window.parent.postMessage(Object.assign({ source: SOURCE }, msg), '*');
    } catch (e) { /* parent gone; nothing to do. */ }
  }

  function reportResize() {
    try {
      var h = (document.body && document.body.scrollHeight) || 0;
      send({ type: 'df:resize', height: h });
    } catch (e) { /* */ }
  }

  window.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    var t = data.type;
    if (t === 'df:tweaks:update') {
      applyVars(data.cssVars);
      send({ type: 'df:tweaks:ack', ack: 'update' });
      reportResize();
    } else if (t === 'df:tweaks:reset') {
      resetVars();
      send({ type: 'df:tweaks:ack', ack: 'reset' });
      reportResize();
    } else if (t === 'df:tweaks:export') {
      var snap = exportVars();
      send({ type: 'df:tweaks:export-result', cssVars: snap.cssVars, cssText: snap.cssText });
    }
  });

  // Belt-and-suspenders: if the artifact's own JS rips out our style tag
  // (e.g. it does \`document.head.innerHTML = ...\`), reinstate it on
  // the next tick. Mirrors the overlay's setInterval defense.
  var watchdog = setInterval(function () {
    if (!document.getElementById(STYLE_ID) && Object.keys(ownedVars).length > 0) {
      var el = ensureStyleEl();
      el.textContent = rebuildStyleText();
    }
  }, 200);

  // Initial resize report so the parent has a height even before the
  // first tweak. Fired from a microtask so document.body is ready.
  if (document.readyState === 'complete') {
    setTimeout(reportResize, 0);
  } else {
    window.addEventListener('load', function () { setTimeout(reportResize, 0); }, { once: true });
  }

  // Expose a tiny debug hook so the user can inspect overlay state
  // from the iframe's devtools without blowing the postMessage contract.
  try { window.__dfTweaksOverlay = exportVars; } catch (e) { /* */ }

  // No teardown — the iframe owns its own lifecycle. When it unloads,
  // the interval dies with it.
  void watchdog;
})();`;

/**
 * Inject the listener into HTML content. Mirrors `injectProbeIntoHtml`
 * from runtime-probe.ts — preview-rewrite only, never touches disk.
 *
 * The listener appends just before `</body>` (or end-of-document if the
 * markup is malformed). Multiple <body> closes are handled by taking
 * the LAST one, defending against artifacts that contain the literal
 * string `</body>` inside a `<pre>` block.
 */
export function injectTweaksListenerIntoHtml(html: string): string {
  const tag = `<script data-df="tweaks-bridge">${TWEAKS_LISTENER_SOURCE}</script>`;
  const closeIdx = html.lastIndexOf("</body>");
  if (closeIdx === -1) {
    return html + tag;
  }
  return html.slice(0, closeIdx) + tag + html.slice(closeIdx);
}

/**
 * Send a message FROM the parent TO the iframe.
 *
 * `iframe.contentWindow` may be null briefly during reload — we no-op
 * in that case rather than throwing, because the user dragging a
 * slider mid-reload should not crash the panel.
 */
export function postTweaksToIframe(iframe: HTMLIFrameElement, msg: TweaksOutgoingMessage): void {
  const win = iframe.contentWindow;
  if (!win) return;
  win.postMessage(msg, "*");
}

/**
 * Subscribe to messages FROM the iframe TO the parent. Returns an
 * unsubscribe function (idempotent — safe to call twice).
 *
 * Anti-spoofing: only accepts messages whose `source` is the
 * `iframe.contentWindow` we were handed AND whose payload bears the
 * `df-tweaks-bridge` source ID. This matches the runtime-probe's
 * `event.source` validation pattern (runtime-p0.ts:186) — sandboxed
 * iframes have origin "null" so `event.origin` filters are useless.
 */
export function listenTweaksFromIframe(
  iframe: HTMLIFrameElement,
  handler: (msg: TweaksIncomingMessage) => void,
): () => void {
  let active = true;
  const listener = (ev: MessageEvent) => {
    if (!active) return;
    if (ev.source !== iframe.contentWindow) return;
    if (!isTweaksIncoming(ev.data)) return;
    handler(ev.data);
  };
  window.addEventListener("message", listener);
  return () => {
    if (!active) return;
    active = false;
    window.removeEventListener("message", listener);
  };
}

/**
 * Type guard for parent-side validation. Mirrors `isRuntimeProbePayload`
 * from runtime-probe.ts — we check both the source field AND the
 * structural shape so a stray message from another bridge can't be
 * misinterpreted as a tweaks ack.
 */
export function isTweaksIncoming(value: unknown): value is TweaksIncomingMessage {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj["source"] !== TWEAKS_BRIDGE_SOURCE_ID) return false;
  const t = obj["type"];
  if (t === "df:tweaks:export-result") {
    if (!obj["cssVars"] || typeof obj["cssVars"] !== "object") return false;
    if (typeof obj["cssText"] !== "string") return false;
    return true;
  }
  if (t === "df:tweaks:ack") {
    const ack = obj["ack"];
    return ack === "update" || ack === "reset";
  }
  if (t === "df:resize") {
    return typeof obj["height"] === "number";
  }
  return false;
}

/**
 * Convenience for the panel UI: throttle slider updates to one per
 * animation frame. Avoids saturating the postMessage queue when the
 * user drags fast (~120 events/sec on a high-refresh trackpad).
 *
 * The signature mirrors a setter — call with the next CSS-var batch,
 * the bridge coalesces and flushes on rAF.
 */
export function createThrottledTweaksSender(
  iframe: HTMLIFrameElement,
): (cssVars: Record<string, string>) => void {
  let pending: Record<string, string> | null = null;
  let scheduled: number | null = null;

  return (cssVars: Record<string, string>) => {
    pending = pending ? { ...pending, ...cssVars } : { ...cssVars };
    if (scheduled != null) return;
    const flush = () => {
      scheduled = null;
      const batch = pending;
      pending = null;
      if (batch) {
        postTweaksToIframe(iframe, { type: "df:tweaks:update", cssVars: batch });
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      scheduled = window.requestAnimationFrame(flush);
    } else {
      scheduled = window.setTimeout(flush, 16) as unknown as number;
    }
  };
}
