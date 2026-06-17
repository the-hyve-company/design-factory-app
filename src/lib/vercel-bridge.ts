// [DEPRECATED] Vercel bridge — the in-app Vercel publish UI is not
// part of the current public surface.
//
// Users now run `vercel deploy` in the terminal directly. This bridge
// module is preserved (not deleted) for a future polished surface, but
// no current code path imports it anymore (PublishDialog deprecated,
// VercelPublishCard removed from Settings). Daemon endpoints
// (/deploy/vercel, /vercel/*) are also preserved with deprecated
// headers — see apps/daemon/src/index.mjs.
//
// === ORIGINAL DOC (kept for future planning) =================================
//
// Vercel BYOK bridge — talks to the daemon's /deploy/vercel + /config/vercel
// + /deploy/vercel/list + /deploy/vercel/test endpoints. Each user brings
// their own Vercel token; the daemon persists at ~/.design-factory/vercel.json
// (chmod 600). The browser never holds the token in memory or localStorage —
// it only triggers the deploy and reads back tokenSet:bool for the Settings UI.
//
// added target (preview/production) toggle, projectName
// override, deployments list, and connection test surfaces.
// "vamos trabalhar na ideia de publicar no vercel, nao ta incompleta?
//  ta funcional? como podemos testar? nao faltam configurações?"
//
// layered OAuth surfaces on top of BYOK (
// "nao tem como colocarmos oauth de vercel e github pra logar mais
// facilitado? e ja poder escolher projeto em q quer publicar"):
//   · getVercelUser() — connected profile (avatar/email/team)
//   · listVercelProjects() — picker source for the publish dialog
//   · vercelDeviceStart()/Poll() — RFC 8628 device flow scaffold,
//     enabled when DF_VERCEL_CLIENT_ID is set in the daemon env.
//     If unset the daemon returns 503 + fallback="byok" and the UI
//     keeps the improved BYOK paste flow.
//
// VercelConfigState + VercelUserProfile expose a `source` field. The
// daemon auto-detects Vercel CLI auth.json
// (~/.local/share/com.vercel.cli/auth.json) — same UX as the `gh`
// CLI. Resolution priority: BYOK token > CLI auth.json > disconnected.
//
// Teams + aggregated projects + name validation. The daemon used to
// fetch personal-account projects only (teamId omitted), which hid
// any team-scoped projects from the publish flow. The full picture
// now surfaces via:
//   · listVercelTeams — flat list of teams the user belongs to
//   · listVercelAllProjects() — fan-out across personal + every team
//     (returns enriched projects with teamId/teamSlug/teamName, plus
//     the team catalogue so the UI can group)
//   · checkVercelProjectName() — does this name already exist in the
//     selected scope? (404 = available; 200 = taken)
//   · listVercelProjects() accepts `teamId` and surfaces it back.

import { BRIDGE_URL } from "@/lib/claude-bridge";

export type DeployTarget = "preview" | "production";

/** token source the daemon resolved when answering /config/vercel.
 *  · "byok" — saved via Settings (~/.design-factory/vercel.json)
 *  · "vercel-cli" — auto-detected from Vercel CLI auth.json
 *  · null — no token configured (UI shows connect prompt). */
export type VercelTokenSource = "byok" | "vercel-cli" | null;

export interface VercelConfigState {
  tokenSet: boolean;
  /** which surface the daemon read the token from. Lets the UI
   *  render distinct connected states (CLI vs BYOK) without an extra
   *  round-trip. Older daemons may return `undefined`; treat as null. */
  source?: VercelTokenSource;
  teamId: string;
  teamSlug: string;
}

export interface DeployResult {
  ok: boolean;
  url?: string;
  deploymentId?: string;
  inspectUrl?: string;
  target?: DeployTarget;
  error?: string;
}

export interface DeployListItem {
  id: string;
  url: string | null;
  name: string;
  target: DeployTarget | string;
  state: string;
  createdAt: number | null;
}

export interface DeployListResult {
  ok: boolean;
  deployments: DeployListItem[];
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  username?: string;
  teamLabel?: string;
  error?: string;
}

export async function getVercelConfigState(): Promise<VercelConfigState> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/vercel`);
    if (!res.ok) return { tokenSet: false, source: null, teamId: "", teamSlug: "" };
    const body = (await res.json()) as VercelConfigState;
    // Normalise: older daemons may not return `source`; default to null.
    return {
      tokenSet: !!body.tokenSet,
      source: body.source ?? null,
      teamId: body.teamId ?? "",
      teamSlug: body.teamSlug ?? "",
    };
  } catch {
    return { tokenSet: false, source: null, teamId: "", teamSlug: "" };
  }
}

export async function saveVercelConfig(input: {
  token?: string;
  teamId?: string;
  teamSlug?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/vercel`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deployVercel(input: {
  slug: string;
  html: string;
  /** when omitted, daemon defaults to "preview". */
  target?: DeployTarget;
  /** optional Vercel project name override; defaults to slug. */
  projectName?: string;
  /** explicit Vercel project id when picking an existing one.
   *  Daemon resolves the canonical name server-side. */
  projectId?: string;
  /** explicit team scope. Empty string forces personal scope.
   *  Omit to use the saved teamId. */
  teamId?: string;
}): Promise<DeployResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/deploy/vercel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: true,
      url: body.url,
      deploymentId: body.deploymentId,
      inspectUrl: body.inspectUrl,
      target: body.target as DeployTarget | undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── : deployment status polling ──────────────────────────────────
// The publish overlay drives the progress UI by polling
// /deploy/vercel/status?id={deploymentId} every 1.5s after the initial
// POST /deploy/vercel returns. Vercel's POST is async — it gives us a
// `deploymentId` while the build is still QUEUED/BUILDING. We surface
// the readyState verbatim so the UI maps each transition to a step.

export type VercelDeploymentState =
  | "QUEUED"
  | "INITIALIZING"
  | "BUILDING"
  | "READY"
  | "ERROR"
  | "CANCELED"
  | "UNKNOWN";

export interface DeployStatusResult {
  ok: boolean;
  state: VercelDeploymentState;
  url?: string | null;
  inspectUrl?: string | null;
  errorMessage?: string | null;
  error?: string;
}

/** poll a single Vercel deployment's readyState. Cheap (~80B),
 *  meant for 1.5s loops. Pass `teamId=""` to force personal scope. */
export async function getDeployStatus(
  deploymentId: string,
  opts: { teamId?: string | null } = {},
): Promise<DeployStatusResult> {
  try {
    const url = new URL(`${BRIDGE_URL}/deploy/vercel/status`);
    url.searchParams.set("id", deploymentId);
    if (opts.teamId !== undefined && opts.teamId !== null) {
      url.searchParams.set("teamId", opts.teamId);
    }
    const res = await fetch(url.toString());
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok || body?.ok === false) {
      return {
        ok: false,
        state: "UNKNOWN",
        error: body?.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      state: (body.state || "UNKNOWN") as VercelDeploymentState,
      url: body.url ?? null,
      inspectUrl: body.inspectUrl ?? null,
      errorMessage: body.errorMessage ?? null,
    };
  } catch (err) {
    return { ok: false, state: "UNKNOWN", error: String(err) };
  }
}

/** list last N deployments via `/deploy/vercel/list?limit=N`. */
export async function listVercelDeployments(limit = 5): Promise<DeployListResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/deploy/vercel/list?limit=${limit}`);
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, deployments: [], error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: !!body?.ok,
      deployments: Array.isArray(body?.deployments) ? body.deployments : [],
      error: body?.error,
    };
  } catch (err) {
    return { ok: false, deployments: [], error: String(err) };
  }
}

/** connection test: validates token via `api.vercel.com/v2/user`. */
export async function testVercelConnection(): Promise<ConnectionTestResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/deploy/vercel/test`);
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: !!body?.ok,
      username: body?.username,
      teamLabel: body?.teamLabel,
      error: body?.error,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── profile + projects + OAuth scaffold ─────────────

export interface VercelUserProfile {
  ok: boolean;
  username?: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  teamLabel?: string | null;
  /** same as VercelConfigState.source. Surfaced here so the UI
   *  can render the "via CLI" badge directly from the profile fetch
   *  (single round-trip when the connected card mounts). */
  source?: VercelTokenSource;
  error?: string;
}

/** Connected profile for the saved Vercel token. Returns ok:false if no
 *  token is configured or the API rejects it (no auth state thrown). */
export async function getVercelUser(): Promise<VercelUserProfile> {
  try {
    const res = await fetch(`${BRIDGE_URL}/vercel/user`);
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return body as VercelUserProfile;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  latestDeployment: string | null;
  /** populated by listVercelAllProjects + listVercelProjects when
   *  a teamId is in play. `null` means the project belongs to the
   *  personal account. */
  teamId?: string | null;
  teamSlug?: string | null;
  teamName?: string | null;
}

export interface VercelProjectsResult {
  ok: boolean;
  projects: VercelProject[];
  error?: string;
}

/** List the user's Vercel projects. Empty list when no token. :
 *  pass `teamId` to scope to a specific team; pass `""` to force
 *  personal scope; omit to use the saved teamId. */
export async function listVercelProjects(
  opts: { limit?: number; search?: string; teamId?: string } = {},
): Promise<VercelProjectsResult> {
  try {
    const url = new URL(`${BRIDGE_URL}/vercel/projects`);
    if (opts.limit) url.searchParams.set("limit", String(opts.limit));
    if (opts.search) url.searchParams.set("search", opts.search);
    if (opts.teamId !== undefined) url.searchParams.set("teamId", opts.teamId);
    const res = await fetch(url.toString());
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, projects: [], error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: !!body?.ok,
      projects: Array.isArray(body?.projects) ? body.projects : [],
      error: body?.error,
    };
  } catch (err) {
    return { ok: false, projects: [], error: String(err) };
  }
}

// ─── : teams + aggregated projects + name validation ──────────────

export interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar?: string | null;
  membership?: { role: string };
}

export interface VercelTeamsResult {
  ok: boolean;
  teams: VercelTeam[];
  error?: string;
}

/** List the user's Vercel teams. Empty when no token. */
export async function listVercelTeams(): Promise<VercelTeamsResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/vercel/teams`);
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, teams: [], error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: !!body?.ok,
      teams: Array.isArray(body?.teams) ? body.teams : [],
      error: body?.error,
    };
  } catch (err) {
    return { ok: false, teams: [], error: String(err) };
  }
}

export interface VercelAllProjectsResult {
  ok: boolean;
  /** Flat list — each project carries `teamId`/`teamSlug`/`teamName`
   *  fields so the UI can group without a second pass. */
  projects: VercelProject[];
  /** Catalogue of teams the user belongs to. Renders as group
   *  headers in the UI. Empty when no token or no teams. */
  teams: VercelTeam[];
  error?: string;
}

/** Aggregated project list across personal account + every team.
 *  replaces the bug-prone single-scope listVercelProjects in
 *  the publish dialog. Daemon fans out in parallel and de-duplicates
 *  by id, so callers don't need to manage scope. */
export async function listVercelAllProjects(
  opts: { limit?: number; search?: string } = {},
): Promise<VercelAllProjectsResult> {
  try {
    const url = new URL(`${BRIDGE_URL}/vercel/projects/all`);
    if (opts.limit) url.searchParams.set("limit", String(opts.limit));
    if (opts.search) url.searchParams.set("search", opts.search);
    const res = await fetch(url.toString());
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok)
      return { ok: false, projects: [], teams: [], error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: !!body?.ok,
      projects: Array.isArray(body?.projects) ? body.projects : [],
      teams: Array.isArray(body?.teams) ? body.teams : [],
      error: body?.error,
    };
  } catch (err) {
    return { ok: false, projects: [], teams: [], error: String(err) };
  }
}

export type VercelProjectNameAvailability =
  | { ok: true; available: true; name: string }
  | { ok: true; available: false; name: string; reason?: "exists" | "invalid" }
  | { ok: false; error: string; name: string };

/** Check whether a project name is available in a given scope.
 *  inline validation surface for the "Create new" flow.
 *  Pass `teamId=""` to check personal scope. Omit to check against the
 *  saved teamId. */
export async function checkVercelProjectName(
  name: string,
  opts: { teamId?: string } = {},
): Promise<VercelProjectNameAvailability> {
  try {
    const url = new URL(`${BRIDGE_URL}/vercel/projects/check`);
    url.searchParams.set("name", name);
    if (opts.teamId !== undefined) url.searchParams.set("teamId", opts.teamId);
    const res = await fetch(url.toString());
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok || body?.ok === false) {
      return { ok: false, error: body?.error ?? `HTTP ${res.status}`, name: body?.name ?? name };
    }
    if (body.available) {
      return { ok: true, available: true, name: body.name };
    }
    return { ok: true, available: false, name: body.name, reason: body.reason };
  } catch (err) {
    return { ok: false, error: String(err), name };
  }
}

// ─── Vercel OAuth Device Flow (RFC 8628) ─────────────────────────────
// Daemon-gated by DF_VERCEL_CLIENT_ID. When unset the daemon replies
// HTTP 503 with { fallback: "byok" } and the UI keeps the paste flow.

export interface VercelDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  expiresIn: number;
}

export type VercelDeviceFlowStartResult =
  | VercelDeviceFlowStart
  | { error: string; fallback?: "byok"; hint?: string };

export async function vercelDeviceStart(): Promise<VercelDeviceFlowStartResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/vercel/device/start`, { method: "POST" });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok)
      return {
        error: body?.error ?? `HTTP ${res.status}`,
        fallback: body?.fallback,
        hint: body?.hint,
      };
    return body as VercelDeviceFlowStart;
  } catch (err) {
    return { error: String(err) };
  }
}

export type VercelDevicePollStatus =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "ok"; tokenType?: string; scope?: string }
  | { status: "error"; error: string };

export async function vercelDevicePoll(deviceCode: string): Promise<VercelDevicePollStatus> {
  try {
    const res = await fetch(`${BRIDGE_URL}/vercel/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { status: "error", error: body?.error ?? `HTTP ${res.status}` };
    return body as VercelDevicePollStatus;
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

/** Type guard — narrows the `vercelDeviceStart()` result for callers. */
export function isVercelDeviceFlowStart(
  r: VercelDeviceFlowStartResult,
): r is VercelDeviceFlowStart {
  return typeof (r as VercelDeviceFlowStart).deviceCode === "string";
}
