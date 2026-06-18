// SkeuHero — canonical skeumorphic hero pattern.
//
// The reusable abstraction of the HeroV1 anatomy that lives in
// NewProjectRegionsLabScreen (lab route, preserved untouched) and was
// cloned into NewProjectFormSkeu as `cnp-hero`. This component is the
// single source of truth for the DNA all premium skeu surfaces share.
//
// Anatomy (canonical, do NOT vary):
//   · Surface — flat raised material (--df-bg-section), bezel inset
//     highlight on top + 1px border ring (no radial gradient — radial
//     belongs to the bigger console-face `home-hero` plate, not the
//     compact pattern). Radius = --df-r-xl (12px) to match Aqua tabs.
//   · Background grain — ASCII dot constellation (mono · · · ·) at low
//     opacity. NOT a CSS dot pattern; literal pre-text so the texture
//     reads handcrafted, like a console screen-print, not generated.
//   · Brand mark — Logo absolute top-right at opacity 0.55. Reads as
//     a corner stamp/decal on a faceplate.
//   · Copy block — flush bottom-left:
//       · Kicker — mono uppercase, 9px, tracking 0.18em, --df-text-muted.
//       · Title — display 22px (md) or scaled by size variant.
//   · Optional CTA slot — sits inside hero, next to copy or below.
//
// Sizes:
//   · sm — 80px tall, title 16px. Card/sub-zone usage.
//   · md — 118px tall, title 22px. Default — page sections, modal panels.
//   · lg — 200px+ tall, title clamp(34, 5vw, 48). Marquee/landing.
//
// All variants honor `prefers-reduced-motion`. No animation by default —
// this is a static structural pattern. Animated lifts (LED pulse, sheen)
// belong to wrapper plates like `home-hero` console face.

import { type ReactNode } from "react";
import { Logo } from "@/components/Logo";

export interface SkeuHeroProps {
  /** Eyebrow above the title (mono uppercase). */
  kicker?: string;
  /** Hero title. */
  title: string;
  /**
   * Size variant — controls height + title scale.
   * sm = 80px / 16px, md = 118px / 22px, lg = 200px+ / clamp(34,5vw,48).
   */
  size?: "sm" | "md" | "lg";
  /**
   * Show ASCII dot grain background. Default true. The grain IS the
   * canonical DNA — disable only when the surrounding container already
   * provides equivalent texture (e.g. modal stage with bezel pattern).
   */
  showAscii?: boolean;
  /**
   * Show Logo decal in the top-right corner at opacity 0.55. Default true.
   * Disable in nested usage where the chrome already shows the logo.
   */
  showMark?: boolean;
  /** Optional CTA slot rendered after the copy. Use for primary action. */
  cta?: ReactNode;
  /**
   * Layout for the CTA slot:
   *  · "inline" — CTA sits to the right of copy (default for sm/md).
   *  · "stacked" — CTA sits below the copy, centered (lg marquee usage).
   *  · "left-right" — copy block JUSTIFIED LEFT, CTA flushed RIGHT, both
   *    vertically centered. Use for wide horizontal heroes ( * Projects feed-aligned hero). Optional `decoration` slot lives at
   *    the far left for an oversized brand mark or kicker emblem.
   */
  ctaLayout?: "inline" | "stacked" | "left-right";
  /**
   * Optional decoration slot rendered to the LEFT of the copy block in
   * the "left-right" layout (e.g. an oversized Logo at low opacity).
   * Ignored for other layouts. — Projects hero brand-mark left zone.
   */
  decoration?: ReactNode;
  /** Optional className passthrough for layout. */
  className?: string;
  /** Aria label for the section landmark. Defaults to a slug of the title. */
  ariaLabelledBy?: string;
}

/**
 * The canonical skeumorphic hero pattern. See file header for anatomy.
 *
 * Width is controlled by the parent container — SkeuHero fills 100% and
 * never sets its own max-width. Wrappers like .home-hero apply width.
 */
export function SkeuHero({
  kicker,
  title,
  size = "md",
  showAscii = true,
  showMark = true,
  cta,
  ctaLayout,
  decoration,
  className = "",
  ariaLabelledBy,
}: SkeuHeroProps) {
  const titleId = ariaLabelledBy ?? `skeu-hero-${title.replace(/\s+/g, "-").toLowerCase()}`;
  // Default CTA layout: stacked for lg, inline for sm/md.
  const layout = ctaLayout ?? (size === "lg" ? "stacked" : "inline");
  const logoSize = size === "lg" ? 32 : size === "sm" ? 20 : 26;

  // ASCII dot constellation — handcrafted texture. Lines kept dense
  // enough to fill any reasonable hero height without visible repeat.
  const ascii = "· · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·\n".repeat(8);

  return (
    <section
      className={`skeu-hero skeu-hero--${size} skeu-hero--cta-${layout} ${className}`.trim()}
      aria-labelledby={titleId}
    >
      {showAscii && (
        <pre className="skeu-hero-ascii" aria-hidden="true">
          {ascii}
        </pre>
      )}

      {/* Corner mark intentionally suppressed when layout="left-right"
       * because the brand presence is delegated to the `decoration`
       * slot on the left. Avoids redundant logo stamping. */}
      {showMark && layout !== "left-right" && <Logo size={logoSize} className="skeu-hero-mark" />}

      {layout === "left-right" && decoration && (
        <div className="skeu-hero-decoration" aria-hidden="true">
          {decoration}
        </div>
      )}

      <div className="skeu-hero-copy">
        {kicker && <div className="skeu-hero-kicker">{kicker}</div>}
        <h2 id={titleId} className="skeu-hero-title">
          {title}
        </h2>
      </div>

      {cta && <div className="skeu-hero-cta-slot">{cta}</div>}
    </section>
  );
}
