// Tests for the global instance registry. Each test points DF_REGISTRY_DIR at a
// fresh temp dir so we never touch the real ~/.design-factory.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registryPath,
  readRegistry,
  writeRegistry,
  pruneRegistry,
  registerInstance,
  deregisterInstance,
  listInstances,
  findLiveElsewhere,
} from "./df-registry.mjs";

// A pid that is alive (this test process) vs one that is not.
const ALIVE = process.pid;
const DEAD = 2147483600;

const mkEntry = (folder, pid, over = {}) => ({
  folder,
  mode: "prod",
  daemonPort: 1421,
  vitePort: 1420,
  daemonPid: pid,
  vitePid: pid,
  startedAt: 1700000000000,
  ...over,
});

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-reg-"));
  process.env.DF_REGISTRY_DIR = dir;
});
afterEach(() => {
  delete process.env.DF_REGISTRY_DIR;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("df-registry", () => {
  it("readRegistry tolerates a missing file → []", () => {
    expect(readRegistry()).toEqual([]);
  });

  it("readRegistry coerces non-array JSON → []", () => {
    writeRegistry("not-an-array"); // serializes to a JSON string, not an array
    expect(readRegistry()).toEqual([]);
  });

  it("writeRegistry writes a valid JSON array file atomically", () => {
    writeRegistry([mkEntry("/a", ALIVE)]);
    expect(existsSync(registryPath())).toBe(true);
    const parsed = JSON.parse(readFileSync(registryPath(), "utf8"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].folder).toBe("/a");
  });

  it("registerInstance adds a live entry", () => {
    registerInstance(mkEntry("/clone-a", ALIVE));
    const list = readRegistry();
    expect(list).toHaveLength(1);
    expect(list[0].folder).toBe("/clone-a");
  });

  it("registerInstance upserts by folder (relaunch replaces the row)", () => {
    registerInstance(mkEntry("/clone-a", ALIVE, { vitePort: 1420 }));
    registerInstance(mkEntry("/clone-a", ALIVE, { vitePort: 1430 }));
    const list = readRegistry();
    expect(list).toHaveLength(1);
    expect(list[0].vitePort).toBe(1430);
  });

  it("registers distinct folders side by side", () => {
    registerInstance(mkEntry("/clone-a", ALIVE));
    registerInstance(mkEntry("/clone-b", ALIVE));
    expect(
      readRegistry()
        .map((e) => e.folder)
        .sort(),
    ).toEqual(["/clone-a", "/clone-b"]);
  });

  it("pruneRegistry drops entries whose daemon pid is dead", () => {
    writeRegistry([mkEntry("/alive", ALIVE), mkEntry("/dead", DEAD)]);
    const kept = pruneRegistry();
    expect(kept.map((e) => e.folder)).toEqual(["/alive"]);
    expect(readRegistry().map((e) => e.folder)).toEqual(["/alive"]);
  });

  it("registerInstance prunes dead rows in the same pass", () => {
    writeRegistry([mkEntry("/dead", DEAD)]);
    registerInstance(mkEntry("/new", ALIVE));
    expect(readRegistry().map((e) => e.folder)).toEqual(["/new"]);
  });

  it("deregisterInstance removes the folder's row", () => {
    registerInstance(mkEntry("/clone-a", ALIVE));
    registerInstance(mkEntry("/clone-b", ALIVE));
    deregisterInstance("/clone-a");
    expect(readRegistry().map((e) => e.folder)).toEqual(["/clone-b"]);
  });

  it("findLiveElsewhere returns live instances in OTHER folders", () => {
    writeRegistry([mkEntry("/me", ALIVE), mkEntry("/other", ALIVE), mkEntry("/zombie", DEAD)]);
    const others = findLiveElsewhere("/me");
    expect(others.map((e) => e.folder)).toEqual(["/other"]);
  });

  it("listInstances() returns the pruned live list", async () => {
    writeRegistry([mkEntry("/a", ALIVE), mkEntry("/dead", DEAD)]);
    const list = await listInstances();
    expect(list.map((e) => e.folder)).toEqual(["/a"]);
    // checkHealth annotates each via isOurDaemon (covered by df-core smoke).
  });
});
