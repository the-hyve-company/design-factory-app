import { spawnStream, spawnOnce } from "./cli-spawner";
import { extractHtmlFromOutput, validateTweaks, type TweaksConfig } from "./schema-validator";
import { getBuiltinPrompt } from "./builtin-prompts";
import { buildSystemPrompt, type ProjectContext } from "./prompt-composer";
import type { StreamCallbacks } from "@/lib/claude-bridge";
type UnlistenFn = () => void;

// The system-prompt building blocks moved to `prompt-composer.ts` — the
// single pure composer consumed by BOTH the turn pipeline (prepare) and
// the verb/apply-style paths below (audit WS2 `pa-unify-composer`).
// Re-exported here so existing importers (EditorScreen,
// NewProjectFormSkeu, useClaude, patch-invoker, tests) keep working.
export {
  workspaceContextPreamble,
  VISUAL_CRAFT_CONTRACT,
  INJECTION_RESISTANCE,
  AGENT_CONTRACT_LIMITS,
  buildLocalePromptBlock,
  buildSystemPrompt,
} from "./prompt-composer";
export type { ProjectContext } from "./prompt-composer";

// ─── PP-01: generate_base ───────────────────────────────────────────────────

// Editable in Settings → Built-in prompts. The wrapper that ships
// alongside (injection boundary + preamble + locale + DS) is composed
// per turn by buildSystemPrompt (prompt-composer.ts); EditorScreen
// forwards this body via preambleExtras. Keep this as principles, not
// prescriptions — specific aesthetic direction comes from design
// systems and taste skills loaded per-project.
export const GENERATE_CORE_SYSTEM = [
  "Design a self-contained HTML document — a single file opened in an",
  "iframe. Treat it as finished, intentional work. Not a wireframe.",
  "",
  "Output: ALWAYS use the Write tool. NEVER stream HTML/CSS/JS as chat",
  "prose. Chat reply = short status (1-3 lines). File = code only.",
  "",
  "Discipline:",
  "- Palette: small intentional set. One color leads, the rest restrain.",
  "- Type: 1-2 faces with weight contrast. Hold the chosen scale.",
  "- Space: a single scale, applied consistently.",
  "- Shape: one radius system. Lines and corners cohere.",
  "- Depth: shadows only when the design needs them.",
  "- Motion: only when it serves comprehension or hierarchy.",
  "",
  "Content: real copy. If the user didn't supply it, write 1-2 plausible",
  "sentences that fit the use case. No Lorem ipsum, no 'Feature 1/2/3',",
  "no decorative emoji.",
  "",
  "Anti-slop: no AI-shimmer haze gradients, no stacks of mismatched",
  "shadows, no pill-chip badges everywhere, no placeholder grey squares.",
  "",
  "Self-critique once before emitting: intentional or templated? If",
  "templated, change one thing — narrow the palette, tighten the type,",
  "or remove half the decoration.",
  "",
  "When a design system or taste skill is loaded, it overrides these",
  "defaults — follow IT first.",
].join("\n");

// The Visual Craft Contract and the generate/refine system builders
// lived here until the WS2 refactor:
//   · `VISUAL_CRAFT_CONTRACT` → moved to prompt-composer.ts (re-exported
//     above), applied by the composer to fresh writes only.
//   · `buildGenerateSystem` → DELETED. It was dead code — only the
//     removed legacy fan-out (`invokeGenerateBase`) reached it; the live
//     generate path is the pipeline's prepare() → buildSystemPrompt.
//   · `buildRefineSystem` → DELETED. Its two live callers
//     (invokeApplyStyle, invokeEditorialVerb below) now route through
//     `buildSystemPrompt(ctx, { kind: "verb" })`, which preserves its
//     blocks (summary → core → artifact contract → tweaks guard) and
//     adds the workspace preamble + injection boundary + locale that the
//     verb path lacked (audit WS2 `pa-verb-path-no-preamble`).

// ─── PP-02: apply_style ─────────────────────────────────────────────────────

// Heuristic: does this user message look like a question rather than an
// edit instruction? Used by the chat input when chatMode is "auto".
//
// Triggers (any of):
//   - Trailing `?` (PT/EN)
//   - Starts with a question-word: que, qual, quais, como, por que, porque,
//     onde, quando, what, how, why, when, where, which, should, can, do
//   - Contains a "what do you think / o que você acha / sugere / propõe"
//     phrase anywhere (e.g. asking the model for its opinion)
//
// Conservative: returns false if the message contains imperative verbs
// like "muda", "troca", "remove", "use", "make", "change", "add" near the
// start — those are clearly edit requests even if they end in `?`.
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (
    /^(muda|troca|altera|remove|tira|adiciona|coloca|use|usa|faz|cria|gera|aplica|change|swap|remove|add|use|make|create|apply|build|generate)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (/[?]\s*$/.test(t)) return true;
  if (
    /^(que|qual|quais|como|por\s*que|porque|onde|quando|what|how|why|when|where|which|should|can|do|does|would)\b/i.test(
      t,
    )
  )
    return true;
  if (
    /\b(o\s+que\s+(você|voce)|que\s+(você|voce)|o\s+que\s+(propõe|propoe|sugere|acha|recomenda)|what\s+do\s+you\s+(think|suggest|recommend)|any\s+(suggestions?|ideas?))\b/i.test(
      t,
    )
  )
    return true;
  return false;
}

export const REFINE_SYSTEM = [
  "You are editing an existing HTML document. Apply the smallest change",
  "that fully satisfies the user's request.",
  "",
  "Strategy:",
  "- Try surgical search-and-replace first. Find the smallest unique",
  "  block (one rule, one element, one variable) and patch just that.",
  "- Full rewrite is the last resort. If you fall back, say so in chat:",
  '  "Couldn\'t apply patch, regenerating section."',
  "- Never paste new HTML alongside old HTML.",
  "- Never duplicate sections during edit.",
  "- Preserve `assets/` folder and any `tab-N-*.html` siblings.",
  "",
  "Discipline:",
  "- Touch only what the request implies. Color request → color tokens",
  "  only. Leave typography, spacing, structure, copy, IDs, classnames.",
  "- Preserve the design's visual vocabulary. No shadows where there",
  "  were none; no second radius scale.",
  "- Preserve existing CSS custom properties, class names, and IDs",
  "  unless the change explicitly redefines them.",
  "- Ambiguous? Pick the interpretation that respects the existing",
  "  design more.",
  "",
  "Output: the full modified HTML document. <!DOCTYPE html> first.",
  "Code only. No prose. No markdown fences.",
].join("\n");

export async function invokeApplyStyle(
  instruction: string,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const prompt = `HTML atual:\n${ctx.currentHtml || ""}\n\nInstrução de estilo: ${instruction}`;
  const refineCore = await getBuiltinPrompt("refine", REFINE_SYSTEM, ctx.projectId);
  const system = buildSystemPrompt(ctx, { kind: "verb", core: refineCore });
  return spawnStream(
    "refine",
    prompt,
    system,
    {
      onText: callbacks.onText,
      onMeta: callbacks.onMeta,
      onUsage: callbacks.onUsage,
      onResult: callbacks.onResult,
      onDone: (fullText) => callbacks.onDone(extractHtmlFromOutput(fullText)),
      onError: callbacks.onError,
    },
    { providerId: ctx.providerId, model: ctx.model, cwd: ctx.cwd, agent: ctx.agent },
  );
}

// ─── PP-02b: editorial verb ──────────────────────────────────────────────
// One pipeline for any verb registered in src/runtime/verbs/registry.ts.
// The verb's frontmatter decides whether the response should be parsed as
// HTML (modifiesHtml: true) or surfaced as plain prose in the chat
// (modifiesHtml: false — used by Review and Check).

export interface EditorialVerbInvocation {
  id: string;
  systemPrompt: string;
  modifiesHtml: boolean;
  args: string;
}

export async function invokeEditorialVerb(
  verb: EditorialVerbInvocation,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const html = ctx.currentHtml || "";
  const argsLine = verb.args.trim() ? `\n\nUser focus for this pass: ${verb.args.trim()}` : "";
  const prompt = verb.modifiesHtml
    ? `Existing HTML document:\n${html}${argsLine}`
    : `HTML to evaluate:\n${html}${argsLine}`;

  // Both verb classes route through the single composer (kind "verb")
  // so they inherit the workspace preamble (path binding, output
  // contract, language) + injection boundary + locale — audit WS2
  // `pa-verb-path-no-preamble`. Verbs that EDIT (polish, rewrite,
  // animate, …) additionally get the Canonical+ summary + artifact
  // contract + tweaks guard. Read-only verbs (review, check) skip
  // those — their job is to evaluate, not conform, and the summary
  // would bias the critique.
  const verbSystem = buildSystemPrompt(ctx, {
    kind: "verb",
    core: verb.systemPrompt,
    modifiesHtml: verb.modifiesHtml,
  });
  return spawnStream(
    "refine",
    prompt,
    verbSystem,
    {
      onText: callbacks.onText,
      onMeta: callbacks.onMeta,
      onUsage: callbacks.onUsage,
      onResult: callbacks.onResult,
      onSession: callbacks.onSession,
      onAuthRequired: callbacks.onAuthRequired,
      onDone: (fullText) => {
        if (verb.modifiesHtml) {
          callbacks.onDone(extractHtmlFromOutput(fullText));
        } else {
          // Read-only verbs (review, check, …) — pass the prose straight to
          // the chat without trying to extract an HTML document.
          callbacks.onDone(fullText);
        }
      },
      onError: callbacks.onError,
    },
    { providerId: ctx.providerId, model: ctx.model, cwd: ctx.cwd, agent: ctx.agent },
  );
}

// ─── PP-05: tweaks_generate (legacy, kept for fallback) ─────────────────────

const TWEAKS_SYSTEM = [
  "Analise o HTML fornecido e gere controles Tweaks.",
  "Retorne JSON puro (sem markdown). Schema:",
  '{ "controls": [{ "id": string, "label": string, "type": "slider"|"toggle"|"segmented"|"color"|"select", "value": any, "options"?: string[], "min"?: number, "max"?: number, "cssVar"?: string }] }',
  "Gere entre 4-8 controles dos aspectos mais importantes e modificáveis.",
].join("\n");

export async function invokeTweaksGenerate(ctx: ProjectContext): Promise<TweaksConfig | null> {
  if (!ctx.currentHtml) return null;
  const prompt = `HTML:\n${ctx.currentHtml}\n\nGere os controles Tweaks para este design.`;
  // 1 stabilize: pass providerId so tweaks generation goes to the
  // picker-selected provider. Pre-fix, ctx.providerId was silently dropped.
  const raw = await spawnOnce("tweaks", prompt, TWEAKS_SYSTEM, {
    providerId: ctx.providerId,
    model: ctx.model,
    cwd: ctx.cwd,
    agent: ctx.agent,
  });
  const result = validateTweaks(raw);
  return result.ok ? result.value : null;
}

// ─── PP-05b: tweaks_interactive ─────────────────────────────────────────────
// Refatora o HTML pra usar CSS variables nos aspectos pedidos pelo usuário
// e retorna os controles. Dps disso o frontend muda valores sem chamar
// Claude de novo — atualiza as CSS vars direto no iframe.

const TWEAKS_PANEL_STANDARDS = [
  "PANEL VISUAL STANDARDS (MUST follow):",
  "",
  "Position & size:",
  "  - position: fixed; right: 16px; bottom: 16px; z-index: 9999",
  "  - width: 240px; max-height: min(600px, 75vh); overflow-y: auto",
  "  - padding-bottom: 8px so last control has breathing room",
  "",
  "Chrome:",
  "  - background: rgba(18,18,18,0.92) on dark designs, rgba(255,255,255,0.94)",
  "    on light; backdrop-filter: blur(16px)",
  "  - border: 1px solid rgba(white-or-black based on theme, 0.08-0.12)",
  "  - border-radius: 10px",
  "  - box-shadow: 0 8px 32px rgba(0,0,0,0.18)",
  "  - font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  "  - font-size: 11px; color: readable on the panel bg",
  "",
  "Header:",
  "  - Flex row, padding 6px 10px, border-bottom 1px subtle divider",
  "  - Left: uppercase label 'TWEAKS' 10px with letter-spacing 0.08em +",
  "    count suffix ' · N' at 10px in a fainter color",
  "  - Right: ✕ close button (16×16, no background, hover bg subtle) that",
  "    toggles the panel body visibility by adding data-collapsed on the root",
  "  - Clicking the label area (not the ✕) also toggles collapse",
  "",
  "Each control (in panel body, padding 8px 10px, gap 10px between rows):",
  "  - Row container: flex-column gap 4px",
  "  - Top line: flex row, label left (11px) + value right (10px, font",
  "    faint). Value shows '12px' for slider with unit, '#6366f1' is",
  "    rendered as a swatch+hex for colors, 'on/off' for toggles.",
  "  - Control below the line:",
  '    * slider: <input type="range"> full width, accent-color: var(--primary)',
  "      (or whatever the design's dominant accent is)",
  "    * color: 22×18 swatch + hex text input side by side",
  "    * toggle: 32×18 pill switch (off = grey, on = primary)",
  "    * segmented: equal-column pill group, 2-4 options max",
  "",
  "Behavior (inline <script> in the panel):",
  "  - Every input is wired to document.documentElement.style.setProperty",
  "    using its bound CSS variable (stored in data-var attribute).",
  "  - Units are preserved — slider with unit 'px' writes '12px', not '12'.",
  "  - Panel state (values + collapsed) persists to localStorage under key",
  "    'df-tweaks:' + location.pathname.",
  "  - ESC toggles collapse.",
  "  - Panel never blocks clicks on the rest of the design.",
  "",
  "What NOT to do:",
  "  - Don't hardcode values in the controls — always read from the CSS var.",
  "  - Don't create controls for aspects that don't obviously need tweaking.",
  "  - Don't over-style the panel — the design being tweaked is the focus.",
  "  - Don't put the panel inline with the design. Always fixed-position.",
].join("\n");

// Canonical source lives at <repoRoot>/skills/df-tweaks/SKILL.md (;
// legacy <repoRoot>/.claude/skills/df-tweaks/SKILL.md still walked
// read-only). Other HYVE agents reuse it via `/df-tweaks`. The inline
// copy below is kept as a fallback for when the skill registry isn't
// available (e.g. dev browser preview). Keep the two in sync when editing.
const TWEAKS_INTERACTIVE_SYSTEM = [
  "You are a precision HTML refactoring tool. The user wants live controls",
  "built INTO the HTML itself — a floating tweaks panel that reads & writes",
  "CSS variables on :root. No external UI layer — everything is inside the",
  "returned HTML. Output nothing but raw JSON — no markdown fences, no prose.",
  "",
  "INPUT:",
  "1. Existing HTML (may already contain a panel from a previous pass)",
  "2. User's tweak request — what to ADD to the panel or focus on.",
  "   Blank request = add high-impact visuals across colors, typography,",
  "   spacing, radii, depth.",
  "",
  "METHOD:",
  "",
  "Step A — inventory.",
  "Read the existing <style> block. Catalogue distinct values with units,",
  "hex/rgb colors, and typographic metrics (weight, line-height,",
  "letter-spacing). If a tweaks panel already exists in the HTML, read",
  "its current CSS variables — those MUST be preserved.",
  "",
  "Step B — cluster by role (internal reasoning, not output):",
  "  COLOR  | TYPE  | SPACE  | SHAPE  | DEPTH",
  "",
  "Step C — pick.",
  "Pick ONLY the controls the user requested, plus existing ones (if a",
  "panel is already there). If the request is blank, cover 6-10 high-impact",
  "aspects in this order of priority: COLOR (palette + accents) → SPACE",
  "(rhythm, container padding) → TYPE scale (heading + body sizes) →",
  "SHAPE (radii, borders) → DEPTH (shadow strength). Never invent",
  "controls that don't map to real CSS the design uses.",
  "",
  "Step D — refactor.",
  "For each picked aspect, introduce ONE CSS variable in :root{} and",
  "replace EVERY occurrence of the literal in the stylesheet with",
  "var(--name). Refactored HTML must render identical to input at",
  "default values.",
  "",
  "TYPE controls — extra care (F2.3):",
  "- When the request involves typography (font, size, weight, leading),",
  "  the CSS variable MUST replace EVERY occurrence in the stylesheet,",
  "  not just the first one. A body-font slider that only retypes the",
  "  first selector is the most common failure mode — sweep h1/h2/h3/p/",
  "  blockquote/li/button/input/* literals too.",
  "- font-family controls SHOULD be type='select' with 4-6 realistic",
  "  options drawn from Web-safe families OR Google Font names that are",
  "  ALREADY loaded by the document. Do NOT propose fonts the design",
  "  doesn't link/import — switching to a missing family silently falls",
  "  back to serif and looks broken.",
  "- Panel chrome typography is INDEPENDENT of the design. The panel",
  "  uses ui-monospace per the standards below; design-side font vars",
  "  must never bleed into #df-tweaks-panel selectors.",
  "",
  "Step E — build/update the in-HTML tweaks panel.",
  "Append (or update, if already present) a floating panel inside <body>",
  "following the VISUAL STANDARDS below. Wire every control to the CSS",
  "variable via a compact inline <script>. Preserve existing panel state",
  "when merging new controls with an existing panel.",
  "",
  TWEAKS_PANEL_STANDARDS,
  "",
  "HARD CONSTRAINTS — verify before emitting:",
  "- refactoredHtml starts with <!DOCTYPE html>",
  "- Every :root variable bound to a control is actually used via var() elsewhere",
  "- Panel is fixed-position bottom-right, not inline with content",
  "- Panel's <style> is scoped with an id selector (e.g. #df-tweaks-panel ...)",
  "  so it never bleeds into the design",
  "- Inline <script> uses 'document.getElementById(\"df-tweaks-panel\")'",
  "  and setProperty on documentElement",
  "- No two controls target the same cssVar",
  "- Labels are sentence case, 1-3 words ('Primary color', 'Heading size')",
  "- Panel must look intentional, not an afterthought — clean type, real",
  "  spacing, sectioned by role (color/space/type/shape), no debug-tool aesthetic",
  "- F2.3: Typography vars must reach the WHOLE design, not just the",
  "  first matching selector. Grep the stylesheet for the literal value",
  "  and replace each occurrence — partial replacement leaves the",
  "  control half-broken (e.g. body changes but headings don't).",
  "- F2.3: font-family options must already be available (Web-safe or",
  "  imported). Never propose a family the document doesn't load.",
  "",
  "OUTPUT (raw JSON, exactly this shape):",
  "{",
  '  "refactoredHtml": "<!DOCTYPE html>...",',
  '  "summary": "Added 7 controls: primary, bg, text, heading size, spacing, radius, shadow"',
  "}",
  "",
  "The 'summary' is a 1-sentence human-readable description of what changed",
  "— shown in the chat for the user to scan.",
].join("\n");

export interface InteractiveTweaksResult {
  refactoredHtml: string;
  summary?: string;
}

export function extractJsonPayload(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) return fence[1].trim();
  // Find the first { and the last } to be robust against prose wrapping
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

export function parseTweaksResponse(raw: string): InteractiveTweaksResult | null {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw));
    if (!parsed.refactoredHtml || typeof parsed.refactoredHtml !== "string") return null;
    const html = String(parsed.refactoredHtml);
    // Basic sanity: must be a full document AND must include the panel marker
    if (!/^\s*<!DOCTYPE html>/i.test(html)) return null;
    if (!html.includes("df-tweaks-panel")) return null;
    return {
      refactoredHtml: html,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

export function buildTweaksPrompt(userRequest: string, currentHtml: string): string {
  return [
    `HTML existente:`,
    currentHtml,
    "",
    `Tweaks solicitados pelo usuário: ${userRequest || "aspectos visuais principais (cores, espaçamento, tipografia, cantos)"}`,
  ].join("\n");
}

export const TWEAKS_SYSTEM_PROMPT = TWEAKS_INTERACTIVE_SYSTEM;

/** Streaming version: returns the stream unlisten. Caller collects text + parses at onDone. */
export async function invokeTweaksInteractive(
  userRequest: string,
  ctx: ProjectContext,
): Promise<InteractiveTweaksResult | null> {
  if (!ctx.currentHtml) return null;
  const prompt = buildTweaksPrompt(userRequest, ctx.currentHtml);
  const system = await getBuiltinPrompt("tweaks", TWEAKS_INTERACTIVE_SYSTEM);
  const raw = await spawnOnce("generate", prompt, system, {
    providerId: ctx.providerId,
    model: ctx.model,
    cwd: ctx.cwd,
    agent: ctx.agent,
  });
  return parseTweaksResponse(raw);
}

// ─── PP-06: export_prep ─────────────────────────────────────────────────────

type ExportFormat = "html" | "react" | "vue" | "tailwind";

function buildExportSystem(format: ExportFormat): string {
  const map: Record<ExportFormat, string> = {
    html: "Return clean, self-contained HTML (CSS and JS inline). No unnecessary comments.",
    react:
      "Convert to a functional React component with TypeScript. Props for configurable values. No external frameworks beyond React.",
    vue: "Convert to a Vue 3 Single File Component with <script setup> + TypeScript.",
    tailwind: "Rewrite the CSS using Tailwind v4 classes. Keep the HTML semantic.",
  };
  return map[format];
}

export async function invokeExportPrep(ctx: ProjectContext, format: ExportFormat): Promise<string> {
  if (!ctx.currentHtml) return "";
  const prompt = `HTML:\n${ctx.currentHtml}\n\nConvert to: ${format}`;
  // 1 stabilize: pass providerId so export-format conversion respects
  // the picker selection. Pre-fix, every export silently went to Claude.
  return spawnOnce("export", prompt, buildExportSystem(format), {
    providerId: ctx.providerId,
    model: ctx.model,
    cwd: ctx.cwd,
    agent: ctx.agent,
  });
}
