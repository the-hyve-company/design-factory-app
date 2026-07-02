// Visual Craft Contract — sanity tests.
//
// User asked (2026-05-19) to add a craft contract block to fresh
// writes only. WS2 refactor note: these tests now exercise the LIVE
// composer (`buildSystemPrompt`, consumed by prepare() and the verb
// paths) instead of the retired legacy builders (buildGenerateSystem —
// dead code — and buildRefineSystem). Every original invariant is
// preserved:
//   1. VISUAL_CRAFT_CONTRACT contains the verifiable markers
//   2. kind "generate" fresh writes include the contract
//   3. kind "generate" edits + kind "verb" do NOT include the contract —
//      refines operate on existing files where markers are already present
//   4. The contract sits between core direction and artifact contract so
//      it applies to BOTH tool-channel and artifact-channel providers

import { describe, it, expect } from "vitest";
import { VISUAL_CRAFT_CONTRACT, buildSystemPrompt, type ProjectContext } from "./prompt-composer";

const baseCtx: ProjectContext = {
  projectPath: "/repo/design-factory/projects/test",
  primaryFile: "test.html",
  mode: "hifi",
  hasDesignSystem: false,
  conversationHistory: [],
  providerId: "claude",
};

describe("VISUAL_CRAFT_CONTRACT", () => {
  it("ships the verifiable pre-write markers", () => {
    // The 4 markers are the only thing the contract enforces hard.
    expect(VISUAL_CRAFT_CONTRACT).toContain("<!DOCTYPE html>");
    expect(VISUAL_CRAFT_CONTRACT).toContain("</body></html>");
    expect(VISUAL_CRAFT_CONTRACT).toContain("script");
    expect(VISUAL_CRAFT_CONTRACT).toContain("balances ( [ {");
  });

  it("includes a paired example block (acceptable + NOT acceptable)", () => {
    expect(VISUAL_CRAFT_CONTRACT).toContain("Acceptable:");
    expect(VISUAL_CRAFT_CONTRACT).toContain("NOT acceptable:");
  });

  it("explicitly forbids external assets and placeholder text", () => {
    expect(VISUAL_CRAFT_CONTRACT).toContain("No external assets");
    expect(VISUAL_CRAFT_CONTRACT).toContain("No placeholder text");
  });

  it("mandates a single Write call", () => {
    expect(VISUAL_CRAFT_CONTRACT).toMatch(/Single Write call|single Write call/);
  });

  it("stays locale-neutral English (no hardcoded Portuguese island)", () => {
    // C1 put this contract on EVERY fresh write for EVERY provider. A
    // PT-hardcoded "Tom da resposta" block would nudge non-PT models to
    // reply in Portuguese — the contract must stay English-neutral.
    expect(VISUAL_CRAFT_CONTRACT).toContain("## Response tone");
    expect(VISUAL_CRAFT_CONTRACT).not.toContain("Tom da resposta");
    expect(VISUAL_CRAFT_CONTRACT).not.toMatch(/[áàâãéêíóôõúç]/i);
  });
});

describe("buildSystemPrompt kind 'generate' (fresh write)", () => {
  it("includes the craft contract", () => {
    const sys = buildSystemPrompt(baseCtx, { kind: "generate", preambleExtras: "core text" });
    expect(sys).toContain("## Craft contract");
    expect(sys).toContain("balances ( [ {");
  });

  it("places craft contract AFTER the direction core (so it amplifies, not overrides)", () => {
    const sys = buildSystemPrompt(baseCtx, {
      kind: "generate",
      preambleExtras: "MARKER_CORE_BODY",
    });
    const coreIdx = sys.indexOf("MARKER_CORE_BODY");
    const craftIdx = sys.indexOf("## Craft contract");
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(craftIdx).toBeGreaterThan(coreIdx);
  });

  it("preserves the live prompt structure (preamble + direction + craft)", () => {
    const sys = buildSystemPrompt(baseCtx, { kind: "generate", preambleExtras: "CORE" });
    expect(sys).toContain("# DesignFactory — project agent session");
    expect(sys).toContain("CORE");
    expect(sys).toContain("## Craft contract");
  });

  it("does NOT include the craft contract on an edit (current file present)", () => {
    const sys = buildSystemPrompt(
      { ...baseCtx, currentHtml: "<!DOCTYPE html><html></html>" },
      { kind: "generate", preambleExtras: "CORE" },
    );
    expect(sys).not.toContain("## Craft contract");
  });
});

describe("buildSystemPrompt kind 'verb' (edit path)", () => {
  it("does NOT include the craft contract", () => {
    const sys = buildSystemPrompt(baseCtx, { kind: "verb", core: "core text" });
    expect(sys).not.toContain("## Craft contract");
    expect(sys).not.toContain("balances ( [ {");
  });

  it("still includes the core verbatim", () => {
    const sys = buildSystemPrompt(baseCtx, { kind: "verb", core: "MARKER_CORE_REFINE" });
    expect(sys).toContain("MARKER_CORE_REFINE");
  });
});
