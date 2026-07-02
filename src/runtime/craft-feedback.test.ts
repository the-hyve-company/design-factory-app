// craft-feedback.test.ts — /polish consumption of craft warnings (audit
// WS1 `autofix-rewire-craft`) + next-turn reminder (audit WS1
// `agent-reminder-self-correct`).

import { describe, expect, it, vi } from "vitest";

vi.mock("@/runtime/cli-spawner", () => ({
  spawnStream: vi.fn().mockResolvedValue(() => {}),
  spawnOnce: vi.fn(),
}));

import { spawnStream } from "@/runtime/cli-spawner";
import {
  buildCraftFindingsBlock,
  buildCraftReminderBlock,
  latestCraftFindings,
  sortFindings,
} from "./craft-feedback";
import { invokeEditorialVerb } from "./prompt-invoker";
import type { CraftFinding } from "./craft-checks";
import type { DoneReport } from "./done-report";

const FINDINGS: CraftFinding[] = [
  {
    ruleId: "mo-no-transition-all",
    tier: "P1",
    title: "Never `transition: all`",
    detail: "Name the exact properties.",
    sample: "transition: all",
  },
  {
    ruleId: "co-no-raw-black",
    tier: "P0",
    title: "No pure black or white",
    detail: "Use a near-black (e.g. #0f0f0f).",
    sample: "#000",
  },
  {
    ruleId: "mo-will-change-sparingly",
    tier: "P2",
    title: "`will-change` with restraint",
    detail: "Reserve it for elements about to animate.",
  },
];

describe("sortFindings / block builders", () => {
  it("orders P0 → P1 → P2", () => {
    expect(sortFindings(FINDINGS).map((f) => f.tier)).toEqual(["P0", "P1", "P2"]);
  });

  it("buildCraftFindingsBlock lists tier, rule id, fix and snippet, P0 first", () => {
    const block = buildCraftFindingsBlock(FINDINGS);
    const p0 = block.indexOf("[P0] co-no-raw-black");
    const p1 = block.indexOf("[P1] mo-no-transition-all");
    const p2 = block.indexOf("[P2] mo-will-change-sparingly");
    expect(p0).toBeGreaterThan(-1);
    expect(p1).toBeGreaterThan(p0);
    expect(p2).toBeGreaterThan(p1);
    expect(block).toContain("Fix: Use a near-black");
    expect(block).toContain("`#000`");
  });

  it("returns empty string for no findings (caller can append unconditionally)", () => {
    expect(buildCraftFindingsBlock([])).toBe("");
    expect(buildCraftReminderBlock([])).toBe("");
  });

  it("caps the list and summarizes the tail", () => {
    const many: CraftFinding[] = Array.from({ length: 12 }, (_, i) => ({
      ruleId: `rule-${i}`,
      tier: "P1",
      title: `t${i}`,
      detail: "d",
    }));
    const block = buildCraftFindingsBlock(many, { maxFindings: 8 });
    expect(block).toContain("rule-7");
    expect(block).not.toContain("rule-8");
    expect(block).toContain("+4 more");
  });

  it("reminder block frames findings as a rider, not the mission", () => {
    const block = buildCraftReminderBlock(FINDINGS);
    expect(block).toContain("Craft reminder");
    expect(block).toContain("previous output");
    expect(block.indexOf("co-no-raw-black")).toBeLessThan(block.indexOf("mo-no-transition-all"));
  });
});

describe("latestCraftFindings", () => {
  const report = (status: "warn" | "clean", findings: CraftFinding[]): DoneReport => ({
    artifactHash: "sha256:x",
    checkVersion: "p0-v1",
    provider: "claude",
    model: "m",
    duration_ms: 1,
    staticP0: { status: "pass", checks: [] },
    overall: "pass",
    craftCheck: { status, findings, checked: [], deferred: [] },
    channel: "tool",
  });

  it("returns the latest warn report's findings", () => {
    const msgs = [
      { role: "assistant", doneReport: report("warn", FINDINGS.slice(0, 1)) },
      { role: "user" },
      { role: "assistant", doneReport: report("warn", FINDINGS) },
    ];
    expect(latestCraftFindings(msgs)).toEqual(FINDINGS);
  });

  it("a clean latest report supersedes older warns", () => {
    const msgs = [
      { role: "assistant", doneReport: report("warn", FINDINGS) },
      { role: "assistant", doneReport: report("clean", []) },
    ];
    expect(latestCraftFindings(msgs)).toEqual([]);
  });

  it("skips assistant messages without a craft check", () => {
    const msgs = [
      { role: "assistant", doneReport: report("warn", FINDINGS) },
      { role: "assistant" },
    ];
    expect(latestCraftFindings(msgs)).toEqual(FINDINGS);
  });

  it("returns [] for an empty chat", () => {
    expect(latestCraftFindings([])).toEqual([]);
  });
});

describe("invokeEditorialVerb — /polish consumes craft warnings (opt-in)", () => {
  const ctx = {
    projectPath: "~/design-factory/p",
    primaryFile: "index.html",
    mode: "hifi" as const,
    conversationHistory: [],
    hasDesignSystem: false,
    currentHtml: "<!doctype html><html><body><h1>x</h1></body></html>",
    providerId: "claude" as const,
  };

  it("appends the findings block to the prompt when craftFindings ride along", async () => {
    await invokeEditorialVerb(
      {
        id: "polish",
        systemPrompt: "POLISH CORE",
        modifiesHtml: true,
        args: "",
        craftFindings: FINDINGS,
      },
      ctx,
      { onText: () => {}, onDone: () => {}, onError: () => {} },
    );
    const call = vi.mocked(spawnStream).mock.calls[vi.mocked(spawnStream).mock.calls.length - 1]!;
    const prompt = call[1] as string;
    expect(prompt).toContain("Deterministic craft findings");
    expect(prompt).toContain("[P0] co-no-raw-black");
  });

  it("keeps the prompt clean when no findings are passed (never automatic)", async () => {
    await invokeEditorialVerb(
      { id: "polish", systemPrompt: "POLISH CORE", modifiesHtml: true, args: "" },
      ctx,
      { onText: () => {}, onDone: () => {}, onError: () => {} },
    );
    const call = vi.mocked(spawnStream).mock.calls[vi.mocked(spawnStream).mock.calls.length - 1]!;
    const prompt = call[1] as string;
    expect(prompt).not.toContain("Deterministic craft findings");
  });
});
