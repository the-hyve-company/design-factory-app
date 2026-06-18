// Skill folder import — bundles a directory tree into the CreateSkillInput
// shape installSkill() expects (SKILL.md frontmatter → name/trigger/body;
// every sibling/child file → base64-encoded extraFiles).
//
// The same logic lives inline in apps/daemon/src/skills-install.mjs for
// the daemon-side ZIP import (parseSkillZip). This module is the FOLDER
// equivalent on the client side: it walks the file system via the bridge
// (listFolder + readFileViaBridge), so it lands in src/lib/ instead of
// apps/daemon/. Both paths produce identical CreateSkillInput objects.
//
// Why extracted: SkillsDirectionA.tsx had the walker inline; testing it
// required spinning up a real bridge + React render. With this module
// the walker takes pluggable deps (listFolder, readFileViaBridge,
// parseSkillMarkdown) so a unit test can mock them and assert end-to-end
// that a 4-file folder produces 1 manifest + 3 extraFiles, not "1 random".

import type { CreateSkillInput, FsFile } from "@/lib/claude-bridge";

export type ListFolderFn = (
  path: string,
) => Promise<
  | { entries: Array<{ name: string; path: string; isDir: boolean; size: number }> }
  | { error: string }
  | null
>;
export type ReadFileFn = (path: string) => Promise<FsFile | null>;
export type ParseSkillMdFn = (raw: string) => {
  name: string | null;
  trigger: string | null;
  description: string | null;
  body: string;
};

export interface CollectSkillDeps {
  listFolder: ListFolderFn;
  readFileViaBridge: ReadFileFn;
  parseSkillMarkdown: ParseSkillMdFn;
}

export interface CollectSkillResult {
  input: CreateSkillInput;
  /** Diagnostic: which file we picked as manifest. Useful for the UI
   *  status log so the user can see which .md was treated as SKILL.md
   *  when there's no literal SKILL.md in the folder. */
  manifestPath: string;
  /** Diagnostic: how many extras we bundled. Surfaced in the UI status
   *  log to confirm a multifile skill landed multifile. */
  extraCount: number;
}

/** utf-8 string → base64. btoa() chokes on multi-byte characters
 *  (accented PT, em-dashes), so go through TextEncoder first. */
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface Entry {
  path: string;
  name: string;
  size: number;
  relPath: string;
}

/**
 * Walk a folder (depth ≤ 3, max 80 entries) and turn it into a
 * `CreateSkillInput` ready for `installSkill()`. The manifest is picked
 * in this order:
 *
 *   1. A file literally named SKILL.md (any case, any depth).
 *   2. Otherwise, the SHALLOWEST .md that has a `name:` frontmatter
 *      field. parseSkillZip uses the same priority for ZIP imports.
 *
 * Everything else in the folder tree (relative to the manifest's
 * directory) is base64-encoded into `extraFiles`. Files outside the
 * manifest's subtree, oversize files (>1MB per extra, >200KB for the
 * manifest), and the manifest itself are skipped.
 *
 * Throws when no manifest is found.
 */
export async function collectSkillFromFolder(
  rootPath: string,
  deps: CollectSkillDeps,
): Promise<CollectSkillResult> {
  const all: Entry[] = [];
  const walk = async (p: string, depth: number, rel: string) => {
    if (depth > 3 || all.length >= 80) return;
    const r = await deps.listFolder(p);
    if (!r || "error" in r) return;
    for (const e of r.entries) {
      if (all.length >= 80) break;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDir) {
        if (/node_modules|\.git|dist|build/.test(e.name)) continue;
        await walk(e.path, depth + 1, childRel);
        continue;
      }
      all.push({ path: e.path, name: e.name, size: e.size, relPath: childRel });
    }
  };
  await walk(rootPath, 0, "");

  const mdEntries = all.filter((e) => e.name.toLowerCase().endsWith(".md") && e.size <= 200_000);
  if (mdEntries.length === 0) throw new Error("Nenhum .md encontrado nessa pasta.");

  // 1. Prefer a file literally named SKILL.md.
  const skillMdMatch = mdEntries.find((e) => /^SKILL\.md$/i.test(e.name));
  let manifest: Entry | null = null;
  let manifestParsed: ReturnType<ParseSkillMdFn> | null = null;
  if (skillMdMatch) {
    const f = await deps.readFileViaBridge(skillMdMatch.path);
    if (f?.isText) {
      manifest = skillMdMatch;
      manifestParsed = deps.parseSkillMarkdown(f.content);
    }
  }

  // 2. Fall back to shallowest .md with a `name:` frontmatter field.
  if (!manifest) {
    const candidates = [...mdEntries].sort(
      (a, b) => a.relPath.split("/").length - b.relPath.split("/").length,
    );
    for (const c of candidates) {
      const f = await deps.readFileViaBridge(c.path);
      if (!f?.isText) continue;
      const parsed = deps.parseSkillMarkdown(f.content);
      if (parsed.name) {
        manifest = c;
        manifestParsed = parsed;
        break;
      }
    }
  }

  if (!manifest || !manifestParsed) {
    throw new Error("Nenhuma SKILL.md (ou .md com `name:` no frontmatter) encontrada.");
  }

  // Manifest dir = path prefix to strip when computing extraFiles keys.
  // If the manifest is at the root of the picked folder, manifestDir is
  // empty and every entry contributes (relative to root).
  const manifestDir = manifest.relPath.includes("/")
    ? manifest.relPath.slice(0, manifest.relPath.lastIndexOf("/") + 1)
    : "";

  const extraFiles: Record<string, string> = {};
  for (const entry of all) {
    if (entry.path === manifest.path) continue;
    if (entry.size > 1_000_000) continue;
    if (manifestDir && !entry.relPath.startsWith(manifestDir)) continue;
    const rel = manifestDir ? entry.relPath.slice(manifestDir.length) : entry.relPath;
    if (!rel || rel.includes("..") || rel.startsWith("/")) continue;
    if (/^SKILL\.md$/i.test(rel)) continue; // never overwrite manifest slot
    const f = await deps.readFileViaBridge(entry.path);
    if (!f) continue;
    if (f.isText) {
      extraFiles[rel] = textToBase64(f.content);
    } else {
      // Binary files arrive via /fs/read as `data:<mime>;base64,<b64>`.
      const comma = f.content.indexOf(",");
      if (comma < 0) continue;
      extraFiles[rel] = f.content.slice(comma + 1);
    }
  }

  const fallbackName = rootPath.split(/[/\\]/).filter(Boolean).pop() || "";
  const input: CreateSkillInput = {
    name: manifestParsed.name ?? fallbackName,
    trigger: manifestParsed.trigger ?? "",
    description: manifestParsed.description,
    body: manifestParsed.body,
    extraFiles: Object.keys(extraFiles).length > 0 ? extraFiles : undefined,
  };

  return { input, manifestPath: manifest.path, extraCount: Object.keys(extraFiles).length };
}
