// commands-taxonomy.ts — Slash commands (DF + Claude + Agent).
//
// One of the 7 canonical defaults categories in DF v1:
//   canvas · formats · rules · dials · commands · skills · system prompts
//
// "Commands" are anything the user can invoke by typing `/<name>` in
// the chat. Three kinds live here, all unified under a single catalog:
//
//   - kind "app"      — runs an in-app handler (open tweaks panel,
//                       export menu, terminal). Never sent to the LLM.
//   - kind "agent"    — runs an editorial pass (polish, animate, type,
//                       color, etc). Routes through invokeEditorialVerb;
//                       carries its own systemPrompt body that the agent
//                       receives instead of the default refine prompt.
//   - kind "provider" — passes through to the active provider's native
//                       slash builtins (Claude's /init, /review).
//
// Conceptually distinct from:
//   - skills (extensions a user installs into their library, NOT
//     in-app handlers and NOT bundled in this taxonomy).
//   - verbs as a separate category (HYVE legacy term, retired
//     2026-05-18 — what used to live in runtime/verbs/ are now just
//     `kind: "agent"` commands).
//
// The agent commands' systemPrompt bodies still live as .md files in
// `src/runtime/verbs/*.md` (compiled in via Vite ?raw imports below)
// so authors can edit prompt bodies without touching this catalog.

export type CommandKind = "app" | "agent" | "provider";

export interface BuiltinCommand {
  id: string;
  /** Full trigger token including leading `/` (e.g. `/tweaks`, `/polish`). */
  trigger: string;
  /** Short label shown in the slash menu. */
  label: string;
  /** Optional one-line description. */
  description?: string;
  /** UI grouping in the slash menu. */
  category: string;
  /** Discriminator — see file header. */
  kind: CommandKind;
  /** If true, inserting the command keeps focus + appends a space so the
   *  user can type arguments (e.g. `/tweaks <focus area>`). */
  withArgs?: boolean;
  /** For `kind: "agent"` only: the prompt body the agent receives
   *  instead of the default refine system prompt. Loaded from the
   *  co-located .md file in src/runtime/verbs/. */
  agentSystemPrompt?: string;
  /** For `kind: "agent"` only: whether the response should be parsed
   *  as HTML (replace iframe) or as prose (chat-only). */
  modifiesHtml?: boolean;
}

// Vite ?raw imports — prompt bodies for the agent commands. Bodies stay
// co-located with the registry's loader so authors can hot-edit them.
import reviewMd from "@/runtime/verbs/review.md?raw";
import polishMd from "@/runtime/verbs/polish.md?raw";
import rewriteMd from "@/runtime/verbs/rewrite.md?raw";
import checkMd from "@/runtime/verbs/check.md?raw";
import animateMd from "@/runtime/verbs/animate.md?raw";
import typeMd from "@/runtime/verbs/type.md?raw";
import colorMd from "@/runtime/verbs/color.md?raw";
import simplifyMd from "@/runtime/verbs/simplify.md?raw";
import reinforceMd from "@/runtime/verbs/reinforce.md?raw";

// Strip the YAML frontmatter from a .md file — return only the body.
// Matches the lightweight parser in runtime/verbs/registry.ts.
function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
  return (m ? m[1] : raw).trim();
}

// User ask 2026-05-21: "quero so os editorial verbs e agora devem
// se chamar commands". The taxonomy used to carry three families:
//   • app handlers (`/tweaks`, `/edit`, `/export`, `/present`,
//     `/terminal`) — already pill-bound on the canvas toolbar
//   • editorial agent verbs (`/polish`, `/rewrite`, etc.)
//   • Claude CLI passthroughs (`/init`, `/review`)
// The app handlers are reachable from the toolbar; the Claude
// passthroughs are CLI tricks nobody invokes from chat. Dropping
// both leaves a single canonical surface — the nine Commands a chat
// user actually types.
export const DEFAULT_BUILTIN_COMMANDS: ReadonlyArray<BuiltinCommand> = Object.freeze([
  // evaluate (read-only — agent returns prose, not HTML)
  {
    id: "review",
    trigger: "/review-pass",
    label: "Review",
    description: "Editorial critique of the current design",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(reviewMd),
    modifiesHtml: false,
  },
  {
    id: "check",
    trigger: "/check",
    label: "Check",
    description: "Technical health check — a11y, responsive, perf",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(checkMd),
    modifiesHtml: false,
  },
  // refine (mutates HTML)
  {
    id: "polish",
    trigger: "/polish",
    label: "Polish",
    description: "Tighten the design — type, spacing, hierarchy",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(polishMd),
    modifiesHtml: true,
  },
  {
    id: "rewrite",
    trigger: "/rewrite",
    label: "Rewrite",
    description: "Rebuild the current section with a fresh approach",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(rewriteMd),
    modifiesHtml: true,
  },
  {
    id: "simplify",
    trigger: "/simplify",
    label: "Simplify",
    description: "Strip what doesn't need to be there",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(simplifyMd),
    modifiesHtml: true,
  },
  {
    id: "reinforce",
    trigger: "/reinforce",
    label: "Reinforce",
    description: "Production-ready — errors, empty states, edge cases",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(reinforceMd),
    modifiesHtml: true,
  },
  // enhance (mutates HTML)
  {
    id: "animate",
    trigger: "/animate",
    label: "Animate",
    description: "Bring it to life with motion",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(animateMd),
    modifiesHtml: true,
  },
  {
    id: "type",
    trigger: "/type",
    label: "Type",
    description: "Sharper typography hierarchy",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(typeMd),
    modifiesHtml: true,
  },
  {
    id: "color",
    trigger: "/color",
    label: "Color",
    description: "Strategic color where it's missing",
    category: "Commands",
    kind: "agent",
    agentSystemPrompt: stripFrontmatter(colorMd),
    modifiesHtml: true,
  },
]);

// Triggers hidden from the autocomplete suggestion list.
//
// User ask 2026-05-21 (third pass): keep the dropup useful — show
// the Editorial verbs (polish/rewrite/simplify/reinforce/animate/
// type/color/review-pass/check) and the provider passthroughs
// (init/review) which the user does invoke from chat, but hide the
// six in-app actions that already have a dedicated pill on the canvas
// toolbar. Surfacing them again in the dropup is noise and they were
// flagged as "actions que nem deveriam existir" — they belong to the
// pill row, not the slash menu.
export const HIDDEN_FROM_AUTOCOMPLETE: ReadonlySet<string> = new Set([
  "/tweaks", // canvas toolbar pill
  "/edit", // canvas toolbar pill
  "/comment", // canvas toolbar pill
  "/present", // canvas toolbar pill
  "/terminal", // canvas toolbar pill
  "/export", // Share menu
]);

/** Quick lookup helper. */
export function findCommandByTrigger(trigger: string): BuiltinCommand | null {
  const t = trigger.startsWith("/") ? trigger : `/${trigger}`;
  return DEFAULT_BUILTIN_COMMANDS.find((c) => c.trigger === t) ?? null;
}

/** Filter by kind — UI may want only `app` (for the toolbar) or only
 *  `agent` (for the editorial library drawer). */
export function commandsByKind(kind: CommandKind): BuiltinCommand[] {
  return DEFAULT_BUILTIN_COMMANDS.filter((c) => c.kind === kind);
}
