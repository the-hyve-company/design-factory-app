import { describe, it, expect } from "vitest";
import { composeDoneReport, summarizeDoneReport, CHECK_VERSION } from "./done-report";
import type { StaticP0Result } from "./static-p0";
import type { RuntimeP0Result, RuntimeMetrics } from "./runtime-p0";
import type { AutoFixOutcome } from "./auto-fix-loop";
import type { CraftCheckResult } from "./craft-checks";

const HASH = "deadbeef".repeat(8);

function metrics(overrides: Partial<RuntimeMetrics> = {}): RuntimeMetrics {
  return {
    bodyRect: { width: 1024, height: 768 },
    visibleChildCount: 5,
    consoleErrors: [],
    fontsReady: true,
    asset404s: [],
    firstPaintMs: 200,
    ...overrides,
  };
}

const STATIC_PASS: StaticP0Result = { status: "pass", checks: ["dom-parse"] };
const STATIC_FAIL: StaticP0Result = {
  status: "fail",
  reason: "empty-body",
  details: "no children",
  failedChecks: ["body-content"],
};
const RUNTIME_PASS: RuntimeP0Result = { status: "pass", metrics: metrics() };
const RUNTIME_FAIL: RuntimeP0Result = {
  status: "fail",
  reason: "console-error-critical",
  metrics: metrics({ consoleErrors: ["x"] }),
};
const RUNTIME_CATA: RuntimeP0Result = { status: "catastrophic", reason: "blank-screen" };

describe("composeDoneReport — structural fields", () => {
  it("stamps every required field", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "sonnet-4-7",
      duration_ms: 3245,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_PASS,
    });
    expect(r.artifactHash).toBe(HASH);
    expect(r.checkVersion).toBe(CHECK_VERSION);
    expect(r.provider).toBe("claude");
    expect(r.model).toBe("sonnet-4-7");
    expect(r.duration_ms).toBe(3245);
    expect(r.staticP0).toEqual(STATIC_PASS);
    expect(r.runtimeP0).toEqual(RUNTIME_PASS);
    expect(r.catastrophic).toBe(null);
    expect(r.fixRounds).toBe(0);
    expect(r.overall).toBe("pass");
  });
});

describe("composeDoneReport — overall verdict", () => {
  it("static-fail trumps runtime", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "default",
      duration_ms: 100,
      staticP0: STATIC_FAIL,
      runtimeP0: undefined,
    });
    expect(r.overall).toBe("static-fail");
    expect(r.runtimeP0).toBe(null);
  });

  it("catastrophic when runtime is catastrophic", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "default",
      duration_ms: 100,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_CATA,
    });
    expect(r.overall).toBe("catastrophic");
    expect(r.catastrophic).toBe("blank-screen");
  });

  it("pass when auto-fix recovered", () => {
    const autoFix: AutoFixOutcome = {
      status: "pass-after-fix",
      rounds: 1,
      finalContent: "x",
      finalMetrics: metrics(),
    };
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 5000,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_FAIL,
      autoFix,
    });
    expect(r.overall).toBe("pass");
    expect(r.fixRounds).toBe(1);
    if (r.runtimeP0) expect(r.runtimeP0.status).toBe("pass");
  });

  it("fail when auto-fix exhausted rounds", () => {
    const autoFix: AutoFixOutcome = {
      status: "fail-exceeded-rounds",
      rounds: 2,
      lastResult: RUNTIME_FAIL,
      lastContent: "x",
    };
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 8000,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_FAIL,
      autoFix,
    });
    expect(r.overall).toBe("fail");
    expect(r.fixRounds).toBe(2);
  });

  it("catastrophic when auto-fix turned catastrophic on a later round", () => {
    const autoFix: AutoFixOutcome = {
      status: "catastrophic-on-fix",
      rounds: 1,
      lastResult: RUNTIME_CATA,
      lastContent: "x",
    };
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 8000,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_FAIL,
      autoFix,
    });
    expect(r.overall).toBe("catastrophic");
    expect(r.catastrophic).toBe("blank-screen");
  });
});

describe("summarizeDoneReport", () => {
  it("renders pass with fix-round count", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "claude",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_PASS,
      autoFix: { status: "pass-after-fix", rounds: 1, finalContent: "x", finalMetrics: metrics() },
    });
    const s = summarizeDoneReport(r);
    expect(s).toContain("✓");
    expect(s).toContain("1 fix round");
  });

  it("renders catastrophic with reason", () => {
    const r = composeDoneReport({
      artifactHash: HASH,
      provider: "codex",
      model: "x",
      duration_ms: 100,
      staticP0: STATIC_PASS,
      runtimeP0: RUNTIME_CATA,
    });
    const s = summarizeDoneReport(r);
    expect(s).toContain("✗");
    expect(s).toContain("blank-screen");
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
  const CRAFT_WARN: CraftCheckResult = {
    status: "warn",
    findings: [
      { ruleId: "co-no-raw-black", tier: "P0", title: "No pure black or white", detail: "x" },
    ],
    checked: ["raw-black-white"],
    deferred: [],
  };

  it("defaults channel to artifact", () => {
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
