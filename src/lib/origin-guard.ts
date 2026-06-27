// origin-guard.ts — refuse to operate when the page is served from an
// origin the daemon won't accept.
//
// Audit verdict 2026-05-08 Fase 1 #3: a CORS rejection from the daemon
// looks like a chat bug to the user — chat persists fail silently,
// providers don't stream, and there's no obvious diagnostic. The recovery
// layer (#110) cushions data loss, but the root cause is invisible. This
// guard surfaces the misconfiguration explicitly so the user knows
// "open this on http://localhost:1420" instead of debugging chat phantoms.
//
// The canonical origin list mirrors apps/daemon/src/index.mjs
// DEFAULT_ALLOWED_ORIGINS — keep them in sync. The constant is exported
// so the gate test can lock the parity statically.

export const ALLOWED_BRIDGE_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420"] as const;

export interface OriginCheck {
  ok: boolean;
  currentOrigin: string;
  expectedOrigins: ReadonlyArray<string>;
}

/**
 * Compare a given origin against the daemon's allow-list. Pure function
 * so the React banner and the gate test can both use it. Empty/undefined
 * inputs (e.g. SSR or test environments without `window`) return ok=false
 * with currentOrigin="" so the caller can decide whether to render
 * (typically: only render in the browser, only flag when ok=false).
 */
export function checkOrigin(
  origin: string | null | undefined,
  extraAllowed: ReadonlyArray<string> = [],
): OriginCheck {
  const current = origin ?? "";
  const expectedOrigins = [...ALLOWED_BRIDGE_ORIGINS, ...extraAllowed];
  const ok = expectedOrigins.includes(current);
  return {
    ok,
    currentOrigin: current,
    expectedOrigins,
  };
}

/**
 * Convenience wrapper that reads `window.location.origin` if available.
 * The dev launcher injects `VITE_DF_WEB_PORT` (the actual served port, which
 * may be reclaimed off the default 1420); it is trusted in addition to the
 * canonical list so a reclaimed port doesn't trip the guard. Still
 * localhost-only — production origins remain rejected.
 */
export function checkCurrentOrigin(): OriginCheck {
  const origin = typeof window !== "undefined" ? window.location?.origin : "";
  // Same-origin bridge (the default, or VITE_BRIDGE_URL="/__bridge"): the client
  // reaches the daemon through the Vite proxy on its OWN origin, so the page
  // origin never has to match the daemon's CORS list — this guard is moot and
  // would be a false positive on a reclaimed port (page on :1424 while the guard
  // expects :1420). Only an explicit ABSOLUTE override (direct daemon) reinstates
  // the cross-origin check this banner was built for.
  const bridge =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env?.VITE_BRIDGE_URL
      : undefined;
  const sameOriginBridge = !bridge || bridge.startsWith("/");
  if (sameOriginBridge) {
    return { ok: true, currentOrigin: origin ?? "", expectedOrigins: [...ALLOWED_BRIDGE_ORIGINS] };
  }
  const devPort =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: { VITE_DF_WEB_PORT?: string } }).env?.VITE_DF_WEB_PORT
      : undefined;
  const devOrigins = devPort ? [`http://localhost:${devPort}`, `http://127.0.0.1:${devPort}`] : [];
  return checkOrigin(origin, devOrigins);
}
