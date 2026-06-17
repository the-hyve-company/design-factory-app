// Fixed prompt template for the DS preview generation flow.
//
// Lives on the daemon (not the frontend) so a CLI call to
// /ds/generate-preview gets the exact same instructions the GUI sends,
// and so the rules can't drift between the React modal and whatever
// downstream caller (CI, scripts) may invoke the endpoint later.
//
// Design intent: the user wrote a design.md describing tokens, rules,
// components, atmosphere. The LLM's job is to render that as ONE
// self-contained HTML page exercising the system on realistic UI
// surfaces — nav, hero, buttons, forms, cards, stats, table, type
// ramp, palette, radii, spacing, footer. We're not asking it to invent
// — we're asking it to apply, exactly, what the document already says.
//
// Return shape is strict: ONLY raw HTML starting at <!DOCTYPE html>.
// The endpoint strips any ``` fence the model might wrap it in, but
// the prompt asks plainly so most providers comply.
//
// @file apps/daemon/src/ds-preview-prompt.mjs

/**
 * Build the full prompt to send to a provider for DS preview generation.
 *
 * @param {string} designMd  Raw design.md content (full document).
 * @param {string} dsName    Human-readable DS name (used in the hero copy).
 * @returns {string}         Single string ready to pipe to a provider.
 */
export function buildDsPreviewPrompt(designMd, dsName) {
  return `You are a senior frontend engineer rendering a design system as a single self-contained HTML page.

INPUT: a design.md document defining tokens, components, and brand rules for the "${dsName}" design system.

OUTPUT: a single complete HTML document (<!DOCTYPE html>…</html>) that:

1. Applies EVERY color, font family, font weight, font size, line height, letter spacing, spacing token, radius, shadow, and border described in the design.md — exactly as authored, not approximated. If the doc says \`{rounded.lg}\` = 12px, every card uses 12px.
2. Loads required typography from Google Fonts via <link rel="stylesheet">. If a font isn't on Google Fonts (e.g. custom commercial face), fall back to the nearest equivalent and add a comment.
3. Composes a realistic preview that exercises the system end-to-end:
   - top navigation (logo + 3–7 links + 1–2 CTAs matching the doc's nav grammar)
   - hero (display headline + subhead + CTA cluster, applying display tokens and any atmospheric motif the doc describes — gradient spotlights, mesh gradients, full-bleed photo backdrop, editorial restraint, etc.)
   - buttons gallery (primary / secondary / ghost variants × 3 sizes — 9 buttons total, each at the exact button radius the doc maps)
   - form (inputs at the input radius, with labels and a submit button)
   - content cards (using the card radius, card shadow, and card surface the doc specifies)
   - stats row (3–4 metric tiles)
   - data table (using the doc's table conventions)
   - type ramp (one row per typography token in the doc, with the token name + actual sample text rendered at the right family/size/weight/line-height/tracking)
   - palette swatches (every color in the doc, with name + hex)
   - radii showcase (96px boxes, one per radius token, so radius differences are visible at true scale)
   - spacing rhythm (horizontal bars per spacing token, showing relative scale)
   - footer
4. Honors the brand's visual language as described in prose: density (dense / default / roomy), atmospheric motifs, do's and don'ts, photography/illustration grammar, uppercase or normal-case display, button fill style (solid vs outline), shadow personality (layered vs flat vs hairline), border philosophy.
5. Is ONE HTML file: all CSS inline in a <style> block, no JavaScript, no external assets except the Google Fonts <link>. Sandboxable.
6. Returns ONLY raw HTML. No markdown wrapper, no \`\`\`html fence, no commentary, no explanation. The very first characters of your response must be \`<!DOCTYPE html>\`.

ABSOLUTE CONSTRAINTS:

- DO NOT use any tools. No Write, no Edit, no Bash, no file operations. Your reply text IS the deliverable.
- DO NOT save the HTML to a file. DO NOT run shell commands. DO NOT touch the filesystem in any way.
- If you have file-editing tools available, ignore them entirely for this task. Respond with raw HTML in your text reply only.
- The system that called you reads your stdout text and writes it to disk on its own. Writing a file yourself causes a duplicate / wrong file.

Be faithful. The design.md is the spec, not a starting point.

---

design.md follows:

${designMd}

---

Return the complete HTML now. Starting with <!DOCTYPE html>.`;
}

/**
 * Strip whatever markdown fence the model may have wrapped around the
 * HTML — most providers comply with "return only HTML" but some
 * (especially smaller models) still wrap in ```html or include a
 * preamble like "Here's the HTML:". Returns the raw HTML payload.
 *
 * @param {string} raw  Full text response from the provider.
 * @returns {string}    HTML payload, starting at <!DOCTYPE or <html.
 */
export function stripHtmlFence(raw) {
  if (typeof raw !== "string") return "";
  let text = raw.trim();

  // Path 1: response is a single ```html (or bare ```) fence covering
  // the whole body. Earliest pattern — kept for callers that already
  // produce clean responses without commentary.
  const fullFenceMatch = text.match(/^```(?:html|HTML)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fullFenceMatch) text = fullFenceMatch[1].trim();

  // Path 2: response has prose around a ```html ... ``` block somewhere
  // in the middle. Observed: claude returned 65KB of
  // analysis + a fenced HTML block, the doctype-strip below missed it
  // because the first <!DOCTYPE was deep inside the fence (after lots
  // of preamble). Pull out the first fenced block whose body starts
  // with <!DOCTYPE/<html — that's the deliverable.
  if (!/<!DOCTYPE\s+html|<html[\s>]/i.test(text.slice(0, 200))) {
    const fencedAnywhere = text.match(/```(?:html|HTML)?\s*\n([\s\S]*?)\n```/);
    if (fencedAnywhere && /<!DOCTYPE\s+html|<html[\s>]/i.test(fencedAnywhere[1])) {
      text = fencedAnywhere[1].trim();
    }
  }

  // Path 3: still preceded by prose ("Here's the HTML:", a markdown
  // analysis paragraph, …) — slice to the first doctype/<html.
  const doctypeIdx = text.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  if (doctypeIdx > 0) text = text.slice(doctypeIdx);

  // Trim trailing prose after </html> — some models add a closing
  // commentary like "Let me know if you'd like adjustments." If the
  // text doesn't end cleanly at </html>, truncate to the last </html>.
  const lastHtmlClose = text.toLowerCase().lastIndexOf("</html>");
  if (lastHtmlClose >= 0) {
    text = text.slice(0, lastHtmlClose + "</html>".length);
  }

  return text.trim();
}
