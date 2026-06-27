// df-core — stateless launcher primitives shared by the supervised launcher
// (scripts/dev-web.mjs) and the upcoming `df` CLI (scripts/df.mjs) + instance
// registry. Pure helpers only: port probing, process-tree kill, daemon health.
//
// No module-level mutable state, no presentation, no signal handlers — those
// stay in the callers (dev-web.mjs owns the boot machinery; df.mjs owns the
// command routing). Keeping these here lets the CLI reuse the exact same,
// already-battle-tested process/port logic instead of re-implementing it.
//
// Zero external deps — pure Node core.

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

// Poll cadence for waitHealthy. (The per-call budget is the caller's to pass.)
export const HEALTH_POLL_MS = 200;

// ── process-tree kill (cross-platform) ──────────────────────────────────────
// Unix: children are spawned detached (own process group), so the negative pid
// kills the whole group — taking the daemon's grandchildren (ffmpeg/puppeteer/
// pty) with it. Windows has no usable group here; taskkill /T walks the tree
// (and /T also reaches the real vite behind the npm.cmd shell wrapper).
export function killTree(pid, signal = "SIGTERM") {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {}
      }
    }
  } catch {}
}

// True when a pid is alive (signal 0 probe — sends no signal, just checks).
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// True when `port` is already bound (EADDRINUSE on a loopback probe listen).
export async function portInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (err) => {
      if (err && /** @type {any} */ (err).code === "EADDRINUSE") resolve(true);
      else resolve(false);
    });
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

// First free port in [from, from+span), skipping any in `reserved`. null if none.
export async function nextFreePort(from, span = 40, reserved = new Set()) {
  for (let p = from; p < from + span; p++) {
    if (reserved.has(p)) continue;
    if (!(await portInUse(p))) return p;
  }
  return null;
}

// Find PIDs listening on `port`. Cross-platform: netstat on Windows, lsof on
// Mac/Linux. Empty array on failure / no listener.
export function findPidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      // netstat -ano output: "  TCP    127.0.0.1:1420    0.0.0.0:0    LISTENING    12345"
      const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
      const re = new RegExp(`[: .]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "m");
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(re);
        if (m) pids.add(Number(m[1]));
      }
      return [...pids];
    }
    // POSIX — lsof -t -i :PORT lists owning PIDs, one per line.
    const out =
      spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout || "";
    return out
      .split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

// True when the PID is a node process. Used as a safety filter before killing —
// we never reap SSH sessions, VS Code port-forwards, browser tabs, etc.
// Cross-platform via process name lookup.
export function isNodeProcess(pid) {
  try {
    if (process.platform === "win32") {
      // tasklist /FI "PID eq N" /FO CSV → "Image Name","PID",...
      const out =
        spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" })
          .stdout || "";
      return /node\.exe/i.test(out);
    }
    // POSIX — `ps -p PID -o comm=` prints just the command name.
    const out =
      spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).stdout || "";
    return /\bnode\b/.test(out);
  } catch {
    return false;
  }
}

// Is the process on this port one of OUR daemons (answers /healthz fast)? Then a
// caller can reuse it instead of fighting over the port. ≤800ms budget.
export async function isOurDaemon(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// Poll /healthz on `port` until it answers ok or `budgetMs` elapses.
export async function waitHealthy(port, budgetMs) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1000);
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}
