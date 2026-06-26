// SSRF guard for outbound fetch (GET /fetch-url et al.).
//
// The daemon fetches client-supplied URLs (website→design.md extraction).
// Without guarding, model-generated HTML / a forged prompt can pivot the
// daemon into the internal network (loopback, RFC1918, link-local, cloud
// metadata 169.254.169.254). We block private/loopback/link-local/ULA/
// metadata IPs, allow only http/https, and follow redirects manually so
// each hop is re-validated.
//
// Residual caveat: DNS-rebinding between lookup and connect is not fully
// closed (would need IP-pinned connect); proportionate for a local-first
// daemon. Extracted from index.mjs so the rules are unit-testable.

import { lookup as dnsLookup } from "node:dns/promises";

export function isBlockedIp(ip) {
  if (typeof ip !== "string") return true;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127) return true; // this-network, loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIp(mapped[1]);
  return false;
}

// Validate scheme + resolve host; throws if scheme is not http(s) or any
// resolved IP is blocked. Returns the parsed URL.
export async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`scheme not allowed: ${u.protocol}`);
  }
  const resolved = await dnsLookup(u.hostname, { all: true });
  for (const r of resolved) {
    if (isBlockedIp(r.address)) throw new Error(`blocked ip: ${r.address}`);
  }
  return u;
}

// SSRF-safe fetch: validates the target (and every redirect hop) before each
// request. `init` is passed through (signal, headers); redirect is forced
// manual so a 3xx Location can be re-validated instead of silently followed.
export async function ssrfSafeFetch(rawUrl, init = {}, maxHops = 5) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(current);
    const r = await fetch(current, { ...init, redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return r;
      current = new URL(loc, current).toString();
      continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
