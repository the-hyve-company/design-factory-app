// Coerce a provider's raw text response into a usable design.md.
//
// Why this exists: agentic CLIs (notably Claude Code / opus) reliably
// produce a complete design.md — YAML frontmatter + `## …` body — but
// frequently OMIT the closing `---` frontmatter fence, jumping straight
// from the last YAML key to `## Overview`. The old validator
// (`/^---\s*\n[\s\S]*?\n---/m || /^#\s+\S/m`) hard-failed that: no
// closing fence → frontmatter branch misses, and the body uses `##`
// (h2, per the generation prompt) not `# ` (h1) → heading branch misses.
// A 205-line, well-written doc got thrown away. Observed with
// provider=claude, model=opus, 10663B, looksLikeMd=false.
//
// coerceDesignMd repairs the common malformations (unclosed frontmatter,
// whole-body / inline ```markdown fence, short prose lead-in) and then
// validates. It still rejects genuine non-docs (tool-use summary prose,
// refusals) so a bad response never gets written as design.md.
//
// @file apps/daemon/src/ds-coerce.mjs

/**
 * @param {string} rawText  Raw provider response.
 * @returns {{ md: string, ok: boolean, reason: string }}
 */
export function coerceDesignMd(rawText) {
  let md = typeof rawText === "string" ? rawText.trim() : "";
  if (!md) return { md: "", ok: false, reason: "empty" };

  // 1. Strip a ```markdown fence wrapping the WHOLE body.
  const whole = md.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (whole) md = whole[1].trim();

  const firstNonEmpty = (t) => t.split("\n").find((l) => l.trim() !== "") || "";
  const looksLikeStart = (t) => {
    const f = firstNonEmpty(t).trim();
    return f === "---" || /^#{1,6}\s+\S/.test(f);
  };

  // 2. Prose-wrapped: pull out a fenced block that is itself a doc.
  if (!looksLikeStart(md)) {
    const fenced = md.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/);
    if (fenced && looksLikeStart(fenced[1].trim())) md = fenced[1].trim();
  }

  // 3. Slice a SHORT prose lead-in ("Here's the design.md:") down to the
  //    first frontmatter opener, or to a heading when the preamble is
  //    short. A long prose block before a heading is likely a tool-use
  //    summary, not a doc — don't salvage it (keeps the anti-garbage guard
  //    meaningful).
  if (!looksLikeStart(md)) {
    const lines = md.split("\n");
    let idx = lines.findIndex((l) => l.trim() === "---");
    if (idx < 0) {
      const hIdx = lines.findIndex((l) => /^#{1,6}\s+\S/.test(l));
      if (hIdx > 0 && lines.slice(0, hIdx).join("\n").length < 200) idx = hIdx;
    }
    if (idx > 0) md = lines.slice(idx).join("\n").trim();
  }

  // 4. Repair an UNCLOSED YAML frontmatter — the core fix. If the body
  //    opens with `---` and there's no closing `---` before the first
  //    markdown heading, insert the closing fence right before it so the
  //    downstream YAML parser succeeds.
  if (firstNonEmpty(md).trim() === "---") {
    const lines = md.split("\n");
    let headingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (/^#{1,6}\s+\S/.test(lines[i])) {
        headingIdx = i;
        break;
      }
    }
    const closeLimit = headingIdx === -1 ? lines.length : headingIdx;
    let hasClose = false;
    for (let i = 1; i < closeLimit; i++) {
      if (lines[i].trim() === "---") {
        hasClose = true;
        break;
      }
    }
    if (!hasClose && headingIdx !== -1) {
      let end = headingIdx;
      while (end > 1 && lines[end - 1].trim() === "") end--;
      md = [...lines.slice(0, end), "---", "", ...lines.slice(headingIdx)].join("\n");
    }
  }

  // 5. Validate. A real design.md has a CLOSED frontmatter block or
  //    starts with a markdown heading. Tool-use summaries / refusals
  //    have neither → rejected.
  const hasClosedFrontmatter = /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/.test(md);
  const startsWithHeading = /^#{1,6}\s+\S/.test(md);
  const ok = md.length >= 40 && (hasClosedFrontmatter || startsWithHeading);
  return { md, ok, reason: ok ? "ok" : md.length < 40 ? "too-short" : "no-structure" };
}
