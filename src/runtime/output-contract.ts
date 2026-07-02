// output-contract.ts — composes the OUTPUT-CONTRACT block that gets
// glued onto a provider's system prompt. Two shapes:
//
//   Tool-driven providers (`fileWrite === "tool"`) — Claude Code,
//     Codex CLI, Opencode, Kimi. The prompt body (already inside
//     GENERATE_CORE_SYSTEM) instructs them to call Write/Edit. Output
//     contract composer is a no-op here.
//
//   Artifact providers (`fileWrite === "artifact"`) — Gemini CLI,
//     Anthropic API, OpenAI API, Gemini API, OpenRouter API, Ollama.
//     The composer emits a block that pins the agent to ending its
//     turn with a single `<artifact identifier="..." type="..."
//     title="...">…</artifact>` block. The runtime parser extracts it
//     and writes via `/fs/write/artifact`.
//
// collapsed the `requiresArtifactWrap` boolean and the
// `DF_ENABLE_ARTIFACT_CONTRACT` feature flag into a single canonical
// capability `fileWrite`. There is no longer a flag — the provider
// declares its channel and the runtime honors it.
//
// This module is pure. It does NOT decide WHICH prompt to use — that
// decision lives in the caller (prompt-invoker.ts / EditorScreen.tsx /
// the pipeline). It only renders the textual contract block
// and exposes the gating predicate.

import type { LLMProvider, ProviderCapabilities } from "@/providers/types";

/**
 * Canonical repo-relative artifact path — audit WS3
 * `artifact-identifier-parity`.
 *
 * Before this helper, the two live paths computed the contract's
 * identifier DIFFERENTLY:
 *   · generate path (composeSystemBlocks / prepare-override) only
 *     stripped a `~/` prefix — an absolute projectPath
 *     (`/home/u/design-factory/projects/slug`) leaked through whole,
 *     and the daemon's normalizeIdentifier re-prefixed it into a bogus
 *     nested `projects/<slug>/home/u/.../index.html` (role "variant",
 *     not the primary override);
 *   · verb path (artifactContractForCtx) reduced the path down to the
 *     `projects/<slug>/` stem the daemon accepts verbatim.
 * Net effect: the 6 artifact-channel providers could materialize a
 * generate turn into a DIFFERENT file than the 4 tool-channel ones
 * (which write via the absolute PROJECT_PATH binding in the preamble).
 *
 * This helper is the single source both paths now use. Rules:
 *   · normalize Windows separators, strip `~/` and trailing slashes;
 *   · when the path ends in a `projects/<slug>` segment, reduce to that
 *     stem (the form `resolve-artifact-target.mjs` normalizes 1:1);
 *   · otherwise keep the (tilde-stripped) path as-is — the daemon
 *     prefixes it under `projects/<projectId>/`;
 *   · empty/missing input falls back to `projects/default/`.
 */
export function toRepoRelativeArtifactPath(
  projectPath: string | null | undefined,
  primaryFile: string | null | undefined,
): string {
  const file = primaryFile && primaryFile.length > 0 ? primaryFile : "index.html";
  const raw = (projectPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^~\/?/, "")
    .replace(/\/+$/, "");
  if (!raw) return `projects/default/${file}`;
  const stemMatch = raw.match(/(?:^|\/)(projects\/[^/]+)$/);
  const stem = stemMatch ? stemMatch[1] : raw;
  return `${stem}/${file}`;
}

export interface OutputContractContext {
  /** `fileWrite` capability of the active provider. The composer
   *  emits a block only when the provider materializes via `<artifact>`. */
  fileWrite: ProviderCapabilities["fileWrite"];
  /** The path the artifact should target. The composer fills it into the
   *  identifier example so the agent has a concrete target to emit, not
   *  a placeholder it might invent. */
  filePath: string;
  /** Project name for the title attribute; falls back to filename stem. */
  projectName?: string;
  /** Optional content type — defaults to "text/html". Spec keeps
   *  focused on HTML; widens this once project-files registry
   *  knows about variants/docs/prompts. */
  contentType?: string;
  /** F3.2 — Flags an edit/refine turn so the contract emphasizes "emit
   *  the COMPLETE document, not a diff". Cheap OpenRouter / Gemini
   *  models on refines often returned bare prose explaining what they'd
   *  change and triggered the "completed without text or artifact"
   *  rejection. Default false (generate turns don't need the extra
   *  emphasis since they always produce a full file). */
  isEdit?: boolean;
}

/**
 * Predicate gate that decides whether the OUTPUT-CONTRACT block should be
 * appended to the system prompt. — canonical and flag-free.
 */
export function shouldAppendArtifactContract(provider: Pick<LLMProvider, "capabilities">): boolean {
  return provider.capabilities.fileWrite === "artifact";
}

/**
 * Build the artifact-wrap contract block. Returns "" when not applicable
 * (caller can safely concat regardless). When applicable, returns a block
 * suitable for appending to the system prompt with a leading blank line.
 *
 * The block includes:
 *   - the canonical `<artifact ...>` shape
 *   - the path, type, and title pre-filled
 *   - explicit "single artifact, last thing in your reply" reminder
 *     (D23 — multiple artifacts get rejected)
 */
export function buildArtifactContractBlock(ctx: OutputContractContext): string {
  if (ctx.fileWrite !== "artifact") return "";
  const type = ctx.contentType || "text/html";
  const title = ctx.projectName || guessTitleFromPath(ctx.filePath);
  return [
    "",
    "═══ OUTPUT CONTRACT — NON-NEGOTIABLE ═══",
    "Your reply has TWO parts and only TWO parts:",
    "  1. A SHORT chat sentence (1-3 lines) describing what you built.",
    "  2. The file itself, wrapped in a single <artifact> block, as the",
    "     LAST thing in your reply.",
    "",
    "Required block shape (copy verbatim, fill the body):",
    `  <artifact identifier="${ctx.filePath}" type="${type}" title="${title}">`,
    "  ...complete standalone document...",
    "  </artifact>",
    "",
    "Rules:",
    " - Emit EXACTLY ONE <artifact> block. Multiple blocks → the runtime",
    "   rejects all of them and the file is not saved.",
    " - Do NOT paste the file contents into a markdown code fence in chat.",
    "   The chat is for short status text; the file lands via the artifact.",
    " - Do NOT add prose AFTER the closing </artifact>. The artifact must",
    "   be the last thing in your reply.",
    " - The body inside the artifact must be the COMPLETE, standalone",
    "   document (full HTML doctype, all CSS/JS inline, opens in an iframe).",
    " - If you cannot produce the file, say so in one sentence and stop.",
    "   Never improvise by streaming a 30KB code block instead.",
    ...(ctx.isEdit
      ? [
          "",
          "EDIT TURN — extra emphasis (F3.2):",
          " - Even when the user asks for a TINY change (a color, a word, a",
          "   single style), you MUST emit the WHOLE file inside the artifact.",
          "   The runtime replaces the file by-bytes — partial diffs, change",
          "   summaries, and 'here's the part that changed' snippets all fail",
          "   the parser and the user sees '[error] completed without text",
          "   or artifact'.",
          " - Do not explain what you would change in prose without emitting",
          "   the artifact. The artifact IS the change.",
          " - Preserve the rest of the document verbatim — only the bytes you",
          "   intend to change should differ from the input HTML.",
        ]
      : []),
    "",
  ].join("\n");
}

function guessTitleFromPath(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  const dot = filePath.lastIndexOf(".");
  const stem = filePath.slice(slash + 1, dot > slash ? dot : undefined);
  return stem || "document";
}
