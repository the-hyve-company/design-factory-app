// [DEPRECATED] GitHub bridge — the GitHub auth UI is not part of the
// current public surface.
//
// Users run `gh auth login` in the terminal directly when they need
// repo helpers. This bridge module is preserved (not deleted) for a
// future polished surface, but no current code path renders flows
// that depend on it. Daemon endpoints (/gh/*) are also preserved with
// deprecated headers — see apps/daemon/src/index.mjs.
//
// === ORIGINAL DOC (kept for future planning) =================================
//
// GitHub bridge — daemon-mediated GitHub helpers.
//
// The daemon already exposes /gh/token, /gh/device/{start,poll,logout},
// /gh/repos, and (new ) /gh/user. Most of those clients
// live in claude-bridge.ts for historical reasons (DS setup grew them).
// This file is the canonical surface for new consumers (Settings →
// Providers → GitHub card, future repo sync flows). It re-exports the
// helpers and adds `ghGetUser` for the connected-profile chip.
//
// : "nao tem como colocarmos oauth de vercel e github
// pra logar mais facilitado?" GitHub Device Flow already shipped via
// DsSetupModal — this file just makes it consumable from anywhere.

import { BRIDGE_URL } from "@/lib/claude-bridge";

export {
  ghHasToken,
  ghDeviceStart,
  ghDevicePoll,
  ghDeviceLogout,
  ghListRepos,
} from "@/lib/claude-bridge";
export type { GhDeviceFlowStart, GhDevicePollStatus, GithubRepo } from "@/lib/claude-bridge";

export interface GithubUserProfile {
  ok: boolean;
  login?: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  publicRepos?: number;
  error?: string;
}

/** Connected GitHub profile (login, avatar, name, repos count). Returns
 *  ok:false when no token is available or the API rejects it. */
export async function ghGetUser(): Promise<GithubUserProfile> {
  try {
    const res = await fetch(`${BRIDGE_URL}/gh/user`);
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return body as GithubUserProfile;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
