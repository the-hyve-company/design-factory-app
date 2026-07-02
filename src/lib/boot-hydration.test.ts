// boot-hydration.test.ts — the unified boot routine hydrates EVERY
// config slot (including the ones that previously only hydrated on each
// Settings editor's mount: hidden builtin rules, canvas presets, format
// items) with fs-config-first / db-fallback resolution.

import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateConfigSlots, type BootSettingReader } from "@/lib/boot-hydration";
import type { GlobalConfig } from "@/lib/claude-bridge";
import {
  getCoreRuleIds,
  getDisabledRuleIds,
  getHiddenBuiltinRuleIds,
  getUserRules,
  setDisabledRuleIds,
  setHiddenBuiltinRuleIds,
  setUserRules,
} from "@/data/rules-taxonomy";
import {
  getCustomCanvasPresets,
  getDisabledCanvasPresetIds,
  getHiddenBuiltinCanvasIds,
  setCustomCanvasPresets,
  setDisabledCanvasPresetIds,
  setHiddenBuiltinCanvasIds,
} from "@/data/canvas-presets";
import {
  getDisabledFormatItemIds,
  getHiddenBuiltinFormatItemIds,
  setDisabledFormatItemIds,
  setHiddenBuiltinFormatItemIds,
} from "@/data/format-taxonomy";
import { __resetDefaultRuleIdsCacheForTests, getCachedDefaultRuleIds } from "@/lib/default-rules";

function readerFrom(map: Record<string, string>): BootSettingReader {
  return vi.fn(async (key: string) => map[key] ?? null);
}

const NO_DB: BootSettingReader = async () => null;

afterEach(() => {
  // Module-level slots are global — reset what this file touches.
  setUserRules([]);
  setDisabledRuleIds([]);
  setHiddenBuiltinRuleIds([]);
  setCustomCanvasPresets([]);
  setDisabledCanvasPresetIds([]);
  setHiddenBuiltinCanvasIds([]);
  setDisabledFormatItemIds([]);
  setHiddenBuiltinFormatItemIds([]);
  __resetDefaultRuleIdsCacheForTests();
});

describe("hydrateConfigSlots — filesystem config slots", () => {
  it("hydrates the previously editor-mount-only slots from the config", async () => {
    const core = getCoreRuleIds();
    const cfg: GlobalConfig = {
      custom_rules: [
        { id: "usr-custom-1", title: "My rule", category: "custom", builtin: false },
        { nope: true }, // junk — dropped by RuleSchema
      ] as never,
      hidden_builtin_rules: [core[0]],
      default_rule_ids: [core[1], core[2]],
      custom_canvas_presets: [
        { id: "custom-canvas-1", name: "Poster", ratio: "2:3", width: 800, height: 1200 },
        { id: "broken" }, // junk — dropped by CanvasPresetSchema
      ] as never,
      hidden_builtin_canvas_presets: ["a4"],
      hidden_builtin_format_items: ["some-format-item"],
    };

    await hydrateConfigSlots(cfg, NO_DB);

    expect(getUserRules().map((r) => r.id)).toEqual(["usr-custom-1"]);
    expect(getHiddenBuiltinRuleIds()).toEqual([core[0]]);
    expect(getCachedDefaultRuleIds()).toEqual([core[1], core[2]]);
    expect(getCustomCanvasPresets().map((p) => p.id)).toEqual(["custom-canvas-1"]);
    expect(getHiddenBuiltinCanvasIds()).toEqual(["a4"]);
    expect(getHiddenBuiltinFormatItemIds()).toEqual(["some-format-item"]);
  });
});

describe("hydrateConfigSlots — db fallback", () => {
  it("reads db keys for slots absent from the config", async () => {
    const core = getCoreRuleIds();
    const reader = readerFrom({
      rules_disabled: JSON.stringify([core[3]]),
      rules_hidden_builtins: JSON.stringify([core[4]]),
      canvas_presets_disabled: JSON.stringify(["1080-1080"]),
      canvas_presets_hidden_builtins: JSON.stringify(["1200-630"]),
      format_items_disabled: JSON.stringify(["fmt-x"]),
      default_rule_ids: JSON.stringify([core[5]]),
    });

    await hydrateConfigSlots(null, reader);

    expect(getDisabledRuleIds()).toEqual([core[3]]);
    expect(getHiddenBuiltinRuleIds()).toEqual([core[4]]);
    expect(getDisabledCanvasPresetIds()).toEqual(["1080-1080"]);
    expect(getHiddenBuiltinCanvasIds()).toEqual(["1200-630"]);
    expect(getDisabledFormatItemIds()).toEqual(["fmt-x"]);
    expect(getCachedDefaultRuleIds()).toEqual([core[5]]);
  });

  it("filesystem config wins over the db mirror for the same slot", async () => {
    const core = getCoreRuleIds();
    const cfg: GlobalConfig = { hidden_builtin_rules: [core[0]] };
    const reader = readerFrom({
      rules_hidden_builtins: JSON.stringify([core[1]]),
    });

    await hydrateConfigSlots(cfg, reader);

    expect(getHiddenBuiltinRuleIds()).toEqual([core[0]]);
  });

  it("leaves slots at factory defaults when nothing is persisted", async () => {
    await hydrateConfigSlots(null, NO_DB);

    expect(getUserRules()).toEqual([]);
    expect(getHiddenBuiltinRuleIds()).toEqual([]);
    expect(getCustomCanvasPresets()).toEqual([]);
    expect(getCachedDefaultRuleIds()).toEqual(getCoreRuleIds());
  });

  it("swallows corrupt db JSON without touching the slot", async () => {
    const reader = readerFrom({
      rules_disabled: "{not json",
      canvas_presets_disabled: "also not json",
    });

    await hydrateConfigSlots(null, reader);

    expect(getDisabledRuleIds()).toEqual([]);
    expect(getDisabledCanvasPresetIds()).toEqual([]);
  });
});
