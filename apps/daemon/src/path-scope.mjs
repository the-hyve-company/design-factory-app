// path-scope.mjs — safe scoping for filesystem write paths.
//
// Substring-based scoping (`target.startsWith(root + "/")`) is unsafe:
// symlinks, case-insensitive filesystems (macOS), URL-encoded
// segments, and TOCTOU all break it. Use realpath of the parent
// directory at the moment of the operation.
//
// Rule: every write must pass `assertPathInScope(candidate, root)`.

import { realpathSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";

export class PathScopeError extends Error {
  constructor(message, code = "PATH_OUT_OF_SCOPE") {
    super(message);
    this.name = "PathScopeError";
    this.code = code;
  }
}

// realpath only resolves existing paths. For new files, walk up until we
// hit an existing ancestor and resolve THAT — then validate the rest.
function resolveExistingAncestor(absPath) {
  let current = absPath;
  while (current && current !== "/" && current.length > 1) {
    if (existsSync(current)) {
      try {
        return { existing: realpathSync(current), missing: absPath.slice(current.length) };
      } catch {
        // realpath fails on broken symlinks — caller treats as out-of-scope
        return { existing: null, missing: null };
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { existing: null, missing: null };
}

// Validate that `candidate` (relative to `root` OR absolute) lives inside
// `root` after symlink/case/URL-decode resolution. Throws PathScopeError
// on violation. Returns the safe absolute path on success.
//
// `root` is the trusted base (e.g. PROJECTS_ROOT). Caller must pre-resolve
// it via realpathSync.
//
// `candidate` is what the client supplied (post URL-decode). Can be
// relative ("foo/bar.html"), absolute, or contain "..", symlinks, etc.
//
// Usage:
//   const root = realpathSync(join(repoRoot, "projects"));
//   const safe = assertPathInScope(candidatePath, root);
//   // safe is now an absolute path guaranteed to be under root.
export function assertPathInScope(candidate, root) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new PathScopeError("candidate path is empty", "PATH_EMPTY");
  }
  if (typeof root !== "string" || root.length === 0) {
    throw new PathScopeError("root path is empty", "ROOT_EMPTY");
  }
  // Reject null bytes (truncates paths in C-level libs).
  if (candidate.includes("\0")) {
    throw new PathScopeError("candidate path contains null byte", "PATH_NULL_BYTE");
  }
  // Resolve to absolute relative to root (handles "..", URL-decoded already
  // by the URL parser before reaching here).
  const absCandidate = resolve(root, candidate);
  // Resolve realpath of the deepest existing ancestor.
  const { existing, missing } = resolveExistingAncestor(absCandidate);
  if (!existing) {
    throw new PathScopeError(
      `candidate path has no resolvable ancestor: ${candidate}`,
      "PATH_NO_ANCESTOR",
    );
  }
  // Reconstruct full real path = realpath(existing ancestor) + missing tail.
  const realCandidate = existing + missing;
  // Canonicalize separators for case comparison.
  const normRoot = root.endsWith(sep) ? root : root + sep;
  // Case-insensitive compare on darwin/win32 (filesystem case-insensitive
  // by default) — Linux is case-sensitive.
  const insensitive = process.platform === "darwin" || process.platform === "win32";
  const matches = insensitive
    ? (realCandidate + sep).toLowerCase().startsWith(normRoot.toLowerCase())
    : (realCandidate + sep).startsWith(normRoot);
  if (!matches && realCandidate !== root) {
    throw new PathScopeError(
      `path escapes scope: ${candidate} → ${realCandidate} (root=${root})`,
      "PATH_OUT_OF_SCOPE",
    );
  }
  return realCandidate;
}

// Safe variant of join() that scopes the result.
export function safeJoin(root, ...segments) {
  return assertPathInScope(segments.join("/"), root);
}

// Ensure parent directory exists within scope. mkdir -p. Returns the
// realpath of the parent dir.
export function ensureScopedParent(candidate, root) {
  const safePath = assertPathInScope(candidate, root);
  const parent = dirname(safePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  return realpathSync(parent);
}
