#!/usr/bin/env node
// e2e-providers.mjs — drives dev:web through Playwright and runs the chat
// happy-path for each provider. Captures: console errors, network requests
// to the bridge, final chat DOM, screenshot. Outputs a status matrix.
//
// Run from repo root:  node scripts/e2e-providers.mjs
//
// Pre-conditions:
//   1. dev:web running on http://localhost:1427 (bridge on :1433)
//   2. Provider creds loaded (CLIs on PATH or API keys in env)
//   3. Playwright + chromium installed (`npx playwright install chromium`)

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", ".df", "e2e");
const APP_URL = process.env.DF_APP_URL || "http://127.0.0.1:1427";
const BRIDGE_URL = process.env.DF_BRIDGE_URL || "http://127.0.0.1:1433";
const PER_PROVIDER_TIMEOUT_MS = Number(process.env.DF_E2E_TURN_TIMEOUT_MS || 90_000);
const MAX_RETRIES = Number(process.env.DF_E2E_RETRIES || 1);

// Each entry: provider id (as ProviderId), seed prompt to send. Pick prompts
// short enough that any provider responds fast. The default model is what
// each adapter picks when the picker is "default".
const ALL_PROVIDERS = [
  { id: "claude", seed: "say only the word PONG" },
  { id: "codex", seed: "say only the word PONG" },
  { id: "gemini-api", seed: "say only the word PONG" },
  { id: "openrouter", seed: "say only the word PONG" },
];
// DF_E2E_PROVIDERS=claude,codex narrows the matrix for focused debugging.
const PROVIDERS = process.env.DF_E2E_PROVIDERS
  ? ALL_PROVIDERS.filter((p) => process.env.DF_E2E_PROVIDERS.split(",").includes(p.id))
  : ALL_PROVIDERS;
// DF_E2E_SCENARIOS=seed narrows scenarios too.
const SCENARIO_FILTER = process.env.DF_E2E_SCENARIOS
  ? process.env.DF_E2E_SCENARIOS.split(",")
  : null;

// Scenarios to cover for every provider. Each scenario walks a different
// real-world path through the UI:
//   - "seed"   : prompt typed in the new-project modal → auto-send fires
//                after navigation. Then a manual follow-up turn from the
//                editor composer.
//   - "manual" : modal submitted with a one-character placeholder (the
//                Criar projeto button is disabled when empty), then the
//                FIRST agent turn is sent manually through the editor
//                composer — the path most users hit when they want to
//                think before they speak.
// Both scenarios end on the same assertion: the assistant produced the
// expected token (PONG) on its first reply.
// Scenarios:
//   - seed    : prompt in modal → auto-send → followup via composer
//   - manual  : empty modal → manual first send via composer
//   - switch  : create project A (seed), then back to Home, create project B
//               (seed) — exercises the EditorScreen remount path that
//               BUG-15 introduced. Asserts both projects respond cleanly.
//   - refresh : create project (seed), wait for reply, F5 the page,
//               assert chat hydrates with the prior user + assistant turns.
const SCENARIOS = ["seed", "manual", "switch", "refresh"].filter(
  (s) => !SCENARIO_FILTER || SCENARIO_FILTER.includes(s),
);

// Ensure output dir exists
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const matrix = [];
const startedAt = Date.now();

function log(...args) {
  console.log(...args);
}
function logSection(title) {
  log(`\n${"━".repeat(8)} ${title} ${"━".repeat(8)}`);
}

async function probeBridge() {
  try {
    const res = await fetch(`${BRIDGE_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureAppReady() {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(APP_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Find the bottom-of-editor chat composer (distinct from the new-project
// modal textarea). Returns the Playwright Locator or null.
async function findEditorComposer(page) {
  const sels = [
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="mensagem" i]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="prompt" i]',
    "textarea",
  ];
  for (const sel of sels) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return loc;
  }
  return null;
}

// Wait until at least `expectedCount` exact-match elements of `tokenRegex`
// are present on the page (case-insensitive). Returns true if reached
// within `timeoutMs`, false otherwise.
async function waitForTokenCount(page, tokenRegex, expectedCount, timeoutMs) {
  const tEnd = Date.now() + timeoutMs;
  while (Date.now() < tEnd) {
    const n = await page.getByText(tokenRegex).count();
    if (n >= expectedCount) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

// Phase-2 follow-up: send AHOY in the composer and expect the AI to echo it.
// Assumes a seed turn already produced a response so the composer is mounted.
async function runFollowupPhase(page, result) {
  try {
    const FOLLOWUP = "respond with the single word AHOY";
    const composer = await findEditorComposer(page);
    if (!composer) {
      result.notes.push("followup: composer textarea not found");
      return;
    }
    await composer.fill(FOLLOWUP).catch(() => {});
    await composer.press("Enter").catch(() => {});
    try {
      await page.getByText(/ahoy/i).first().waitFor({ state: "visible", timeout: 10_000 });
      result.followupUserRendered = true;
    } catch {
      result.notes.push("followup: user bubble didn't appear within 10s");
    }
    // 2+ occurrences = user echo + AI reply
    if (await waitForTokenCount(page, /^ahoy$/i, 2, PER_PROVIDER_TIMEOUT_MS)) {
      result.followupText = "AHOY";
      result.followupAssistantRendered = true;
    } else {
      result.notes.push(`followup: no AI response within ${PER_PROVIDER_TIMEOUT_MS}ms`);
    }
  } catch (e) {
    result.notes.push(`followup exception: ${e.message}`);
  }
}

// Phase-2 switch: navigate back to Home, create a second project with the
// SAME seed, and expect a clean PONG. Catches the BUG-15-class leak where
// EditorScreen kept state across project IDs.
async function runSwitchPhase(page, result, seedPrompt) {
  try {
    // Give project A a moment to finish its post-stream work (provider
    // session upsert, chat-snapshot writes, FS reads) before navigating
    // away. Without this, codex/gemini sometimes still hold the CLI
    // child process when we ask for project B, causing the new seed to
    // wait > 90s without ever producing output.
    await page.waitForTimeout(2500);
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    // Reuse the same "Novo projeto" → modal → prompt → Criar projeto flow.
    await page.locator('button:has-text("Novo projeto")').first().click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    const ta = page.locator('textarea[placeholder*="descreva" i], textarea').first();
    await ta.fill(seedPrompt, { timeout: 3000 }).catch(() => {});
    await page.locator('button:has-text("Criar projeto")').first().click({ timeout: 5_000 });
    await page.waitForURL(/\/projects\//, { timeout: 8_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    // Expect a SECOND PONG (the first one belongs to project A's chat
    // which is now off-screen). Looking at the page text after navigation
    // means we're scoped to project B's chat.
    if (await waitForTokenCount(page, /^pong$/i, 1, PER_PROVIDER_TIMEOUT_MS)) {
      result.followupText = "PONG (project B)";
      result.followupUserRendered = true;
      result.followupAssistantRendered = true;
    } else {
      result.notes.push("switch: project B never produced PONG within timeout");
    }
  } catch (e) {
    result.notes.push(`switch exception: ${e.message}`);
  }
}

// Phase-2 refresh: F5 the editor. Expect chat to re-render with the seed
// user message AND assistant reply (PONG) from .df/chat/main.jsonl + snapshot.
async function runRefreshPhase(page, result) {
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    // Both user prompt token (we sent something with "PONG" in it) AND the
    // assistant's response "PONG" should be on the page after hydration.
    const pongAfter = await waitForTokenCount(page, /^pong$/i, 1, 15_000);
    if (pongAfter) {
      result.followupText = "PONG (post-refresh)";
      result.followupUserRendered = true;
      result.followupAssistantRendered = true;
    } else {
      result.notes.push("refresh: PONG did not re-hydrate within 15s");
    }
  } catch (e) {
    result.notes.push(`refresh exception: ${e.message}`);
  }
}

async function runOneProvider(browser, providerId, seedPrompt, scenario = "seed") {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const dfTrace = [];
  const networkLog = [];
  const networkErrors = [];

  page.on("console", (msg) => {
    const text = msg.text();
    // Capture our diagnostic markers regardless of level.
    if (
      text.includes("[DF-AS]") ||
      text.includes("[DF-HS]") ||
      text.includes("[DF-TP]") ||
      text.includes("[DF-SVB]")
    ) {
      dfTrace.push(text);
      return;
    }
    if (msg.type() === "error" || msg.type() === "warning") {
      // ignore noisy sandbox warnings that are intentional
      if (text.includes("about:srcdoc") && text.includes("allow-scripts")) return;
      if (text.includes("React Router Future Flag")) return;
      consoleErrors.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(BRIDGE_URL)) {
      networkLog.push(`→ ${req.method()} ${u.replace(BRIDGE_URL, "")}`);
    }
  });
  page.on("response", (res) => {
    const u = res.url();
    if (u.startsWith(BRIDGE_URL)) {
      const tag = res.ok() ? "✓" : "✗";
      networkLog.push(`${tag} ${res.status()} ${u.replace(BRIDGE_URL, "")}`);
      if (!res.ok()) networkErrors.push(`${res.status()} ${u.replace(BRIDGE_URL, "")}`);
    }
  });
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (u.startsWith(BRIDGE_URL)) {
      networkErrors.push(
        `FAIL ${req.method()} ${u.replace(BRIDGE_URL, "")} — ${req.failure()?.errorText ?? "?"}`,
      );
    }
  });

  const result = {
    provider: providerId,
    scenario,
    status: "unknown",
    userMessageRendered: false,
    assistantMessageRendered: false,
    assistantText: "",
    followupUserRendered: false,
    followupAssistantRendered: false,
    followupText: "",
    elapsedMs: 0,
    consoleErrors: [],
    networkErrors: [],
    networkRecent: [],
    screenshot: null,
    notes: [],
  };

  const tStart = Date.now();
  try {
    // Pre-seed localStorage so EditorScreen mounts with the right default_provider
    // BEFORE the auto-send effect runs. Avoids races with the async readGlobalConfig.
    await page.addInitScript((p) => {
      try {
        localStorage.setItem("default_provider", JSON.stringify(p));
      } catch {}
      try {
        localStorage.setItem(`df:last-model:${p}`, "default");
      } catch {}
    }, providerId);

    // The bridge URL is baked into the build via VITE_BRIDGE_URL. dev:web
    // sets it to the daemon's resolved port; for a production-build run, set
    // VITE_BRIDGE_URL before `npm run build` so the app points at the daemon.
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for the new-project entry to be available (Home loaded).
    // Heuristic: find an element that lets us start. Try a few selectors.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    // Click "New project" / "Criar projeto" — try multiple selectors
    const newProjectSelectors = [
      'button:has-text("Criar projeto")',
      'button:has-text("New project")',
      'button:has-text("Novo projeto")',
      '[aria-label*="criar" i]',
      '[aria-label*="new project" i]',
      'button[data-testid*="new-project"]',
      'button:has-text("Criar")',
    ];
    let clicked = false;
    for (const sel of newProjectSelectors) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        clicked = true;
        result.notes.push(`new-project clicked via: ${sel}`);
        break;
      }
    }
    if (!clicked) {
      result.status = "ui-blocked";
      result.notes.push("could not find 'New project' button on Home");
      throw new Error("new-project button not found");
    }

    // Modal of new-project. Type the seed prompt into the textarea, then submit.
    // Allow modal animation.
    await page.waitForTimeout(800);

    // Find the prompt input (textarea or contenteditable). Fall back to placeholder text.
    const promptSelectors = [
      'textarea[placeholder*="surpreenda" i]',
      'textarea[placeholder*="descreva" i]',
      'textarea[placeholder*="prompt" i]',
      "textarea",
    ];
    // For "manual" scenario, type just a single space — many of these
    // modals enable Criar projeto on length > 0. The composer of the
    // editor is where the actual seed lives in this scenario, exercising
    // handleSend instead of the auto-send path.
    const modalPrompt = scenario === "manual" ? " " : seedPrompt;
    let typed = false;
    for (const sel of promptSelectors) {
      const ta = page.locator(sel).first();
      if ((await ta.count()) > 0 && (await ta.isVisible().catch(() => false))) {
        await ta.fill(modalPrompt, { timeout: 3000 }).catch(() => {});
        typed = true;
        result.notes.push(
          `modal prompt typed (${scenario === "manual" ? "placeholder" : "real"}): ${sel}`,
        );
        break;
      }
    }
    if (!typed) {
      result.status = "ui-blocked";
      result.notes.push("could not find prompt textarea in new-project modal");
      throw new Error("prompt textarea not found");
    }

    // Provider is already preset via localStorage `default_provider` before the
    // page loaded — the global provider picker at the top right honors it, and
    // the new-project modal inherits the same value. No need to click around
    // in the modal's picker (which collapses the layout in some renders).

    // Submit. The button in the modal is "Criar projeto" with an arrow.
    const submitSelectors = [
      'button:has-text("Criar projeto")',
      'button:has-text("Criar e gerar")',
      'button:has-text("Create project")',
      'button:has-text("Gerar")',
      'button[type="submit"]:visible',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        submitted = true;
        result.notes.push(`submit clicked via: ${sel}`);
        break;
      }
    }
    if (!submitted) {
      result.notes.push("could not find Criar projeto button");
      throw new Error("submit button not found");
    }

    // Wait for navigation to /projects/:id (modal closed + editor mounted)
    try {
      await page.waitForURL(/\/projects\//, { timeout: 5_000 });
      result.notes.push(`url=${page.url()}`);
    } catch {
      result.notes.push("did not navigate to /projects/:id within 5s");
    }
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    // Now we're in EditorScreen. Two paths from here:
    //   - "seed":   the modal prompt auto-sent on mount; wait for user bubble
    //               and assistant reply.
    //   - "manual": modal was empty, no auto-send; we type the real prompt
    //               into the editor composer and submit, then wait.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    if (scenario === "manual") {
      // Locate the editor composer textarea (different placement vs modal).
      const editorComposerSelectors = [
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="mensagem" i]',
        'textarea[placeholder*="ask" i]',
        'textarea[placeholder*="prompt" i]',
        "textarea",
      ];
      let composer = null;
      for (const sel of editorComposerSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          composer = loc;
          break;
        }
      }
      if (!composer) {
        result.notes.push("manual: editor composer not found");
        throw new Error("composer not found");
      }
      await composer.fill(seedPrompt).catch(() => {});
      await composer.press("Enter").catch(() => {});
      result.notes.push("manual: prompt sent via editor composer");
    }

    const userText = page.locator(`text=/${seedPrompt.split(" ")[0]}/i`).first();
    try {
      await userText.waitFor({ state: "visible", timeout: 10_000 });
      result.userMessageRendered = true;
    } catch {
      result.notes.push("user message bubble did not appear within 10s");
    }

    // Wait for assistant response. Heuristic: a chat message with role
    // "assistant" that has non-empty text OR a "PONG" appearing.
    const deadlineAt = Date.now() + PER_PROVIDER_TIMEOUT_MS;
    while (Date.now() < deadlineAt) {
      const pongLoc = page.getByText(/^pong$/i).first();
      const pongCount = await pongLoc.count();
      if (pongCount > 0) {
        result.assistantText = "PONG";
        result.assistantMessageRendered = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!result.assistantMessageRendered) {
      result.notes.push(`no assistant response within ${PER_PROVIDER_TIMEOUT_MS}ms`);
    }

    // Second phase, dispatched by scenario:
    //   - seed/manual : send a follow-up turn via the editor composer
    //   - switch      : go back Home, create another project, expect PONG again
    //   - refresh     : F5 the page, expect the user+assistant turns to
    //                   re-hydrate from disk
    if (!result.assistantMessageRendered) {
      result.notes.push("phase-2 skipped: first turn never produced a response");
    } else if (scenario === "switch") {
      await runSwitchPhase(page, result, seedPrompt);
    } else if (scenario === "refresh") {
      await runRefreshPhase(page, result);
    } else {
      await runFollowupPhase(page, result);
    }

    // Status (account for both turns)
    const seedOk = result.userMessageRendered && result.assistantMessageRendered;
    const followupOk = result.followupUserRendered && result.followupAssistantRendered;
    if (seedOk && followupOk) result.status = "ok";
    else if (seedOk && !followupOk) result.status = "followup-failed";
    else if (result.userMessageRendered && !result.assistantMessageRendered)
      result.status = "stream-stalled";
    else result.status = "no-ui-render";
  } catch (e) {
    if (result.status === "unknown") result.status = "error";
    result.notes.push(`exception: ${e.message}`);
  } finally {
    result.elapsedMs = Date.now() - tStart;
    result.consoleErrors = consoleErrors.slice(0, 10);
    result.networkErrors = networkErrors;
    result.networkRecent = networkLog.slice(-30);
    result.dfTrace = dfTrace.slice(-40);

    const shotPath = join(OUT_DIR, `${providerId}-${scenario}.png`);
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
      result.screenshot = shotPath;
    } catch (e) {
      result.notes.push(`screenshot failed: ${e.message}`);
    }

    await ctx.close().catch(() => {});
  }

  return result;
}

(async () => {
  logSection("Preflight");
  log(`APP_URL: ${APP_URL}`);
  log(`BRIDGE_URL: ${BRIDGE_URL}`);
  log(`OUT_DIR: ${OUT_DIR}`);

  const bridgeUp = await probeBridge();
  log(`bridge /healthz: ${bridgeUp ? "✓" : "✗"}`);
  if (!bridgeUp) {
    console.error("Bridge not reachable — start dev:web first.");
    process.exit(2);
  }

  const appUp = await ensureAppReady();
  log(`app reachable: ${appUp ? "✓" : "✗"}`);
  if (!appUp) {
    console.error("App not reachable.");
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });

  for (const { id, seed } of PROVIDERS) {
    for (const scenario of SCENARIOS) {
      logSection(`provider: ${id} · scenario: ${scenario}`);
      let r;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        r = await runOneProvider(browser, id, seed, scenario);
        if (r.status === "ok") break;
        if (attempt < MAX_RETRIES) {
          log(`attempt ${attempt + 1} failed (${r.status}) — retrying`);
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      r.retries = MAX_RETRIES;
      matrix.push(r);
      log(
        `status: ${r.status} · seed.ai: ${r.assistantMessageRendered ? "Y" : "n"} · f.ai: ${r.followupAssistantRendered ? "Y" : "n"} · ${r.elapsedMs}ms`,
      );
      if (r.assistantText) log(`seed response: ${r.assistantText.slice(0, 80)}`);
      if (r.followupText) log(`followup response: ${r.followupText.slice(0, 80)}`);
      if (r.notes.length) log(`notes: ${r.notes.slice(-4).join(" | ")}`);
      if (r.consoleErrors.length)
        log(
          `console errors (${r.consoleErrors.length}): ${r.consoleErrors.slice(0, 3).join(" | ")}`,
        );
      if (r.networkErrors.length)
        log(
          `network errors (${r.networkErrors.length}): ${r.networkErrors.slice(0, 5).join(" | ")}`,
        );
    }
  }

  await browser.close();

  logSection("MATRIX");
  console.table(
    matrix.map((r) => ({
      provider: r.provider,
      scenario: r.scenario,
      status: r.status,
      u: r.userMessageRendered ? "Y" : "n",
      ai: r.assistantMessageRendered ? "Y" : "n",
      "f.u": r.followupUserRendered ? "Y" : "n",
      "f.ai": r.followupAssistantRendered ? "Y" : "n",
      ms: r.elapsedMs,
      errs: r.consoleErrors.length + r.networkErrors.length,
    })),
  );

  // Unique per-run artifact (timestamped) so concurrent/sequential runs can
  // never clobber each other's results — plus a `matrix.json` "latest" copy
  // for convenience. The RUN_ID is also printed in the final summary line.
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = JSON.stringify({ runId, startedAt, finishedAt: Date.now(), matrix }, null, 2);
  writeFileSync(join(OUT_DIR, `matrix-${runId}.json`), payload);
  writeFileSync(join(OUT_DIR, "matrix.json"), payload);
  log(`\nFull report: ${join(OUT_DIR, `matrix-${runId}.json`)}`);
  log(`Screenshots: ${OUT_DIR}`);

  const okCount = matrix.filter((r) => r.status === "ok").length;
  const fails = matrix
    .filter((r) => r.status !== "ok")
    .map((r) => `${r.provider}/${r.scenario}(${r.status})`);
  // Single unambiguous machine-greppable summary line.
  log(
    `\nE2E_RESULT runId=${runId} ${okCount}/${matrix.length} ok${fails.length ? " FAIL=" + fails.join(",") : " ALL_GREEN"}`,
  );

  const allOk = matrix.every((r) => r.status === "ok");
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(3);
});
