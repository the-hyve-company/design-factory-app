// Shared helper for converting Node spawn `error` events into actionable
// messages, especially ENOENT (binary not on PATH). Used by every
// provider adapter that spawns a CLI subprocess.
//
// Before this helper, providers either swallowed spawn errors (the
// Claude SSE stream would close with no result the user could
// interpret) or duplicated ad-hoc string formatting. Now the message
// includes the failed binary name and an install hint pointing at the
// project README, so a Mac/Windows user who hasn't put `claude` on
// PATH yet sees a clear next step instead of a hung request.

/**
 * Map a spawn `error` event into a user-facing message.
 *
 * @param {Error & { code?: string }} err The error emitted by child.on("error", …)
 * @param {string} bin The resolved binary name we tried to spawn (e.g. "claude")
 * @param {string} [label] Human-friendly provider label (e.g. "Claude Code")
 * @returns {string}
 */
export function spawnErrorMessage(err, bin, label) {
  const friendly = label || bin;
  if (err?.code === "ENOENT") {
    return (
      `${friendly} CLI not found in PATH (looked for "${bin}"). ` +
      `Install the CLI and make sure the binary is on the PATH the daemon ` +
      `sees. On macOS, app bundles often have a narrower PATH than your ` +
      `interactive shell — try launching the app from Terminal, or set ` +
      `DF_${bin.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BIN to an absolute path.`
    );
  }
  if (err?.code === "EACCES") {
    return `${friendly} CLI at "${bin}" is not executable (EACCES). ` + `Run: chmod +x "${bin}"`;
  }
  return `${friendly} spawn failed: ${err?.message || String(err)}`;
}
