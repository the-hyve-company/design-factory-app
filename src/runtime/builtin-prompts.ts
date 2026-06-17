import { db } from "@/lib/claude-bridge";
import { EDITABLE_PROMPT_IDS, type EditablePromptId } from "@/data/prompt-ids";

// Runtime reader for Settings > Built-in prompts overrides. When the user
// edits a prompt in Settings we persist to `db.setSetting("builtin_prompt:{id}")`;
// the runtime call sites wrap their hardcoded default through this helper so
// the override takes effect on the next LLM invocation.
//
// Cascade (first match wins):
//   1. Global builtin_prompt:{key} override
//   2. Hardcoded fallback passed by the caller (taxonomy default body)
//
// Supported keys mirror EDITABLE_PROMPT_IDS in
// `src/data/prompts-taxonomy.ts` — the canonical defaults source post
// 2026-05-18. Settings UI + runtime callers both read from there.

const SUPPORTED_KEYS: Set<EditablePromptId> = new Set(EDITABLE_PROMPT_IDS);

export async function getBuiltinPrompt(
  key: string,
  fallback: string,
  _projectId?: string,
): Promise<string> {
  if (!SUPPORTED_KEYS.has(key as EditablePromptId)) return fallback;
  try {
    const stored = await db.getSetting(`builtin_prompt:${key}`);
    if (stored && typeof stored === "string" && stored.trim()) return stored;
  } catch {}
  return fallback;
}
