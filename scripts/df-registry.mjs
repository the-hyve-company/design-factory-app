// df-registry — GLOBAL (cross-clone) registry of running Design Factory
// instances. The per-folder lockfile (.df/daemon.lock) only sees instances in
// its own clone; with several clones a launcher in clone A can't see clone B's
// instance, treats 1420/1421 as "taken by a stranger", and diverts to odd ports
// (1423/1424) — the exact confusion the founder hit. This registry, in the
// user's home, lets any launcher / the `df` CLI see EVERY instance in EVERY
// folder, prune the dead ones (Windows window-close orphans), and resolve
// conflicts deliberately instead of diverting silently.
//
// Storage: ~/.design-factory/instances.json — a JSON array of entries, written
// atomically (temp + rename). Override the dir with DF_REGISTRY_DIR (tests).
//
// Zero external deps — pure Node core. Reuses df-core for liveness checks.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { pidAlive, isOurDaemon } from "./df-core.mjs";

/** @typedef {{
 *   folder: string, mode: string,
 *   daemonPort: number, vitePort: number,
 *   daemonPid: number|null, vitePid: number|null,
 *   startedAt: number,
 * }} Instance */

export function registryDir() {
  return process.env.DF_REGISTRY_DIR || join(homedir(), ".design-factory");
}

export function registryPath() {
  return join(registryDir(), "instances.json");
}

// Read the registry. Tolerant: missing file or corrupt JSON → []. Never throws.
export function readRegistry() {
  try {
    const raw = readFileSync(registryPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Atomic write: serialize to a temp sibling, then rename over the target so a
// concurrent reader never sees a half-written file. Best-effort (never throws).
export function writeRegistry(list) {
  try {
    const dir = registryDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = registryPath();
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

// Drop entries whose daemon PID is no longer alive (cheap, sync). This is what
// reaps a Windows window-close orphan on the next launch. Returns the kept list.
export function pruneRegistry() {
  const kept = readRegistry().filter((e) => e && e.daemonPid && pidAlive(e.daemonPid));
  writeRegistry(kept);
  return kept;
}

// Register (or update) THIS instance. One entry per folder: an upsert keyed on
// `folder`, so a relaunch in the same clone replaces its old row. Prunes dead
// rows in the same pass.
export function registerInstance(entry) {
  if (!entry || !entry.folder) return readRegistry();
  const list = readRegistry().filter(
    (e) => e && e.daemonPid && pidAlive(e.daemonPid) && e.folder !== entry.folder,
  );
  list.push(entry);
  writeRegistry(list);
  return list;
}

// Remove THIS folder's instance (called on graceful shutdown).
export function deregisterInstance(folder) {
  if (!folder) return readRegistry();
  const list = readRegistry().filter((e) => e && e.folder !== folder);
  writeRegistry(list);
  return list;
}

// Live instances (pid alive), after pruning. With { checkHealth: true } each
// entry is annotated async with `healthy` (daemon answers /healthz) — used by
// `df status` / `df doctor`.
export async function listInstances({ checkHealth = false } = {}) {
  const list = pruneRegistry();
  if (!checkHealth) return list;
  return Promise.all(list.map(async (e) => ({ ...e, healthy: await isOurDaemon(e.daemonPort) })));
}

// Live instances in a DIFFERENT folder than `folder` — the cross-clone conflict
// set. A launcher uses this to show the CONFLICT panel instead of diverting.
export function findLiveElsewhere(folder) {
  return pruneRegistry().filter((e) => e.folder !== folder);
}
