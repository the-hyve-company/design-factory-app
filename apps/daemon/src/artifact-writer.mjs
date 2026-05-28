// artifact-writer.mjs — atomic write + lock + backup pipeline.
//
// Endpoint POST /fs/write/artifact funnels through writeArtifactSafely()
// in this module so:
//
//   1. Lock per `finalPath` (D25 / Anti-pattern A15) — concurrent writes
//      to the same file are serialised through an in-process Map. Two
//      streams trying to land on `projects/gooey/index.html` at the same
//      time would otherwise interleave validate/rename/backup and corrupt
//      the rolling backup chain.
//
//   2. Daemon recalculates sha256 (D28 / A18). Whatever `contentHash` the
//      client sent is hint-only — used in logs to detect bugs in the
//      client parser, never trusted for lock keys, idempotency, or
//      backup naming.
//
//   3. Static P0 (will own the full check; the bare minimum
//      lives here): byte floor + structured-markup heuristic for HTML/SVG.
//      A heavier validator can plug in later via the same boolean return.
//
//   4. Atomic rename: write to .df/temp/{recalculatedHash}.{ext} then
//      `fs.rename()` over the final path. POSIX atomic on the same
//      filesystem.
//
//   5. Rolling backup of the previous artifact at .df/backups/
//      {timestamp}-{slug}.{ext}, capped at 10 entries per slug.
//
//   6. Idempotent: if recalculated hash matches the bytes already on disk,
//      return `{ noop: true }` without bumping the backup chain.
//
// What this module deliberately does NOT do:
//   - Runtime P0 (probe/iframe). owns it; called from the UI side.
//   - Path resolution against project registry. owns
//     resolveArtifactTarget(); for now we accept the caller's identifier
//     and just scope-check the final path.
//   - HTTP transport / CORS / JSON parsing. The HTTP handler in
//     `index.mjs` handles all of that and calls `writeArtifactSafely()`.

import { readFile, writeFile, mkdir, rename, stat, unlink, readdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, basename, extname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assertPathInScope, PathScopeError } from "./path-scope.mjs";
import { validateArtifactStaticP0Full } from "./static-p0.mjs";

// ─── Constants ───────────────────────────────────────────────────────────

/** Cap on artifact bytes accepted from a client. Spec §/ failure
 *  modes: anything larger triggers a regenerate prompt at the parser layer.
 *  This is the daemon-side hard floor. */
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Default minimum body bytes for HTML-family artifacts. HTML "vazio" is
 *  ~150 bytes of boilerplate; we want a real document, not a stub. Spec
 *  §deliverable 1. */
export const DEFAULT_MIN_HTML_BYTES = 200;

/** How many backup entries per slug to keep in `.df/backups/`. Spec
 *  §/ D17. */
export const BACKUP_RETENTION = 10;

/** Lock acquisition timeout. Two streams competing for the same path: the
 *  second one waits up to this long before failing with structured-conflict.
 *  Spec §/ D25. */
export const LOCK_WAIT_MS = 30_000;

// ─── Lock Map ────────────────────────────────────────────────────────────

// Per-`finalPath` lock. Key is the realpath of the target file (already
// scoped). Value is the in-flight Promise that resolves when the current
// holder finishes. New writers chain via `.then(() => doWork())` and
// replace the slot atomically.
const locks = new Map();

async function withFileLock(finalPath, fn) {
  const previous = locks.get(finalPath) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  // Important: store `next` BEFORE awaiting `previous`. That way a third
  // concurrent caller that arrives now will queue behind us, not behind
  // the holder we're about to replace.
  locks.set(finalPath, previous.then(() => next));

  // Bound the wait — if the queue is jammed (caller held the lock too long
  // because of a hung exec), surface a structured-conflict instead of
  // hanging the request forever.
  const timeoutErr = new Error("lock acquire timeout");
  timeoutErr.code = "LOCK_TIMEOUT";
  let timeoutId = null;
  const waited = await Promise.race([
    previous.then(() => "ok"),
    new Promise((_, reject) => { timeoutId = setTimeout(() => reject(timeoutErr), LOCK_WAIT_MS); }),
  ]).catch((err) => { throw err; });
  if (timeoutId) clearTimeout(timeoutId);
  if (waited !== "ok") throw timeoutErr;

  try {
    return await fn();
  } finally {
    release();
    // Clean up the slot if it still points to OUR `next` promise. If a
    // newer writer chained on it already, we don't want to drop their
    // queue position by deleting.
    const current = locks.get(finalPath);
    // The chained promise may not be `next` itself but `previous.then(() =>
    // next)`. Comparing references is unreliable here, so we check on
    // settled state instead: if no one else is waiting, the chain has
    // resolved and we can drop the entry.
    if (current) {
      // Best-effort cleanup. If a third writer has already started, they
      // overwrote this slot before we got here.
      Promise.resolve(current).then(() => {
        if (locks.get(finalPath) === current) locks.delete(finalPath);
      }).catch(() => locks.delete(finalPath));
    }
  }
}

// ─── Static P0 (minimal) ────────────────────────────────────────────────

/**
 * Bare-minimum Static P0 — lands the floor; will swap in
 * the full validator (DOMParser parse, balanced tags, duplicate id detection,
 * etc). For HTML/SVG family the rule is: must start with structured markup,
 * must clear the byte floor. For everything else, just byte-floor (so we
 * never write zero-byte files by accident).
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function validateArtifactStaticP0Minimal({ type, content, minBytes = DEFAULT_MIN_HTML_BYTES }) {
  if (typeof content !== "string") {
    return { ok: false, reason: "content-not-string" };
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0) {
    return { ok: false, reason: "empty-content" };
  }
  const isHtmlFamily =
    type === "text/html" ||
    type === "image/svg+xml" ||
    type === "application/xhtml+xml";

  if (isHtmlFamily) {
    if (bytes < minBytes) {
      return { ok: false, reason: "below-min-bytes", details: { bytes, minBytes } };
    }
    const trimmed = content.replace(/^﻿/, "").trimStart();
    if (!/^(<!doctype\b|<html\b|<svg\b|<\?xml\b|<)/i.test(trimmed)) {
      return { ok: false, reason: "not-structured-markup" };
    }
  }
  return { ok: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sha256OfString(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function extensionForType(type, identifier) {
  // Prefer an explicit extension on the identifier path.
  const fromPath = extname(identifier).slice(1).toLowerCase();
  if (fromPath) return fromPath;
  // Fall back to a tiny mime → ext map for the families we actually emit.
  switch (type) {
    case "text/html": return "html";
    case "image/svg+xml": return "svg";
    case "text/markdown": return "md";
    case "text/plain": return "txt";
    case "application/json": return "json";
    case "text/css": return "css";
    case "application/javascript": return "js";
    default: return "bin";
  }
}

function slugForBackup(finalPath) {
  // backup file name = base of finalPath without extension, sanitized.
  const base = basename(finalPath, extname(finalPath));
  return base.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 60) || "artifact";
}

// Monotonic counter appended to the wall-clock timestamp. Without this,
// two writes that land in the same millisecond produce identical backup
// filenames — the second `writeFile()` silently overwrites the first and
// the backup chain loses an entry. Caused a CI flake on the concurrency
// test (5 parallel writes routinely collide on fast runners); see PR fix.
// Reset on process restart is fine: ISO timestamp still places older
// entries first across restarts, and within a process the counter is
// strictly monotonic. Base36 padded to 6 chars sorts lexicographically
// with the ISO prefix (one process won't reach 36^6 ≈ 2.1B writes).
let backupSequence = 0;

function timestampForBackup(now = new Date()) {
  const seq = (backupSequence++).toString(36).padStart(6, "0");
  // ISO-8601 with `:` swapped for `-` so it survives Windows filesystems.
  return now.toISOString().replace(/[:]/g, "-") + "-" + seq;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

/**
 * Rotate `.df/backups/` to keep only the most recent BACKUP_RETENTION
 * entries that match `{prefix}-{slug}.{ext}`. We sort by name (timestamps
 * are ISO-8601 → lex order = chronological) and unlink the oldest until
 * we're at the cap.
 */
async function pruneBackups(backupDir, slug, ext) {
  let entries;
  try {
    entries = await readdir(backupDir);
  } catch {
    return;
  }
  const matching = entries
    .filter((name) => name.endsWith(`-${slug}.${ext}`))
    .sort(); // ISO timestamps sort lexicographically.
  while (matching.length > BACKUP_RETENTION) {
    const old = matching.shift();
    if (!old) break;
    try { await unlink(join(backupDir, old)); } catch { /* best-effort */ }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} ArtifactWriteInput
 * @property {string} identifier        Path inside the project (e.g.
 *   "projects/gooey/index.html"). Caller has already trimmed/normalised.
 * @property {string} type              MIME type (e.g. "text/html").
 * @property {string} content           Document body.
 * @property {string} [contentHash]     OPTIONAL hint hash from the client.
 *   Logged-only; never trusted (D28).
 * @property {string} repoRoot          Absolute repo root (caller already
 *   resolved via git-common-dir).
 * @property {number} [minBytes]        Override Static P0 minimum-bytes
 *   floor (skill-specific). Defaults to DEFAULT_MIN_HTML_BYTES.
 *
 * @typedef {Object} ArtifactWriteResult
 * @property {true} ok
 * @property {string} finalPath          Absolute path that was written.
 * @property {string} hash               Daemon-recalculated sha256 hex.
 * @property {string|null} backupPath    Absolute path of the backup of the
 *   previous file, or null if there was no previous file (first write).
 * @property {boolean} noop              True when the file already had the
 *   same hash and we returned without writing.
 * @property {boolean} hashHintMismatch  True when the client-supplied
 *   `contentHash` differed from the recalculated hash. Always logged;
 *   never blocks the write.
 *
 * @returns {Promise<ArtifactWriteResult>}
 *
 * Throws on:
 *   - PathScopeError (path escapes scope) — caller should return 400.
 *   - Error with `code === "STATIC_FAIL"` — caller should return 422 with
 *     `{ error, code, reason }`.
 *   - Error with `code === "OVERSIZE"` — caller should return 413.
 *   - Error with `code === "LOCK_TIMEOUT"` — caller should return 409.
 */
export async function writeArtifactSafely({
  identifier,
  type,
  content,
  contentHash,
  repoRoot,
  minBytes,
}) {
  if (typeof identifier !== "string" || !identifier) {
    throw Object.assign(new Error("identifier required"), { code: "BAD_REQUEST" });
  }
  if (typeof type !== "string" || !type) {
    throw Object.assign(new Error("type required"), { code: "BAD_REQUEST" });
  }
  if (typeof content !== "string") {
    throw Object.assign(new Error("content must be a string"), { code: "BAD_REQUEST" });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) {
    throw Object.assign(new Error("artifact exceeds maximum size"), {
      code: "OVERSIZE",
      maxBytes: MAX_ARTIFACT_BYTES,
    });
  }
  if (typeof repoRoot !== "string" || !repoRoot) {
    throw Object.assign(new Error("repoRoot required"), { code: "BAD_REQUEST" });
  }

  // ── Resolve and scope the final path ──
  // identifier may come in as "projects/gooey/index.html" — we strip the
  // leading "projects/" because PROJECTS_ROOT already points at that dir.
  // If the identifier has no "projects/" prefix, treat it as already
  // relative to PROJECTS_ROOT.
  const projectsRoot = realpathSync(join(repoRoot, "projects"));
  const trimmedIdentifier = identifier.replace(/^\.?\/+/, "").replace(/^projects\//, "");
  const finalPath = assertPathInScope(trimmedIdentifier, projectsRoot);
  // The identifier must point at a file under a project slug, not at the
  // projects root itself. resolve() would happily produce that on bad
  // input; reject explicitly.
  if (resolve(finalPath) === resolve(projectsRoot)) {
    throw new PathScopeError("identifier resolves to PROJECTS_ROOT itself", "PATH_INVALID");
  }
  // Identify project slug from the path (first segment under projectsRoot).
  const relFromRoot = finalPath.slice(projectsRoot.length).replace(/^[/\\]+/, "");
  const slugSegment = relFromRoot.split(/[/\\]/)[0];
  if (!slugSegment) {
    throw new PathScopeError("identifier missing project slug", "PATH_NO_SLUG");
  }

  // ── Daemon recalculates hash (D28). ──
  const recalculatedHash = sha256OfString(content);
  const hashHintMismatch =
    typeof contentHash === "string" && contentHash.length > 0 && contentHash !== recalculatedHash;
  if (hashHintMismatch) {
    console.warn(
      `[artifact-writer] hash hint mismatch for ${slugSegment}: ` +
      `client=${contentHash.slice(0, 12)}… recalc=${recalculatedHash.slice(0, 12)}… ` +
      `(D28: trusting recalculated)`
    );
  }

  // ── Acquire per-finalPath lock and execute the rest. ──
  return withFileLock(finalPath, async () => {
    // ── Idempotency: if the bytes on disk already match recalculated
    //    hash, return without rotating the backup chain.
    if (existsSync(finalPath)) {
      try {
        const onDisk = await readFile(finalPath, "utf8");
        const onDiskHash = sha256OfString(onDisk);
        if (onDiskHash === recalculatedHash) {
          return {
            ok: true,
            finalPath,
            hash: recalculatedHash,
            backupPath: null,
            noop: true,
            hashHintMismatch,
          };
        }
      } catch {
        // Read failure: fall through to the write path; we'll attempt to
        // overwrite (and atomic rename will surface the real error if any).
      }
    }

    // ── Static P0 (: type-aware full version). Static fail NEVER
    //    substitutes the current file (D26 / Amendment v0.3.2). The full
    //    validator covers HTML/SVG/MD/JSON/CSS/JS/binary; legacy callers
    //    that hit only the minimal floor get the same outcome since the
    //    full version is a strict superset.
    const staticResult = validateArtifactStaticP0Full({ type, content, byteFloor: minBytes });
    if (!staticResult.ok) {
      const err = new Error(`static-fail: ${staticResult.reason}`);
      err.code = "STATIC_FAIL";
      err.reason = staticResult.reason;
      err.details = staticResult.details;
      err.failedChecks = staticResult.failedChecks;
      throw err;
    }

    // ── Layout the .df folders. ──
    const slugRoot = join(projectsRoot, slugSegment);
    const dfRoot = join(slugRoot, ".df");
    const tempDir = join(dfRoot, "temp");
    const backupDir = join(dfRoot, "backups");
    await ensureDir(tempDir);
    await ensureDir(backupDir);
    // The final file's parent must also exist (e.g. projects/x/variants/).
    await ensureDir(dirname(finalPath));

    const ext = extensionForType(type, identifier);
    const tempPath = join(tempDir, `${recalculatedHash}.${ext}`);
    await writeFile(tempPath, content, "utf8");

    // ── Backup the current file (if any) BEFORE atomic rename. If the
    //    rename fails after backup, no harm done; the backup is just
    //    redundant. If we backed up AFTER rename, a crash between rename
    //    and backup would lose the previous content forever.
    let backupPath = null;
    if (existsSync(finalPath)) {
      const ts = timestampForBackup();
      const backupSlug = slugForBackup(finalPath);
      backupPath = join(backupDir, `${ts}-${backupSlug}.${ext}`);
      // Use rename-or-copy: rename is atomic on same fs but breaks if
      // the source is in use; we fall back to readFile+writeFile.
      try {
        const prev = await readFile(finalPath);
        await writeFile(backupPath, prev);
      } catch (err) {
        // Backup failure is non-fatal — log and proceed with the rename.
        console.warn(`[artifact-writer] backup failed for ${finalPath}: ${err.message}`);
        backupPath = null;
      }
    }

    // ── Atomic rename. POSIX `rename()` is atomic on the same filesystem.
    await rename(tempPath, finalPath);

    // ── Prune backups to retention cap. Best-effort, don't fail the write.
    if (backupPath) {
      try { await pruneBackups(backupDir, slugForBackup(finalPath), ext); } catch { /* */ }
    }

    return {
      ok: true,
      finalPath,
      hash: recalculatedHash,
      backupPath,
      noop: false,
      hashHintMismatch,
    };
  });
}

// ─── Public API (deliverable 6: catastrophic rollback) ────────

/**
 * Catastrophic rollback / empty-state delete. Used when the client's
 * Runtime P0 reports `catastrophic` AND there's no backup to restore
 * (first artifact ever for this slug, or `.df/backups/` empty).
 *
 * Refuses to touch anything inside `.df/` — those are framework-owned
 * (registry, backups, provider sessions). Validates the path scope same
 * way the write endpoint does, so a malicious caller can't escape the
 * project tree.
 *
 * Idempotent: missing files return `{ ok: true, deleted: false }` so
 * concurrent rollback attempts don't conflict.
 *
 * @param {Object} input
 * @param {string} input.requestedPath  Path inside the project, optionally
 *   `projects/`-prefixed (the HTTP handler accepts the same shape).
 * @param {string} input.repoRoot        Absolute repo root.
 *
 * @returns {Promise<{ ok: true, deleted: boolean, finalPath: string }>}
 *
 * Throws on:
 *   - PathScopeError → 400.
 *   - Error with code "PROTECTED_PATH" → 403 (.df/ delete attempt).
 *   - Error with code "BAD_REQUEST" → 400 (missing/invalid input).
 */
export async function deleteArtifactSafely({ requestedPath, repoRoot }) {
  if (typeof requestedPath !== "string" || !requestedPath) {
    throw Object.assign(new Error("path required"), { code: "BAD_REQUEST" });
  }
  if (typeof repoRoot !== "string" || !repoRoot) {
    throw Object.assign(new Error("repoRoot required"), { code: "BAD_REQUEST" });
  }
  const projectsRoot = realpathSync(join(repoRoot, "projects"));
  const trimmed = requestedPath
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/^projects\//, "");
  const finalPath = assertPathInScope(trimmed, projectsRoot);
  // The catastrophic delete must NEVER touch .df/ — registry, backups, and
  // provider sessions are framework-owned. Caller bug or hostile input
  // gets blocked here.
  const relFromRoot = finalPath.slice(projectsRoot.length).replace(/^[/\\]+/, "");
  const segments = relFromRoot.split(/[/\\]/);
  if (segments.includes(".df")) {
    throw Object.assign(new Error("DELETE refused: .df/ is framework-owned"), {
      code: "PROTECTED_PATH",
    });
  }
  const existedBefore = existsSync(finalPath);
  if (existedBefore) {
    await unlink(finalPath);
  }
  return { ok: true, deleted: existedBefore, finalPath };
}

// ─── Exported test helpers (for unit tests, not for HTTP callers) ────────

export const __TEST_INTERNALS__ = {
  withFileLock,
  sha256OfString,
  pruneBackups,
  timestampForBackup,
  slugForBackup,
  extensionForType,
  // Inspect the live lock map (read-only).
  inspectLocks: () => Array.from(locks.keys()),
};

// Suppress unused import warnings in TS-aware editors when this file is
// scanned by tooling that ignores `.mjs` types. Each of these symbols is
// referenced above; the explicit list keeps a future cleanup pass honest.
void stat;
