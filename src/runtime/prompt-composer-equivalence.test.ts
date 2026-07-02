// prompt-composer-equivalence.test.ts — the WS2 refactor's proof of
// behavioral equivalence.
//
// BEFORE the refactor, a capture harness ran the then-live builders
// (prepare()'s inline assembly + buildRefineSystem) against a fixed
// scenario matrix — {generate fresh/edit, verbs edit/read-only,
// apply-style, override} × {tool provider (claude), artifact provider
// (anthropic)} — and dumped every assembled system prompt plus its
// ordered constituent blocks to
// `__fixtures__/prompt-composer-baseline.json` (captured at 67bec9b).
//
// This test rebuilds the exact same scenarios through the NEW composer
// and asserts that EVERY baseline block still reaches the model, in the
// same relative order. Additions (injection resistance, locale override,
// verb preamble) are allowed; losses are not — "nada some".
//
// If a future PR changes prompt copy INTENTIONALLY (e.g. edits the
// preamble text), regenerate the baseline: temporarily restore the
// capture harness from this PR's history (git log -- 'src/runtime/
// __capture-baseline.test.ts' on the refactor/df-prompt-composer
// branch), run it once, and commit the refreshed fixture alongside the
// copy change.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { prepare, assembleTurnBlocks, type UserTurnInput } from "./turn-pipeline";
import { buildSystemPrompt, VISUAL_CRAFT_CONTRACT, type ProjectContext } from "./prompt-composer";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BaselineScenario {
  prompt: string;
  blocks: Array<{ id: string; content: string }>;
}

const baseline = JSON.parse(
  readFileSync(resolve(__dirname, "__fixtures__/prompt-composer-baseline.json"), "utf8"),
) as { capturedAt: string; scenarios: Record<string, BaselineScenario> };

// ─── Fixture inputs — byte-identical to the capture harness ─────────────

const FIXTURE_DS_MD = "# Fixture DS\n\n--accent: #ff5524;\nfont: Inter";
const FIXTURE_HTML_PLAIN =
  "<!DOCTYPE html><html><head><style>:root{--x:1}</style></head><body><h1>Fixture</h1></body></html>";
const FIXTURE_HTML_TWEAKS =
  '<!DOCTYPE html><html><head></head><body><div id="df-tweaks-panel"></div><h1>Fixture</h1></body></html>';
const FIXTURE_CANONICAL = { format: { categoryId: "interface", itemId: "landing" } };

function turnInput(providerId: "claude" | "anthropic", iframeHtml?: string): UserTurnInput {
  return {
    userMessage: "build a landing page",
    providerId,
    projectId: "fixture-project",
    threadId: "main",
    context: {
      projectPath: "~/design-factory/projects/fixture-project",
      primaryFile: "fixture.html",
      workspaceRoot: "/tmp/fixture",
      designSystem: { name: "Fixture DS", path: "/tmp/ds", markdown: FIXTURE_DS_MD },
      history: [],
      ...(iframeHtml !== undefined ? { iframeHtml } : {}),
    },
  };
}

function verbCtx(providerId: "claude" | "anthropic", currentHtml: string): ProjectContext {
  return {
    projectId: "fixture-project",
    projectPath: "~/design-factory/projects/fixture-project",
    primaryFile: "fixture.html",
    mode: "hifi",
    conversationHistory: [],
    hasDesignSystem: true,
    designSystemPath: "/tmp/ds",
    designSystemName: "Fixture DS",
    designSystemMarkdown: FIXTURE_DS_MD,
    currentHtml,
    providerId,
    canonicalPlus: FIXTURE_CANONICAL,
  };
}

/** Baseline block content by id (prompt-text inputs — extras/core — are
 *  fed back from the fixture so the test proves verbatim round-trip and
 *  stays decoupled from future edits to the shipped default cores). */
function blockOf(scenario: string, id: string): string {
  const b = baseline.scenarios[scenario].blocks.find((x) => x.id === id);
  if (!b) throw new Error(`baseline scenario ${scenario} has no block ${id}`);
  return b.content;
}

/** Every baseline block must appear in the new prompt, in order. */
function assertBlocksSurvive(scenario: string, newPrompt: string): void {
  const sc = baseline.scenarios[scenario];
  expect(sc, `baseline scenario ${scenario} missing`).toBeTruthy();
  let cursor = 0;
  for (const b of sc.blocks) {
    const at = newPrompt.indexOf(b.content, cursor);
    expect(
      at,
      `scenario ${scenario}: baseline block "${b.id}" must survive the refactor (in order)`,
    ).toBeGreaterThanOrEqual(0);
    cursor = at + b.content.length;
  }
}

// ─── Generate path (prepare) — 4 scenarios ──────────────────────────────

describe("equivalence — generate path (prepare)", () => {
  for (const providerId of ["claude", "anthropic"] as const) {
    for (const edit of [false, true]) {
      const name = `generate-${edit ? "edit" : "fresh"}-${providerId}`;
      it(`${name}: every pre-refactor block survives, in order`, () => {
        const ctx = prepare(turnInput(providerId, edit ? FIXTURE_HTML_PLAIN : undefined), {
          preambleExtras: blockOf(name, "direction"),
          now: () => 1_700_000_000_000,
          turnId: "t-fixture",
        });
        assertBlocksSurvive(name, ctx.systemPrompt);
      });
    }
  }

  it("generate-override-anthropic: override + contract survive untouched", () => {
    const name = "generate-override-anthropic";
    const ctx = prepare(turnInput("anthropic"), {
      systemPromptOverride: blockOf(name, "override"),
      now: () => 1_700_000_000_000,
      turnId: "t-fixture",
    });
    assertBlocksSurvive(name, ctx.systemPrompt);
    // Override path is caller-owned: no composer blocks may be injected.
    expect(ctx.systemPrompt.startsWith(blockOf(name, "override"))).toBe(true);
    expect(ctx.systemPrompt).not.toContain("## Untrusted content boundary");
  });
});

// ─── Verb path (buildSystemPrompt kind "verb") — 4 scenarios ────────────

describe("equivalence — verb path (composer kind 'verb')", () => {
  for (const providerId of ["claude", "anthropic"] as const) {
    const name = `verb-edit-${providerId}`;
    it(`${name}: every pre-refactor block survives, in order`, () => {
      const sys = buildSystemPrompt(verbCtx(providerId, FIXTURE_HTML_TWEAKS), {
        kind: "verb",
        core: blockOf(name, "core"),
      });
      assertBlocksSurvive(name, sys);
    });
  }

  it("apply-style-anthropic: every pre-refactor block survives, in order", () => {
    const name = "apply-style-anthropic";
    const sys = buildSystemPrompt(verbCtx("anthropic", FIXTURE_HTML_PLAIN), {
      kind: "verb",
      core: blockOf(name, "core"),
    });
    assertBlocksSurvive(name, sys);
  });

  it("verb-readonly: the raw core survives", () => {
    const name = "verb-readonly";
    const sys = buildSystemPrompt(verbCtx("claude", FIXTURE_HTML_TWEAKS), {
      kind: "verb",
      core: blockOf(name, "core"),
      modifiesHtml: false,
    });
    assertBlocksSurvive(name, sys);
  });
});

// ─── Byte-identity of the craft contract ────────────────────────────────

describe("equivalence — craft contract byte-identity", () => {
  it("VISUAL_CRAFT_CONTRACT is byte-identical to the pre-refactor block", () => {
    // The strongest guarantee the task demanded: the craft block reaches
    // the model IDENTICAL, not merely "present".
    expect(VISUAL_CRAFT_CONTRACT.trim()).toBe(blockOf("generate-fresh-claude", "craft"));
  });
});

// ─── Inspector parity (pa-inspector-fidelity) ───────────────────────────

describe("equivalence — inspector shows exactly what prepare() sends", () => {
  for (const providerId of ["claude", "anthropic"] as const) {
    for (const edit of [false, true]) {
      it(`assembleTurnBlocks joins to prepare()'s systemPrompt (${providerId}, edit=${edit})`, () => {
        const input = turnInput(providerId, edit ? FIXTURE_HTML_PLAIN : undefined);
        const opts = {
          preambleExtras: blockOf(`generate-${edit ? "edit" : "fresh"}-${providerId}`, "direction"),
        };
        const sent = prepare(input, opts).systemPrompt;
        const shown = assembleTurnBlocks(input, opts)
          .filter((b) => b.id !== "user")
          .map((b) => b.content)
          .join("\n\n");
        expect(shown).toBe(sent);
      });
    }
  }
});
