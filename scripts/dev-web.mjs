#!/usr/bin/env node
// dev-web — supervised launcher for the daemon + Vite combo.
//
// Replaces the shell `&` pattern from the old package.json script. The shell
// version forked the daemon and continued to vite without waiting; if the
// daemon crashed in the first seconds, vite stayed alive serving the UI
// while every API call to :1421 failed silently. That's the bug that
// kicked off this whole refoundation.
//
// Guarantees this launcher provides:
//   1. START FRESH: on launch, kill a previous DF instance recorded in the
//      lockfile (verified by /healthz so we never kill an unrelated PID) — so
//      every run starts clean, independent of port, and stale orphans (e.g. a
//      Windows window-close that couldn't be caught) are reaped on next launch.
//   2. spawn the daemon, wait for /healthz 200 before starting vite (10s budget)
//   3. spawn vite only after the daemon is healthy
//   4. propagate SIGINT / SIGTERM / SIGHUP to both, killing their whole process
//      tree (daemon's children: ffmpeg/puppeteer/pty) — group kill on unix,
//      taskkill /T on Windows
//   5. kill vite if daemon dies; kill daemon if vite dies
//   6. on port collision with a FOREIGN process, auto-pick the next free port —
//      never hard-fail. Truly stuck → cross-platform guidance.
//   7. branded, didactic boot (lattice-8x logo banner + step status + ready menu)
//
// Zero external deps — pure Node core.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  readdirSync,
} from "node:fs";
import {
  killTree,
  pidAlive,
  portInUse,
  nextFreePort,
  findPidsOnPort,
  isNodeProcess,
  isOurDaemon,
  waitHealthy,
} from "./df-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const LOCK_PATH = join(repoRoot, ".df", "daemon.lock");
const DIST_DIR = join(repoRoot, "dist");
const DIST_INDEX = join(DIST_DIR, "index.html");

let DAEMON_PORT = Number(process.env.DF_BRIDGE_PORT || 1421);
let VITE_PORT = Number(process.env.DF_VITE_PORT || 1420);
const HEALTH_TIMEOUT_MS = 10_000;
const DOCS_URL = "https://github.com/the-hyve-company/design-factory-app#readme";

// ── mode: prod (default for end users) vs dev (contributors) ─────────────────
// prod  → builds (vite build, if dist/ is missing or stale) then serves the
//         optimized dist/ via `vite preview`. This is what double-click /
//         `npm start` gives the end user — the fast, optimized app.
// dev   → the classic Vite dev server (HMR, unoptimized). For contributors
//         hacking on the source.
// Selection: CLI flag (--prod / --dev) wins, else DF_MODE env, else prod.
function resolveMode() {
  const argv = process.argv.slice(2);
  if (argv.includes("--dev")) return "dev";
  if (argv.includes("--prod")) return "prod";
  const env = (process.env.DF_MODE || "").toLowerCase();
  if (env === "dev" || env === "prod") return env;
  return "prod";
}
const MODE = resolveMode();
const IS_PROD = MODE === "prod";

// ── presentation: color only when safe (TTY + not NO_COLOR). orange = accent only ──
const TTY = process.stdout.isTTY === true;
const COLOR = TTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const sage = (s) => c("38;2;215;232;200", s);
const orange = (s) => c("38;2;255;85;36", s);
const green = (s) => c("38;2;45;169;82", s);
const red = (s) => c("38;2;200;57;42", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);

// DesignFactory logo (lattice 8×) as terminal dots — derived from src/assets/logo-df.svg
// via canvas→dots (style 03, size L). Regenerate with the df-banner-gallery technique
// if the logo changes. `·` marks an off cell → rendered as a blank space.
const LOGO = [
  "········●●●●●··········●●●●●",
  "·······●●●●●●●········●●●●●●●",
  "·······●●●●●●●●······●●●●●●●●",
  "···●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●",
  "●●●●●●●●······●●●●●●●●······●●●●●●●●",
  "●●●●●●●·······●●●●●●●●·······●●●●●●●",
  "·●●●●●●●·······●●●●●●·······●●●●●●●",
  "·····●●●●●●●···········●●●●●●●●",
  "·······●●●●●●●········●●●●●●●",
  "·······●●●●●●●········●●●●●●●",
  "·····●●●●●●●●··········●●●●●●●●",
  "·●●●●●●●·······●●●●●●·······●●●●●●●",
  "●●●●●●●·······●●●●●●●●·······●●●●●●●",
  "·●●●●●●●······●●●●●●●●······●●●●●●●",
  "···●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●",
  "·······●●●●●●●●······●●●●●●●●",
  "·······●●●●●●●········●●●●●●●",
  "········●●●●●··········●●●●●",
].map((l) => l.replace(/·/g, " "));

function printBanner() {
  process.stdout.write("\n");
  for (const line of LOGO) process.stdout.write("  " + sage(line) + "\n");
  process.stdout.write(
    "\n  " + bold(sage("HYVE")) + " " + orange("·") + " " + bold(sage("DESIGN FACTORY")) + "\n\n",
  );
}

// step output — robust (no in-place \r; children inherit stdio and would clobber it)
function step(icon, label, detail) {
  process.stdout.write(`  ${icon}  ${sage(label.padEnd(15))}${detail ? dim(detail) : ""}\n`);
}
const stepOk = (l, d) => step(green("✓"), l, d);
const stepRun = (l, d) => step(orange("⟳"), l, d);
const stepErr = (l, d) => step(red("✗"), l, d);

function fatalPort(port) {
  const isWin = process.platform === "win32";
  const find = isWin ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`;
  const kill = isWin ? "taskkill /PID <pid> /F" : "kill <pid>";
  // Point the retry hint at the same entrypoint the user launched (prod →
  // `npm start`, dev → `npm run dev:web`), so the suggested command matches.
  const launchCmd = IS_PROD ? "npm start" : "npm run dev:web";
  const set = isWin
    ? `set DF_BRIDGE_PORT=9999 && ${launchCmd}`
    : `DF_BRIDGE_PORT=9999 ${launchCmd}`;
  process.stderr.write(
    `\n  ${red(bold(`Porta ${port} presa e não liberou sozinha.`))}\n` +
      `  ${dim("libere:")}        ${find}  →  ${kill}\n` +
      `  ${dim("ou outra porta:")} ${set}\n\n`,
  );
  process.exit(1);
}

let daemon = null;
let vite = null;
let shuttingDown = false;

function writeLock() {
  try {
    mkdirSync(dirname(LOCK_PATH), { recursive: true });
    writeFileSync(
      LOCK_PATH,
      JSON.stringify({
        daemonPid: daemon ? daemon.pid : null,
        vitePid: vite ? vite.pid : null,
        bridgePort: DAEMON_PORT,
        vitePort: VITE_PORT,
        startedAt: Date.now(),
      }),
    );
  } catch {}
}

const deleteLock = () => {
  try {
    unlinkSync(LOCK_PATH);
  } catch {}
};

// Start fresh: kill the previous DF instance recorded in the lockfile. We only
// kill when the recorded daemon PID is alive AND its /healthz confirms it is OUR
// daemon — this guards against killing an unrelated process that recycled the PID.
async function reapPriorInstance() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  } catch {
    return;
  }
  try {
    const ours =
      lock.daemonPid &&
      pidAlive(lock.daemonPid) &&
      Number.isInteger(lock.bridgePort) &&
      (await isOurDaemon(lock.bridgePort));
    if (ours) {
      stepRun("Instância anterior", `encerrando (pid ${lock.daemonPid})…`);
      killTree(lock.vitePid);
      killTree(lock.daemonPid);
      // wait (≤2.5s) for the bridge port to free so resolvePorts sees a clean slate
      for (let i = 0; i < 25 && (await portInUse(lock.bridgePort)); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  } catch {
    // best effort — fall through and clear the stale lock
  }
  deleteLock();
}

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (TTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }
  process.stdout.write("\n  " + dim(`${reason} — encerrando…`) + "\n");
  deleteLock();
  for (const child of [vite, daemon]) {
    if (!child || child.killed) continue;
    killTree(child.pid);
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown("SIGINT recebido", 130));
process.on("SIGTERM", () => shutdown("SIGTERM recebido", 143));
process.on("SIGHUP", () => shutdown("SIGHUP recebido", 129)); // terminal/SSH fechado
// Last-resort reaper: if we exit by a path that skipped shutdown() (crash,
// fatal), take the children's process trees with us. Only synchronous work runs
// in 'exit'; killTree is sync. (Windows window-close sends CTRL_CLOSE_EVENT,
// which Node cannot catch — start-fresh-on-launch reaps that orphan next run.)
process.on("exit", () => {
  for (const child of [vite, daemon]) {
    if (child && !child.killed) killTree(child.pid);
  }
});

function fatal(msg, code = 1) {
  process.stderr.write(`\n  ${red(bold("erro:"))} ${msg}\n\n`);
  process.exit(code);
}

function openUrl(url) {
  const cmd =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

function bindKeys() {
  if (!TTY || !process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (key) => {
      if (key === "" || key === "q") return shutdown("saindo", 0); // Ctrl+C / q
      if (key === "o") return openUrl(`http://localhost:${VITE_PORT}`);
      if (key === "d") return openUrl(DOCS_URL);
      if (key === "r") {
        process.stdout.write("\n  " + dim("reiniciando…") + "\n");
        for (const ch of [vite, daemon]) {
          if (ch && !ch.killed) killTree(ch.pid);
        }
        vite = null;
        daemon = null;
        setTimeout(() => boot().catch((e) => fatal(`restart falhou: ${e.message}`)), 600);
      }
    });
  } catch {
    // non-interactive stdin — keys unavailable, no harm
  }
}

const t0 = Date.now();

/** Fallback reaper: when a port the script wants is held by a stray
 *  node process AND the lockfile-based reapPriorInstance() didn't catch
 *  it (Windows X-close, run from a different cwd, lockfile deleted),
 *  identify the PID via netstat/lsof and kill it IF it's node. Only
 *  ever touches node processes — SSH/IDE/browser owning the port stays
 *  untouched and we fall back to picking a different port.
 *  Returns true when at least one node PID was killed and the port is
 *  now free. */
async function reapStalePortIfNode(port) {
  const pids = findPidsOnPort(port);
  const nodePids = pids.filter(isNodeProcess);
  if (nodePids.length === 0) return false;
  stepRun(`Porta :${port}`, `node órfão detectado (pid ${nodePids.join(", ")}) — matando…`);
  for (const pid of nodePids) killTree(pid);
  // Wait briefly for the port to actually free (kill is async on Windows).
  for (let i = 0; i < 20; i++) {
    if (!(await portInUse(port))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function resolvePorts() {
  const parts = [];
  // Resolve the WEB port first so the daemon-reuse decision below can see it.
  // Reserve DAEMON_PORT: it is the (still unbound) bridge port, so without this
  // the scan could hand the same port to web + bridge.
  if (await portInUse(VITE_PORT)) {
    // Try to reclaim — only kills node processes, never foreign ones.
    if (await reapStalePortIfNode(VITE_PORT)) {
      parts.push(`:${VITE_PORT} reclaimada de orfão node`);
    } else {
      const free = await nextFreePort(VITE_PORT + 1, 40, new Set([DAEMON_PORT]));
      if (free == null) fatalPort(VITE_PORT);
      parts.push(`:${VITE_PORT} ocupada → web em :${free}`);
      VITE_PORT = free;
    }
  }
  if (await portInUse(DAEMON_PORT)) {
    // Same reclaim attempt for the daemon port. Lockfile reap above
    // catches DF's own daemon; this catches every other orphan node.
    if (await reapStalePortIfNode(DAEMON_PORT)) {
      parts.push(`:${DAEMON_PORT} reclaimada de orfão node`);
    } else {
      const free = await nextFreePort(DAEMON_PORT + 1, 40, new Set([VITE_PORT]));
      if (free == null) fatalPort(DAEMON_PORT);
      parts.push(`:${DAEMON_PORT} ocupada → bridge em :${free}`);
      DAEMON_PORT = free;
    }
  }
  return parts.length ? parts.join(" · ") : `:${VITE_PORT} + :${DAEMON_PORT} livres`;
}

// ── prod build gate ──────────────────────────────────────────────────────
// Newest mtime under a dir tree (recursive), skipping the noise that the app
// itself writes at runtime (projects/, .df/, dist/, node_modules/…). Used to
// decide if dist/ is stale relative to the source. Returns 0 on empty/missing.
function newestMtime(dir, skip) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (skip.has(ent.name)) continue;
    const full = join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        const m = newestMtime(full, skip);
        if (m > newest) newest = m;
      } else {
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    } catch {
      /* race/permission — skip */
    }
  }
  return newest;
}

// True when dist/ is missing OR older than the freshest source file. Cheap
// heuristic (mtime compare) — good enough to avoid a needless rebuild on every
// launch while still rebuilding after the user updates the code.
function distIsStale() {
  if (!existsSync(DIST_INDEX)) return true;
  let builtAt = 0;
  try {
    builtAt = statSync(DIST_INDEX).mtimeMs;
  } catch {
    return true;
  }
  // Compare against the source the build consumes. Skip runtime/output dirs.
  const skipRoot = new Set([
    "node_modules",
    "dist",
    ".df",
    ".df-attachments",
    ".git",
    "projects",
    "design-systems",
  ]);
  const srcNewest = Math.max(
    newestMtime(join(repoRoot, "src"), new Set()),
    newestMtime(join(repoRoot, "apps"), new Set(["node_modules", "dist"])),
    // top-level config files that affect the build output
    ...["index.html", "vite.config.ts", "tsconfig.json", "package.json"].map((f) => {
      try {
        return statSync(join(repoRoot, f)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
  // (skipRoot reserved for a future full-root scan; src+apps+configs cover the
  //  build inputs without walking projects/.df noise.)
  void skipRoot;
  return srcNewest > builtAt;
}

// Run `npm run build` and wait for it to finish. Returns on success; on a
// non-zero exit we fatal() with didactic guidance (the optimized bundle is the
// product the end user runs — a broken build must not silently fall through).
async function ensureBuild() {
  if (!distIsStale()) {
    stepOk("Build", "dist/ atualizado · pulando");
    return;
  }
  stepRun(
    "Build",
    existsSync(DIST_INDEX) ? "código mudou — recompilando…" : "primeira compilação (otimizando)…",
  );
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const code = await new Promise((res) => {
    const child = spawn(npmBin, ["run", "build"], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    child.on("exit", (c) => res(c ?? 1));
    child.on("error", () => res(1));
  });
  if (code !== 0) {
    fatal(
      `a compilação (vite build) falhou (code ${code}) — veja o erro acima. Pra desenvolver com hot-reload e ver o erro detalhado: npm run dev:web`,
    );
  }
  if (!existsSync(DIST_INDEX)) {
    fatal("a compilação terminou mas dist/index.html não existe — build incompleto.");
  }
  stepOk("Build", "dist/ pronto · otimizado");
}

// spawn daemon (unless reusing) + vite (dev) OR vite preview (prod).
// Reusable for soft-restart ('r').
async function boot() {
  // Unix: detached makes each child a process-group leader so killTree(pid) can
  // reap its whole tree via the negative pid. Not unref'd — we keep control.
  const detached = process.platform !== "win32";

  stepRun("Bridge daemon", `iniciando :${DAEMON_PORT}…`);
  daemon = spawn(process.execPath, ["apps/daemon/src/index.mjs"], {
    cwd: repoRoot,
    // DF_VITE_PORT tells the daemon which web origin to trust in CORS, so a
    // reclaimed (non-default) Vite port isn't rejected as a bad origin.
    env: { ...process.env, DF_BRIDGE_PORT: String(DAEMON_PORT), DF_VITE_PORT: String(VITE_PORT) },
    stdio: ["ignore", "inherit", "inherit"],
    detached,
  });
  daemon.on("exit", (code, signal) => {
    if (shuttingDown) return;
    stepErr("Bridge daemon", `caiu (${code !== null ? `code ${code}` : `signal ${signal}`})`);
    shutdown("daemon morreu", code ?? 1);
  });
  const healthy = await waitHealthy(DAEMON_PORT, HEALTH_TIMEOUT_MS);
  if (!healthy) {
    fatal(
      `o daemon não respondeu /healthz em ${HEALTH_TIMEOUT_MS}ms — veja o log do daemon acima.`,
    );
  }
  stepOk("Bridge daemon", `:${DAEMON_PORT} · healthy`);

  // prod → serve the optimized dist/ via `vite preview`; dev → the HMR dev
  // server. Both run through npm so the script name resolves the same vite
  // binary, and both take `--port` to honor a reclaimed port. The daemon, the
  // health gate, the lockfile reaping, the signal propagation and the port
  // collision handling above are identical in both modes.
  const viteScript = IS_PROD ? "preview" : "dev";
  const webLabel = IS_PROD ? "Web (preview)" : "Web (Vite)";
  stepRun(webLabel, `iniciando :${VITE_PORT}…`);
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  vite = spawn(npmBin, ["run", viteScript, "--", "--port", String(VITE_PORT)], {
    cwd: repoRoot,
    // VITE_DF_WEB_PORT is exposed to the client (import.meta.env) so the origin
    // guard trusts the actual served port, even when reclaimed off the default.
    env: {
      ...process.env,
      // Same-origin bridge: the client hits `<origin>/__bridge`, which Vite
      // (dev + preview) proxies to the daemon on loopback. Only the web port
      // needs forwarding, and a reclaimed daemon port never strands the built
      // bundle on a stale hardcoded port. DF_BRIDGE_PORT tells vite.config which
      // daemon port to proxy to (follows the auto-pick above).
      VITE_BRIDGE_URL: "/__bridge",
      DF_BRIDGE_PORT: String(DAEMON_PORT),
      VITE_DF_WEB_PORT: String(VITE_PORT),
    },
    stdio: ["ignore", "inherit", "inherit"],
    // Windows: Node >=18.20.2/20.12.2/21+ refuses to spawn .cmd/.bat without a
    // shell (CVE-2024-27980 hardening) → "spawn EINVAL". The daemon above uses
    // process.execPath (node.exe) so it is unaffected; only npm.cmd needs this.
    shell: process.platform === "win32",
    detached,
  });
  vite.on("exit", (code, signal) => {
    if (shuttingDown) return;
    stepErr(webLabel, `caiu (${code !== null ? `code ${code}` : `signal ${signal}`})`);
    shutdown("vite morreu", code ?? 1);
  });

  // record this instance so the NEXT launch can start fresh (kill us first)
  writeLock();

  setTimeout(() => {
    if (shuttingDown) return;
    stepOk(webLabel, `:${VITE_PORT} · pronto`);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const webUrl = `http://localhost:${VITE_PORT}`;
    // Auto-open the app in the default browser so launch is a single command.
    // Opt out with DF_NO_OPEN=1 (headless / CI / remote shells).
    const opened = !process.env.DF_NO_OPEN;
    if (opened) openUrl(webUrl);
    process.stdout.write(
      "\n  " +
        orange("◆") +
        " " +
        bold("Tudo pronto") +
        " " +
        dim(`em ${secs}s`) +
        "\n" +
        "  " +
        dim(opened ? "▸ Abrindo no navegador:" : "▸ Abra:") +
        "  " +
        sage(webUrl) +
        "\n" +
        (TTY
          ? "  " +
            dim("▸ ") +
            orange("[o]") +
            dim(" reabrir  ") +
            orange("[r]") +
            dim(" restart  ") +
            orange("[d]") +
            dim(" docs  ") +
            orange("[q]") +
            dim(" sair") +
            "\n\n"
          : "  " + dim("▸ Ctrl+C para parar") + "\n\n"),
    );
  }, 1200);
}

async function main() {
  printBanner();
  stepOk(
    "Ambiente",
    `node ${process.version.replace(/^v/, "")} · deps ok · modo ${IS_PROD ? "produção" : "dev"}`,
  );
  // prod: guarantee an optimized build exists (and is fresh) before serving it.
  // Built before reaping/ports so a long first compile doesn't hold a port.
  if (IS_PROD) await ensureBuild();
  await reapPriorInstance(); // start fresh: kill a previous DF instance (verified by /healthz)
  const portsNote = await resolvePorts();
  stepOk("Portas", portsNote);
  await boot();
  bindKeys();
}

main().catch((err) => {
  fatal(`launcher falhou: ${err && err.stack ? err.stack : String(err)}`);
});
