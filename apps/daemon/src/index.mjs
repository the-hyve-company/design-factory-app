// dev-bridge: exposes the local claude CLI to the Vite browser preview via HTTP.
//
// Why: `npm run dev` (vite) runs the UI in a plain browser, where Tauri IPC
// (__TAURI_IPC__) does not exist. Without this bridge, the frontend falls back
// to a mock that emits an error, so no prompt ever reaches `claude`.
//
// With the bridge running on :1421, claude-bridge.ts routes streamClaude /
// claudeOnce through HTTP/SSE. The Tauri shell scaffolding has been
// retired; HTTP/SSE is the only path.
//
// Run alongside Vite: npm run bridge (or npm run dev:web for both together)

import http from "node:http";
import { spawn, spawnSync, execFile, execFileSync } from "node:child_process";
import {
  readdir,
  stat,
  readFile,
  mkdir,
  writeFile,
  rm,
  cp,
  rename,
  chmod,
  mkdtemp,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { ssrfSafeFetch } from "./lib/ssrf-guard.mjs";
import { WebSocketServer } from "ws";

import { assertPathInScope, PathScopeError } from "./path-scope.mjs";
import { normalizeProjectSlug, sanitizeVersionId } from "./slug.mjs";
import { isBlockedEnvKey, filterEnv, sanitizedSpawnEnv } from "./env-blocklist.mjs";
import {
  writeArtifactSafely,
  deleteArtifactSafely,
  MAX_ARTIFACT_BYTES,
} from "./artifact-writer.mjs";
import { resolveArtifactTarget } from "./resolve-artifact-target.mjs";
import {
  validateOrRebuild as readOrRebuildRegistry,
  upsertFile as upsertRegistryFile,
  toRegistryKey,
} from "./project-files.mjs";
// per-provider adapters live in providers/. Each module
// owns the /<id>/stream + /<id>/once handlers and its capability flags.
// The dispatch loop below auto-routes; adding a provider = drop a file +
// register in providers/index.mjs (no edits to this file's handlers).
import { listProviders, getProvider, describeProvider } from "./providers/index.mjs";
import { probeOllamaHost, getModelCapabilities } from "./providers/ollama-host.mjs";
import { configPath, getConfigDir } from "./lib/config-dir.mjs";
import { armHeartbeat } from "./lib/sse-heartbeat.mjs";
import { buildDsPreviewPrompt, stripHtmlFence } from "./ds-preview-prompt.mjs";
import { coerceDesignMd } from "./ds-coerce.mjs";
import { installDfSkill as installDfSkillShared } from "./skills-install.mjs";

const execFileP = promisify(execFile);

// GUI apps (Tauri, launched from the Dock/Start Menu) inherit a minimal PATH and
// can't find the user's CLIs (claude/codex live in ~/.local/bin, the npm global
// bin, Homebrew, etc.) even though a terminal finds them. Launched from a shell
// (`npm run dev:web`) it works; launched as a bundled sidecar it doesn't — the
// exact gap a real Windows build surfaced. Augment process.env.PATH once at
// startup so BOTH detection (whichBin) and execution (child_process) resolve the
// CLIs regardless of how the app was launched. Cross-platform (win/mac/linux).
function augmentPath() {
  const isWin = process.platform === "win32";
  const sep = isWin ? ";" : ":";
  const home = homedir();
  const current = (process.env.PATH || "").split(sep).filter(Boolean);
  const extra = [];
  // macOS/Linux GUI apps get a bare PATH; the user's real PATH lives in their
  // login shell (nvm/asdf/Homebrew/custom). Pull it in (best-effort, fast).
  if (!isWin) {
    try {
      const shell = process.env.SHELL || "/bin/sh";
      const out = execFileSync(shell, ["-lic", "echo __DFPATH__$PATH"], {
        timeout: 3000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/__DFPATH__(.+)/);
      if (m) extra.push(...m[1].trim().split(sep).filter(Boolean));
    } catch {
      /* no login shell / timeout — fall back to the known dirs below */
    }
  }
  // Well-known per-user CLI install dirs a GUI PATH commonly misses.
  extra.push(join(home, ".local", "bin"));
  if (isWin) {
    extra.push(join(process.env.APPDATA || join(home, "AppData", "Roaming"), "npm"));
    extra.push(
      join(
        process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
        "Microsoft",
        "WinGet",
        "Links",
      ),
    );
  } else {
    extra.push(
      "/usr/local/bin",
      "/opt/homebrew/bin",
      join(home, ".npm-global", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".deno", "bin"),
    );
  }
  const seen = new Set(current);
  const added = [];
  for (const d of extra) {
    if (d && !seen.has(d)) {
      seen.add(d);
      added.push(d);
    }
  }
  if (added.length) {
    process.env.PATH = [...current, ...added].join(sep);
    console.log(
      `[dev-bridge] PATH augmented with ${added.length} extra bin dir(s) for GUI/sidecar launch`,
    );
  }
}
augmentPath();

// Per-CLI path overrides the user set ("point to my CLI"). Persisted in the
// config dir; applied as DF_<ID>_BIN BEFORE the bin consts below read them, so a
// pointed-to path drives BOTH detection and execution — the reliable escape
// hatch when auto-detection (PATH) can't find a CLI under a GUI launch.
const AGENT_IDS = ["claude", "codex", "gemini", "opencode", "kimi"];
const binOverridePath = () => configPath("agent-bins.json");
function readBinOverrides() {
  try {
    return JSON.parse(readFileSync(binOverridePath(), "utf8")) || {};
  } catch {
    return {};
  }
}
function applyBinOverrides() {
  const o = readBinOverrides();
  for (const id of AGENT_IDS) {
    if (typeof o[id] === "string" && o[id]) process.env[`DF_${id.toUpperCase()}_BIN`] = o[id];
  }
  return o;
}
applyBinOverrides();

const PORT = Number(process.env.DF_BRIDGE_PORT || 1421);
// Default CORS is locked to localhost dev origins. Override via
// DF_BRIDGE_ORIGIN (CSV of origins, or "*" to opt out — only set "*"
// in trusted dev environments).
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  // The dev launcher (scripts/dev-web.mjs) may reclaim a non-default Vite
  // port when 1420 is busy; it passes the resolved port as DF_VITE_PORT so
  // the served origin is trusted instead of rejected as a bad origin.
  ...(process.env.DF_VITE_PORT
    ? [
        `http://localhost:${process.env.DF_VITE_PORT}`,
        `http://127.0.0.1:${process.env.DF_VITE_PORT}`,
      ]
    : []),
  // Common alt dev ports — when the user runs Vite/Next under
  // DF_VITE_PORT override or via an external reverse proxy. User
  // 2026-05-17 hit "fetch failed" because their browser tab was on
  // :3000 while the daemon was rejecting CORS.
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const ORIGIN_RAW = process.env.DF_BRIDGE_ORIGIN ?? DEFAULT_ALLOWED_ORIGINS.join(",");
const ALLOWED_ORIGINS =
  ORIGIN_RAW === "*"
    ? "*"
    : new Set(
        ORIGIN_RAW.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
const CLAUDE_BIN = process.env.DF_CLAUDE_BIN || "claude";
const ALLOW_ARBITRARY_FS =
  process.env.DF_ALLOW_ARBITRARY_FS === "1" || process.env.DF_ALLOW_ARBITRARY_FS === "true";
const MAX_JSON_BODY_BYTES = Number(process.env.DF_MAX_JSON_BODY_BYTES || 12 * 1024 * 1024);

// ─── Agent registry — multi-CLI detection ──────────────────────────────
// Definitions for every CLI we know how to spawn. Used by GET /agents/list to
// scan PATH and report what's installed. Adapter logic per id lives in the
// matching /<id>/* endpoints. All 5 CLIs in v1 beta have full
// streaming via their respective provider adapters.
//
// `versionArgs` should print a version string fast and exit 0. Anything that
// hangs or requires auth here will stall the picker.
// V1 beta CLI roster (5 entries). Cleanup 2026-05-15 removed
// cursor-agent, copilot, crush, aider from detection — they are no
// longer wired adapters.
const AGENT_DEFS = [
  {
    id: "claude",
    label: "Claude Code",
    bin: process.env.DF_CLAUDE_BIN || "claude",
    versionArgs: ["--version"],
  },
  {
    id: "codex",
    label: "Codex CLI",
    bin: process.env.DF_CODEX_BIN || "codex",
    versionArgs: ["--version"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: process.env.DF_GEMINI_BIN || "gemini",
    versionArgs: ["--version"],
  },
  {
    id: "opencode",
    label: "Opencode CLI",
    bin: process.env.DF_OPENCODE_BIN || "opencode",
    versionArgs: ["--version"],
  },
  {
    id: "kimi",
    label: "Kimi Code CLI",
    bin: process.env.DF_KIMI_BIN || "kimi",
    versionArgs: ["--version"],
  },
];

// Walk PATH looking for `name`. Returns absolute path or null. Honors PATHEXT
// on Windows so `codex.exe` / `codex.cmd` resolve. We don't follow symlinks
// chains — that's the OS's job.
async function whichBin(name) {
  const isWin = process.platform === "win32";
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  const sep = isWin ? ";" : ":";
  const dirs = (process.env.PATH || "").split(sep);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        const s = await stat(candidate);
        if (s.isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

// Probe one agent: locate binary, run versionArgs with a timeout, parse the
// first line of stdout for a semver-ish string. Failure modes (missing binary,
// timeout, non-zero exit) all collapse to `available: false`.
async function probeAgent(def) {
  // Re-read the env each probe so a runtime "point to my CLI" (PUT /agents/bins,
  // which sets DF_<ID>_BIN) takes effect on the next rescan without a restart.
  const envBin = process.env[`DF_${def.id.toUpperCase()}_BIN`];
  const bin = envBin || def.bin;
  let resolved = null;
  let source = null;
  // An explicit path (the user pointed at a file) → use it directly; whichBin
  // only walks PATH and wouldn't find an absolute/relative path.
  if (bin && /[\\/]/.test(bin)) {
    try {
      if ((await stat(bin)).isFile()) {
        resolved = bin;
        source = "override";
      }
    } catch {}
  }
  if (!resolved) {
    resolved = await whichBin(bin);
    if (resolved) source = envBin ? "override" : "path";
  }
  if (!resolved) {
    return { id: def.id, label: def.label, bin, available: false, source: null };
  }
  let version = null;
  try {
    const { stdout } = await execFileP(resolved, def.versionArgs, { timeout: 3000 });
    const line =
      String(stdout || "")
        .split(/\r?\n/)
        .find((l) => l.trim().length > 0) ?? "";
    const match = line.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/);
    version = match ? match[0] : line.trim() || null;
  } catch {}
  return { id: def.id, label: def.label, bin, resolved, available: true, version, source };
}

let agentsCache = null;
let agentsCacheAt = 0;
const AGENTS_CACHE_MS = 30_000;

async function listAgents({ force = false } = {}) {
  const now = Date.now();
  if (!force && agentsCache && now - agentsCacheAt < AGENTS_CACHE_MS) {
    return agentsCache;
  }
  agentsCache = await Promise.all(
    AGENT_DEFS.map((def) =>
      probeAgent(def).catch(() => ({
        id: def.id,
        label: def.label,
        bin: def.bin,
        available: false,
      })),
    ),
  );
  agentsCacheAt = now;
  return agentsCache;
}
// GitHub OAuth device-flow client ID. Defaults to the public `gh` CLI client
// so users can authenticate without registering their own OAuth app.
// Override with DF_GH_CLIENT_ID if you run your own.
const GH_CLIENT_ID = process.env.DF_GH_CLIENT_ID || "178c6fc778ccc68e1d6a";
// On-disk token storage path (chmod 600 on write). Read by /gh/token as a
// fallback when `gh auth token` isn't available.
const DF_TOKEN_PATH = process.env.DF_GH_TOKEN_PATH || configPath("gh-token");

// Vercel OAuth device-flow client ID — opt-in. Vercel exposes a real OIDC
// device-authorization grant (see /.well-known/oauth-authorization-server)
// but requires a registered Integration with approved redirect URIs. Until
// HYVE registers an official integration, this stays unset and the daemon
// falls back to BYOK token paste (improved UX). When the env var is
// populated the device-flow endpoints below light up automatically.
//
// Discovery (cached for the life of the process):
//   · device_authorization_endpoint: https://api.vercel.com/login/oauth/device-authorization
//   · token_endpoint: https://api.vercel.com/login/oauth/token
//   · userinfo_endpoint: https://api.vercel.com/login/oauth/userinfo
//
// Vercel and GitHub OAuth Device Flow (RFC 8628) is wired here for the
// optional in-app publish/import flows. The endpoints are operational but
// the v0.1 UI does not surface them — users wanting to publish can run
// `vercel deploy` directly. Set DF_VERCEL_CLIENT_ID to enable the flow.
const VERCEL_CLIENT_ID = process.env.DF_VERCEL_CLIENT_ID || "";
const VERCEL_DEVICE_AUTH_URL = "https://api.vercel.com/login/oauth/device-authorization";
const VERCEL_TOKEN_URL = "https://api.vercel.com/login/oauth/token";
const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";

// ─── Skills registry — shared walker used by /skills/registry ──

const HOME = process.env.HOME || "/";
// skills canonicalize on <repoRoot>/skills/. Legacy
// path <repoRoot>/.claude/skills/ is still walked read-only so older
// installations keep working. Canonical wins on (source, trigger)
// collision via dedupe(). Resolved lazily via git --git-common-dir so
// worktree dev setups still land at the main checkout rather than
// inside .aios/worktrees/*.
// Cache the resolved repo root for the process lifetime. The daemon's
// cwd doesn't change at runtime, so re-spawning git on every request
// (32+ call sites previously) burned ~3-5ms × dozens of polls/min for
// nothing. When the folder isn't a git repo (e.g. a project at
// C:\path\to\design-factory-app bootstrapped via the v0.1.0 tarball
// scaffolder), the cache
// also stops `fatal: not a git repository` from spamming stderr —
// previously execFileSync's default stderr inheritance leaked git's
// failure message into the user's terminal on every request.
let cachedRepoRoot = null;

function getRepoRoot() {
  if (cachedRepoRoot) return cachedRepoRoot;
  let repoRoot = process.cwd();
  try {
    // stdio: capture stdout, SUPPRESS stderr so the "fatal: not a git
    // repository" message git writes on failure doesn't bubble up to
    // the user's dev:web log on non-git folders.
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: process.cwd(),
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (out) repoRoot = dirname(out);
  } catch {}
  cachedRepoRoot = repoRoot;
  return repoRoot;
}

// BUG-2 (2026-05-25 Windows audit): in the packaged app the sidecar daemon
// runs with cwd = AppData\Local\Design Factory\ — which is NOT a git repo
// and has no `projects/` dir on first run. `realpathSync(join(repoRoot,
// "projects"))` then threw ENOENT and the 500 killed every metadata write,
// flooding the log with "fatal: not a git repository" and stranding the
// stream UI ("kept running"). Ensure the dir exists before resolving; fall
// back to the unresolved path if realpath still fails (e.g. permissions).
function resolveProjectsRoot(repoRoot) {
  const target = join(repoRoot, "projects");
  try {
    mkdirSync(target, { recursive: true });
  } catch {}
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

// Canonical write target — installSkill / updateDfSkill / deleteDfSkill
// always operate on /skills/. Used by the app's mutation flows.
function getSkillsDir() {
  return join(getRepoRoot(), "skills");
}
// Legacy read-only path. Walker still scans this for backward-compat
// with installations that pre-date the canonicalization. Returns
// the same path getSkillsDir did before — preserve behavior.
function getLegacySkillsDir() {
  return join(getRepoRoot(), ".claude", "skills");
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "target",
  ".vercel",
  "pnpm-store",
]);

// Hardcoded DF built-ins — these are UI actions, not LLM prompts.
// Dispatched by the editor, not forwarded to claude.
const DF_BUILTINS = [
  {
    id: "builtin:/tweaks",
    trigger: "/tweaks",
    name: "Tweaks",
    description: "Build live controls panel for current design",
  },
  {
    id: "builtin:/edit",
    trigger: "/edit",
    name: "Edit",
    description: "Edit mode — global page params drawer",
  },
  {
    id: "builtin:/export",
    trigger: "/export",
    name: "Export",
    description: "Convert design to HTML / React / Vue / Tailwind",
  },
  {
    id: "builtin:/present",
    trigger: "/present",
    name: "Present",
    description: "Enter fullscreen present mode",
  },
  {
    id: "builtin:/terminal",
    trigger: "/terminal",
    name: "Terminal",
    description: "Open terminal tab",
  },
  {
    id: "builtin:/init",
    trigger: "/init",
    name: "Init CLAUDE.md",
    description: "Scaffold workspace CLAUDE.md (claude built-in)",
  },
  {
    id: "builtin:/review",
    trigger: "/review",
    name: "Review PR",
    description: "Automated PR review (claude built-in)",
  },
];

function sha16(str) {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function slugifyName(name) {
  const s = String(name || "skill")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "skill";
}

function parseSkillFile(raw) {
  // Returns { name, description, license, trigger, requires, override, version, body }
  // or null when the content is clearly not a skill.
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fm = fmMatch ? fmMatch[1] : "";
  const body = (fmMatch ? raw.slice(fmMatch[0].length) : raw).trim();
  const pick = (key) => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
    if (!m) return null;
    return m[1].trim().replace(/^["'](.*)["']$/, "$1");
  };
  const pickList = (key) => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, "m"));
    if (!m) return [];
    return m[1]
      .split(",")
      .map((s) => s.trim().replace(/^["'](.*)["']$/, "$1"))
      .filter(Boolean);
  };
  return {
    name: pick("name"),
    description: pick("description"),
    license: pick("license"),
    trigger: pick("trigger"),
    override: pick("override"),
    version: pick("version"),
    requires: pickList("requires"),
    body,
  };
}

/** Capability detection heuristic — infers requires[] from body content. */
function detectRequires(body) {
  const reqs = new Set();
  if (/\b(Bash|Read|Edit|Write|Glob|Grep|WebFetch|WebSearch)\b/.test(body)) reqs.add("tools");
  if (/\b(mcp__|MCP server|\.mcp\.)/i.test(body)) reqs.add("mcp");
  if (/--agent\s|subagent|sub-agent|@[a-z-]+\s/.test(body)) reqs.add("sub-agents");
  return Array.from(reqs);
}

/** Build a Skill record from a .md file path and raw content. */
function toPortablePath(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

function repoRelativePath(absPath, cwd) {
  if (!cwd) return toPortablePath(absPath);
  const rel = relative(cwd, absPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return toPortablePath(absPath);
  return toPortablePath(rel);
}

function isPathInside(parent, child) {
  const rel = relative(parent, child);
  return rel && !rel.startsWith("..") && !isAbsolute(rel);
}

function buildSkill({ raw, absPath, source, cwd }) {
  const parsed = parseSkillFile(raw);
  if (!parsed) return null;
  const fileBase = basename(absPath).replace(/\.md$/i, "");
  const fromExplicitName = Boolean(parsed.name);
  const name = parsed.name || fileBase.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const rel = repoRelativePath(absPath, cwd);
  // Derive trigger: explicit frontmatter > slugified name > path-based
  let trigger = parsed.trigger;
  if (!trigger) {
    // For project/global where path has meaning (squad:agent:name), keep path-based heuristic
    if (source === "project" || source === "global") {
      const segments = rel.split("/");
      const leaf = segments.pop().replace(/\.md$/i, "");
      const keep = segments.filter(
        (s) => !/^(\.|commands|skills|agents|claude)$/.test(s) && !s.startsWith("."),
      );
      const parts = [...keep.slice(-2), leaf].filter(Boolean).map((s) => s.toLowerCase());
      trigger = "/" + parts.join(":");
    } else {
      trigger = "/" + slugifyName(parsed.name || fileBase);
    }
  }
  const requires =
    parsed.requires && parsed.requires.length ? parsed.requires : detectRequires(parsed.body);
  const id = source + ":" + (rel || fileBase);
  return {
    id,
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
    // Internal: whether the name came from the frontmatter (a real skill)
    // or was derived from the filename (probably a doc). Walker uses this
    // to filter out doc files. Not serialised to JSON consumers.
    fromExplicitName,
  };
}

/** Walk a single root with depth cap. Appends skills to `out` (source-tagged). */
async function walkForSkills(root, { maxDepth, source, cwd, out, capTotal }) {
  // Filenames that are documentation, not skills. They may live inside the
  // skills tree (e.g. /skills/README.md describing the registry) but must
  // never be ingested as skill records.
  const NOISE_FILES = new Set([
    "readme.md",
    "license.md",
    "changelog.md",
    "contributing.md",
    "code_of_conduct.md",
    "security.md",
    "notes.md",
  ]);
  async function recurse(dir, depth) {
    if (out.length >= capTotal) return;
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= capTotal) return;
      if (e.name.startsWith(".") && e.name !== ".claude") continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await recurse(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        if (NOISE_FILES.has(e.name.toLowerCase())) continue;
        try {
          const raw = await readFile(full, "utf8");
          const skill = buildSkill({ raw, absPath: full, source, cwd });
          // A real skill must declare `name` in its frontmatter — otherwise
          // it's a doc file that happens to live in the tree.
          if (skill && skill.name && skill.fromExplicitName) out.push(skill);
        } catch {}
      }
    }
  }
  await recurse(root, 0);
}

/** Dedupe by (source, trigger) — UNIQUE constraint mirrored from SQL schema. */
function dedupe(skills) {
  const seen = new Map();
  for (const s of skills) {
    const key = s.source + "::" + s.trigger;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/** List direct subdirectories of a path (1 level). */
async function listDirs(p) {
  try {
    const entries = await readdir(p, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ─── Install / update / delete df-source skills ───────────────────────────
//
// df skills live at ~/.design-factory/skills/{slug}/SKILL.md. The slug comes
// from the trigger (without the leading slash). Writing the file IS the
// persistence — registry re-scans pick it up on next /skills/registry call.

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

function validateSkillInput(input, { forUpdate = false } = {}) {
  const errors = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!forUpdate && !name) errors.push("name is required");
  if (name && name.length > 80) errors.push("name must be 80 chars or fewer");

  const body = typeof input.body === "string" ? input.body : "";
  if (!forUpdate && body.trim().length < 20)
    errors.push("instructions must be at least 20 characters");
  if (body.length > 100_000) errors.push("skill body too large (100kb max)");

  let trigger = typeof input.trigger === "string" ? input.trigger.trim() : "";
  if (trigger) {
    if (!/^\/[a-z0-9:_-]{1,40}$/i.test(trigger)) {
      errors.push(
        "command must start with / and use alphanumerics, hyphens or underscores (max 40 chars)",
      );
    }
  } else if (!forUpdate) {
    trigger = "/" + slugifyName(name);
  }

  // Security: reject common secret patterns in body. User should keep tokens
  // elsewhere, not in skill prompts.
  if (
    body &&
    /\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9\-_.]{20,})/i.test(body)
  ) {
    errors.push("remove tokens / secrets from instructions before saving");
  }

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.validation = errors;
    throw err;
  }

  return {
    name,
    trigger,
    description: typeof input.description === "string" ? input.description.trim() : null,
    body,
    requires: Array.isArray(input.requires)
      ? input.requires.filter((r) => typeof r === "string")
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
  if (requires && requires.length)
    lines.push(`requires: [${requires.map((r) => JSON.stringify(r)).join(", ")}]`);
  if (override) lines.push(`override: true`);
  if (version) lines.push(`version: ${JSON.stringify(version)}`);
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

// resolve a df-skill id to an absolute file path. The id rel is
// either repo-root relative ("skills/foo/SKILL.md" or
// ".claude/skills/foo/SKILL.md" — registry shape) or skills-dir relative
// ("foo/SKILL.md" — legacy install shape). Try the most permissive set,
// preferring canonical /skills/.
function resolveSkillPath(rel) {
  const repoRoot = getRepoRoot();
  const canonicalDir = getSkillsDir();
  const legacyDir = getLegacySkillsDir();
  // Order of preference: canonical → legacy.
  const candidates = [
    join(repoRoot, rel), // registry shape (repo-root relative)
    join(canonicalDir, rel), // legacy install shape under canonical dir
    join(legacyDir, rel), // legacy install shape under legacy dir
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function updateDfSkill(id, patch) {
  // id shape: "df:<rel>" — see resolveSkillPath() for accepted layouts.
  if (!id.startsWith("df:")) throw new Error("can only update df-source skills");
  const rel = id.slice(3);
  const filePath = resolveSkillPath(rel);
  if (!filePath) throw new Error(`skill not found: ${rel}`);
  // Refuse to write outside canonical or legacy skills dirs (defense in
  // depth — buildSkill produces controlled rel values, but be paranoid).
  const canonicalDir = getSkillsDir();
  const legacyDir = getLegacySkillsDir();
  const allowed = isPathInside(canonicalDir, filePath) || isPathInside(legacyDir, filePath);
  if (!allowed) throw new Error(`refusing: path outside skills dirs: ${filePath}`);

  const currentRaw = await readFile(filePath, "utf8");
  const current = parseSkillFile(currentRaw);

  const merged = validateSkillInput(
    {
      name: patch.name ?? current.name,
      trigger: patch.trigger ?? current.trigger,
      description: patch.description ?? current.description,
      body: patch.body ?? current.body,
      requires: patch.requires ?? current.requires,
      override: patch.override ?? current.override,
      version: patch.version ?? current.version,
    },
    { forUpdate: true },
  );

  const markdown = serializeSkillMarkdown(merged);
  await writeFile(filePath, markdown, "utf8");
  const raw = await readFile(filePath, "utf8");
  // cwd: getRepoRoot() so the rebuilt id matches the registry shape
  // ("df:skills/<slug>/SKILL.md" or "df:.claude/skills/<slug>/SKILL.md").
  return buildSkill({ raw, absPath: filePath, source: "df", cwd: getRepoRoot() });
}

async function deleteDfSkill(id) {
  if (!id.startsWith("df:")) throw new Error("can only delete df-source skills");
  const rel = id.slice(3);
  const filePath = resolveSkillPath(rel);
  if (!filePath) return; // idempotent — already gone
  const dir = dirname(filePath);
  // Defense: only allow rm under canonical or legacy skills dirs.
  const canonicalDir = getSkillsDir();
  const legacyDir = getLegacySkillsDir();
  const allowed = isPathInside(canonicalDir, dir) || isPathInside(legacyDir, dir);
  if (!allowed) throw new Error("refusing: path outside skills dirs");
  await rm(dir, { recursive: true, force: true });
}

/**
 * Build the full skills registry for a given cwd.
 * Single source of truth consumed by GET /skills/registry.
 *
 * walks BOTH canonical (/skills/) and legacy
 * (.claude/skills/) paths. Canonical is appended FIRST so dedupe()
 * (which uses Map.set first-wins on duplicate keys) preserves the
 * canonical entry on (source, trigger) collision. Legacy entries are
 * tagged path: "<legacy>" via source override + still appear in the
 * UI so users can see what's left to migrate.
 */
async function buildRegistry(cwdAbs, _customSkillsPath = null) {
  const cap = 500;
  const collected = [];
  const canonicalDir = join(cwdAbs, "skills");
  const legacyDir = join(cwdAbs, ".claude", "skills");
  // Canonical first — dedupe() keeps the first occurrence per (source,trigger).
  await walkForSkills(canonicalDir, {
    maxDepth: 2,
    source: "df",
    cwd: cwdAbs,
    out: collected,
    capTotal: cap,
  });
  await walkForSkills(legacyDir, {
    maxDepth: 2,
    source: "df",
    cwd: cwdAbs,
    out: collected,
    capTotal: cap,
  });
  const all = dedupe(collected);
  // Normalize source to "df" so the single bucket is populated cleanly.
  for (const s of all) s.source = "df";
  const truncated = collected.length >= cap;
  return {
    cwd: cwdAbs,
    scanned_at: Date.now(),
    sources: {
      df: { path: canonicalDir, legacy_path: legacyDir, count: all.length, items: all },
      project: { path: null, count: 0, items: [] },
      global: { path: null, count: 0, items: [] },
      builtin: { count: 0, items: [] },
    },
    truncated,
  };
}

// Validate the request Origin against ALLOWED_ORIGINS. On match (or
// "*" opt-out), echo it back; otherwise omit CORS headers entirely so
// the browser blocks the request. Returns true when the origin is
// permitted (or when no Origin header is present, e.g. same-origin or
// server-to-server).
const isOriginAllowed = (req) => {
  const reqOrigin = req?.headers?.origin;
  // Server-to-server / same-origin: no Origin header, allow through.
  if (!reqOrigin) return true;
  if (ALLOWED_ORIGINS === "*") return true;
  return ALLOWED_ORIGINS.has(reqOrigin);
};

const cors = (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  const reqOrigin = req?.headers?.origin;
  if (ALLOWED_ORIGINS === "*") {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin || "*");
    return true;
  }
  if (isOriginAllowed(req)) {
    if (!reqOrigin) return true;
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
    res.setHeader("Vary", "Origin");
    return true;
  }
  // Origin not on whitelist — no Allow-Origin header sent. Browser
  // blocks; we still log so dev mode can see what was rejected.
  console.warn(
    `[daemon] CORS rejected: ${reqOrigin} (allowed: ${[...ALLOWED_ORIGINS].join(", ")})`,
  );
  return false;
};

// Idempotent: the request stream can only be drained once, so we cache the
// parse promise on `req`. This lets a pre-dispatch guard (cwd scope check)
// read the body without starving the adapter's own readJson(req) call — both
// share the single cached promise (resolved OR rejected, so a parse error
// surfaces identically to both callers).
const readJson = (req) => {
  if (req.__dfBodyPromise) return req.__dfBodyPromise;
  req.__dfBodyPromise = new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > MAX_JSON_BODY_BYTES) {
        const err = new Error(`request body too large (>${MAX_JSON_BODY_BYTES} bytes)`);
        err.code = "BODY_TOO_LARGE";
        req.destroy(err);
        return;
      }
      data += c;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
  return req.__dfBodyPromise;
};

function expandHomePath(input) {
  let path = String(input || "");
  if (path === "~" || path.startsWith("~/")) {
    path = (process.env.HOME || "/") + path.slice(1);
  }
  return path;
}

/** Where /git/shallow-clone stores cloned repos. Same shape as the
 *  clone handler at /git/shallow-clone. The cache dir is daemon-owned
 *  (UI can't write to it directly via /fs/write); we expose it as a
 *  READ-only scope root so the DS importer's collectRelevantFiles
 *  walker can list cloned files when the user picks GitHub as source.
 *  Without this, the github source silently returns 0 design files
 *  even when the clone succeeded — the listFolder bridge call hits
 *  PATH_OUT_OF_SCOPE inside the cache dir. */
function getGitCacheDir() {
  return join(process.env.HOME || tmpdir(), ".design-factory-cache", "git");
}

function scopedRootPaths({ write = false } = {}) {
  const repoRoot = getRepoRoot();
  const roots = [join(repoRoot, "projects"), join(repoRoot, "design-systems"), getSkillsDir()];
  if (!write) {
    roots.push(join(repoRoot, "landing"));
    // Read-only: daemon-managed git clone cache. Adding it under write
    // would let the UI use /fs/write to drop arbitrary files into a
    // clone, which is not a flow we support.
    roots.push(getGitCacheDir());
  }
  return roots;
}

function ensureSafeRoot(path) {
  try {
    mkdirSync(path, { recursive: true });
  } catch {}
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function resolveLocalFsPath(input, { write = false } = {}) {
  const expanded = expandHomePath(input);
  if (!expanded) {
    const err = new Error("path required");
    err.code = "PATH_EMPTY";
    throw err;
  }
  if (ALLOW_ARBITRARY_FS) return resolve(expanded);

  const failures = [];
  for (const rootPath of scopedRootPaths({ write })) {
    const root = ensureSafeRoot(rootPath);
    if (!root) continue;
    try {
      return assertPathInScope(expanded, root);
    } catch (err) {
      failures.push(err?.message || String(err));
    }
  }

  const err = new PathScopeError(
    `path outside Design Factory workspace roots: ${expanded}. Set DF_ALLOW_ARBITRARY_FS=1 to opt into unrestricted local file access.`,
    "PATH_OUT_OF_SCOPE",
  );
  err.failures = failures;
  throw err;
}

function defaultFsListPath() {
  return ALLOW_ARBITRARY_FS ? process.env.HOME || "/" : join(getRepoRoot(), "projects");
}

function sendPathScopeError(res, err) {
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: err?.message || String(err),
      code: err?.code || "PATH_OUT_OF_SCOPE",
    }),
  );
}

// Parse claude stream-json → emit SSE session / text / meta / usage / tool_call / tool_result / result / done / error / auth_required.
function wireStreamJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let got_error = null;
  let stderrBuffer = "";
  let authFlagged = false;
  // content_block index → { type, name?, id?, inputBuf? } so we can accumulate
  // input_json_delta chunks and emit a complete tool_call at content_block_stop.
  const blocks = new Map();
  // Track tool_use_id → content_block index when tool_result surfaces in user turns.
  const toolUseIds = new Map();
  // Per-stream marker: did stream_event deltas already emit text? When
  // --include-partial-messages is OFF (older Claude Code builds, or builds
  // without the flag), text only arrives in the final `assistant` wrapper —
  // we have to emit it from there. When deltas fired, we skip the wrapper
  // to avoid duplication. Tracked per assistant-message-id so multi-turn
  // (tool_use → tool_result → next assistant) works correctly.
  const textStreamedMessages = new Set();
  // Tracks the currently-open assistant message id from the latest
  // `message_start` stream_event. Used so text_delta events can mark
  // the correct id in textStreamedMessages. Previous code derived msgId
  // as `val.parent_tool_use_id ?? val.message?.id` which is wrong:
  // parent_tool_use_id is the PARENT TOOL id (sub-agent context, not
  // an assistant message id), and val.message doesn't exist on
  // stream_event. Result: msgId was always undefined for root assistant
  // text → dedup never fired → wrapper re-emitted → text duplicated.
  let currentStreamMessageId = null;
  // Same idea for tool_use inputs — when stream_event content_block_stop
  // fires a complete tool_call, we mark the id so the wrapper-only path
  // doesn't duplicate it.
  const toolCallEmittedIds = new Set();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;
      // The very first line of a claude stream-json run carries session_id.
      // Pipe it to the UI so it can persist against the current project for
      // the next `--resume` spawn. Firing before any other event keeps the
      // handshake surface small.
      if (t === "system" && val.subtype === "init" && typeof val.session_id === "string") {
        res.write(`event: session\ndata: ${JSON.stringify({ sessionId: val.session_id })}\n\n`);
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: `session_id=${val.session_id}` })}\n\n`,
        );
      }
      if (t === "stream_event") {
        const ev = val.event;
        if (ev?.type === "message_start") {
          const msg = ev.message ?? {};
          // Latch the message id so subsequent text_deltas in this same
          // assistant message can mark it in textStreamedMessages with
          // the SAME id that the final assistant wrapper will use.
          if (typeof msg.id === "string") currentStreamMessageId = msg.id;
          res.write(
            `event: meta\ndata: ${JSON.stringify({
              model: msg.model,
              ttftMs: typeof val.ttft_ms === "number" ? val.ttft_ms : undefined,
              inputTokens: msg.usage?.input_tokens,
              cacheReadTokens: msg.usage?.cache_read_input_tokens,
              cacheCreationTokens: msg.usage?.cache_creation_input_tokens,
            })}\n\n`,
          );
        } else if (ev?.type === "message_stop") {
          currentStreamMessageId = null;
        } else if (ev?.type === "content_block_start") {
          const i = ev.index;
          const cb = ev.content_block ?? {};
          if (cb.type === "tool_use") {
            blocks.set(i, { type: "tool_use", id: cb.id, name: cb.name, inputBuf: "" });
            toolUseIds.set(cb.id, i);
          } else if (cb.type === "thinking") {
            blocks.set(i, { type: "thinking" });
          } else {
            blocks.set(i, { type: cb.type });
          }
        } else if (ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta") {
          const text = ev.delta.text ?? "";
          if (text) {
            full += text;
            res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
            // Mark the currently-open assistant message so the wrapper
            // handler at L702 skips re-emitting these deltas. We use
            // `currentStreamMessageId` (latched at message_start) which
            // matches the wrapper's `val.message.id`. parent_tool_use_id
            // is preserved as a fallback for sub-agent flows that don't
            // emit a top-level message_start.
            const msgId = currentStreamMessageId ?? val.parent_tool_use_id ?? null;
            if (msgId) textStreamedMessages.add(msgId);
          }
        } else if (ev?.type === "content_block_delta" && ev?.delta?.type === "input_json_delta") {
          const i = ev.index;
          const blk = blocks.get(i);
          if (blk && blk.type === "tool_use") {
            blk.inputBuf += ev.delta.partial_json ?? "";
          }
        } else if (ev?.type === "content_block_stop") {
          const i = ev.index;
          const blk = blocks.get(i);
          if (blk && blk.type === "tool_use") {
            let input = {};
            try {
              input = blk.inputBuf ? JSON.parse(blk.inputBuf) : {};
            } catch {
              input = { _raw: blk.inputBuf };
            }
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({ id: blk.id, name: blk.name, input })}\n\n`,
            );
            if (blk.id) toolCallEmittedIds.add(blk.id);
          }
        } else if (ev?.type === "message_delta") {
          const usage = ev.usage ?? {};
          res.write(
            `event: usage\ndata: ${JSON.stringify({
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens,
              cacheCreationTokens: usage.cache_creation_input_tokens,
              stopReason: ev.delta?.stop_reason,
            })}\n\n`,
          );
        }
      } else if (t === "assistant" && val.message && Array.isArray(val.message.content)) {
        // Final assistant wrapper. When --include-partial-messages is ON
        // (newer Claude Code), text already streamed via stream_event
        // deltas — skip to avoid duplication. When OFF (older builds, or
        // when the flag wasn't available at probe time), this is the
        // only place text shows up. Same logic for tool_use blocks.
        const msgId = val.message.id;
        const alreadyStreamedText = msgId && textStreamedMessages.has(msgId);
        for (const block of val.message.content) {
          if (
            block?.type === "text" &&
            typeof block.text === "string" &&
            block.text &&
            !alreadyStreamedText
          ) {
            full += block.text;
            res.write(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`);
          } else if (
            block?.type === "tool_use" &&
            typeof block.id === "string" &&
            !toolCallEmittedIds.has(block.id)
          ) {
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: block.id,
                name: typeof block.name === "string" ? block.name : "",
                input: block.input ?? {},
              })}\n\n`,
            );
            toolCallEmittedIds.add(block.id);
          }
        }
      } else if (t === "user" && Array.isArray(val.message?.content)) {
        // tool_result is nested as a user-turn message in the transcript
        for (const part of val.message.content) {
          if (part?.type === "tool_result") {
            let snippet = "";
            if (typeof part.content === "string") snippet = part.content;
            else if (Array.isArray(part.content)) {
              snippet = part.content
                .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
                .filter(Boolean)
                .join("\n");
            }
            res.write(
              `event: tool_result\ndata: ${JSON.stringify({
                id: part.tool_use_id,
                isError: !!part.is_error,
                content: snippet.slice(0, 2000),
              })}\n\n`,
            );
          }
        }
      } else if (t === "result") {
        if (val.is_error) {
          got_error = val.result || val.api_error_status || "claude CLI reported error";
        } else {
          if (!full && typeof val.result === "string") full = val.result;
          res.write(
            `event: result\ndata: ${JSON.stringify({
              durationMs: val.duration_ms,
              durationApiMs: val.duration_api_ms,
              costUsd: val.total_cost_usd,
              inputTokens: val.usage?.input_tokens,
              outputTokens: val.usage?.output_tokens,
              cacheReadTokens: val.usage?.cache_read_input_tokens,
              cacheCreationTokens: val.usage?.cache_creation_input_tokens,
              stopReason: val.stop_reason,
              numTurns: val.num_turns,
            })}\n\n`,
          );
        }
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    // Forward to the browser debug channel as SSE "log" events (clipped).
    const cleaned = chunk.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!cleaned) return;
    // Bounded accumulation — used by the close handler to replay stderr
    // as a synthetic tool_result when the child dies unexpectedly.
    if (stderrBuffer.length < 16_384) {
      stderrBuffer += cleaned + "\n";
    }
    res.write(
      `event: log\ndata: ${JSON.stringify({ level: "warn", message: `claude stderr: ${cleaned.slice(0, 400)}` })}\n\n`,
    );
    // Auth-failure fingerprint. Fire once per stream so the UI doesn't flash
    // the banner repeatedly if the CLI retries internally.
    if (!authFlagged) {
      const lower = cleaned.toLowerCase();
      if (
        lower.includes("not authenticated") ||
        lower.includes("login required") ||
        lower.includes("authentication failed") ||
        / 401(\b|$)/.test(lower)
      ) {
        authFlagged = true;
        res.write(
          `event: auth_required\ndata: ${JSON.stringify({ detail: "Run `claude login` in your terminal." })}\n\n`,
        );
      }
    }
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    // On non-zero exit, surface the accumulated stderr tail as a synthetic
    // tool_result (isError: true) so the user sees the raw crash text
    // in the chat, not just a terse exit-code line.
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (got_error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: got_error })}\n\n`);
    } else if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      const suffix = tail ? ` — stderr: ${tail}` : "";
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `claude exited with code ${code}${suffix}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but no text/Write → silent fail.
      // Surface as error so frontend renders red bubble; don't emit a
      // bogus done({content: ""}) that the chat persists as empty assistant.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "claude completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// ─── Codex stream wiring ─────────────────────────────────────────────
// Translates Codex's `exec --json` event stream into the same SSE events
// the frontend expects from /claude/stream. Event shapes documented at
// https://github.com/openai/codex (item.started/item.completed/turn.*).
//
// The Codex stream is line-delimited JSON; each line is one event. We emit:
//   event: log — for lifecycle markers (thread.started / turn.started)
//   event: meta — model id (extracted from thread.started if present)
//   event: tool_call — command_execution at item.started
//   event: tool_result — command_execution at item.completed
//   event: text — agent_message at item.completed (full text, not deltas)
//   event: usage — turn.completed.usage
//   event: done — when child exits
//   event: error — when child errors or non-zero exit with stderr
function wireCodexJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let stderrBuffer = "";
  const seenToolUses = new Set();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;

      if (t === "thread.started") {
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: `codex thread ${val.thread_id ?? ""}` })}\n\n`,
        );
        if (val.model) {
          res.write(`event: meta\ndata: ${JSON.stringify({ model: val.model })}\n\n`);
        }
      } else if (t === "turn.started") {
        res.write(
          `event: log\ndata: ${JSON.stringify({ level: "info", message: "turn running" })}\n\n`,
        );
      } else if (
        t === "item.started" &&
        val.item?.type === "command_execution" &&
        typeof val.item.id === "string"
      ) {
        const item = val.item;
        if (!seenToolUses.has(item.id)) {
          seenToolUses.add(item.id);
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({
              id: item.id,
              name: "Bash",
              input: { command: typeof item.command === "string" ? item.command : "" },
            })}\n\n`,
          );
        }
      } else if (
        t === "item.completed" &&
        val.item?.type === "command_execution" &&
        typeof val.item.id === "string"
      ) {
        const item = val.item;
        if (!seenToolUses.has(item.id)) {
          seenToolUses.add(item.id);
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({
              id: item.id,
              name: "Bash",
              input: { command: typeof item.command === "string" ? item.command : "" },
            })}\n\n`,
          );
        }
        const isError =
          typeof item.exit_code === "number" ? item.exit_code !== 0 : item.status === "failed";
        res.write(
          `event: tool_result\ndata: ${JSON.stringify({
            id: item.id,
            isError,
            content: typeof item.aggregated_output === "string" ? item.aggregated_output : "",
          })}\n\n`,
        );
      } else if (
        (t === "item.started" || t === "item.completed") &&
        val.item?.type === "file_change" &&
        Array.isArray(val.item?.changes) &&
        typeof val.item.id === "string"
      ) {
        // Codex `file_change` items: the CLI writes the file synchronously
        // via its sandboxed FS layer (no Bash, no command_execution event).
        // Without this branch the daemon was dropping every Write/Edit
        // silently — the file landed on disk but the UI never received a
        // tool_call so the iframe stayed empty until manual reload.
        // User QA 2026-05-18 — "comecei projeto com codex, nem veio prompt
        // nem começou a executar" (the prompt DID execute; only the
        // signalling was broken).
        const item = val.item;
        const change = item.changes[0] ?? {};
        const path = typeof change.path === "string" ? change.path : "";
        const kind = typeof change.kind === "string" ? change.kind : "add";
        const toolName = kind === "delete" ? "Delete" : kind === "update" ? "Edit" : "Write";
        if (t === "item.started") {
          if (!seenToolUses.has(item.id)) {
            seenToolUses.add(item.id);
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: item.id,
                name: toolName,
                input: { file_path: path },
              })}\n\n`,
            );
          }
        } else {
          // item.completed — emit tool_call for late-arriving items + result
          if (!seenToolUses.has(item.id)) {
            seenToolUses.add(item.id);
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({
                id: item.id,
                name: toolName,
                input: { file_path: path },
              })}\n\n`,
            );
          }
          const isError = item.status && item.status !== "completed";
          res.write(
            `event: tool_result\ndata: ${JSON.stringify({
              id: item.id,
              isError: !!isError,
              content: isError ? `status: ${item.status}` : `${kind} ${path}`,
            })}\n\n`,
          );
        }
      } else if (
        t === "item.completed" &&
        val.item?.type === "agent_message" &&
        typeof val.item.text === "string" &&
        val.item.text.length > 0
      ) {
        // Codex emits each paragraph of the assistant's prose as a separate
        // `agent_message` item. Concatenated without a separator they read as
        // one wall of text ("seções.O projeto ainda...A direção..."). Insert
        // a blank line between non-empty messages so the chat bubble renders
        // each thought as its own paragraph.
        const sep = full && !full.endsWith("\n") ? "\n\n" : "";
        const text = sep + val.item.text;
        full += text;
        res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
      } else if (t === "turn.completed" && val.usage) {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.usage.input_tokens,
            outputTokens: val.usage.output_tokens,
            cacheReadTokens: val.usage.cached_input_tokens,
          })}\n\n`,
        );
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `codex exit ${code}${tail ? ": " + tail : ""}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but empty agent_message stream →
      // silent fail. Surface as error.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "codex completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// ─── Gemini stream wiring ────────────────────────────────────────────
// Translates Gemini's `--output-format stream-json` events into the same
// SSE shape /claude/stream emits. Gemini's vocab is leaner than Codex/Claude:
//   { type: "init", model } → meta
//   { type: "message", role: "assistant", content: "..." } → text (each
//                                                               message is a
//                                                               full chunk)
//   { type: "result", stats: { ... } } → usage
function wireGeminiJson(child, res, onDone) {
  let buffer = "";
  let full = "";
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let val;
      try {
        val = JSON.parse(line);
      } catch {
        continue;
      }
      const t = val.type;

      if (t === "init") {
        res.write(`event: meta\ndata: ${JSON.stringify({ model: val.model })}\n\n`);
      } else if (
        t === "message" &&
        val.role === "assistant" &&
        typeof val.content === "string" &&
        val.content.length > 0
      ) {
        full += val.content;
        res.write(`event: text\ndata: ${JSON.stringify({ content: val.content })}\n\n`);
      } else if (t === "tool_use" && typeof val.tool_id === "string") {
        // Gemini CLI emits `tool_use` for write_file / read_file / etc. Map
        // write_file → Write so the UI's onToolResult iframe-reload path
        // fires. Without this branch the daemon was dropping every Gemini
        // file write silently — file landed on disk but iframe stayed empty.
        const toolName =
          val.tool_name === "write_file"
            ? "Write"
            : val.tool_name === "edit_file" || val.tool_name === "replace"
              ? "Edit"
              : val.tool_name === "read_file"
                ? "Read"
                : val.tool_name === "run_shell_command" || val.tool_name === "shell"
                  ? "Bash"
                  : val.tool_name === "delete_file"
                    ? "Delete"
                    : (val.tool_name ?? "Unknown");
        const params = val.parameters && typeof val.parameters === "object" ? val.parameters : {};
        // Normalise to UI's expected shape — file_path is the canonical key.
        const input = { ...params };
        if (typeof params.file_path === "string") input.file_path = params.file_path;
        else if (typeof params.path === "string") input.file_path = params.path;
        res.write(
          `event: tool_call\ndata: ${JSON.stringify({
            id: val.tool_id,
            name: toolName,
            input,
          })}\n\n`,
        );
      } else if (t === "tool_result" && typeof val.tool_id === "string") {
        const isError = val.status && val.status !== "success";
        res.write(
          `event: tool_result\ndata: ${JSON.stringify({
            id: val.tool_id,
            isError: !!isError,
            content: typeof val.output === "string" ? val.output : (val.status ?? ""),
          })}\n\n`,
        );
      } else if (t === "result" && val.stats) {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.stats.input_tokens,
            outputTokens: val.stats.output_tokens,
            cacheReadTokens: val.stats.cached,
          })}\n\n`,
        );
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8192) stderrBuffer = stderrBuffer.slice(-8192);
  });

  child.on("error", (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
    onDone?.();
  });

  child.on("close", (code) => {
    if (code !== 0 && stderrBuffer) {
      const tail = stderrBuffer.slice(-1000);
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          id: "cli-crash",
          isError: true,
          content: tail,
        })}\n\n`,
      );
    }
    if (code !== 0 && !full) {
      const tail = stderrBuffer.slice(-500).trim();
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: `gemini exit ${code}${tail ? ": " + tail : ""}` })}\n\n`,
      );
    } else if (!full) {
      // 1 stabilize: success exit but empty assistant message →
      // silent fail.
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "gemini completed without text or artifact" })}\n\n`,
      );
    } else {
      res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
    }
    res.end();
    onDone?.();
  });
}

// ─── Vercel BYOK publish ─────────────────────────────────────────
// Token storage: <DF_CONFIG_DIR>/vercel.json (chmod 600). Each user
// brings their own Vercel account token; we never share tokens across
// installs. Optional teamId/teamSlug for users on a team plan.
const VERCEL_CONFIG_PATH = process.env.DF_VERCEL_CONFIG_PATH || configPath("vercel.json");

async function readVercelConfig() {
  try {
    const raw = await readFile(VERCEL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      token: typeof parsed.token === "string" ? parsed.token : "",
      teamId: typeof parsed.teamId === "string" ? parsed.teamId : "",
      teamSlug: typeof parsed.teamSlug === "string" ? parsed.teamSlug : "",
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return { token: "", teamId: "", teamSlug: "" };
    throw err;
  }
}

// ─── Vercel CLI auth detection ──────────
// "queria entender localmente qual melhor jeito de lidar com
// vercel e git, git ja tava identificando cli, vercel naot em tambem?"
//
// Mirrors the gh CLI flow at /gh/token: when the user has run `vercel login`
// in their terminal, the CLI persists `{ "token": "..." }` in
// ~/.local/share/com.vercel.cli/auth.json (XDG location, used by all
// platforms in CLI ). When the file is missing or empty (just `{}`),
// the CLI is unauthenticated.
//
// We DO NOT shell out to `vercel whoami`: that command opens an interactive
// login flow when no token is found, which would hang the daemon. Reading
// auth.json is fast (~1ms) and side-effect-free.
//
// Resolution order at /config/vercel and /vercel/user:
//   1. BYOK token saved to ~/.design-factory/vercel.json (highest priority)
//   2. Vercel CLI auth.json (auto-detected fallback)
//   3. Disconnected (UI prompts to either run `vercel login` or paste token)
const VERCEL_CLI_AUTH_PATHS = [
  // XDG_DATA_HOME (Linux/macOS, also used on WSL/Windows under XDG)
  process.env.XDG_DATA_HOME ? `${process.env.XDG_DATA_HOME}/com.vercel.cli/auth.json` : null,
  `${process.env.HOME || "/tmp"}/.local/share/com.vercel.cli/auth.json`,
  // macOS canonical path
  `${process.env.HOME || "/tmp"}/Library/Application Support/com.vercel.cli/auth.json`,
  // Windows canonical path (when daemon runs under WSL2 it won't match,
  // but native Node on Windows uses APPDATA)
  process.env.APPDATA ? `${process.env.APPDATA}/com.vercel.cli/auth.json` : null,
  // Legacy ~/.vercel/auth.json (CLI < )
  `${process.env.HOME || "/tmp"}/.vercel/auth.json`,
].filter(Boolean);

async function readVercelCliAuth() {
  for (const path of VERCEL_CLI_AUTH_PATHS) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      const token = typeof parsed?.token === "string" ? parsed.token.trim() : "";
      if (token) return { token, source: "vercel-cli", path };
    } catch {
      // ENOENT or parse error — try next path
    }
  }
  return { token: "", source: null, path: null };
}

// Resolve the effective Vercel token + source. BYOK wins; falls back to
// CLI auth.json. Used by /config/vercel and /vercel/user to expose a
// unified `source` field to the UI.
async function resolveVercelAuth() {
  const cfg = await readVercelConfig().catch(() => ({ token: "", teamId: "", teamSlug: "" }));
  if (cfg.token) {
    return { token: cfg.token, source: "byok", teamId: cfg.teamId, teamSlug: cfg.teamSlug };
  }
  const cli = await readVercelCliAuth();
  if (cli.token) {
    return { token: cli.token, source: "vercel-cli", teamId: cfg.teamId, teamSlug: cfg.teamSlug };
  }
  return { token: "", source: null, teamId: cfg.teamId, teamSlug: cfg.teamSlug };
}

async function writeVercelConfig({ token, teamId, teamSlug }) {
  await mkdir(dirname(VERCEL_CONFIG_PATH), { recursive: true });
  const cur = await readVercelConfig().catch(() => ({ token: "", teamId: "", teamSlug: "" }));
  const next = {
    token: typeof token === "string" && token.trim() ? token.trim() : cur.token,
    teamId: typeof teamId === "string" ? teamId.trim() : cur.teamId,
    teamSlug: typeof teamSlug === "string" ? teamSlug.trim() : cur.teamSlug,
  };
  await writeFile(VERCEL_CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try {
    await chmod(VERCEL_CONFIG_PATH, 0o600);
  } catch {}
  return next;
}

function slugifyVercel(input) {
  return (
    String(input || "design")
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "design"
  );
}

// ─── Anthropic API BYOK ────────────────────────────────────────────
// Token storage: <DF_CONFIG_DIR>/anthropic.json (chmod 600). Env var
// ANTHROPIC_API_KEY takes precedence so power users can set it in their
// shell without touching the config file. Frontend Settings can persist
// via PUT /config/anthropic; the daemon never echoes the token back.
const ANTHROPIC_CONFIG_PATH = process.env.DF_ANTHROPIC_CONFIG_PATH || configPath("anthropic.json");

async function readAnthropicConfig() {
  try {
    const raw = await readFile(ANTHROPIC_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { token: typeof parsed.token === "string" ? parsed.token : "" };
  } catch (err) {
    if (err && err.code === "ENOENT") return { token: "" };
    throw err;
  }
}

async function writeAnthropicConfig({ token }) {
  await mkdir(dirname(ANTHROPIC_CONFIG_PATH), { recursive: true });
  await writeFile(ANTHROPIC_CONFIG_PATH, JSON.stringify({ token: token || "" }, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    await chmod(ANTHROPIC_CONFIG_PATH, 0o600);
  } catch {}
}

async function getAnthropicToken() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const cfg = await readAnthropicConfig().catch(() => ({ token: "" }));
  return cfg.token || null;
}

// ─── Generic BYOK token storage ──────────────────────────────────
// Mirrors the Anthropic pattern for OpenAI + Gemini API keys. Each gets
// its own <DF_CONFIG_DIR>/<name>.json (chmod 600). Env vars (OPENAI_API_KEY,
// GEMINI_API_KEY / GOOGLE_API_KEY) take precedence. Daemon never echoes.
const OPENAI_CONFIG_PATH = process.env.DF_OPENAI_CONFIG_PATH || configPath("openai.json");
const GEMINI_CONFIG_PATH = process.env.DF_GEMINI_CONFIG_PATH || configPath("gemini.json");
const OPENROUTER_CONFIG_PATH =
  process.env.DF_OPENROUTER_CONFIG_PATH || configPath("openrouter.json");
const KIMI_CONFIG_PATH = process.env.DF_KIMI_CONFIG_PATH || configPath("kimi.json");

async function getOpenrouterToken() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const cfg = await readSimpleTokenConfig(OPENROUTER_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

async function getOpenaiToken() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const cfg = await readSimpleTokenConfig(OPENAI_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

async function getGeminiApiToken() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const cfg = await readSimpleTokenConfig(GEMINI_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

// Moonshot/Kimi BYOK token. OpenAI-compatible HTTP API at api.moonshot.ai.
// Env KIMI_API_KEY / MOONSHOT_API_KEY take precedence over the on-disk
// config (kimi.json, chmod 600). Used by GET /kimi/models for live-fetch.
async function getKimiToken() {
  if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY;
  if (process.env.MOONSHOT_API_KEY) return process.env.MOONSHOT_API_KEY;
  const cfg = await readSimpleTokenConfig(KIMI_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

// ─── Theme overrides (Settings → Appearance editor) ───────────
// Per-theme color overrides applied at runtime via injected <style> in
// the frontend. tokens.css stays canonical — overrides only override.
//
// Schema v2 (presets): { active: "default", presets: { name: { dark, light } } }
// Schema v1 (legacy): { dark, light } ← auto-migrated to a "default" preset on read
const THEME_CONFIG_PATH = process.env.DF_THEME_CONFIG_PATH || configPath("theme.json");

const DEFAULT_PRESET_NAME = "default";

function emptyPreset() {
  return { dark: {}, light: {} };
}

function emptyThemeConfig() {
  return { active: DEFAULT_PRESET_NAME, presets: { [DEFAULT_PRESET_NAME]: emptyPreset() } };
}

async function readThemeConfig() {
  try {
    const raw = await readFile(THEME_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    // Migrate legacy {dark, light} → {active, presets}
    if (parsed && typeof parsed === "object" && !parsed.presets && (parsed.dark || parsed.light)) {
      return {
        active: DEFAULT_PRESET_NAME,
        presets: {
          [DEFAULT_PRESET_NAME]: {
            dark: typeof parsed.dark === "object" ? parsed.dark : {},
            light: typeof parsed.light === "object" ? parsed.light : {},
          },
        },
      };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.presets &&
      typeof parsed.presets === "object"
    ) {
      const presets = {};
      for (const [name, preset] of Object.entries(parsed.presets)) {
        if (!preset || typeof preset !== "object") continue;
        presets[name] = {
          dark: typeof preset.dark === "object" ? preset.dark : {},
          light: typeof preset.light === "object" ? preset.light : {},
        };
      }
      if (Object.keys(presets).length === 0) presets[DEFAULT_PRESET_NAME] = emptyPreset();
      const active =
        typeof parsed.active === "string" && presets[parsed.active]
          ? parsed.active
          : Object.keys(presets)[0];
      return { active, presets };
    }
    return emptyThemeConfig();
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyThemeConfig();
    throw err;
  }
}

async function writeThemeConfig({ active, presets }) {
  await mkdir(dirname(THEME_CONFIG_PATH), { recursive: true });
  // Drop empty-string overrides so reset = "remove key"
  const cleanScope = (obj) =>
    Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => typeof v === "string" && v.trim().length > 0),
    );
  const clean = {};
  for (const [name, preset] of Object.entries(presets || {})) {
    if (!name || typeof name !== "string") continue;
    clean[name] = {
      dark: cleanScope(preset?.dark),
      light: cleanScope(preset?.light),
    };
  }
  if (Object.keys(clean).length === 0) clean[DEFAULT_PRESET_NAME] = emptyPreset();
  const safeActive = typeof active === "string" && clean[active] ? active : Object.keys(clean)[0];
  await writeFile(
    THEME_CONFIG_PATH,
    JSON.stringify({ active: safeActive, presets: clean }, null, 2) + "\n",
    { mode: 0o600 },
  );
  try {
    await chmod(THEME_CONFIG_PATH, 0o600);
  } catch {}
}

async function readSimpleTokenConfig(path) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return { token: typeof parsed.token === "string" ? parsed.token : "" };
  } catch (err) {
    if (err && err.code === "ENOENT") return { token: "" };
    throw err;
  }
}

async function writeSimpleTokenConfig(path, { token }) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ token: token || "" }, null, 2) + "\n", { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {}
}

async function getOpenAIToken() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const cfg = await readSimpleTokenConfig(OPENAI_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

async function getGeminiToken() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const cfg = await readSimpleTokenConfig(GEMINI_CONFIG_PATH).catch(() => ({ token: "" }));
  return cfg.token || null;
}

// Pipe Anthropic API SSE → DF SSE. Anthropic uses standard SSE (event: + data:)
// with their own event vocabulary documented at
// https://docs.anthropic.com/en/api/messages-streaming
async function pipeAnthropicStream(upstream, res) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!frame.trim()) continue;
      let event = "message";
      let dataStr = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!dataStr) continue;
      let val;
      try {
        val = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (event === "message_start" && val.message) {
        res.write(
          `event: meta\ndata: ${JSON.stringify({
            model: val.message.model,
            inputTokens: val.message.usage?.input_tokens,
            cacheReadTokens: val.message.usage?.cache_read_input_tokens,
            cacheCreationTokens: val.message.usage?.cache_creation_input_tokens,
          })}\n\n`,
        );
      } else if (event === "content_block_delta" && val.delta?.type === "text_delta") {
        const text = val.delta.text ?? "";
        if (text) {
          full += text;
          res.write(`event: text\ndata: ${JSON.stringify({ content: text })}\n\n`);
        }
      } else if (event === "message_delta") {
        res.write(
          `event: usage\ndata: ${JSON.stringify({
            inputTokens: val.usage?.input_tokens,
            outputTokens: val.usage?.output_tokens,
            stopReason: val.delta?.stop_reason,
          })}\n\n`,
        );
      } else if (event === "error") {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: val.error?.message ?? "anthropic api error",
          })}\n\n`,
        );
      }
    }
  }
  // 1 stabilize: anthropic API stream completed → emit exactly one
  // terminal event. Empty completion (rare: model returned no text) →
  // explicit error so frontend renders red bubble; never silent done.
  if (full) {
    res.write(`event: done\ndata: ${JSON.stringify({ content: full })}\n\n`);
  } else {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "anthropic completed without text or artifact" })}\n\n`,
    );
  }
  res.end();
}

// Make a project dir a git repo (idempotent). CLI agents (claude/codex) probe
// `git` for workspace context; in a non-repo dir they spew "fatal: not a git
// repository" to stderr, which the chat surfaces as an error even though the
// generation (stdout → file) succeeds. A standalone DF project has no ambient
// repo (unlike running from a dev checkout), so `git init` it once.
function ensureGitRepo(dir) {
  try {
    if (!dir || typeof dir !== "string" || !existsSync(dir)) return;
    if (existsSync(join(dir, ".git"))) return; // already a repo — no-op
    execFileSync("git", ["init"], { cwd: dir, timeout: 5000, stdio: "ignore" });
  } catch {
    /* git missing or failed — non-fatal; the CLI still runs */
  }
}

// Frozen dependency bag passed to every provider adapter. Adapters take
// these as parameters (rather than importing from index.mjs) to keep
// the import graph unidirectional — index.mjs imports providers/, never
// the other way around.
const PROVIDER_DEPS = Object.freeze({
  readJson,
  wireStreamJson,
  wireCodexJson,
  wireGeminiJson,
  pipeAnthropicStream,
  getAnthropicToken,
  getOpenrouterToken,
  getOpenaiToken,
  getGeminiApiToken,
  spawn,
  CLAUDE_BIN,
  ensureGitRepo,
  // Workspace-scope check for [attached image: PATH] markers — the API adapters
  // pass this to extractImageAttachments so a forged absolute path can't read
  // arbitrary files off disk and exfiltrate them to a third-party provider.
  imagePathInScope: (p) => {
    try {
      resolveLocalFsPath(p, { write: false });
      return true;
    } catch {
      return false;
    }
  },
});

const server = http.createServer(async (req, res) => {
  const originOk = cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(originOk ? 204 : 403);
    res.end();
    return;
  }
  if (!originOk) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "origin not allowed" }));
    return;
  }

  // ─── Filesystem endpoints ─────────────────────────────────────
  // Strict match so /fs/list doesn't swallow /fs/list-projects.
  if (req.method === "GET" && (req.url === "/fs/list" || req.url.startsWith("/fs/list?"))) {
    try {
      const u = new URL(req.url, "http://localhost");
      let path = u.searchParams.get("path") || defaultFsListPath();
      // Expand '~' and '~/' prefixes to HOME
      const abs = resolveLocalFsPath(path, { write: false });
      // ETag from the directory mtime — bumps when any direct child is
      // added or removed (POSIX directory mtime semantics). Browser
      // can re-use the cached listing across navigations and we only
      // pay the readdir+stat loop when the folder actually changed.
      // See /fs/read above for the same conservative caching pattern.
      let dirStat;
      try {
        dirStat = await stat(abs);
      } catch {}
      const etag = dirStat ? `W/"dir-${dirStat.mtimeMs.toFixed(0)}"` : null;
      const ifNoneMatch = req.headers["if-none-match"];
      if (etag && ifNoneMatch && ifNoneMatch === etag) {
        res.writeHead(304, {
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        });
        res.end();
        return;
      }
      const entries = await readdir(abs, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        if (e.name.startsWith(".") && !u.searchParams.get("showHidden")) continue;
        const full = join(abs, e.name);
        try {
          const s = await stat(full);
          out.push({
            name: e.name,
            path: full,
            isDir: e.isDirectory(),
            size: s.size,
            mtime: s.mtimeMs,
          });
        } catch {}
      }
      out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const headers = { "Content-Type": "application/json" };
      if (etag) {
        headers.ETag = etag;
        headers["Cache-Control"] = "private, max-age=0, must-revalidate";
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ path: abs, entries: out }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  // ─── FS copy-dir / move-dir — used by project duplicate / move ─
  if (req.method === "POST" && req.url.startsWith("/fs/copy-dir")) {
    try {
      const body = await readJson(req);
      let { from, to } = body;
      if (!from || !to) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "from + to required" }));
        return;
      }
      const safeFrom = resolveLocalFsPath(from, { write: false });
      const safeTo = resolveLocalFsPath(to, { write: true });
      await cp(safeFrom, safeTo, { recursive: true, errorOnExist: false });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ from: safeFrom, to: safeTo }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/fs/move-dir")) {
    let body;
    try {
      body = await readJson(req);
      let { from, to } = body;
      if (!from || !to) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "from + to required" }));
        return;
      }
      const safeFrom = resolveLocalFsPath(from, { write: true });
      const safeTo = resolveLocalFsPath(to, { write: true });
      await rename(safeFrom, safeTo);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ from: safeFrom, to: safeTo }));
    } catch (e) {
      // rename fails cross-device; fall back to cp + rm
      try {
        body = body || {};
        let { from, to } = body;
        if (from && to) {
          const safeFrom = resolveLocalFsPath(from, { write: true });
          const safeTo = resolveLocalFsPath(to, { write: true });
          await cp(safeFrom, safeTo, { recursive: true, errorOnExist: false });
          await rm(safeFrom, { recursive: true, force: true });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ from: safeFrom, to: safeTo, fallback: "cp+rm" }));
          return;
        }
      } catch {}
      if (e instanceof PathScopeError) sendPathScopeError(res, e);
      else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/fs/mkdir")) {
    try {
      const u = new URL(req.url, "http://localhost");
      let path = u.searchParams.get("path");
      if (!path) {
        res.writeHead(400);
        res.end();
        return;
      }
      path = resolveLocalFsPath(path, { write: true });
      await mkdir(path, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path, created: true }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/fs/read")) {
    // Return 200 with `{ found: false }` for missing files instead of
    // 4xx — the browser console logs every 4xx/5xx as a failed request,
    // which spammed the devtools whenever a project's HTML was probed
    // before existing on disk. Real errors (path missing, etc) keep 400.
    const u = new URL(req.url, "http://localhost");
    let path = u.searchParams.get("path");
    if (!path) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path required" }));
      return;
    }
    let abs;
    try {
      abs = resolveLocalFsPath(path, { write: false });
    } catch (e) {
      if (e instanceof PathScopeError) {
        sendPathScopeError(res, e);
        return;
      }
      throw e;
    }
    let s;
    try {
      s = await stat(abs);
    } catch (e) {
      // ENOENT / permissions / etc — treat as "not found", soft-200 so
      // the browser doesn't surface a Failed-resource log entry.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ found: false, error: String((e && e.code) || e) }));
      return;
    }
    try {
      if (s.size > 2 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "file too large (>2MB)" }));
        return;
      }
      // User ask 2026-05-21: "por que nao temos cache de imagens e
      // telas e pagians do factory, sinto q a cada pagina tudo recarrega
      // sempre". The browser was being asked to re-fetch the full
      // payload on every navigation. ETag here is a quick "did this
      // file change?" probe — derived from mtime + size, with no body
      // copy involved. Browser stores the response under the ETag and
      // re-sends `If-None-Match` on the next request; we answer 304
      // when the file is still the same and skip the read + JSON
      // serialization entirely. `max-age=0, must-revalidate` keeps the
      // semantics conservative: every request still phones home (so
      // edits land immediately), but the round-trip becomes a 304
      // shaving the file body off the wire.
      const etag = `W/"${s.mtimeMs.toFixed(0)}-${s.size}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) {
        res.writeHead(304, {
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        });
        res.end();
        return;
      }
      const buf = await readFile(abs);
      // Trust file extension first — UTF-8 multi-byte chars (box-drawing,
      // accented letters, emoji) trip the ASCII-printable heuristic below
      // and got HTML files served back as `data:application/octet-stream;
      // base64,...`. Observed: Claude generated an HTML
      // with `┄┄┄` separator comments, daemon returned base64, iframe
      // rendered the data URI as plain text. Anchor on extension for
      // known text formats; fall back to byte sampling only for unknown.
      const TEXT_EXT_RX =
        /\.(html?|svg|xml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|json|jsonc|md|markdown|mdx|txt|csv|tsv|yaml|yml|toml|ini|conf|sh|bash|zsh|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|sql|graphql|gql)$/i;
      let isText;
      if (TEXT_EXT_RX.test(abs)) {
        isText = true;
      } else {
        const sample = buf.subarray(0, Math.min(buf.length, 256));
        let textProb = 0;
        for (const b of sample) {
          if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) textProb++;
        }
        isText = sample.length === 0 || textProb / sample.length > 0.9;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      });
      // For binary files, encode as a typed data URI so images render
      // correctly when consumed by an <img src>. Falls back to
      // application/octet-stream for unknown extensions.
      const lowerExt = abs.toLowerCase().split(".").pop() || "";
      const binaryMime =
        lowerExt === "png"
          ? "image/png"
          : lowerExt === "jpg" || lowerExt === "jpeg"
            ? "image/jpeg"
            : lowerExt === "gif"
              ? "image/gif"
              : lowerExt === "webp"
                ? "image/webp"
                : lowerExt === "avif"
                  ? "image/avif"
                  : lowerExt === "ico"
                    ? "image/x-icon"
                    : "application/octet-stream";
      res.end(
        JSON.stringify({
          path: abs,
          size: s.size,
          mtime: s.mtimeMs,
          isText,
          content: isText
            ? buf.toString("utf8")
            : `data:${binaryMime};base64,${buf.toString("base64")}`,
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── FS write-base64 — used by image attach to persist binary files ─
  if (req.method === "POST" && req.url.startsWith("/fs/write-base64")) {
    try {
      const body = await readJson(req);
      let { path, base64 } = body;
      if (!path || typeof base64 !== "string") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path + base64 required" }));
        return;
      }
      const abs = resolveLocalFsPath(path, { write: true });
      // BUG-26: dirname, not a forward-slash-only regex — Windows `abs`
      // is backslash-separated so the old regex created the file path as
      // a directory (EISDIR). This is why image/doc attachments failed.
      const parent = dirname(abs);
      if (parent && parent !== abs) await mkdir(parent, { recursive: true }).catch(() => {});
      const buf = Buffer.from(base64, "base64");
      await writeFile(abs, buf);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: abs, size: buf.length }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  // ─── FS open-folder ─ reveal a project / DS / skill folder in the
  // OS file manager (Finder on macOS, Explorer on Windows, xdg-open on
  // Linux). User ask: "no compartilhar queria adicionar a opcao abrir
  // pasta do projeto". Scope-checked through the same workspace roots
  // as /fs/write, so a malicious caller can't open arbitrary paths.
  // Spawn uses argv (not shell string) — no command-injection surface.
  if (req.method === "POST" && req.url.startsWith("/fs/open-folder")) {
    try {
      const body = await readJson(req);
      const inputPath = body?.path;
      if (typeof inputPath !== "string" || !inputPath) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path required" }));
        return;
      }
      // Resolve through the same scope rules as writes — refuse to open
      // anything outside the workspace roots unless DF_ALLOW_ARBITRARY_FS
      // is set. `write: true` so the loop tries projects/, design-systems/,
      // and skills/ (not landing/ which is read-only here).
      const abs = resolveLocalFsPath(inputPath, { write: true });
      let st;
      try {
        st = await stat(abs);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `path not found: ${abs}` }));
        return;
      }
      const target = st.isDirectory() ? abs : dirname(abs);
      const platform = process.platform;
      // Pick the OS opener. Windows can't take "explorer <path>" with
      // backslashes through Node's spawn without shell:true (the .exe
      // resolution kicks in); macOS and Linux take argv cleanly.
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
      const child = spawn(cmd, [target], {
        detached: true,
        stdio: "ignore",
        shell: platform === "win32",
      });
      child.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `failed to launch ${cmd}: ${err?.message || err}` }));
        }
      });
      child.unref();
      // Give spawn a tick to surface "ENOENT cmd not found" before we
      // 200. If the child didn't emit 'error' synchronously, we trust
      // the OS handler took over.
      setTimeout(() => {
        if (!res.headersSent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, opened: target, opener: cmd }));
        }
      }, 30);
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  // ─── /fs/write/artifact ──────────────────────────────────────
  // Atomic write + per-finalPath lock + rolling backup + Static P0
  // (minimal floor). Routes through artifact-writer.mjs so the policy
  // is testable in isolation. MUST be matched BEFORE the `/fs/write`
  // prefix below, otherwise the looser route swallows it.
  //
  // Path B contract: providers without a native Write tool emit a
  // <artifact identifier="..." type="..." title="...">…</artifact> block,
  // the runtime parser extracts it and POSTs here. Claude's Path A
  // (native Write tool) hits the legacy `/fs/write` endpoint below.
  //
  // Feature flag: DF_ENABLE_ARTIFACT_CONTRACT=1 enables Path B end-to-end
  // (system prompt + parser + this endpoint). Default OFF in v0.3 first
  // release so we can activate provider-by-provider (D20). Even with the
  // flag off the endpoint stays reachable for direct integration tests.
  if (
    req.method === "POST" &&
    (req.url === "/fs/write/artifact" || req.url.startsWith("/fs/write/artifact?"))
  ) {
    try {
      const body = await readJson(req);
      const { identifier, type, content, contentHash, minBytes, intent } = body || {};
      if (!identifier || typeof identifier !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "identifier required (path inside projects/)",
            code: "BAD_REQUEST",
          }),
        );
        return;
      }
      if (!type || typeof type !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "type required (e.g. text/html)", code: "BAD_REQUEST" }));
        return;
      }
      if (typeof content !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "content required (string body)", code: "BAD_REQUEST" }));
        return;
      }
      // Resolve repoRoot from git-common-dir (same pattern as the chat
      // endpoints further down). Falls back to process.cwd() outside a
      // git checkout so dev / test scaffolds work.
      const repoRoot = getRepoRoot();

      // : optional project-files resolver. Default OFF until the
      // first release. With the flag on, we authoritatively re-resolve the
      // identifier through `resolveArtifactTarget()` (defense-in-depth — the
      // frontend computes the same thing as a hint). Result determines the
      // FINAL identifier we hand to writeArtifactSafely(), and after the
      // write succeeds we upsert the registry entry + active/primary flags.
      //
      // With the flag OFF, behaviour is unchanged from : artifact
      // is written wherever the identifier points (single-file projects).
      const projectFilesEnabled =
        process.env.DF_ENABLE_PROJECT_FILES === "1" ||
        process.env.DF_ENABLE_PROJECT_FILES === "true";

      let identifierToWrite = identifier;
      let resolved = null;
      let registryBefore = null;
      let projectsRoot = null;
      let projectSlug = null;

      if (projectFilesEnabled) {
        // Need projectsRoot upfront to drive both the resolver and the
        // registry upsert. Falls back gracefully if the projects dir isn't
        // yet created (first project ever).
        const candidateRoot = join(repoRoot, "projects");
        try {
          await mkdir(candidateRoot, { recursive: true });
        } catch {
          /* */
        }
        projectsRoot = realpathSync(candidateRoot);

        // Extract slug from the identifier so we can read the registry.
        // Identifier may or may not be `projects/`-prefixed.
        const tidied = identifier
          .replace(/\\/g, "/")
          .replace(/^\.?\/+/, "")
          .replace(/^projects\//, "");
        projectSlug = tidied.split("/")[0] || null;
        if (!projectSlug) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "identifier missing project slug", code: "BAD_REQUEST" }),
          );
          return;
        }

        registryBefore = await readOrRebuildRegistry(projectSlug, projectsRoot);
        const resolveResult = resolveArtifactTarget(
          {
            projectId: projectSlug,
            requestedIdentifier: identifier,
            currentActiveFile: registryBefore.activeFile,
            currentPrimaryFile: registryBefore.primaryFile,
            requestedType: type,
            intent,
            existingFiles: registryBefore.files,
          },
          projectsRoot,
        );
        if (resolveResult && resolveResult.error) {
          const code = resolveResult.error.code;
          const status =
            code === "PATH_OUT_OF_SCOPE"
              ? 400
              : code === "AMBIGUOUS_IDENTIFIER"
                ? 400
                : code === "INTENT_PATH_CONFLICT"
                  ? 422
                  : code === "INVALID_ROLE"
                    ? 422
                    : 400;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: resolveResult.error.message,
              code,
              details: resolveResult.error.details || null,
            }),
          );
          return;
        }
        resolved = resolveResult;
        // The resolver gave us an absolute finalPath. Convert back to a
        // `projects/{slug}/...` identifier so writeArtifactSafely's existing
        // path scoping and slug extraction work unchanged.
        identifierToWrite = resolved.normalizedIdentifier;
      }

      const result = await writeArtifactSafely({
        identifier: identifierToWrite,
        type,
        content,
        contentHash,
        repoRoot,
        minBytes,
      });

      // : upsert registry after a successful write (skip when noop
      // — the file content didn't change, but we may still want to bump
      // updatedAt; on noop we leave the registry untouched to keep replay
      // idempotency).
      if (projectFilesEnabled && resolved && result && result.ok && !result.noop) {
        try {
          const key = toRegistryKey(result.finalPath, projectsRoot);
          await upsertRegistryFile({
            slug: projectSlug,
            projectsRoot,
            key,
            entry: {
              type,
              role: resolved.role,
              previewable: resolved.previewAfterWrite,
              hash: result.hash,
              parent: resolved.parent,
            },
            setActive: resolved.setActive,
            setPrimary: resolved.setPrimary,
          });
        } catch (regErr) {
          // Registry update failure is non-fatal — the artifact is on
          // disk. Log and surface a soft warning so the UI can hint at
          // potential drift.
          console.warn(
            `[daemon] /fs/write/artifact: registry upsert failed for ${projectSlug}: ${regErr.message}`,
          );
          result.registryWarning = regErr.message;
        }
      }

      // Annotate result with resolver outcome so the UI/test surface knows
      // what happened.
      if (resolved) {
        result.role = resolved.role;
        result.previewAfterWrite = resolved.previewAfterWrite;
        result.isNewFile = resolved.isNewFile;
        result.setActive = resolved.setActive;
        result.setPrimary = resolved.setPrimary;
        if (resolved.parent) result.parent = resolved.parent;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (res.headersSent) return;
      // Map structured errors to the right HTTP status. The writer module
      // attaches `code` for everything it raises intentionally.
      if (e instanceof PathScopeError) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, code: e.code || "PATH_OUT_OF_SCOPE" }));
        return;
      }
      const code = e && e.code;
      if (code === "STATIC_FAIL") {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: e.message,
            code: "static-fail",
            reason: e.reason,
            details: e.details || null,
          }),
        );
        return;
      }
      if (code === "OVERSIZE") {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: e.message,
            code: "oversize",
            maxBytes: e.maxBytes ?? MAX_ARTIFACT_BYTES,
          }),
        );
        return;
      }
      if (code === "LOCK_TIMEOUT") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, code: "structured-conflict" }));
        return;
      }
      if (code === "BAD_REQUEST") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, code: "BAD_REQUEST" }));
        return;
      }
      // Unknown failure mode — surface the message at 500.
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e && e.message ? e.message : e), code: "INTERNAL" }));
    }
    return;
  }

  // ─── DELETE /fs/artifact?path=... ────────────────────────────
  // Catastrophic runtime fail with NO previous backup → client deletes
  // the freshly-written artifact and the preview shows empty state.
  // This is exposed separately from the generic /fs/write so:
  //   - the client doesn't have to know the temp/backup paths,
  //   - we can scope the deletion strictly to projects/{slug}/* (no
  //     accidental cross-project deletes),
  //   - we can refuse to delete anything inside .df/ (registry files,
  //     backups themselves, provider sessions).
  //
  // Body: none required. Path comes via query string for ergonomics
  // (matches the existing fs/read pattern at line ~1180).
  if (req.method === "DELETE" && req.url.startsWith("/fs/artifact")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const requestedPath = u.searchParams.get("path");

      // Resolve repoRoot the same way /fs/write/artifact does.
      const repoRoot = getRepoRoot();

      const result = await deleteArtifactSafely({ requestedPath, repoRoot });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          deleted: result.deleted,
          path: result.finalPath,
        }),
      );
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof PathScopeError) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: e.message,
            code: e.code || "PATH_OUT_OF_SCOPE",
          }),
        );
        return;
      }
      const code = e && e.code;
      if (code === "BAD_REQUEST") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, code: "BAD_REQUEST" }));
        return;
      }
      if (code === "PROTECTED_PATH") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, code: "PROTECTED_PATH" }));
        return;
      }
      console.error("[daemon] DELETE /fs/artifact failed:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: String(e && e.message ? e.message : e),
          code: "INTERNAL",
        }),
      );
    }
    return;
  }

  // ─── FS write ─────────────────────────────────────────────────
  // Defense layer 2 for the "prose-in-.html" recurring bug. CLAUDE.md's
  // Project Agent Pipeline explains the contract (layer 1 — education);
  // this is the enforcement floor. If a .html/.htm/.svg write doesn't
  // begin with '<' (after trim + BOM strip), return 400 with actionable
  // error. The tool_result carries isError=true so the CLI knows to
  // retry with real markup instead of silently landing prose on disk.
  //
  // Scope: only HTML-family today. CSS/JS/JSON grammars vary enough
  // that a first-char heuristic produces false positives.
  if (req.method === "POST" && req.url.startsWith("/fs/write")) {
    try {
      const body = await readJson(req);
      let path = body.path;
      const content = body.content;
      if (!path || typeof content !== "string") {
        console.warn(
          `[daemon] /fs/write 400 path+content: path=${JSON.stringify(path)} contentType=${typeof content} len=${typeof content === "string" ? content.length : "n/a"}`,
        );
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path + content required" }));
        return;
      }
      const abs = resolveLocalFsPath(path, { write: true });

      const extMatch = abs.match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : "";
      const isHtmlLike = ext === "html" || ext === "htm" || ext === "svg";
      if (isHtmlLike) {
        const trimmed = content.replace(/^﻿/, "").trimStart();
        const looksStructured = /^(<!doctype\b|<html\b|<svg\b|<\?xml\b|<)/i.test(trimmed);
        if (!looksStructured) {
          const preview = trimmed.slice(0, 120).replace(/\s+/g, " ");
          console.warn(`[daemon] /fs/write 400 prose-reject: ${abs} (.${ext}) got="${preview}"`);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Refused to write .${ext} file — content starts with prose, not markup.`,
              got: preview,
              expected: "Must start with <!DOCTYPE html>, <html>, <svg>, <?xml, or any HTML tag.",
              hint: "Put the HTML document in the file. Put commentary in your chat reply (1-3 lines), not in the file. See .claude/CLAUDE.md Project Agent Pipeline.",
            }),
          );
          return;
        }
      }

      // BUG-26: use dirname (separator-agnostic) instead of a
      // forward-slash-only regex. On Windows `abs` is resolved with
      // backslashes, so `abs.replace(/\/[^/]+$/, "")` matched nothing →
      // parent === abs → mkdir created the FILE path itself as a
      // directory → writeFile then failed with EISDIR. Surfaced as the
      // persistTurn /fs/write 400 and broke any first write into a
      // not-yet-existing subdir (chat sessions, attachments, DS files).
      const parent = dirname(abs);
      if (parent && parent !== abs) await mkdir(parent, { recursive: true }).catch(() => {});
      await writeFile(abs, content, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: abs, size: content.length }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      }
    }
    return;
  }

  // ─── Fetch arbitrary URL (for website→design.md) ──────────────
  if (req.method === "GET" && req.url.startsWith("/fetch-url")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const target = u.searchParams.get("url");
      if (!target) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "url required" }));
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const r = await ssrfSafeFetch(target, {
        signal: controller.signal,
        headers: { "User-Agent": "design-factory/1.0 (DS extraction)" },
      });
      clearTimeout(timer);
      const text = await r.text();
      // Cap payload at ~500kb to avoid blowing the Claude prompt
      const capped =
        text.length > 500_000 ? text.slice(0, 500_000) + "\n<!-- truncated at 500kb -->" : text;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          url: target,
          status: r.status,
          contentType: r.headers.get("content-type"),
          html: capped,
          size: text.length,
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [DEPRECATED] GitHub endpoints — the in-app GitHub UI is not part of
  // the current public surface. Endpoints preserved (no behavior change)
  // for a future polished surface and any external automation that may
  // still call them. The frontend no longer fires these.
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── GitHub: get token from gh CLI (primary) or device-flow cache ─
  if (req.method === "GET" && req.url === "/gh/token") {
    let source = null;
    let hasToken = false;
    try {
      const { stdout } = await execFileP("gh", ["auth", "token"], { timeout: 3000 });
      if (stdout.trim()) {
        source = "gh-cli";
        hasToken = true;
      }
    } catch {}
    if (!hasToken) {
      try {
        const raw = await readFile(DF_TOKEN_PATH, "utf8");
        if (raw.trim()) {
          source = "device-flow";
          hasToken = true;
        }
      } catch {}
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hasToken, source }));
    return;
  }

  // ─── GitHub device flow: start ────────────────────────────────
  // Starts the OAuth device flow for GitHub and returns { user_code,
  // verification_uri, device_code, interval, expires_in }. The user
  // enters user_code at verification_uri to authorize.
  if (req.method === "POST" && req.url === "/gh/device/start") {
    try {
      const r = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: GH_CLIENT_ID, scope: "repo read:user" }),
      });
      const data = await r.json();
      if (!r.ok || !data?.device_code) {
        res.writeHead(r.status || 500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: data?.error_description || data?.error || "device code request failed",
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          deviceCode: data.device_code,
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          verificationUriComplete: data.verification_uri_complete,
          interval: data.interval ?? 5,
          expiresIn: data.expires_in ?? 900,
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── GitHub device flow: poll for access token ───────────────
  // Client should poll every `interval` seconds. Returns one of:
  //   { status: "pending" } — user hasn't authorized yet
  //   { status: "slow_down" } — back off a few seconds
  //   { status: "ok", token: ... } — success, token saved to DF_TOKEN_PATH
  //   { status: "error", error } — terminal failure (expired/denied)
  if (req.method === "POST" && req.url === "/gh/device/poll") {
    try {
      const body = await readJson(req);
      const { deviceCode } = body;
      if (!deviceCode) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "deviceCode required" }));
        return;
      }
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: GH_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await r.json();
      if (data.access_token) {
        // Persist token for subsequent /gh/token lookups
        try {
          const parent = dirname(DF_TOKEN_PATH); // BUG-26: separator-agnostic
          await mkdir(parent, { recursive: true });
          await writeFile(DF_TOKEN_PATH, data.access_token, "utf8");
          try {
            await chmod(DF_TOKEN_PATH, 0o600);
          } catch {}
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tokenType: data.token_type, scope: data.scope }));
        return;
      }
      if (data.error === "authorization_pending") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending" }));
        return;
      }
      if (data.error === "slow_down") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "slow_down" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "error",
          error: data.error_description || data.error || "unknown",
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: String(e) }));
      }
    }
    return;
  }

  // ─── GitHub device flow: sign out (drop cached token) ────────
  if (req.method === "POST" && req.url === "/gh/device/logout") {
    try {
      await rm(DF_TOKEN_PATH, { force: true });
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ─── GitHub: list user's repos ────────────────────────────────
  if (req.method === "GET" && req.url.startsWith("/gh/repos")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const limit = Math.min(Number(u.searchParams.get("limit") || 50), 200);
      const search = u.searchParams.get("search") || "";
      const pat = u.searchParams.get("pat");
      let token = pat;
      if (!token) {
        try {
          const { stdout } = await execFileP("gh", ["auth", "token"], { timeout: 3000 });
          token = stdout.trim();
        } catch {}
      }
      if (!token) {
        // Device-flow cache fallback
        try {
          token = (await readFile(DF_TOKEN_PATH, "utf8")).trim();
        } catch {}
      }
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "no GitHub token (run `gh auth login`, pass ?pat=, or use device flow)",
          }),
        );
        return;
      }
      // Hit /user/repos with sort=updated
      const r = await fetch(`https://api.github.com/user/repos?per_page=${limit}&sort=updated`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "design-factory/1.0",
        },
      });
      if (!r.ok) {
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `gh api ${r.status} ${r.statusText}` }));
        return;
      }
      let list = await r.json();
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(
          (x) =>
            x.full_name.toLowerCase().includes(q) ||
            (x.description || "").toLowerCase().includes(q),
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          repos: list.map((x) => ({
            id: x.id,
            fullName: x.full_name,
            name: x.name,
            description: x.description,
            cloneUrl: x.clone_url,
            htmlUrl: x.html_url,
            defaultBranch: x.default_branch,
            private: x.private,
            updatedAt: x.updated_at,
            stargazersCount: x.stargazers_count,
          })),
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Git: shallow clone for DS extraction ─────────────────────
  //
  // Destination path is deterministic: {slug}-{sha256(repoUrl)[:12]}. That
  // way a DsEntry stored in settings keeps pointing at a stable path across
  // app restarts — before this, we appended Date.now() and the cache
  // evaporated every session. If the folder already has a .git we reuse
  // it (fast path); otherwise we clean up any partial and do a fresh
  // shallow clone.
  if (req.method === "POST" && req.url.startsWith("/git/shallow-clone")) {
    try {
      const body = await readJson(req);
      const { url: repoUrl, pat } = body;
      if (!repoUrl) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "url required" }));
        return;
      }
      const slug = repoUrl
        .replace(/\.git$/, "")
        .replace(/^.*[\/:]/, "")
        .toLowerCase();
      const urlHash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
      const dest = join(
        process.env.HOME || "/tmp",
        ".design-factory-cache",
        "git",
        `${slug}-${urlHash}`,
      );

      // Fast path: existing valid clone — reuse.
      if (existsSync(join(dest, ".git"))) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: dest, slug, reused: true }));
        return;
      }

      // Clean any partial directory from a failed previous attempt.
      await rm(dest, { recursive: true, force: true }).catch(() => {});
      await mkdir(dest, { recursive: true });

      let cloneUrl = repoUrl;
      let tokenForClone = pat;
      if (!tokenForClone) {
        try {
          const { stdout } = await execFileP("gh", ["auth", "token"], { timeout: 3000 });
          if (stdout.trim()) tokenForClone = stdout.trim();
        } catch {}
      }
      if (!tokenForClone) {
        try {
          tokenForClone = (await readFile(DF_TOKEN_PATH, "utf8")).trim();
        } catch {}
      }
      if (tokenForClone && /^https:\/\/github\.com/.test(repoUrl)) {
        cloneUrl = repoUrl.replace(/^https:\/\//, `https://${tokenForClone}@`);
      }
      await execFileP("git", ["clone", "--depth=1", "--quiet", cloneUrl, dest], { timeout: 60000 });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: dest, slug, reused: false }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e?.stderr || e) }));
      }
    }
    return;
  }

  // ─── List project folders — <repoRoot>/projects/* is the source of truth ─
  // UI used to trust the DB, which let stale entries haunt the grid after a
  // folder got rm'd. User decision: filesystem is canonical. DB still
  // carries metadata (name, mode, timestamps, html cache) but only for
  // slugs that currently have a folder.
  if (req.method === "GET" && req.url.startsWith("/fs/list-projects")) {
    try {
      const repoRoot = getRepoRoot();
      const root = join(repoRoot, "projects");
      let entries = [];
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        // projects/ doesn't exist yet — just return an empty list
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ projects: [] }));
        return;
      }
      const out = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith(".")) continue;
        const projectPath = join(root, e.name);
        // Prefer <slug>.html, fallback to index.html, fallback to first .html
        let html = null;
        const slugHtml = join(projectPath, `${e.name}.html`);
        const indexHtml = join(projectPath, "index.html");
        if (existsSync(slugHtml)) html = slugHtml;
        else if (existsSync(indexHtml)) html = indexHtml;
        else {
          try {
            const files = await readdir(projectPath);
            const firstHtml = files.find((f) => f.endsWith(".html"));
            if (firstHtml) html = join(projectPath, firstHtml);
          } catch {}
        }
        let mtime = 0;
        try {
          mtime = (await stat(projectPath)).mtimeMs;
        } catch {}
        out.push({ slug: e.name, path: projectPath, htmlFile: html, mtime });
      }
      // Most recently touched first — matches the "most recent" default order
      out.sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: out }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Global user config — <DF_CONFIG_DIR>/config.json ──────────────────
  // Canonical store for cross-project user preferences: theme, default
  // provider + model, skills scan path, built-in prompt overrides. DB
  // stays as a fallback mirror for offline / Tauri modes.
  //
  //   GET /config/read → { config: {...} }
  //   POST /config/write { patch } → merges into existing, returns { config }
  if (req.method === "GET" && req.url.startsWith("/config/read")) {
    try {
      const path = configPath("config.json");
      let config = {};
      try {
        const raw = await readFile(path, "utf8");
        config = JSON.parse(raw);
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ config }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/config/write")) {
    try {
      const body = await readJson(req);
      const patch = body?.patch;
      if (!patch || typeof patch !== "object") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "patch required" }));
        return;
      }
      const dir = getConfigDir();
      const path = join(dir, "config.json");
      await mkdir(dir, { recursive: true });
      let current = {};
      try {
        const raw = await readFile(path, "utf8");
        current = JSON.parse(raw);
      } catch {}
      const merged = { ...current, ...patch };
      // Drop empty-string values so cleared settings vanish from disk
      // instead of sticking around as falsy.
      for (const k of Object.keys(merged)) {
        if (merged[k] === "" || merged[k] === null || merged[k] === undefined) {
          delete merged[k];
        }
      }
      await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ config: merged }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Editorial commands (verbs) — <DF_CONFIG_DIR>/commands/*.md ────────
  // Custom verbs and built-in overrides. Built-in defaults ship inside the
  // bundle (src/runtime/verbs/*.md compiled via Vite ?raw); this folder only
  // stores user-edited or user-created entries. The frontend merges both.
  //
  //   GET /commands/list → { commands: [{id, body}] }
  //   POST /commands/write { id, body } → writes <DF_CONFIG_DIR>/commands/{id}.md
  //   POST /commands/delete { id } → removes <DF_CONFIG_DIR>/commands/{id}.md
  if (req.method === "GET" && req.url.startsWith("/commands/list")) {
    try {
      const dir = configPath("commands");
      let commands = [];
      try {
        const files = await readdir(dir);
        for (const name of files) {
          if (!name.endsWith(".md")) continue;
          const id = name.replace(/\.md$/, "");
          if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) continue;
          try {
            const body = await readFile(join(dir, name), "utf8");
            commands.push({ id, body });
          } catch {}
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ commands }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/commands/write")) {
    try {
      const body = await readJson(req);
      const id = String(body?.id ?? "").trim();
      const content = String(body?.body ?? "");
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) {
        res.writeHead(400);
        res.end(
          JSON.stringify({ error: "invalid id (must match [a-z0-9][a-z0-9-]*, max 41 chars)" }),
        );
        return;
      }
      if (!content || content.length < 20) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "body required (min 20 chars)" }));
        return;
      }
      const dir = configPath("commands");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.md`), content, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id, ok: true }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/commands/delete")) {
    try {
      const body = await readJson(req);
      const id = String(body?.id ?? "").trim();
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid id" }));
        return;
      }
      const path = configPath("commands", `${id}.md`);
      try {
        await rm(path);
      } catch (e) {
        // Idempotent — missing file isn't an error.
        if (e?.code !== "ENOENT") throw e;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id, ok: true }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Design systems list — derived from design-systems/*/design.md ───────
  // Wave 4 of the DB-less migration. Scans the canonical DS folder and
  // returns one entry per subdir with a design.md inside. Frontend no
  // longer needs to maintain a parallel db.getSetting("design_systems")
  // list that could drift from disk.
  if (req.method === "GET" && req.url.startsWith("/fs/list-design-systems")) {
    try {
      const repoRoot = getRepoRoot();
      const root = join(repoRoot, "design-systems");
      let entries = [];
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ designSystems: [] }));
        return;
      }
      const out = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith(".")) continue;
        const dsPath = join(root, e.name);
        const designMdPath = join(dsPath, "design.md");
        if (!existsSync(designMdPath)) continue;
        let mtime = 0;
        let name = e.name;
        try {
          mtime = (await stat(designMdPath)).mtimeMs;
          // Peek at the first 4KB to pull the name: from the yaml
          // frontmatter if present. Saves the frontend a round-trip
          // per card on the DS grid.
          const handle = await import("node:fs").then((m) => m.promises.open(designMdPath, "r"));
          const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
          await handle.close();
          const head = buffer.subarray(0, bytesRead).toString("utf8");
          const frontmatter = head.match(/^---\s*\n([\s\S]*?)\n---/m);
          if (frontmatter) {
            const nameLine = frontmatter[1].split(/\r?\n/).find((l) => /^\s*name\s*:/.test(l));
            if (nameLine) {
              const value = nameLine
                .replace(/^\s*name\s*:\s*/, "")
                .replace(/^["']|["']$/g, "")
                .trim();
              if (value) name = value;
            }
          }
        } catch {}
        // Optional cover image — first cover.{png,jpg,jpeg,webp} match wins.
        // Saved next to design.md when the user uploads one through the
        // DS setup modal. Absent for DSes created before the feature, or
        // for users who skipped the upload step.
        let coverPath = null;
        for (const ext of ["png", "jpg", "jpeg", "webp"]) {
          const candidate = join(dsPath, `cover.${ext}`);
          if (existsSync(candidate)) {
            coverPath = candidate;
            break;
          }
        }
        // Optional preview.html — generated on-demand via /ds/generate-preview.
        const previewCandidate = join(dsPath, "preview.html");
        const previewPath = existsSync(previewCandidate) ? previewCandidate : null;
        out.push({
          slug: e.name,
          name,
          path: dsPath,
          designMdPath,
          mtime,
          ...(coverPath ? { coverPath } : {}),
          ...(previewPath ? { previewPath } : {}),
        });
      }
      out.sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ designSystems: out }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── /ds/generate-design-md — extract a DS's design.md from sources ──
  //
  // Async fire-and-forget: returns 202 immediately, runs the LLM in the
  // background. The desired UX: paste a link, pick a model, click
  // generate, have the DS created immediately, then open it to view
  // the design.md and watch the preview render in the background while
  // doing other things. Mirrors the existing
  // /ds/generate-preview pattern so closing the DS modal mid-extraction
  // (or navigating away) doesn't kill the run.
  //
  // Pipeline:
  //   1. mkdir <dsPath>
  //   2. write placeholder design.md (so the DS appears in /fs/list-
  //      design-systems immediately and the detail screen has a target)
  //   3. write .design-md-generating.json marker
  //   4. return 202 to the caller
  //   5. bg: spawn provider via /<provider>/once with the supplied prompt
  //   6. on success: overwrite design.md with the real extracted content
  //   7. clear .design-md-generating.json
  //   8. if generatePreviewAfter: chain into /ds/generate-preview
  //   9. on failure: write .design-md-error.json so the detail screen
  //      can surface the error
  //
  // Wire: POST /ds/generate-design-md
  //   body: { dsPath, designMdPath, prompt, provider, model,
  //           generatePreviewAfter?, name? }
  //   202:  { status: "started", placeholderWritten: bool }
  //   4xx:  { error }
  if (req.method === "POST" && req.url === "/ds/generate-design-md") {
    try {
      const body = await readJson(req);
      const { dsPath, designMdPath, prompt, provider, model, generatePreviewAfter, name } =
        body || {};
      if (typeof dsPath !== "string" || !dsPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "dsPath required" }));
        return;
      }
      if (typeof designMdPath !== "string" || !designMdPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "designMdPath required" }));
        return;
      }
      if (typeof prompt !== "string" || !prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "prompt required" }));
        return;
      }
      const adapter = getProvider(provider);
      if (!adapter) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `unknown provider: ${provider}` }));
        return;
      }
      // Step 1: ensure the DS folder exists.
      await mkdir(dsPath, { recursive: true });

      // Step 2: placeholder design.md — minimal valid frontmatter so
      // /fs/list-design-systems picks the folder up and renders a card.
      // The body explains the state so the detail screen reads cleanly
      // even before the real content lands.
      const placeholder = [
        `---`,
        `name: ${name || "extracting…"}`,
        `description: Design system extraction in progress`,
        `---`,
        ``,
        `# Extraindo design system…`,
        ``,
        `O ${provider} está analisando os arquivos de fonte e destilando o`,
        `design.md canônico. Isso normalmente leva 30–90 segundos.`,
        ``,
        `Esta página vai atualizar automaticamente quando a extração terminar.`,
        `Você pode fechar este modal / navegar pra outra tela — o trabalho`,
        `roda em background.`,
      ].join("\n");
      const errorPath = join(dsPath, ".design-md-error.json");
      const generatingPath = join(dsPath, ".design-md-generating.json");
      try {
        await rm(errorPath, { force: true });
      } catch {}
      // Only write the placeholder if there's no design.md already on
      // disk (re-run / retry). Don't blow away a real design.md if the
      // user is re-extracting.
      if (!existsSync(designMdPath)) {
        try {
          await writeFile(designMdPath, placeholder, "utf8");
        } catch {}
      }
      try {
        await writeFile(
          generatingPath,
          JSON.stringify(
            {
              provider,
              model,
              startedAt: new Date().toISOString(),
              generatePreviewAfter: !!generatePreviewAfter,
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch {}

      // Acknowledge IMMEDIATELY — caller is fire-and-forget.
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started", placeholderWritten: true, provider, model }));

      // Kick the actual generation in the background. Same sandbox cwd
      // pattern as /ds/generate-preview — tool-capable CLIs (claude,
      // codex, kimi, opencode) get a throwaway dir so any Write/Edit
      // they decide to call lands in /tmp instead of the user's repo.
      const extractionSandbox = await mkdtemp(join(tmpdir(), "df-ds-extract-"));

      (async () => {
        const upstreamBody = JSON.stringify({
          prompt,
          model,
          cwd: extractionSandbox,
          noWorkspace: true,
        });
        try {
          const upstreamData = await new Promise((resolve, reject) => {
            const lreq = http.request(
              {
                host: "127.0.0.1",
                port: PORT,
                method: "POST",
                path: `/${provider}/once`,
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(upstreamBody),
                },
                timeout: 3_600_000,
              },
              (lres) => {
                let chunks = "";
                lres.setEncoding("utf8");
                lres.on("data", (c) => {
                  chunks += c;
                });
                lres.on("end", () => {
                  try {
                    const parsed = chunks ? JSON.parse(chunks) : {};
                    resolve({ status: lres.statusCode, body: parsed });
                  } catch {
                    resolve({
                      status: lres.statusCode,
                      body: { error: `non-JSON response: ${chunks.slice(0, 200)}` },
                    });
                  }
                });
              },
            );
            lreq.on("timeout", () => lreq.destroy(new Error(`${provider} took longer than 60min`)));
            lreq.on("error", reject);
            lreq.write(upstreamBody);
            lreq.end();
          });
          if (upstreamData.status >= 400 || upstreamData.body?.error) {
            throw new Error(
              upstreamData.body?.error || `provider ${provider} returned ${upstreamData.status}`,
            );
          }
          const rawText = upstreamData.body?.text || "";
          // Coerce the raw response into a usable design.md — repairs the
          // common Claude/opus quirk of omitting the closing `---`
          // frontmatter fence (+ inline fences, short prose lead-in),
          // then validates. Still rejects tool-use summary prose so a
          // non-doc never gets written. See ds-coerce.mjs. Observed:
          // a 10663B doc rejected for a missing closing fence.
          const { md, ok: looksLikeMd } = coerceDesignMd(rawText);
          if (!looksLikeMd) {
            // Dump the raw response so the user can inspect WHAT the
            // model returned. Common shapes: tool-use summary prose,
            // an apology / refusal, or a markdown explanation of what
            // the doc covers (instead of the doc itself).
            try {
              await writeFile(
                join(dsPath, ".design-md-rawtext.txt"),
                `# Raw provider response (validation failed)\n` +
                  `# provider: ${provider}\n# model: ${model}\n` +
                  `# bytes: ${rawText.length}\n` +
                  `# looksLikeMd: ${looksLikeMd}\n` +
                  `# at: ${new Date().toISOString()}\n\n${rawText}`,
                "utf8",
              );
            } catch {}
            throw new Error(
              `provider returned no recognizable design.md (got ${rawText.length}B, ` +
                `looksLikeMd=${looksLikeMd}). Raw dump em .design-md-rawtext.txt na pasta da DS. ` +
                `Comum: modelo usou Write tool em vez de devolver texto. Tenta outro modelo no picker.`,
            );
          }
          await writeFile(designMdPath, md, "utf8");
          // Clear generating marker BEFORE kicking the preview chain so
          // the detail screen flips from "Extraindo…" to "Gerando preview…"
          // in one tick rather than briefly showing both.
          try {
            await rm(generatingPath, { force: true });
          } catch {}

          // Step 8: chain into preview generation if requested. Same
          // loopback pattern as the extraction call above. Treat this
          // as fire-and-forget — preview has its own marker files and
          // the detail screen polls them independently.
          if (generatePreviewAfter) {
            const previewBody = JSON.stringify({ dsPath, designMdPath, provider, model });
            try {
              await new Promise((resolve, reject) => {
                const preq = http.request(
                  {
                    host: "127.0.0.1",
                    port: PORT,
                    method: "POST",
                    path: "/ds/generate-preview",
                    headers: {
                      "Content-Type": "application/json",
                      "Content-Length": Buffer.byteLength(previewBody),
                    },
                  },
                  (pres) => {
                    let chunks = "";
                    pres.on("data", (c) => {
                      chunks += c;
                    });
                    pres.on("end", () => resolve({ status: pres.statusCode }));
                  },
                );
                preq.on("error", reject);
                preq.write(previewBody);
                preq.end();
              });
            } catch (e) {
              console.warn(`[ds] preview chain failed: ${e?.message || e}`);
            }
          }
        } catch (e) {
          try {
            await writeFile(
              errorPath,
              JSON.stringify(
                {
                  error: String(e?.message || e),
                  provider,
                  model,
                  at: new Date().toISOString(),
                },
                null,
                2,
              ),
              "utf8",
            );
          } catch {}
        } finally {
          try {
            await rm(extractionSandbox, { recursive: true, force: true });
          } catch {}
          try {
            await rm(generatingPath, { force: true });
          } catch {}
        }
      })();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── /ds/generate-preview — render a DS's design.md as preview.html ──
  //
  // Fixed pipeline:
  //   1. Read design.md from disk
  //   2. Build a prompt asking the chosen provider for ONE self-contained
  //      HTML file applying every token/rule
  //   3. Dispatch to /<provider>/once (loopback HTTP — reuses every
  //      adapter's spawn + auth code)
  //   4. Strip any ``` fence the model wrapped around the HTML
  //   5. Write to <ds-path>/preview.html
  //
  // The prompt is fixed (apps/daemon/src/ds-preview-prompt.mjs) so a CLI
  // invocation of this endpoint and the GUI Generate Preview modal share
  // identical behavior. No frontend-controlled prompt content.
  //
  // Wire: POST /ds/generate-preview
  //   body: { dsPath, designMdPath, provider, model }
  //   200:  { html, previewPath, bytes }
  //   4xx:  { error }
  if (req.method === "POST" && req.url === "/ds/generate-preview") {
    try {
      const body = await readJson(req);
      const { dsPath, designMdPath, provider, model } = body || {};
      if (typeof dsPath !== "string" || !dsPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "dsPath required" }));
        return;
      }
      if (typeof designMdPath !== "string" || !designMdPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "designMdPath required" }));
        return;
      }
      if (typeof provider !== "string" || !provider) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "provider required" }));
        return;
      }
      const adapter = getProvider(provider);
      if (!adapter) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `unknown provider: ${provider}` }));
        return;
      }
      // Read design.md.
      let designMd;
      try {
        designMd = await readFile(designMdPath, "utf8");
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `cannot read design.md: ${e.message}` }));
        return;
      }
      // Derive a human name for the prompt's hero copy.
      let dsName = "design system";
      const frontmatter = designMd.match(/^---\s*\n([\s\S]*?)\n---/);
      if (frontmatter) {
        const nameLine = frontmatter[1].split(/\r?\n/).find((l) => /^\s*name\s*:/.test(l));
        if (nameLine) {
          const value = nameLine
            .replace(/^\s*name\s*:\s*/, "")
            .replace(/^["']|["']$/g, "")
            .trim();
          if (value) dsName = value;
        }
      }
      const prompt = buildDsPreviewPrompt(designMd, dsName);

      // Fire-and-forget — acknowledge immediately, do the heavy work
      // off the HTTP request so the modal/picker isn't blocked. The
      // frontend polls preview.html + .preview-error.json on the DS
      // folder to surface success/failure.
      //
      // Sandbox cwd: every tool-capable CLI (claude, codex, kimi,
      // opencode) decides on its own to use Write/Edit when asked to
      // "generate HTML" — `-y` / `--dangerously-skip-permissions`
      // makes that automatic. Kimi destroyed the Vite root index.html
      // by writing the generated Nike page there. Mitigation: spawn a
      // throwaway temp dir as cwd, so any rogue file write lands in
      // /tmp/df-preview-* and never touches the worktree, the DS
      // folder, or any user path. The HTML we want is still the
      // stdout text.
      const previewSandbox = await mkdtemp(join(tmpdir(), "df-preview-"));

      const errorPath = join(dsPath, ".preview-error.json");
      const generatingPath = join(dsPath, ".preview-generating.json");
      // Clear any prior error from a previous attempt so the frontend
      // doesn't immediately re-pick up stale state.
      try {
        await rm(errorPath, { force: true });
      } catch {}
      // Mark generation as in-flight on disk so the frontend can
      // restore "Gerando…" state on remount / page refresh / DS
      // switch without depending on transient React state.
      try {
        await writeFile(
          generatingPath,
          JSON.stringify(
            {
              provider,
              model,
              startedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch {}
      // cover.html generation was prototyped here (wordmark+dot) but
      // user rejected the visual ("ta carnaval"). Disabled — DS
      // cards fall back to the palette+Aa swatch band again.

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started", provider, model }));

      // Kick the actual generation in the background. Errors are
      // written to .preview-error.json so the polling frontend sees
      // them; success writes preview.html which the same polling
      // picks up. Loopback timeout bumped to 60 min — every adapter
      // gets full elbow room since we're no longer blocking the
      // user's HTTP request.
      (async () => {
        // Sandbox cwd is included in the loopback body so adapters
        // (kimi/claude/codex/etc) spawn their CLI inside /tmp/df-preview-*
        // instead of inheriting the daemon's process cwd. Critical:
        // without this, kimi -y / claude --dangerously-skip-permissions
        // will Write generated files into the worktree (Vite root) and
        // overwrite real source.
        //
        // noWorkspace tells kimi to use cwd as spawn dir but NOT pass
        // `-w` (kimi indexes the workspace with -w and hangs on any
        // prompt larger than tiny). Other adapters ignore this field.
        const upstreamBody = JSON.stringify({
          prompt,
          model,
          cwd: previewSandbox,
          noWorkspace: true,
        });
        try {
          const upstreamData = await new Promise((resolve, reject) => {
            const lreq = http.request(
              {
                host: "127.0.0.1",
                port: PORT,
                method: "POST",
                path: `/${provider}/once`,
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(upstreamBody),
                },
                timeout: 3_600_000, // 60 min — generous; matches user expectations of "deixar rodando"
              },
              (lres) => {
                let chunks = "";
                lres.setEncoding("utf8");
                lres.on("data", (c) => {
                  chunks += c;
                });
                lres.on("end", () => {
                  try {
                    const parsed = chunks ? JSON.parse(chunks) : {};
                    resolve({ status: lres.statusCode, body: parsed });
                  } catch {
                    resolve({
                      status: lres.statusCode,
                      body: { error: `non-JSON response: ${chunks.slice(0, 200)}` },
                    });
                  }
                });
              },
            );
            lreq.on("timeout", () => lreq.destroy(new Error(`${provider} took longer than 60min`)));
            lreq.on("error", reject);
            lreq.write(upstreamBody);
            lreq.end();
          });
          if (upstreamData.status >= 400 || upstreamData.body?.error) {
            throw new Error(
              upstreamData.body?.error || `provider ${provider} returned ${upstreamData.status}`,
            );
          }
          const rawText = upstreamData.body?.text || "";
          const html = stripHtmlFence(rawText);
          if (!html || !/<\s*html[\s>]/i.test(html)) {
            // Dump the raw provider response next to design.md so the
            // user can inspect WHY the extractor missed it. Common
            // causes: provider used Write tool (response is prose),
            // returned markdown analysis, or wrapped HTML in a fence
            // the regex doesn't yet handle. Turns "got 65932B" from a
            // black box into a debuggable artifact.
            try {
              await writeFile(
                join(dsPath, ".preview-rawtext.txt"),
                `# Raw provider response (validation failed)\n` +
                  `# provider: ${provider}\n# model: ${model}\n` +
                  `# bytes: ${rawText.length}\n` +
                  `# at: ${new Date().toISOString()}\n\n${rawText}`,
                "utf8",
              );
            } catch {}
            throw new Error(
              `provider returned no recognizable HTML (got ${rawText.length}B). ` +
                `Raw dump em .preview-rawtext.txt na pasta da DS. ` +
                `Tenta outro modelo no picker.`,
            );
          }
          await writeFile(join(dsPath, "preview.html"), html, "utf8");
        } catch (e) {
          try {
            await writeFile(
              errorPath,
              JSON.stringify(
                {
                  error: String(e?.message || e),
                  provider,
                  model,
                  at: new Date().toISOString(),
                },
                null,
                2,
              ),
              "utf8",
            );
          } catch {}
        } finally {
          // Drop the sandbox no matter what happened. Stray files the
          // provider may have written into /tmp/df-preview-* go with it.
          try {
            await rm(previewSandbox, { recursive: true, force: true });
          } catch {}
          // Clear the in-flight marker so the frontend stops showing
          // the "Gerando…" state once the result file is in place.
          try {
            await rm(generatingPath, { force: true });
          } catch {}
        }
      })();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Chat persistence — per-thread JSONL under projects/<slug>/.df/chat/ ─
  // One file per thread, append-only, one message per line. Filesystem-
  // canonical so a projects/ tarball is a complete backup including
  // conversations. DB tmsg:{threadId} stays as a fallback cache.
  //
  // Wire:
  //   POST /fs/chat-append { slug, threadId, message } → { ok: true, bytes }
  //   GET /fs/chat-read?slug=X&threadId=Y → { messages: [...] }
  //
  // 2026-04-29 routing fix: this prefix-match was greedy and intercepted
  // /fs/chat-append-turn requests too, returning {"error":"message
  // required"} because chat-append-turn POSTs `turn`, not `message`.
  // User hit this 11× in reels2 — every finalized turn since the
  // chat-append-turn endpoint landed silently failed to persist to JSONL.
  // Fix: require either an exact match OR a `?` query suffix; never
  // match a path that has more chars after `/fs/chat-append`.
  if (
    req.method === "POST" &&
    (req.url === "/fs/chat-append" || req.url.startsWith("/fs/chat-append?"))
  ) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const threadId =
        typeof body?.threadId === "string"
          ? body.threadId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)
          : "";
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      if (!body?.message || typeof body.message !== "object") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "message required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const chatDir = join(target, ".df", "chat");
      await mkdir(chatDir, { recursive: true });
      const line = JSON.stringify(body.message) + "\n";
      const filePath = join(chatDir, `${threadId}.jsonl`);
      // fs.appendFile — atomic append on POSIX
      const { appendFile } = await import("node:fs/promises");
      await appendFile(filePath, line, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: line.length }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // Legacy per-message reader. URL match tightened so /fs/chat-read-turns
  // (handler below) doesn't get hijacked by this prefix-match.
  if (
    req.method === "GET" &&
    (req.url === "/fs/chat-read" || req.url.startsWith("/fs/chat-read?"))
  ) {
    try {
      const u = new URL(req.url, "http://localhost");
      const rawSlug = u.searchParams.get("slug") || "";
      const slug = normalizeProjectSlug(rawSlug);
      const threadId = (u.searchParams.get("threadId") || "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .slice(0, 80);
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const filePath = join(repoRoot, "projects", slug, ".df", "chat", `${threadId}.jsonl`);
      let text = "";
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: [] }));
        return;
      }
      const messages = text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // Turn-based read. Returns turns (one per user prompt + AI response pair).
  // Auto-migrates legacy `{role,text,...}` JSONL files to the turn schema in
  // place on first read, so the UI gets a single canonical shape and old
  // files don't accumulate a permanent translation cost.
  //
  // Pairing rule: consecutive `user → claude` lines collapse into one turn.
  // Multiple claude lines following a user merge into one ai with joined
  // text. Unpaired user lines become a turn with `ai: null`.
  if (req.method === "GET" && req.url.startsWith("/fs/chat-read-turns")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const rawSlug = u.searchParams.get("slug") || "";
      const slug = normalizeProjectSlug(rawSlug);
      const threadId = (u.searchParams.get("threadId") || "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .slice(0, 80);
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const filePath = join(repoRoot, "projects", slug, ".df", "chat", `${threadId}.jsonl`);
      let text = "";
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ turns: [] }));
        return;
      }
      const lines = text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const isTurn = (r) =>
        r &&
        typeof r === "object" &&
        typeof r.id === "string" &&
        typeof r.user === "object" &&
        r.user !== null;

      // Two passes: detect if file has any legacy lines. If yes, convert
      // the legacy run(s) into turns AND rewrite the file with the new
      // schema so the next read is zero-cost.
      const hasLegacy = lines.some((l) => !isTurn(l));
      const turns = [];
      let pending = null;
      let counter = 0;
      const flush = () => {
        if (pending) {
          turns.push(pending);
          pending = null;
        }
      };
      for (const raw of lines) {
        if (isTurn(raw)) {
          flush();
          turns.push(raw);
          continue;
        }
        if (raw && raw.role === "user") {
          flush();
          pending = {
            id: `legacy-${raw.ts ?? Date.now()}-${counter++}`,
            ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
            user: { text: typeof raw.text === "string" ? raw.text : "" },
            ai: null,
          };
        } else if (raw && raw.role === "claude") {
          if (!pending) {
            pending = {
              id: `legacy-orphan-${raw.ts ?? Date.now()}-${counter++}`,
              ts: typeof raw.ts === "number" ? raw.ts : Date.now(),
              user: { text: "" },
              ai: null,
            };
          }
          const claudeText = typeof raw.text === "string" ? raw.text : "";
          const claudeTs = typeof raw.ts === "number" ? raw.ts : pending.ts;
          if (pending.ai) {
            pending.ai.text = pending.ai.text ? `${pending.ai.text}\n\n${claudeText}` : claudeText;
            if (raw.is_design) pending.ai.is_design = true;
          } else {
            pending.ai = {
              text: claudeText,
              tools: [],
              is_design: !!raw.is_design,
              status: "done",
              duration_ms: claudeTs - pending.ts,
            };
          }
        }
      }
      flush();

      // In-place migration: rewrite the file with new schema if we found
      // any legacy lines. Atomic via temp + rename so a crash mid-write
      // doesn't corrupt the log.
      if (hasLegacy && turns.length > 0) {
        try {
          const newContent = turns.map((t) => JSON.stringify(t)).join("\n") + "\n";
          const { writeFile, rename } = await import("node:fs/promises");
          const tmp = `${filePath}.migrating`;
          await writeFile(tmp, newContent, "utf8");
          await rename(tmp, filePath);
        } catch (e) {
          // Migration is best-effort. Even if it fails, the in-memory
          // result is still served correctly to the UI.
          console.warn("[chat-read-turns] migration write failed", e);
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ turns, migrated: hasLegacy && turns.length > 0 }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // Append a complete turn (one JSONL line). The frontend calls this once
  // per turn at the moment the AI side reaches a terminal state (done /
  // error / cancelled). No partial / streaming writes — the file only ever
  // contains finalized turns.
  // Wipe chat for a single project. Truncates the JSONL canonical log
  // AND the snapshot mirror so reload doesn't resurrect cleared turns.
  // User-triggered via the Clear chat button — never automatic.
  // ── List chat threads for a project ─────────────────────────
  // GET /fs/chat-list?slug=X → { threads: [{ threadId, mtime, msgCount, firstMsg }] }
  // Reads .df/chat/*.jsonl files, parses first user message as preview.
  if (req.method === "GET" && req.url.startsWith("/fs/chat-list")) {
    try {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      const raw = u.searchParams.get("slug") ?? "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const chatDir = join(target, ".df", "chat");
      const threads = [];
      try {
        const entries = await readdir(chatDir);
        for (const name of entries) {
          if (!name.endsWith(".jsonl")) continue;
          const threadId = name.slice(0, -".jsonl".length);
          const filePath = join(chatDir, name);
          let mtime = 0;
          let msgCount = 0;
          let firstMsg = "";
          try {
            const s = await stat(filePath);
            mtime = s.mtimeMs;
            // Read first ~8KB to extract first user message (no full file load)
            const head = await readFile(filePath, "utf8").catch(() => "");
            const lines = head.split("\n").filter((l) => l.trim());
            msgCount = lines.length;
            for (const line of lines) {
              try {
                const turn = JSON.parse(line);
                const userText = turn?.user_message?.content || turn?.user || turn?.content || "";
                if (typeof userText === "string" && userText.trim()) {
                  firstMsg = userText.trim().slice(0, 120);
                  break;
                }
              } catch {}
            }
          } catch {}
          threads.push({ threadId, mtime, msgCount, firstMsg });
        }
      } catch (err) {
        if (err && err.code !== "ENOENT") throw err;
      }
      threads.sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ threads }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/fs/chat-clear")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const threadId =
        typeof body?.threadId === "string"
          ? body.threadId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)
          : "";
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const chatDir = join(target, ".df", "chat");
      const { unlink } = await import("node:fs/promises");
      const jsonlPath = join(chatDir, `${threadId}.jsonl`);
      const snapPath = join(chatDir, `${threadId}.snapshot.json`);
      await unlink(jsonlPath).catch(() => {});
      await unlink(snapPath).catch(() => {});
      console.log(`[chat-clear] wiped ${slug}/${threadId}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/fs/chat-append-turn")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const threadId =
        typeof body?.threadId === "string"
          ? body.threadId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)
          : "";
      if (!slug || !threadId) {
        console.warn("[chat-append-turn] 400: missing slug/threadId", {
          rawSlug: raw,
          threadId: body?.threadId,
        });
        res.writeHead(400);
        res.end(
          JSON.stringify({
            error: "slug + threadId required",
            got: { slug: raw, threadId: body?.threadId },
          }),
        );
        return;
      }
      const turn = body?.turn;
      if (!turn || typeof turn !== "object" || typeof turn.id !== "string") {
        console.warn("[chat-append-turn] 400: malformed turn", JSON.stringify(turn).slice(0, 200));
        res.writeHead(400);
        res.end(
          JSON.stringify({
            error: "turn with string id required",
            got: { hasUser: !!turn?.user, hasAi: !!turn?.ai, idType: typeof turn?.id },
          }),
        );
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const chatDir = join(target, ".df", "chat");
      await mkdir(chatDir, { recursive: true });
      const line = JSON.stringify(turn) + "\n";
      const filePath = join(chatDir, `${threadId}.jsonl`);
      const { appendFile } = await import("node:fs/promises");
      await appendFile(filePath, line, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: line.length }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Chat snapshot — full-state mirror written on every message change ─
  //
  // The append-only chat.jsonl only finalizes turns when the AI reaches a
  // terminal state (done/error). Streams that get cancelled, page reloads,
  // or browser crashes lose everything in flight. This snapshot endpoint
  // mirrors the full in-memory message array to disk on a debounced timer
  // so even partial conversations survive. chat-load falls back to it when
  // chat.jsonl is missing or empty.
  //
  //   POST /fs/chat-snapshot { slug, threadId, messages } → { ok }
  //   GET /fs/chat-snapshot?slug=X&threadId=Y → { messages: [...] | null }
  if (req.method === "POST" && req.url.startsWith("/fs/chat-snapshot")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      const threadId =
        typeof body?.threadId === "string"
          ? body.threadId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)
          : "";
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      const messages = Array.isArray(body?.messages) ? body.messages : null;
      if (!messages) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "messages array required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const chatDir = join(target, ".df", "chat");
      await mkdir(chatDir, { recursive: true });
      const filePath = join(chatDir, `${threadId}.snapshot.json`);
      const tmp = `${filePath}.writing`;
      const payload = JSON.stringify({ ts: Date.now(), messages }, null, 0);
      const { writeFile, rename } = await import("node:fs/promises");
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, filePath);
      console.log(
        `[chat-snapshot] wrote ${payload.length}B → ${slug}/${threadId} (${messages.length} msgs)`,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: payload.length }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/fs/chat-snapshot")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const rawSlug = u.searchParams.get("slug") || "";
      const slug = normalizeProjectSlug(rawSlug);
      const threadId = (u.searchParams.get("threadId") || "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .slice(0, 80);
      if (!slug || !threadId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug + threadId required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const filePath = join(repoRoot, "projects", slug, ".df", "chat", `${threadId}.snapshot.json`);
      try {
        const text = await readFile(filePath, "utf8");
        const parsed = JSON.parse(text);
        const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages, ts: parsed?.ts ?? null }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: null }));
      }
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Project metadata — per-slug .df/meta.json is the canonical record ─
  // Filesystem carries name/mode/timestamps/ds so a clone of projects/ is a
  // complete backup. DB entry acts as a secondary cache. Scoped to projects/
  // so arbitrary writes can't escape.
  if (req.method === "GET" && req.url.startsWith("/fs/project-meta")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const raw = u.searchParams.get("slug") || "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const metaPath = join(repoRoot, "projects", slug, ".df", "meta.json");
      // Read + parse separately so we never call writeHead BEFORE a possible
      // throw. The original code wrote headers first and then called
      // JSON.parse — when the file was empty/malformed the throw landed in
      // the outer catch which tried writeHead again and crashed the
      // process with ERR_HTTP_HEADERS_SENT. Treat both "file missing" and
      // "file malformed" as "meta absent" — same shape the client already
      // handles (returns null → falls back to DB / synthesizes).
      let fileContent;
      try {
        fileContent = await readFile(metaPath, "utf8");
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ meta: null }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(fileContent);
      } catch (parseErr) {
        console.warn(
          `[daemon] /fs/project-meta: malformed meta.json at ${metaPath} — ${parseErr.message}`,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ meta: null }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ meta: parsed }));
    } catch (e) {
      // Genuine 500 — slug validation, URL parse, etc. Guard against
      // headersSent so any future "write then throw" pattern that lands
      // here doesn't crash the daemon.
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/fs/project-meta")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      if (!body?.meta || typeof body.meta !== "object") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "meta required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const dfDir = join(target, ".df");
      await mkdir(dfDir, { recursive: true });
      await writeFile(join(dfDir, "meta.json"), JSON.stringify(body.meta, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Provider Handoff Layer v1 — generic .df/<file>.json endpoints ──────
  // Two pairs of GET/POST for `provider-sessions.json` + `artifact-state.json`,
  // both scoped to <repoRoot>/projects/<slug>/.df/. Same shape as
  // /fs/project-meta — read returns { <key>: parsedOrNull }, write expects
  // { slug, <key>: object }.
  {
    const dfFiles = [
      { route: "provider-sessions", key: "sessions", file: "provider-sessions.json" },
      { route: "artifact-state", key: "state", file: "artifact-state.json" },
    ];
    for (const { route, key, file } of dfFiles) {
      if (req.method === "GET" && req.url.startsWith(`/fs/${route}`)) {
        try {
          const u = new URL(req.url, "http://localhost");
          const raw = u.searchParams.get("slug") || "";
          const slug = raw
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80);
          if (!slug) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "slug required" }));
            return;
          }
          const repoRoot = getRepoRoot();
          const filePath = join(repoRoot, "projects", slug, ".df", file);
          let fileContent;
          try {
            fileContent = await readFile(filePath, "utf8");
          } catch {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ [key]: null }));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(fileContent);
          } catch (parseErr) {
            console.warn(
              `[daemon] /fs/${route}: malformed ${file} at ${filePath} — ${parseErr.message}`,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ [key]: null }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ [key]: parsed }));
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        }
        return;
      }
      if (req.method === "POST" && req.url.startsWith(`/fs/${route}`)) {
        try {
          const body = await readJson(req);
          const raw = typeof body?.slug === "string" ? body.slug : "";
          const slug = raw
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80);
          if (!slug) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "slug required" }));
            return;
          }
          const payload = body?.[key];
          if (!payload || typeof payload !== "object") {
            res.writeHead(400);
            res.end(JSON.stringify({ error: `${key} required` }));
            return;
          }
          const repoRoot = getRepoRoot();
          const projectsRoot = resolveProjectsRoot(repoRoot);
          let target;
          try {
            target = assertPathInScope(slug, projectsRoot);
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
            return;
          }
          const dfDir = join(target, ".df");
          await mkdir(dfDir, { recursive: true });
          await writeFile(join(dfDir, file), JSON.stringify(payload, null, 2));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          }
        }
        return;
      }
    }
  }

  // ─── Remove an arbitrary file or folder inside projects/ ───────────────
  // Used by the Files-tab gallery to delete individual files/folders.
  // Scoped to <repoRoot>/projects/ via assertPathInScope so the endpoint
  // can't escape the projects root. Accepts absolute or relative paths.
  if (
    req.method === "POST" &&
    req.url.startsWith("/fs/remove") &&
    !req.url.startsWith("/fs/remove-project") &&
    !req.url.startsWith("/fs/remove-ds")
  ) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.path === "string" ? body.path : "";
      if (!raw) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      // Strip a leading projects/ if relative, then validate.
      const rel = raw.startsWith("/") ? raw : raw.replace(/^projects\//, "");
      let target;
      try {
        target = assertPathInScope(rel, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      await rm(target, { recursive: true, force: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ removed: target }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Recursively delete a project folder — used by Remove project ───────
  // Scoped to <repoRoot>/projects/<slug>/ so the endpoint can't wipe
  // arbitrary paths via a crafted request. Returns 400 if the resolved path
  // escapes the projects root.
  if (req.method === "POST" && req.url.startsWith("/fs/remove-project")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      await rm(target, { recursive: true, force: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ removed: target }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Bundle a project folder as a .zip download ──────────────────────────
  // GET /projects/:slug/zip → streams a zip of <repoRoot>/projects/<slug>/.
  // Share menu replaces "HTML standalone" + "Download bundle" with a
  // single "Download .zip" option. User rationale: with the Project Files
  // registry shipping per-project folders (HTML + .df/ metadata + assets),
  // a single-file standalone export no longer represents the project — the
  // zip of the whole folder does.
  //
  // Path safety: assertPathInScope() ensures the resolved target lives under
  // <repoRoot>/projects/, mirroring /fs/remove-project. Hidden files (.df/,
  // chat history, snapshots) are intentionally included so the consumer
  // gets a reusable handoff bundle.
  if (req.method === "GET" && req.url.startsWith("/projects/") && req.url.includes("/zip")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const match = u.pathname.match(/^\/projects\/([^/]+)\/zip$/);
      if (!match) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const rawSlug = decodeURIComponent(match[1]);
      const slug = normalizeProjectSlug(rawSlug);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      if (!existsSync(target)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "project not found" }));
        return;
      }
      // Lazy-load adm-zip — small (~80KB) but no need to pay the cost on
      // daemon boot. addLocalFolder() walks the tree and adds every entry,
      // including dotfiles/dotdirs, with paths relative to the folder.
      let AdmZip;
      try {
        const mod = await import("adm-zip");
        AdmZip = mod.default || mod;
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `adm-zip unavailable: ${String(e)}` }));
        return;
      }
      let buffer;
      try {
        const zip = new AdmZip();
        // Second arg = root path inside the archive; using the slug means
        // unzipping creates a single top-level folder named after the project.
        zip.addLocalFolder(target, slug);
        buffer = zip.toBuffer();
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `zip build failed: ${String(e)}` }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}.zip"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      });
      res.end(buffer);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Filesystem-backed project versions ─
  // Versions (auto checkpoints + named saves) used to live entirely in
  // db.setSetting(`versions:${projectId}`) — IndexedDB on web, sqlite
  // cache on Tauri. Nothing on disk. Two consequences:
  //   1. Versions were invisible from outside the editor (file manager,
  //      git, manual zip extraction, etc.).
  //   2. They were tied to projectId (a UUID) instead of the project
  //      folder — moving / renaming / re-cloning a project orphaned its
  //      version history.
  //
  // New layout (canonical, file-system-first):
  //   <repoRoot>/projects/<slug>/.df/versions/<v-id>.json
  //
  // Each file is a self-contained JSON record:
  //   {
  //     "id": "v-<base36>", // matches filename
  //     "html": "<the snapshot>",
  //     "name": "Pre-redesign", // optional named save
  //     "note": "Before swapping…", // optional 1-line note
  //     "createdAt": 1714234567890,
  //     "auto": true // false for named/manual saves
  //   }
  //
  // Endpoints (all scoped via assertPathInScope):
  //   GET /projects/:slug/versions → { versions: Version[] }
  //                  Sorted oldest→newest by createdAt.
  //   POST /projects/:slug/versions body: Version → { ok: true }
  //                  Creates / overwrites a single version file.
  //   GET /projects/:slug/versions/:vid → { version: Version | null }
  //   DELETE /projects/:slug/versions/:vid → { ok: true }
  //
  // The frontend (EditorScreen.tsx) lazy-migrates legacy DB blobs on
  // first load when the daemon endpoint exists; see persistVersions().

  // GET /projects/:slug/versions — list snapshots
  if (
    req.method === "GET" &&
    /^\/projects\/[^/]+\/versions\/?$/.test(req.url.split("?")[0] || "")
  ) {
    try {
      const u = new URL(req.url, "http://localhost");
      const m = u.pathname.match(/^\/projects\/([^/]+)\/versions\/?$/);
      if (!m) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const rawSlug = decodeURIComponent(m[1]);
      const slug = normalizeProjectSlug(rawSlug);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const versionsDir = join(target, ".df", "versions");
      let entries = [];
      try {
        entries = await readdir(versionsDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      const versions = [];
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(versionsDir, e.name), "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
            versions.push(parsed);
          }
        } catch {
          // Corrupt/partial version file — skip rather than fail the whole list.
        }
      }
      versions.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ versions }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // POST /projects/:slug/versions — create or overwrite one version
  if (
    req.method === "POST" &&
    /^\/projects\/[^/]+\/versions\/?$/.test(req.url.split("?")[0] || "")
  ) {
    try {
      const u = new URL(req.url, "http://localhost");
      const m = u.pathname.match(/^\/projects\/([^/]+)\/versions\/?$/);
      if (!m) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const rawSlug = decodeURIComponent(m[1]);
      const slug = normalizeProjectSlug(rawSlug);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const body = await readJson(req);
      const version = body?.version;
      if (
        !version ||
        typeof version !== "object" ||
        typeof version.id !== "string" ||
        typeof version.html !== "string"
      ) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "version{id,html} required" }));
        return;
      }
      // Sanitize the version id to a safe filename. Version ids are produced
      // by the frontend (crypto.randomUUID()) — accept v-<hex> and uuid-ish
      // shapes. Reject anything with separators or dotfiles.
      const safeVid = sanitizeVersionId(String(version.id));
      if (!safeVid) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid version id" }));
        return;
      }
      // Sanity cap on HTML body so a malformed payload can't fill the disk.
      // 4 MB matches the artifact-writer ceiling and is well above any real
      // single-file design (the largest documents in projects/ are ~250 KB).
      if (version.html.length > 4 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "version html too large (>4MB)" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const versionsDir = join(target, ".df", "versions");
      await mkdir(versionsDir, { recursive: true });
      // Filename includes the createdAt prefix (zero-padded to fixed width)
      // so a `ls` of the directory sorts chronologically. Doesn't replace
      // the JSON's own createdAt — but makes manual triage humane.
      const filePath = join(versionsDir, `${safeVid}.json`);
      const payload = {
        id: safeVid,
        html: version.html,
        ...(version.name ? { name: String(version.name).slice(0, 200) } : {}),
        ...(version.note ? { note: String(version.note).slice(0, 1000) } : {}),
        createdAt: typeof version.createdAt === "number" ? version.createdAt : Date.now(),
        auto: typeof version.auto === "boolean" ? version.auto : false,
      };
      await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: safeVid, path: filePath }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // GET /projects/:slug/versions/:vid — read one version
  if (
    req.method === "GET" &&
    /^\/projects\/[^/]+\/versions\/[^/]+\/?$/.test(req.url.split("?")[0] || "")
  ) {
    try {
      const u = new URL(req.url, "http://localhost");
      const m = u.pathname.match(/^\/projects\/([^/]+)\/versions\/([^/]+)\/?$/);
      if (!m) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const rawSlug = decodeURIComponent(m[1]);
      const slug = normalizeProjectSlug(rawSlug);
      const rawVid = decodeURIComponent(m[2]);
      const safeVid = sanitizeVersionId(rawVid);
      if (!slug || !safeVid) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug+vid required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const filePath = join(target, ".df", "versions", `${safeVid}.json`);
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: parsed }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: null }));
      }
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // DELETE /projects/:slug/versions/:vid — remove one version
  if (
    req.method === "DELETE" &&
    /^\/projects\/[^/]+\/versions\/[^/]+\/?$/.test(req.url.split("?")[0] || "")
  ) {
    try {
      const u = new URL(req.url, "http://localhost");
      const m = u.pathname.match(/^\/projects\/([^/]+)\/versions\/([^/]+)\/?$/);
      if (!m) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const rawSlug = decodeURIComponent(m[1]);
      const slug = normalizeProjectSlug(rawSlug);
      const rawVid = decodeURIComponent(m[2]);
      const safeVid = sanitizeVersionId(rawVid);
      if (!slug || !safeVid) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug+vid required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(slug, projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const filePath = join(target, ".df", "versions", `${safeVid}.json`);
      try {
        await rm(filePath, { force: true });
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Remove a design system folder (rm -rf design-systems/<slug>) ──
  // Mirror of /fs/remove-project but scoped to design-systems/. Same path
  // safety: resolved target must be under design-systems/. Without this,
  // the UI's "remove DS" only updated the in-memory list — reconcile on
  // focus rescanned the disk and brought the folder back. User bug
  // reported 2026-04-28.
  if (req.method === "POST" && req.url.startsWith("/fs/remove-ds")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const dsRoot = join(repoRoot, "design-systems");
      const target = resolve(dsRoot, slug);
      // Path escape check via relative() — works on both POSIX (sep "/")
      // and Windows (sep "\"). The previous literal `dsRoot + "/"` check
      // matched paths on Linux but always failed on Windows (separator
      // mismatch), so the daemon returned 400, the UI did an optimistic
      // remove, and the next reconcile brought the DS back from disk.
      // Observed: deleting a DS appeared to fail — it vanished and
      // then reappeared on the next reconcile.
      const rel = relative(dsRoot, target);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path escapes design-systems root" }));
        return;
      }
      await rm(target, { recursive: true, force: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ removed: target }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Audio transcription — Whisper Large v3 Turbo via Groq (free tier) ─
  // Client POSTs a raw webm/opus blob; we wrap it as multipart and forward
  // to Groq's OpenAI-compatible transcriptions endpoint. The browser never
  // sees the API key; GROQ_API_KEY must be present in the bridge's process
  // environment (set it in your shell before `npm run dev:web`).
  if (req.method === "POST" && req.url.startsWith("/audio/transcribe")) {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "GROQ_API_KEY is not set. Export it in the shell that runs the daemon (e.g. `export GROQ_API_KEY=...` then `npm run dev:web`).",
          }),
        );
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const audio = Buffer.concat(chunks);
      if (audio.length < 512) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "audio too short or empty" }));
        return;
      }
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/webm" }), "recording.webm");
      form.append("model", "whisper-large-v3-turbo");
      // Default language hint follows the app's Portuguese-first copy; Groq
      // auto-detects when absent but pt-BR lifts accuracy on numbers/names.
      form.append("language", "pt");
      const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      const body = await r.text();
      if (!r.ok) {
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `groq ${r.status}: ${body.slice(0, 300)}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body); // groq returns { text: "..." }
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Workspace info — absolute anchors the UI uses to avoid literal ~ ───
  // Frontend was defaulting projectsFolder to the string "~/design-factory/
  // projects". That tilde doesn't get expanded by syscall-based writes (only
  // shells expand ~), so projects landed wherever the Claude CLI happened to
  // resolve ~ — sometimes /root/, sometimes $HOME. Return absolute paths up
  // front so the UI can seed its defaults correctly.
  if (req.method === "GET" && req.url.startsWith("/fs/workspace-info")) {
    const repoRoot = getRepoRoot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        repoRoot,
        home: process.env.HOME || "",
        projectsDir: join(repoRoot, "projects"),
        designSystemsDir: join(repoRoot, "design-systems"),
      }),
    );
    return;
  }

  // ─── Resolve (and create) the persistent dir where a DS's design.md lives ─
  // GitHub-sourced DSes used to write into the ephemeral clone cache under
  // $HOME/.design-factory-cache/git/<slug>-<hash>/; that folder got wiped
  // between runs and the user lost the design.md.
  //
  // Anchor DS outputs at <repoRoot>/design-systems/<slug>/. When the bridge
  // is in a git worktree (dev's .aios/worktrees/*), use the main worktree via
  // --git-common-dir — otherwise design-systems/ ends up inside the worktree
  // and the user doesn't see it at the "design-factory" they checked out.
  // Outside git (standalone install), fall back to process.cwd().
  if (req.method === "POST" && req.url.startsWith("/fs/design-systems-dir")) {
    try {
      const body = await readJson(req);
      const raw = typeof body?.slug === "string" ? body.slug : "";
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!slug) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "slug required" }));
        return;
      }
      const repoRoot = getRepoRoot();
      const root = join(repoRoot, "design-systems");
      await mkdir(root, { recursive: true });
      const dest = join(root, slug);
      await mkdir(dest, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: dest, slug }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ─── Git: snapshot project folder — init repo if needed, commit all, tag ─
  // Lets us promote local-only named version saves into real git history
  // so users can explore / diff checkpoints from the terminal.
  if (req.method === "POST" && req.url.startsWith("/git/snapshot")) {
    try {
      const body = await readJson(req);
      let { cwd, label } = body;
      if (!cwd) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "cwd required" }));
        return;
      }
      const dir = resolveLocalFsPath(cwd, { write: true });
      await mkdir(dir, { recursive: true });
      const run = (args) => execFileP("git", args, { cwd: dir, timeout: 15000 });
      // Ensure repo
      try {
        await run(["rev-parse", "--git-dir"]);
      } catch {
        await run(["init", "-b", "main"]);
        await run(["config", "user.email", "design-factory@hyve.local"]).catch(() => {});
        await run(["config", "user.name", "Design Factory"]).catch(() => {});
      }
      await run(["add", "-A"]).catch(() => {});
      // Commit. Allow-empty so repeated snapshots on a no-op state still tag.
      const msg =
        label && typeof label === "string" && label.trim()
          ? label.trim()
          : `snapshot ${new Date().toISOString()}`;
      try {
        await run(["commit", "-m", msg, "--allow-empty"]);
      } catch {}
      // Tag with slugified label + timestamp for uniqueness
      const slug =
        msg
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 40) || "snapshot";
      const tag = `v-${slug}-${Date.now().toString(36).slice(-5)}`;
      await run(["tag", tag]).catch(() => {});
      const sha = (await run(["rev-parse", "HEAD"]).catch(() => ({ stdout: "" }))).stdout.trim();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cwd: dir, tag, sha, message: msg }));
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof PathScopeError) sendPathScopeError(res, e);
        else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e?.stderr || e) }));
        }
      }
    }
    return;
  }

  // ─── Git: cleanup shallow clone ───────────────────────────────
  if (req.method === "POST" && req.url.startsWith("/git/cleanup")) {
    try {
      const body = await readJson(req);
      const path = body.path;
      if (!path) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "path required" }));
        return;
      }
      const cacheRootPath = join(process.env.HOME || tmpdir(), ".design-factory-cache", "git");
      await mkdir(cacheRootPath, { recursive: true });
      const cacheRoot = realpathSync(cacheRootPath);
      let target;
      try {
        target = assertPathInScope(expandHomePath(path), cacheRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      if (target === cacheRoot) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "refusing to remove cache root" }));
        return;
      }
      await rm(target, { recursive: true, force: true });
      res.writeHead(200);
      res.end(JSON.stringify({ removed: target }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // ─── Skills: install (df-source write) ────────────────────────
  // Writes a SKILL.md into ~/.design-factory/skills/{slug}/SKILL.md.
  // Accepts: { name, trigger?, description?, body, requires?, override? }.
  // Returns the resulting Skill record (same shape as registry items).
  if (req.method === "POST" && req.url === "/skills") {
    try {
      const body = await readJson(req);
      const result = await installDfSkillShared(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    }
    return;
  }

  // ─── Skills: update (df-source only) ──────────────────────────
  // Accepts id path param + body { name?, trigger?, description?, body?, requires?, override? }.
  if (req.method === "PATCH" && req.url.startsWith("/skills/")) {
    try {
      const id = decodeURIComponent(req.url.slice("/skills/".length).split("?")[0]);
      const patch = await readJson(req);
      const result = await updateDfSkill(id, patch);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    }
    return;
  }

  // ─── Skills: delete (df-source only) ──────────────────────────
  if (req.method === "DELETE" && req.url.startsWith("/skills/")) {
    try {
      const id = decodeURIComponent(req.url.slice("/skills/".length).split("?")[0]);
      await deleteDfSkill(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: id }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    }
    return;
  }

  // ─── Skills: list extra files (multifile display) ───────────────
  // Returns file metadata for everything in the skill folder except
  // SKILL.md (already exposed via skill.body). Read-only — UI fetches
  // content lazily via /fs/read on click.
  if (req.method === "GET") {
    const m = req.url.match(/^\/skills\/([^/]+)\/files(?:\?|$)/);
    if (m) {
      try {
        const id = decodeURIComponent(m[1]);
        if (!id.startsWith("df:")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "only df-source skills" }));
          return;
        }
        const skillFile = resolveSkillPath(id.slice(3));
        if (!skillFile) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "skill not found" }));
          return;
        }
        const skillDir = dirname(skillFile);
        // Defense: only walk inside canonical or legacy skills dirs.
        const canonicalDir = getSkillsDir();
        const legacyDir = getLegacySkillsDir();
        if (!isPathInside(canonicalDir, skillDir) && !isPathInside(legacyDir, skillDir)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "refused: skill outside known dirs" }));
          return;
        }
        const out = [];
        const TEXT_EXT_RX =
          /\.(html?|svg|xml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|json|jsonc|md|markdown|mdx|txt|csv|tsv|yaml|yml|toml|ini|conf|sh|bash|zsh|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|sql|graphql|gql)$/i;
        const walk = async (p, depth, relPrefix) => {
          if (depth > 3 || out.length >= 200) return;
          let entries;
          try {
            entries = await readdir(p, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (out.length >= 200) break;
            if (/^\.(git|DS_Store)/.test(e.name)) continue;
            const childPath = join(p, e.name);
            const childRel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
              await walk(childPath, depth + 1, childRel);
              continue;
            }
            if (!e.isFile()) continue;
            let st;
            try {
              st = await stat(childPath);
            } catch {
              continue;
            }
            // Skip the manifest itself — already in skill.body.
            if (childRel === basename(skillFile) && p === skillDir) continue;
            out.push({
              rel: childRel,
              name: e.name,
              path: childPath,
              size: st.size,
              isText: TEXT_EXT_RX.test(e.name),
            });
          }
        };
        await walk(skillDir, 0, "");
        // Sort: text files first (more useful for inspection), then by path.
        out.sort((a, b) => {
          if (a.isText !== b.isText) return a.isText ? -1 : 1;
          return a.rel.localeCompare(b.rel);
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ skillDir, files: out }));
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      }
      return;
    }
  }

  // ─── Skills registry ─────────────────────────────────────────
  // Multi-source classification: df (user-managed) · project (cwd/.claude)
  // · global (~/.claude/skills) · builtin (hardcoded).
  if (req.method === "GET" && req.url.startsWith("/skills/registry")) {
    try {
      const u = new URL(req.url, "http://localhost");
      // User bug 2026-05-21: previous fallback was
      // `process.env.HOME || "/"` — when the frontend sent ?cwd=
      // (empty string) the daemon resolved to HOME (a non-repo
      // directory in dev containers) and the skills walker returned
      // global entries instead
      // of the 9 the user installed into `<repoRoot>/skills/`. The
      // right default is the daemon's own cwd — set by dev-web.mjs
      // to the repo root — which makes `getRepoRoot()` resolve via
      // `<repo>/.git` and the scan land in `<repo>/skills/`.
      let cwd = u.searchParams.get("cwd") || process.cwd();
      if (cwd === "~" || cwd.startsWith("~/")) cwd = (process.env.HOME || "/") + cwd.slice(1);
      const custom = u.searchParams.get("custom");
      const registry = await buildRegistry(resolve(cwd), custom);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(registry));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // /healthz — canonical health endpoint. Returns a rich payload so the
  // frontend banner + doctor scripts + external monitors get enough signal
  // to distinguish "daemon up" from "daemon up but misconfigured".
  if (req.url === "/healthz") {
    let providersRegistered = 0;
    try {
      providersRegistered = listProviders().length;
    } catch {}
    const repoRoot = getRepoRoot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "design-factory-daemon",
        version: "0.1.0",
        port: PORT,
        cwd: repoRoot,
        projectsDir: join(repoRoot, "projects"),
        providers: { registered: providersRegistered },
        claude: CLAUDE_BIN,
      }),
    );
    return;
  }

  // /ping — legacy alias retained for backward compat with frontends and
  // monitoring that haven't migrated to /healthz yet. New callers should
  // use /healthz.
  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: "dev-bridge/1", claude: CLAUDE_BIN }));
    return;
  }

  // Agent registry — detects which CLIs are installed on PATH. Cached for
  // 30s so the picker can poll cheaply. Pass ?force=1 to rescan.
  if (req.method === "GET" && req.url.startsWith("/agents/list")) {
    const force = /[?&]force=1/.test(req.url);
    const agents = await listAgents({ force });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agents }));
    return;
  }

  // ── "Point to my CLI" — per-agent path overrides ────────────
  if (req.method === "GET" && req.url === "/agents/bins") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ overrides: readBinOverrides() }));
    return;
  }
  // Set ({id, path}) or clear (empty path) an override. Validates the file
  // exists, persists it, applies it live (DF_<ID>_BIN) and re-detects.
  if ((req.method === "POST" || req.method === "PUT") && req.url === "/agents/bins") {
    const body = await readJson(req).catch(() => null);
    const id = body && typeof body.id === "string" ? body.id : null;
    const p = body && typeof body.path === "string" ? body.path.trim() : "";
    if (!id || !AGENT_IDS.includes(id)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `id must be one of: ${AGENT_IDS.join(", ")}` }));
      return;
    }
    if (p) {
      let ok = false;
      try {
        ok = (await stat(p)).isFile();
      } catch {}
      if (!ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `not a file: ${p}` }));
        return;
      }
    }
    const overrides = readBinOverrides();
    if (p) overrides[id] = p;
    else delete overrides[id];
    try {
      mkdirSync(dirname(binOverridePath()), { recursive: true });
      writeFileSync(binOverridePath(), JSON.stringify(overrides, null, 2));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `write failed: ${e.message}` }));
      return;
    }
    if (p) process.env[`DF_${id.toUpperCase()}_BIN`] = p;
    else delete process.env[`DF_${id.toUpperCase()}_BIN`];
    agentsCache = null;
    agentsCacheAt = 0; // force re-detect with the new path
    const agents = await listAgents({ force: true });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, overrides, agents }));
    return;
  }
  // Diagnostics — make CLI detection visible (no guessing): the PATH the daemon
  // sees + per-agent resolution + active overrides.
  if (req.method === "GET" && req.url === "/agents/diagnostics") {
    const sep = process.platform === "win32" ? ";" : ":";
    const agents = await listAgents({ force: true });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        platform: process.platform,
        pathDirs: (process.env.PATH || "").split(sep).filter(Boolean),
        overrides: readBinOverrides(),
        agents,
      }),
    );
    return;
  }

  // ── Provider adapter dispatch — ───────────────
  // Routes /<id>/stream and /<id>/once to the matching adapter in
  // providers/. Backward-compat: identical URL shapes to pre-, so
  // the frontend (claude-bridge.ts and friends) needs no changes.
  // Adding a new provider = drop a file in providers/ + register —
  // no edits to this file required.
  {
    const m = req.method === "POST" ? req.url.match(/^\/([a-z][a-z0-9-]*)\/(stream|once)$/) : null;
    if (m) {
      const provider = getProvider(m[1]);
      if (provider) {
        // cwd scope guard — single choke point covering every provider
        // (the 5 CLIs spawn with `body.cwd`). A forged cwd like "/etc" or
        // "/home/user/.ssh" would let a CLI read/write outside the
        // workspace; reject before dispatch. Reads via the cached readJson
        // so the adapter's own readJson(req) still resolves. Parse errors
        // fall through — the adapter surfaces its own 400.
        if (!ALLOW_ARBITRARY_FS) {
          let cwdToCheck = null;
          try {
            const body = await readJson(req);
            if (body && typeof body.cwd === "string" && body.cwd.trim()) {
              cwdToCheck = body.cwd;
            }
          } catch {
            cwdToCheck = null;
          }
          if (cwdToCheck) {
            try {
              resolveLocalFsPath(cwdToCheck, { write: true });
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: `cwd outside Design Factory workspace: ${String(e?.message || e)}`,
                }),
              );
              return;
            }
          }
        }
        // Heartbeat: keep SSE connections alive during provider buffering
        // windows (kimi-cli batches JSONL at turn end — without pings,
        // curl/browser/proxy timeouts kill the stream before events arrive).
        if (m[2] === "stream") armHeartbeat(req, res);
        await provider[m[2]](req, res, PROVIDER_DEPS);
        return;
      }
    }
  }

  // Probe the local Ollama server across host forms (127.0.0.1 → localhost
  // → [::1], or DF_OLLAMA_HOST) and return the first that answers /api/tags.
  // Delegates to the shared resolver in providers/ollama-host.mjs so that
  // DETECTION and the CHAT path always agree on the host. Before they shared
  // one resolver, detection probed all three while chat hard-coded 127.0.0.1
  // — Windows IPv6/IPv4 (and WSL/Docker) splits listed models from one host
  // while generation "fetch failed" on another. Observed: Ollama running
  // on the machine but the app failing to detect it.
  async function probeOllama() {
    return probeOllamaHost();
  }

  // Helper: enrich a provider description with `available` based on
  // either PATH probe (CLIs) or token presence (APIs). Local server
  // providers (ollama) optimistically report true — real probing of
  // the running server happens in the per-provider models endpoint.
  //
  // Mapping owned here (not in adapter modules) to keep adapters free
  // of async detection — listProviders() stays sync.
  //
  // covers all 13 providers.
  async function describeWithAvailability(p) {
    const base = describeProvider(p);
    let available = false;
    try {
      // CLI providers: PATH probe via listAgents() (cached 30s).
      // V1 beta roster: 5 CLIs detected via /agents/list.
      const agentMap = {
        claude: "claude",
        codex: "codex",
        gemini: "gemini",
        opencode: "opencode",
        kimi: "kimi",
      };
      if (agentMap[p.id]) {
        const agents = await listAgents().catch(() => []);
        const def = agents.find((a) => a.id === agentMap[p.id]);
        available = !!(def && def.available);
        return { ...base, available, version: def?.version ?? null };
      }
      // API providers: token presence.
      if (p.id === "anthropic") {
        available = !!(await getAnthropicToken().catch(() => null));
      } else if (p.id === "openrouter") {
        available = !!(await getOpenrouterToken().catch(() => null));
      } else if (p.id === "openai") {
        available = !!process.env.OPENAI_API_KEY;
      } else if (p.id === "gemini-api") {
        available = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      } else if (p.id === "ollama") {
        // Reachability probe — ollama is a local server on :11434, so a
        // green dot must mean the server actually answers. probeOllama()
        // tries 127.0.0.1, localhost, and [::1] in order so a Windows
        // install where `localhost` resolves to IPv6 but Ollama listens
        // on IPv4 still shows green. 1500ms timeout total — cold-start
        // forgiving without blocking the /providers payload too long.
        available = (await probeOllama()).ok;
      }
    } catch {
      available = false;
    }
    return { ...base, available };
  }

  // GET /providers — enumerate all registered providers + their
  // capabilities + availability. Used by the picker UI to know
  // what to render. added the `available` field so the UI can
  // grey-out un-installed CLIs / un-tokened APIs without a separate
  // probe round-trip per provider.
  if (req.method === "GET" && req.url === "/providers") {
    const enriched = await Promise.all(listProviders().map(describeWithAvailability));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ providers: enriched }));
    return;
  }

  // GET /providers/:id — single provider info. 404 on unknown id so
  // the UI can render an empty state instead of guessing.
  if (req.method === "GET" && req.url.startsWith("/providers/")) {
    const id = decodeURIComponent(req.url.slice("/providers/".length).split("?")[0]);
    const p = getProvider(id);
    if (!p) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `unknown provider: ${id}` }));
      return;
    }
    const enriched = await describeWithAvailability(p);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(enriched));
    return;
  }

  // ── Codex / Gemini CLI streaming + once ──────────────────────
  // Extracted to providers/codex.mjs and providers/gemini.mjs.
  // Routed by the dispatch loop above. Comments preserved at adapter
  // call sites.

  // ── Ollama (local weights) ───────────────────────────────────
  // No CLI spawn — Ollama runs as a server on :11434. We proxy
  // /api/chat (stream + non-stream) and /api/tags (model list)
  // and translate NDJSON line-by-line into the same SSE shape
  // the other adapters emit.
  if (req.method === "GET" && req.url === "/ollama/models") {
    const probe = await probeOllama();
    if (!probe.ok) {
      // Surface BOTH the empty list (so the UI's existing "0 models"
      // branch still fires) AND the resolved diagnostic so the user
      // can tell whether Ollama is offline (ECONNREFUSED), unreachable
      // due to a host override (DF_OLLAMA_HOST set wrong), or just
      // slow (Aborted/timeout).
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: probe.error, triedHosts: probe.tried }));
      return;
    }
    try {
      const data = probe.data;
      const raw = Array.isArray(data?.models) ? data.models : [];
      // Enrich each model with a `chat` flag so the picker can flag/disable
      // completion-only + embedding models (which bounce /api/chat as
      // "does not support chat") BEFORE the user tries to generate with one.
      // getModelCapabilities is cached + probes via /api/show; the model list
      // is small so a Promise.all is fine.
      const models = await Promise.all(
        raw.map(async (m) => {
          let chat = true;
          try {
            const caps = await getModelCapabilities(probe.host, m.name);
            chat = caps.chat;
          } catch {
            /* keep permissive default */
          }
          return { id: m.name, sub: m.details?.parameter_size || "", chat };
        }),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models, host: probe.host }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // /ollama/stream + /ollama/once → providers/ollama.mjs.

  // ── Theme overrides (Settings → Appearance) ──────────────────
  if (req.method === "GET" && req.url === "/config/theme") {
    const cfg = await readThemeConfig().catch(() => emptyThemeConfig());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cfg));
    return;
  }
  if (req.method === "PUT" && req.url === "/config/theme") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    // Schema v2 ({active, presets}) — pass body straight to writer.
    // Backward-compat: legacy v1 ({dark, light}) wrapped into a "default" preset.
    let payload;
    if (body && typeof body === "object" && body.presets && typeof body.presets === "object") {
      payload = { active: body.active, presets: body.presets };
    } else if (body && typeof body === "object" && (body.dark || body.light)) {
      payload = {
        active: DEFAULT_PRESET_NAME,
        presets: {
          [DEFAULT_PRESET_NAME]: {
            dark: typeof body.dark === "object" ? body.dark : {},
            light: typeof body.light === "object" ? body.light : {},
          },
        },
      };
    } else {
      payload = emptyThemeConfig();
    }
    try {
      await writeThemeConfig(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // /opencode/stream + /opencode/once → providers/opencode.mjs.

  // ── Anthropic BYOK config endpoints ──────────────────────────
  // GET reports tokenSet without revealing the value. PUT writes the
  // token to disk chmod 600. The daemon never echoes the token back.
  if (req.method === "GET" && req.url === "/config/anthropic") {
    const cfg = await readAnthropicConfig().catch(() => ({ token: "" }));
    const envSet = !!process.env.ANTHROPIC_API_KEY;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!(cfg.token || envSet),
        source: envSet ? "env" : cfg.token ? "disk" : null,
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/anthropic") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (token && !/^sk-ant-/.test(token)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token doesn't look like an Anthropic key (sk-ant-…)" }));
      return;
    }
    try {
      await writeAnthropicConfig({ token });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tokenSet: !!token }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // ── OpenAI BYOK config endpoints ─────────────────────────────
  if (req.method === "GET" && req.url === "/config/openai") {
    const cfg = await readSimpleTokenConfig(OPENAI_CONFIG_PATH).catch(() => ({ token: "" }));
    const envSet = !!process.env.OPENAI_API_KEY;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!(cfg.token || envSet),
        source: envSet ? "env" : cfg.token ? "disk" : null,
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/openai") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (token && !/^sk-/.test(token)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token doesn't look like an OpenAI key (sk-…)" }));
      return;
    }
    try {
      await writeSimpleTokenConfig(OPENAI_CONFIG_PATH, { token });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tokenSet: !!token }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // ── Gemini BYOK config endpoints ─────────────────────────────
  if (req.method === "GET" && req.url === "/config/gemini") {
    const cfg = await readSimpleTokenConfig(GEMINI_CONFIG_PATH).catch(() => ({ token: "" }));
    const envSet = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!(cfg.token || envSet),
        source: envSet ? "env" : cfg.token ? "disk" : null,
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/gemini") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    // Google AI Studio keys typically start with "AIza"; allow flex.
    if (token && token.length < 20) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token looks too short for a Gemini key" }));
      return;
    }
    try {
      await writeSimpleTokenConfig(GEMINI_CONFIG_PATH, { token });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tokenSet: !!token }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // ── Kimi / Moonshot BYOK config endpoints ───────────────────
  // Mirrors the OpenAI/Gemini token storage so the picker can live-fetch
  // the Moonshot catalog (GET /kimi/models). Env KIMI_API_KEY /
  // MOONSHOT_API_KEY take precedence. Daemon never echoes the token.
  if (req.method === "GET" && req.url === "/config/kimi") {
    const cfg = await readSimpleTokenConfig(KIMI_CONFIG_PATH).catch(() => ({ token: "" }));
    const envSet = !!(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!(cfg.token || envSet),
        source: envSet ? "env" : cfg.token ? "disk" : null,
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/kimi") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    // Moonshot keys start with "sk-"; allow flex but reject obvious junk.
    if (token && !/^sk-/.test(token)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token doesn't look like a Moonshot/Kimi key (sk-…)" }));
      return;
    }
    try {
      await writeSimpleTokenConfig(KIMI_CONFIG_PATH, { token });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tokenSet: !!token }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // /anthropic/stream + /anthropic/once → providers/anthropic.mjs.

  // ── OpenRouter (200+ open + paid models, OpenAI-compatible) ──
  // BYOK token storage + chat completions proxy. Ships with Llama 3.3 70B
  // (free) as the default. Token via PUT /config/openrouter or env
  // OPENROUTER_API_KEY. Streaming uses OpenAI SSE format.
  if (req.method === "GET" && req.url === "/config/openrouter") {
    const cfg = await readSimpleTokenConfig(OPENROUTER_CONFIG_PATH).catch(() => ({ token: "" }));
    const envSet = !!process.env.OPENROUTER_API_KEY;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!(cfg.token || envSet),
        source: envSet ? "env" : cfg.token ? "disk" : null,
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/openrouter") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (token && !/^sk-or-/.test(token)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token doesn't look like an OpenRouter key (sk-or-…)" }));
      return;
    }
    try {
      await writeSimpleTokenConfig(OPENROUTER_CONFIG_PATH, { token });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tokenSet: !!token }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  if (req.method === "GET" && req.url === "/openrouter/models") {
    // Returns the public models list (no auth required for /api/v1/models).
    try {
      const r = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const models = Array.isArray(data.data)
        ? data.data.slice(0, 200).map((m) => ({
            id: m.id,
            sub:
              m.pricing?.prompt === "0"
                ? "free"
                : m.context_length
                  ? `${Math.round(m.context_length / 1000)}k ctx`
                  : "",
          }))
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // ── Live model catalogs (BYOK + CLI) ────────────────────────
  // Same contract as /ollama/models + /openrouter/models:
  //   { models: [{ id, sub }], error? }
  // The picker (useLiveModelOptions) fetches these and falls back to a
  // minimal static list only when the call returns empty / errors (no
  // key, offline). Source of truth = the provider, never a hardcoded
  // catalog. Each returns {error:"no-key"} when no token is configured
  // so the UI can render the fallback + a "configure key" hint.

  // Anthropic — GET /v1/models. id IS the version (claude-opus-4-8);
  // display_name carries the human label ("Claude Opus 4.8").
  if (req.method === "GET" && req.url === "/anthropic/models") {
    try {
      const token = await getAnthropicToken();
      if (!token) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [], error: "no-key" }));
        return;
      }
      const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": token, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const models = Array.isArray(data?.data)
        ? data.data.map((m) => ({ id: m.id, sub: m.display_name || "" }))
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // OpenAI — GET /v1/models. Catalog includes embeddings/tts/image/etc;
  // filter to chat/reasoning by capability heuristic (no hardcoded list).
  if (req.method === "GET" && req.url === "/openai/models") {
    try {
      const token = await getOpenaiToken();
      if (!token) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [], error: "no-key" }));
        return;
      }
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const EXCLUDE =
        /embedding|tts|whisper|audio|image|realtime|moderation|dall-e|transcribe|search|computer-use/i;
      const KEEP = /^(gpt-|o\d|chatgpt-)/i;
      const models = Array.isArray(data?.data)
        ? data.data
            .map((m) => m.id)
            .filter((id) => typeof id === "string" && KEEP.test(id) && !EXCLUDE.test(id))
            .sort()
            .map((id) => ({ id, sub: "" }))
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // Gemini — GET /v1beta/models. Keep only models that support
  // generateContent (capability-based filter); displayName/version → sub.
  if (req.method === "GET" && req.url === "/gemini-api/models") {
    try {
      const token = await getGeminiApiToken();
      if (!token) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [], error: "no-key" }));
        return;
      }
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}&pageSize=200`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const models = Array.isArray(data?.models)
        ? data.models
            .filter(
              (m) =>
                Array.isArray(m.supportedGenerationMethods) &&
                m.supportedGenerationMethods.includes("generateContent"),
            )
            .filter((m) => !/embedding|aqa/i.test(m.name || ""))
            .map((m) => ({
              id: (m.name || "").replace(/^models\//, ""),
              sub: m.displayName || m.version || "",
            }))
            .filter((m) => m.id)
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // Kimi/Moonshot — GET /v1/models (OpenAI-compatible). BYOK via /config/kimi.
  if (req.method === "GET" && req.url === "/kimi/models") {
    try {
      const token = await getKimiToken();
      if (!token) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [], error: "no-key" }));
        return;
      }
      const r = await fetch("https://api.moonshot.ai/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const models = Array.isArray(data?.data) ? data.data.map((m) => ({ id: m.id, sub: "" })) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // opencode — shell-out `opencode models`. Emits `provider/model` per
  // line. No key needed (opencode uses its own configured providers /
  // Models.dev registry). shell:true on win32 (npm/.cmd EINVAL guard).
  if (req.method === "GET" && req.url === "/opencode/models") {
    try {
      const out = await new Promise((resolve, reject) => {
        const child = spawn("opencode", ["models"], { shell: process.platform === "win32" });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {}
          reject(new Error("opencode models timed out"));
        }, 15000);
        child.stdout.on("data", (d) => {
          stdout += d;
        });
        child.stderr.on("data", (d) => {
          stderr += d;
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `exit ${code}`));
        });
      });
      const models = String(out)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l.includes("/"))
        .map((id) => ({ id, sub: id.split("/")[0] }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [], error: String(e?.message || e) }));
    }
    return;
  }

  // /openrouter/stream + /openrouter/once → providers/openrouter.mjs.

  // ═══════════════════════════════════════════════════════════════════════════
  // [DEPRECATED] Vercel endpoints — the in-app publish UI is not part
  // of the current public surface. Endpoints preserved (no behavior
  // change) for a future polished surface. Users now run
  // `vercel deploy` in the terminal directly.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Vercel BYOK config endpoints ─────────────────────────────
  // GET surfaces a `source` field so the UI can render
  // 3 distinct states (BYOK / CLI / disconnected). When BYOK is empty
  // we fall back to ~/.local/share/com.vercel.cli/auth.json — same UX
  // the user gets from `gh` CLI today.
  if (req.method === "GET" && req.url === "/config/vercel") {
    const cfg = await readVercelConfig().catch(() => ({ token: "", teamId: "", teamSlug: "" }));
    let source = null;
    let cliAvailable = false;
    if (cfg.token) {
      source = "byok";
    } else {
      const cli = await readVercelCliAuth();
      if (cli.token) {
        source = "vercel-cli";
        cliAvailable = true;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tokenSet: !!cfg.token || cliAvailable,
        source,
        teamId: cfg.teamId || "",
        teamSlug: cfg.teamSlug || "",
      }),
    );
    return;
  }
  if (req.method === "PUT" && req.url === "/config/vercel") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    try {
      const next = await writeVercelConfig({
        token: typeof body?.token === "string" ? body.token : undefined,
        teamId: typeof body?.teamId === "string" ? body.teamId : undefined,
        teamSlug: typeof body?.teamSlug === "string" ? body.teamSlug : undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          tokenSet: !!next.token,
          teamId: next.teamId,
          teamSlug: next.teamSlug,
        }),
      );
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // ── Vercel deploy ────────────────────────────────────────────
  // Body: { slug, html, target?, projectName?, projectId?, teamId? }.
  //   · target: "preview" (default) | "production". — user spec
  //     "ta funcional? como podemos testar?". Older callers omit `target`
  //     and get preview, which is the safe default for iterative drafts.
  //   · projectName: optional override for the Vercel project name. When
  //     omitted, the slug is used (existing behavior).
  //   · projectId: — when present, deploys to an existing Vercel
  //     project regardless of name. Resolves the canonical project name
  //     server-side (so callers don't have to guess slug ↔ display name).
  //   · teamId: — explicit team scope. When present, the project is
  //     created/looked-up inside the team. Falls back to the saved
  //     teamId when omitted (legacy behavior).
  // Posts to api.vercel.com/v13/deployments with the HTML inline.
  // Returns the user-facing URL + deploymentId on success. Single-file
  // deploys only — multi-asset bundles are a future wave.
  if (req.method === "POST" && req.url === "/deploy/vercel") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    // BYOK first, then Vercel CLI auth.json
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "no Vercel token configured. Run `vercel login` in your terminal, or PUT /config/vercel { token, teamId? }.",
        }),
      );
      return;
    }
    const html = typeof body?.html === "string" ? body.html : "";
    if (!html.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "html required" }));
      return;
    }
    const slug = slugifyVercel(body?.slug || "design-factory-export");
    // resolve projectName from explicit projectId when caller picked
    // an existing project (UI passes id + name; we trust id and confirm
    // with a quick GET to avoid name-drift).
    const explicitProjectId =
      typeof body?.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
    let projectName =
      typeof body?.projectName === "string" && body.projectName.trim()
        ? slugifyVercel(body.projectName)
        : slug;
    // Explicit teamId in the payload wins over the saved one. Empty string
    // forces personal scope.
    const teamIdProvided = typeof body?.teamId === "string";
    const effectiveTeamId = teamIdProvided ? body.teamId.trim() : cfg.teamId || "";
    // Default to preview — production must be opt-in (user safer flow).
    const target = body?.target === "production" ? "production" : "preview";
    const teamQs = effectiveTeamId ? `?teamId=${encodeURIComponent(effectiveTeamId)}` : "";

    // Resolve projectName from projectId (best-effort) so the deployment
    // routes to the right project. If the lookup fails we still try with
    // the caller-supplied name — Vercel will create or attach as needed.
    if (explicitProjectId) {
      try {
        const r = await fetch(
          `https://api.vercel.com/v9/projects/${encodeURIComponent(explicitProjectId)}${teamQs}`,
          { headers: { Authorization: `Bearer ${cfg.token}` } },
        );
        if (r.ok) {
          const parsed = await r.json();
          if (parsed?.name) projectName = parsed.name;
        }
      } catch {
        /* fall through with caller-supplied name */
      }
    }
    try {
      const upstream = await fetch(`https://api.vercel.com/v13/deployments${teamQs}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName,
          files: [{ file: "index.html", data: html }],
          target,
          projectSettings: { framework: null },
        }),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: text.slice(0, 1000) }));
        return;
      }
      const parsed = JSON.parse(text);
      const url = parsed.url
        ? `https://${parsed.url}`
        : parsed.alias?.[0]
          ? `https://${parsed.alias[0]}`
          : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          deploymentId: parsed.id,
          url,
          inspectUrl: parsed.inspectorUrl ?? null,
          target,
          projectId: parsed.projectId || explicitProjectId || null,
          projectName,
          teamId: effectiveTeamId || null,
        }),
      );
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
    return;
  }

  // ── Vercel: deployment status ──────────────────────────
  // GET /deploy/vercel/status?id={deploymentId}&teamId={teamId}
  // Polls a single Vercel deployment to expose its readyState. Used by
  // the publish overlay to drive the progress UI. Cheap, returns ~80B,
  // suitable for 1.5s polling.
  // Vercel readyState values: QUEUED, INITIALIZING, BUILDING, READY,
  // ERROR, CANCELED. We pass them through verbatim so the UI can map.
  if (req.method === "GET" && req.url.startsWith("/deploy/vercel/status")) {
    const u = new URL(req.url, "http://localhost");
    const deploymentId = (u.searchParams.get("id") || "").trim();
    if (!deploymentId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "id required" }));
      return;
    }
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no Vercel token configured" }));
      return;
    }
    // teamId in payload wins over saved cfg. Empty string forces personal.
    const teamIdProvided = u.searchParams.has("teamId");
    const effectiveTeamId = teamIdProvided
      ? (u.searchParams.get("teamId") || "").trim()
      : cfg.teamId || "";
    const teamQs = effectiveTeamId ? `?teamId=${encodeURIComponent(effectiveTeamId)}` : "";
    try {
      const upstream = await fetch(
        `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}${teamQs}`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
      );
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: `HTTP ${upstream.status}: ${text.slice(0, 200)}` }),
        );
        return;
      }
      const parsed = JSON.parse(text);
      const state = parsed.readyState || parsed.status || "UNKNOWN";
      // Vercel returns `url` w/o protocol, and `alias[]` once promoted.
      const baseUrl = parsed.url ? `https://${parsed.url}` : null;
      const aliasUrl =
        Array.isArray(parsed.alias) && parsed.alias[0] ? `https://${parsed.alias[0]}` : null;
      // Surface alias when ready (production gets a custom domain), else
      // baseUrl (preview's `*-{hash}.vercel.app`).
      const url = state === "READY" && aliasUrl ? aliasUrl : baseUrl;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          state,
          url,
          inspectUrl: parsed.inspectorUrl ?? null,
          errorMessage: parsed.errorMessage ?? null,
        }),
      );
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // ── Vercel: list recent deployments ──────────────────────────
  // GET /deploy/vercel/list?limit=5 — returns the user's last N
  // deployments (id, url, target, state, createdAt). Defaults to 5.
  // User spec : "Sem listing de deploys anteriores — usuário não
  // vê histórico do que publicou".
  if (req.method === "GET" && req.url.startsWith("/deploy/vercel/list")) {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token", deployments: [] }));
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(20, Number(u.searchParams.get("limit") || 5)));
    const teamQs = cfg.teamId ? `&teamId=${encodeURIComponent(cfg.teamId)}` : "";
    try {
      const upstream = await fetch(
        `https://api.vercel.com/v6/deployments?limit=${limit}${teamQs}`,
        {
          headers: { Authorization: `Bearer ${cfg.token}` },
        },
      );
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: text.slice(0, 400), deployments: [] }));
        return;
      }
      const parsed = JSON.parse(text);
      // Vercel v6 returns { deployments: [{ uid, url, name, target, state, created, ... }] }
      const deployments = Array.isArray(parsed.deployments)
        ? parsed.deployments.map((d) => ({
            id: d.uid || d.id,
            url: d.url ? `https://${d.url}` : null,
            name: d.name || "",
            target: d.target || (d.targets && d.targets.production ? "production" : "preview"),
            state: d.state || d.readyState || "UNKNOWN",
            createdAt: typeof d.created === "number" ? d.created : d.createdAt || null,
          }))
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deployments }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), deployments: [] }));
    }
    return;
  }

  // ── Vercel: token connection test ────────────────────────────
  // GET /deploy/vercel/test — calls api.vercel.com/v2/user with the
  // saved token. Returns { ok, username, teamLabel, error }. User
  // spec : "Adicionar botão 'Test connection' no Settings".
  if (req.method === "GET" && req.url === "/deploy/vercel/test") {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token configured" }));
      return;
    }
    try {
      const upstream = await fetch("https://api.vercel.com/v2/user", {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: `HTTP ${upstream.status}: ${text.slice(0, 200)}` }),
        );
        return;
      }
      const parsed = JSON.parse(text);
      const username = parsed?.user?.username || parsed?.username || "(unknown)";
      // teamId test (best-effort): only gate the token. If user provided
      // a teamId we just confirm we can access /v2/teams/{id} with it.
      let teamLabel = "";
      if (cfg.teamId) {
        try {
          const teamRes = await fetch(
            `https://api.vercel.com/v2/teams/${encodeURIComponent(cfg.teamId)}`,
            {
              headers: { Authorization: `Bearer ${cfg.token}` },
            },
          );
          if (teamRes.ok) {
            const t = await teamRes.json();
            teamLabel = t?.name || t?.slug || cfg.teamId;
          } else {
            teamLabel = `team-id ${cfg.teamId} (unreachable)`;
          }
        } catch {
          teamLabel = `team-id ${cfg.teamId} (network)`;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, username, teamLabel }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // ── Vercel: list user's teams ────────────────────────────────
  // GET /vercel/teams — returns the user's Vercel teams.
  // The /vercel/projects endpoint by itself only lists personal-account
  // projects (teamId omitted), so users with team-scoped projects see
  // an empty list at publish time. Two fixes work together: (1) expose
  // teams so the UI can pick scope, and (2) add /vercel/projects/all
  // which fans out across personal + every team in parallel.
  if (req.method === "GET" && req.url === "/vercel/teams") {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token", teams: [] }));
      return;
    }
    try {
      const upstream = await fetch(`https://api.vercel.com/v2/teams?limit=100`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: text.slice(0, 400), teams: [] }));
        return;
      }
      const parsed = JSON.parse(text);
      const teams = Array.isArray(parsed.teams)
        ? parsed.teams.map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name || t.slug,
            avatar: t.avatar ? `https://vercel.com/api/www/avatar/${t.avatar}?s=64` : null,
            membership: t.membership ? { role: t.membership.role || "" } : undefined,
          }))
        : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, teams }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), teams: [] }));
    }
    return;
  }

  // ── Vercel: aggregated projects across personal + every team ──
  // GET /vercel/projects/all — fans out: /v9/projects (personal) plus
  // /v9/projects?teamId=X for each team in /v2/teams. Returns a flat
  // list with `teamId`/`teamSlug`/`teamName` fields plus the team
  // catalogue itself. — user fix: previously only personal
  // projects came back, hiding projects that live under a team.
  if (req.method === "GET" && req.url.startsWith("/vercel/projects/all")) {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token", projects: [], teams: [] }));
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(200, Number(u.searchParams.get("limit") || 100)));
    const search = (u.searchParams.get("search") || "").toLowerCase();
    const headers = { Authorization: `Bearer ${cfg.token}` };
    const mapProject = (p, scope) => ({
      id: p.id,
      name: p.name,
      framework: p.framework || null,
      createdAt: typeof p.createdAt === "number" ? p.createdAt : null,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : null,
      latestDeployment: p.latestDeployments?.[0]?.url
        ? `https://${p.latestDeployments[0].url}`
        : null,
      teamId: scope.teamId || null,
      teamSlug: scope.teamSlug || null,
      teamName: scope.teamName || null,
    });
    const fetchScope = async (scope) => {
      const teamQs = scope.teamId ? `&teamId=${encodeURIComponent(scope.teamId)}` : "";
      try {
        const r = await fetch(`https://api.vercel.com/v9/projects?limit=${limit}${teamQs}`, {
          headers,
        });
        if (!r.ok) return [];
        const parsed = await r.json();
        return Array.isArray(parsed.projects)
          ? parsed.projects.map((p) => mapProject(p, scope))
          : [];
      } catch {
        return [];
      }
    };
    try {
      // 1. Fetch teams catalogue.
      let teams = [];
      try {
        const r = await fetch(`https://api.vercel.com/v2/teams?limit=100`, { headers });
        if (r.ok) {
          const parsed = await r.json();
          teams = Array.isArray(parsed.teams)
            ? parsed.teams.map((t) => ({
                id: t.id,
                slug: t.slug,
                name: t.name || t.slug,
                avatar: t.avatar ? `https://vercel.com/api/www/avatar/${t.avatar}?s=64` : null,
              }))
            : [];
        }
      } catch {
        /* teams optional */
      }

      // 2. Fan out: personal scope + each team in parallel.
      const scopes = [
        { teamId: null, teamSlug: null, teamName: null },
        ...teams.map((t) => ({ teamId: t.id, teamSlug: t.slug, teamName: t.name })),
      ];
      const results = await Promise.all(scopes.map(fetchScope));
      let projects = results.flat();

      // 3. De-duplicate by id (some setups report the same project under
      //    multiple scopes when membership overlaps).
      const seen = new Set();
      projects = projects.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      if (search) {
        projects = projects.filter((p) => p.name.toLowerCase().includes(search));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projects, teams }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), projects: [], teams: [] }));
    }
    return;
  }

  // ── Vercel: validate that a project name is available ─────────
  // GET /vercel/projects/check?name=foo&teamId=X — returns
  // { ok, available: bool }. Used by the publish dialog when the
  // user is creating a new project to give inline feedback as they
  // type. We use HEAD on /v9/projects/{name} which Vercel returns 200
  // when the project exists, 404 when not. teamId is optional.
  if (req.method === "GET" && req.url.startsWith("/vercel/projects/check")) {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token" }));
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const rawName = (u.searchParams.get("name") || "").trim();
    const teamId = (u.searchParams.get("teamId") || cfg.teamId || "").trim();
    const slug = slugifyVercel(rawName);
    if (!slug || slug === "design") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, available: false, reason: "invalid", name: slug }));
      return;
    }
    const teamQs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    try {
      const r = await fetch(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(slug)}${teamQs}`,
        {
          headers: { Authorization: `Bearer ${cfg.token}` },
        },
      );
      if (r.status === 404) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, available: true, name: slug }));
        return;
      }
      if (r.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, available: false, reason: "exists", name: slug }));
        return;
      }
      const text = await r.text();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: text.slice(0, 300), name: slug }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), name: slug }));
    }
    return;
  }

  // ── Vercel: list user's projects (BYOK-aware) ────────────────
  // GET /vercel/projects?limit=100&search=foo&teamId=X — returns the
  // user's Vercel projects. Used by the publish dialog.
  // now accepts `teamId` query param (defaults to the
  // saved teamId in vercel.json). Pass `teamId=` (empty) to force
  // personal scope. Prefer /vercel/projects/all in the UI; this
  // endpoint stays for back-compat.
  if (req.method === "GET" && req.url.startsWith("/vercel/projects")) {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token", projects: [] }));
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit") || 50)));
    const search = (u.searchParams.get("search") || "").toLowerCase();
    // explicit teamId query param overrides the saved one. An empty
    // string forces personal scope so callers can dis-ambiguate.
    const teamIdParam = u.searchParams.get("teamId");
    const effectiveTeamId = teamIdParam !== null ? teamIdParam : cfg.teamId || "";
    const teamQs = effectiveTeamId ? `&teamId=${encodeURIComponent(effectiveTeamId)}` : "";
    try {
      const upstream = await fetch(`https://api.vercel.com/v9/projects?limit=${limit}${teamQs}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: text.slice(0, 400), projects: [] }));
        return;
      }
      const parsed = JSON.parse(text);
      let projects = Array.isArray(parsed.projects)
        ? parsed.projects.map((p) => ({
            id: p.id,
            name: p.name,
            framework: p.framework || null,
            createdAt: typeof p.createdAt === "number" ? p.createdAt : null,
            updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : null,
            latestDeployment: p.latestDeployments?.[0]?.url
              ? `https://${p.latestDeployments[0].url}`
              : null,
            teamId: effectiveTeamId || null,
          }))
        : [];
      if (search) {
        projects = projects.filter((p) => p.name.toLowerCase().includes(search));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projects }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err), projects: [] }));
    }
    return;
  }

  // ── Vercel: connected user profile ───────────────────────────
  // GET /vercel/user — returns { ok, username, email, name, avatar,
  // teamLabel } when a token is set. UI uses this to show "Conectado
  // como @username" + avatar in the Settings card and Publish dialog.
  if (req.method === "GET" && req.url === "/vercel/user") {
    const cfg = await resolveVercelAuth();
    if (!cfg.token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token", source: null }));
      return;
    }
    try {
      const upstream = await fetch("https://api.vercel.com/v2/user", {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: `HTTP ${upstream.status}: ${text.slice(0, 200)}` }),
        );
        return;
      }
      const parsed = JSON.parse(text);
      const user = parsed?.user ?? parsed ?? {};
      let teamLabel = "";
      if (cfg.teamId) {
        try {
          const teamRes = await fetch(
            `https://api.vercel.com/v2/teams/${encodeURIComponent(cfg.teamId)}`,
            {
              headers: { Authorization: `Bearer ${cfg.token}` },
            },
          );
          if (teamRes.ok) {
            const tData = await teamRes.json();
            teamLabel = tData?.name || tData?.slug || cfg.teamId;
          }
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          username: user.username || user.name || "(unknown)",
          name: user.name || null,
          email: user.email || null,
          avatar: user.avatar ? `https://vercel.com/api/www/avatar/${user.avatar}?s=64` : null,
          teamLabel: teamLabel || null,
          source: cfg.source, // "byok" | "vercel-cli"
        }),
      );
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // ── Vercel device flow: start (opt-in via DF_VERCEL_CLIENT_ID) ─
  // RFC 8628 device-authorization grant. Mirrors the GitHub device
  // flow above but only lights up when the env var is set. Without a
  // registered Vercel Integration we return 503 with a clear error so
  // the UI can fall back to BYOK paste.
  if (req.method === "POST" && req.url === "/vercel/device/start") {
    if (!VERCEL_CLIENT_ID) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Vercel OAuth not configured",
          hint: "Set DF_VERCEL_CLIENT_ID to enable device flow. Until then use BYOK token paste.",
          fallback: "byok",
        }),
      );
      return;
    }
    try {
      const r = await fetch(VERCEL_DEVICE_AUTH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: VERCEL_CLIENT_ID,
          scope: "openid profile email",
        }).toString(),
      });
      const data = await r.json();
      if (!r.ok || !data?.device_code) {
        res.writeHead(r.status || 500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: data?.error_description || data?.error || "device code request failed",
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          deviceCode: data.device_code,
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          verificationUriComplete: data.verification_uri_complete,
          interval: data.interval ?? 5,
          expiresIn: data.expires_in ?? 900,
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
    return;
  }

  // ── Vercel device flow: poll ─────────────────────────────────
  // Identical contract to /gh/device/poll. On `ok` we persist the
  // access token through writeVercelConfig so existing /deploy/*
  // routes Just Work without changes.
  if (req.method === "POST" && req.url === "/vercel/device/poll") {
    if (!VERCEL_CLIENT_ID) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: "Vercel OAuth not configured" }));
      return;
    }
    try {
      const body = await readJson(req);
      const { deviceCode } = body;
      if (!deviceCode) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "deviceCode required" }));
        return;
      }
      const r = await fetch(VERCEL_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: VERCEL_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
      const data = await r.json();
      if (data.access_token) {
        try {
          await writeVercelConfig({ token: data.access_token });
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tokenType: data.token_type, scope: data.scope }));
        return;
      }
      if (data.error === "authorization_pending") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "pending" }));
        return;
      }
      if (data.error === "slow_down") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "slow_down" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "error",
          error: data.error_description || data.error || "unknown",
        }),
      );
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: String(e) }));
      }
    }
    return;
  }

  // ── GitHub: connected user profile ───────────────────────────
  // GET /gh/user — returns { ok, login, name, email, avatar } from
  // api.github.com/user using the stored token (gh CLI / device flow
  // / explicit env). Used by Settings → Providers → GitHub card to
  // show who's connected.
  if (req.method === "GET" && req.url === "/gh/user") {
    let token = null;
    try {
      const { stdout } = await execFileP("gh", ["auth", "token"], { timeout: 3000 });
      token = stdout.trim();
    } catch {}
    if (!token) {
      try {
        token = (await readFile(DF_TOKEN_PATH, "utf8")).trim();
      } catch {}
    }
    if (!token) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no token" }));
      return;
    }
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "design-factory/1.0",
        },
      });
      if (!r.ok) {
        const text = await r.text();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` }));
        return;
      }
      const u = await r.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          login: u.login,
          name: u.name || null,
          email: u.email || null,
          avatar: u.avatar_url || null,
          publicRepos: u.public_repos ?? 0,
        }),
      );
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // /claude/once → providers/claude.mjs.

  // Hyperframes render — POST { slug, html, config } → SSE stream of
  // phase / progress / warning / done / error events. Step 3.5 of
  // anime-hyperframes-poc.md.
  //
  // Current state: STUB. Emits the four-phase state machine on a fixed
  // timer so the frontend modal + render flow can be wired and tested
  // before npm has actually pulled hyperframes + puppeteer down. The
  // real spawn lands when those packages are installed (user runs
  // `npm install` and we replace this body with a child_process.spawn
  // of `npx hyperframes` + FFmpeg).
  //
  // The contract (event names + payload shapes) is intentionally stable
  // so swapping the body to the real spawn won't ripple to the client.
  if (req.method === "POST" && req.url === "/hyperframes/render") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `invalid JSON: ${e}` }));
      return;
    }
    const slug = typeof body?.slug === "string" ? body.slug : "";
    const html = typeof body?.html === "string" ? body.html : "";
    const config = body?.config;
    if (!slug || !config || !html) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "slug + html + config required" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let cancelled = false;
    let browser = null;
    let ffmpegProc = null;
    req.on("close", async () => {
      cancelled = true;
      try {
        if (browser) await browser.close();
      } catch {}
      try {
        if (ffmpegProc && !ffmpegProc.killed) ffmpegProc.kill("SIGTERM");
      } catch {}
    });

    const emit = (event, data) => {
      if (cancelled) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const fail = (kind, message) => {
      if (cancelled) return;
      emit("error", { kind, message });
      res.end();
    };

    // Resolve project root same way other endpoints do.
    const repoRoot = getRepoRoot();

    void (async () => {
      const startedAt = Date.now();

      // Resolve dimensions per ratio. Fixed pixel size — Puppeteer captures
      // the full viewport, FFmpeg encodes to that size.
      const RATIO_DIMS = {
        "16:9": { w: 1920, h: 1080 },
        "9:16": { w: 1080, h: 1920 },
        "1:1": { w: 1080, h: 1080 },
        "4k": { w: 3840, h: 2160 },
      };
      const dim = RATIO_DIMS[config.ratio] || RATIO_DIMS["16:9"];
      const fps = 30;
      const durationSec = Math.max(1, Math.min(180, Math.round(config.durationSec ?? 5)));
      const totalFrames = durationSec * fps;

      // ── Phase 1: lint ────────────────────────────────────────────
      emit("phase", { phase: "linting" });
      const lintIssues = [];
      if (/setTimeout\s*\(/i.test(html))
        lintIssues.push("setTimeout detected — animation may desync");
      if (/Math\.random\s*\(/i.test(html) && !/seedrandom/i.test(html))
        lintIssues.push("Math.random detected — frames may differ");
      // Lint is informational only; we proceed regardless. Real Hyperframes
      // (--strict) would gate here.
      for (const w of lintIssues) emit("warning", { text: w });
      await new Promise((r) => setTimeout(r, 200));
      if (cancelled) return;

      // ── Setup tmp + project export dirs ──────────────────────────
      const ts = Date.now();
      const projectRoot = join(repoRoot, "projects", slug);
      const exportDir = join(projectRoot, ".df", "exports");
      const tmpDir = join("/tmp", `df-render-${ts}`);
      await mkdir(tmpDir, { recursive: true });
      await mkdir(exportDir, { recursive: true });
      const htmlPath = join(tmpDir, "index.html");
      // Inject viewport-fit CSS so legacy HTML (sized for 1080×1080 etc.)
      // fills the chosen render viewport without leaving blank borders.
      // Mirrors the wrapHtmlForViewportFit() helper used by the editor /
      // VideoTab iframes so render output matches the on-screen preview.
      const VIEWPORT_FIT_STYLE = `<style id="df-viewport-fit">
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  box-sizing: border-box;
}
body { overflow: hidden !important; }
</style>`;
      const htmlWithFit = html.includes('id="df-viewport-fit"')
        ? html
        : /<\/head>/i.test(html)
          ? html.replace(/<\/head>/i, `${VIEWPORT_FIT_STYLE}\n</head>`)
          : `<!doctype html><html><head>${VIEWPORT_FIT_STYLE}</head><body>${html}</body></html>`;
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(htmlPath, htmlWithFit, "utf8"),
      );
      const mp4OutPath = join(exportDir, `${ts}.mp4`);

      // ── Phase 2: rendering (Puppeteer screenshot loop) ──────────
      emit("phase", { phase: "rendering" });
      let pup;
      try {
        pup = await import("puppeteer");
      } catch (e) {
        return fail(
          "spawn",
          `Puppeteer not installed. Run \`npm install\` in the project root and try again.`,
        );
      }
      try {
        browser = await pup.default.launch({
          headless: "new",
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: dim.w, height: dim.h, deviceScaleFactor: 1 });
        // Inject a tiny clock-control shim BEFORE the page scripts run so
        // we can advance virtual time deterministically. Animations driven
        // by Date.now/performance.now/requestAnimationFrame respect it.
        await page.evaluateOnNewDocument(() => {
          const w = window;
          w.__df_virtual_time = 0;
          const realDateNow = Date.now;
          const startReal = realDateNow();
          const realPerfNow = performance.now.bind(performance);
          const startPerf = realPerfNow();
          // Override clocks so animations frame-step instead of wall-clock.
          Date.now = () => startReal + w.__df_virtual_time;
          performance.now = () => startPerf + w.__df_virtual_time;
          // Override RAF: callbacks fire immediately but receive virtual ts.
          // Animation libs (anime.js, GSAP) compute progress from this.
          const rafCallbacks = [];
          w.requestAnimationFrame = (cb) => {
            const id = rafCallbacks.length;
            rafCallbacks.push(cb);
            return id;
          };
          w.cancelAnimationFrame = (id) => {
            rafCallbacks[id] = null;
          };
          w.__df_tick = (vt) => {
            w.__df_virtual_time = vt;
            const callbacks = rafCallbacks.splice(0);
            for (const cb of callbacks) {
              if (cb)
                try {
                  cb(startPerf + vt);
                } catch {}
            }
          };
        });
        await page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded", timeout: 15000 });
        // Brief settle delay so initial render + script execution finish.
        await new Promise((r) => setTimeout(r, 300));

        const frameMs = 1000 / fps;
        for (let i = 0; i < totalFrames; i++) {
          if (cancelled) {
            try {
              await browser.close();
            } catch {}
            return;
          }
          const virtualTime = i * frameMs;
          // Advance the virtual clock + flush pending RAF callbacks. Three
          // ticks per frame so multi-step animations (chained RAFs) settle.
          await page.evaluate((vt) => {
            for (let n = 0; n < 3; n++) window.__df_tick(vt);
          }, virtualTime);
          const framePath = join(tmpDir, `frame-${String(i).padStart(6, "0")}.png`);
          await page.screenshot({ path: framePath, type: "png" });
          if (i % Math.max(1, Math.floor(fps / 4)) === 0) {
            emit("progress", {
              frac: (i / totalFrames) * 0.95,
              frame: i + 1,
              totalFrames,
              fps,
            });
          }
        }
        emit("progress", { frac: 0.95, frame: totalFrames, totalFrames, fps });
        await browser.close();
        browser = null;
      } catch (e) {
        try {
          if (browser) await browser.close();
        } catch {}
        return fail("render", `Render failed: ${String(e?.message ?? e).slice(0, 200)}`);
      }
      if (cancelled) return;

      // ── Phase 3: encoding (FFmpeg mux) ────────────────────────────
      emit("phase", { phase: "encoding" });
      try {
        const inputPattern = join(tmpDir, "frame-%06d.png");
        // libx264 yuv420p baseline — broad compat across players + browsers.
        const args = [
          "-y",
          "-loglevel",
          "warning",
          "-framerate",
          String(fps),
          "-i",
          inputPattern,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          // Even dimensions required for yuv420p.
          "-vf",
          "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          mp4OutPath,
        ];
        await new Promise((resolve, reject) => {
          ffmpegProc = spawn("ffmpeg", args);
          let stderrBuf = "";
          ffmpegProc.stderr.on("data", (c) => {
            stderrBuf += String(c);
          });
          ffmpegProc.on("error", (err) => reject(err));
          ffmpegProc.on("close", (code) => {
            ffmpegProc = null;
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit ${code}: ${stderrBuf.slice(-300)}`));
          });
        });
        emit("progress", { frac: 1.0, frame: totalFrames, totalFrames, fps });
      } catch (e) {
        return fail("render", `Encoding failed: ${String(e?.message ?? e).slice(0, 200)}`);
      }

      // ── Cleanup tmp frames ───────────────────────────────────────
      try {
        const { rm } = await import("node:fs/promises");
        await rm(tmpDir, { recursive: true, force: true });
      } catch {}

      // ── Phase 4: done ────────────────────────────────────────────
      let sizeBytes = 0;
      try {
        const { stat } = await import("node:fs/promises");
        const s = await stat(mp4OutPath);
        sizeBytes = s.size;
      } catch {}
      emit("phase", { phase: "done" });
      emit("done", {
        mp4Path: `projects/${slug}/.df/exports/${ts}.mp4`,
        durationMs: Date.now() - startedAt,
        sizeBytes,
      });
      res.end();
    })();
    return;
  }

  // Serve a project file as a binary stream — used by the Video Tab to
  // play the rendered MP4 inside an HTML <video> element. Path is
  // resolved relative to the projects/ root and validated to stay
  // inside it.
  if (req.method === "GET" && req.url.startsWith("/fs/file?")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const relPath = u.searchParams.get("path") || "";
      const repoRoot = getRepoRoot();
      const projectsRoot = resolveProjectsRoot(repoRoot);
      let target;
      try {
        target = assertPathInScope(relPath.replace(/^projects\//, ""), projectsRoot);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e instanceof PathScopeError ? e.message : String(e) }));
        return;
      }
      const { stat, createReadStream } = await import("node:fs");
      stat(target, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = target.toLowerCase().split(".").pop() || "";
        const mime =
          ext === "mp4"
            ? "video/mp4"
            : ext === "webm"
              ? "video/webm"
              : ext === "mov"
                ? "video/quicktime"
                : "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": String(st.size),
          "Accept-Ranges": "bytes",
        });
        createReadStream(target).pipe(res);
      });
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

// ─── Terminal WebSocket ──────────────────────────────────────────
// Attaches a shell PTY to a WebSocket. Frontend connects to ws://host:PORT/terminal,
// sends {type:'data', data}, {type:'resize', cols, rows}; receives 'data' / 'exit'.
//
// node-pty is loaded lazily — if it's not installed (or can't build a native
// binding on this host) the endpoint responds with a clear error instead of
// crashing the whole bridge.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/terminal") {
    socket.destroy();
    return;
  }
  if (!isOriginAllowed(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", async (ws) => {
  let pty;
  try {
    const nodePty = await import("node-pty");
    const shell = process.env.SHELL || "/bin/bash";
    pty = nodePty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/",
      // Strip the daemon's launch-time provider keys / GitHub tokens from the
      // interactive terminal: it's reachable over the WS (origin-checked, but
      // a sandbox-escaped page is the threat), and the user's own shell rc
      // re-exports anything they legitimately set themselves.
      env: { ...sanitizedSpawnEnv("terminal"), TERM: "xterm-256color" },
    });
  } catch (e) {
    ws.send(
      JSON.stringify({
        type: "data",
        data: `\r\n\x1b[31m[bridge] terminal unavailable: ${e}\x1b[0m\r\n`,
      }),
    );
    ws.close();
    return;
  }

  pty.onData((data) => {
    try {
      ws.send(JSON.stringify({ type: "data", data }));
    } catch {}
  });
  pty.onExit(({ exitCode }) => {
    try {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
    } catch {}
    try {
      ws.close();
    } catch {}
  });

  ws.on("message", (msg) => {
    try {
      const { type, data, cols, rows } = JSON.parse(String(msg));
      if (type === "data" && typeof data === "string") pty.write(data);
      else if (type === "resize" && cols && rows) pty.resize(cols, rows);
    } catch {}
  });
  ws.on("close", () => {
    try {
      pty.kill();
    } catch {}
  });
});

// ── Start fresh: reclaim our port from a stale DF daemon ────────────────────
// The packaged app doesn't run the dev-web launcher (which does this), so the
// daemon does it itself: if a previous DF daemon is holding our port, kill it.
// Guarded by /healthz — we only ever kill a process that answers as OUR daemon,
// never an unrelated process on the same port.
async function isOurDaemon(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
function pidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        if (!new RegExp(`[:.]${port}\\b`).test(line)) continue;
        const cols = line.trim().split(/\s+/);
        const pid = cols[cols.length - 1];
        if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      return [...pids];
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    return out.split(/\s+/).filter((x) => /^\d+$/.test(x));
  } catch {
    return [];
  }
}
function killPid(pid) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {}
      }, 400);
    }
  } catch {}
}
async function reclaimPort(port) {
  if (!(await isOurDaemon(port))) return; // free, or held by a non-DF process — don't touch
  const pids = pidsOnPort(port);
  if (!pids.length) {
    console.warn(
      `[dev-bridge] port ${port} is held by our daemon but its PID wasn't found — cannot reclaim`,
    );
    return;
  }
  console.log(
    `[dev-bridge] port ${port} was held by a stale DF daemon (pid ${pids.join(", ")}) — reclaiming`,
  );
  for (const pid of pids) killPid(pid);
  for (let i = 0; i < 30 && (await isOurDaemon(port)); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[dev-bridge] port ${PORT} is still in use by a non-DF process — close it, restart, or set DF_BRIDGE_PORT to another port.`,
    );
  } else {
    console.error(`[dev-bridge] server error: ${err && err.message ? err.message : err}`);
  }
  process.exit(1);
});

await reclaimPort(PORT);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-bridge] listening on http://127.0.0.1:${PORT}`);
  // Daemon cwd guard. Providers without an explicit per-request `cwd`
  // fall back to the daemon's own process.cwd(). If the daemon was
  // started from inside a git worktree (`.aios/worktrees/<name>/`),
  // codex's --full-auto sandbox locks writes to that worktree subtree,
  // and any PROJECT_PATH outside it (the usual `projects/<slug>/`
  // sibling) is silently denied — the agent then "reads but never
  // writes". Surface a clear warning so the operator notices.
  if (process.cwd().includes("/.aios/worktrees/")) {
    console.warn(
      `[dev-bridge] ⚠ daemon cwd is inside .aios/worktrees/ (${process.cwd()}). Providers without explicit cwd in the request will sandbox to this worktree — codex/kimi writes to PROJECT_PATH may fail silently. Start daemon from the main repo root.`,
    );
  }
  // Log the security posture so dev sees what's actually enforced.
  if (ALLOWED_ORIGINS === "*") {
    console.warn(
      `[dev-bridge] ⚠ CORS origin = "*" (DF_BRIDGE_ORIGIN opt-out). NOT for production.`,
    );
  } else {
    console.log(`[dev-bridge] CORS allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  }
  console.log(`[dev-bridge] path scoping: realpath-based (assertPathInScope)`);
  console.log(`[dev-bridge] claude binary: ${CLAUDE_BIN}`);
  console.log(
    `[dev-bridge] endpoints: GET /healthz · GET /ping (alias) · GET /agents/list · POST /claude/stream · POST /claude/once · POST /codex/stream · POST /codex/once · POST /gemini/stream · POST /gemini/once · GET /ollama/models · POST /ollama/stream · POST /ollama/once · GET|PUT /config/openrouter · GET /openrouter/models · POST /openrouter/stream · POST /openrouter/once · POST /opencode/stream · POST /opencode/once · GET /opencode/models · GET|PUT /config/anthropic · GET /anthropic/models · GET /openai/models · GET /gemini-api/models · GET|PUT /config/kimi · GET /kimi/models · POST /anthropic/stream · POST /anthropic/once · GET|PUT /config/vercel · POST /deploy/vercel · GET /deploy/vercel/status · GET /deploy/vercel/list · GET /deploy/vercel/test ·GET /vercel/projects · GET /vercel/projects/all · GET /vercel/projects/check · GET /vercel/teams · GET /vercel/user · POST /vercel/device/start · POST /vercel/device/poll · GET /gh/user · GET /projects/:slug/zip · GET|POST /projects/:slug/versions · GET|DELETE /projects/:slug/versions/:vid · WS /terminal`,
  );
  console.log(
    `[dev-bridge] DS: POST /fs/write · GET /fetch-url · GET /gh/token · GET /gh/repos · POST /git/shallow-clone · POST /git/cleanup`,
  );
  console.log(
    `[dev-bridge] : POST /fs/write/artifact (atomic write + per-finalPath lock + .df/backups rolling 10)`,
  );
  console.log(`[dev-bridge] Skills: GET /skills/registry · POST/PATCH/DELETE /skills`);
  console.log(
    `[dev-bridge] Commands: GET /commands/list · POST /commands/write · POST /commands/delete`,
  );
});
