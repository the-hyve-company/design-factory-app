import { describe, it, expect, vi } from "vitest";
import {
  autoFixLoop,
  buildFixPrompt,
  DEFAULT_MAX_FIX_ROUNDS,
  type AutoFixInput,
} from "./auto-fix-loop";
import type { ArtifactBlock } from "./artifact-processor";
import type { RuntimeP0Result, RuntimeMetrics } from "./runtime-p0";
import type { StaticP0Result } from "./static-p0";

const ARTIFACT: ArtifactBlock = {
  identifier: "projects/x/index.html",
  type: "text/html",
  title: "x",
  content: "<!DOCTYPE html><html><body><script>boom(</script></body></html>",
  contentHash: "deadbeef".repeat(8),
  startOffset: 0,
  endOffset: 0,
};

function metrics(overrides: Partial<RuntimeMetrics> = {}): RuntimeMetrics {
  return {
    bodyRect: { width: 800, height: 600 },
    visibleChildCount: 5,
    consoleErrors: [],
    fontsReady: true,
    asset404s: [],
    firstPaintMs: 200,
    ...overrides,
  };
}

const PASS_RESULT: RuntimeP0Result = { status: "pass", metrics: metrics() };
const FAIL_RESULT: RuntimeP0Result = {
  status: "fail",
  reason: "console-error-critical",
  metrics: metrics({ consoleErrors: ["TypeError: x is undefined"] }),
};
const CATASTROPHIC_RESULT: RuntimeP0Result = {
  status: "catastrophic",
  reason: "blank-screen",
};

const PASS_STATIC: StaticP0Result = { status: "pass", checks: ["dom-parse"] };
const STATIC_FAIL: StaticP0Result = {
  status: "fail",
  reason: "domparser-error",
  details: "broken",
  failedChecks: ["dom-parse"],
};

function makeInput(overrides: Partial<AutoFixInput> = {}): AutoFixInput {
  return {
    artifact: ARTIFACT,
    runtimeResult: FAIL_RESULT,
    callProvider: vi.fn(async () => "<!DOCTYPE html><html><body><p>fixed</p></body></html>"),
    staticGate: vi.fn(() => PASS_STATIC),
    runtimeGate: vi.fn(async () => PASS_RESULT),
    ...overrides,
  };
}

describe("autoFixLoop — happy path", () => {
  it("returns pass-after-fix when round 1 passes both gates", async () => {
    const input = makeInput();
    const out = await autoFixLoop(input);
    expect(out.status).toBe("pass-after-fix");
    if (out.status === "pass-after-fix") {
      expect(out.rounds).toBe(1);
      expect(out.finalContent).toContain("fixed");
    }
    expect(input.callProvider).toHaveBeenCalledTimes(1);
  });

  it("retries on persistent failure up to maxRounds", async () => {
    const input = makeInput({
      runtimeGate: vi.fn(async () => FAIL_RESULT),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("fail-exceeded-rounds");
    if (out.status === "fail-exceeded-rounds") {
      expect(out.rounds).toBe(DEFAULT_MAX_FIX_ROUNDS);
    }
    expect(input.callProvider).toHaveBeenCalledTimes(DEFAULT_MAX_FIX_ROUNDS);
  });

  it("respects the maxRounds override", async () => {
    const input = makeInput({
      maxRounds: 1,
      runtimeGate: vi.fn(async () => FAIL_RESULT),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("fail-exceeded-rounds");
    if (out.status === "fail-exceeded-rounds") expect(out.rounds).toBe(1);
  });

  it("counts skipped (type-not-previewable) as pass-after-fix", async () => {
    const input = makeInput({
      runtimeGate: vi.fn(async () => ({
        status: "skipped" as const,
        reason: "type-not-previewable" as const,
      })),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("pass-after-fix");
  });
});

describe("autoFixLoop — failure modes", () => {
  it("returns static-fail-on-fix when the agent's fix breaks the parser", async () => {
    const input = makeInput({
      staticGate: vi.fn(() => STATIC_FAIL),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("static-fail-on-fix");
    if (out.status === "static-fail-on-fix") {
      expect(out.lastStaticResult.status).toBe("fail");
    }
    // We only ran 1 round before bailing out.
    expect(input.callProvider).toHaveBeenCalledTimes(1);
  });

  it("returns catastrophic-on-fix without retrying", async () => {
    const input = makeInput({
      runtimeGate: vi.fn(async () => CATASTROPHIC_RESULT),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("catastrophic-on-fix");
    expect(input.callProvider).toHaveBeenCalledTimes(1);
  });

  it("returns provider-error if callProvider throws", async () => {
    const input = makeInput({
      callProvider: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("provider-error");
    if (out.status === "provider-error") expect(out.error).toContain("network down");
  });

  it("returns provider-error if callProvider yields empty content", async () => {
    const input = makeInput({
      callProvider: vi.fn(async () => ""),
    });
    const out = await autoFixLoop(input);
    expect(out.status).toBe("provider-error");
  });
});

describe("buildFixPrompt", () => {
  it("includes the artifact identifier and type", () => {
    const prompt = buildFixPrompt({
      artifact: ARTIFACT,
      runtimeResult: FAIL_RESULT,
      round: 1,
      maxRounds: 2,
    });
    expect(prompt).toContain(ARTIFACT.identifier);
    expect(prompt).toContain(ARTIFACT.type);
    expect(prompt).toMatch(/round 1\/2/);
  });

  it("lists each captured console error for console-error-critical", () => {
    const prompt = buildFixPrompt({
      artifact: ARTIFACT,
      runtimeResult: {
        status: "fail",
        reason: "console-error-critical",
        metrics: metrics({ consoleErrors: ["err1", "err2", "err3"] }),
      },
      round: 1,
      maxRounds: 2,
    });
    for (const err of ["err1", "err2", "err3"]) expect(prompt).toContain(err);
  });

  it("emits prescriptive guidance for asset-404-critical", () => {
    const prompt = buildFixPrompt({
      artifact: ARTIFACT,
      runtimeResult: {
        status: "fail",
        reason: "asset-404-critical",
        metrics: metrics({ asset404s: ["/missing.png"] }),
      },
      round: 1,
      maxRounds: 2,
    });
    expect(prompt).toContain("/missing.png");
    expect(prompt.toLowerCase()).toContain("inline");
  });

  it("emits guidance for catastrophic blank-screen", () => {
    const prompt = buildFixPrompt({
      artifact: ARTIFACT,
      runtimeResult: { status: "catastrophic", reason: "blank-screen" },
      round: 1,
      maxRounds: 2,
    });
    expect(prompt.toLowerCase()).toContain("body");
  });
});
