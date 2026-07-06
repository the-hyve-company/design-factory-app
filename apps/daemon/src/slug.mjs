// Slug normalization for project folder names.
//
// (regression report, "zip 404"): the editor sometimes
// passes a UUID (like "30a83bc7-7e22-...") in place of a folder slug. The
// folder on disk is `projects/aqua/`, not `projects/30a83bc7-...`. The
// fix is to ALWAYS run the candidate through this normalizer before
// touching the filesystem — and to mount projects on disk under their
// normalized slug so the same input maps deterministically.
//
// The rules:
//   - lowercase
//   - replace any run of non-[a-z0-9._-] with a single "-"
//   - trim leading and trailing dashes
//   - cap at 80 chars (folder-name safety)
//
// Exported from a tiny module so all 8 daemon endpoints that derive a
// slug share one implementation, and the regression test can lock
// the contract.

/**
 * Normalize a candidate string into a project folder slug.
 *
 * @param {string} raw - The candidate string (already URL-decoded).
 * @returns {string} - The normalized slug. Empty string if the input
 *                     normalized to nothing (caller should 400).
 */
export function normalizeProjectSlug(raw) {
  if (typeof raw !== "string") return "";
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug === "." || slug === "..") return "";
  return slug;
}

/**
 * Sanitize a version id into a safe filename. Used by the
 * /projects/:slug/versions endpoints.
 *
 * Rules:
 *   - replace any run of non-[a-zA-Z0-9._-] with a single "-"
 *   - strip leading dots (no dotfiles) and dashes
 *   - cap at 80 chars
 *
 * Note: case is preserved (UUIDs may be hex-mixed). Caller checks for
 * empty string and returns 400.
 *
 * @param {string} raw - The candidate version id (already URL-decoded).
 * @returns {string} - The safe filename stub (no extension).
 */
export function sanitizeVersionId(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
}
