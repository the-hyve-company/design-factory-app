import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertPathInScope, PathScopeError } from "./path-scope.mjs";

// Per-file cap for extraFiles payloads (decoded bytes). Mirrors the
// client-side skill-zip cap (src/lib/skill-zip-import.ts) so the daemon
// enforces the same ceiling even when called directly.
export const MAX_EXTRA_FILE_BYTES = 5 * 1024 * 1024;

export function resolveRepoRoot(cwd = process.cwd()) {
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
    timeout: 3000,
    // SUPPRESS stderr — git writes "fatal: not a git repository" to
    // stderr on failure, which inherits to the daemon's stderr by
    // default and spammed the user's dev:web log on non-git folders.
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (git.status === 0 && git.stdout.trim()) return dirname(git.stdout.trim());
  return cwd;
}

export function slugifyName(name) {
  const slug = String(name || "skill")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "skill";
}

export function parseSkillFile(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fm = fmMatch ? fmMatch[1] : "";
  const body = (fmMatch ? raw.slice(fmMatch[0].length) : raw).trim();
  const pick = (key) => {
    const match = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
    if (!match) return null;
    return match[1].trim().replace(/^["'](.*)["']$/, "$1");
  };
  const pickList = (key) => {
    const match = fm.match(new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, "m"));
    if (!match) return [];
    return match[1]
      .split(",")
      .map((value) => value.trim().replace(/^["'](.*)["']$/, "$1"))
      .filter(Boolean);
  };
  return {
    name: pick("name"),
    description: pick("description"),
    trigger: pick("trigger"),
    override: pick("override"),
    version: pick("version"),
    requires: pickList("requires"),
    body,
  };
}

function detectRequires(body) {
  const requires = new Set();
  if (/\b(Bash|Read|Edit|Write|Glob|Grep|WebFetch|WebSearch)\b/.test(body)) requires.add("tools");
  if (/\b(mcp__|MCP server|\.mcp\.)/i.test(body)) requires.add("mcp");
  if (/--agent\s|subagent|sub-agent|@[a-z-]+\s/.test(body)) requires.add("sub-agents");
  return [...requires];
}

function sha16(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildSkill({ raw, absPath, source, cwd }) {
  const parsed = parseSkillFile(raw);
  const basename = absPath.split("/").pop().replace(/\.md$/i, "");
  const name =
    parsed.name || basename.replace(/[-_]/g, " ").replace(/^\w/, (char) => char.toUpperCase());
  const rel = cwd && absPath.startsWith(cwd + "/") ? absPath.slice(cwd.length + 1) : absPath;
  let trigger = parsed.trigger;
  if (!trigger) trigger = "/" + slugifyName(parsed.name || basename);
  const requires = parsed.requires.length ? parsed.requires : detectRequires(parsed.body);
  return {
    id: `${source}:${rel || basename}`,
    name,
    trigger,
    description: parsed.description,
    body: parsed.body,
    source,
    path: absPath,
    requires,
    override_trigger: parsed.override && parsed.override !== "false" ? parsed.override : null,
    version: parsed.version,
    body_hash: sha16(parsed.body),
  };
}

const RESERVED_TRIGGERS = new Set([
  "/tweaks",
  "/edit",
  "/export",
  "/present",
  "/terminal",
  "/init",
  "/review",
  "/clear",
  "/cost",
  "/model",
  "/compact",
  "/undo",
  "/resume",
]);

function validateSkillInput(input) {
  const errors = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("name is required");
  if (name.length > 80) errors.push("name must be 80 chars or fewer");

  const body = typeof input.body === "string" ? input.body : "";
  if (body.trim().length < 20) errors.push("instructions must be at least 20 characters");
  if (body.length > 100_000) errors.push("skill body too large (100kb max)");
  if (
    body &&
    /\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9\-_.]{20,})/i.test(body)
  ) {
    errors.push("remove tokens / secrets from instructions before saving");
  }

  let trigger = typeof input.trigger === "string" ? input.trigger.trim() : "";
  if (trigger && !/^\/[a-z0-9:_-]{1,40}$/i.test(trigger)) {
    errors.push(
      "command must start with / and use alphanumerics, hyphens or underscores (max 40 chars)",
    );
  } else if (!trigger) {
    trigger = "/" + slugifyName(name);
  }

  if (errors.length) throw new Error(errors.join("; "));
  return {
    name,
    trigger,
    description: typeof input.description === "string" ? input.description.trim() : null,
    body,
    requires: Array.isArray(input.requires)
      ? input.requires.filter((value) => typeof value === "string")
      : null,
    override: input.override === true || input.override === "true" ? true : null,
    version: typeof input.version === "string" ? input.version.trim() : null,
  };
}

function serializeSkillMarkdown({ name, trigger, description, body, requires, override, version }) {
  const lines = ["---"];
  lines.push(`name: ${JSON.stringify(name)}`);
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (trigger) lines.push(`trigger: "${trigger}"`);
  if (requires?.length)
    lines.push(`requires: [${requires.map((value) => JSON.stringify(value)).join(", ")}]`);
  if (override) lines.push("override: true");
  if (version) lines.push(`version: ${JSON.stringify(version)}`);
  lines.push("---", "", body);
  return lines.join("\n");
}

export async function installDfSkill(input, { repoRoot = resolveRepoRoot() } = {}) {
  const validated = validateSkillInput(input);
  const rawSlug =
    typeof input.forceSlug === "string" && input.forceSlug.trim()
      ? input.forceSlug
      : validated.trigger.replace(/^\//, "") || validated.name;
  const dir = join(repoRoot, "skills", slugifyName(rawSlug));
  const filePath = join(dir, "SKILL.md");

  if (existsSync(filePath)) {
    throw new Error(`skill already exists at ${filePath} - use update or pick a different command`);
  }
  if (RESERVED_TRIGGERS.has(validated.trigger) && !validated.override) {
    throw new Error(
      `${validated.trigger} is reserved by a built-in - set override:true to replace it`,
    );
  }

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, serializeSkillMarkdown(validated), "utf8");

  if (input.extraFiles && typeof input.extraFiles === "object") {
    // Realpath-based containment (assertPathInScope) instead of the old
    // string checks (`includes("..")` / `startsWith(dir + "/")`) — string
    // matching misses symlinks, case-insensitive filesystems and encoded
    // segments. Out-of-scope entries are skipped (never written), matching
    // the previous silent-skip contract for invalid paths.
    const scopeRoot = realpathSync(dir); // dir was just mkdir'd above
    for (const [relPath, base64] of Object.entries(input.extraFiles)) {
      if (typeof base64 !== "string") continue;
      if (!relPath || typeof relPath !== "string") continue;
      // Absolute paths were always rejected — keep that contract explicit
      // (an absolute path inside the skill dir would pass the scope check).
      if (relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath)) continue;
      let dest;
      try {
        dest = assertPathInScope(relPath, scopeRoot);
      } catch (e) {
        if (e instanceof PathScopeError) continue;
        throw e;
      }
      if (dest === scopeRoot) continue; // refuse to clobber the skill dir itself
      // Never overwrite the manifest — checked on the RESOLVED path so
      // "references/../SKILL.md" can't sneak past a raw-string test.
      if (dirname(dest) === scopeRoot && /^SKILL\.md$/i.test(basename(dest))) continue;
      const buf = Buffer.from(base64, "base64");
      if (buf.length > MAX_EXTRA_FILE_BYTES) continue;
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
    }
  }

  const raw = await readFile(filePath, "utf8");
  return buildSkill({ raw, absPath: filePath, source: "df", cwd: repoRoot });
}
