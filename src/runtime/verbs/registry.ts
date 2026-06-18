// Editorial verbs registry. Loads built-in agent-command prompts from
// `src/data/commands-taxonomy.ts` (canonical source post-2026-05-18),
// parses the YAML-ish frontmatter inside each .md body, and exposes a
// typed Verb list for legacy consumers (CommandsSettingsPanel, slash
// dispatch). Custom user verbs and overrides still come from
// `~/.design-factory/commands/*.md` and are merged at runtime via the
// bridge — see loadAllVerbs below.
//
// "Verbs" here is the legacy name for the `kind: "agent"` entries in
// the commands taxonomy. They share id space and prompts; this file is
// the loader/adapter, not a separate catalog anymore.
//
// Built-in roster (DF v1 release, 2026-05-17):
//
//   evaluate · review, check
//   refine   · polish, rewrite, simplify, reinforce
//   enhance  · animate, type, color
//
// Users add more via ~/.design-factory/commands/. The remaining
// co-located .md files (bolder, calmer, charm, export-video) are
// reference-only; surface them by adding entries to the canonical
// commands taxonomy.

import { DEFAULT_BUILTIN_COMMANDS, type BuiltinCommand } from "@/data/commands-taxonomy";

export type VerbCategory = "evaluate" | "refine" | "direction" | "enhance" | "fix" | "export";
export type VerbHue = "cool-blue" | "warm-gold" | "warm-coral" | "cool-purple" | "neutral";
export type VerbSource = "builtin" | "override" | "custom";

export interface Verb {
  id: string;
  label: string;
  description: string;
  category: VerbCategory;
  hue: VerbHue;
  modifiesHtml: boolean;
  icon: string;
  systemPrompt: string;
  source: VerbSource;
  disabled?: boolean;
}

// Map the canonical taxonomy's agent commands into the Verb shape this
// module exposes. The taxonomy carries the systemPrompt body already
// stripped of frontmatter; we synthesise the rest of the Verb fields
// from BuiltinCommand metadata.
function agentCommandToVerb(c: BuiltinCommand): Verb | null {
  if (c.kind !== "agent") return null;
  const systemPrompt = c.agentSystemPrompt ?? "";
  if (!systemPrompt) return null;
  return {
    id: c.id,
    label: c.label,
    description: c.description ?? "",
    category: categoryForAgentCommand(c.id),
    hue: hueForAgentCommand(c.id),
    modifiesHtml: c.modifiesHtml === true,
    icon: iconForAgentCommand(c.id),
    systemPrompt,
    source: "builtin",
  };
}

// Per-id metadata that doesn't live in the taxonomy (the taxonomy keeps
// the strictly slash-menu-relevant fields). These maps mirror the
// frontmatter values from the original .md files.
function categoryForAgentCommand(id: string): VerbCategory {
  switch (id) {
    case "review":
    case "check":
      return "evaluate";
    case "polish":
    case "rewrite":
    case "simplify":
    case "reinforce":
      return "refine";
    case "animate":
    case "type":
    case "color":
      return "enhance";
    default:
      return "refine";
  }
}
function hueForAgentCommand(id: string): VerbHue {
  switch (id) {
    case "review":
    case "check":
      return "cool-blue";
    case "polish":
    case "rewrite":
    case "simplify":
    case "reinforce":
      return "warm-gold";
    case "animate":
    case "type":
    case "color":
      return "cool-purple";
    default:
      return "neutral";
  }
}
function iconForAgentCommand(id: string): string {
  switch (id) {
    case "review":
      return "eye";
    case "check":
      return "shield-check";
    case "polish":
      return "sparkles";
    case "rewrite":
      return "edit-3";
    case "simplify":
      return "minimize";
    case "reinforce":
      return "shield";
    case "animate":
      return "play";
    case "type":
      return "type";
    case "color":
      return "palette";
    default:
      return "command";
  }
}

// Display order — used by Library drawer and slash menu. `export` lands
// last because it's a terminal action, not a refinement step.
export const CATEGORY_ORDER: VerbCategory[] = [
  "evaluate",
  "refine",
  "direction",
  "enhance",
  "fix",
  "export",
];

export const CATEGORY_LABEL: Record<VerbCategory, string> = {
  evaluate: "Evaluate",
  refine: "Refine",
  direction: "Direction",
  enhance: "Enhance",
  fix: "Fix",
  export: "Export",
};

export const HUE_TOKEN: Record<VerbHue, string> = {
  "cool-blue": "var(--df-accent-info, #6b9bd1)",
  "warm-gold": "var(--df-accent-warm, #c7955a)",
  // warm-coral now points to the calibrated export hue from
  // anime-hyperframes-poc.md (oklch ~0.69 0.10 35).
  "warm-coral": "var(--df-hue-export, #d88a6b)",
  "cool-purple": "var(--df-accent-purple, #9b7dc7)",
  neutral: "var(--df-text-muted, #888)",
};

// Naive YAML frontmatter extractor — supports flat key:value pairs only.
// We control the .md format so a full YAML parser is overkill.
function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return { fm, body: match[2].trim() };
}

function verbFromMarkdown(raw: string, source: VerbSource): Verb | null {
  const { fm, body } = parseFrontmatter(raw);
  const id = fm.id;
  if (!id) return null;
  const category = (fm.category as VerbCategory) || "refine";
  if (!CATEGORY_ORDER.includes(category)) return null;
  const hue = (fm.hue as VerbHue) || "neutral";
  return {
    id,
    label: fm.label || id,
    description: fm.description || "",
    category,
    hue: HUE_TOKEN[hue] ? hue : "neutral",
    modifiesHtml: fm.modifiesHtml === "true" || fm.modifiesHtml === undefined,
    icon: fm.icon || "command",
    systemPrompt: body,
    source,
  };
}

export function loadBuiltinVerbs(): Verb[] {
  // Builtins now flow from the canonical commands taxonomy. We map
  // each `kind: "agent"` entry into the legacy Verb shape via the
  // adapter above. Order matches DEFAULT_BUILTIN_COMMANDS, which keeps
  // the categories grouped (evaluate → refine → enhance).
  const out: Verb[] = [];
  for (const cmd of DEFAULT_BUILTIN_COMMANDS) {
    const v = agentCommandToVerb(cmd);
    if (v) out.push(v);
  }
  return out;
}

// Load full set: built-ins + user customs/overrides + disabled flags from
// config.json. Falls back to built-ins-only on any failure (the slash menu
// + library still work for first-run users without custom commands).
//
// `fetchHidden` returns the ids of built-ins the user has hidden
// permanently (Settings → Defaults → Commands → "Delete" on a built-in).
// Hidden ids are dropped from the result entirely — they disappear from
// the slash menu, Library, and EditorScreen invocation paths until
// restored via the panel's tray.
export async function loadAllVerbs(
  fetchCustomList: () => Promise<{ id: string; body: string }[]>,
  fetchDisabled: () => Promise<string[]>,
  fetchHidden?: () => Promise<string[]>,
): Promise<Verb[]> {
  const builtins = loadBuiltinVerbs();
  const byId = new Map<string, Verb>(builtins.map((v) => [v.id, v]));

  try {
    const customs = await fetchCustomList();
    for (const { id, body } of customs) {
      const v = verbFromMarkdown(body, byId.has(id) ? "override" : "custom");
      if (v) byId.set(id, { ...v, id });
    }
  } catch {
    // Custom list unavailable — proceed with built-ins.
  }

  let disabled: string[] = [];
  try {
    disabled = await fetchDisabled();
  } catch {
    // disabled list unavailable
  }
  for (const id of disabled) {
    const v = byId.get(id);
    if (v) byId.set(id, { ...v, disabled: true });
  }

  if (fetchHidden) {
    try {
      const hidden = await fetchHidden();
      for (const id of hidden) {
        const v = byId.get(id);
        if (v && (v.source === "builtin" || v.source === "override")) byId.delete(id);
      }
    } catch {
      // hidden list unavailable
    }
  }

  return Array.from(byId.values());
}

export function groupByCategory(verbs: Verb[]): Record<VerbCategory, Verb[]> {
  const groups: Record<VerbCategory, Verb[]> = {
    evaluate: [],
    refine: [],
    direction: [],
    enhance: [],
    fix: [],
    export: [],
  };
  for (const v of verbs) {
    if (v.disabled) continue;
    groups[v.category].push(v);
  }
  return groups;
}

// Match a chat message against the verb registry. Returns the verb and the
// remaining argument string, or null if no match.
export function matchVerb(message: string, verbs: Verb[]): { verb: Verb; args: string } | null {
  const m = message.match(/^\s*\/([\w-]+)\b\s*([\s\S]*)$/);
  if (!m) return null;
  const trigger = m[1].toLowerCase();
  const verb = verbs.find((v) => v.id === trigger && !v.disabled);
  if (!verb) return null;
  return { verb, args: m[2].trim() };
}
