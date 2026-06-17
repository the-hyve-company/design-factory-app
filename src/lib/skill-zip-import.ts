import { unzipSync } from "fflate";
import type { CreateSkillInput } from "@/lib/claude-bridge";
import { parseSkillMarkdown } from "@/lib/claude-bridge";

export interface ParsedSkillZip {
  installInput: CreateSkillInput;
  manifestPath: string;
  sourceHint: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

export function parseSkillZip(bytes: Uint8Array, fileName: string): ParsedSkillZip {
  if (bytes.length > 5_000_000) {
    throw new Error(`${fileName} too large (max 5MB for a skill zip)`);
  }

  const unzipped = unzipSync(bytes);
  const entries = Object.entries(unzipped).filter(([path]) => !path.endsWith("/"));
  const mdEntries = entries.filter(([path]) => /\.md$/i.test(path));
  if (mdEntries.length === 0) {
    throw new Error(`No .md file found inside ${fileName}`);
  }

  const manifest =
    mdEntries.find(([path]) => /(^|\/)SKILL\.md$/i.test(path)) ??
    mdEntries.sort((a, b) => a[0].split("/").length - b[0].split("/").length)[0];
  const [manifestPath, manifestBytes] = manifest;
  if (manifestBytes.length > 200_000) {
    throw new Error(`${manifestPath} too large (max 200KB for the SKILL.md body)`);
  }

  const text = new TextDecoder("utf-8").decode(manifestBytes);
  const parsed = parseSkillMarkdown(text);
  const topFolder = manifestPath.includes("/") ? manifestPath.split("/")[0] : "";
  const zipBaseName = fileName.replace(/\.zip$/i, "");
  const forceSlug = topFolder || zipBaseName;
  const name = parsed.name || topFolder || zipBaseName;
  const manifestDir = manifestPath.includes("/")
    ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1)
    : "";

  const extraFiles: Record<string, string> = {};
  for (const [path, entryBytes] of entries) {
    if (path === manifestPath) continue;
    const rel = manifestDir && path.startsWith(manifestDir) ? path.slice(manifestDir.length) : path;
    if (!rel || rel.includes("..") || rel.startsWith("/")) continue;
    extraFiles[rel] = bytesToBase64(entryBytes);
  }

  return {
    manifestPath,
    sourceHint: `upload: ${fileName} -> ${manifestPath}`,
    installInput: {
      name: name.trim() || fileName,
      trigger: parsed.trigger ?? "",
      description: parsed.description,
      body: parsed.body,
      forceSlug,
      extraFiles: Object.keys(extraFiles).length ? extraFiles : undefined,
    },
  };
}
