// skills-taxonomy.ts — Installable extensions.
//
// One of the 7 canonical defaults categories in DF v1:
//   canvas · formats · rules · dials · commands · skills · system prompts
//
// "Skills" are bundles a user installs into their library. They extend
// the agent's capability surface (e.g. a Responsive Audit skill, a
// Dark Mode generator, a Video-Ready post-pass). Skills are
// CONCEPTUALLY DISTINCT from commands:
//   - commands are slash triggers built into the platform (typed `/x`)
//   - skills are user-managed library entries selected per-project
//     via the NewProject modal (or attached later via the project
//     drawer)
//
// User model (canon 2026-05-18, amended 2026-07-02): bundled skills
// live ON DISK, not in this array. DF ships a curated set of
// third-party skills under `<repoRoot>/skills/{slug}/SKILL.md` — six
// today, each with an upstream LICENSE and/or provenance NOTICE.md
// recorded in the root NOTICE file (§ Third-party bundled skills).
// The daemon's registry walker (GET /skills/registry) serves those
// alongside anything the user installs or imports.
//
// THIS taxonomy array is a separate, in-app channel and it stays
// empty: bundled + user skills reach the UI through the registry, so
// hardcoding entries here would duplicate the source of truth. The
// runtime + UI must therefore:
//   1. Render correctly when this array is empty (it is).
//   2. Keep working when the user deletes every skill on disk — the
//      registry returning zero rows is a valid state.
//
// If an entry ever lands here, it follows this shape:

export interface BuiltinSkill {
  id: string;
  /** Human label for the picker. */
  label: string;
  /** One-liner describing the capability. */
  description?: string;
  /** Optional category for picker grouping ("audit", "transform", "post-pass"). */
  category?: string;
  /** Markdown body the agent receives — instructions for applying
   *  this skill to the current project state. Mirrors the .md body
   *  pattern that command agents (formerly verbs) use. */
  body: string;
  /** If true, response is parsed as HTML and replaces the iframe;
   *  otherwise the response is surfaced in chat as prose. */
  modifiesHtml: boolean;
}

/** In-app builtin skills. Deliberately empty — DF's bundled skills ship
 *  on disk under `skills/` and are served by the daemon registry (see
 *  header comment). The runtime is contract-correct with the empty list. */
export const DEFAULT_BUILTIN_SKILLS: ReadonlyArray<BuiltinSkill> = Object.freeze([]);
