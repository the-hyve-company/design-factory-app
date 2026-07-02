// cli-spawner.test.ts — audit WS3 `model-default-no-claude-leak`.
//
// CATEGORY_CONFIG pins Claude aliases (opus/sonnet/haiku) per prompt
// category. resolveSpawnModel is the single decision point both
// spawnStream and spawnOnce route through — these tests prove the alias
// only ever reaches Claude, and that overrideless non-Claude calls defer
// to the daemon adapter's own default (model omitted).

import { describe, it, expect } from "vitest";
import { resolveSpawnModel } from "./cli-spawner";
import { PROVIDERS } from "@/providers/registry";

describe("resolveSpawnModel — Claude aliases never leak", () => {
  it("claude without override keeps the category alias (intentional tiering)", () => {
    expect(resolveSpawnModel("claude", "opus", undefined)).toBe("opus");
    expect(resolveSpawnModel("claude", "haiku", undefined)).toBe("haiku");
  });

  it("omitted providerId defaults to claude (back-compat callers)", () => {
    expect(resolveSpawnModel(undefined, "sonnet", undefined)).toBe("sonnet");
  });

  it("every non-Claude provider gets NO model when there is no override", () => {
    for (const p of PROVIDERS) {
      const id = p.meta.id;
      if (id === "claude") continue;
      // The category alias ("opus") must not ride into kimi/openrouter/
      // ollama/etc — the daemon adapter resolves its own default when the
      // model is absent.
      expect(resolveSpawnModel(id, "opus", undefined), id).toBeUndefined();
      expect(resolveSpawnModel(id, "haiku", undefined), id).toBeUndefined();
    }
  });

  it("an explicit override always wins, for every provider", () => {
    for (const p of PROVIDERS) {
      expect(resolveSpawnModel(p.meta.id, "opus", "my-model"), p.meta.id).toBe("my-model");
    }
  });

  it("empty-string override is treated as absent (falls back per provider)", () => {
    // EditorScreen can transiently hold selectedModel === "" — that must
    // not be forwarded as a literal empty model, nor resurrect the alias
    // for non-Claude providers.
    expect(resolveSpawnModel("kimi", "opus", "")).toBeUndefined();
    expect(resolveSpawnModel("claude", "opus", "")).toBe("opus");
  });
});
