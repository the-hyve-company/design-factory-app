// default-rules.test.ts — the `default_rule_ids` slot end-to-end:
// normalization, dual-store persistence (fs config + db mirror),
// fs-first read resolution and the boot-time sync cache.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory doubles for the two stores behind the slot.
const mem = {
  config: {} as Record<string, unknown>,
  settings: new Map<string, string>(),
  fsOffline: false,
};

vi.mock("@/lib/claude-bridge", () => ({
  readGlobalConfig: vi.fn(async () => (mem.fsOffline ? null : { ...mem.config })),
  writeGlobalConfig: vi.fn(async (patch: Record<string, unknown>) => {
    if (mem.fsOffline) return null;
    Object.assign(mem.config, patch);
    return { ...mem.config };
  }),
  db: {
    getSetting: vi.fn(async (k: string) => mem.settings.get(k) ?? null),
    setSetting: vi.fn(async (k: string, v: string) => {
      mem.settings.set(k, v);
    }),
  },
}));

import {
  DEFAULT_RULES_CHANGE_EVENT,
  __resetDefaultRuleIdsCacheForTests,
  getCachedDefaultRuleIds,
  loadDefaultRuleIds,
  normalizeDefaultRuleIds,
  saveDefaultRuleIds,
} from "@/lib/default-rules";
import { getCoreRuleIds } from "@/data/rules-taxonomy";

const core = getCoreRuleIds();

beforeEach(() => {
  mem.config = {};
  mem.settings.clear();
  mem.fsOffline = false;
  __resetDefaultRuleIdsCacheForTests();
});

describe("normalizeDefaultRuleIds", () => {
  it("dedupes while preserving first-seen order", () => {
    const out = normalizeDefaultRuleIds([core[1], core[0], core[1], core[0]]);
    expect(out).toEqual([core[1], core[0]]);
  });

  it("drops ids that don't resolve to a catalog rule", () => {
    const out = normalizeDefaultRuleIds([core[0], "zzz-not-a-rule", core[2]]);
    expect(out).toEqual([core[0], core[2]]);
  });
});

describe("saveDefaultRuleIds", () => {
  it("persists the normalized list to BOTH stores", async () => {
    const saved = await saveDefaultRuleIds([core[0], core[0], "ghost-id", core[3]]);
    expect(saved).toEqual([core[0], core[3]]);
    expect(mem.config.default_rule_ids).toEqual([core[0], core[3]]);
    expect(JSON.parse(mem.settings.get("default_rule_ids")!)).toEqual([core[0], core[3]]);
  });

  it("updates the sync cache immediately", async () => {
    await saveDefaultRuleIds([core[5]]);
    expect(getCachedDefaultRuleIds()).toEqual([core[5]]);
  });

  it("dispatches the change event with the saved ids", async () => {
    const seen: string[][] = [];
    const onChange = (e: Event) => {
      seen.push((e as CustomEvent<{ ids: string[] }>).detail.ids);
    };
    window.addEventListener(DEFAULT_RULES_CHANGE_EVENT, onChange);
    try {
      await saveDefaultRuleIds([core[2]]);
    } finally {
      window.removeEventListener(DEFAULT_RULES_CHANGE_EVENT, onChange);
    }
    expect(seen).toEqual([[core[2]]]);
  });
});

describe("loadDefaultRuleIds", () => {
  it("prefers the filesystem config over the db mirror", async () => {
    mem.config.default_rule_ids = [core[1]];
    mem.settings.set("default_rule_ids", JSON.stringify([core[4]]));
    expect(await loadDefaultRuleIds()).toEqual([core[1]]);
  });

  it("falls back to the db mirror when the config has no field", async () => {
    mem.settings.set("default_rule_ids", JSON.stringify([core[4]]));
    expect(await loadDefaultRuleIds()).toEqual([core[4]]);
  });

  it("falls back to the db mirror when the bridge is offline", async () => {
    mem.fsOffline = true;
    mem.settings.set("default_rule_ids", JSON.stringify([core[7]]));
    expect(await loadDefaultRuleIds()).toEqual([core[7]]);
  });

  it("resolves to the factory core set when nothing is persisted", async () => {
    expect(await loadDefaultRuleIds()).toEqual(core);
  });

  it("resolves a persisted [] to the factory core set (empty = unset)", async () => {
    await saveDefaultRuleIds([]);
    expect(await loadDefaultRuleIds()).toEqual(core);
  });

  it("primes the sync cache with the resolved value", async () => {
    mem.config.default_rule_ids = [core[6]];
    await loadDefaultRuleIds();
    expect(getCachedDefaultRuleIds()).toEqual([core[6]]);
  });
});

describe("getCachedDefaultRuleIds", () => {
  it("returns the factory core set before any load/prime", () => {
    expect(getCachedDefaultRuleIds()).toEqual(core);
  });

  it("returns a copy — mutating the result doesn't poison the cache", async () => {
    await saveDefaultRuleIds([core[0]]);
    const a = getCachedDefaultRuleIds();
    a.push("mutated");
    expect(getCachedDefaultRuleIds()).toEqual([core[0]]);
  });
});
