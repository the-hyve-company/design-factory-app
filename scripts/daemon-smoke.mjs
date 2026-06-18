#!/usr/bin/env node
// daemon-smoke.mjs — one-shot health probe for the local daemon.
//
// Walks the critical HTTP endpoints the app depends on, asserts each
// answers 200 (or a documented soft-200 like /fs/read's `found:false`),
// and prints a clean PASS/FAIL line per endpoint. Designed to run in
// CI without secrets and in a fresh checkout before declaring a
// release ready.
//
// Boots its own daemon process on an OS-assigned free port so it never
// collides with the dev daemon (which uses :1421). Tears the process
// down on success or failure.
//
// Usage:
//   npm run smoke:daemon
//   node scripts/daemon-smoke.mjs

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// ─── Helpers ────────────────────────────────────────────────────────

const COLOR = {
  pass: (s) => `\x1b[32m${s}\x1b[0m`,
  fail: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function log(line) {
  process.stdout.write(line + "\n");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.once("listening", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      srv.close(() => {
        if (typeof port === "number") resolve(port);
        else reject(new Error("failed to allocate free port"));
      });
    });
    srv.listen(0, "127.0.0.1");
  });
}

async function waitHealthy(port, deadlineMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// ─── Probes ─────────────────────────────────────────────────────────

const PROBES = [
  {
    label: "GET /healthz",
    accepts: (status) => status === 200,
  },
  {
    label: "GET /fs/workspace-info",
    accepts: (status) => status === 200,
  },
  {
    label: "GET /fs/list-projects",
    accepts: (status) => status === 200,
  },
  {
    label: "GET /skills/registry",
    accepts: (status) => status === 200,
  },
  {
    label: "GET /providers/status",
    accepts: (status) => status === 200 || status === 404,
    // /providers/status is documented but not implemented on every
    // commit; a 404 is acceptable — the daemon is still up.
  },
];

async function runProbe(port, { label, accepts }) {
  const path = label.replace(/^GET\s+/, "");
  const t0 = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    const ms = Date.now() - t0;
    const ok = accepts(r.status);
    return { label, ok, status: r.status, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    return { label, ok: false, status: "error", ms, error: String(e) };
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const port = await findFreePort();
  log(COLOR.dim(`daemon-smoke: starting daemon on :${port}`));

  const daemon = spawn(process.execPath, ["apps/daemon/src/index.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, DF_BRIDGE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  daemon.stdout.on("data", () => {}); // silence boot chatter
  daemon.stderr.on("data", () => {});

  const healthy = await waitHealthy(port);
  if (!healthy) {
    daemon.kill("SIGTERM");
    log(COLOR.fail("FAIL: daemon did not report healthy within 8 s"));
    process.exit(1);
  }

  log(COLOR.dim("daemon-smoke: probing endpoints"));
  const results = [];
  for (const probe of PROBES) {
    results.push(await runProbe(port, probe));
  }

  daemon.kill("SIGTERM");
  // Give it a moment to release the port — useful when called in
  // a tight loop (e.g. release scripts).
  await new Promise((r) => setTimeout(r, 200));

  // ─── Report ─────────────────────────────────────────────────────
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? COLOR.pass("PASS") : COLOR.fail("FAIL");
    const status = r.status === "error" ? "ERR" : String(r.status);
    log(`  ${tag}  ${r.label.padEnd(28)}  ${status}  ${r.ms}ms${r.error ? "  " + r.error : ""}`);
    if (r.ok) passed++;
    else failed++;
  }

  log("");
  log(`daemon-smoke: ${passed} passed / ${failed} failed (${results.length} probed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  log(COLOR.fail("FAIL: " + String(e)));
  process.exit(1);
});
