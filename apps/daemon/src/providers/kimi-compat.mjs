// Kimi CLI version compatibility check.
//
// The kimi.mjs adapter is hand-tuned for kimi-code 0.2.x (see BUG-23 /
// BUG-24 comments) — the 0.1.x line used completely different flags
// (`--print`, `--input-format`, stdin prompt, the `-y` approval gate)
// that 0.2.0 outright rejects with `unknown option '--print'`.
//
// When a user has 0.1.x installed (or whatever Moonshot ships next as
// 0.3+), the adapter spawns but the CLI exits non-zero with cryptic
// stderr and the founder sees no actionable hint. This module:
//
//   1. probes `<bin> --version` once per process and caches the result;
//   2. exposes `kimiVersionHint(version)` that returns a non-null
//      install-pointer string when the version is outside the tested
//      range; the adapter prepends it to the user-visible error message.
//
// Bumping the supported range: edit `KIMI_TESTED_MIN`/`KIMI_TESTED_MAX`
// here and the doc table in `docs/providers.md`. A version probe failing
// (network glitch, --version flag changed) returns null hint — we degrade
// to the existing raw error instead of guessing.

import { spawn } from "node:child_process";

/** Inclusive lower bound of the kimi-code releases this adapter has been
 *  exercised against. Anything below this is the 0.1.x line — flag set
 *  is different, adapter will fail. */
export const KIMI_TESTED_MIN = "0.2.0";

/** Exclusive upper bound. Bump when validating a new major / minor. */
export const KIMI_TESTED_MAX = "0.3.0";

let cachedVersion = undefined; // undefined = not probed; null = probe failed

/**
 * Spawn `<bin> --version`, parse the first semver out of stdout, cache.
 * The 3s timeout matches `probeAgent()` in index.mjs.
 */
export async function detectKimiVersion(bin = "kimi", spawnOpts = null) {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = await new Promise((resolve) => {
    let resolved = false;
    const settle = (v) => { if (!resolved) { resolved = true; resolve(v); } };
    try {
      const child = spawn(bin, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        ...(spawnOpts || {}),
        shell: process.platform === "win32",
      });
      let stdout = "";
      child.stdout?.on("data", (c) => { stdout += c.toString("utf8"); });
      child.on("error", () => settle(null));
      child.on("close", () => {
        const match = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
        settle(match ? match[1] : null);
      });
      setTimeout(() => { try { child.kill("SIGTERM"); } catch {} settle(null); }, 3000);
    } catch {
      settle(null);
    }
  });
  return cachedVersion;
}

/** Reset the probe cache. Test-only — production resets on process restart. */
export function __resetKimiVersionCache() { cachedVersion = undefined; }

/**
 * Compare a probed version string against the tested range.
 * Returns true if `version` is `>= KIMI_TESTED_MIN && < KIMI_TESTED_MAX`.
 * Unknown/null versions return true (don't show a hint we can't justify).
 */
export function isKimiVersionTested(version) {
  if (!version || typeof version !== "string") return true;
  const cmpMin = compareSemver(version, KIMI_TESTED_MIN);
  const cmpMax = compareSemver(version, KIMI_TESTED_MAX);
  return cmpMin >= 0 && cmpMax < 0;
}

/**
 * Build a one-line user-facing hint when kimi version is outside the
 * tested range. Returns null when no hint is needed (tested or unknown).
 */
export function kimiVersionHint(version) {
  if (!version) return null;
  if (isKimiVersionTested(version)) return null;
  return (
    `[kimi version ${version} is untested — adapter targets ${KIMI_TESTED_MIN} ≤ v < ${KIMI_TESTED_MAX}. ` +
    `If commands fail with "unknown option" errors, upgrade: ` +
    `curl -LsSf https://code.kimi.com/install.sh | bash]`
  );
}

/**
 * Tiny semver compare — only the leading `MAJOR.MINOR.PATCH` segments,
 * ignores pre-release/build metadata. Returns -1/0/1. We don't need a
 * full semver dep for two-numeric comparisons.
 */
function compareSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
