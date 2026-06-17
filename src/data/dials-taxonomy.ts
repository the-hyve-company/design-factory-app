// dials-taxonomy.ts — Taste Dials (6 dials × 4 stops = 24 phrases).
//
// One of the 7 canonical defaults categories in DF v1:
//   canvas · formats · rules · dials · commands · skills · system prompts
//
// "Dials" carry the project's taste calibration. Each dial has a numeric
// value 0..100, snap-stopped at 0/25/50/75/100 in the UI. The midpoint
// (38..62) emits no phrase; the four non-neutral bins each carry a
// per-dial body that flows into the canonical+ system prompt summary.
//
// User overrides any per-(dial, stop) phrase via Settings → Taste
// (`db.setSetting("tasteDial:${key}:${stop}")`). Overrides do not
// rewrite this file; the runtime resolves the cascade
//   override > baseline (this file)
// inside canonical-plus-prompt.ts.

export type DialKey =
  | "density"
  | "motion"
  | "contrast"
  | "interactions"
  | "surface"
  | "originality";

export type DialDirection = {
  extremeLow: string;
  softLow: string;
  softHigh: string;
  extremeHigh: string;
};

/** Per-dial language. Each describes the BEHAVIOUR the model should
 *  adopt at each non-neutral stop, with progressive intensity from
 *  soft → extreme on each side. */
export const DEFAULT_BUILTIN_DIALS: Record<DialKey, DialDirection> = Object.freeze({
  density: {
    extremeLow:
      "Radical restraint — gallery whitespace, minimum elements per surface, near-empty canvas.",
    softLow: "Spacious layout — generous breathing room, fewer elements per section.",
    softHigh: "Layered layout — more content per section, tighter gutters, dense rhythm.",
    extremeHigh:
      "Maximum density — pack every visible element, brutalist info-fill, no decorative gaps.",
  },
  motion: {
    extremeLow:
      "Inert composition — no transitions, no hover lifts, no scroll-driven animation, static.",
    softLow: "Quiet motion — subtle fades on essential state changes, no decorative animation.",
    softHigh: "Animated — transitions on state changes, hover micro-interactions, scroll cues.",
    extremeHigh:
      "Choreographed motion — rich transitions, parallax, scroll-tied sequences, every interaction tactile.",
  },
  contrast: {
    extremeLow:
      "Whisper contrast — single-tone palette, near-imperceptible hierarchy, monastic restraint.",
    softLow: "Muted contrast — soft palette, low chroma, gentle weight steps.",
    softHigh: "Bold contrast — strong chroma accents, sharp type weight progression.",
    extremeHigh: "Maximum contrast — black/white poles, electric accent, brutalist hierarchy.",
  },
  interactions: {
    extremeLow: "Read-only document — no hover states, no click affordances beyond essential CTAs.",
    softLow: "Quiet interaction — primary CTAs only, restraint on hover treatments.",
    softHigh:
      "Playful interaction — interactive elements visible everywhere, hover/active states present.",
    extremeHigh:
      "Fully tactile — every element responds, micro-interactions celebrated, instrument-like feedback.",
  },
  surface: {
    extremeLow: "Pure flatness — no shadows, no bevels, no depth, drawing-paper composition.",
    softLow: "Flat surfaces — subtle borders only, no shadows or bevels.",
    softHigh: "Tactile surfaces — soft drops, gentle bezels, suggested depth.",
    extremeHigh:
      "Skeuomorphic — deep bezels, inset highlights, ambient drops, instrument-grade tactility.",
  },
  originality: {
    extremeLow: "Strict convention — proven patterns only, predictable layouts, zero surprise.",
    softLow: "Conventional — recognisable patterns with minor authorial touches.",
    softHigh: "Authorial — break grids when it serves, idiosyncratic compositions welcome.",
    extremeHigh: "Experimental — abandon convention, novel structures, surprising at every scroll.",
  },
}) as Record<DialKey, DialDirection>;

/** Stable enumeration order — UI + audit code key off this list. */
export const DIAL_KEYS: ReadonlyArray<DialKey> = [
  "density",
  "motion",
  "contrast",
  "interactions",
  "surface",
  "originality",
];

/** The 4 non-neutral stop ids in stop-order. Mirrors UI ticks. */
export const DIAL_STOPS: ReadonlyArray<keyof DialDirection> = [
  "extremeLow",
  "softLow",
  "softHigh",
  "extremeHigh",
];

/** Map a 0..100 dial value to its stop (or null for the neutral middle). */
export function stopForValue(value: number): keyof DialDirection | null {
  if (value < 10) return "extremeLow";
  if (value < 38) return "softLow";
  if (value <= 62) return null;
  if (value <= 89) return "softHigh";
  return "extremeHigh";
}
