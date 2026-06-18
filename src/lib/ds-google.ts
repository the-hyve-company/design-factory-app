// Browser-friendly parser for the @google/design.md format.
//
// We *cannot* import @google/design.md/linter at runtime because it bundles
// node:module/path/fs — Vite refuses to ship that to the browser. Instead
// we parse the frontmatter with js-yaml (small, browser-safe) and normalize
// the resulting shape into the same UI contract the preview renders against.
//
// Validation + WCAG + lint findings can come later (bridge-side or CLI). The
// priority is that the DS preview screen shows real colors, typography, and
// tokens from the user's actual design.md files.

import yaml from "js-yaml";

export interface DsColorEntry {
  name: string;
  hex: string;
  luminance: number;
}

export interface DsTypographyEntry {
  name: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface DsDimensionEntry {
  name: string;
  value: string;
  raw: { value: number; unit: string };
}

export interface DsComponentEntry {
  name: string;
  properties: Array<{ key: string; value: string }>;
  unresolvedRefs: string[];
}

export interface DsSection {
  heading: string;
  content: string;
}

export interface DsFinding {
  severity: "error" | "warning" | "info";
  path?: string;
  message: string;
}

export interface ParsedDesignSystem {
  name: string;
  description?: string;
  colors: DsColorEntry[];
  typography: DsTypographyEntry[];
  spacing: DsDimensionEntry[];
  rounded: DsDimensionEntry[];
  components: DsComponentEntry[];
  sections: DsSection[];
  findings: DsFinding[];
  summary: { errors: number; warnings: number; infos: number };
  /** True when we fell back to a pure regex scan (no frontmatter / invalid YAML). */
  fallback: boolean;
  raw: string;
}

// ─── Splitters ────────────────────────────────────────────────────────────

interface Split {
  frontmatter: string | null;
  body: string;
}

function splitFrontmatter(raw: string): Split {
  // Match `---\n<yaml>\n---` at the start of the document. Tolerant to CRLF.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function splitSections(body: string): DsSection[] {
  // Split on `## heading` lines. Orphan prose before the first `##` is
  // captured as a leading section with an empty `heading` so a pasted /
  // uploaded design.md that doesn't follow the canonical schema (no `##`
  // headers at all) still renders its body content in the preview
  // instead of falling through to a blank screen. The DS preview hides
  // the heading row when the string is empty.
  const lines = body.split(/\r?\n/);
  const sections: DsSection[] = [];
  let current: DsSection = { heading: "", content: "" };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      // Flush whatever we've accumulated under the previous heading (or
      // the orphan-prose bucket) before starting the new section.
      if (current.heading || current.content.trim().length > 0) {
        sections.push(current);
      }
      current = { heading: m[1].trim(), content: "" };
    } else {
      current.content += line + "\n";
    }
  }
  if (current.heading || current.content.trim().length > 0) {
    sections.push(current);
  }
  return sections.map((s) => ({ heading: s.heading, content: s.content.trim() }));
}

/** Extract a heading-style title from the body so a free-form
 *  design.md without YAML frontmatter still picks up a name in the
 *  preview hero. Prefers `# Title` (which is conventional for the
 *  document name) and falls back to the first `## Heading` only when
 *  no h1 exists — many design.md files start straight at h2 (Overview,
 *  Colors, …), and surfacing the first h2 there is still better than
 *  the generic "Design system" label. */
function extractTitleFromBody(body: string): string | null {
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const h2 = body.match(/^##\s+(.+?)\s*$/m);
  if (h2) {
    const candidate = h2[1].trim();
    // Skip generic structural headings — those aren't a title, they're
    // a section. Falling through to the default name is less misleading.
    const generic =
      /^(overview|introduction|about|colors?|typography|layout|components?|spacing|radii|shapes?|tokens?)$/i;
    if (!generic.test(candidate)) return candidate;
  }
  return null;
}

// ─── Token shape parsing ──────────────────────────────────────────────────

function isValidHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
}

function hexLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function parseDimensionString(raw: unknown): { value: number; unit: string } | null {
  if (typeof raw === "number") return { value: raw, unit: "px" };
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem|em|%)?$/);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] || "" };
}

function dimensionToString(d: { value: number; unit: string }): string {
  return d.unit ? `${d.value}${d.unit}` : `${d.value}`;
}

function normalizeColors(raw: unknown): DsColorEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: DsColorEntry[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidHex(value)) continue;
    const hex = (value as string).toLowerCase();
    out.push({ name, hex, luminance: hexLuminance(hex) });
  }
  return out;
}

function normalizeTypography(raw: unknown): DsTypographyEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: DsTypographyEntry[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const fs = parseDimensionString(v.fontSize);
    const lh = parseDimensionString(v.lineHeight);
    const ls = parseDimensionString(v.letterSpacing);
    out.push({
      name,
      fontFamily: typeof v.fontFamily === "string" ? v.fontFamily : undefined,
      fontSize: fs ? dimensionToString(fs) : undefined,
      fontWeight:
        typeof v.fontWeight === "number"
          ? v.fontWeight
          : typeof v.fontWeight === "string"
            ? Number(v.fontWeight) || undefined
            : undefined,
      lineHeight: lh ? dimensionToString(lh) : undefined,
      letterSpacing: ls ? dimensionToString(ls) : undefined,
    });
  }
  return out;
}

function normalizeDimensionMap(raw: unknown): DsDimensionEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: DsDimensionEntry[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const d = parseDimensionString(value);
    if (!d) continue;
    out.push({ name, value: dimensionToString(d), raw: d });
  }
  return out;
}

function normalizeComponents(raw: unknown): DsComponentEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: DsComponentEntry[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const properties: Array<{ key: string; value: string }> = [];
    const unresolvedRefs: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") {
        properties.push({ key: k, value: v });
        const refMatch = v.match(/^\{([^}]+)\}$/);
        if (refMatch) unresolvedRefs.push(refMatch[1]);
      } else if (typeof v === "number") {
        properties.push({ key: k, value: String(v) });
      }
    }
    out.push({ name, properties, unresolvedRefs });
  }
  return out;
}

// ─── Fallback: regex scan ─────────────────────────────────────────────────

function buildFallbackColors(raw: string): DsColorEntry[] {
  const seen = new Set<string>();
  const out: DsColorEntry[] = [];
  // Line-level "name: #hex" tokens (YAML-ish without full parse).
  const tokenRe = /^\s*([a-zA-Z][\w.-]*)\s*:\s*"?(#[0-9a-fA-F]{3,8})"?\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(raw))) {
    const hex = m[2].toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({ name: m[1], hex, luminance: hexLuminance(hex) });
    if (out.length >= 24) return out;
  }
  // Any leftover standalone hex in prose.
  const hexRe = /#[0-9a-fA-F]{6}\b/g;
  while ((m = hexRe.exec(raw))) {
    const hex = m[0].toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({ name: `swatch-${out.length + 1}`, hex, luminance: hexLuminance(hex) });
    if (out.length >= 24) break;
  }
  return out;
}

// ─── Prose-based fallback parsers ─────────────────────────────────────────
//
// design.md files in the wild often skip the YAML frontmatter that the
// canonical Google schema specifies. Instead they document tokens through
// prose (`**Pure White** ({colors.primary}): The brand primary surface.`)
// and markdown tables (`| Token | Size | Weight | …`). The frontmatter
// fallback above only recovers hex codes. The functions below recover the
// *named* tokens so the preview surface gets a real type scale / radii
// rhythm / palette poster instead of falling through to bare prose.

const NAMED_COLOR_HINTS: Record<string, string> = {
  // The list is intentionally short — we only map names that are
  // unambiguous out of context. "Sky blue" is too ambiguous to lock
  // to a specific shade; we leave it as named-token-without-hex
  // (renderer shows a neutral chip). Whites and blacks are safer.
  "pure white": "#ffffff",
  white: "#ffffff",
  "off-white": "#fbfbf8",
  ivory: "#fbfcf3",
  cream: "#fbfcf3",
  "pure black": "#000000",
  black: "#000000",
  ink: "#1a1a17",
  charcoal: "#232320",
  "near-black": "#0a0a08",
  midnight: "#0e0e10",
  gray: "#999999",
  grey: "#999999",
  silver: "#c4c4c4",
};

function extractColorsFromProse(body: string): DsColorEntry[] {
  const out: DsColorEntry[] = [];
  const seen = new Set<string>();
  // Pattern: `**Display Name** ({colors.slug})` optionally followed by
  // a description that may carry a hex value. We try the inline hex
  // first, then a named-hint map, then leave hex empty.
  const re = /\*\*([^*\n]+)\*\*\s*\(\{colors\.([a-z0-9_-]+)\}\)([^\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const displayName = m[1].trim();
    const slug = m[2];
    const trailing = (m[3] || "").trim();
    if (seen.has(slug)) continue;
    seen.add(slug);
    const inlineHex = trailing.match(/#[0-9a-fA-F]{6}\b/)?.[0]?.toLowerCase();
    const namedHex = inlineHex || NAMED_COLOR_HINTS[displayName.toLowerCase()] || "";
    out.push({
      name: `${displayName} · ${slug}`,
      hex: namedHex,
      luminance: namedHex ? hexLuminance(namedHex) : 0.5,
    });
    if (out.length >= 24) break;
  }
  return out;
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function extractMarkdownTables(body: string): MarkdownTable[] {
  // A markdown table is: `| col | col |\n|---|---|\n| row | row |…`. The
  // separator row must contain only `|`, `-`, `:`, and spaces. We deliberately
  // accept variable cell counts so partially-malformed tables still flow
  // through; downstream consumers tolerate missing cells.
  const tables: MarkdownTable[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const sep = lines[i + 1]?.trim() ?? "";
    if (!header.startsWith("|") || !sep.startsWith("|")) continue;
    if (!/^\|[\s|:-]+\|$/.test(sep)) continue;
    const headers = header
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      const rowLine = lines[j].trim();
      const cells = rowLine
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      rows.push(cells);
      j++;
    }
    tables.push({ headers, rows });
    i = j - 1;
  }
  return tables;
}

function unwrapTokenCell(cell: string): string {
  // Cell often looks like ``{typography.display-xxl}`` (backticks around the
  // template ref). Strip backticks and the surrounding `{` / `}` so we get
  // the bare slug.
  const stripped = cell.replace(/`/g, "").trim();
  const tokenMatch = stripped.match(/^\{[a-z]+\.([a-z0-9_-]+)\}$/i);
  if (tokenMatch) return tokenMatch[1];
  return stripped;
}

function parseDimensionFromString(value: string): { value: number; unit: string } | null {
  const trimmed = value.replace(/^\*+|\*+$/g, "").trim();
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*([a-z%]+)?$/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2] || "" };
}

function extractTypographyFromTables(tables: MarkdownTable[]): DsTypographyEntry[] {
  const out: DsTypographyEntry[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const lower = t.headers.map((h) => h.toLowerCase());
    const tokenIdx = lower.indexOf("token");
    const sizeIdx = lower.findIndex((h) => h === "size" || h === "font size");
    if (tokenIdx < 0 || sizeIdx < 0) continue;
    const weightIdx = lower.findIndex((h) => h === "weight" || h === "font weight");
    const lineHeightIdx = lower.findIndex((h) => h.includes("line") && h.includes("height"));
    const letterIdx = lower.findIndex((h) => h.includes("letter") && h.includes("spacing"));
    const familyIdx = lower.findIndex((h) => h.includes("family") || h.includes("font face"));
    for (const row of t.rows) {
      const token = unwrapTokenCell(row[tokenIdx] ?? "");
      if (!token || seen.has(token)) continue;
      // Tighten: only accept tokens that look like `{typography.X}` (we
      // unwrapped to the slug) — skip rows that turned out to be free
      // prose under a coincidentally-named Token column.
      if (/\s/.test(token)) continue;
      seen.add(token);
      const sizeRaw = (row[sizeIdx] ?? "").trim();
      const weightRaw = (row[weightIdx] ?? "").trim();
      const weight = parseInt(weightRaw, 10);
      out.push({
        name: token,
        fontFamily: familyIdx >= 0 ? (row[familyIdx] ?? "").trim() : undefined,
        fontSize: sizeRaw || undefined,
        fontWeight: Number.isFinite(weight) ? weight : undefined,
        lineHeight: lineHeightIdx >= 0 ? (row[lineHeightIdx] ?? "").trim() : undefined,
        letterSpacing: letterIdx >= 0 ? (row[letterIdx] ?? "").trim() : undefined,
      });
      if (out.length >= 24) return out;
    }
  }
  return out;
}

function extractDimensionsFromTables(
  tables: MarkdownTable[],
  tokenNamespace: "rounded" | "spacing",
): DsDimensionEntry[] {
  const out: DsDimensionEntry[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const lower = t.headers.map((h) => h.toLowerCase());
    const tokenIdx = lower.indexOf("token");
    const valueIdx = lower.findIndex((h) => h === "value" || h === "size");
    if (tokenIdx < 0 || valueIdx < 0) continue;
    for (const row of t.rows) {
      const rawToken = (row[tokenIdx] ?? "").trim();
      // Only accept rows whose token clearly belongs to the requested
      // namespace — different tables in the same doc share `Token` /
      // `Value` headers but mix typography, rounded, components, etc.
      if (!new RegExp(`^\`?\\{${tokenNamespace}\\.`).test(rawToken)) continue;
      const token = unwrapTokenCell(rawToken);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const valueRaw = (row[valueIdx] ?? "").trim();
      const raw = parseDimensionFromString(valueRaw);
      if (!raw) continue;
      out.push({ name: token, value: valueRaw, raw });
      if (out.length >= 24) return out;
    }
  }
  return out;
}

function extractFontFamiliesFromProse(body: string): DsTypographyEntry[] {
  // Common bullet shapes that document type families in free-form
  // design.md files:
  //   - **GT Walsheim Medium** — Framer's display typeface…
  //   - **Inter Variable** — System body typeface…
  //   - **Inter** — Used selectively for `{typography.headline}`.
  // We capture the family name and emit one TypographyEntry per unique
  // family. fontSize/weight stay undefined — the family card just
  // shows the family glyphs in the live preview.
  const out: DsTypographyEntry[] = [];
  const seen = new Set<string>();
  // Pattern A: bullet that begins with `- **Family**` (em dash or `:`).
  const reBullet = /^[-*]\s+\*\*([^*\n]+?)\*\*\s*(?:—|–|-|:)/gm;
  let m: RegExpExecArray | null;
  while ((m = reBullet.exec(body))) {
    const family = m[1].trim();
    // Filter out non-family bullets that happen to share the shape
    // (color names, surface labels, anything paired with `({colors.…})`).
    // If a `({colors.` or `({rounded.` follows the bold name within a
    // short window, this is a token-style bullet, not a font.
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/^\s*\(\{(colors|rounded|spacing|components)\./.test(after)) continue;
    if (seen.has(family.toLowerCase())) continue;
    // Only accept names that look like a typeface — must have at least
    // one letter, can't be a number, can't have weird punctuation.
    if (!/^[A-Za-z][A-Za-z0-9\s/.-]+$/.test(family)) continue;
    // Heuristic filter: typeface mentions usually carry a typography
    // keyword either in the family itself or in the trailing prose.
    const surrounding = body.slice(m.index, m.index + 300).toLowerCase();
    const typographyHint =
      /(typeface|font|family|sans|serif|mono|variable|display|body|inter|geist|gt walsheim|mona|ibm plex|jetbrains|space mono|playfair|merriweather|roboto|open sans|helvetica|arial|times)/i;
    if (!typographyHint.test(surrounding)) continue;
    seen.add(family.toLowerCase());
    out.push({ name: family, fontFamily: family });
    if (out.length >= 8) break;
  }
  return out;
}

function extractDimensionsFromInline(
  body: string,
  tokenNamespace: "rounded" | "spacing",
): DsDimensionEntry[] {
  // Inline pattern: `` `{spacing.lg}` 20px `` separated by ` · ` or commas.
  // Common in bullet lists like "Tokens (front matter): `{spacing.hair}` 1px · `{spacing.xxs}` 4px · …".
  const out: DsDimensionEntry[] = [];
  const seen = new Set<string>();
  const re = new RegExp(
    "`\\{" + tokenNamespace + "\\.([a-z0-9_-]+)\\}`\\s*(-?\\d+(?:\\.\\d+)?\\s*[a-z%]+)",
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const token = m[1];
    if (seen.has(token)) continue;
    seen.add(token);
    const valueRaw = m[2].trim();
    const raw = parseDimensionFromString(valueRaw);
    if (!raw) continue;
    out.push({ name: token, value: valueRaw, raw });
    if (out.length >= 24) break;
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────

export function parseDesignSystem(raw: string): ParsedDesignSystem {
  if (!raw || typeof raw !== "string") {
    return {
      name: "Design system",
      colors: [],
      typography: [],
      spacing: [],
      rounded: [],
      components: [],
      sections: [],
      findings: [{ severity: "warning", message: "Empty source" }],
      summary: { errors: 0, warnings: 1, infos: 0 },
      fallback: true,
      raw: raw ?? "",
    };
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const sections = splitSections(body);
  const findings: DsFinding[] = [];

  let frontData: Record<string, unknown> = {};
  if (frontmatter) {
    try {
      const parsed = yaml.load(frontmatter);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontData = parsed as Record<string, unknown>;
      }
    } catch (e) {
      findings.push({
        severity: "warning",
        message: `YAML parse failed: ${String(e).slice(0, 80)}`,
      });
    }
  } else {
    findings.push({
      severity: "info",
      message: "No YAML frontmatter — parsing via fallback regex.",
    });
  }

  const frontName = typeof frontData.name === "string" ? frontData.name : null;
  const name = frontName || extractTitleFromBody(body) || "Design system";
  const description = typeof frontData.description === "string" ? frontData.description : undefined;
  const colors = normalizeColors(frontData.colors);
  const typography = normalizeTypography(frontData.typography);
  const rounded = normalizeDimensionMap(frontData.rounded);
  const spacing = normalizeDimensionMap(frontData.spacing);
  const components = normalizeComponents(frontData.components);

  const hasStructuredData = colors.length + typography.length + rounded.length + spacing.length > 0;

  if (!hasStructuredData) {
    // Nothing we could pull from frontmatter. Try a layered fallback:
    //   1. Token-shaped prose (`**Name** ({colors.slug})`) + named-hint map
    //   2. Markdown tables (typography hierarchy, rounded scale)
    //   3. Inline dimension lists (`{spacing.lg}` 20px · …)
    //   4. Plain hex scan (for stray #abcdef in prose)
    // Anything we extract lands in the same shape as a structured parse,
    // so the bento renderer doesn't need to know it came from prose.
    const proseColors = extractColorsFromProse(body);
    const tables = extractMarkdownTables(body);
    let proseTypography = extractTypographyFromTables(tables);
    // Fall back to font families documented in bullets when the doc
    // doesn't carry a full typography table. Better to show the family
    // names than to render an empty type tile.
    if (proseTypography.length === 0) {
      proseTypography = extractFontFamiliesFromProse(body);
    }
    const proseRounded = extractDimensionsFromTables(tables, "rounded").concat(
      extractDimensionsFromInline(body, "rounded"),
    );
    const proseSpacing = extractDimensionsFromTables(tables, "spacing").concat(
      extractDimensionsFromInline(body, "spacing"),
    );

    // Drop hex-less prose colors from the palette poster — they read as
    // empty squares. We still keep them counted in the finding so the
    // user knows tokens were detected.
    const colorsWithHex = proseColors.filter((c) => c.hex);
    const hexScan = colorsWithHex.length === 0 ? buildFallbackColors(raw) : [];
    const fallbackColors = colorsWithHex.length > 0 ? colorsWithHex : hexScan;

    const recoveredCount =
      fallbackColors.length + proseTypography.length + proseRounded.length + proseSpacing.length;
    if (recoveredCount > 0) {
      findings.push({
        severity: "info",
        message: `Prose fallback recovered ${fallbackColors.length} color(s), ${proseTypography.length} type token(s), ${proseRounded.length} radius token(s), ${proseSpacing.length} spacing token(s).`,
      });
    }

    return {
      name,
      description,
      colors: fallbackColors,
      typography: proseTypography,
      spacing: proseSpacing,
      rounded: proseRounded,
      components,
      sections,
      findings,
      summary: summarize(findings),
      fallback: true,
      raw,
    };
  }

  // If colors were empty but other sections had data, still try the fallback
  // so the DS card preview has something to show.
  const finalColors = colors.length > 0 ? colors : buildFallbackColors(raw);

  return {
    name,
    description,
    colors: finalColors,
    typography,
    spacing,
    rounded,
    components,
    sections,
    findings,
    summary: summarize(findings),
    fallback: colors.length === 0 && finalColors.length > 0,
    raw,
  };
}

function summarize(findings: DsFinding[]): ParsedDesignSystem["summary"] {
  const s = { errors: 0, warnings: 0, infos: 0 };
  for (const f of findings) {
    if (f.severity === "error") s.errors++;
    else if (f.severity === "warning") s.warnings++;
    else s.infos++;
  }
  return s;
}
