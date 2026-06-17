// project-files.mjs — project files registry storage (spec
// v0.3.4 §, Amendment v0.3.4).
//
// Owns the read/write/lock pipeline for `.df/project-files.json` plus the
// filesystem-scan inferRegistry for legacy projects (no registry yet) and
// for corrupted-registry rebuild.
//
// The canonical schema lives in TypeScript at `src/lib/project-files.ts`
// (used by the frontend types). Daemon validates inline with plain JS
// because daemon is mjs-only and we don't pull a TS build step in here.
// A symmetry test (`project-files.test.mjs`) keeps the two from drifting.
//
// Lock pattern mirrors `artifact-writer.mjs` — per-path Map<string,
// Promise<void>> in process memory. Two concurrent writes to the same
// `project-files.json` serialise. Two writes to different projects don't
// contend. We don't share the lock map with artifact-writer because the
// keys live in different namespaces (registry path vs artifact final path).
//
// What this module deliberately does NOT do:
//   - Resolve where an artifact should be written (that's
//     `resolve-artifact-target.mjs`, also ).
//   - Do filesystem mutations on the artifact files themselves
//     (artifact-writer.mjs owns that).
//   - HTTP transport. Endpoints in `index.mjs` call this module.

import { readFile, writeFile, mkdir, rename, readdir, stat, unlink } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, basename, extname, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { assertPathInScope } from "./path-scope.mjs";

// ─── Constants ───────────────────────────────────────────────────────────

export const REGISTRY_VERSION = 1;
export const REGISTRY_BASENAME = "project-files.json";
export const REGISTRY_DIRNAME = ".df";

/** Folders that map to a known role when we walk a project tree (matches
 *  ROLE_FOLDER_HINTS in src/lib/project-files.ts). */
const ROLE_FOLDERS = [
  { folder: "variants", role: "variant", recursive: true },
  { folder: "docs", role: "doc", recursive: true },
  { folder: "prompts", role: "prompt", recursive: true },
  { folder: "data", role: "data", recursive: true },
  { folder: "assets", role: "asset", recursive: true },
];

/** Mime defaults by extension. Matches inferRoleFromPath defaults but for type. */
const EXT_TO_MIME = {
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  xhtml: "application/xhtml+xml",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

const PREVIEWABLE_MIMES = new Set(["text/html", "image/svg+xml", "application/xhtml+xml"]);

/** Lock acquire timeout for the registry — keep the same ceiling as
 *  artifact writes so a hung registry update can't block the request
 *  forever. Spec §failure modes. */
export const REGISTRY_LOCK_WAIT_MS = 30_000;

// ─── Lock Map (per registry path) ────────────────────────────────────────

const registryLocks = new Map();

async function withRegistryLock(registryPath, fn) {
  const previous = registryLocks.get(registryPath) || Promise.resolve();
  let release;
  const next = new Promise((r) => {
    release = r;
  });
  registryLocks.set(
    registryPath,
    previous.then(() => next),
  );

  const timeoutErr = new Error(`registry lock acquire timeout: ${registryPath}`);
  timeoutErr.code = "REGISTRY_LOCK_TIMEOUT";
  let timeoutId = null;
  const waited = await Promise.race([
    previous.then(() => "ok"),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(timeoutErr), REGISTRY_LOCK_WAIT_MS);
    }),
  ]).catch((err) => {
    throw err;
  });
  if (timeoutId) clearTimeout(timeoutId);
  if (waited !== "ok") throw timeoutErr;

  try {
    return await fn();
  } finally {
    release();
    const current = registryLocks.get(registryPath);
    if (current) {
      Promise.resolve(current)
        .then(() => {
          if (registryLocks.get(registryPath) === current) registryLocks.delete(registryPath);
        })
        .catch(() => registryLocks.delete(registryPath));
    }
  }
}

// ─── Schema validation (plain JS) ────────────────────────────────────────

const VALID_ROLES = new Set(["primary", "variant", "doc", "prompt", "data", "asset"]);

/** Returns null if valid, or `{ error: string }` if not. We intentionally
 *  do NOT throw here — the caller (read or upsert) decides whether to
 *  rebuild from filesystem or surface the error. */
export function validateRegistryShape(value) {
  if (!value || typeof value !== "object") return { error: "registry-not-object" };
  if (value.version !== REGISTRY_VERSION) return { error: `unsupported-version: ${value.version}` };
  if (typeof value.primaryFile !== "string" || !value.primaryFile)
    return { error: "primaryFile-missing" };
  if (typeof value.activeFile !== "string" || !value.activeFile)
    return { error: "activeFile-missing" };
  if (!value.files || typeof value.files !== "object") return { error: "files-not-object" };
  // primaryFile must exist as a key in files.
  if (!Object.prototype.hasOwnProperty.call(value.files, value.primaryFile)) {
    return { error: "primaryFile-not-in-files" };
  }
  if (!Object.prototype.hasOwnProperty.call(value.files, value.activeFile)) {
    return { error: "activeFile-not-in-files" };
  }
  for (const [path, entry] of Object.entries(value.files)) {
    if (typeof path !== "string" || !path) return { error: "file-key-not-string" };
    if (!entry || typeof entry !== "object") return { error: `entry-not-object: ${path}` };
    if (typeof entry.type !== "string" || !entry.type)
      return { error: `entry-type-missing: ${path}` };
    if (!VALID_ROLES.has(entry.role)) return { error: `entry-role-invalid: ${path}` };
    if (typeof entry.previewable !== "boolean")
      return { error: `entry-previewable-not-bool: ${path}` };
    if (typeof entry.createdAt !== "string") return { error: `entry-createdAt-missing: ${path}` };
    if (typeof entry.updatedAt !== "string") return { error: `entry-updatedAt-missing: ${path}` };
    if (entry.title !== undefined && typeof entry.title !== "string")
      return { error: `entry-title-not-string: ${path}` };
    if (entry.hash !== undefined && typeof entry.hash !== "string")
      return { error: `entry-hash-not-string: ${path}` };
    if (entry.parent !== undefined && typeof entry.parent !== "string")
      return { error: `entry-parent-not-string: ${path}` };
  }
  return null;
}

// ─── Path helpers ────────────────────────────────────────────────────────

/** Resolve the registry path for a slug. */
export function registryPathForSlug(slug, projectsRoot) {
  if (typeof slug !== "string" || !slug) {
    throw Object.assign(new Error("slug required"), { code: "BAD_REQUEST" });
  }
  // path-scope check: ensure slug doesn't escape projects root.
  const slugRoot = assertPathInScope(slug, projectsRoot);
  return join(slugRoot, REGISTRY_DIRNAME, REGISTRY_BASENAME);
}

/** Project root (absolute) for a slug, scoped under projectsRoot. */
export function projectRootForSlug(slug, projectsRoot) {
  return assertPathInScope(slug, projectsRoot);
}

/** Convert an absolute path under projectsRoot to a forward-slash
 *  registry-key (e.g. `projects/gooey/variants/dark.html`). */
export function toRegistryKey(absPath, projectsRoot) {
  const rel = relative(projectsRoot, absPath).split(sep).join("/");
  return `projects/${rel}`;
}

/** Reverse: registry-key → absolute path. */
export function fromRegistryKey(key, projectsRoot) {
  if (typeof key !== "string" || !key.startsWith("projects/")) {
    throw Object.assign(new Error(`invalid registry key: ${key}`), { code: "BAD_REQUEST" });
  }
  const tail = key.slice("projects/".length);
  return join(projectsRoot, tail);
}

function extOf(p) {
  return extname(p).slice(1).toLowerCase();
}

function mimeFor(p) {
  return EXT_TO_MIME[extOf(p)] || "application/octet-stream";
}

function previewableForType(type) {
  return PREVIEWABLE_MIMES.has(type);
}

function sha256OfBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ─── Atomic write helpers (mirror style) ────────────────────────

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function atomicWriteJson(absPath, value) {
  await ensureDir(dirname(absPath));
  // Use a unique tmp suffix so a concurrent writer (different lock holder
  // somehow) can't clobber our temp file mid-rename.
  const tmp =
    absPath +
    ".tmp." +
    process.pid +
    "." +
    Date.now() +
    "." +
    Math.random().toString(36).slice(2, 8);
  const json = JSON.stringify(value, null, 2) + "\n";
  await writeFile(tmp, json, "utf8");
  try {
    await rename(tmp, absPath);
  } catch (err) {
    // Cleanup tmp on rename failure (Windows: target-exists semantics).
    try {
      await unlink(tmp);
    } catch {
      /* */
    }
    throw err;
  }
}

// ─── Filesystem walker (for inferRegistryFromFilesystem) ─────────────────

const IGNORED_DIRS = new Set([".df", "node_modules", ".git", ".DS_Store"]);

async function walkProject(slugRoot) {
  const out = [];
  async function walk(dir, relParts) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (IGNORED_DIRS.has(ent.name)) continue;
      const abs = join(dir, ent.name);
      const nextParts = [...relParts, ent.name];
      if (ent.isDirectory()) {
        await walk(abs, nextParts);
      } else if (ent.isFile()) {
        out.push({ abs, relParts: nextParts });
      }
    }
  }
  await walk(slugRoot, []);
  return out;
}

/**
 * Pick the primary file for a project from a list of relative-path arrays.
 * Preference order:
 *   1. `index.html`
 *   2. `{slug}.html`
 *   3. First top-level `.html`
 *   4. Any top-level previewable file
 *   5. null (no primary candidate)
 */
function pickPrimary(slug, fileRels) {
  const topLevelHtml = fileRels.filter((parts) => parts.length === 1 && parts[0].endsWith(".html"));
  const indexHit = topLevelHtml.find((parts) => parts[0] === "index.html");
  if (indexHit) return indexHit.join("/");
  const slugHit = topLevelHtml.find((parts) => parts[0] === `${slug}.html`);
  if (slugHit) return slugHit.join("/");
  if (topLevelHtml[0]) return topLevelHtml[0].join("/");
  // Any top-level previewable (svg/xhtml).
  const otherTop = fileRels.find((parts) => {
    if (parts.length !== 1) return false;
    return PREVIEWABLE_MIMES.has(mimeFor(parts[0]));
  });
  if (otherTop) return otherTop.join("/");
  return null;
}

function roleForRelParts(parts) {
  if (parts.length === 1) {
    // Top-level file: previewable = primary candidate, others = doc/data/etc by extension.
    const type = mimeFor(parts[0]);
    if (PREVIEWABLE_MIMES.has(type)) return "primary";
    if (type === "text/markdown") return "doc";
    if (type === "text/plain") return "doc";
    if (type === "application/json") return "data";
    return "asset";
  }
  // Subfolder file: use ROLE_FOLDERS to pick role.
  const folder = parts[0];
  for (const hint of ROLE_FOLDERS) {
    if (folder === hint.folder) return hint.role;
  }
  // Unknown subfolder: type-based default.
  const type = mimeFor(parts[parts.length - 1]);
  if (PREVIEWABLE_MIMES.has(type)) return "variant";
  if (type === "text/markdown") return "doc";
  if (type === "text/plain") return "doc";
  if (type === "application/json") return "data";
  return "asset";
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Infer a registry from disk by walking the project root. Used when:
 *   - Project has no `.df/project-files.json` yet (legacy migration).
 *   - Existing registry file is corrupted (rebuild fallback).
 *
 * Always returns a valid registry. If the project has no files at all,
 * synthesises a placeholder primary entry pointing at `{slug}/index.html`
 * even though it doesn't exist on disk yet — the next artifact write will
 * create it. (Without this we'd have no `primaryFile`, which violates the
 * schema.)
 *
 * Hashes are computed lazily (we read each file). For very large projects
 * this becomes the dominant cost; bound is the spec's "small project"
 * assumption (dozens of files, not thousands).
 */
export async function inferRegistryFromFilesystem(slug, projectsRoot) {
  if (typeof slug !== "string" || !slug) {
    throw Object.assign(new Error("slug required"), { code: "BAD_REQUEST" });
  }
  const slugRoot = projectRootForSlug(slug, projectsRoot);
  // Walk only if slug root exists; otherwise produce an empty placeholder.
  let files = [];
  if (existsSync(slugRoot)) {
    files = await walkProject(slugRoot);
  }
  const fileRels = files.map((f) => f.relParts);
  const now = new Date().toISOString();

  const filesMap = {};
  for (const f of files) {
    const role = roleForRelParts(f.relParts);
    const type = mimeFor(f.relParts[f.relParts.length - 1]);
    let hash;
    let mtime = now;
    let ctime = now;
    try {
      const buf = await readFile(f.abs);
      hash = sha256OfBuffer(buf);
    } catch {
      /* unreadable — skip hash */
    }
    try {
      const s = await stat(f.abs);
      mtime = s.mtime.toISOString();
      ctime = s.birthtime ? s.birthtime.toISOString() : mtime;
    } catch {
      /* */
    }
    const key = `projects/${slug}/${f.relParts.join("/")}`;
    const entry = {
      type,
      role,
      previewable: previewableForType(type),
      createdAt: ctime,
      updatedAt: mtime,
    };
    if (hash) entry.hash = hash;
    filesMap[key] = entry;
  }

  // Decide primaryFile.
  const primaryRel = pickPrimary(slug, fileRels);
  const primaryKey = primaryRel ? `projects/${slug}/${primaryRel}` : `projects/${slug}/index.html`;

  // If primary doesn't exist as an entry yet (no files on disk), synthesise.
  if (!filesMap[primaryKey]) {
    filesMap[primaryKey] = {
      type: "text/html",
      role: "primary",
      previewable: true,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // Force the picked primary's role to `primary` even if walker tagged
    // it `variant` because of where it landed. pickPrimary is authoritative.
    filesMap[primaryKey].role = "primary";
  }

  return {
    version: REGISTRY_VERSION,
    primaryFile: primaryKey,
    activeFile: primaryKey,
    files: filesMap,
  };
}

/**
 * Read the registry from disk. Returns `null` if the file does not exist.
 * Callers should use `validateOrRebuild()` for the "always return valid"
 * behaviour that auto-rebuilds on corruption.
 */
export async function readRegistry(slug, projectsRoot) {
  const path = registryPathForSlug(slug, projectsRoot);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    // Read failed (perms, etc.). Surface as null so caller falls back to
    // rebuild via validateOrRebuild.
    console.warn(`[project-files] read failed for ${path}: ${err.message}`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[project-files] JSON parse failed for ${path}: ${err.message}`);
    return null;
  }
  const validation = validateRegistryShape(parsed);
  if (validation) {
    console.warn(`[project-files] schema validation failed for ${path}: ${validation.error}`);
    return null;
  }
  return parsed;
}

/**
 * Write the registry atomically. Caller is responsible for passing a
 * shape-valid registry; we re-validate as a defensive belt.
 */
export async function writeRegistry(slug, projectsRoot, registry) {
  const path = registryPathForSlug(slug, projectsRoot);
  const validation = validateRegistryShape(registry);
  if (validation) {
    throw Object.assign(new Error(`invalid registry: ${validation.error}`), {
      code: "INVALID_REGISTRY",
      reason: validation.error,
    });
  }
  await withRegistryLock(path, async () => {
    await atomicWriteJson(path, registry);
  });
}

/**
 * Read + validate. On any failure (missing, corrupt, schema-invalid) rebuild
 * from filesystem and persist. Always returns a valid registry.
 */
export async function validateOrRebuild(slug, projectsRoot) {
  const existing = await readRegistry(slug, projectsRoot);
  if (existing) return existing;
  const rebuilt = await inferRegistryFromFilesystem(slug, projectsRoot);
  // Persist the rebuilt registry so subsequent reads are O(1) again.
  // Best-effort: if the write fails (permissions), we still return the
  // in-memory registry so the request can proceed.
  try {
    await writeRegistry(slug, projectsRoot, rebuilt);
  } catch (err) {
    console.warn(
      `[project-files] write-back of rebuilt registry failed for ${slug}: ${err.message}`,
    );
  }
  return rebuilt;
}

/**
 * Update or insert a file entry, optionally updating activeFile/primaryFile.
 * Atomic: reads the current registry under lock, mutates, writes. Caller
 * supplies the entry to upsert plus optional flags. If the registry doesn't
 * exist yet, it's rebuilt-then-upserted in the same locked critical section.
 *
 * @param {Object} input
 * @param {string} input.slug
 * @param {string} input.projectsRoot
 * @param {string} input.key                 — registry key (projects/{slug}/...).
 * @param {Object} input.entry               — partial entry to merge over the existing one.
 * @param {boolean} [input.setActive]        — set activeFile = key after upsert.
 * @param {boolean} [input.setPrimary]       — set primaryFile = key after upsert (also forces role=primary).
 * @returns {Promise<{ registry, entry }>}
 */
export async function upsertFile({ slug, projectsRoot, key, entry, setActive, setPrimary }) {
  const path = registryPathForSlug(slug, projectsRoot);
  return withRegistryLock(path, async () => {
    // Read inside the lock — outside reads can race with the write below.
    let registry = await readRegistry(slug, projectsRoot);
    if (!registry) {
      registry = await inferRegistryFromFilesystem(slug, projectsRoot);
    }
    const now = new Date().toISOString();
    const existing = registry.files[key];
    const mergedRole = setPrimary ? "primary" : entry.role || existing?.role || "variant";
    const merged = {
      type: entry.type || existing?.type || "application/octet-stream",
      role: mergedRole,
      previewable:
        typeof entry.previewable === "boolean"
          ? entry.previewable
          : (existing?.previewable ?? previewableForType(entry.type || existing?.type || "")),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (entry.title !== undefined) merged.title = entry.title;
    else if (existing?.title !== undefined) merged.title = existing.title;
    if (entry.hash !== undefined) merged.hash = entry.hash;
    else if (existing?.hash !== undefined) merged.hash = existing.hash;
    if (entry.parent !== undefined) merged.parent = entry.parent;
    else if (existing?.parent !== undefined) merged.parent = existing.parent;

    registry.files[key] = merged;

    if (setPrimary) {
      registry.primaryFile = key;
    }
    if (setActive) {
      registry.activeFile = key;
    }
    // Defensive: if the previous primaryFile no longer exists in files (we
    // somehow removed it), reset to the upserted key.
    if (!registry.files[registry.primaryFile]) {
      registry.primaryFile = key;
    }
    if (!registry.files[registry.activeFile]) {
      registry.activeFile = key;
    }
    // Final shape check.
    const validation = validateRegistryShape(registry);
    if (validation) {
      throw Object.assign(new Error(`registry post-upsert invalid: ${validation.error}`), {
        code: "INVALID_REGISTRY",
        reason: validation.error,
      });
    }
    await atomicWriteJson(path, registry);
    return { registry, entry: merged };
  });
}

// ─── Test internals ──────────────────────────────────────────────────────

export const __TEST_INTERNALS__ = {
  withRegistryLock,
  inspectLocks: () => Array.from(registryLocks.keys()),
  pickPrimary,
  roleForRelParts,
  mimeFor,
  previewableForType,
  walkProject,
};
