#!/usr/bin/env node
// e2e-leak-regression.mjs — regression check for BUG-15: when two projects
// share a base name, EditorScreen used to keep the prior project's iframeHtml
// in useState because the URL change wasn't a remount. The next turn then
// shipped the leaked HTML into the system prompt and the model would rewrite
// "the same project" the user thought they had abandoned.
//
// This script creates two projects in sequence with the same base name, sends
// distinguishing prompts in each, and asserts that the second project's
// response does NOT echo content from the first one.
//
// Pre: dev:web on :1427, claude CLI installed and authenticated.
// Run:  npm run test:e2e:leak-regression

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", ".df", "e2e");
const APP_URL = process.env.DF_APP_URL || "http://127.0.0.1:1427";
const BRIDGE_URL = process.env.DF_BRIDGE_URL || "http://127.0.0.1:1433";
const PROVIDER = process.env.DF_LEAK_PROVIDER || "claude";
const TURN_TIMEOUT_MS = Number(process.env.DF_E2E_TURN_TIMEOUT_MS || 90_000);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const NAME = "leakcheck"; // both projects use this
const PROMPT_A = "Reply with exactly ALPHA and nothing else.";
const PROMPT_B = "Reply with exactly BETA and nothing else.";
const TOKEN_A = "ALPHA";
const TOKEN_B = "BETA";

function log(...args) {
  console.log(...args);
}
function logSection(t) {
  log(`\n${"━".repeat(8)} ${t} ${"━".repeat(8)}`);
}

async function createProjectWithSeed(page, name, seed) {
  // Home → New project → fill name + seed → submit. Returns project URL.
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  await page.locator('button:has-text("Novo projeto")').first().click({ timeout: 5000 });
  await page.waitForTimeout(500);

  // Name field (modal has a name input above the prompt textarea on some
  // layouts; absent on others). Try a few locators.
  const nameInput = page
    .locator('input[placeholder*="nome" i], input[placeholder*="name" i]')
    .first();
  if ((await nameInput.count()) > 0 && (await nameInput.isVisible().catch(() => false))) {
    await nameInput.fill(name).catch(() => {});
  }

  const promptInput = page
    .locator('textarea[placeholder*="descreva" i], textarea[placeholder*="prompt" i], textarea')
    .first();
  await promptInput.fill(seed, { timeout: 3000 });

  await page.locator('button:has-text("Criar projeto")').first().click({ timeout: 5000 });
  await page.waitForURL(/\/projects\//, { timeout: 8000 });
  return page.url();
}

async function waitForResponseContaining(page, token, deadlineMs) {
  const tEnd = Date.now() + deadlineMs;
  while (Date.now() < tEnd) {
    // case-insensitive search anywhere on the page
    const count = await page.getByText(new RegExp(token, "i")).count();
    if (count > 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function visibleChatText(page) {
  // Grab the chat panel's text. Heuristic: find the largest scrollable
  // container whose text mentions our prompt or token. For a robust read,
  // just innerText of the body is enough — the chat is the dominant content.
  try {
    return (await page.locator("body").innerText({ timeout: 2000 })) ?? "";
  } catch {
    return "";
  }
}

(async () => {
  logSection("Preflight");
  log(`APP_URL: ${APP_URL}`);
  log(`BRIDGE_URL: ${BRIDGE_URL}`);
  log(`provider: ${PROVIDER}`);

  // Preflight: bridge + app reachable
  try {
    const r = await fetch(`${BRIDGE_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`bridge healthz ${r.status}`);
  } catch (e) {
    console.error("Bridge down:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // Seed provider preference before any page mount
  await ctx.addInitScript((p) => {
    try {
      localStorage.setItem("default_provider", JSON.stringify(p));
    } catch {}
  }, PROVIDER);

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (t.includes("about:srcdoc") || t.includes("React Router Future Flag")) return;
      consoleErrors.push(t);
    }
  });

  const result = {
    provider: PROVIDER,
    project1Url: null,
    project1Response: null,
    project2Url: null,
    project2Response: null,
    leakDetected: null,
    pass: false,
    notes: [],
  };

  try {
    // ─── Project 1 ──────────────────────────────────────────────────────
    logSection("Project 1 (ALPHA)");
    result.project1Url = await createProjectWithSeed(page, NAME, PROMPT_A);
    log(`url: ${result.project1Url}`);

    const gotA = await waitForResponseContaining(page, TOKEN_A, TURN_TIMEOUT_MS);
    if (!gotA) {
      result.notes.push(`project 1 never produced ${TOKEN_A}`);
      throw new Error("project 1 seed did not complete");
    }
    const p1Text = await visibleChatText(page);
    result.project1Response = TOKEN_A;
    log(`project 1 responded with ${TOKEN_A} ✓`);

    // ─── Project 2 (same name) ──────────────────────────────────────────
    logSection("Project 2 (BETA, same name)");
    result.project2Url = await createProjectWithSeed(page, NAME, PROMPT_B);
    log(`url: ${result.project2Url}`);

    if (result.project1Url && result.project2Url && result.project1Url === result.project2Url) {
      result.notes.push("project URLs are identical — slug collision");
      throw new Error("project urls collide — slug logic broken");
    }

    const gotB = await waitForResponseContaining(page, TOKEN_B, TURN_TIMEOUT_MS);
    if (!gotB) {
      result.notes.push(`project 2 never produced ${TOKEN_B}`);
      throw new Error("project 2 seed did not complete");
    }
    result.project2Response = TOKEN_B;
    log(`project 2 responded with ${TOKEN_B} ✓`);

    // ─── Leak assertion ─────────────────────────────────────────────────
    // The chat panel of project 2 must NOT contain ALPHA (the prior
    // project's token). Strict check: case-sensitive ALPHA in the visible
    // chat area.
    const p2Text = await visibleChatText(page);
    const leaked = p2Text.includes(TOKEN_A);
    result.leakDetected = leaked;
    if (leaked) {
      result.notes.push(`leak: project 2 contains ${TOKEN_A} from project 1`);
    }
    result.pass = !leaked;
  } catch (e) {
    result.notes.push(`exception: ${e.message}`);
    result.pass = false;
  } finally {
    try {
      await page.screenshot({ path: join(OUT_DIR, "leak-regression.png"), fullPage: true });
    } catch {}
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  logSection("Result");
  console.log(JSON.stringify({ ...result, consoleErrors }, null, 2));
  writeFileSync(
    join(OUT_DIR, "leak-regression.json"),
    JSON.stringify({ ts: Date.now(), ...result, consoleErrors }, null, 2),
  );

  process.exit(result.pass ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(3);
});
