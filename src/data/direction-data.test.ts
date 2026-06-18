import { describe, expect, it, beforeEach } from "vitest";
import {
  CATEGORIAS,
  EIXOS,
  FORMATOS,
  DIRECTIONS,
  formatosByCategoria,
  directionsForFormato,
  getFormatoById,
  composePrompt,
  getEffectiveFormatos,
  setFormatOverrides,
  setDirectionOverrides,
  setDisabledFormatIds,
  setDisabledDirectionIds,
  setCustomFormats,
  setCustomDirections,
  type DirectionSelection,
} from "./direction-data";

beforeEach(() => {
  // Reset overrides + customs between tests so state from one doesn't
  // leak into the next. (These setters mutate module-level state on
  // purpose — by design the modal/composer reads the latest at runtime.)
  setFormatOverrides({});
  setDirectionOverrides({});
  setDisabledFormatIds([]);
  setDisabledDirectionIds([]);
  setCustomFormats([]);
  setCustomDirections([]);
});

describe("static data integrity", () => {
  it("has 3 categories", () => {
    expect(CATEGORIAS).toHaveLength(3);
    expect(CATEGORIAS.map((c) => c.id).sort()).toEqual(["interface", "social", "video"]);
  });

  it("has 5 eixos", () => {
    expect(EIXOS).toHaveLength(5);
  });

  it("every formato references an existing categoria", () => {
    const ids = new Set(CATEGORIAS.map((c) => c.id));
    for (const f of FORMATOS) expect(ids.has(f.categoria)).toBe(true);
  });

  it("every direction references an existing eixo", () => {
    const eixos = new Set(EIXOS.map((e) => e.id));
    for (const d of DIRECTIONS) expect(eixos.has(d.eixo)).toBe(true);
  });

  it("every direction's aplica.categorias is a subset of CATEGORIAS", () => {
    const ids = new Set(CATEGORIAS.map((c) => c.id));
    for (const d of DIRECTIONS) {
      for (const c of d.aplica.categorias) expect(ids.has(c)).toBe(true);
    }
  });

  it("formato ids are unique", () => {
    const seen = new Set<string>();
    for (const f of FORMATOS) {
      expect(seen.has(f.id)).toBe(false);
      seen.add(f.id);
    }
  });

  it("direction ids are unique", () => {
    const seen = new Set<string>();
    for (const d of DIRECTIONS) {
      expect(seen.has(d.id)).toBe(false);
      seen.add(d.id);
    }
  });
});

describe("filtering by categoria + formato", () => {
  it("formatosByCategoria returns only the matching categoria", () => {
    const v = formatosByCategoria("video");
    expect(v.length).toBeGreaterThan(0);
    for (const f of v) expect(f.categoria).toBe("video");
  });

  it("directionsForFormato filters by categoria", () => {
    const explainer = getFormatoById("explainer")!;
    const dirs = directionsForFormato(explainer);
    for (const d of dirs) {
      expect(d.aplica.categorias).toContain("video");
    }
  });

  it("disabled formats are hidden from formatosByCategoria", () => {
    const before = formatosByCategoria("video").length;
    setDisabledFormatIds(["explainer"]);
    const after = formatosByCategoria("video").length;
    expect(after).toBe(before - 1);
  });

  it("disabled directions are hidden from directionsForFormato", () => {
    const explainer = getFormatoById("explainer")!;
    const dirIds = directionsForFormato(explainer).map((d) => d.id);
    expect(dirIds.length).toBeGreaterThan(0);
    setDisabledDirectionIds([dirIds[0]]);
    const after = directionsForFormato(explainer).map((d) => d.id);
    expect(after).not.toContain(dirIds[0]);
  });
});

describe("overrides + customs", () => {
  it("override changes the effective name + leaves base untouched", () => {
    setFormatOverrides({ explainer: { nome: "Custom Explainer" } });
    const eff = getEffectiveFormatos().find((f) => f.id === "explainer")!;
    expect(eff.nome).toBe("Custom Explainer");
    const base = FORMATOS.find((f) => f.id === "explainer")!;
    expect(base.nome).not.toBe("Custom Explainer");
  });

  it("custom formato shows up in effective list", () => {
    setCustomFormats([
      {
        id: "custom-poster",
        categoria: "social",
        nome: "Poster",
        descricao: "x",
        canvas: { ratio: "9:16", duration: 0 },
        prompt_prefix: "test",
        anti_slop: [],
      },
    ]);
    const eff = getEffectiveFormatos();
    expect(eff.find((f) => f.id === "custom-poster")?.nome).toBe("Poster");
  });

  it("custom direction shows up via getDirectionsByIds-style lookup", () => {
    setCustomDirections([
      {
        id: "custom-x",
        eixo: "motion",
        nome: "X",
        descricao: "x",
        aplica: { categorias: ["video"] },
        prompt_addon: "addon-text",
      },
    ]);
    const explainer = getFormatoById("explainer")!;
    const dirs = directionsForFormato(explainer);
    expect(dirs.find((d) => d.id === "custom-x")).toBeTruthy();
  });
});

describe("composePrompt", () => {
  const baseSelection = (overrides: Partial<DirectionSelection> = {}): DirectionSelection => ({
    formatoId: "explainer",
    directionIds: [],
    enabledAntiSlop: [],
    customAntiSlop: [],
    ...overrides,
  });

  it("substitutes {{duration}} from formato canvas (default 18s for explainer)", () => {
    const out = composePrompt(baseSelection(), "user goal");
    expect(out).toContain("18");
    expect(out).not.toContain("{{duration}}");
  });

  it("substitutes {{viewport}} from ratio", () => {
    const out = composePrompt(baseSelection(), "x");
    expect(out).toContain("1920×1080");
  });

  it("appends only ENABLED preset anti-slop", () => {
    const formato = getFormatoById("explainer")!;
    const firstSlop = formato.anti_slop[0];
    const out = composePrompt(baseSelection({ enabledAntiSlop: [firstSlop] }), "x");
    expect(out).toContain(firstSlop);
  });

  it("does NOT append disabled (un-enabled) preset anti-slop", () => {
    const formato = getFormatoById("explainer")!;
    const firstSlop = formato.anti_slop[0];
    const out = composePrompt(baseSelection({ enabledAntiSlop: [] }), "x");
    expect(out).not.toContain(firstSlop);
  });

  it("appends custom anti-slop entries", () => {
    const out = composePrompt(baseSelection({ customAntiSlop: ["No purple bg"] }), "x");
    expect(out).toContain("No purple bg");
  });

  it("appends user request at the end", () => {
    const out = composePrompt(baseSelection(), "build me a thing");
    expect(out).toMatch(/USER REQUEST:\s*\n?build me a thing\s*$/);
  });

  it("falls back to userPrompt when formato is unknown", () => {
    const out = composePrompt(baseSelection({ formatoId: "missing" }), "user x");
    expect(out).toBe("user x");
  });
});
