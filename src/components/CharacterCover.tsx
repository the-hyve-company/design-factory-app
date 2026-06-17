// CharacterCover.tsx — deterministic dot-grid character avatars.
//
// User ask 2026-05-21: "Generative dot grid, formando sempre
// personagens". Every Skill and Project gets the same procedural
// character every time (same slug → same character forever) so the
// user can recognise them by silhouette before reading the title.
//
// Algorithm:
//   1. djb2 hash of the seed string → 32-bit unsigned int.
//   2. Build a horizontally-mirrored 11×11 dot grid: each row pulls a
//      bitmask from the hash for the LEFT half (5 cols) and mirrors
//      onto the right half. Centre col is the axis.
//   3. Three body zones get distinct rules so the result reads as a
//      creature, not noise:
//        rows 0-1   (head crown / antenna) — sparse, only 0-1 dots
//                   off-axis to suggest ears / antennae.
//        rows 2-4   (head + face)         — denser fill, two cells
//                   reserved as "eyes" (off-axis fixed offset).
//        rows 5-7   (body)                — densest fill, occasional
//                   accent dot.
//        rows 8-9   (legs / base)         — symmetrical pair only.
//        row  10    (shadow)              — single dim accent dot
//                   below the body, drawn as a half-opacity ellipse
//                   instead of a square so the creature reads as
//                   standing on something.
//   4. Two colors driven by the hash:
//        base   = the main fill (HSL hue derived from hash bits).
//        accent = ~60° away on the wheel for the eyes + accent dot.
//      Background stays neutral (var(--df-bg-section)) so the cover
//      reads on both light and dark themes.
//
// The component is pure SVG, scales via viewBox, no external deps.
// 16:9 aspect via container; the SVG centers the grid horizontally
// and vertically (the grid is square but the card is widescreen).

import { useMemo } from "react";

interface CharacterCoverProps {
  /** Stable string the character is derived from. Same seed → same
   *  character forever. Use slug / id / name — anything stable. */
  seed: string;
  /** Optional accent color override (HSL/HEX). When omitted the hash
   *  picks one deterministically. Used so e.g. project tiles can match
   *  the user's chosen --df-accent. */
  accent?: string;
  /** Background fill. Defaults to var(--df-bg-section). */
  background?: string;
}

function djb2(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    // (h * 33) ^ c — but kept in 32-bit unsigned.
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

// Cheap PRNG seeded by the hash so we can pull several deterministic
// numbers out of one seed without collisions.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function CharacterCover({ seed, accent, background }: CharacterCoverProps) {
  const { dots, eyes, shadowY, baseColor, accentColor } = useMemo(() => {
    const hash = djb2(seed || "?");
    const rand = mulberry32(hash);
    // Grid: 11 cols (5 left + 1 axis + 5 right mirrored) × 11 rows.
    const COLS = 11;
    const ROWS = 11;
    const HALF = 5;
    const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    // Helper: set cell mirrored across the vertical centre axis (col 5).
    const setMirror = (row: number, halfCol: number, on: boolean) => {
      // halfCol 0..5 (5 is the centre col)
      grid[row][halfCol] = on;
      grid[row][COLS - 1 - halfCol] = on;
    };
    // Row weights = probability of each cell being "on" in the LEFT half.
    // Head crown sparse, face medium, body dense, legs symmetric pair.
    const weights = [0.1, 0.22, 0.55, 0.65, 0.55, 0.78, 0.82, 0.65, 0.25, 0.25, 0.0];
    for (let r = 0; r < ROWS - 1; r++) {
      const w = weights[r] ?? 0.4;
      for (let c = 0; c < HALF + 1; c++) {
        setMirror(r, c, rand() < w);
      }
    }
    // Force a minimum body presence — every creature needs at least the
    // centre column filled in the chest zone so it never reads as a
    // disconnected sprite.
    grid[5][HALF] = true;
    grid[6][HALF] = true;
    // Legs: ensure rows 8-9 have at least one off-axis pair.
    if (!grid[8][HALF - 2] && !grid[8][HALF - 1]) {
      setMirror(8, HALF - 2, true);
    }
    if (!grid[9][HALF - 2] && !grid[9][HALF - 1]) {
      setMirror(9, HALF - 2, true);
    }
    // Eyes: pick fixed offsets on row 3 — symmetric across the axis,
    // 1-2 cells from the centre. Carve them OUT of the head fill (set
    // to false) so they read as eyes; the render path paints them in
    // the accent color regardless of the grid state.
    const eyeOffset = hash & 1 ? 2 : 1;
    grid[3][HALF - eyeOffset] = false;
    grid[3][HALF + eyeOffset] = false;
    const eyeCells: Array<[number, number]> = [
      [3, HALF - eyeOffset],
      [3, HALF + eyeOffset],
    ];

    // Color picks. HSL hue from upper bits; saturation/lightness fixed
    // so it works on both themes.
    const baseHue = ((hash >>> 8) & 0xff) * (360 / 256);
    const accentHue = (baseHue + 50) % 360;
    const base = accent ?? `hsl(${baseHue.toFixed(1)} 38% 58%)`;
    const acc = `hsl(${accentHue.toFixed(1)} 65% 56%)`;
    return {
      dots: grid,
      eyes: eyeCells,
      shadowY: ROWS - 1,
      baseColor: base,
      accentColor: acc,
    };
  }, [seed, accent]);

  // 16:9 frame; the 11×11 grid centres at ~62% height so the character
  // floats above its shadow and leaves headroom for the eyes.
  const CELL = 10;
  const GRID = 11 * CELL;
  const FRAME_W = 320;
  const FRAME_H = 180;
  const offsetX = (FRAME_W - GRID) / 2;
  const offsetY = (FRAME_H - GRID) / 2;
  const radius = 1.2;

  return (
    <svg
      viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        background: background ?? "var(--df-bg-section)",
      }}
      role="img"
      aria-label={`character cover ${seed}`}
    >
      {/* Shadow ellipse — half-opacity accent. */}
      <ellipse
        cx={FRAME_W / 2}
        cy={offsetY + shadowY * CELL + CELL / 2}
        rx={CELL * 1.8}
        ry={CELL * 0.55}
        fill={accentColor}
        opacity={0.12}
      />
      {/* Body dots. */}
      {dots.map((row, r) =>
        row.map((on, c) => {
          if (!on) return null;
          const x = offsetX + c * CELL + radius;
          const y = offsetY + r * CELL + radius;
          return (
            <rect
              key={`${r}-${c}`}
              x={x}
              y={y}
              width={CELL - radius * 2}
              height={CELL - radius * 2}
              rx={radius}
              ry={radius}
              fill={baseColor}
            />
          );
        }),
      )}
      {/* Eyes — painted in accent, slightly inset, regardless of grid. */}
      {eyes.map(([r, c]) => {
        const x = offsetX + c * CELL + CELL / 2;
        const y = offsetY + r * CELL + CELL / 2;
        return <circle key={`eye-${r}-${c}`} cx={x} cy={y} r={CELL * 0.28} fill={accentColor} />;
      })}
    </svg>
  );
}
