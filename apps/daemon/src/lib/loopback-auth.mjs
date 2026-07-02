// loopback-auth.mjs — opt-in session-token auth for the localhost daemon.
//
// Default posture (single-user machine): the daemon trusts loopback —
// requests without an Origin header pass the origin check (curl, server-
// to-server, same-origin fetches). That is fine for the local-first,
// single-user case, but on a SHARED host any local user (or any local
// process) can talk to the daemon.
//
// DF_REQUIRE_TOKEN=1 turns on hardened mode: a random session token is
// generated once, stored under the DF config dir with mode 0600 (owner
// read/write only), and every state-changing request (non-GET/HEAD/
// OPTIONS) plus the /terminal WebSocket upgrade must present it. Other
// local users can't read the token file, so they can't drive the daemon.
//
// The token can be sent as:
//   - `X-DF-Token: <token>` header (preferred)
//   - `Authorization: Bearer <token>` header
//   - `?df_token=<token>` query param (WebSocket upgrades — browsers
//     can't set custom headers on `new WebSocket(url)`)
//
// Everything here is pure/deterministic (given env + fs) so it can be
// unit-tested without booting the daemon singleton.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOKEN_FILE_NAME = "session-token";

function isTruthyFlag(value) {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// DF_REQUIRE_TOKEN — default OFF. Opt-in hardened mode for shared hosts.
export function isTokenRequired(env = process.env) {
  return isTruthyFlag(env.DF_REQUIRE_TOKEN);
}

// DF_ENABLE_TERMINAL — gate for the /terminal WebSocket (shell PTY, the
// daemon's largest blast radius).
//
// Default chosen for least disruption:
//   - unset + DF_REQUIRE_TOKEN off  → ON  (current local single-user behavior)
//   - unset + DF_REQUIRE_TOKEN on   → OFF (hardened mode: the biggest
//     surface defaults closed; opt back in explicitly)
//   - explicitly set → the explicit value always wins, in either mode.
export function isTerminalEnabled(env = process.env) {
  const raw = env.DF_ENABLE_TERMINAL;
  if (typeof raw === "string" && raw.trim() !== "") return isTruthyFlag(raw);
  return !isTokenRequired(env);
}

// Load the persisted session token, or create one (64 hex chars, mode
// 0600). Returns { token, file, created }.
export function loadOrCreateSessionToken(configDir) {
  const file = join(configDir, TOKEN_FILE_NAME);
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{32,128}$/i.test(existing)) {
      try {
        chmodSync(file, 0o600); // re-assert in case perms drifted
      } catch {}
      return { token: existing, file, created: false };
    }
  } catch {}
  const token = randomBytes(32).toString("hex");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(file, token + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600); // writeFileSync mode is ignored when the file pre-exists
  } catch {}
  return { token, file, created: true };
}

// Extract the client-presented token from a request (HTTP or WS upgrade).
export function extractRequestToken(req) {
  const header = req?.headers?.["x-df-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req?.headers?.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) {
    const t = auth.replace(/^bearer\s+/i, "").trim();
    if (t) return t;
  }
  try {
    const u = new URL(req?.url || "", "http://localhost");
    const q = u.searchParams.get("df_token");
    if (q && q.trim()) return q.trim();
  } catch {}
  return null;
}

// Constant-time comparison — never leak token bytes via timing.
export function tokensMatch(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// State-changing = anything that isn't a safe read (POST/PUT/PATCH/DELETE).
// Provider spawns, fs writes, config PUTs and skill installs are all
// non-GET, so the whole mutation surface hangs off this one predicate.
export function isStateChangingMethod(method) {
  return !SAFE_METHODS.has(String(method || "").toUpperCase());
}

// One-call verdict for a request. `required` OFF short-circuits to ok —
// backward-compatible default.
export function checkRequestToken(req, { required, token }) {
  if (!required) return { ok: true };
  const provided = extractRequestToken(req);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error:
        "missing session token (DF_REQUIRE_TOKEN is on — send X-DF-Token, Authorization: Bearer, or ?df_token=)",
    };
  }
  if (!tokensMatch(token, provided)) {
    return { ok: false, status: 403, error: "invalid session token" };
  }
  return { ok: true };
}
