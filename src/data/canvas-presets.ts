// canvas-presets.ts — Canvas (aspect ratio / responsive) catalog.
//
// split: Canvas is now a separate concept from Format.
// Canvas = output shape (1:1, 16:9, etc, custom WxH, or responsive web).
// Format = output category × subitem (Video > Explainer, Interface > Landing…).
//
// Persistence layer mirrors the existing direction-data.ts pattern: a
// frozen DEFAULTS array + a runtime override map (custom presets) loaded
// from filesystem config. User edits via Settings → Canvas.
//
// Selection schema lives in NewProjectFormPayload.canvas:
//   { kind: "preset", presetId: "1080-1080", responsive: false }
//   { kind: "custom", width: 1440, height: 900, responsive: true }
//   null  ← nothing picked yet
//
// "Responsive" is not a kind in this schema — it's an opt-in FLAG
// that adapts an aspect-ratio base (preset OR custom) to the viewport.
// The user always picks a base shape; responsive is a layer on top.

import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────

export type CanvasKind = "preset" | "custom";

export interface CanvasPreset {
  id: string;
  name: string;
  /** Aspect-ratio shorthand shown in the picker (e.g. "1:1", "16:9"). */
  ratio: string;
  /** Pixel dimensions (or null for responsive — but responsive is its own kind). */
  width: number;
  height: number;
  /** Optional unit suffix in meta string (default "px"); used for print A4. */
  unit?: "px" | "mm";
  /** Optional descriptor shown after the meta line (e.g. "canvas marker"). */
  hint?: string;
}

export interface CanvasSelection {
  kind: CanvasKind;
  presetId?: string;
  width?: number;
  height?: number;
  /** v6: opt-in flag — adapts base shape to viewport. Default false. */
  responsive?: boolean;
}

// ─── Schemas (Zod) ────────────────────────────────────────────────────

export const CanvasPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ratio: z.string().min(1),
  // 0 is valid for the "Free" / no-fixed-canvas sentinel preset.
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  unit: z.enum(["px", "mm"]).optional(),
  hint: z.string().optional(),
});

export const CanvasSelectionSchema = z.object({
  kind: z.enum(["preset", "custom"]),
  presetId: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  responsive: z.boolean().optional(),
});

// ─── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_CANVAS_PRESETS: ReadonlyArray<CanvasPreset> = Object.freeze([
  { id: "free", name: "Free", ratio: "—", width: 0, height: 0, hint: "no fixed canvas" },
  { id: "1080-1080", name: "Square", ratio: "1:1", width: 1080, height: 1080 },
  { id: "1920-1080", name: "Web Hero", ratio: "16:9", width: 1920, height: 1080 },
  { id: "1080-1920", name: "Story", ratio: "9:16", width: 1080, height: 1920 },
  { id: "1080-1350", name: "Portrait", ratio: "4:5", width: 1080, height: 1350 },
  { id: "1200-630", name: "OG Image", ratio: "1.91:1", width: 1200, height: 630 },
  { id: "a4", name: "Print A4", ratio: "1:√2", width: 210, height: 297, unit: "mm" },
  {
    id: "1080-canvas",
    name: "Card",
    ratio: "1:1",
    width: 1080,
    height: 1080,
    hint: "canvas marker",
  },
]);

// ─── Runtime store (custom presets) ───────────────────────────────────
//
// Custom presets are appended after defaults. Disabled defaults are stored
// in a separate set so we don't lose them on edit.

let _customs: CanvasPreset[] = [];
let _disabled: Set<string> = new Set();
// builtins permanently hidden — disappear from Padrões list AND picker
// until "Resetar tudo" is invoked. Distinct from _disabled (soft hide that
// keeps the row visible in Padrões so it can be re-enabled with the toggle).
let _hiddenBuiltins: Set<string> = new Set();

export function getCustomCanvasPresets(): CanvasPreset[] {
  return [..._customs];
}
export function setCustomCanvasPresets(arr: CanvasPreset[]): void {
  _customs = [...arr];
}
export function getDisabledCanvasPresetIds(): string[] {
  return [..._disabled];
}
export function setDisabledCanvasPresetIds(ids: string[]): void {
  _disabled = new Set(ids);
}
export function getHiddenBuiltinCanvasIds(): string[] {
  return [..._hiddenBuiltins];
}
export function setHiddenBuiltinCanvasIds(ids: string[]): void {
  _hiddenBuiltins = new Set(ids);
}

/** Default-or-custom merged catalog, filtered by enabled flag and hidden builtins. */
export function getEffectiveCanvasPresets(): CanvasPreset[] {
  const all = [...DEFAULT_CANVAS_PRESETS.filter((p) => !_hiddenBuiltins.has(p.id)), ..._customs];
  return all.filter((p) => !_disabled.has(p.id));
}

// ─── : Export / Import / Reset helpers ─────────────────────────────

/** Snapshot for export. Forward-compat: includes all custom slots. */
export interface CanvasPresetsExportV1 {
  schema: "df.canvas-presets.v1";
  exportedAt: string;
  customs: CanvasPreset[];
  disabledIds: string[];
  hiddenBuiltinIds: string[];
}

export function buildCanvasPresetsExport(): CanvasPresetsExportV1 {
  return {
    schema: "df.canvas-presets.v1",
    exportedAt: new Date().toISOString(),
    customs: getCustomCanvasPresets(),
    disabledIds: getDisabledCanvasPresetIds(),
    hiddenBuiltinIds: getHiddenBuiltinCanvasIds(),
  };
}

const CanvasPresetsExportSchema = z.object({
  schema: z.literal("df.canvas-presets.v1"),
  exportedAt: z.string().optional(),
  customs: z.array(CanvasPresetSchema),
  disabledIds: z.array(z.string()).default([]),
  hiddenBuiltinIds: z.array(z.string()).default([]),
});

export function parseCanvasPresetsImport(raw: unknown): CanvasPresetsExportV1 {
  return CanvasPresetsExportSchema.parse(raw) as CanvasPresetsExportV1;
}

export function getCanvasPresetById(id: string): CanvasPreset | undefined {
  return getEffectiveCanvasPresets().find((p) => p.id === id);
}

export function isCustomCanvasPreset(id: string): boolean {
  return _customs.some((p) => p.id === id);
}

// ─── Display helpers ──────────────────────────────────────────────────

export function formatCanvasMeta(
  preset: CanvasPreset,
  /** Optional localized hint (e.g. "sem canvas fixo" for the Free preset). */
  hintOverride?: string,
): string {
  if (preset.id === "free") return hintOverride ?? preset.hint ?? "no fixed canvas";
  if (preset.unit === "mm") return `${preset.ratio} · ${preset.width}×${preset.height}mm`;
  if (preset.width === 0 || preset.height === 0) return preset.ratio;
  return `${preset.ratio} · ${preset.width}×${preset.height}`;
}

export function describeSelection(
  sel: CanvasSelection | null,
  /** Optional localized resolvers — when present, use translated strings.
   *  Kept optional so call sites without an i18n context (tests, CLI) get
   *  the canonical English labels. */
  i18n?: {
    label: (preset: CanvasPreset) => string;
    customWord: string;
    responsiveSuffix: string;
  },
): string | null {
  if (!sel) return null;
  let base: string | null = null;
  if (sel.kind === "custom") {
    base = sel.width && sel.height ? `${sel.width}×${sel.height}` : (i18n?.customWord ?? "Custom");
  } else if (sel.kind === "preset" && sel.presetId) {
    const p = getCanvasPresetById(sel.presetId);
    base = p ? (i18n?.label(p) ?? p.name) : sel.presetId;
  }
  if (!base) return null;
  const suffix = i18n?.responsiveSuffix ?? "responsivo";
  return sel.responsive ? `${base} · ${suffix}` : base;
}
