// project-files.ts — canonical Zod schema + TypeScript types for the
// `.df/project-files.json` registry that turns each DF project into a
// "pasta viva" instead of a single HTML.
//
// Why this lives in src/lib/ (not src/runtime/): pure type/shape
// definitions with no I/O. Both the frontend (file picker, status
// surface) and the daemon (`apps/daemon/src/project-files.mjs`)
// consume this contract; the daemon duplicates the validation in
// plain JS so it stays mjs-only without a TS build step. Tests guard
// that the two stay in sync.
//
// Storage and atomic writes belong in the daemon module (lock per
// `.df/project-files.json` path, mirroring the artifact-writer
// approach). This file deliberately ships zero filesystem code.
//
// Migration: a project without `.df/project-files.json` is "legacy"; the
// daemon infers a registry on first read by globbing the project tree
// (`inferRegistryFromFilesystem`).

import { z } from "zod";

// ─── Roles ──────────────────────────────────────────────────────────────

/**
 * Project file role taxonomy (Amendment v0.3.4).
 *
 *  - `primary`  — default preview, the file that opens when the project mounts.
 *  - `variant`  — alternate take of the primary (same role, different look).
 *  - `doc`      — markdown notes, briefings, specs.
 *  - `prompt`   — saved prompts/briefings (text/plain).
 *  - `data`     — structured data (JSON).
 *  - `asset`    — images, fonts, CSS, JS auxiliary files.
 */
export const ProjectFileRoleSchema = z.enum([
  "primary",
  "variant",
  "doc",
  "prompt",
  "data",
  "asset",
]);

export type ProjectFileRole = z.infer<typeof ProjectFileRoleSchema>;

// ─── Per-file entry ─────────────────────────────────────────────────────

/**
 * Map of well-known role-by-folder hints.
 * Used by `inferRoleFromPath()` and `resolveArtifactTarget()` so a path
 * inside `variants/` defaults to `variant`, etc.
 *
 * `assets/` matches recursively (e.g. `assets/images/foo.png`).
 */
export const ROLE_FOLDER_HINTS: ReadonlyArray<{
  folder: string;
  role: ProjectFileRole;
  recursive?: boolean;
}> = [
  { folder: "variants", role: "variant" },
  { folder: "docs", role: "doc" },
  { folder: "prompts", role: "prompt" },
  { folder: "data", role: "data" },
  { folder: "assets", role: "asset", recursive: true },
];

/**
 * Tiny mime-type ↔ default-role table. The resolver uses this to flag
 * type/role mismatches (e.g. role=primary but path is `assets/foo.png`).
 *
 * Not exhaustive — extension is the main signal; mime-type is a corroboration
 * hint for the runtime gate.
 */
export const TYPE_TO_DEFAULT_ROLES: Readonly<Record<string, ReadonlyArray<ProjectFileRole>>> = {
  "text/html": ["primary", "variant"],
  "image/svg+xml": ["primary", "variant", "asset"],
  "application/xhtml+xml": ["primary", "variant"],
  "text/markdown": ["doc"],
  "text/plain": ["prompt", "doc"],
  "application/json": ["data"],
  "text/css": ["asset"],
  "application/javascript": ["asset"],
  "image/png": ["asset"],
  "image/jpeg": ["asset"],
  "image/gif": ["asset"],
  "image/webp": ["asset"],
  "font/woff": ["asset"],
  "font/woff2": ["asset"],
  "font/ttf": ["asset"],
};

/** Types that are previewable (Runtime P0 = sim, see spec §). */
export const PREVIEWABLE_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "image/svg+xml",
  "application/xhtml+xml",
]);

export const ProjectFileEntrySchema = z.object({
  /** Mime type — see `PREVIEWABLE_TYPES` and `TYPE_TO_DEFAULT_ROLES`. */
  type: z.string().min(1),
  /** Role enum — guides UI and `resolveArtifactTarget()`. */
  role: ProjectFileRoleSchema,
  /** Optional human label, shown in file picker / done report. */
  title: z.string().optional(),
  /** Whether the runtime gate runs preview probes (type-aware). */
  previewable: z.boolean(),
  /** sha256 hex of the bytes on disk at `updatedAt`. May lag if file edited
   *  out of band; daemon refreshes lazily. Optional so we can write entries
   *  before the first hash is known (e.g. asset upload). */
  hash: z.string().optional(),
  /** For `variant`/`doc`/etc: the primary file this entry derives from.
   *  Path string (relative to projects/, same shape as registry keys). */
  parent: z.string().optional(),
  /** ISO-8601. */
  createdAt: z.string(),
  /** ISO-8601. */
  updatedAt: z.string(),
});

export type ProjectFileEntry = z.infer<typeof ProjectFileEntrySchema>;

// ─── Top-level registry ─────────────────────────────────────────────────

/**
 * `.df/project-files.json` shape. `version: 1` is the only supported value
 * today; bump on incompatible changes (mirroring `provider-sessions.json`
 * v3 in ).
 *
 * `files` keys are relative paths from the projects root — e.g.
 * `"projects/gooey/index.html"`. Always forward-slashes, never backslashes,
 * even on Windows. The daemon normalises before writing.
 */
export const ProjectFilesRegistrySchema = z.object({
  version: z.literal(1),
  /** Default preview file. Only changes via explicit "Set as main" UI action
   *  or matching declared intent (see resolveArtifactTarget). */
  primaryFile: z.string().min(1),
  /** Currently focused file (last touched/previewed). UI mounts this on
   *  resume. Defaults to `primaryFile` for fresh projects. */
  activeFile: z.string().min(1),
  /** Map of all known files in this project. Key = path. */
  files: z.record(z.string(), ProjectFileEntrySchema),
});

export type ProjectFilesRegistry = z.infer<typeof ProjectFilesRegistrySchema>;

// ─── Pure helpers (browser-safe) ────────────────────────────────────────

/**
 * Normalize a candidate path into "projects/{slug}/{rest}" canonical form.
 * Used by both the frontend resolver and the daemon. Returns null if the
 * path is unparseable (no slug).
 *
 * Rules:
 *  - Backslashes → forward slashes.
 *  - Strip leading `./`, `/`, or repeated separators.
 *  - If path starts with `projects/`, keep as is.
 *  - Otherwise prepend `projects/{slug}/` using the supplied slug.
 *  - Never expands `..` here — that's the daemon's `assertPathInScope`
 *    job (real path + symlink check).
 */
export function normalizeProjectPath(candidate: string, slug: string): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  if (typeof slug !== "string" || slug.length === 0) return null;
  let p = candidate.replace(/\\/g, "/");
  // Strip leading `./` and any leading slashes / extra separators.
  p = p.replace(/^\.\/+/, "").replace(/^\/+/, "");
  // Collapse duplicate slashes.
  p = p.replace(/\/+/g, "/");
  if (p.startsWith("projects/")) {
    // Already prefixed — make sure the next segment is the supplied slug
    // (otherwise the caller is referencing a different project).
    const segments = p.split("/");
    if (segments.length < 3) return null;
    if (segments[1] !== slug) return null;
    return p;
  }
  // Prepend the project root.
  return `projects/${slug}/${p}`;
}

/**
 * Get the path segments of `relativeToProjects` (e.g. `projects/x/variants/a.html`
 * → `["x", "variants", "a.html"]`). Returns null if the path doesn't start
 * with `projects/` or has fewer than 2 segments after the prefix.
 */
export function pathSegmentsAfterProjects(p: string): string[] | null {
  const norm = p.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!norm.startsWith("projects/")) return null;
  const tail = norm.slice("projects/".length);
  if (!tail) return null;
  const parts = tail.split("/").filter(Boolean);
  if (parts.length < 2) return null; // need at least slug + filename
  return parts;
}

/**
 * Infer the role of a file from its path, without consulting intent or
 * registry state. Used as a heuristic by `resolveArtifactTarget()` and as
 * the seed for `inferRegistryFromFilesystem()`.
 *
 *  - `projects/{slug}/index.html` or `projects/{slug}/{slug}.html` → `primary`
 *  - `projects/{slug}/variants/...` → `variant`
 *  - `projects/{slug}/docs/...` → `doc`
 *  - `projects/{slug}/prompts/...` → `prompt`
 *  - `projects/{slug}/data/...` → `data`
 *  - `projects/{slug}/assets/...` → `asset`
 *  - else → null (caller decides)
 */
export function inferRoleFromPath(p: string, slug: string): ProjectFileRole | null {
  const parts = pathSegmentsAfterProjects(p);
  if (!parts) return null;
  if (parts[0] !== slug) return null;
  // Top-level file under project root: assume primary if it's html/svg.
  if (parts.length === 2) {
    const filename = parts[1]!;
    if (filename === "index.html" || filename === `${slug}.html`) return "primary";
    return null;
  }
  // Subfolder match.
  const folder = parts[1]!;
  for (const hint of ROLE_FOLDER_HINTS) {
    if (folder === hint.folder) return hint.role;
  }
  return null;
}

/**
 * Decide whether `type` is a previewable type (HTML family). Used to set
 * `previewable: true|false` on registry entries and to gate 's
 * runtime probe.
 */
export function isPreviewableType(type: string): boolean {
  return PREVIEWABLE_TYPES.has(type);
}

/**
 * Verify that `(type, role)` is a sensible pairing. Returns true if the
 * pairing is in `TYPE_TO_DEFAULT_ROLES`, false if it's not (caller can
 * downgrade to warning or reject).
 */
export function isTypeRoleConsistent(type: string, role: ProjectFileRole): boolean {
  const allowed = TYPE_TO_DEFAULT_ROLES[type];
  if (!allowed) return true; // unknown type: don't block
  return allowed.includes(role);
}

/**
 * Extract the last path segment (slug) from a filesystem path, correctly
 * on every platform.
 *
 * BUG-1 (2026-05-25 Windows audit): the previous local `slugFromPath` did
 * `path.split("/")`, which is a no-op on a Windows path that uses `\` —
 * `.pop()` then handed the *entire path* downstream as the "slug" and the
 * daemon's slugifier turned that into ghost folders like
 * `c-users-admin-appdata-local-design-factory-projects-untitled-i4wb`,
 * which then showed up duplicated in the UI and "came back" on delete.
 * Splitting on both separators (`[\\/]`) fixes the platform divergence.
 */
export function slugFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ""
  );
}
