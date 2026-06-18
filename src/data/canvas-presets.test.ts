// canvas-presets.test.ts — sanity tests for canvas preset catalog.

import { describe, expect, it, beforeEach } from "vitest";
import {
  CanvasPresetSchema,
  CanvasSelectionSchema,
  DEFAULT_CANVAS_PRESETS,
  describeSelection,
  formatCanvasMeta,
  getCanvasPresetById,
  getCustomCanvasPresets,
  getEffectiveCanvasPresets,
  isCustomCanvasPreset,
  setCustomCanvasPresets,
  setDisabledCanvasPresetIds,
  type CanvasPreset,
  type CanvasSelection,
} from "./canvas-presets";

beforeEach(() => {
  setCustomCanvasPresets([]);
  setDisabledCanvasPresetIds([]);
});

describe("canvas-presets defaults", () => {
  it("ships at least 8 default presets", () => {
    expect(DEFAULT_CANVAS_PRESETS.length).toBeGreaterThanOrEqual(8);
  });

  it("each default preset validates against the schema", () => {
    for (const p of DEFAULT_CANVAS_PRESETS) {
      const r = CanvasPresetSchema.safeParse(p);
      expect(r.success).toBe(true);
    }
  });

  it("includes 1080×1080 Square preset", () => {
    const sq = DEFAULT_CANVAS_PRESETS.find((p) => p.id === "1080-1080");
    expect(sq).toBeDefined();
    expect(sq?.width).toBe(1080);
    expect(sq?.height).toBe(1080);
    expect(sq?.ratio).toBe("1:1");
  });

  it("includes A4 print preset with mm unit", () => {
    const a4 = DEFAULT_CANVAS_PRESETS.find((p) => p.id === "a4");
    expect(a4?.unit).toBe("mm");
  });
});

describe("canvas-presets effective catalog", () => {
  it("merges customs after defaults", () => {
    const custom: CanvasPreset = {
      id: "my-canvas",
      name: "My canvas",
      ratio: "21:9",
      width: 2560,
      height: 1080,
    };
    setCustomCanvasPresets([custom]);
    const effective = getEffectiveCanvasPresets();
    expect(effective.length).toBe(DEFAULT_CANVAS_PRESETS.length + 1);
    expect(effective[effective.length - 1].id).toBe("my-canvas");
  });

  it("filters out disabled preset ids", () => {
    setDisabledCanvasPresetIds(["1080-1920"]);
    const effective = getEffectiveCanvasPresets();
    expect(effective.find((p) => p.id === "1080-1920")).toBeUndefined();
  });

  it("isCustomCanvasPreset distinguishes user vs builtin", () => {
    const custom: CanvasPreset = {
      id: "x",
      name: "X",
      ratio: "1:1",
      width: 100,
      height: 100,
    };
    setCustomCanvasPresets([custom]);
    expect(isCustomCanvasPreset("x")).toBe(true);
    expect(isCustomCanvasPreset("1080-1080")).toBe(false);
  });
});

describe("canvas-presets describe + format helpers", () => {
  it("describes a preset selection by name", () => {
    const sel: CanvasSelection = { kind: "preset", presetId: "1080-1080" };
    expect(describeSelection(sel)).toBe("Square");
  });

  it("describes a custom selection with dimensions", () => {
    const sel: CanvasSelection = { kind: "custom", width: 1440, height: 900 };
    expect(describeSelection(sel)).toBe("1440×900");
  });

  it("v6: appends '· responsivo' suffix when responsive flag is true", () => {
    const sel: CanvasSelection = { kind: "preset", presetId: "1080-1080", responsive: true };
    expect(describeSelection(sel)).toBe("Square · responsivo");
  });

  it("v6: omits suffix when responsive flag is false/missing", () => {
    const a: CanvasSelection = { kind: "preset", presetId: "1080-1080" };
    expect(describeSelection(a)).toBe("Square");
    const b: CanvasSelection = { kind: "preset", presetId: "1080-1080", responsive: false };
    expect(describeSelection(b)).toBe("Square");
  });

  it("v6: combines custom dims with responsive suffix", () => {
    const sel: CanvasSelection = { kind: "custom", width: 1440, height: 900, responsive: true };
    expect(describeSelection(sel)).toBe("1440×900 · responsivo");
  });

  it("returns null for null selection", () => {
    expect(describeSelection(null)).toBeNull();
  });

  it("formatCanvasMeta produces human-readable string", () => {
    const sq = getCanvasPresetById("1080-1080")!;
    expect(formatCanvasMeta(sq)).toContain("1080");
    const a4 = getCanvasPresetById("a4")!;
    expect(formatCanvasMeta(a4)).toContain("mm");
  });
});

describe("canvas-presets selection schema", () => {
  it("accepts valid kinds (preset/custom only — v6 dropped responsive kind)", () => {
    expect(CanvasSelectionSchema.safeParse({ kind: "preset", presetId: "x" }).success).toBe(true);
    expect(
      CanvasSelectionSchema.safeParse({ kind: "custom", width: 100, height: 100 }).success,
    ).toBe(true);
  });

  it("v6: accepts the responsive flag on either kind", () => {
    expect(
      CanvasSelectionSchema.safeParse({
        kind: "preset",
        presetId: "x",
        responsive: true,
      }).success,
    ).toBe(true);
    expect(
      CanvasSelectionSchema.safeParse({
        kind: "custom",
        width: 100,
        height: 100,
        responsive: false,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid kinds (and the legacy 'responsive' kind)", () => {
    expect(CanvasSelectionSchema.safeParse({ kind: "wat" }).success).toBe(false);
    expect(CanvasSelectionSchema.safeParse({ kind: "responsive" }).success).toBe(false);
  });
});

describe("custom presets isolation", () => {
  it("getCustomCanvasPresets returns a copy (mutations don't leak)", () => {
    setCustomCanvasPresets([
      {
        id: "a",
        name: "A",
        ratio: "1:1",
        width: 1,
        height: 1,
      },
    ]);
    const arr = getCustomCanvasPresets();
    arr.push({
      id: "b",
      name: "B",
      ratio: "1:1",
      width: 1,
      height: 1,
    });
    expect(getCustomCanvasPresets().length).toBe(1);
  });
});
