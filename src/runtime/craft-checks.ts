// craft-checks.ts — deterministic post-generation craft net ("static-p0"
// for taste, decision #3/#4 of the craft-enforcement plan).
//
// WHY a sibling of static-p0.ts and not part of it: static-p0 is the HARD
// syntactic gate — a fail blocks the artifact / triggers a retry. Craft
// tells are NOT hard failures: a violet gradient or an emoji icon is still
// valid HTML. So this module SIGNALS (status "warn") and never blocks — the
// result rides along in the DoneReport and the UI offers a fix. It is the
// provider-agnostic stand-in for the Claude-Code-only Designer hooks: the
// same "outside the model" enforcement, run in the product instead of the
// harness, so all 10 providers get it.
//
// Scope: HIGH-CONFIDENCE grep checks only (low false-positive). Anything
// that needs the rendered DOM (contrast ratios, line measure in ch, OKLCH
// chroma budget, type/space scale adherence) is DEFERRED to a future
// runtime probe and listed in DEFERRED_CHECKS — never silently dropped.
//
// Each check maps to a `checkable: true` rule id in rules-taxonomy.ts so the
// UI can show the offending rule's ✗/✓ guidance and target an auto-fix.

export type CraftTier = "P0" | "P1" | "P2";

export interface CraftFinding {
  /** Rule id in rules-taxonomy.ts (the rule this tell violates). */
  ruleId: string;
  /** Severity carried from the rule. P0 first in the UI. */
  tier: CraftTier;
  /** Short human label (the rule title). */
  title: string;
  /** What was found + the concrete move, one line. */
  detail: string;
  /** A short snippet of the offending source (truncated), when useful. */
  sample?: string;
}

export type CraftCheckStatus = "clean" | "warn";

export interface CraftCheckResult {
  status: CraftCheckStatus;
  /** One entry per tell detected (deduped by rule). P0→P1→P2 order. */
  findings: CraftFinding[];
  /** Ids of the checks that actually ran (HTML artifact present). */
  checked: string[];
  /** Checks deferred to a runtime probe (need the rendered DOM). Surfaced
   *  so "0 findings" never reads as "fully audited". */
  deferred: string[];
}

export interface CraftCheckInput {
  content: string;
  /** Artifact type (`html`, `markdown`, `svg`, ...). Craft checks only run
   *  on HTML-ish artifacts. */
  type: string;
}

// ─── Check registry ───────────────────────────────────────────────────

interface CraftCheck {
  id: string;
  ruleId: string;
  tier: CraftTier;
  title: string;
  /** Returns a finding body when the tell is present, else null. Pure;
   *  operates on the raw artifact source (CSS lives inline in <style>). */
  run(html: string): { detail: string; sample?: string } | null;
}

/** Truncate a matched snippet for display. */
function snip(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

/** Default Tailwind indigo/violet ramp — the shadcn/AI-default tell. */
const TAILWIND_INDIGO =
  /#(?:6366f1|4f46e5|818cf8|a5b4fc|4338ca|3730a3|312e81|7c3aed|8b5cf6|6d28d9|a78bfa|c4b5fd)\b/i;

/** Violet/indigo + blue/cyan/pink hexes & names — the "AI gradient" combo. */
const AI_PURPLE = /(violet|indigo|purple|#6366f1|#4f46e5|#8b5cf6|#7c3aed|#a78bfa)/i;
const AI_COOL =
  /(\bblue\b|cyan|sky|teal|\bpink\b|fuchsia|#3b82f6|#2563eb|#06b6d4|#0ea5e9|#ec4899|#db2777|#f472b6)/i;

/** Curated decorative-emoji set (icons/bullets), not every glyph. */
const DECORATIVE_EMOJI = "🚀⚡✨🔥🎯💡🎉👍✅❌💪🌟⭐🌈💫🙌👏📈📉🔒🔑🎨🧠💎🚨🔧⏱️🤖";
const EMOJI_RE = new RegExp(
  `(?:${Array.from(DECORATIVE_EMOJI)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})`,
  "gu",
);

function countMatches(html: string, re: RegExp): number {
  const m = html.match(re);
  return m ? m.length : 0;
}

/** Pull each `...-gradient(...)` argument list out of the source. */
function gradients(html: string): string[] {
  const out: string[] = [];
  const re = /(?:linear|radial|conic)-gradient\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // walk to the matching close paren
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < html.length; i++) {
      if (html[i] === "(") depth++;
      else if (html[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(html.slice(m.index, i + 1));
  }
  return out;
}

const CHECKS: CraftCheck[] = [
  {
    id: "raw-black-white",
    ruleId: "co-no-raw-black",
    tier: "P0",
    title: "No pure black or white",
    run(html) {
      const m =
        html.match(/#(?:000|000000|fff|ffffff)(?![0-9a-f])/i) ||
        html.match(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i);
      return m
        ? {
            detail:
              "Pure #000/#fff is harsh — use a near-black/near-white (e.g. #0f0f0f / #f0f0f0).",
            sample: snip(m[0]),
          }
        : null;
    },
  },
  {
    id: "tailwind-indigo",
    ruleId: "co-no-tailwind-indigo",
    tier: "P0",
    title: "No default Tailwind indigo",
    run(html) {
      const m = html.match(TAILWIND_INDIGO);
      return m
        ? {
            detail: "The default indigo/violet ramp is the shadcn tell — pick a real accent hue.",
            sample: snip(m[0]),
          }
        : null;
    },
  },
  {
    id: "ai-gradient",
    ruleId: "as-no-generic-ai-gradient",
    tier: "P0",
    title: "No generic AI gradient",
    run(html) {
      const hit = gradients(html).find(
        (g) => /linear-gradient/i.test(g) && AI_PURPLE.test(g) && AI_COOL.test(g),
      );
      return hit
        ? {
            detail:
              "Two-stop violet→blue gradient reads as AI default — use a flat surface or a same-family ramp.",
            sample: snip(hit),
          }
        : null;
    },
  },
  {
    id: "gradient-text",
    ruleId: "as-no-gradient-text",
    tier: "P0",
    title: "No gradient-filled headline text",
    run(html) {
      const m = html.match(/(?:-webkit-)?background-clip:\s*text/i);
      return m && /-gradient\(/i.test(html)
        ? {
            detail:
              "Gradient-clipped text is a tell — use a solid token color; size + weight carry it.",
            sample: snip(m[0]),
          }
        : null;
    },
  },
  {
    id: "decorative-emoji",
    ruleId: "as-no-decorative-emojis",
    tier: "P0",
    title: "No emojis as icons",
    run(html) {
      const found = html.match(EMOJI_RE);
      if (!found) return null;
      const distinct = Array.from(new Set(found));
      return {
        detail: "Emoji icons/bullets read as a template — use one monoline SVG set, currentColor.",
        sample: distinct.slice(0, 8).join(" "),
      };
    },
  },
  {
    id: "default-fonts",
    ruleId: "ty-no-default-fonts",
    tier: "P1",
    title: "No default system fonts",
    run(html) {
      const m = html.match(
        /font-family:\s*["']?(Inter|Roboto|Arial|Helvetica(?:\s+Neue)?|Open Sans|Montserrat|Lato|Poppins|Nunito|Raleway|Times(?:\s+New\s+Roman)?)\b/i,
      );
      return m
        ? {
            detail:
              "Inter/Roboto/Arial as the primary face is a default tell — pick a face with a point of view.",
            sample: snip(m[1]),
          }
        : null;
    },
  },
  {
    id: "punctuation-tell",
    ruleId: "cp-no-em-dash-tell",
    tier: "P1",
    title: "Cut the AI punctuation tells",
    run(html) {
      // strip <style>/<script> so CSS values / code don't false-positive
      const text = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
      const m = text.match(/[—…]/);
      return m
        ? {
            detail:
              "Em-dash (—) / ellipsis (…) in copy are AI punctuation tells — rewrite with periods or commas.",
            sample: m[0],
          }
        : null;
    },
  },
  {
    id: "transition-all",
    ruleId: "mo-no-transition-all",
    tier: "P1",
    title: "Never `transition: all`",
    run(html) {
      const m = html.match(/transition(?:-property)?:\s*all\b/i);
      return m
        ? {
            detail:
              "`transition: all` animates layout props and thrashes — name the exact properties.",
            sample: snip(m[0]),
          }
        : null;
    },
  },
  {
    id: "animate-layout-props",
    ruleId: "mo-gpu-only-props",
    tier: "P0",
    title: "Animate only compositor props",
    run(html) {
      const m = html.match(
        /transition(?:-property)?:\s*[^;}{]*\b(width|height|top|left|right|bottom|margin|padding)\b/i,
      );
      return m
        ? {
            detail: "Animating layout props jank — move to transform/opacity (compositor-only).",
            sample: snip(m[0]),
          }
        : null;
    },
  },
  {
    id: "reduced-motion-missing",
    ruleId: "mo-honor-reduced-motion",
    tier: "P0",
    title: "Honor reduced motion",
    run(html) {
      const animates = /@keyframes|animation:\s*[^;]*\d|transition:\s*[^;]*\b\d/i.test(html);
      if (!animates) return null;
      return /prefers-reduced-motion/i.test(html)
        ? null
        : {
            detail:
              "There's animation but no `@media (prefers-reduced-motion: reduce)` — add a reduced fallback.",
          };
    },
  },
  {
    id: "will-change-all",
    ruleId: "mo-will-change-sparingly",
    tier: "P2",
    title: "`will-change` with restraint",
    run(html) {
      const m = html.match(/will-change:\s*all\b/i);
      if (m)
        return {
          detail: "`will-change: all` forces layers on everything — name 1-2 props, or drop it.",
          sample: snip(m[0]),
        };
      return countMatches(html, /will-change:/gi) >= 4
        ? { detail: "`will-change` used broadly — reserve it for elements about to animate." }
        : null;
    },
  },
  {
    id: "glassmorphism-overuse",
    ruleId: "as-no-default-glassmorphism",
    tier: "P1",
    title: "No default glassmorphism",
    run(html) {
      const n = countMatches(html, /backdrop-filter:\s*blur/gi);
      return n >= 3
        ? {
            detail: `Frosted glass on ${n} surfaces is the default look — keep glass to 1-2 semantic surfaces.`,
          }
        : null;
    },
  },
  {
    id: "aurora-bg",
    ruleId: "as-no-aurora-bg",
    tier: "P1",
    title: "No aurora / mesh / blob background",
    run(html) {
      const n = countMatches(html, /radial-gradient/gi);
      return n >= 3
        ? {
            detail: `${n} radial-gradients read as an aurora/mesh backdrop — use a solid surface; tension from layout.`,
          }
        : null;
    },
  },
  {
    id: "html-lang-missing",
    ruleId: "a11y-html-lang",
    tier: "P1",
    title: "Declare the language",
    run(html) {
      if (!/<html\b/i.test(html)) return null;
      return /<html\b(?![^>]*\blang=)/i.test(html)
        ? {
            detail:
              '`<html>` has no `lang` — add e.g. `lang="en"` so screen readers pick the right voice.',
          }
        : null;
    },
  },
  {
    id: "img-alt-missing",
    ruleId: "a11y-alt-text",
    tier: "P1",
    title: "Text alternatives",
    run(html) {
      const imgs = html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi);
      return imgs
        ? {
            detail: `${imgs.length} <img> without alt — add alt text (alt="" if purely decorative).`,
            sample: snip(imgs[0]),
          }
        : null;
    },
  },
  {
    id: "focus-outline-removed",
    ruleId: "a11y-focus-visible",
    tier: "P0",
    title: "Keep focus visible",
    run(html) {
      const m = html.match(/outline:\s*(?:none|0)\b/i);
      if (!m) return null;
      return /:focus-visible/i.test(html)
        ? null
        : {
            detail:
              "`outline: none` without a `:focus-visible` style strands keyboard users — restore a focus ring.",
            sample: snip(m[0]),
          };
    },
  },
];

// Checks that need the rendered DOM (computed color, geometry, font
// metrics) and so cannot be done by grep without high false-positives.
// Listed so a clean result is never mistaken for a full audit.
export const DEFERRED_CHECKS: ReadonlyArray<{ ruleId: string; why: string }> = Object.freeze([
  { ruleId: "a11y-contrast-aa", why: "needs computed fg/bg contrast (axe/Lighthouse)" },
  { ruleId: "ty-comfortable-measure", why: "needs rendered line width in ch" },
  { ruleId: "co-oklch", why: "needs color-space + chroma analysis" },
  { ruleId: "ty-limited-type-scale", why: "needs the full set of rendered font-sizes" },
  { ruleId: "de-shadow-blur-ratio", why: "needs parsed box-shadow blur vs offset" },
  { ruleId: "a11y-target-size", why: "needs rendered hit-area geometry" },
]);

function isHtmlArtifact(input: CraftCheckInput): boolean {
  if (input.type === "html") return true;
  if (input.type && input.type !== "html") return false;
  return /<(?:!doctype html|html[\s>])/i.test(input.content);
}

const TIER_ORDER: Record<CraftTier, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * Run the deterministic craft net over an artifact. Pure — no I/O. Returns
 * `warn` with one finding per tell detected, or `clean`. Only HTML
 * artifacts are inspected; everything else returns clean (still listing the
 * deferred checks so the caller knows what wasn't covered).
 */
export function runCraftChecks(input: CraftCheckInput): CraftCheckResult {
  const deferred = DEFERRED_CHECKS.map((d) => d.ruleId);
  if (!isHtmlArtifact(input)) {
    return { status: "clean", findings: [], checked: [], deferred };
  }
  const findings: CraftFinding[] = [];
  const checked: string[] = [];
  for (const check of CHECKS) {
    checked.push(check.id);
    const hit = check.run(input.content);
    if (hit) {
      findings.push({
        ruleId: check.ruleId,
        tier: check.tier,
        title: check.title,
        detail: hit.detail,
        sample: hit.sample,
      });
    }
  }
  findings.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return {
    status: findings.length > 0 ? "warn" : "clean",
    findings,
    checked,
    deferred,
  };
}

/** One-line summary for the DoneReport ("⚑ 3 craft tells: 2×P0, 1×P1"). */
export function summarizeCraftChecks(result: CraftCheckResult): string {
  if (result.status === "clean") return "✓ no craft tells";
  const byTier = { P0: 0, P1: 0, P2: 0 };
  for (const f of result.findings) byTier[f.tier]++;
  const parts = (["P0", "P1", "P2"] as CraftTier[])
    .filter((t) => byTier[t] > 0)
    .map((t) => `${byTier[t]}×${t}`);
  return `⚑ ${result.findings.length} craft tell${result.findings.length === 1 ? "" : "s"} (${parts.join(", ")})`;
}
