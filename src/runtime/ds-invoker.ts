// Design-system generation invoker.
//
// Claude reads the input (folder files, uploaded stylesheet, GitHub repo) and
// emits a DESIGN.md in the @google/design.md format — YAML frontmatter with
// structured tokens (colors / typography / rounded / spacing / components)
// followed by markdown prose sections (Overview / Colors / Typography / …).
//
// The system prompt pins Claude to that schema; the user prompt carries the
// source payload. Output is raw markdown — no code fences.

import { spawnStream } from "./cli-spawner";
import type { StreamCallbacks } from "@/lib/claude-bridge";
type UnlistenFn = () => void;

// ─── System prompt (Google design.md schema) ──────────────────────────────

const DS_GENERATION_SYSTEM = [
  "You are a senior design-system engineer. Your job: produce a canonical",
  "DESIGN.md file that follows the @google/design.md format (github.com/google-labs-code/design.md).",
  "Output raw markdown ONLY — no ``` fences, no prose wrapping, no commentary.",
  "",
  "OUTPUT SHAPE:",
  "  1. YAML frontmatter between --- fences (machine-readable tokens)",
  "  2. Markdown body with ## sections (human-readable rationale)",
  "",
  "REQUIRED YAML FRONTMATTER FIELDS:",
  "  name: <string>                   # required",
  "  description: <string>            # optional, one line",
  "  colors:                          # at least primary; hex sRGB like '#1A1C1E'",
  '    primary: "#..."',
  '    secondary: "#..."',
  '    tertiary: "#..."             # optional',
  '    neutral: "#..."               # optional',
  '    surface: "#..."               # optional',
  '    on-surface: "#..."            # optional',
  "  typography:                      # map of typography tokens",
  "    h1:",
  "      fontFamily: <string>",
  "      fontSize: <Dimension e.g. 48px>",
  "      fontWeight: <number>",
  "      lineHeight: <Dimension or unitless>",
  "      letterSpacing: <Dimension>    # optional",
  "    body-md:",
  "      fontFamily: <string>",
  "      fontSize: 16px",
  "      fontWeight: 400",
  "      lineHeight: 1.6",
  "    label-caps:                    # use hyphenated semantic names",
  "      fontFamily: <string>",
  "      fontSize: <Dimension>",
  "      fontWeight: <number>",
  "  rounded:                         # optional; map of sizes",
  "    sm: 4px",
  "    md: 8px",
  "    lg: 12px",
  "    full: 9999px",
  "  spacing:                         # optional; map of spacing scale",
  "    xs: 4px",
  "    sm: 8px",
  "    md: 16px",
  "    lg: 32px",
  "    xl: 64px",
  "  components:                      # optional; map of component name to sub-tokens",
  "    button-primary:",
  '      backgroundColor: "{colors.primary}"',
  '      textColor: "{colors.on-primary}"',
  '      rounded: "{rounded.md}"',
  "      padding: 12px",
  "    button-primary-hover:",
  '      backgroundColor: "{colors.primary-container}"',
  "",
  "TOKEN REFERENCE SYNTAX: use {path.to.token} inside quotes to reference",
  'an existing token (e.g. backgroundColor: "{colors.primary}").',
  "",
  "COLOR RULES: hex sRGB only (#RRGGBB or #RRGGBBAA). No rgb(), no hsl(),",
  "no named colors. Dimension units: px, em, rem. Typography fontWeight is",
  "a number (400, 600, 700).",
  "",
  "MARKDOWN BODY SECTIONS (in this order, use ## headings):",
  "  ## Overview         — brand/style personality paragraph",
  "  ## Colors           — describe each palette role (primary, secondary, etc.)",
  "  ## Typography       — describe each typography level's role",
  "  ## Layout           — grid, spacing strategy, container rules",
  "  ## Elevation & Depth — shadows, tonal layers, or flat hierarchy",
  "  ## Shapes           — corner radius philosophy (sharp, soft, mixed)",
  "  ## Components       — notes on common components: buttons, chips, lists, inputs",
  "  ## Do's and Don'ts  — bulleted guardrails",
  "",
  "STYLE OF WRITING: concise, declarative, product-design vocabulary.",
  "Avoid marketing copy. Each prose section must reference the token names",
  'it describes, like "The palette leads with primary (#1A1C1E)…".',
  "",
  "NEVER include ``` fences around the output. NEVER wrap the document in",
  "commentary. Emit the frontmatter as the very first characters of the",
  "response.",
].join("\n");

// ─── User prompt builders (one per source) ────────────────────────────────

// Constraints appended to every extraction user-prompt. The async
// /ds/generate-design-md daemon endpoint runs the provider in once-mode
// without a separate systemPrompt arg (the call shape only supports a
// single prompt), so the schema + tool-discipline rules have to live
// INSIDE the user prompt. Otherwise Claude with --dangerously-skip-
// permissions reads the bare ask "produce a DESIGN.md", sees it has
// Write available, decides to Write the file to its cwd (the /tmp
// extraction sandbox), and returns a prose summary like "DESIGN.md is
// written at <path>. Here's what the document covers: ..." — which the
// daemon dutifully writes as the design.md, corrupting the result.
// Observed in repro.
const ABSOLUTE_CONSTRAINTS = [
  "",
  "ABSOLUTE CONSTRAINTS — read these before producing any output:",
  "",
  "- DO NOT use any tools. No Write, no Edit, no Bash, no Read on existing",
  "  files, no file operations of any kind. Your reply text IS the deliverable.",
  "- DO NOT save the markdown to a file. DO NOT run shell commands. DO NOT",
  "  touch the filesystem in any way.",
  "- If you have file-editing tools available, IGNORE THEM ENTIRELY for this",
  "  task. The system that called you reads your stdout text and writes it",
  "  to disk on its own. Writing a file yourself causes a duplicate / wrong",
  "  file because the daemon-side writer will overwrite it with your stdout.",
  "- DO NOT respond with prose explaining what the document covers. Respond",
  "  with the document ITSELF, raw, starting at the first `---` of the YAML",
  "  frontmatter.",
  "- The very first characters of your response must be `---` (the opening",
  "  frontmatter fence). The last characters of your response must be the",
  "  closing of the last markdown section — no trailing commentary.",
].join("\n");

export function buildFolderPrompt(
  files: Array<{ path: string; content: string }>,
  targetName: string,
): string {
  const filesBlob = files
    .slice(0, 20)
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 40_000)}`)
    .join("\n\n");
  return [
    DS_GENERATION_SYSTEM,
    "",
    "---",
    "",
    `Source type: local folder`,
    `Target system name: ${targetName}`,
    "",
    `Raw source files (CSS, tokens, config, docs — what the project actually ships):`,
    filesBlob || "(no relevant files found — infer from project name alone)",
    "",
    `Produce a DESIGN.md (Google format) that faithfully captures what these files ship.`,
    `When a value is present verbatim in the source, copy it. When it's implied, infer.`,
    `Skip sections you cannot meaningfully fill — don't invent.`,
    ABSOLUTE_CONSTRAINTS,
  ].join("\n");
}

/**
 * True when a file's content looks like a canonical DESIGN.md (Google
 * format) — YAML frontmatter that opens with `---`, contains a `name:`
 * field, and closes with `---`. Callers use this to short-circuit the
 * Claude normalization pass: an existing design.md should be saved
 * as-is, not reprocessed.
 */
export function looksLikeDesignMd(fileContent: string): boolean {
  return /^---\s*\n[\s\S]*?name:[\s\S]*?\n---/m.test(fileContent);
}

export function buildUploadPrompt(fileName: string, fileContent: string): string {
  if (looksLikeDesignMd(fileContent)) {
    return [
      DS_GENERATION_SYSTEM,
      "",
      "---",
      "",
      `Source type: existing DESIGN.md`,
      `File: ${fileName}`,
      "",
      `Content:`,
      fileContent.slice(0, 80_000),
      "",
      `Normalize the above to the canonical Google design.md schema:`,
      `  - Ensure YAML frontmatter is the first block`,
      `  - Reorder ## sections to match the spec order`,
      `  - Preserve every token the source already provides`,
      `  - Add any missing required sections with tokens derived from context`,
      ABSOLUTE_CONSTRAINTS,
    ].join("\n");
  }
  return [
    DS_GENERATION_SYSTEM,
    "",
    "---",
    "",
    `Source type: single stylesheet (${fileName})`,
    "",
    `Content:`,
    fileContent.slice(0, 100_000),
    "",
    `Read the CSS custom properties, Tailwind theme, or raw values defined in this file.`,
    `Produce a DESIGN.md (Google format) that captures every extractable token.`,
    `Infer the system's personality from the values themselves (e.g. "minimal, utility-first").`,
    ABSOLUTE_CONSTRAINTS,
  ].join("\n");
}

export function buildGithubPrompt(
  repoFullName: string,
  filesSummary: string,
  keyFiles: Array<{ path: string; content: string }>,
): string {
  const blob = keyFiles
    .slice(0, 10)
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 40_000)}`)
    .join("\n\n");
  return [
    DS_GENERATION_SYSTEM,
    "",
    "---",
    "",
    `Source type: GitHub repository`,
    `Repo: ${repoFullName}`,
    "",
    `File tree summary (abbreviated):`,
    filesSummary.slice(0, 10_000),
    "",
    `Key stylesheet/config files:`,
    blob || "(none identified)",
    "",
    `Produce a DESIGN.md (Google format). Use the repo name as the DS name.`,
    `If README or package.json hints at the product surface (web app, marketing,`,
    `dashboard), reflect that in the Overview prose.`,
    ABSOLUTE_CONSTRAINTS,
  ].join("\n");
}

// ─── Streaming invoker ────────────────────────────────────────────────────

export interface DsStreamCallbacks extends StreamCallbacks {
  onMarkdown?: (md: string) => void; // cleaned final markdown
}

export async function invokeDsGeneration(
  userPrompt: string,
  callbacks: DsStreamCallbacks,
  opts: { provider?: string; model?: string; cwd?: string } = {},
): Promise<UnlistenFn> {
  return spawnStream(
    "generate",
    userPrompt,
    DS_GENERATION_SYSTEM,
    {
      onText: callbacks.onText,
      onMeta: callbacks.onMeta,
      onUsage: callbacks.onUsage,
      onResult: callbacks.onResult,
      onDone: (fullText) => {
        const cleaned = cleanMarkdown(fullText);
        callbacks.onMarkdown?.(cleaned);
        callbacks.onDone(cleaned);
      },
      onError: callbacks.onError,
    },
    {
      providerId: (opts.provider as any) ?? "claude",
      model: opts.model ?? "sonnet",
      cwd: opts.cwd,
    },
  );
}

/** Strip stray ``` fences Claude sometimes adds despite instructions. */
function cleanMarkdown(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]+?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}
