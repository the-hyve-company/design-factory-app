// element-overlay.ts — deliverable 2.
//
// Click-to-inspect overlay injected into the preview iframe. Lets the
// user pick a single element on the canvas and surface its selector
// + a snippet of outer HTML to the chat as edit context, so the next
// turn becomes a surgical "edit THIS" instead of a full-design regen.
//
// Why an in-iframe overlay rather than a parent-side click intercept:
//   - With strict sandbox (`allow-scripts`, NO `allow-same-origin`) the
//     parent can't read `iframe.contentDocument`, so it can't even ask
//     "what element is at (x, y)?". The picker MUST live inside the
//     iframe and report its findings via postMessage.
//   - The pre-serialised outerHTML payload is exactly what the spec
//     calls out as the safe path: "postMessage com `outerHTML`
//     pré-serializado pelo overlay JS injetado (não cross-frame DOM)"
//     (df-reliable-production-loop.md:728).
//
// Defense-in-depth:
//   - The artifact's own JS may remove our event listeners (e.g. if it
//     calls `document.body.innerHTML = ...`). A 200ms `setInterval`
//     re-attaches handlers to the current body.
//   - We never throw out of the IIFE — a throw would manifest as
//     "select mode silently dead" with no diagnostic.

/**
 * Wire-format types. Discriminated unions keep parent and iframe agreed
 * on a finite vocabulary, just like the tweaks bridge.
 */
export type ElementOverlayOutgoingMessage = { type: "df:select-mode"; on: boolean };

export interface ElementSelectedPayload {
  source: typeof ELEMENT_OVERLAY_SOURCE_ID;
  type: "df:element-selected";
  selector: string;
  xpath: string;
  outerHtml: string; // truncated to 800 chars
  parentOuterHtml: string; // truncated to 600 chars
  textContent: string; // truncated to 200 chars
  tagName: string;
  attrs: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export type ElementOverlayIncomingMessage =
  | ElementSelectedPayload
  | { source: typeof ELEMENT_OVERLAY_SOURCE_ID; type: "df:select-mode-ack"; on: boolean };

/**
 * Source identifier the iframe stamps on every payload — same anti-
 * collision pattern as runtime-probe and tweaks-bridge.
 */
export const ELEMENT_OVERLAY_SOURCE_ID = "df-element-overlay";

/**
 * The in-iframe overlay IIFE. Self-contained — no module scope, safe to
 * inject via `<script>...</script>` into arbitrary artifact HTML.
 *
 * Invariants:
 *   - Hover outline is a single 2px solid orange (DF accent) rendered
 *     via outline (not border, which would shift layout).
 *   - Click intercept uses capture-phase + preventDefault so artifact
 *     buttons don't fire while select mode is on.
 *   - Selector strategy mirrors EditorScreen.computeSelector: prefer
 *     #id, then a positional nth-of-type chain bounded at depth 6.
 *     Fallback to tag if structure breaks (defensive — never empty).
 *   - We send ONE selection per click and stay in select mode until the
 *     parent toggles us off. The user may want to inspect several
 *     elements without leaving the mode.
 */
export const ELEMENT_OVERLAY_SOURCE = `(() => {
  var SOURCE = 'df-element-overlay';
  var STYLE_ID = '__df-element-overlay-style__';
  var selectModeOn = false;
  var lastHover = null;
  var prevOutline = '';
  var prevOutlineOffset = '';
  var prevCursor = '';

  function send(msg) {
    try {
      window.parent.postMessage(Object.assign({ source: SOURCE }, msg), '*');
    } catch (e) { /* parent gone. */ }
  }

  function ensureStyleEl() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.tagName === 'STYLE') return el;
    el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent =
      'html.__df-select-mode, html.__df-select-mode body { cursor: crosshair !important; }' +
      ' .__df-overlay-skip { pointer-events: none !important; }';
    (document.head || document.documentElement).appendChild(el);
    return el;
  }

  function computeSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id.replace(/[^a-zA-Z0-9_\\-]/g, '\\\\$&');
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 6) {
      var tag = (cur.tagName || '').toLowerCase();
      if (!tag) break;
      var parent = cur.parentNode;
      if (!parent || parent === document) {
        parts.unshift(tag);
        break;
      }
      var siblings = parent.children || [];
      var sameTag = [];
      for (var i = 0; i < siblings.length; i++) {
        if ((siblings[i].tagName || '').toLowerCase() === tag) sameTag.push(siblings[i]);
      }
      if (sameTag.length === 1) {
        parts.unshift(tag);
      } else {
        var idx = sameTag.indexOf(cur) + 1;
        parts.unshift(tag + ':nth-of-type(' + idx + ')');
      }
      cur = parent;
      depth++;
    }
    return parts.length ? parts.join(' > ') : (el.tagName || '').toLowerCase();
  }

  function computeXpath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '//*[@id="' + el.id + '"]';
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 8) {
      var tag = (cur.tagName || '').toLowerCase();
      if (!tag) break;
      var siblings = cur.parentNode ? cur.parentNode.children : [];
      var sameTag = [];
      for (var i = 0; i < siblings.length; i++) {
        if ((siblings[i].tagName || '').toLowerCase() === tag) sameTag.push(siblings[i]);
      }
      var idx = sameTag.indexOf(cur) + 1;
      parts.unshift(tag + (sameTag.length > 1 ? '[' + idx + ']' : ''));
      cur = cur.parentNode;
      depth++;
    }
    return '/' + parts.join('/');
  }

  function snapshotAttrs(el) {
    var out = {};
    if (!el || !el.attributes) return out;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (!a) continue;
      var k = String(a.name);
      if (k.charAt(0) === '_' && k.charAt(1) === '_') continue; // skip our internals
      out[k] = String(a.value).slice(0, 200);
    }
    return out;
  }

  function isOurUi(el) {
    if (!el) return false;
    var n = el;
    while (n && n.nodeType === 1) {
      if (n.id === STYLE_ID) return true;
      if (n.id === '__df-edit-overrides__') return true;
      if (n.id === '__df-tweaks-overlay__') return true;
      if (n.id === 'df-tweaks-panel') return true;
      n = n.parentNode;
    }
    return false;
  }

  function clearHover() {
    if (lastHover) {
      try {
        lastHover.style.outline = prevOutline;
        lastHover.style.outlineOffset = prevOutlineOffset;
        lastHover.style.cursor = prevCursor;
      } catch (e) { /* */ }
      lastHover = null;
      prevOutline = '';
      prevOutlineOffset = '';
      prevCursor = '';
    }
  }

  function onMouseOver(ev) {
    if (!selectModeOn) return;
    var t = ev.target;
    if (!t || t.nodeType !== 1 || isOurUi(t)) return;
    clearHover();
    try {
      prevOutline = t.style.outline || '';
      prevOutlineOffset = t.style.outlineOffset || '';
      prevCursor = t.style.cursor || '';
      t.style.outline = '2px solid #ef5d3b';
      t.style.outlineOffset = '2px';
      t.style.cursor = 'crosshair';
      lastHover = t;
    } catch (e) { /* */ }
  }

  function onMouseOut(ev) {
    if (!selectModeOn) return;
    var t = ev.target;
    if (t && t === lastHover) clearHover();
  }

  function onClick(ev) {
    if (!selectModeOn) return;
    var t = ev.target;
    if (!t || t.nodeType !== 1 || isOurUi(t)) return;
    ev.preventDefault();
    ev.stopPropagation();
    try {
      var rect = t.getBoundingClientRect();
      var outer = String(t.outerHTML || '').slice(0, 800);
      var parent = t.parentNode && t.parentNode.nodeType === 1 ? t.parentNode : null;
      var parentOuter = parent ? String(parent.outerHTML || '').slice(0, 600) : '';
      var text = String(t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
      send({
        type: 'df:element-selected',
        selector: computeSelector(t),
        xpath: computeXpath(t),
        outerHtml: outer,
        parentOuterHtml: parentOuter,
        textContent: text,
        tagName: (t.tagName || '').toLowerCase(),
        attrs: snapshotAttrs(t),
        boundingBox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    } catch (e) { /* swallow — never throw from overlay */ }
  }

  function attach() {
    ensureStyleEl();
    document.documentElement.classList.add('__df-select-mode');
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
  }

  function detach() {
    document.documentElement.classList.remove('__df-select-mode');
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    clearHover();
  }

  // Belt-and-suspenders: if the artifact resets the document (e.g.
  // \`document.body.innerHTML = ...\`), our listeners die with the old
  // body. Re-attach on a 200ms tick whenever select mode is on.
  setInterval(function () {
    if (!selectModeOn) return;
    if (!document.documentElement.classList.contains('__df-select-mode')) {
      attach();
    }
  }, 200);

  window.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'df:select-mode') return;
    var on = !!data.on;
    if (on === selectModeOn) {
      send({ type: 'df:select-mode-ack', on: on });
      return;
    }
    selectModeOn = on;
    if (on) attach(); else detach();
    send({ type: 'df:select-mode-ack', on: on });
  });
})();`;

/**
 * Inject the overlay listener into HTML content. Same shape as the
 * tweaks-bridge / runtime-probe injectors. We append just before the
 * LAST `</body>` so the script runs after the artifact body parses.
 */
export function injectOverlayIntoHtml(html: string): string {
  const tag = `<script data-df="element-overlay">${ELEMENT_OVERLAY_SOURCE}</script>`;
  const closeIdx = html.lastIndexOf("</body>");
  if (closeIdx === -1) {
    return html + tag;
  }
  return html.slice(0, closeIdx) + tag + html.slice(closeIdx);
}

/**
 * Send a `df:select-mode` toggle to the iframe. Returns false if the
 * iframe is detached (no `contentWindow`); the panel UI uses that to
 * mirror state.
 */
export function postSelectModeToIframe(iframe: HTMLIFrameElement, on: boolean): boolean {
  const win = iframe.contentWindow;
  if (!win) return false;
  win.postMessage({ type: "df:select-mode", on }, "*");
  return true;
}

/**
 * Subscribe to overlay messages. Anti-spoofing identical to the tweaks
 * bridge — we trust only `event.source === iframe.contentWindow` AND
 * `payload.source === ELEMENT_OVERLAY_SOURCE_ID`.
 */
export function listenOverlayFromIframe(
  iframe: HTMLIFrameElement,
  handler: (msg: ElementOverlayIncomingMessage) => void,
): () => void {
  let active = true;
  const listener = (ev: MessageEvent) => {
    if (!active) return;
    if (ev.source !== iframe.contentWindow) return;
    if (!isOverlayIncoming(ev.data)) return;
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
 * Type guard for parent-side validation. Same pattern as
 * `isRuntimeProbePayload` and `isTweaksIncoming`: guard the source
 * field, then validate the structural shape per discriminated branch.
 */
export function isOverlayIncoming(value: unknown): value is ElementOverlayIncomingMessage {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj["source"] !== ELEMENT_OVERLAY_SOURCE_ID) return false;
  const t = obj["type"];
  if (t === "df:element-selected") return isElementSelectedPayload(obj);
  if (t === "df:select-mode-ack") return typeof obj["on"] === "boolean";
  return false;
}

/**
 * Narrower type guard for just the selection payload — used by the
 * inspector panel to refine the union before reading optional fields.
 */
export function isElementSelectedPayload(value: unknown): value is ElementSelectedPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj["source"] !== ELEMENT_OVERLAY_SOURCE_ID) return false;
  if (obj["type"] !== "df:element-selected") return false;
  if (typeof obj["selector"] !== "string") return false;
  if (typeof obj["xpath"] !== "string") return false;
  if (typeof obj["outerHtml"] !== "string") return false;
  if (typeof obj["parentOuterHtml"] !== "string") return false;
  if (typeof obj["textContent"] !== "string") return false;
  if (typeof obj["tagName"] !== "string") return false;
  if (!obj["attrs"] || typeof obj["attrs"] !== "object") return false;
  const bb = obj["boundingBox"];
  if (!bb || typeof bb !== "object") return false;
  const bbObj = bb as Record<string, unknown>;
  if (typeof bbObj["x"] !== "number") return false;
  if (typeof bbObj["y"] !== "number") return false;
  if (typeof bbObj["width"] !== "number") return false;
  if (typeof bbObj["height"] !== "number") return false;
  return true;
}

/**
 * Build a chat-ready prompt fragment from a selection. Used by the
 * inspector's "Send to agent" button. Keeps the agent's context budget
 * tight — selector + truncated outerHTML + intent placeholder.
 *
 * The {{INTENT}} placeholder is replaced by the user's free-text in
 * the inspector before the prompt is sent.
 */
export function buildAgentPromptFromSelection(sel: ElementSelectedPayload): string {
  const parts: string[] = [];
  parts.push("Edit only this element on the page:");
  parts.push("");
  parts.push("Selector: " + sel.selector);
  parts.push("Tag: " + sel.tagName);
  if (sel.textContent) parts.push("Text: " + JSON.stringify(sel.textContent));
  parts.push("");
  parts.push("Current markup (truncated):");
  parts.push("```html");
  parts.push(sel.outerHtml);
  parts.push("```");
  parts.push("");
  parts.push("Change to apply: {{INTENT}}");
  parts.push("");
  parts.push("Constraints:");
  parts.push(
    "- Modify ONLY the element above. Do not touch siblings, parents, or the global stylesheet.",
  );
  parts.push(
    "- Preserve the element's id and structural attributes unless the change explicitly requires removing them.",
  );
  return parts.join("\n");
}
