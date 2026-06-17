import { useId, type CSSProperties } from "react";

export type DfLoaderRelation =
  | "stream" // lr02 lemniscate — 3 dots trace a figure-8, crossing at pinch
  | "heartbeat" // lr01 encounter — two dots pass through, center bulges at convergence
  | "triad" // lr05 knot — 3 overlapping orbits weave through each other
  | "bloom" // lr04 coalesce — triangle vertices fall to center, merge, spring back
  | "cascade" // lr03 pendulum — 3 dots on shared pivot, staggered swing
  | "morse"; // lr06 chase — 3 dots on shared circle, variable-speed bunch-spread

export interface DfLoaderProps {
  relation?: DfLoaderRelation;
  /** Outer box size in px. Default 180. */
  size?: number;
  /** Optional color override (default uses currentColor). */
  color?: string;
  /** ARIA label — announced by screen readers. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Canonical HYVE loader — 3 dots through a goo filter, relation-specific
 * choreography. Deprecates Loader244 and the generic spinner from the
 * v0.1 DS.
 *
 * The gooey blob effect comes entirely from the SVG filter (stdDeviation 6 +
 * color-matrix with alpha 18 threshold -7). Circles themselves don't morph;
 * deformation is pixel-level from filter overlap.
 */
export function DfLoader({
  relation = "bloom",
  size = 180,
  color,
  label = "Loading",
  className,
  style,
}: DfLoaderProps) {
  const gooId = useId().replace(/:/g, "-") + "-goo";

  return (
    <span
      role="status"
      aria-label={label}
      className={["df-loader", `df-loader--${relation}`, className].filter(Boolean).join(" ")}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        color: color ?? "currentColor",
        ...style,
      }}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        <defs>
          <filter id={gooId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
            <feColorMatrix values="1 0 0 0 0   0 1 0 0 0   0 0 1 0 0   0 0 0 18 -7" />
          </filter>
        </defs>
        <g className="g" style={{ filter: `url(#${gooId})` }}>
          {renderRelation(relation)}
        </g>
      </svg>
    </span>
  );
}

/**
 * Each relation renders 3 `<circle>` elements with relation-specific classes.
 * CSS keyframes live in components.css (.df-loader--{relation}) and animate
 * the transform of each circle. Filter blends them via goo.
 */
function renderRelation(relation: DfLoaderRelation) {
  const fill = "currentColor";
  const R = 14;
  switch (relation) {
    case "heartbeat":
      // lr01 encounter — .a + .b translate, .c pulses
      return (
        <>
          <circle className="df-lr-a" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-b" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-c" cx="100" cy="100" r={R} fill={fill} />
        </>
      );
    case "stream":
      // lr02 lemniscate — 3 circles on a figure-8 offset-path
      return (
        <>
          <circle className="df-lr-s" cx="0" cy="0" r={R} fill={fill} />
          <circle
            className="df-lr-s"
            cx="0"
            cy="0"
            r={R}
            fill={fill}
            style={{ animationDelay: "-1067ms" }}
          />
          <circle
            className="df-lr-s"
            cx="0"
            cy="0"
            r={R}
            fill={fill}
            style={{ animationDelay: "-2133ms" }}
          />
        </>
      );
    case "cascade":
      // lr03 pendulum — 3 swinging from same pivot, staggered
      return (
        <>
          <circle className="df-lr-pn df-lr-pn1" cx="100" cy="155" r={R} fill={fill} />
          <circle className="df-lr-pn df-lr-pn2" cx="100" cy="155" r={R} fill={fill} />
          <circle className="df-lr-pn df-lr-pn3" cx="100" cy="155" r={R} fill={fill} />
        </>
      );
    case "bloom":
      // lr04 coalesce — triangle vertices fall to center, merge, spring out
      return (
        <>
          <circle className="df-lr-m df-lr-m1" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-m df-lr-m2" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-m df-lr-m3" cx="100" cy="100" r={R} fill={fill} />
        </>
      );
    case "triad":
      // lr05 knot — 3 overlapping orbits
      return (
        <>
          <circle className="df-lr-k df-lr-k1" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-k df-lr-k2" cx="100" cy="100" r={R} fill={fill} />
          <circle className="df-lr-k df-lr-k3" cx="100" cy="100" r={R} fill={fill} />
        </>
      );
    case "morse":
      // lr06 chase — 3 on shared circle, variable speed
      return (
        <>
          <circle className="df-lr-ch df-lr-ch1" cx="100" cy="30" r={R} fill={fill} />
          <circle className="df-lr-ch df-lr-ch2" cx="100" cy="30" r={R} fill={fill} />
          <circle className="df-lr-ch df-lr-ch3" cx="100" cy="30" r={R} fill={fill} />
        </>
      );
  }
}
