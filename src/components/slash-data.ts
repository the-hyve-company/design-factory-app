// Slash-menu data + helpers, isolated from the React component file so
// React Fast Refresh can hot-update SlashMenu.tsx without falling back
// to a full page reload. Vite was logging this 3+ times per session:
//   [vite] hmr invalidate /src/components/SlashMenu.tsx
//   Could not Fast Refresh ("CLAUDE_BUILTINS" export is incompatible).
// React-Refresh requires a component file to export only components.
// Mixing constants + the SlashMenu component forced full reloads,
// which interacted badly with the chat-persist effect's state lifecycle
// and contributed to the duplication / "starting..." issues. Fix
// 2026-04-27: keep the data + helpers here, the component there.
//
// 2026-05-18 — Canonical defaults migration: the catalog itself moved
// to `src/data/commands-taxonomy.ts` (one of the 7 canonical
// categories: canvas · formats · rules · dials · commands · skills ·
// system prompts). This file is now a thin adapter that picks the
// `app` + `provider` kinds (slash-menu visible commands) from the
// unified taxonomy and shapes them as legacy `SlashCommand` rows for
// the existing UI consumers. Agent commands (formerly "verbs") share
// the same data file but are loaded by their own runtime registry —
// they don't appear in this menu's autocomplete by default.

import { HIDDEN_FROM_AUTOCOMPLETE as TAXONOMY_HIDDEN } from "@/data/commands-taxonomy";

export interface SlashCommand {
  id: string;
  trigger: string; // full trigger token including leading / or @ (e.g. "/canvas", "@canvas")
  label: string;
  description?: string;
  category?: string;
  /** If true, selecting inserts the trigger + space and keeps focus for args. */
  withArgs?: boolean;
}

// User ask 2026-05-21: "quero so os editorial verbs e agora devem
// se chamar commands". The taxonomy used to expose two helper
// arrays here — `DF_BUILTINS` (kind: "app") and `CLAUDE_BUILTINS`
// (kind: "provider") — that fed older dropup sections. With both
// kinds removed from `DEFAULT_BUILTIN_COMMANDS`, those filters
// returned empty and the exports became dead weight. Removed
// entirely along with the legacy `SLASH_COMMANDS` aggregator and
// the `toSlashCommand` adapter that only existed to feed them. The
// only remaining surface is the editorial verb set, which lives in
// `runtime/verbs/registry.ts` and reaches the dropup as the
// "Commands" bucket built by EditorScreen.

// Triggers hidden from the autocomplete suggestions because they have
// a dedicated toolbar pill on the canvas. Typing the trigger still
// works (graceful), but the suggestion list won't push these in front
// of skills the user is more likely to want. Now sourced from the
// canonical taxonomy.
const HIDDEN_FROM_AUTOCOMPLETE: Set<string> = new Set(TAXONOMY_HIDDEN);

// Caller composes the full ordered list (verbs > skills > DF_BUILTINS
// > CLAUDE_BUILTINS) and passes it in. findMatches only filters and
// ranks — it does not auto-merge. This lets EditorScreen put HYVE
// editorial verbs at the top of the autocomplete (highest priority
// for designers) without a hardcoded order in this component.
export function findMatches(query: string, commands: SlashCommand[]): SlashCommand[] {
  const merged = commands;
  const q = query.toLowerCase();
  const isInitial = !q || q === "/" || q === "@";

  // Initial state: drop pill-redundant triggers from the suggestion list.
  if (isInitial) {
    return merged.filter((c) => !HIDDEN_FROM_AUTOCOMPLETE.has(c.trigger));
  }

  // Active query: rank prefix > substring. Hidden triggers can match only
  // if the user is typing toward them explicitly (so /tw still finds
  // /tweaks for power-users who want it), via the prefix branch.
  const starts: SlashCommand[] = [];
  const includes: SlashCommand[] = [];
  for (const c of merged) {
    const hidden = HIDDEN_FROM_AUTOCOMPLETE.has(c.trigger);
    const t = c.trigger.toLowerCase();
    const l = c.label.toLowerCase();
    const startsWith = t.startsWith(q) || l.startsWith(q.replace(/^[/@]/, ""));
    const includesQ =
      t.includes(q) || l.includes(q) || (c.description || "").toLowerCase().includes(q);
    if (startsWith) {
      starts.push(c);
    } else if (includesQ && !hidden) {
      includes.push(c);
    }
  }
  return [...starts, ...includes];
}

/** Extracts the trigger token the cursor is currently in. Returns null if no / or @ context. */
export function triggerAtCursor(
  value: string,
  cursor: number,
): { token: string; start: number } | null {
  // Walk back from cursor until whitespace or start
  let i = cursor - 1;
  while (i >= 0 && !/\s/.test(value[i])) i--;
  const start = i + 1;
  const token = value.slice(start, cursor);
  if (!token) return null;
  if (token.startsWith("/") || token.startsWith("@")) return { token, start };
  return null;
}
