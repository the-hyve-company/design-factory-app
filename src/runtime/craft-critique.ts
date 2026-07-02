// craft-critique.ts — the /critique command (audit WS1 `critique-command`).
//
// READ-ONLY, DETERMINISTIC, LOCAL. Unlike every other slash command,
// /critique never touches a model: it runs the same deterministic nets
// the pipeline runs post-write — Static P0 (hard structural gate) and
// the craft net (taste tells, warn-only, with the anti-FP hardening and
// the DS allowlist) — against the CURRENT file, and formats the result
// as a chat report. Nothing is mutated; the explicit next step for
// fixes is /polish (which consumes these same findings — see
// craft-feedback.ts).
//
// Pure module: EditorScreen owns pushing the report into the chat.

import { runCraftChecks, summarizeCraftChecks, DEFERRED_CHECKS } from "@/runtime/craft-checks";
import type { CraftCheckResult } from "@/runtime/craft-checks";
import { validateArtifactStaticP0 } from "@/runtime/static-p0";
import type { StaticP0Result } from "@/runtime/static-p0";
import { sortFindings } from "@/runtime/craft-feedback";

export interface CraftCritiqueInput {
  /** The current file's content (usually the live iframe HTML). */
  content: string;
  /** File name — purely informational, names the subject in the report. */
  fileName?: string;
  /** Attached DS markdown — feeds the anti-FP allowlist. */
  designSystemMarkdown?: string | null;
}

export interface CraftCritiqueOutput {
  /** Markdown report for the chat bubble. */
  report: string;
  /** Structured results, should the caller want to render chips. */
  craft: CraftCheckResult;
  staticP0: StaticP0Result;
}

export function runCraftCritique(input: CraftCritiqueInput): CraftCritiqueOutput {
  const fileName = input.fileName ?? "index.html";
  const staticP0 = validateArtifactStaticP0({
    finalPath: fileName,
    content: input.content,
    contentHash: "critique:local",
    type: "text/html",
  });
  const craft = runCraftChecks({
    content: input.content,
    type: "text/html",
    designSystemMarkdown: input.designSystemMarkdown ?? null,
  });

  const lines: string[] = [
    `## Craft critique — \`${fileName}\` (deterministic, read-only)`,
    "",
    staticP0.status === "pass"
      ? "**Static P0:** ✓ pass (structure, balanced tags, ids)"
      : `**Static P0:** ✗ fail — ${staticP0.reason}: ${staticP0.details}`,
    `**Craft net:** ${summarizeCraftChecks(craft)}`,
  ];

  if (craft.findings.length > 0) {
    lines.push("", "### Findings (P0 first)", "");
    for (const f of sortFindings(craft.findings)) {
      const snippet = f.sample ? ` · found: \`${f.sample}\`` : "";
      lines.push(`- **[${f.tier}] ${f.title}** (\`${f.ruleId}\`) — ${f.detail}${snippet}`);
    }
  }

  lines.push(
    "",
    "### Not covered here (needs the rendered DOM)",
    "",
    ...DEFERRED_CHECKS.map((d) => `- \`${d.ruleId}\` — ${d.why}`),
    "",
    craft.findings.length > 0
      ? "_Read-only: nothing was changed. Run `/polish` to apply targeted fixes._"
      : "_Read-only: nothing was changed._",
  );

  return { report: lines.join("\n"), craft, staticP0 };
}
