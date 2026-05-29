// model-lists.test.ts — model selection resolution across providers.
//
// Regression guard for the 2026-05-29 bug: picking a live-pulled Ollama
// model (e.g. `gemma`) opened the project running `llama3.2`. Root cause
// was validating the remembered model against the STATIC fallback list
// (which for ollama is only [llama3.2, qwen2.5-coder, mistral]) and
// resetting any live pick to the catalog default.

import { describe, expect, it } from "vitest";
import {
  nextModelForProvider,
  providerHasLiveCatalog,
  defaultModelForProvider,
  getModelsForProvider,
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
