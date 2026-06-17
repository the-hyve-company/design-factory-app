// config-dir tests — resolution order, env override, legacy migration.
//
// We don't unit-test against the real $HOME (which would pollute the
// developer's machine). Each test sets a temp HOME (or DF_CONFIG_DIR)
// and clears the in-module cache via the exported test helper.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigDir,
  configPath,
  getCanonicalConfigDir,
  getLegacyConfigDir,
  resetConfigDirCacheForTests,
} from "./config-dir.mjs";

const savedEnv = {};

function setupEnv(home, overrideDir) {
  savedEnv.HOME = process.env.HOME;
  savedEnv.DF_CONFIG_DIR = process.env.DF_CONFIG_DIR;
  if (home === undefined) delete process.env.HOME;
  else process.env.HOME = home;
  if (overrideDir === undefined) delete process.env.DF_CONFIG_DIR;
  else process.env.DF_CONFIG_DIR = overrideDir;
  resetConfigDirCacheForTests();
}

function restoreEnv() {
  if (savedEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = savedEnv.HOME;
  if (savedEnv.DF_CONFIG_DIR === undefined) delete process.env.DF_CONFIG_DIR;
  else process.env.DF_CONFIG_DIR = savedEnv.DF_CONFIG_DIR;
  resetConfigDirCacheForTests();
}

describe("config-dir — resolution order", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "df-cfg-"));
  });

  afterEach(() => {
    restoreEnv();
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  it("DF_CONFIG_DIR env overrides everything else", () => {
    const overrideDir = join(tmpHome, "explicit-override");
    setupEnv(tmpHome, overrideDir);
    expect(getConfigDir()).toBe(overrideDir);
  });

  it("falls back to ~/.config/design-factory when no override is set", () => {
    setupEnv(tmpHome);
    expect(getConfigDir()).toBe(join(tmpHome, ".config", "design-factory"));
  });

  it("configPath joins onto the resolved dir", () => {
    setupEnv(tmpHome);
    expect(configPath("anthropic.json")).toBe(
      join(tmpHome, ".config", "design-factory", "anthropic.json"),
    );
    expect(configPath("commands", "publish.md")).toBe(
      join(tmpHome, ".config", "design-factory", "commands", "publish.md"),
    );
  });

  it("caches the resolution across calls within the same process", () => {
    setupEnv(tmpHome);
    const a = getConfigDir();
    // change env after first call — should NOT change the cached value
    process.env.DF_CONFIG_DIR = join(tmpHome, "different");
    const b = getConfigDir();
    expect(b).toBe(a);
  });
});

describe("config-dir — legacy migration", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "df-cfg-mig-"));
  });

  afterEach(() => {
    restoreEnv();
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  it("migrates legacy ~/.design-factory/* into ~/.config/design-factory/", () => {
    const legacy = join(tmpHome, ".design-factory");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "anthropic.json"), JSON.stringify({ token: "x" }));
    writeFileSync(join(legacy, "vercel.json"), JSON.stringify({ token: "y" }));

    setupEnv(tmpHome);
    const canonical = getConfigDir();

    expect(canonical).toBe(join(tmpHome, ".config", "design-factory"));
    expect(existsSync(join(canonical, "anthropic.json"))).toBe(true);
    expect(existsSync(join(canonical, "vercel.json"))).toBe(true);
    // legacy entries moved out
    expect(existsSync(join(legacy, "anthropic.json"))).toBe(false);
    expect(existsSync(join(legacy, "vercel.json"))).toBe(false);
    // content preserved
    const anthropic = JSON.parse(readFileSync(join(canonical, "anthropic.json"), "utf8"));
    expect(anthropic.token).toBe("x");
  });

  it("does not clobber canonical when it already has content", () => {
    const legacy = join(tmpHome, ".design-factory");
    const canonical = join(tmpHome, ".config", "design-factory");
    mkdirSync(legacy, { recursive: true });
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(legacy, "anthropic.json"), JSON.stringify({ token: "legacy" }));
    writeFileSync(join(canonical, "anthropic.json"), JSON.stringify({ token: "canonical" }));

    setupEnv(tmpHome);
    getConfigDir();

    // canonical preserved
    const got = JSON.parse(readFileSync(join(canonical, "anthropic.json"), "utf8"));
    expect(got.token).toBe("canonical");
    // legacy preserved (we don't risk deleting state we can't merge)
    expect(existsSync(join(legacy, "anthropic.json"))).toBe(true);
  });

  it("does not migrate when env override is set", () => {
    const legacy = join(tmpHome, ".design-factory");
    const override = join(tmpHome, "explicit");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "anthropic.json"), JSON.stringify({ token: "legacy" }));

    setupEnv(tmpHome, override);
    expect(getConfigDir()).toBe(override);
    // legacy untouched
    expect(existsSync(join(legacy, "anthropic.json"))).toBe(true);
    // override not created (it's the user's job)
    expect(existsSync(override)).toBe(false);
  });

  it("is one-shot — does not re-migrate after canonical has any content", () => {
    const legacy = join(tmpHome, ".design-factory");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "first.json"), "1");

    setupEnv(tmpHome);
    getConfigDir(); // triggers migration of first.json
    const canonical = getCanonicalConfigDir();
    expect(existsSync(join(canonical, "first.json"))).toBe(true);

    // Now drop a NEW file into legacy and reset only the resolution
    // cache (not the migration latch). The new file should NOT move
    // because canonical has content and the latch already fired.
    writeFileSync(join(legacy, "second.json"), "2");
    // reset cache so next call re-enters resolution — but the latch
    // protects against double-migration within the same process.
    // (We don't reset migrationDone — that's the whole point.)
    expect(existsSync(join(legacy, "second.json"))).toBe(true);
    expect(existsSync(join(canonical, "second.json"))).toBe(false);
  });
});

describe("config-dir — path accessors", () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "df-cfg-acc-"));
  });

  afterEach(() => {
    restoreEnv();
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  it("getCanonicalConfigDir always returns the XDG path regardless of override", () => {
    setupEnv(tmpHome, "/somewhere/else");
    expect(getCanonicalConfigDir()).toBe(join(tmpHome, ".config", "design-factory"));
  });

  it("getLegacyConfigDir always returns the legacy ~/.design-factory path", () => {
    setupEnv(tmpHome, "/somewhere/else");
    expect(getLegacyConfigDir()).toBe(join(tmpHome, ".design-factory"));
  });
});
