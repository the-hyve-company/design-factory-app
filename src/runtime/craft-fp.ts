// craft-fp.ts — anti-false-positive hardening for the craft net (audit
// WS1 `fp-hardening-port`).
//
// The TECHNIQUE is ported from open-design's checker; the VALUES and the
// integration are Design Factory's own. Three moves:
//
//   1. TOKEN-BLOCK STRIP — custom-property DECLARATIONS (`--accent: …`)
//      are removed from the text the color checks scan. A design system
//      that codifies indigo on purpose (`--accent: #6366f1` in :root)
//      is a deliberate design decision, not the shadcn tell; the rule
//      text itself blesses it ("A var(--accent) that resolves to indigo
//      is fine — it's intentional", co-no-tailwind-indigo). Without the
//      strip, the check fires on every DS-driven artifact, drowns, and
//      gets turned off — the exact failure the audit predicted.
//
//   2. GLOBAL-THEME SCOPE — only custom properties declared in the
//      GLOBAL scope (:root / html / body / *) enter the resolution map.
//      Values declared inside alternate-theme scopes ([data-theme=…],
//      .dark/.light/.theme-*, @media prefers-color-scheme) describe a
//      theme that may never be active; resolving them into the default
//      render would manufacture false positives.
//
//   3. THEME-AWARE var() RESOLUTION — for checks where the EFFECTIVE
//      value matters regardless of indirection (pure #000/#fff, the
//      violet→blue AI gradient), var(--x) usages are substituted with
//      their global-theme values before scanning. A model that invents
//      `--bg: #000` and uses it everywhere doesn't get a pass just for
//      routing the harsh black through a token. Unresolvable vars stay
//      as-is (conservative: no finding beats a false finding — craft
//      decision #4 is "signal, never block on taste").
//
// Plus the DF-fed allowlist: colors extracted from the attached design
// system's markdown are exempt in every color check — if the DS codifies
// it, flagging it is noise. (Known trade-off: the extractor can't tell
// "use #0f0f0f" from "never use #000" in DS prose; over-allowlisting is
// the deliberate bias, matching warn-only semantics.)

export interface CraftFpContext {
  /** Artifact text with token declarations stripped, var() usages NOT
   *  resolved. Scanned by checks whose rule blesses token-mediated values
   *  (tailwind-indigo). */
  scanTextUnresolved: string;
  /** Artifact text with token declarations stripped AND var() usages
   *  resolved against the global-theme map. Scanned by checks where the
   *  effective value matters (raw black/white, AI gradient). */
  scanTextResolved: string;
  /** Lowercased color literals the attached design system codifies. */
  dsColors: ReadonlySet<string>;
}

export interface CraftFpOptions {
  designSystemMarkdown?: string | null;
}

/** Build the anti-FP scan context once per artifact. Pure — no I/O. */
export function buildCraftFpContext(html: string, opts: CraftFpOptions = {}): CraftFpContext {
  const globalVars = collectGlobalThemeVars(html);
  const stripped = stripTokenDeclarations(html);
  return {
    scanTextUnresolved: stripped,
    scanTextResolved: resolveCssVars(stripped, globalVars),
    dsColors: extractDsColors(opts.designSystemMarkdown ?? ""),
  };
}

/** Is a matched color literal codified by the attached DS? Accepts raw
 *  matches in any case / rgb() form; normalizes before lookup. */
export function isDsColor(match: string, dsColors: ReadonlySet<string>): boolean {
  if (dsColors.size === 0) return false;
  const norm = normalizeColor(match);
  return norm !== null && dsColors.has(norm);
}

// ─── Token declarations ──────────────────────────────────────────────────

/**
 * Remove every custom-property DECLARATION value from the text. Applies
 * anywhere a declaration appears (<style> blocks and inline style="…"
 * attributes alike) — a token definition is deliberate encoding wherever
 * it lives. Usages (`var(--x)`) are untouched.
 */
export function stripTokenDeclarations(text: string): string {
  return text.replace(/--[\w-]+\s*:\s*[^;}{"'<>]*/g, "--stripped:");
}

// ─── Global-theme var collection ─────────────────────────────────────────

const GLOBAL_SELECTOR = /^(?:\s*(?::root|html|body|\*|:host)\s*,?)+\s*$/i;
const THEME_MARKER =
  /\[data-theme|\[data-mode|\.dark\b|\.light\b|\.theme-|prefers-color-scheme|\[data-color-scheme/i;

/**
 * Walk every <style> block and collect custom-property declarations whose
 * selector stack is purely GLOBAL (:root/html/body/*) with no theme marker
 * anywhere in the stack (including @media wrappers).
 */
export function collectGlobalThemeVars(html: string): Map<string, string> {
  const vars = new Map<string, string>();
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRe.exec(html))) {
    collectFromCss(styleMatch[1], vars);
  }
  return vars;
}

function collectFromCss(css: string, vars: Map<string, string>): void {
  // Brace walker: track the selector stack; harvest declarations at leaf
  // level. Comments removed first so `/* } */` can't derail the depth.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const stack: string[] = [];
  let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      harvestDeclarations(buf, stack, vars);
      buf = "";
      stack.pop();
    } else {
      buf += ch;
    }
  }
}

function harvestDeclarations(block: string, stack: string[], vars: Map<string, string>): void {
  if (stack.length === 0) return;
  const leaf = stack[stack.length - 1] ?? "";
  const wrappers = stack.slice(0, -1);
  // Global = leaf selector is :root/html/body/* (possibly a list of them),
  // wrappers are only non-theme at-rules, nothing themed anywhere.
  const isGlobalLeaf = GLOBAL_SELECTOR.test(leaf);
  const themedAnywhere = stack.some((s) => THEME_MARKER.test(s));
  const nonAtWrapper = wrappers.some((s) => s.length > 0 && !s.startsWith("@"));
  if (!isGlobalLeaf || themedAnywhere || nonAtWrapper) return;
  const declRe = /--([\w-]+)\s*:\s*([^;}{]+)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(block))) {
    vars.set(`--${m[1]}`, m[2]!.trim());
  }
}

// ─── var() resolution ────────────────────────────────────────────────────

/**
 * Substitute `var(--x)` / `var(--x, fallback)` with the global-theme value.
 * Unknown vars fall back to the literal fallback when present, else stay
 * as-is. Bounded depth so `--a: var(--b); --b: var(--a)` can't spin.
 */
export function resolveCssVars(text: string, vars: Map<string, string>): string {
  let out = text;
  for (let depth = 0; depth < 8; depth++) {
    const next = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
      (whole, name: string, fallback: string | undefined) => {
        const v = vars.get(name);
        if (v !== undefined) return v;
        if (fallback !== undefined && fallback.trim().length > 0) return fallback.trim();
        return whole;
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

// ─── DS color allowlist ──────────────────────────────────────────────────

/** Pull color literals out of the attached design system's markdown. */
export function extractDsColors(markdown: string): ReadonlySet<string> {
  const out = new Set<string>();
  if (!markdown) return out;
  const hexRe = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(markdown))) {
    const norm = normalizeColor(m[0]);
    if (norm) out.add(norm);
  }
  const rgbRe = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)/gi;
  while ((m = rgbRe.exec(markdown))) {
    const norm = normalizeColor(m[0]);
    if (norm) out.add(norm);
  }
  return out;
}

/** Normalize a color literal to lowercase 6-digit hex (alpha dropped);
 *  returns null when the literal isn't a recognizable absolute color. */
export function normalizeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    if (h.length === 6 || h.length === 8) {
      return `#${h.slice(0, 6)}`;
    }
    return null;
  }
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgb) {
    const to2 = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n, 10)))
        .toString(16)
        .padStart(2, "0");
    return `#${to2(rgb[1]!)}${to2(rgb[2]!)}${to2(rgb[3]!)}`;
  }
  return null;
}
