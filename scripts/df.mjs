#!/usr/bin/env node
// df — the Design Factory command. One entry for the whole local lifecycle:
//
//   df            start (default) — boot the daemon + web, auto-heal port/clone
//   df start      …same, explicit         (--dev / --prod)
//   df stop       stop THIS clone's instance     (--all = every clone)
//   df status     list every running instance (global, cross-clone)
//   df doctor     status + prune dead/orphan registry rows
//   df restart    stop this clone + start
//   df --help     usage         ·   df --version
//
// Cross-clone aware: before starting, it asks the GLOBAL registry whether a DF
// is already up in ANOTHER folder and shows the conflict panel (assumir / abrir
// / subir do lado) instead of silently diverting to odd ports — the founder's
// bug. `start` delegates the actual boot to the proven launcher (dev-web.mjs);
// stop/status/doctor are pure CLI (df-tui panels, no noisy children).
//
// Zero external deps — pure Node core. Reuses df-core / df-registry / df-tui.

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";
import { readFileSync } from "node:fs";
import { killTree, pidAlive } from "./df-core.mjs";
import {
  listInstances,
  pruneRegistry,
  deregisterInstance,
  findLiveElsewhere,
} from "./df-registry.mjs";
import { renderPanel, relTime } from "./df-tui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const LAUNCHER = join(__dirname, "dev-web.mjs");

const TTY = process.stdout.isTTY === true;
const COLOR = TTY && !process.env.NO_COLOR;
const NOW = () => Date.now();

function version() {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version || "?";
  } catch {
    return "?";
  }
}

// ── arg parsing ──────────────────────────────────────────────────────────────
// First non-flag token is the command (default "start"). Flags are collected.
export function parseArgs(argv) {
  const flags = new Set();
  let command = null;
  for (const a of argv) {
    if (a.startsWith("-")) flags.add(a);
    else if (command === null) command = a;
  }
  return { command: command || "start", flags };
}

const paint = (state) => process.stdout.write(renderPanel(state, { color: COLOR }) + "\n");

// Decorate registry rows for a panel (folder basename, url, relative age).
export function toPanelInstance(e, now) {
  return {
    folder: "…/" + basename(e.folder),
    url: `http://localhost:${e.vitePort}`,
    healthy: e.healthy !== false,
    since: relTime(e.startedAt, now),
  };
}

// ── read a single key in raw mode (TTY only) ─────────────────────────────────
function readKey(valid) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    try {
      stdin.setRawMode(true);
    } catch {}
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (key) => {
      const k = key.toLowerCase();
      if (key === "\x03" || key === "\x1b") return done("q"); // Ctrl+C / Esc → cancel
      if (valid.includes(k)) return done(k);
      // ignore other keys, keep waiting
    };
    function done(k) {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {}
      stdin.pause();
      resolve(k);
    }
    stdin.on("data", onData);
  });
}

function openUrl(url) {
  const cmd =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

// Spawn the proven launcher in-foreground (stdio inherit, same process group so
// Ctrl+C reaches it). Resolves with its exit code.
function runLauncher(modeFlag) {
  return new Promise((resolve) => {
    const args = [LAUNCHER];
    if (modeFlag) args.push(modeFlag);
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

// Stop one registry entry: reap its process trees, then drop it.
function stopEntry(e) {
  killTree(e.vitePid);
  killTree(e.daemonPid);
  deregisterInstance(e.folder);
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdStart(flags) {
  const modeFlag = flags.has("--dev") ? "--dev" : flags.has("--prod") ? "--prod" : null;

  // Cross-clone conflict: is a DF live in ANOTHER folder? Only prompt on a TTY;
  // non-interactive (CI / pipe) falls straight through to the launcher, which
  // auto-resolves ports as before.
  const others = findLiveElsewhere(repoRoot);
  if (others.length && TTY) {
    const other = others[0];
    paint({
      kind: "conflict",
      folder: "…/" + basename(other.folder),
      url: `http://localhost:${other.vitePort}`,
      healthy: true,
      since: relTime(other.startedAt, NOW()),
    });
    const key = await readKey(["a", "o", "s", "q"]);
    if (key === "q") {
      process.stdout.write("  cancelado\n");
      return 0;
    }
    if (key === "o") {
      openUrl(`http://localhost:${other.vitePort}`);
      process.stdout.write(`  abrindo http://localhost:${other.vitePort}\n`);
      return 0;
    }
    if (key === "a") {
      for (const e of others) stopEntry(e);
      // give the canonical ports a moment to free before the launcher probes
      await new Promise((r) => setTimeout(r, 600));
    }
    // key === "s" → fall through: launcher will auto-pick side ports
  }

  return runLauncher(modeFlag);
}

async function cmdStop(flags) {
  const all = flags.has("--all");
  const list = pruneRegistry();
  const targets = all ? list : list.filter((e) => e.folder === repoRoot);
  if (targets.length === 0) {
    process.stdout.write(
      all ? "  nenhuma instância rodando\n" : "  nenhuma instância desta pasta rodando\n",
    );
    return 0;
  }
  for (const e of targets) {
    stopEntry(e);
    process.stdout.write(`  parada: …/${basename(e.folder)} (web :${e.vitePort})\n`);
  }
  return 0;
}

async function cmdStatus() {
  const list = await listInstances({ checkHealth: true });
  const now = NOW();
  paint({ kind: "status", instances: list.map((e) => toPanelInstance(e, now)) });
  return 0;
}

async function cmdDoctor() {
  const before = pruneRegistry().length;
  // a second prune after re-reading catches rows that died between reads
  const after = pruneRegistry();
  const cleaned = before - after.length;
  const annotated = await listInstances({ checkHealth: true });
  const now = NOW();
  paint({ kind: "status", instances: annotated.map((e) => toPanelInstance(e, now)) });
  process.stdout.write(
    cleaned > 0
      ? `  doctor: ${cleaned} órfão(s) removido(s) do registro\n`
      : `  doctor: registro limpo · ${after.length} instância(s) viva(s)\n`,
  );
  // surface any entry whose daemon answers no /healthz (zombie pid, dead daemon)
  const zombies = annotated.filter(
    (e) => e.daemonPid && pidAlive(e.daemonPid) && e.healthy === false,
  );
  if (zombies.length) {
    process.stdout.write(
      `  aviso: ${zombies.length} daemon(s) sem /healthz — tente: df stop --all\n`,
    );
  }
  return 0;
}

async function cmdRestart(flags) {
  await cmdStop(flags.has("--all") ? flags : new Set());
  await new Promise((r) => setTimeout(r, 400));
  return cmdStart(flags);
}

function cmdHelp() {
  const v = version();
  process.stdout.write(
    `\n  Design Factory — df v${v}\n\n` +
      `  df              iniciar (daemon + web), com auto-cura de porta/clone\n` +
      `  df start        idem    (--dev | --prod)\n` +
      `  df stop         parar a instância desta pasta   (--all = todas)\n` +
      `  df status       listar instâncias rodando (todas as pastas)\n` +
      `  df doctor       status + limpar órfãos do registro\n` +
      `  df restart      parar esta pasta + iniciar\n` +
      `  df --help       esta ajuda    ·   df --version\n\n`,
  );
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("--help") || flags.has("-h") || command === "help") return cmdHelp();
  if (flags.has("--version") || flags.has("-v") || command === "version") {
    process.stdout.write(version() + "\n");
    return 0;
  }
  switch (command) {
    case "start":
      return cmdStart(flags);
    case "stop":
      return cmdStop(flags);
    case "status":
      return cmdStatus();
    case "doctor":
      return cmdDoctor();
    case "restart":
      return cmdRestart(flags);
    default:
      process.stderr.write(`  comando desconhecido: ${command}\n`);
      cmdHelp();
      return 1;
  }
}

// Only auto-run when executed directly (df / node scripts/df.mjs), not when
// imported by tests.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => {
      paint({
        kind: "error",
        title: "df falhou",
        lines: [String(err && err.message ? err.message : err)],
      });
      process.exit(1);
    },
  );
}
