import { type CSSProperties } from "react";

// Self-contained CSS shaders rendered inside the editorial verb cards
// (`VerbCard` in ChatMessage.tsx) and previewable / tweakable in the
// /shaders route. Every shader takes a params object with defaults that
// match the in-chat values exactly — pass props on the preview page to
// experiment, leave defaults to ship.

const baseStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 0,
};

// ── Scan (evaluate: review, check) ─────────────────────────────────────────
export interface ScanParams {
  color: string;
  gridSize: number;
  gridOpacity: number;
  scanThickness: number;
  scanSpeedMs: number;
  scanOpacity: number;
}
export const SCAN_DEFAULTS: ScanParams = {
  color: "rgba(107, 155, 209, 1)",
  gridSize: 14,
  gridOpacity: 0.1,
  scanThickness: 12,
  scanSpeedMs: 1900,
  scanOpacity: 0.95,
};
export function ShaderScan({ params = SCAN_DEFAULTS }: { params?: ScanParams }) {
  const { color, gridSize, gridOpacity, scanThickness, scanSpeedMs, scanOpacity } = params;
  // Convert color to alpha-modulated stops via color-mix
  const gridLine = `color-mix(in srgb, ${color} ${gridOpacity * 100}%, transparent)`;
  const lineMid = color;
  return (
    <div aria-hidden style={baseStyle}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          maskImage:
            "linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: scanThickness,
          background: `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${color} ${scanOpacity * 45}%, transparent) 45%, color-mix(in srgb, ${lineMid} ${scanOpacity * 100}%, transparent) 50%, color-mix(in srgb, ${color} ${scanOpacity * 45}%, transparent) 55%, transparent 100%)`,
          filter: "blur(0.4px)",
          animation: `df-shader-scan ${scanSpeedMs}ms linear infinite`,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

// ── Polish (refine: polish, simplify, reinforce) ───────────────────────────
export interface PolishParams {
  color1: string;
  color2: string;
  conicSpeedAMs: number;
  conicSpeedBMs: number;
  sheenSpeedMs: number;
  intensity: number;
  blurPx: number;
}
export const POLISH_DEFAULTS: PolishParams = {
  color1: "rgba(199, 149, 90, 1)",
  color2: "rgba(212, 180, 140, 1)",
  conicSpeedAMs: 6500,
  conicSpeedBMs: 9000,
  sheenSpeedMs: 2400,
  intensity: 1,
  blurPx: 8,
};
export function ShaderPolish({ params = POLISH_DEFAULTS }: { params?: PolishParams }) {
  const { color1, color2, conicSpeedAMs, conicSpeedBMs, sheenSpeedMs, intensity, blurPx } = params;
  const a25 = `color-mix(in srgb, ${color1} ${intensity * 25}%, transparent)`;
  const a20 = `color-mix(in srgb, ${color2} ${intensity * 20}%, transparent)`;
  const a18 = `color-mix(in srgb, ${color2} ${intensity * 18}%, transparent)`;
  const transparent1 = `color-mix(in srgb, ${color1} 0%, transparent)`;
  const transparent2 = `color-mix(in srgb, ${color2} 0%, transparent)`;
  return (
    <div aria-hidden style={{ ...baseStyle, mixBlendMode: "screen", opacity: 0.95 }}>
      <div
        style={{
          position: "absolute",
          inset: "-30%",
          background: `conic-gradient(from 0deg at 30% 50%, ${a25}, ${transparent1} 25%, ${a20} 50%, ${transparent1} 75%, ${a25} 100%)`,
          animation: `df-shader-conic-a ${conicSpeedAMs}ms linear infinite`,
          filter: `blur(${blurPx}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-30%",
          background: `conic-gradient(from 180deg at 70% 50%, ${transparent2}, ${a18} 20%, ${transparent1} 40%, ${a18} 60%, ${transparent1} 80%, ${transparent2} 100%)`,
          animation: `df-shader-conic-b ${conicSpeedBMs}ms linear infinite`,
          filter: `blur(${Math.max(2, blurPx - 2)}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(105deg, transparent 0%, transparent 35%, color-mix(in srgb, ${color2} ${intensity * 18}%, transparent) 50%, transparent 65%, transparent 100%)`,
          backgroundSize: "260% 100%",
          animation: `df-verb-shimmer ${sheenSpeedMs}ms linear infinite`,
        }}
      />
    </div>
  );
}

// ── Aurora (direction: bolder, calmer, charm) ──────────────────────────────
export interface AuroraParams {
  color1: string;
  color2: string;
  color3: string;
  speedAMs: number;
  speedBMs: number;
  speedCMs: number;
  blurPx: number;
  opacity: number;
}
export const AURORA_DEFAULTS: AuroraParams = {
  color1: "rgba(215, 122, 90, 1)",
  color2: "rgba(207, 130, 168, 1)",
  color3: "rgba(155, 125, 199, 1)",
  speedAMs: 5200,
  speedBMs: 6400,
  speedCMs: 7100,
  blurPx: 20,
  opacity: 0.85,
};
export function ShaderAurora({ params = AURORA_DEFAULTS }: { params?: AuroraParams }) {
  const { color1, color2, color3, speedAMs, speedBMs, speedCMs, blurPx, opacity } = params;
  const blob = (color: string, alpha: number) =>
    `radial-gradient(ellipse at 50% 50%, color-mix(in srgb, ${color} ${alpha * 100}%, transparent) 0%, color-mix(in srgb, ${color} 0%, transparent) 65%)`;
  return (
    <div aria-hidden style={{ ...baseStyle, mixBlendMode: "screen", opacity }}>
      <div
        style={{
          position: "absolute",
          width: "60%",
          height: "240%",
          left: "-15%",
          top: "-70%",
          background: blob(color1, 0.55),
          filter: `blur(${blurPx - 2}px)`,
          animation: `df-shader-aurora-a ${speedAMs}ms ease-in-out infinite`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: "55%",
          height: "240%",
          left: "30%",
          top: "-60%",
          background: blob(color2, 0.5),
          filter: `blur(${blurPx}px)`,
          animation: `df-shader-aurora-b ${speedBMs}ms ease-in-out infinite`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: "55%",
          height: "240%",
          left: "55%",
          top: "-65%",
          background: blob(color3, 0.45),
          filter: `blur(${blurPx + 2}px)`,
          animation: `df-shader-aurora-c ${speedCMs}ms ease-in-out infinite`,
        }}
      />
    </div>
  );
}

// ── Sparkle (enhance: animate, type, color, rewrite) ───────────────────────
export interface SparkleParams {
  color: string;
  count: number;
  size: number;
  minSpeedMs: number;
  maxSpeedMs: number;
  scaleMax: number;
}
export const SPARKLE_DEFAULTS: SparkleParams = {
  color: "rgba(155, 125, 199, 1)",
  count: 12,
  size: 4,
  minSpeedMs: 1100,
  maxSpeedMs: 2100,
  scaleMax: 1.4,
};
// Deterministic pseudo-random distribution so we don't shift every render
function dotPositions(count: number) {
  const dots: { x: number; y: number; d: number; delay: number }[] = [];
  // Halton sequence (base 2 / base 3) for a low-discrepancy spread
  for (let i = 1; i <= count; i++) {
    let f = 1,
      x = 0;
    let n = i;
    while (n > 0) {
      f /= 2;
      x += f * (n % 2);
      n = Math.floor(n / 2);
    }
    let g = 1,
      y = 0;
    let m = i;
    while (m > 0) {
      g /= 3;
      y += g * (m % 3);
      m = Math.floor(m / 3);
    }
    dots.push({ x: x * 96 + 2, y: y * 88 + 6, d: 0, delay: 0 });
  }
  return dots;
}
export function ShaderSparkle({ params = SPARKLE_DEFAULTS }: { params?: SparkleParams }) {
  const { color, count, size, minSpeedMs, maxSpeedMs, scaleMax } = params;
  const positions = dotPositions(count);
  const span = maxSpeedMs - minSpeedMs;
  return (
    <div aria-hidden style={{ ...baseStyle, mixBlendMode: "screen" }}>
      {positions.map((p, i) => {
        const speed = minSpeedMs + ((i * 197) % Math.max(1, span));
        const delay = (i * 137) % 1000;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: size,
              height: size,
              borderRadius: "50%",
              background: `radial-gradient(circle, color-mix(in srgb, ${color} 100%, white 25%) 0%, color-mix(in srgb, ${color} 50%, transparent) 45%, transparent 100%)`,
              transform: "translate(-50%, -50%)",
              // @ts-expect-error CSS custom prop for keyframe
              "--df-spark-scale": scaleMax,
              animation: `df-shader-sparkle ${speed}ms ease-in-out ${delay}ms infinite`,
              opacity: 0,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Glitch (fix: reserved) ─────────────────────────────────────────────────
export interface GlitchParams {
  noiseOpacity: number;
  noiseSpeedMs: number;
  trackColor: string;
  trackSpeedMs: number;
}
export const GLITCH_DEFAULTS: GlitchParams = {
  noiseOpacity: 0.5,
  noiseSpeedMs: 220,
  trackColor: "rgba(215, 122, 90, 1)",
  trackSpeedMs: 2400,
};
export function ShaderGlitch({ params = GLITCH_DEFAULTS }: { params?: GlitchParams }) {
  const { noiseOpacity, noiseSpeedMs, trackColor, trackSpeedMs } = params;
  return (
    <div aria-hidden style={baseStyle}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          opacity: noiseOpacity,
          mixBlendMode: "screen",
          animation: `df-shader-glitch-noise ${noiseSpeedMs}ms steps(3, end) infinite`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${trackColor} 55%, transparent), rgba(255,255,255,0.55), color-mix(in srgb, ${trackColor} 55%, transparent), transparent)`,
          filter: "blur(0.5px)",
          animation: `df-shader-glitch-track ${trackSpeedMs}ms linear infinite`,
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

// ── Dispatch by category — drop-in for VerbCard ────────────────────────────
export type VerbCategory = "evaluate" | "refine" | "direction" | "enhance" | "fix" | "export";
export function VerbShader({ category }: { category: VerbCategory }) {
  switch (category) {
    case "evaluate":
      return <ShaderScan />;
    case "refine":
      return <ShaderPolish />;
    case "direction":
      return <ShaderAurora />;
    case "enhance":
      return <ShaderSparkle />;
    case "fix":
      return <ShaderGlitch />;
    // Export reuses the polish shader's calm geometry — render is a
    // terminal action, not a creative one. Keeps the visual language
    // consistent and avoids inventing a new shader for a single verb.
    case "export":
      return <ShaderPolish />;
    default:
      return <ShaderPolish />;
  }
}
