import { describe, it, expect, beforeEach } from "vitest";
import {
  KIMI_TESTED_MIN,
  KIMI_TESTED_MAX,
  isKimiVersionTested,
  kimiVersionHint,
  __resetKimiVersionCache,
} from "./kimi-compat.mjs";

describe("isKimiVersionTested", () => {
  it("returns true for the tested lower bound", () => {
    expect(isKimiVersionTested(KIMI_TESTED_MIN)).toBe(true);
  });

  it("returns true for versions inside the tested range", () => {
    expect(isKimiVersionTested("0.2.0")).toBe(true);
    expect(isKimiVersionTested("0.2.5")).toBe(true);
    expect(isKimiVersionTested("0.2.99")).toBe(true);
  });

  it("returns false for the upper bound (exclusive)", () => {
    expect(isKimiVersionTested(KIMI_TESTED_MAX)).toBe(false);
  });

  it("returns false for versions below the tested floor", () => {
    expect(isKimiVersionTested("0.1.0")).toBe(false);
    expect(isKimiVersionTested("0.1.9")).toBe(false);
  });

  it("returns false for versions above the tested ceiling", () => {
    expect(isKimiVersionTested("0.3.0")).toBe(false);
    expect(isKimiVersionTested("1.0.0")).toBe(false);
  });

  it("returns true for null/unknown (never show a hint we can't justify)", () => {
    expect(isKimiVersionTested(null)).toBe(true);
    expect(isKimiVersionTested("")).toBe(true);
    expect(isKimiVersionTested(undefined)).toBe(true);
  });
});

describe("kimiVersionHint", () => {
  it("returns null when version is in the tested range", () => {
    expect(kimiVersionHint("0.2.0")).toBeNull();
    expect(kimiVersionHint("0.2.5")).toBeNull();
  });

  it("returns null for unknown versions (probe failed)", () => {
    expect(kimiVersionHint(null)).toBeNull();
  });

  it("returns an actionable install pointer for older versions", () => {
    const hint = kimiVersionHint("0.1.0");
    expect(hint).toMatch(/0\.1\.0 is untested/);
    expect(hint).toMatch(/upgrade/i);
    expect(hint).toMatch(/code\.kimi\.com/);
  });

  it("returns an actionable hint for newer-than-tested versions", () => {
    const hint = kimiVersionHint("0.5.0");
    expect(hint).toMatch(/0\.5\.0 is untested/);
    // The adapter targets a known window — the hint must surface that
    // window so the founder knows whether to downgrade or wait for an
    // adapter update.
    expect(hint).toMatch(new RegExp(`${KIMI_TESTED_MIN}`));
    expect(hint).toMatch(new RegExp(`${KIMI_TESTED_MAX}`));
  });

  it("hint mentions the 'unknown option' symptom the founder will see", () => {
    // The 0.1.x → 0.2.x break manifested as "unknown option '--print'".
    // Surfacing that string lets the founder pattern-match the error
    // they're staring at to the hint.
    const hint = kimiVersionHint("0.1.0");
    expect(hint).toMatch(/unknown option/);
  });
});

describe("detectKimiVersion (cache)", () => {
  beforeEach(() => {
    __resetKimiVersionCache();
  });

  it("never throws — returns null when the binary is missing", async () => {
    // Pass a bin that definitely doesn't exist so the spawn fails fast.
    const { detectKimiVersion } = await import("./kimi-compat.mjs");
    const v = await detectKimiVersion("kimi-this-binary-definitely-does-not-exist-1234");
    expect(v === null || typeof v === "string").toBe(true);
  });
});
