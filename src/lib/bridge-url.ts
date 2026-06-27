// Bridge URL resolution — pure, testable helpers shared by the HTTP client
// (claude-bridge.ts) and the terminal WebSocket (TerminalDrawer.tsx).
//
// Why same-origin: the launcher exposes the daemon to the browser through a Vite
// proxy at `/__bridge` (same origin as the web app). The client therefore talks
// to the daemon via its OWN origin, never a hardcoded daemon port. This kills two
// classes of failure at once:
//   1. Reclaimed daemon port (1421 busy → daemon on 1424) no longer leaves the
//      bundle calling a stale 1421 → "origin not allowed". The relative URL always
//      resolves to wherever the page is actually served.
//   2. Container / VS Code remote: only the web port needs forwarding; the daemon
//      stays on loopback behind the proxy.
//
// VITE_BRIDGE_URL is "/__bridge" (relative) under the launcher. A relative value
// is resolved against the page origin; an absolute value passes through unchanged
// (back-compat / direct-daemon setups); empty falls back to the default port.

const DEFAULT_HTTP = "http://127.0.0.1:1421";
const DEFAULT_WS = "ws://127.0.0.1:1421";

/** Resolve the configured bridge value into an absolute HTTP base URL.
 *  - relative ("/__bridge") + origin → `${origin}/__bridge`
 *  - absolute ("http://127.0.0.1:1424") → unchanged
 *  - empty/false → default daemon port
 *  `origin` is window.location.origin in the browser, undefined under SSR/tests. */
export function resolveBridgeBase(env: string | false | undefined, origin?: string): string {
  if (!env) return DEFAULT_HTTP;
  if (env.startsWith("/")) return origin ? origin + env : env;
  return env;
}

/** Resolve the configured bridge value into an absolute WebSocket base URL.
 *  - relative ("/__bridge") + host → `ws(s)://${host}/__bridge` (wss when the
 *    page is https, so a TLS-terminated remote keeps a secure socket)
 *  - absolute ("http://…") → swap the http scheme for ws
 *  - empty/false → default daemon port */
export function resolveBridgeWs(
  env: string | false | undefined,
  host?: string,
  protocol?: string,
): string {
  if (!env) return DEFAULT_WS;
  if (env.startsWith("/")) {
    if (!host) return env;
    const proto = protocol === "https:" ? "wss" : "ws";
    return `${proto}://${host}${env}`;
  }
  return env.replace(/^http/, "ws");
}
