// skill-capability-gate.ts — capability gating for skill offerings.
//
// A skill can declare output channels it depends on via the `requires:`
// frontmatter list in its SKILL.md (e.g. `requires: ["image-generation"]`).
// Most `requires` values ("tools", "mcp", "sub-agents") are informational,
// but a channel NO DF provider offers makes the skill undispatchable: the
// model would receive instructions it cannot execute on any of the 10
// adapters. Those skills stay on disk and in the library (curated,
// licensed — see NOTICE § Third-party bundled skills), but the slash menu
// does not offer them.
//
// Today the only gated channel is image generation: every DF provider
// (5 CLI agents, 4 BYOK APIs, Ollama) speaks text/HTML — none exposes an
// image-output channel. When one does, remove the entry from this set and
// the gated skills surface again without touching their SKILL.md.

/** Output channels no DF provider currently supports. */
export const UNSUPPORTED_CHANNELS: ReadonlySet<string> = new Set(["image-generation"]);

/**
 * True when every channel the skill requires is available — i.e. the skill
 * can be offered in the slash menu. Skills with no `requires` (or with only
 * informational values) are always offered.
 */
export function isSkillOffered(skill: { requires?: readonly string[] | null }): boolean {
  const requires = skill.requires ?? [];
  return !requires.some((channel) => UNSUPPORTED_CHANNELS.has(channel));
}
