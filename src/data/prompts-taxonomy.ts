// prompts-taxonomy.ts — Editable system prompts.
//
// One of the 7 canonical defaults categories in DF v1:
//   canvas · formats · rules · dials · commands · skills · system prompts
//
// The runtime composes a per-turn system prompt from multiple sources:
//   - the workspace preamble (DesignFactory contract)
//   - the canonical+ summary (Direction + Constraints + Taste)
//   - the design system markdown (when attached)
//   - the artifact contract block (for artifact-channel providers)
//   - one of the EDITABLE BODIES from this file
//
// Three bodies are user-editable from Settings → Built-in prompts:
//
//   - `generate` — the core writer body used by invokeGenerateBase
//                  (fresh writes).
//   - `refine`   — the body used by invokeApplyStyle + editorial agent
//                  commands (mutations).
//   - `tweaks`   — the interactive tweaks-panel body used by the
//                  tweaks generator.
//
// User edits are persisted as `db.setSetting("builtin_prompt:${id}")`
// and the runtime resolves the cascade `override > default` via
// `getBuiltinPrompt()` (src/runtime/builtin-prompts.ts).
//
// Hidden system prompts (consult, edit-element, add-component,
// patch, ds-generation, ...) live next to their callers in
// src/runtime/*.ts; they are not user-editable today and don't belong
// in the taxonomy. Bringing them under the cascade is a future task.

export { EDITABLE_PROMPT_IDS, type EditablePromptId } from "@/data/prompt-ids";
import type { EditablePromptId } from "@/data/prompt-ids";

export interface BuiltinPrompt {
  id: EditablePromptId;
  /** Label shown in Settings → Built-in prompts. */
  label: string;
  /** One-liner shown under the label. */
  description: string;
  /** Default body shipped with the platform. User override (when
   *  set in db.settings) wins over this at runtime. */
  body: string;
}

// ─── Default bodies — sourced from prompt-invoker.ts ───────────────
//
// The three editable bodies live as `export const` in prompt-invoker
// because the runtime call sites (invokeGenerateBase / invokeApplyStyle
// / tweaks generator) consume them in-place. We re-import them here so
// this taxonomy is the canonical INDEX (typed metadata + lookups) over
// the SAME strings the runtime uses — no drift between Settings UI
// preview and what actually ships at spawn time.
//
// Future cleanup: invert the dependency (taxonomy owns the strings,
// prompt-invoker imports via getDefaultPromptBody). Blocked today by
// the TWEAKS_INTERACTIVE_SYSTEM body being tightly coupled to the
// tweaks generator's schema code — moving it requires restructuring
// that file. Re-import is the lowest-risk landing for the v1 audit
// canonicalisation pass.

import {
  GENERATE_CORE_SYSTEM,
  REFINE_SYSTEM,
  TWEAKS_SYSTEM_PROMPT,
} from "@/runtime/prompt-invoker";

export const DEFAULT_BUILTIN_PROMPTS: ReadonlyArray<BuiltinPrompt> = Object.freeze([
  {
    id: "generate",
    label: "Generate",
    description: "Fresh writes — the core writer body used on the first turn and any rewrite.",
    body: GENERATE_CORE_SYSTEM,
  },
  {
    id: "refine",
    label: "Refine",
    description: "Surgical edits — applied to existing HTML for follow-up turns.",
    body: REFINE_SYSTEM,
  },
  {
    id: "tweaks",
    label: "Tweaks",
    description: "Interactive tweaks panel — controls + state for live design tuning.",
    body: TWEAKS_SYSTEM_PROMPT,
  },
]) as ReadonlyArray<BuiltinPrompt>;

/** Lookup helper used by Settings UI + future getBuiltinPrompt cascade. */
export function getDefaultPromptBody(id: EditablePromptId): string {
  const entry = DEFAULT_BUILTIN_PROMPTS.find((p) => p.id === id);
  return entry?.body ?? "";
}
