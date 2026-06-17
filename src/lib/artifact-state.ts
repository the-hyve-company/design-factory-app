// artifact-state.ts — Read/write `.df/artifact-state.json` for a project.
// Tracks which file the providers are editing + a monotonic version counter
// the handoff builder uses to decide whether to resend L3.
//
// Provider Handoff Layer v1, spec §4.3.

import { ArtifactStateSchema, type ArtifactState, safeRead, safeWriteOrThrow } from "@/lib/schemas";
// See provider-sessions.ts for the same fix: import the canonical
// BRIDGE_URL instead of re-deriving with the wrong window key.
import { BRIDGE_URL } from "@/lib/claude-bridge";

export function makeInitialArtifactState(primaryPath: string): ArtifactState {
  return {
    version: 1,
    primary_path: primaryPath,
    secondary_paths: [],
    snapshot_version: 1,
    last_modified: Date.now(),
    byte_size: 0,
  };
}

export async function readArtifactState(slug: string): Promise<ArtifactState | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/fs/artifact-state?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    const data = (await r.json().catch(() => null)) as { state?: unknown } | null;
    if (!data?.state) return null;
    return safeRead(ArtifactStateSchema, data.state, `readArtifactState(${slug})`);
  } catch {
    return null;
  }
}

export async function writeArtifactState(slug: string, state: ArtifactState): Promise<boolean> {
  try {
    safeWriteOrThrow(ArtifactStateSchema, state, `writeArtifactState(${slug})`);
    const r = await fetch(`${BRIDGE_URL}/fs/artifact-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, state }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Bump snapshot_version + refresh metadata. Called every time the user
 *  saves the artifact OR an assistant turn writes to disk. */
export async function bumpArtifactVersion(
  slug: string,
  patch: { primary_path?: string; byte_size?: number } = {},
): Promise<ArtifactState> {
  const current =
    (await readArtifactState(slug)) ?? makeInitialArtifactState(patch.primary_path ?? "index.html");
  const next: ArtifactState = {
    ...current,
    primary_path: patch.primary_path ?? current.primary_path,
    snapshot_version: current.snapshot_version + 1,
    last_modified: Date.now(),
    byte_size: patch.byte_size ?? current.byte_size,
  };
  await writeArtifactState(slug, next);
  return next;
}
