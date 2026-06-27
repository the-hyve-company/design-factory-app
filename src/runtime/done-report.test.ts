import { describe, it, expect } from "vitest";
import { composeDoneReport, summarizeDoneReport, CHECK_VERSION } from "./done-report";
import type { StaticP0Result } from "./static-p0";
import type { CraftCheckResult } from "./craft-checks";

const HASH = "deadbeef".repeat(8);

const STATIC_PASS: StaticP0Result = { status: "pass", checks: ["dom-parse"] };
const STATIC_FAIL: StaticP0Result = {
  status: "fail",
  reason: "empty-body",
  details: "no children",
  failedChecks: ["body-content"],
};

const CRAFT_WARN: CraftCheckResult = {
  status: "warn",
  findings: [
    { ruleId: "co-no-raw-black", tier: "P0", title: "No pure black or white", detail: "x" },
  ],
  checked: ["raw-black-white"],
  deferred: [],
};

describe("composeDoneReport — structural fields", () => {
  it("stamps every required field", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "sonnet-4-7",
      duration_ms: 3245,
      staticP0: STATIC_PASS,
    });
    expect(r.artifactHash).toBe(HASH);
    expect(r.checkVersion).toBe(CHECK_VERSION);
    expect(r.provider).toBe("claude");
    expect(r.model).toBe("sonnet-4-7");
    expect(r.duration_ms).toBe(3245);
    expect(r.staticP0).toEqual(STATIC_PASS);
    expect(r.overall).toBe("pass");
    expect(r.craftCheck).toBe(null);
    expect(r.channel).toBe("artifact");
  });
});

describe("composeDoneReport — overall verdict", () => {
  it("passes when Static P0 passes", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "default",
      duration_ms: 100,
      staticP0: STATIC_PASS,
    });
    expect(r.overall).toBe("pass");
  });

  it("static-fails when Static P0 fails", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "default",
      duration_ms: 100,
      staticP0: STATIC_FAIL,
    });
    expect(r.overall).toBe("static-fail");
  });
});

describe("summarizeDoneReport", () => {
  it("renders a pass line", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
    });
    const s = summarizeDoneReport(r);
    expect(s).toContain("✓");
    expect(s).toContain("claude/x");
  });

  it("renders static-fail with reason", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_FAIL,
    });
    const s = summarizeDoneReport(r);
    expect(s).toContain("Static P0 fail");
    expect(s).toContain("empty-body");
  });
});

describe("composeDoneReport — channel + craft", () => {
  it("defaults channel to artifact and craftCheck to null", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
    });
    expect(r.channel).toBe("artifact");
    expect(r.craftCheck).toBe(null);
  });

  it("stamps channel: tool and carries the craft result", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
      craftCheck: CRAFT_WARN,
      channel: "tool",
    });
    expect(r.channel).toBe("tool");
    expect(r.craftCheck).toEqual(CRAFT_WARN);
    expect(r.overall).toBe("pass"); // craft warns never change overall
  });

  it("appends the craft tally to the summary", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
      craftCheck: CRAFT_WARN,
    });
    expect(summarizeDoneReport(r)).toContain("craft tell");
  });

  it("uses channel-honest wording on a tool-channel static-fail", () => {
    const artifact = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_FAIL,
    });
    const tool = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_FAIL,
      channel: "tool",
    });
    expect(summarizeDoneReport(artifact)).toContain("file not replaced");
    expect(summarizeDoneReport(tool)).toContain("written file has errors");
  });
});
