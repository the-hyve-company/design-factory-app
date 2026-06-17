import { useEffect, useMemo, useRef, useState } from "react";
import { wrapHtmlForViewportFit } from "@/runtime/viewport-fit";
import { Logo } from "@/components/Logo";

/**
 * ProjectCover — dot-grid is the canonical cover language. Every cover
 * is a regular grid of dots, modulated by one of ~15 patterns to create
 * shapes, waves, gradients, silhouettes, etc.
 *
 * Slug seeds: (1) which modulator to use, (2) all of its sub-parameters
 * (focal point, frequency, phase, etc). Same slug = same cover always.
 *
 * Monochrome warm-grey only — uses `var(--df-text-primary)` so it
 * adapts to dark/light themes automatically.
 */

import type { RatioId } from "@/runtime/hyperframes-invoker";

interface ProjectCoverProps {
  slug: string;
  width?: number;
  height?: number;
  /** Force a specific modulator (used by the showcase page to render variants). */
  variant?: DotGridStyle;
  /** When provided, the cover becomes a scaled-down live preview of the
   * project's HTML instead of the generative dot grid. Falls back to the
   * dot grid automatically when this is empty. */
  htmlContent?: string | null;
  /** Aspect ratio of the underlying project (from .df/meta.json). Drives the
   * iframe viewport size in HtmlPreviewCover so a 9:16 video doesn't get
   * squashed into a 16:9 thumbnail. */
  ratio?: RatioId;
  className?: string;
  style?: React.CSSProperties;
}

// Iframe viewport size per ratio. The preview is rendered at this exact
// size, then contain-fit-scaled into the card. Keep the totals in the
// 1080–1280 px range so any reasonable card scales it down (no upscale).
const VIEWPORT_BY_RATIO: Record<RatioId, { vw: number; vh: number }> = {
  "16:9": { vw: 1280, vh: 720 },
  "9:16": { vw: 720, vh: 1280 },
  "1:1": { vw: 1080, vh: 1080 },
  "4k": { vw: 1280, vh: 720 },
};

export type DotGridStyle =
  | "radial-bright"
  | "radial-dim"
  | "wave-h"
  | "wave-v"
  | "wave-diagonal"
  | "concentric"
  | "spotlight"
  | "corner"
  | "cross"
  | "circle-silhouette"
  | "checkerboard"
  | "bands-h"
  | "bands-v"
  | "spiral"
  | "hourglass"
  | "x-shape";

export const DOT_GRID_STYLES: DotGridStyle[] = [
  "radial-bright",
  "radial-dim",
  "wave-h",
  "wave-v",
  "wave-diagonal",
  "concentric",
  "spotlight",
  "corner",
  "cross",
  "circle-silhouette",
  "checkerboard",
  "bands-h",
  "bands-v",
  "spiral",
  "hourglass",
  "x-shape",
];

// Back-compat: kept so the showcase / older imports keep working.
export type CoverVariant = DotGridStyle;
export const COVER_VARIANTS = DOT_GRID_STYLES;

// ─── Helpers ─────────────────────────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function makeRng(seed: number) {
  let a = seed | 0;
  let b = (seed * 1.357) | 0;
  let c = (seed * 2.713) | 0;
  let d = (seed * 1.149) | 0;
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11) | 0;
    d = (d + 1) | 0;
    c = (c + t) | 0;
    return ((t >>> 0) % 0x10000) / 0x10000;
  };
}

const range = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);

const COLS = 18;
const ROWS = 13;
const MAX_R = 6.5;
const MIN_R = 0.5;

// Smooth curve for opacity falloff
const smooth = (t: number) => Math.max(0, Math.min(1, t * t * (3 - 2 * t)));

// ─── Modulators ───────────────────────────────────────────────────────────
// Each modulator returns (r, opacity) for a grid cell. Inputs:
// - col, row (cell index), cols, rows (grid dims)
// - rng (already seeded — use for params at top of fn, NOT inside loop)
// Returns radius in [MIN_R, MAX_R] and opacity in [0,1].

type Modulator = (
  col: number,
  row: number,
  cols: number,
  rows: number,
  p: ModParams,
) => { r: number; o: number };
type ModParams = Record<string, number>;

function paramsFor(style: DotGridStyle, rng: () => number): ModParams {
  switch (style) {
    case "radial-bright":
    case "radial-dim":
      return { fx: range(rng, 0.2, 0.8), fy: range(rng, 0.2, 0.8) };
    case "wave-h":
      return { freq: range(rng, 1.5, 3.5), phase: rng() * Math.PI * 2 };
    case "wave-v":
      return { freq: range(rng, 1.2, 3), phase: rng() * Math.PI * 2 };
    case "wave-diagonal":
      return { freq: range(rng, 1.2, 2.8), phase: rng() * Math.PI * 2, angle: range(rng, -1, 1) };
    case "concentric":
      return { fx: range(rng, 0.3, 0.7), fy: range(rng, 0.3, 0.7), period: range(rng, 1.8, 3.2) };
    case "spotlight":
      return {
        fx: range(rng, 0.25, 0.75),
        fy: range(rng, 0.25, 0.75),
        tightness: range(rng, 0.18, 0.32),
      };
    case "corner":
      return { corner: Math.floor(rng() * 4) };
    case "cross":
      return {
        fx: range(rng, 0.4, 0.6),
        fy: range(rng, 0.4, 0.6),
        thickness: range(rng, 0.18, 0.32),
      };
    case "circle-silhouette":
      return {
        fx: range(rng, 0.4, 0.6),
        fy: range(rng, 0.4, 0.6),
        radius: range(rng, 0.3, 0.46),
        invert: rng() > 0.5 ? 1 : 0,
      };
    case "checkerboard":
      return { phase: rng() > 0.5 ? 1 : 0, scale: Math.floor(range(rng, 1, 3)) };
    case "bands-h":
      return { period: range(rng, 1.6, 3), phase: rng() * Math.PI * 2 };
    case "bands-v":
      return { period: range(rng, 1.6, 3), phase: rng() * Math.PI * 2 };
    case "spiral":
      return { fx: 0.5, fy: 0.5, twist: range(rng, 1.5, 4), direction: rng() > 0.5 ? 1 : -1 };
    case "hourglass":
      return { tightness: range(rng, 0.18, 0.32) };
    case "x-shape":
      return { thickness: range(rng, 0.1, 0.22) };
    default:
      return {};
  }
}

const MODULATORS: Record<DotGridStyle, Modulator> = {
  "radial-bright": (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = Math.hypot(u - p.fx, v - p.fy) / Math.SQRT2;
    const t = smooth(1 - d);
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.18 + t * 0.62 };
  },
  "radial-dim": (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = Math.hypot(u - p.fx, v - p.fy) / Math.SQRT2;
    const t = smooth(d);
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.2 + t * 0.55 };
  },
  "wave-h": (col, _row, cols, _rows, p) => {
    const u = col / (cols - 1);
    const t = 0.5 + 0.5 * Math.sin(u * p.freq * Math.PI * 2 + p.phase);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R), o: 0.3 + t * 0.45 };
  },
  "wave-v": (_col, row, _cols, rows, p) => {
    const v = row / (rows - 1);
    const t = 0.5 + 0.5 * Math.sin(v * p.freq * Math.PI * 2 + p.phase);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R), o: 0.3 + t * 0.45 };
  },
  "wave-diagonal": (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = u + v * (1 + p.angle * 0.5);
    const t = 0.5 + 0.5 * Math.sin(d * p.freq * Math.PI * 2 + p.phase);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R), o: 0.3 + t * 0.45 };
  },
  concentric: (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = Math.hypot(u - p.fx, v - p.fy) * 6;
    const t = 0.5 + 0.5 * Math.cos(d * p.period);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R), o: 0.25 + t * 0.55 };
  },
  spotlight: (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = Math.hypot(u - p.fx, v - p.fy);
    const t = Math.max(0, 1 - d / p.tightness);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R), o: 0.18 + t * 0.7 };
  },
  corner: (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const cx = p.corner === 1 || p.corner === 3 ? 1 : 0;
    const cy = p.corner >= 2 ? 1 : 0;
    const d = Math.hypot(u - cx, v - cy);
    const t = smooth(1 - d / 1.2);
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.18 + t * 0.65 };
  },
  cross: (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const dx = Math.abs(u - p.fx);
    const dy = Math.abs(v - p.fy);
    const inCross = dx < p.thickness || dy < p.thickness;
    if (!inCross) return { r: MIN_R * 0.6, o: 0.16 };
    const t = 1 - Math.min(dx, dy) / p.thickness;
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.45 + t * 0.45 };
  },
  "circle-silhouette": (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d = Math.hypot(u - p.fx, v - p.fy);
    const inside = d < p.radius;
    const t = smooth(Math.max(0, 1 - d / p.radius));
    const filled = p.invert ? !inside : inside;
    return filled
      ? { r: MIN_R + t * (MAX_R - MIN_R), o: 0.32 + t * 0.55 }
      : { r: MIN_R * 0.7, o: 0.15 };
  },
  checkerboard: (col, row, _cols, _rows, p) => {
    const block = (Math.floor(col / p.scale) + Math.floor(row / p.scale)) % 2;
    const lit = block === p.phase;
    return lit ? { r: MAX_R * 0.75, o: 0.62 } : { r: MIN_R * 0.7, o: 0.2 };
  },
  "bands-h": (_col, row, _cols, rows, p) => {
    const v = row / (rows - 1);
    const t = 0.5 + 0.5 * Math.sin(v * p.period * Math.PI * 2 + p.phase);
    return { r: MIN_R + t * (MAX_R - MIN_R) * 0.9, o: 0.28 + t * 0.5 };
  },
  "bands-v": (col, _row, cols, _rows, p) => {
    const u = col / (cols - 1);
    const t = 0.5 + 0.5 * Math.sin(u * p.period * Math.PI * 2 + p.phase);
    return { r: MIN_R + t * (MAX_R - MIN_R) * 0.9, o: 0.28 + t * 0.5 };
  },
  spiral: (col, row, cols, rows, p) => {
    const u = col / (cols - 1) - p.fx;
    const v = row / (rows - 1) - p.fy;
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u);
    const t = 0.5 + 0.5 * Math.sin(a * p.direction + r * p.twist * 8);
    const fade = smooth(1 - r / 0.7);
    return { r: MIN_R + smooth(t) * (MAX_R - MIN_R) * fade, o: 0.2 + t * 0.55 * fade };
  },
  hourglass: (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    // Distance to vertical center line, modulated by vertical position
    const widthAtY = p.tightness + Math.abs(v - 0.5) * 0.8;
    const dx = Math.abs(u - 0.5);
    const inside = dx < widthAtY;
    if (!inside) return { r: MIN_R * 0.6, o: 0.15 };
    const t = 1 - dx / widthAtY;
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.35 + t * 0.5 };
  },
  "x-shape": (col, row, cols, rows, p) => {
    const u = col / (cols - 1);
    const v = row / (rows - 1);
    const d1 = Math.abs((u + v) / 2 - 0.5);
    const d2 = Math.abs((u - v) / 2);
    const inX = d1 < p.thickness || d2 < p.thickness;
    if (!inX) return { r: MIN_R * 0.6, o: 0.16 };
    const t = 1 - Math.min(d1, d2) / p.thickness;
    return { r: MIN_R + t * (MAX_R - MIN_R), o: 0.4 + t * 0.5 };
  },
};

// ─── Public API ──────────────────────────────────────────────────────────

export function pickStyleForSlug(slug: string): DotGridStyle {
  const seed = djb2(slug || "untitled");
  return DOT_GRID_STYLES[seed % DOT_GRID_STYLES.length];
}

// Back-compat alias
export const pickVariantForSlug = pickStyleForSlug;

export function ProjectCover({
  slug,
  width = 320,
  height = 240,
  variant,
  htmlContent,
  ratio,
  className,
  style,
}: ProjectCoverProps) {
  // Live HTML preview path — only when content is non-trivial (avoid
  // showing an empty white box for projects that haven't generated yet).
  if (htmlContent && htmlContent.trim().length > 80) {
    return (
      <HtmlPreviewCover html={htmlContent} ratio={ratio} className={className} style={style} />
    );
  }

  // Fallback (no HTML yet) — generative dot-grid character (user
  // direction 2026-05-21: "Generative dot grid, formando sempre
  // personagens"). Deterministic from slug so each empty project keeps
  // the same silhouette until it generates real HTML. `variant` /
  // `width` / `height` props stay on the public type for back-compat
  // but the previous abstract-dot-grid algorithm + helpers (djb2 /
  // makeRng / DOT_GRID_STYLES / MODULATORS) are no longer rendered —
  // they remain in this module behind a `void` block in case we want
  // the old fallback back without rewriting the math.
  void variant;
  void width;
  void height;
  void slug;
  // Silence TS6133 on the dot-grid helpers we deliberately kept around.
  void makeRng;
  void COLS;
  void ROWS;
  void paramsFor;
  void MODULATORS;
  // User ask 2026-05-21: projects without HTML yet should show "um
  // html padrão com logo suave do design factory" instead of the
  // generative character (characters belong to Skills). Flat neutral
  // background + low-contrast Logo centred reads as "empty project,
  // ready to generate" rather than "this is a character".
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "var(--df-bg-section)",
        color: "var(--df-text-faint)",
        ...style,
      }}
    >
      <Logo size={48} style={{ opacity: 0.22 }} />
    </div>
  );
}

/**
 * HtmlPreviewCover — sandboxed iframe rendered at the project's native
 * aspect ratio, then contain-fit-scaled and centred so it sits letterboxed
 * inside the card. Previous version was hard-coded to 1280×720 (16:9), so
 * a 9:16 video preview rendered into a wide viewport and got squashed.
 */
export function HtmlPreviewCover({
  html,
  ratio = "16:9",
  className,
  style,
}: {
  html: string;
  ratio?: RatioId;
  className?: string;
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  // Lazy-mount the iframe only once the card scrolls into view. Rendering a
  // sandboxed iframe per project is the dominant cost on a full grid; with N
  // projects the browser was parsing+rendering N documents up front. Cap that
  // to roughly what's on screen. Once seen we keep it mounted (no churn).
  const [visible, setVisible] = useState(false);
  const wrappedHtml = useMemo(() => wrapHtmlForViewportFit(html), [html]);
  const viewport = VIEWPORT_BY_RATIO[ratio];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { vw: VW, vh: VH } = viewport;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      // Contain-fit: scale so the WHOLE iframe content fits inside the
      // card, preserving aspect. Letterbox the remaining space — better
      // than the previous cover-fit which cropped video covers.
      const sx = w / VW;
      const sy = h / VH;
      setScale(Math.min(sx, sy));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--df-surface-raised)",
        ...style,
      }}
    >
      {visible ? (
        <iframe
          srcDoc={wrappedHtml}
          sandbox=""
          scrolling="no"
          title=""
          aria-hidden="true"
          loading="lazy"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: viewport.vw,
            height: viewport.vh,
            border: "none",
            transformOrigin: "center center",
            transform: `translate(-50%, -50%) scale(${scale})`,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "var(--df-bg-section)",
          }}
        >
          <Logo size={40} style={{ opacity: 0.18 }} />
        </div>
      )}
      {/* Defense in depth: invisible overlay to swallow any iframe events. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
