// model-lists.test.ts — model selection resolution across providers.
//
// Regression guard for the 2026-05-29 bug: picking a live-pulled Ollama
// model (e.g. `gemma`) opened the project running `llama3.2`. Root cause
// was validating the remembered model against the STATIC fallback list
// (which for ollama is only [llama3.2, qwen2.5-coder, mistral]) and
// resetting any live pick to the catalog default.

import { describe, expect, it, beforeEach } from "vitest";
import {
  nextModelForProvider,
  providerHasLiveCatalog,
  defaultModelForProvider,
  getModelsForProvider,
  CLAUDE_MODEL_OPTIONS,
  prettyModelVersion,
  readSeenVersion,
  writeSeenVersion,
  enrichWithSeenVersion,
} from "./model-lists";

describe("providerHasLiveCatalog", () => {
  it("ollama and openrouter probe a live catalog", () => {
    expect(providerHasLiveCatalog("ollama")).toBe(true);
    expect(providerHasLiveCatalog("openrouter")).toBe(true);
  });
  it("BYOK API providers (kimi) probe a live catalog", () => {
    expect(providerHasLiveCatalog("kimi")).toBe(true);
  });
  it("claude is static-only (CLI aliases are the contract)", () => {
    expect(providerHasLiveCatalog("claude")).toBe(false);
  });
});

describe("nextModelForProvider", () => {
  it("trusts a live-pulled ollama model absent from the static fallback (gemma stays gemma)", () => {
    // The static ollama list is [llama3.2, qwen2.5-coder, mistral]; a live
    // `ollama pull`ed gemma must NOT be reset to the llama3.2 default.
    expect(nextModelForProvider("ollama", "gemma3:latest")).toBe("gemma3:latest");
    expect(nextModelForProvider("ollama", "gemma3:latest")).not.toBe(
      defaultModelForProvider("ollama"),
    );
  });

  it("falls back to the catalog default when nothing is remembered", () => {
    expect(nextModelForProvider("ollama", null)).toBe(defaultModelForProvider("ollama"));
    expect(nextModelForProvider("ollama", "")).toBe(defaultModelForProvider("ollama"));
    expect(nextModelForProvider("ollama", undefined)).toBe(defaultModelForProvider("ollama"));
  });

  it("keeps a remembered static-provider model that is in its list", () => {
    const firstClaude = getModelsForProvider("claude")[0]?.id;
    expect(firstClaude).toBeTruthy();
    expect(nextModelForProvider("claude", firstClaude!)).toBe(firstClaude);
  });

  it("rejects a remembered model foreign to a static-only provider", () => {
    expect(nextModelForProvider("claude", "gemma3:latest")).toBe(
      defaultModelForProvider("claude"),
    );
  });
});

// ── Future-proof picker (2026-06-01): no stale version in the claude
//    labels; the resolved version is surfaced from runtime instead. ──

describe("claude catalog — aliases with no stale version numbers", () => {
  it("uses bare aliases (the CLI resolves them to the latest version)", () => {
    expect(CLAUDE_MODEL_OPTIONS.map((o) => o.id)).toEqual(["opus", "sonnet", "haiku"]);
    // Labels must NOT hard-code a version — that was the bug (picker showed
    // "opus 4.8" frozen while the CLI shipped something newer).
    for (const o of CLAUDE_MODEL_OPTIONS) {
      expect(o.label).not.toMatch(/\d+\.\d+/);
    }
  });
});

describe("prettyModelVersion — compact label from a real model id", () => {
  it("parses dated Claude ids into 'family X.Y'", () => {
    expect(prettyModelVersion("claude-opus-4-8-20260115")).toBe("opus 4.8");
    expect(prettyModelVersion("claude-sonnet-4-6")).toBe("sonnet 4.6");
  });
  it("strips the vendor prefix for slash-style ids", () => {
    expect(prettyModelVersion("anthropic/claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
  });
  it("falls back to the raw id when no pattern matches", () => {
    expect(prettyModelVersion("gpt-5.5")).toBe("gpt-5.5");
    expect(prettyModelVersion("")).toBe("");
  });
});

describe("seen-version persistence + enrichment", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("round-trips a real model id keyed by (provider, alias)", () => {
    expect(readSeenVersion("claude", "opus")).toBeNull();
    writeSeenVersion("claude", "opus", "claude-opus-4-8-20260115");
    expect(readSeenVersion("claude", "opus")).toBe("claude-opus-4-8-20260115");
    expect(readSeenVersion("claude", "sonnet")).toBeNull();
  });

  it("annotates the matching option's sub with the resolved version", () => {
    writeSeenVersion("claude", "opus", "claude-opus-4-8-20260115");
    const enriched = enrichWithSeenVersion("claude", getModelsForProvider("claude"));
    expect(enriched.find((o) => o.id === "opus")?.sub).toContain("opus 4.8");
    // Untouched when nothing was seen for that alias.
    expect(enriched.find((o) => o.id === "sonnet")?.sub).toBe("balanced");
  });

  it("does not duplicate the version if it is already present", () => {
    writeSeenVersion("claude", "opus", "claude-opus-4-8");
    const once = enrichWithSeenVersion("claude", getModelsForProvider("claude")).find((o) => o.id === "opus")!;
    const twice = enrichWithSeenVersion("claude", [once]).find((o) => o.id === "opus")!;
    expect(twice.sub).toBe(once.sub);
  });
});
