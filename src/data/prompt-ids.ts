// prompt-ids.ts — pure constants/types for editable prompt slots.
//
// Lives outside prompts-taxonomy.ts so consumers in src/runtime/ can
// reference these IDs without pulling the full prompt bodies (which
// would cycle back through prompt-invoker → builtin-prompts).

export type EditablePromptId = "generate" | "refine" | "tweaks";

export const EDITABLE_PROMPT_IDS: ReadonlyArray<EditablePromptId> = [
  "generate",
  "refine",
  "tweaks",
];
