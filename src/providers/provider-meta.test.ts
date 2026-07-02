// provider-meta.test.ts — audit WS3 `provider-meta-transport-needstoken`.
//
// `transport` and `needsToken` used to live as hardcoded id whitelists
// in four screens (SettingsScreen's PROVIDER_TYPE map + inline token
// gate, NewProjectFormSkeu's transport sub-label, AgentPicker's group
// arrays). They now live once, on ProviderMeta — this test locks the
// declared values and the derived surfaces.

import { describe, it, expect } from "vitest";
import { PROVIDERS } from "./registry";
import { TOKEN_PROVIDERS } from "@/components/ProviderTokenInline";

const metaOf = (id: string) => {
  const p = PROVIDERS.find((x) => x.meta.id === id);
  if (!p) throw new Error(`provider ${id} not registered`);
  return p.meta;
};

describe("ProviderMeta — transport", () => {
  it("declares the audited transport split (5 cli / 4 api / 1 local)", () => {
    const byTransport = (t: string) =>
      PROVIDERS.filter((p) => p.meta.transport === t)
        .map((p) => p.meta.id)
        .sort();
    expect(byTransport("cli")).toEqual(["claude", "codex", "gemini", "kimi", "opencode"]);
    expect(byTransport("api")).toEqual(["anthropic", "gemini-api", "openai", "openrouter"]);
    expect(byTransport("local")).toEqual(["ollama"]);
  });

  it("every provider declares a transport (no fallback needed downstream)", () => {
    for (const p of PROVIDERS) {
      expect(["cli", "api", "local"]).toContain(p.meta.transport);
    }
  });
});

describe("ProviderMeta — needsToken", () => {
  it("token-input set matches ProviderTokenInline's TOKEN_PROVIDERS 1:1", () => {
    const declared = PROVIDERS.filter((p) => p.meta.needsToken)
      .map((p) => p.meta.id)
      .sort();
    expect(declared).toEqual([...TOKEN_PROVIDERS].sort());
  });

  it("needsToken is orthogonal to transport (kimi: cli + token)", () => {
    expect(metaOf("kimi")).toMatchObject({ transport: "cli", needsToken: true });
    expect(metaOf("claude")).toMatchObject({ transport: "cli", needsToken: false });
    expect(metaOf("ollama")).toMatchObject({ transport: "local", needsToken: false });
  });
});
