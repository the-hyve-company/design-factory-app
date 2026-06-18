// config-dir — single source of truth for Design Factory user config location.
//
// History: tokens, theme, commands and skills used to live in
// `~/.design-factory/`. The README and docs promised
// `~/.config/design-factory/` (XDG-compliant). User reads doc, looks
// in XDG path, finds nothing, concludes they never logged in. Real
// login was elsewhere. This module ends the drift.
//
// Resolution order:
//   1. process.env.DF_CONFIG_DIR        (explicit override — service mode, tests)
//   2. ~/.config/design-factory/        (XDG canonical)
//
// Legacy migration:
//   If the canonical dir is empty AND the legacy dir
//   (~/.design-factory/) has content, the legacy tree is moved over on
//   first call. Migration is one-shot and idempotent — once canonical
//   has anything, legacy is left alone (the user may have intentional
//   state there).
//
// Migration is performed lazily on the first getConfigDir() call after
// process start. A console line announces it so the user sees what
// happened.

import { existsSync, readdirSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LEGACY_DIR_NAME = ".design-factory";
const CANONICAL_DIR_PARTS = [".config", "design-factory"];

let cached = null; // resolved absolute path
let migrationDone = false; // one-shot guard

function getHome() {
  // process.env.HOME is unset on Windows (it uses USERPROFILE), so the old
  // `|| "/tmp"` fallback sent config to an ephemeral path there — overrides and
  // tokens didn't persist. os.homedir() is the correct cross-platform home.
  return process.env.HOME || homedir() || "/tmp";
}

export function getCanonicalConfigDir() {
  return join(getHome(), ...CANONICAL_DIR_PARTS);
}

export function getLegacyConfigDir() {
  return join(getHome(), LEGACY_DIR_NAME);
}

function isDirEmpty(dir) {
  try {
    const entries = readdirSync(dir);
    return entries.length === 0;
  } catch {
    return true; // doesn't exist = treated as empty for migration purposes
  }
}

function tryMigrateLegacy(canonicalDir, legacyDir) {
  if (migrationDone) return;
  migrationDone = true;

  try {
    if (!existsSync(legacyDir)) return;
    const legacyStat = statSync(legacyDir);
    if (!legacyStat.isDirectory()) return;

    if (existsSync(canonicalDir) && !isDirEmpty(canonicalDir)) {
      // Canonical already has content — respect it, don't overwrite.
      return;
    }

    // Create canonical parent + dir.
    mkdirSync(canonicalDir, { recursive: true });

    const entries = readdirSync(legacyDir);
    if (entries.length === 0) return;

    let moved = 0;
    for (const name of entries) {
      const src = join(legacyDir, name);
      const dst = join(canonicalDir, name);
      if (existsSync(dst)) continue; // don't clobber
      try {
        renameSync(src, dst);
        moved += 1;
      } catch (err) {
        // Cross-device or permission error — log and skip; user can
        // resolve manually. We don't want migration failure to block
        // daemon startup.
        process.stderr.write(
          `[config-dir] migration warning: could not move ${name} from ` +
            `${legacyDir} to ${canonicalDir}: ${String(err.message || err)}\n`,
        );
      }
    }

    if (moved > 0) {
      process.stdout.write(
        `[config-dir] migrated ${moved} item(s) from ${legacyDir} to ${canonicalDir}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[config-dir] migration skipped due to error: ${String(err.message || err)}\n`,
    );
  }
}

/**
 * Resolve the config dir for this process. Order:
 *   1. DF_CONFIG_DIR env var
 *   2. ~/.config/design-factory (canonical, with one-shot legacy migration)
 *
 * Result is cached for the process lifetime. Tests that need to reset
 * the cache can call `resetConfigDirCacheForTests()`.
 */
export function getConfigDir() {
  if (cached) return cached;

  const override = process.env.DF_CONFIG_DIR;
  if (override && override.trim().length > 0) {
    cached = override;
    return cached;
  }

  const canonical = getCanonicalConfigDir();
  const legacy = getLegacyConfigDir();
  tryMigrateLegacy(canonical, legacy);

  cached = canonical;
  return cached;
}

/**
 * Path helper — returns an absolute path inside the config dir.
 * Equivalent to `join(getConfigDir(), ...parts)`.
 */
export function configPath(...parts) {
  return join(getConfigDir(), ...parts);
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function resetConfigDirCacheForTests() {
  cached = null;
  migrationDone = false;
}
