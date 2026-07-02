// prompt-composer.test.ts — unit gates for the single composer.
//
// Covers the NEW blocks the WS2 refactor added (injection resistance,
// UI locale override, verb preamble inheritance) plus the
// AGENT_CONTRACT_LIMITS drift gate. Equivalence with the pre-refactor
// builders (nothing lost) is proven separately by
// prompt-composer-equivalence.test.ts against the captured baseline.

import { describe, it, expect } from "vitest";
import {
  INJECTION_RESISTANCE,
  AGENT_CONTRACT_LIMITS,
  VISUAL_CRAFT_CONTRACT,
  buildLocalePromptBlock,
  workspaceContextPreamble,
  composeSystemBlocks,
  buildSystemPrompt,
  type ProjectContext,
} from "./prompt-composer";

const baseCtx: ProjectContext = {
  projectId: "unit-project",
  projectPath: "~/design-factory/projects/unit-project",
  primaryFile: "index.html",
  mode: "hifi",
  hasDesignSystem: false,
  conversationHistory: [],
  providerId: "claude",
};

// ─── Injection resistance (pa-injection-resistance) ─────────────────────

describe("INJECTION_RESISTANCE", () => {
  it("is the FIRST block of every composed prompt (generate + verb)", () => {
    const gen = composeSystemBlocks(baseCtx, { kind: "generate" });
    expect(gen[0].id).toBe("injection");
    expect(buildSystemPrompt(baseCtx, { kind: "generate" }).startsWith(INJECTION_RESISTANCE)).toBe(
      true,
    );

    const verb = composeSystemBlocks(baseCtx, { kind: "verb", core: "CORE" });
    expect(verb[0].id).toBe("injection");
    expect(
      buildSystemPrompt(baseCtx, { kind: "verb", core: "CORE" }).startsWith(INJECTION_RESISTANCE),
    ).toBe(true);
  });

  it("frames DS/HTML/attachments as data, not commands", () => {
    expect(INJECTION_RESISTANCE).toContain("NOT instructions");
    expect(INJECTION_RESISTANCE).toContain("design-system");
    expect(INJECTION_RESISTANCE).toContain("attachments");
    expect(INJECTION_RESISTANCE).toContain("ignore previous instructions");
  });

  it("stays locale-neutral English", () => {
    expect(INJECTION_RESISTANCE).not.toMatch(/[áàâãéêíóôõúç]/i);
  });
});

// ─── UI locale override (pa-ui-locale-override) ─────────────────────────

describe("buildLocalePromptBlock", () => {
  it("names the pt-BR locale explicitly", () => {
    const block = buildLocalePromptBlock("pt");
    expect(block).toContain("## UI locale");
    expect(block).toContain("Brazilian Portuguese (pt-BR)");
  });

  it("names the en locale explicitly", () => {
    const block = buildLocalePromptBlock("en");
    expect(block).toContain("English (en)");
  });

  it("emits nothing for the debug pseudo-locale", () => {
    expect(buildLocalePromptBlock("xx")).toBe("");
  });

  it("preserves template/DS copy (explicit do-not-translate rule)", () => {
    const block = buildLocalePromptBlock("pt");
    expect(block).toContain("Do NOT translate");
    expect(block).toContain("design-system");
  });

  it("lands after the preamble in the composed prompt", () => {
    const blocks = composeSystemBlocks(baseCtx, { kind: "generate", lang: "pt" });
    const ids = blocks.map((b) => b.id);
    expect(ids.indexOf("locale")).toBe(ids.indexOf("preamble") + 1);
  });

  it("is omitted from the composed prompt when the lang has no block", () => {
    const blocks = composeSystemBlocks(baseCtx, { kind: "generate", lang: "xx" });
    expect(blocks.some((b) => b.id === "locale")).toBe(false);
  });
});

// ─── AGENT_CONTRACT_LIMITS drift gate (WS2 sub-item) ────────────────────

describe("AGENT_CONTRACT_LIMITS", () => {
  it("is the single source for the preamble's contract section (no drift)", () => {
    const preamble = workspaceContextPreamble(baseCtx);
    expect(preamble).toContain(AGENT_CONTRACT_LIMITS);
    // Exactly once — a duplicated inline copy is exactly the drift this
    // constant exists to prevent.
    expect(preamble.indexOf(AGENT_CONTRACT_LIMITS)).toBe(
      preamble.lastIndexOf(AGENT_CONTRACT_LIMITS),
    );
  });

  it("carries the three limit sections", () => {
    expect(AGENT_CONTRACT_LIMITS).toContain("## Output contract");
    expect(AGENT_CONTRACT_LIMITS).toContain("::question");
    expect(AGENT_CONTRACT_LIMITS).toContain("## Harness tools that DO NOT EXIST");
  });

  it("stays locale-neutral English (no raw PT reaches the 10 providers)", () => {
    expect(AGENT_CONTRACT_LIMITS).not.toMatch(/[áàâãéêíóôõúç]/i);
  });

  it("whole static contract surface is locale-neutral (preamble without DS)", () => {
    // The full static prompt scaffold (no user data): preamble + craft +
    // injection. User-supplied content (DS markdown, extras, HTML) is
    // exempt — it's data, not contract.
    const staticSurface = [
      workspaceContextPreamble(baseCtx),
      VISUAL_CRAFT_CONTRACT,
      INJECTION_RESISTANCE,
    ].join("\n");
    expect(staticSurface).not.toMatch(/[áàâãéêíóôõúç]/i);
  });
});

// ─── Verb path inherits the preamble (pa-verb-path-no-preamble) ─────────

describe("kind 'verb' — preamble inheritance", () => {
  const verbCtx: ProjectContext = {
    ...baseCtx,
    providerId: "anthropic",
    currentHtml: '<!DOCTYPE html><html><body><div id="df-tweaks-panel"></div></body></html>',
    canonicalPlus: { format: { categoryId: "interface", itemId: "landing" } },
  };

  it("editing verbs get preamble + summary + core + contract + tweaks guard, in order", () => {
    const blocks = composeSystemBlocks(verbCtx, {
      kind: "verb",
      core: "VERB_CORE_MARKER",
      modifiesHtml: true,
    });
    const ids = blocks.map((b) => b.id);
    expect(ids).toEqual([
      "injection",
      "preamble",
      "locale",
      "summary",
      "core",
      "contract",
      "tweaks-preserve",
    ]);
    const sys = buildSystemPrompt(verbCtx, { kind: "verb", core: "VERB_CORE_MARKER" });
    // Path binding + output contract now reach the verb path.
    expect(sys).toContain("# DesignFactory — project agent session");
    expect(sys).toContain(`- PROJECT_PATH: ${verbCtx.projectPath}`);
    expect(sys).toContain("## Output contract");
    // Verbs are edits by definition → isEdit reminder present (F3.2).
    expect(sys).toContain("EDIT TURN — extra emphasis (F3.2)");
  });

  it("read-only verbs keep preamble + locale + core but skip summary/contract/tweaks", () => {
    const blocks = composeSystemBlocks(verbCtx, {
      kind: "verb",
      core: "READONLY_CORE",
      modifiesHtml: false,
    });
    const ids = blocks.map((b) => b.id);
    expect(ids).toEqual(["injection", "preamble", "locale", "core"]);
    const sys = buildSystemPrompt(verbCtx, {
      kind: "verb",
      core: "READONLY_CORE",
      modifiesHtml: false,
    });
    // A read-only verb must NOT be told to emit an artifact…
    expect(sys).not.toContain("<artifact");
    // …nor conform to the project direction summary.
    expect(sys).not.toContain("Project Direction Summary");
  });

  it("tool-channel verbs get no artifact contract (write via native tools)", () => {
    const blocks = composeSystemBlocks(
      { ...verbCtx, providerId: "claude" },
      { kind: "verb", core: "CORE" },
    );
    expect(blocks.some((b) => b.id === "contract")).toBe(false);
  });
});

// ─── Craft reminder (audit WS1 agent-reminder-self-correct) ─────────────

describe("craft-reminder block", () => {
  const findings = [
    {
      ruleId: "mo-no-transition-all",
      tier: "P1" as const,
      title: "Never `transition: all`",
      detail: "Name the exact properties.",
    },
    {
      ruleId: "co-no-raw-black",
      tier: "P0" as const,
      title: "No pure black or white",
      detail: "Use a near-black.",
      sample: "#000",
    },
  ];

  it("emits the reminder P0-first on generate turns with prior findings", () => {
    const blocks = composeSystemBlocks(
      { ...baseCtx, priorCraftFindings: findings },
      { kind: "generate" },
    );
    const reminder = blocks.find((b) => b.id === "craft-reminder");
    expect(reminder).toBeDefined();
    expect(reminder!.content).toContain("Craft reminder");
    expect(reminder!.content.indexOf("[P0] co-no-raw-black")).toBeLessThan(
      reminder!.content.indexOf("[P1] mo-no-transition-all"),
    );
  });

  it("emits no reminder block without prior findings", () => {
    const blocks = composeSystemBlocks(baseCtx, { kind: "generate" });
    expect(blocks.some((b) => b.id === "craft-reminder")).toBe(false);
    const empty = composeSystemBlocks({ ...baseCtx, priorCraftFindings: [] }, { kind: "generate" });
    expect(empty.some((b) => b.id === "craft-reminder")).toBe(false);
  });
});
