import { describe, it, expect } from "vitest";
import { parseArgs, toPanelInstance } from "./df.mjs";

describe("df parseArgs", () => {
  it("defaults to start with no args", () => {
    const { command, flags } = parseArgs([]);
    expect(command).toBe("start");
    expect(flags.size).toBe(0);
  });

  it("treats a leading flag as flags, command still defaults to start", () => {
    const { command, flags } = parseArgs(["--prod"]);
    expect(command).toBe("start");
    expect(flags.has("--prod")).toBe(true);
  });

  it("parses an explicit command + flags", () => {
    const { command, flags } = parseArgs(["stop", "--all"]);
    expect(command).toBe("stop");
    expect(flags.has("--all")).toBe(true);
  });

  it("first non-flag wins as command; later non-flags ignored", () => {
    const { command } = parseArgs(["status", "extra"]);
    expect(command).toBe("status");
  });

  it("collects flags regardless of position", () => {
    const { command, flags } = parseArgs(["--dev", "restart"]);
    expect(command).toBe("restart");
    expect(flags.has("--dev")).toBe(true);
  });
});

describe("df toPanelInstance", () => {
  const now = 1_700_000_100_000;
  const entry = {
    folder: "/home/me/design-factory-public",
    mode: "prod",
    daemonPort: 1421,
    vitePort: 1420,
    daemonPid: 123,
    vitePid: 124,
    startedAt: now - 8 * 60_000,
  };

  it("derives folder basename, url and relative age", () => {
    const p = toPanelInstance(entry, now);
    expect(p.folder).toBe("…/design-factory-public");
    expect(p.url).toBe("http://localhost:1420");
    expect(p.since).toBe("há 8 min");
    expect(p.healthy).toBe(true);
  });

  it("respects an explicit healthy=false annotation", () => {
    expect(toPanelInstance({ ...entry, healthy: false }, now).healthy).toBe(false);
  });

  it("treats a missing healthy flag as healthy (registry default)", () => {
    expect(toPanelInstance(entry, now).healthy).toBe(true);
  });
});
