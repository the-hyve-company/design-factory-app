import { spawnStream, spawnOnce } from "./cli-spawner";
import {
  extractHtmlFromOutput,
  validateHtml,
  validateTweaks,
  type TweaksConfig,
} from "./schema-validator";
import { getBuiltinPrompt } from "./builtin-prompts";
import {
  buildCanonicalPlusSummary,
  type CanonicalPlusInput,
  type DialKey,
  type DialDirection,
} from "./canonical-plus-prompt";
import { buildArtifactContractBlock } from "./output-contract";
import { getProvider } from "@/providers/registry";
import type { StreamCallbacks } from "@/lib/claude-bridge";
import type { ProviderId } from "@/providers/types";
type UnlistenFn = () => void;
type DialOverrides = Partial<Record<DialKey, Partial<DialDirection>>>;

/**
 * Resolve the artifact contract block for this turn. Returns "" when
 * the active provider writes via native tool (claude/codex/etc.) and a
 * pre-filled <artifact identifier=... type=... title=...> block when the
 * provider materializes via the artifact channel (gemini-api, openai,
 * openrouter, anthropic, ollama). Without this on the legacy generate/refine
 * paths, artifact-channel BYOK providers receive only the system core and
 * dump markdown fences on edits — the daemon parser has no <artifact>
 * block to materialize, so the file silently doesn't update. Surfaced
 * via QA matrix 2026-05-18 (openrouter/gemini-api mid-edit
 * EDIT_NOT_APPLIED).
 */
function artifactContractForCtx(ctx: ProjectContext, opts?: { isEdit?: boolean }): string {
  const providerId = ctx.providerId ?? "claude";
  const provider = getProvider(providerId);
  if (!provider) return "";
  if (provider.capabilities.fileWrite !== "artifact") return "";
  // Compute repo-relative path the artifact-writer expects. Project
  // paths arrive as absolute repo-rooted paths
  // (`<repoRoot>/projects/<slug>/`) or `~`-prefixed; we strip down to
  // the `projects/<slug>/` form the contract example shows and the
  // parser keys off.
  const stem = (ctx.projectPath ?? "")
    .replace(/^~\/?/, "")
    .replace(/^.*?\/(projects\/[^/]+\/?)$/, "$1");
  const filePath = stem
    ? `${stem.replace(/\/$/, "")}/${ctx.primaryFile}`
    : `projects/default/${ctx.primaryFile}`;
  return buildArtifactContractBlock({
    fileWrite: "artifact",
    filePath,
    ...(ctx.projectId ? { projectName: ctx.projectId } : {}),
    ...(opts?.isEdit ? { isEdit: true } : {}),
  });
}

export interface ProjectContext {
  /** Stable project id (for mode lookup, per-project settings). */
  projectId?: string;
  projectPath: string;
  primaryFile: string;
  mode: "wireframe" | "hifi";
  /** Optional design system folder path provided by the user. */
  designSystemPath?: string | null;
  /**
   * Optional design system name (from `design.md` frontmatter or folder name).
   * Purely informational — used in the system prompt header.
   */
  designSystemName?: string | null;
  /**
   * Full content of the selected design system's `design.md`.
   * When present, the system prompt inlines this entire document so the
   * agent can reference tokens, palette, typography without a separate
   * tool call. Without this, the agent only sees the path and must Read
   * the file — which it often skips, so the DS gets silently ignored.
   */
  designSystemMarkdown?: string | null;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  hasDesignSystem: boolean;
  currentHtml?: string;
  /** Optional model override (claude aliases: opus/sonnet/haiku). */
  model?: string;
  /** Working directory to spawn claude CLI in. */
  cwd?: string;
  /** Agent alias: 'claude' (default), 'canvas', etc. */
  agent?: string;
  /**
   * Which provider runs this turn. Drives spawnStream's adapter dispatch.
   * Without this, every invoke* helper (consult/applyStyle/refine/...) silently
   * defaults to Claude even when the picker says Codex/Gemini/Anthropic.
   * Bug surfaced 2026-05-04: badge showed Codex but Claude ran (and rate-limited).
   */
  providerId?: ProviderId;
  /**
   * Persisted Claude CLI session id. When set AND agent is claude, the spawn
   * uses `--resume <id>`: the CLI reloads its JSONL transcript from disk and
   * we skip the plain-text history concat entirely.
   */
  sessionId?: string | null;
  /**
   * Canonical+ direction payload (Format / Rules / Taste from the NewProject
   * modal). When set, every turn's system prompt receives the COMPACT
   * summary (3-5 lines) via buildCanonicalPlusSummary — keeps the direction
   * present without flooding the prompt. User decision 2026-05-17
   * (audit P0-C): compact persistent over one-shot full-block injection.
   */
  canonicalPlus?: CanonicalPlusInput | null;
  /**
   * Per-dial language overrides edited by the user in Settings → Taste.
   * Persisted as `tasteDial:${key}:${stop}` in db.settings. EditorScreen
   * hydrates and passes them in so the compact summary's adjectives
   * (and the full block's phrases) respect customisation.
   */
  dialOverrides?: DialOverrides;
}

/**
 * True when this turn should rely on `--resume` instead of sending history.
 * Two conditions: (1) the spawn is actually going to claude; (2) a stored
 * session id exists for the project.
 */
function canUseClaudeResume(ctx: ProjectContext): boolean {
  const provider = ctx.providerId ?? "claude";
  return provider === "claude" && typeof ctx.sessionId === "string" && ctx.sessionId.length > 0;
}

// ─── PP-01: generate_base ───────────────────────────────────────────────────

/**
 * Context preamble injected into every generate/refine system prompt.
 *
 * Keeps the inline copy small. The full output contract — file vs chat,
 * surgical-edit-first, language matching, anti-patterns, the
 * ::question protocol — lives in `docs/agent-contract.md` and is
 * inlined into the harness's static context (CLAUDE.md / GEMINI.md /
 * AGENTS.md), not duplicated here.
 */
export function workspaceContextPreamble(ctx: ProjectContext): string {
  return [
    "# DesignFactory — project agent session",
    "",
    "You are the Project Agent. The user chats, you produce a file, an",
    "iframe renders the result live. The user sees only PRIMARY_FILE.",
    "",
    "## Session bindings",
    `- PROJECT_PATH: ${ctx.projectPath}`,
    `- PRIMARY_FILE: ${ctx.primaryFile}`,
    "- CWD may equal PROJECT_PATH or its parent. Always use the absolute",
    "  PROJECT_PATH-rooted path above in every Write/Edit — never invent",
    "  a relative path and never search the filesystem for a contract",
    "  file. The contract is already inlined below.",
    "",
    "## Output contract",
    "",
    "- File gets code. Chat gets prose. Never mix them.",
    "  - .html/.htm/.svg files MUST start with `<` after trim. Bridge",
    "    returns HTTP 400 otherwise. Retry with real markup.",
    "  - Chat reply = 1-3 lines of natural prose. No code blocks, no",
    "    backticks, no template literals.",
    "- Match the user's language. Don't translate their copy.",
    "- Editing? Try surgical search-and-replace first. Full regen is the",
    "  last resort. When you fall back, say so in chat.",
    "- Never paste new HTML alongside old HTML. Never duplicate sections",
    "  during edit. Preserve `assets/` and any `tab-N-*.html` siblings.",
    "",
    "## Discrete questions: use the ::question protocol",
    "",
    "::question",
    "header: <1-3 word label>",
    "question: <the full question>",
    "- label: <option> | description: <one-liner>",
    "- label: <option> | description: <one-liner>",
    "::",
    "",
    "Inline in chat (not in a code fence, not via a tool). The user's",
    "pick arrives next turn as `I picked: <label>`.",
    "",
    "## Harness tools that DO NOT EXIST",
    "",
    "AskUserQuestion, ToolSearch — error on call. For discrete options",
    "use the ::question protocol above.",
    ...(ctx.hasDesignSystem && ctx.designSystemMarkdown
      ? [
          "",
          "## Design system attached — USE THESE TOKENS",
          `Name: ${ctx.designSystemName ?? "design-system"}`,
          `Path: ${ctx.designSystemPath ?? "(path)"}`,
          "Schema: @google/design.md (github.com/google-labs-code/design.md)",
          "",
          "Treat every token (colors, typography, spacing, rounded,",
          "components) as SOURCE OF TRUTH. Don't invent new colors or fonts.",
          "",
          "--- BEGIN design.md ---",
          ctx.designSystemMarkdown,
          "--- END design.md ---",
        ]
      : ctx.hasDesignSystem && ctx.designSystemPath
        ? [
            "",
            "## Design system attached",
            `Path: ${ctx.designSystemPath}`,
            "Read `design.md` in that folder. Honour its tokens; don't invent.",
          ]
        : []),
  ].join("\n");
}

// Editable in Settings → Built-in prompts. The wrapper that ships
// alongside (preamble + fidelity + DS path) is computed dynamically per
// project and concatenated by buildGenerateSystem below. Keep this as
// principles, not prescriptions — specific aesthetic direction comes
// from design systems and taste skills loaded per-project.
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

// Visual Craft Contract — applied to FRESH WRITES only (not refines).
//
// Why: the stress matrix (2026-05-19) revealed that even with the SSE
// heartbeat fix delivering all canonical events, Kimi still ships HTML
// with broken JS sintax (unbalanced parens/braces) on complex prompts.
// Codex sometimes ships missing closing tags. Claude shipped fine 7/7
// but a generic contract levels the floor across providers.
//
// Approach: pre-output self-check the model MUST run before calling
// Write. Verifiable markers (closing tags, balanced delimiters) ≠ "be
// creative", so it doesn't constrain Claude while raising the floor.
//
// Refines skip this — they edit pre-existing files and the markers
// are already present by definition.
export const VISUAL_CRAFT_CONTRACT = [
  "## Craft contract",
  "",
  "Before calling Write:",
  "1. Plan once. Internally name: layout, palette (max 3-4 colours), motion (if any), one detail that earns the work.",
  "2. Self-check the file in your head:",
  "   - Opens with <!DOCTYPE html>. Closes with </body></html>.",
  "   - Every <script> closes. Every <style> closes. Every JSX/JS block balances ( [ { → ) ] }.",
  "   - No external assets (no http(s)://, no /static/, no font CDN). Inline everything.",
  "   - No placeholder text (Lorem, Feature 1/2/3, [TODO], emoji decoration).",
  "   - If WebGL/Canvas/audio: handle the failure mode (context null, decode error). One graceful fallback line.",
  "3. Single Write call. Full document. No append-via-multiple-Writes.",
  "",
  "Acceptable: a 18KB single-file HTML where the JS balances, the closing tags are present, the palette is restrained, and one detail (a micro-interaction, a typographic move, a paint quality) elevates it above template.",
  "",
  'NOT acceptable: a file that opens but the iframe shows a blank page because line 240 of the <script> has an unclosed brace. A file with 7 colours when the brief asked for 2. A file with <img src="https://..."> or `@import url(...)` to Google Fonts.',
  "",
  "## Tom da resposta no chat",
  "",
  "User ask 2026-05-21: NÃO escrever frases de hedge/disclaimers tipo:",
  '  ✗ "Ship exigiria duas passadas de polish que não cabem nesta resposta"',
  '  ✗ "sinalizo abaixo os riscos remanescentes"',
  '  ✗ "em uma próxima iteração eu poderia..."',
  '  ✗ "esta versão ainda precisa de mais polish"',
  '  ✗ "para um output production-ready precisaríamos..."',
  "",
  "Just ship. Se há trade-offs, faça a escolha e siga. Se há limites de",
  "tempo/contexto, NÃO informe o usuário — entregue o melhor que conseguir",
  "dentro do escopo silenciosamente. O usuário não quer ler sobre o seu",
  "processo, ele quer o resultado.",
].join("\n");

export function buildGenerateSystem(ctx: ProjectContext, core: string): string {
  const preamble = workspaceContextPreamble(ctx);
  // Canonical+ compact summary — injected into EVERY turn's system
  // prompt (user decision 2026-05-17, audit P0-C). 3-5 lines of
  // Direction / Constraints / Taste so the model never loses the
  // project's editorial frame between iterations.
  const summary = ctx.canonicalPlus
    ? buildCanonicalPlusSummary(ctx.canonicalPlus, ctx.dialOverrides)
    : "";
  // Artifact contract — fires only for artifact-channel providers
  // (gemini-api, openai, openrouter, anthropic, ollama). Empty string
  // for tool-channel providers (claude/codex/etc). Adds the
  // <artifact identifier=... type=... title=...> block specification
  // they need to materialize files via the daemon parser.
  const contract = artifactContractForCtx(ctx);
  return [
    preamble,
    "",
    `Fidelity: ${ctx.mode === "wireframe" ? "Wireframe (skeleton, no polished colours)" : "High fidelity (polished type + real colours)"}`,
    ctx.hasDesignSystem && ctx.designSystemPath
      ? `Design system available at: ${ctx.designSystemPath}`
      : "",
    summary ? `\n${summary}` : "",
    "",
    core,
    "",
    VISUAL_CRAFT_CONTRACT,
    contract,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRefineSystem(ctx: ProjectContext, core: string): string {
  // Refine path carries the compact summary AND the artifact contract.
  // The contract piece is the critical fix from QA matrix 2026-05-18:
  // BYOK providers (openrouter, gemini-api) on default cheap models
  // (Flash Lite) dump markdown fences on edits when they don't see the
  // contract — matrix verdict EDIT_NOT_APPLIED. With the contract
  // injected here, the model emits a real <artifact identifier=...>
  // and the daemon parser materializes the new bytes.
  const summary = ctx.canonicalPlus
    ? buildCanonicalPlusSummary(ctx.canonicalPlus, ctx.dialOverrides)
    : "";
  // F3.2 — Refines are edits by definition; pass isEdit so the artifact
  // contract gains the "emit the WHOLE file even for tiny changes"
  // reminder. Otherwise cheap OpenRouter / Gemini models on small edits
  // return prose explaining the change and trip the
  // "completed without text or artifact" rejection.
  const contract = artifactContractForCtx(ctx, { isEdit: true });
  // Preserve any existing Tweaks panel injected by a prior turn. Without
  // this directive, edits via Codex/Kimi/Claude often strip the panel
  // when refactoring CSS — the user has to regenerate Tweaks from
  // scratch after every refine. User repro 2026-05-20.
  const tweaksPreserve =
    ctx.currentHtml && ctx.currentHtml.includes("df-tweaks-panel")
      ? [
          "",
          "## CRITICAL: existing Tweaks panel detected",
          "The HTML contains a `#df-tweaks-panel` element (built by a previous",
          "turn). This panel MUST be preserved VERBATIM in your output —",
          "do not remove, rename, or restructure it. You may refactor the",
          "surrounding CSS / HTML / scripts freely as long as:",
          "  - Every CSS variable the panel binds to (data-var attributes)",
          "    still exists in :root with a sensible default.",
          "  - The panel's <script> block is kept unchanged so the slider",
          "    bindings keep working.",
          "  - The panel stays as the LAST element before </body>.",
        ].join("\n")
      : "";
  return [summary, summary ? "" : "", core, contract, tweaksPreserve].filter(Boolean).join("\n");
}

export async function invokeGenerateBase(
  userPrompt: string,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  // When we have a Claude session id stored, skip the plain-text concat —
  // the CLI reloads the entire transcript from its own JSONL via --resume.
  // Without a stored session (fresh project, non-claude agent, session file
  // deleted), fall back to the legacy concat path.
  const useResume = canUseClaudeResume(ctx);
  const prompt = useResume
    ? userPrompt
    : (() => {
        const history = ctx.conversationHistory
          .map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.content}`)
          .join("\n");
        return history ? `${history}\nUser: ${userPrompt}` : userPrompt;
      })();

  const core = await getBuiltinPrompt("generate", GENERATE_CORE_SYSTEM, ctx.projectId);
  const system = buildGenerateSystem(ctx, core);
  return spawnStream(
    "generate",
    prompt,
    system,
    {
      onText: callbacks.onText,
      onMeta: callbacks.onMeta,
      onUsage: callbacks.onUsage,
      onResult: callbacks.onResult,
      onToolCall: callbacks.onToolCall,
      onToolResult: callbacks.onToolResult,
      onSession: callbacks.onSession,
      onAuthRequired: callbacks.onAuthRequired,
      onDone: (fullText) => {
        const html = extractHtmlFromOutput(fullText);
        const valid = validateHtml(html);
        if (valid.ok) {
          callbacks.onDone(valid.value);
        } else {
          // Return raw anyway — don't block the user
          callbacks.onDone(html);
        }
      },
      onError: callbacks.onError,
    },
    {
      providerId: ctx.providerId,
      model: ctx.model,
      cwd: ctx.cwd,
      agent: ctx.agent,
      sessionId: useResume ? (ctx.sessionId ?? undefined) : undefined,
    },
  );
}

// ─── PP-02: apply_style ─────────────────────────────────────────────────────

// Editable in Settings → Built-in prompts.
// ─── Consult / Ask mode ───────────────────────────────────────────
// Some user messages are questions, not edit requests. "what do you
// suggest?", "como ficaria se…", "isso aqui ta funcionando?" — the
// user wants conversation, not code. Routing those through the
// generate / patch pipeline produces unwanted regenerations.
//
// invokeConsult takes the question + the current HTML (so Claude can
// see what it's looking at) and returns conversational text only.
// The system prompt forbids Write/Edit so the bridge can't accidentally
// rewrite the file mid-thought.
const CONSULT_SYSTEM = [
  "You are a design + code consultant looking at an HTML document the",
  "user is iterating on. They are asking a question, NOT requesting an",
  "edit. Answer conversationally in 2–6 sentences. Be direct.",
  "",
  "RULES:",
  "- DO NOT use Write, Edit, or any file-modification tool.",
  "- DO NOT paste the HTML or large code blocks. Refer to lines/sections",
  "  by description, not by quoting them verbatim.",
  "- If asked for suggestions, list them as 2–5 short bullets — concrete,",
  "  not generic. Each bullet is one specific change the user could ask",
  "  for next.",
  "- Match the user's language. PT-BR in, PT-BR out.",
  "- Do NOT preface with 'Sure!', 'Great question!', 'Here are…'. Get to",
  "  the answer in the first sentence.",
].join("\n");

export async function invokeConsult(
  question: string,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const useResume = canUseClaudeResume(ctx);
  const html = ctx.currentHtml ?? "";
  const prompt = useResume
    ? question
    : html
      ? `Current HTML (read-only, do not edit):\n\`\`\`html\n${html.slice(0, 12000)}${html.length > 12000 ? "\n…(truncated)" : ""}\n\`\`\`\n\nQuestion: ${question}`
      : question;
  return spawnStream("consult", prompt, CONSULT_SYSTEM, callbacks, {
    providerId: ctx.providerId,
    model: ctx.model,
    cwd: ctx.cwd,
    agent: ctx.agent,
    sessionId: useResume ? (ctx.sessionId ?? undefined) : undefined,
  });
}

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
  const system = buildRefineSystem(ctx, refineCore);
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

  // Verbs that EDIT (polish, rewrite, animate, …) get the Canonical+
  // summary so they honour Direction / Constraints / Taste. Read-only
  // verbs (review, check) skip it — their job is to evaluate, not
  // conform, and the summary would bias the critique.
  const verbSystem = verb.modifiesHtml
    ? buildRefineSystem(ctx, verb.systemPrompt)
    : verb.systemPrompt;
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

// ─── PP-03: edit_element ────────────────────────────────────────────────────

const EDIT_ELEMENT_SYSTEM = [
  "Você recebe HTML existente, um seletor CSS e uma instrução de edição.",
  "Modifique APENAS o elemento indicado. Retorne o HTML completo modificado.",
  "Somente o código. Sem explicações.",
].join("\n");

export async function invokeEditElement(
  selector: string,
  instruction: string,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const prompt = `HTML:\n${ctx.currentHtml || ""}\n\nElemento: ${selector}\nInstrução: ${instruction}`;
  const system = buildRefineSystem(ctx, EDIT_ELEMENT_SYSTEM);
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

// ─── PP-04: add_component ───────────────────────────────────────────────────

const ADD_COMPONENT_SYSTEM = [
  "Você recebe HTML existente e a descrição de um componente a adicionar.",
  "Insira o componente na posição mais lógica do layout.",
  "Retorne o HTML COMPLETO modificado. Somente o código.",
].join("\n");

export async function invokeAddComponent(
  description: string,
  ctx: ProjectContext,
  callbacks: StreamCallbacks,
): Promise<UnlistenFn> {
  const prompt = `HTML:\n${ctx.currentHtml || ""}\n\nAdicionar: ${description}`;
  const system = buildRefineSystem(ctx, ADD_COMPONENT_SYSTEM);
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
