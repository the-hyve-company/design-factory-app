// resolve-artifact-target.mjs — decide where an artifact should land.
//
// Pure function (no fs read except path-scope realpath check). The
// destination is chosen from:
//
//   - The identifier the provider declared in `<artifact identifier="..."`.
//   - The project's current `activeFile`/`primaryFile` (registry state).
//   - Optional `intent` hint from the parser/skill that disambiguates
//     ambiguous paths (e.g. user said "make a variant" → intent="variant").
//
// Returns `{ finalPath, role, previewAfterWrite, isNewFile }` on success
// or `{ error: { code, message } }` on failure. Never throws — caller
// (the /fs/write/artifact endpoint) maps codes to HTTP status.
//
// Heuristics (Amendment v0.3.4):
//
//   1. Identifier resolves to activeFile or primaryFile → role=primary,
//      override, previewAfterWrite=true.
//   2. Identifier in `variants/*.html` (or any previewable type) and is a
//      NEW path → role=variant, parent=primaryFile, activeFile becomes the
//      new variant, previewAfterWrite=true. primaryFile NOT touched.
//   3. Identifier in `docs/*.md` (or `text/markdown`/`text/plain`) →
//      role=doc, no activeFile change (user stays in current preview),
//      previewAfterWrite=false.
//   4. Identifier in `prompts/*.txt` → role=prompt, no preview.
//   5. Identifier in `data/*.json` → role=data, no preview.
//   6. Identifier in `assets/**` → role=asset, no preview.
//   7. Identifier without `projects/{slug}/` prefix → normalised, then
//      heuristic re-applied. If the result is ambiguous (no role hint
//      from path AND no intent), return AMBIGUOUS_IDENTIFIER.
//   8. Path scope violation (escapes projects root) → PATH_OUT_OF_SCOPE.
//   9. Intent vs path conflict (intent="doc" but path is .html in
//      variants/) → INTENT_PATH_CONFLICT.
//  10. Type vs role mismatch (path in assets/ but caller declared
//      role=primary somehow) → INVALID_ROLE.
//
// Path scope check uses `assertPathInScope` . Even though this
// function is "pure", we DO call into the filesystem for the realpath
// check — that's the only fs touch. Caller pre-resolves projectsRoot to
// realpath before passing it in.

import { extname, basename } from "node:path";
import { assertPathInScope, PathScopeError } from "./path-scope.mjs";

// Mirror src/lib/project-files.ts. Daemon is mjs-only, so we restate.
const VALID_INTENTS = new Set(["override", "variant", "doc", "prompt", "data", "asset"]);
const VALID_ROLES = new Set(["primary", "variant", "doc", "prompt", "data", "asset"]);

const ROLE_FOLDER_MAP = {
  variants: "variant",
  docs: "doc",
  prompts: "prompt",
  data: "data",
  assets: "asset",
};

const PREVIEWABLE_TYPES = new Set(["text/html", "image/svg+xml", "application/xhtml+xml"]);

const EXT_TO_TYPE = {
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

const TYPE_TO_DEFAULT_ROLES = {
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

// ─── Helpers ────────────────────────────────────────────────────────────

/** Forward-slash, strip leading `./` and `/`. Does not resolve `..`. */
function tidy(path) {
  return String(path)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function normalizeIdentifier(identifier, projectId) {
  if (typeof identifier !== "string" || !identifier) return null;
  if (typeof projectId !== "string" || !projectId) return null;
  const tidied = tidy(identifier);
  if (!tidied) return null;
  if (tidied.startsWith("projects/")) {
    const segments = tidied.split("/");
    if (segments.length < 3) return null;
    if (segments[1] !== projectId) {
      // Identifier references a different project; reject (cross-project
      // writes go through a separate endpoint, not the artifact pipeline).
      return null;
    }
    return tidied;
  }
  return `projects/${projectId}/${tidied}`;
}

function extOf(p) {
  return extname(p).slice(1).toLowerCase();
}

function inferTypeFromPath(p) {
  const ext = extOf(p);
  return EXT_TO_TYPE[ext] || null;
}

/**
 * Look at the path tail (after `projects/{slug}/`) and infer a role from
 * the folder it lives in OR from the file extension if it's at top level.
 * Returns null if no inference is possible.
 */
function roleFromPath(normalizedPath, projectId) {
  const parts = normalizedPath.split("/");
  // Expect ["projects", slug, ...rest]
  if (parts.length < 3) return null;
  if (parts[1] !== projectId) return null;
  const rest = parts.slice(2);
  if (rest.length === 1) {
    // Top-level file: no folder hint. Decide by name.
    const name = rest[0];
    if (name === "index.html" || name === `${projectId}.html`) return "primary";
    return null;
  }
  const firstFolder = rest[0];
  return ROLE_FOLDER_MAP[firstFolder] || null;
}

function previewableForType(type) {
  return PREVIEWABLE_TYPES.has(type || "");
}

function isTypeRoleConsistent(type, role) {
  if (!type) return true;
  const allowed = TYPE_TO_DEFAULT_ROLES[type];
  if (!allowed) return true; // unknown type — don't block
  return allowed.includes(role);
}

// ─── Result builders ────────────────────────────────────────────────────

function ok(out) {
  return out;
}

function err(code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return { error };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResolveInput
 * @property {string} projectId
 * @property {string} requestedIdentifier   — from the artifact start tag.
 * @property {string} currentActiveFile     — registry.activeFile, normalised.
 * @property {string} currentPrimaryFile    — registry.primaryFile, normalised.
 * @property {string} [requestedType]       — mime type from artifact attrs.
 * @property {"override"|"variant"|"doc"|"prompt"|"data"|"asset"} [intent]
 * @property {Object<string, *>} [existingFiles]   — optional registry.files map for "is path new" decisions.
 *
 * @typedef {Object} ResolveOutput
 * @property {string} finalPath              — absolute, scoped under projectsRoot.
 * @property {string} normalizedIdentifier   — `projects/{slug}/...` form.
 * @property {string} role
 * @property {boolean} previewAfterWrite
 * @property {boolean} isNewFile
 * @property {boolean} setActive
 * @property {boolean} setPrimary
 * @property {string} [parent]
 * @property {string} resolvedType
 *
 * @typedef {Object} ResolveError
 * @property {{code: string, message: string, details?: any}} error
 */

/**
 * @param {ResolveInput} input
 * @param {string} projectsRoot   — absolute realpath to PROJECTS_ROOT.
 * @returns {ResolveOutput|ResolveError}
 */
export function resolveArtifactTarget(input, projectsRoot) {
  const {
    projectId,
    requestedIdentifier,
    currentActiveFile,
    currentPrimaryFile,
    requestedType,
    intent,
    existingFiles,
  } = input || {};

  if (typeof projectId !== "string" || !projectId) {
    return err("BAD_REQUEST", "projectId required");
  }
  if (typeof projectsRoot !== "string" || !projectsRoot) {
    return err("BAD_REQUEST", "projectsRoot required");
  }
  if (intent !== undefined && !VALID_INTENTS.has(intent)) {
    return err("BAD_REQUEST", `unknown intent: ${intent}`);
  }
  if (typeof requestedIdentifier !== "string" || !requestedIdentifier) {
    return err("BAD_REQUEST", "requestedIdentifier required");
  }

  // Step 1: normalise identifier into `projects/{slug}/...`.
  const normalized = normalizeIdentifier(requestedIdentifier, projectId);
  if (!normalized) {
    return err(
      "AMBIGUOUS_IDENTIFIER",
      `identifier "${requestedIdentifier}" cannot be normalised under projects/${projectId}/`,
    );
  }

  // Step 2: scope check using realpath.
  let finalPath;
  try {
    // assertPathInScope expects path RELATIVE to root or absolute. Strip
    // the `projects/` prefix because projectsRoot already points there.
    const tail = normalized.slice("projects/".length);
    finalPath = assertPathInScope(tail, projectsRoot);
  } catch (e) {
    if (e instanceof PathScopeError) {
      return err("PATH_OUT_OF_SCOPE", e.message, { code: e.code });
    }
    return err("PATH_OUT_OF_SCOPE", e.message || String(e));
  }

  // Step 3: determine type — explicit > path-derived > unknown.
  const resolvedType =
    (typeof requestedType === "string" && requestedType) || inferTypeFromPath(normalized) || "";

  // Step 4: figure out role.
  // Priority:
  //   a) Identifier matches activeFile or primaryFile → primary (override).
  //   b) intent supplies a role → use intent (validate against path/type).
  //   c) path folder hint → use it.
  //   d) top-level previewable file → primary.
  //   e) fallback by type.
  const isOverride = normalized === currentActiveFile || normalized === currentPrimaryFile;

  let role;
  let setPrimary = false;
  let parent;

  if (isOverride) {
    role = "primary";
  } else if (intent === "override") {
    // Caller declared override but path doesn't match active/primary.
    // Treat as INTENT_PATH_CONFLICT: override should be against an existing file.
    if (existingFiles && Object.prototype.hasOwnProperty.call(existingFiles, normalized)) {
      role = existingFiles[normalized]?.role || "primary";
    } else {
      return err(
        "INTENT_PATH_CONFLICT",
        `intent=override but "${normalized}" is neither activeFile nor primaryFile and not in registry`,
        { activeFile: currentActiveFile, primaryFile: currentPrimaryFile },
      );
    }
  } else {
    const pathRole = roleFromPath(normalized, projectId);
    if (intent && intent !== "override") {
      // Intent declared. Validate it against the path role if the path
      // strongly suggests a different role.
      if (pathRole && pathRole !== intent) {
        return err(
          "INTENT_PATH_CONFLICT",
          `intent="${intent}" but path "${normalized}" lives under role "${pathRole}"`,
          { pathRole, intent },
        );
      }
      role = intent;
    } else if (pathRole) {
      role = pathRole;
    } else {
      // No path hint, no intent. Try type fallback.
      if (previewableForType(resolvedType)) {
        // Previewable but at top level and not the canonical primary names.
        // Be conservative: variant.
        role = "variant";
      } else if (resolvedType === "text/markdown" || resolvedType === "text/plain") {
        role = "doc";
      } else if (resolvedType === "application/json") {
        role = "data";
      } else if (resolvedType) {
        role = "asset";
      } else {
        return err(
          "AMBIGUOUS_IDENTIFIER",
          `cannot infer role for "${normalized}" — no folder hint, no intent, no type`,
        );
      }
    }
  }

  if (!VALID_ROLES.has(role)) {
    return err("INVALID_ROLE", `internal: resolved role "${role}" not in VALID_ROLES`);
  }

  // Step 5: type/role consistency check. If the caller declared a type
  // that doesn't match the resolved role (e.g. asset role with text/html
  // type), surface INVALID_ROLE.
  if (resolvedType && !isTypeRoleConsistent(resolvedType, role)) {
    return err("INVALID_ROLE", `type "${resolvedType}" is not allowed for role "${role}"`, {
      type: resolvedType,
      role,
      allowed: TYPE_TO_DEFAULT_ROLES[resolvedType] || null,
    });
  }

  // Step 6: previewAfterWrite + activeFile/primaryFile decisions.
  const previewAfterWrite =
    previewableForType(resolvedType) && (role === "primary" || role === "variant");

  let setActive;
  if (role === "primary") {
    setActive = true;
  } else if (role === "variant") {
    setActive = true;
    parent = currentPrimaryFile || undefined;
  } else {
    // doc / prompt / data / asset → don't move the focus.
    setActive = false;
  }

  // Decide isNewFile: did this path already exist in the registry?
  const isNewFile = !(
    existingFiles && Object.prototype.hasOwnProperty.call(existingFiles, normalized)
  );

  return ok({
    finalPath,
    normalizedIdentifier: normalized,
    role,
    previewAfterWrite,
    isNewFile,
    setActive,
    setPrimary,
    parent,
    resolvedType:
      resolvedType ||
      (role === "primary" || role === "variant" ? "text/html" : "application/octet-stream"),
  });
}

// ─── Test internals ──────────────────────────────────────────────────────

export const __TEST_INTERNALS__ = {
  normalizeIdentifier,
  roleFromPath,
  inferTypeFromPath,
  previewableForType,
  isTypeRoleConsistent,
};
