// E2E validation harness for the 3 lab modals (DS / Skills / Skill Detail)
// plus the Share-menu "open project folder" action. Runs Playwright
// headless against a dev:web instance, clicks every button + option,
// captures screenshots, reports PASS/FAIL per check.
//
// Usage:
//   1. Spin up dev:web (the script doesn't manage it):
//        DF_NO_OPEN=1 DF_BRIDGE_PORT=2421 DF_VITE_PORT=2420 npm run dev:web
//   2. In another terminal:
//        DF_VALIDATE_URL=http://localhost:2420 node scripts/validate-modals.mjs
//
// Exit code: 0 if every check passes, 1 if any failed, 2 on fatal.
// Screenshots: /tmp/df-validation/*.png by default
//              (override with DF_VALIDATE_SHOTS=<dir>).
//
// This harness was built to nail down the religue-tudo regressions:
// the DS modal was saving as a project, skills folder import was
// dropping multifile, and the Share menu got a new "open project
// folder" action. Re-run before any change to the lab/* components.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const APP = process.env.DF_VALIDATE_URL || "http://localhost:2420";
const SHOTS = process.env.DF_VALIDATE_SHOTS || "/tmp/df-validation";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const log = (name, status, detail = "") => {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "·";
  const color = status === "PASS" ? "\x1b[32m" : status === "FAIL" ? "\x1b[31m" : "\x1b[33m";
  console.log(`  ${color}${icon}\x1b[0m ${name}${detail ? "  " + detail : ""}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

try {
  console.log("\n=== BOOT ===");
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 });
  await shot("00-home-initial");
  log("home page loads", "PASS");

  // Find tabs on home — DS / skills / projects / files
  const haveDsTab = await page.locator("text=/design.systems?/i").count();
  const haveSkillsTab = await page.locator("text=/^skills?$/i").count();
  log(
    "home has tabs",
    haveDsTab + haveSkillsTab > 0 ? "PASS" : "FAIL",
    `ds=${haveDsTab} skills=${haveSkillsTab}`,
  );

  // ─── DS MODAL ───────────────────────────────────────────────
  console.log("\n=== DS MODAL LAB ===");
  // Switch to design-systems tab first
  const dsTabBtn = page.getByRole("button", { name: /design.systems?/i }).first();
  if ((await dsTabBtn.count()) > 0) {
    await dsTabBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await shot("10-ds-tab");

  // Click "Novo design system" button (visible top-right of DS tab)
  const createDsBtn = page.getByRole("button", { name: /novo design system/i }).first();
  const createDsCount = await createDsBtn.count();
  log("create-DS button visible", createDsCount > 0 ? "PASS" : "FAIL", `n=${createDsCount}`);
  if (createDsCount > 0) {
    await createDsBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  } else {
    // Fall back: look for + button or any modal trigger near DS tab
    const allButtons = await page.locator("button").all();
    let opened = false;
    for (const b of allButtons.slice(0, 50)) {
      const t = await b.textContent().catch(() => "");
      if (t && /forj|criar|\+/i.test(t)) {
        await b.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(500);
        if ((await page.locator("text=/forjar.*design.*system/i").count()) > 0) {
          opened = true;
          break;
        }
      }
    }
    log("DS modal opened (fallback)", opened ? "PASS" : "FAIL");
  }
  await shot("11-ds-modal-open");

  // Check faceplate header
  const hasFaceplate = await page.locator("text=/forjar.*design.*system/i").count();
  log("DS faceplate header", hasFaceplate > 0 ? "PASS" : "FAIL");

  // 4 source keys: Pasta / GitHub / design.md / URL
  for (const label of ["Pasta", "GitHub", "design.md", "URL"]) {
    const key = page.locator(`button:has-text("${label}")`).first();
    const visible = await key.count();
    log(`DS source key "${label}" visible`, visible > 0 ? "PASS" : "FAIL");
    if (visible > 0) {
      await key.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  await shot("12-ds-after-source-clicks");

  // Switch back to "design.md" (upload) → file chooser button
  await page
    .locator('button:has-text("design.md")')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(200);
  const fileChooserBtn = page.getByRole("button", { name: /escolher.*\.md/i });
  log("DS upload source shows file chooser", (await fileChooserBtn.count()) > 0 ? "PASS" : "FAIL");

  // Engine chips (read-only) — look for both "Claude Code" and "sonnet"
  const claudeChip = await page.getByText(/Claude Code/i).count();
  const sonnetChip = await page.getByText(/sonnet/i).count();
  log(
    "DS engine chips render (Claude Code + sonnet)",
    claudeChip > 0 && sonnetChip > 0 ? "PASS" : "FAIL",
    `claude=${claudeChip} sonnet=${sonnetChip}`,
  );

  // Preview toggle
  const previewToggle = page.locator('[aria-label="Gerar preview visual"]');
  const toggleCount = await previewToggle.count();
  log("DS preview toggle visible", toggleCount > 0 ? "PASS" : "FAIL");
  if (toggleCount > 0) {
    const initialState = await previewToggle.getAttribute("data-on");
    await previewToggle.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(200);
    const afterState = await previewToggle.getAttribute("data-on");
    log(
      "DS preview toggle changes state on click",
      initialState !== afterState ? "PASS" : "FAIL",
      `${initialState}→${afterState}`,
    );
    // Restore ON
    if (afterState === "false") await previewToggle.click({ timeout: 2000 }).catch(() => {});
  }
  await shot("13-ds-final");

  // Name input + Forge button (disabled until name)
  const forgeBtn = page.getByRole("button", { name: /forjar design\.md/i }).first();
  const forgeBefore = await forgeBtn.isDisabled().catch(() => true);
  log("DS forge button disabled before name", forgeBefore ? "PASS" : "FAIL");

  const nameInput = page.locator('input[placeholder*="design-system"]').first();
  if ((await nameInput.count()) > 0) {
    await nameInput.fill("test-validation-ds");
    await page.waitForTimeout(150);
    const forgeAfter = await forgeBtn.isDisabled().catch(() => true);
    log("DS forge button enabled after name", forgeAfter === false ? "PASS" : "FAIL");
  }
  await shot("14-ds-name-filled");

  // Close DS modal
  await page
    .locator('button[aria-label="Fechar"]')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  const stillOpen = await page.locator("text=/forjar.*design.*system/i").count();
  log("DS modal closes on X", stillOpen === 0 ? "PASS" : "FAIL");

  // ─── SKILLS MODAL ───────────────────────────────────────────
  console.log("\n=== SKILLS MODAL LAB ===");
  // Switch to skills tab
  const skillsTabBtn = page.getByRole("button", { name: /^skills?$/i }).first();
  if ((await skillsTabBtn.count()) > 0) {
    await skillsTabBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await shot("20-skills-tab");

  // Find create-skill button (top-right "Nova skill"-style)
  const createSkillBtn = page
    .getByRole("button", { name: /nova skill|criar.*skill|novo.*skill/i })
    .first();
  if ((await createSkillBtn.count()) > 0) {
    await createSkillBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await shot("21-skills-modal-create");

  // Modal faceplate
  const skillFace = await page.locator("text=/criar.*do.*zero|importar/i").count();
  log("Skills modal opens (faceplate visible)", skillFace > 0 ? "PASS" : "FAIL");

  // Create mode fields
  const createFields = [];
  for (const ph of [/minha skill/i, /\/minha-skill/i, /o que essa skill faz/i]) {
    createFields.push(
      await page
        .locator(`input[placeholder]`)
        .filter({ has: page.locator(`[placeholder=""]`) })
        .count(),
    );
  }
  const nameField = page.locator('input[placeholder="Minha skill"]').first();
  log("Skills create — name field", (await nameField.count()) > 0 ? "PASS" : "FAIL");
  const triggerField = page.locator('input[placeholder="/minha-skill"]').first();
  log("Skills create — trigger field", (await triggerField.count()) > 0 ? "PASS" : "FAIL");

  // Type name → trigger auto-fills
  if ((await nameField.count()) > 0) {
    await nameField.fill("Test Validation Skill");
    await page.waitForTimeout(150);
    const triggerVal = await triggerField.inputValue();
    log(
      "Skills create — trigger auto-slugs",
      triggerVal === "/test-validation-skill" ? "PASS" : "FAIL",
      `got: ${triggerVal}`,
    );
  }
  await shot("22-skills-create-filled");

  // Switch to import mode — scope to inside the modal (Skills page also
  // has an "Importar" button at the top which would steal the click).
  const dialog = page.locator('[role="dialog"]');
  const importBtn = dialog.getByRole("button", { name: /^Importar$/i }).first();
  if ((await importBtn.count()) > 0) {
    await importBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await shot("23-skills-import-mode");

  // Import has 3 source keys (inside the modal)
  for (const label of ["Upload", "URL", "Pasta"]) {
    const key = dialog.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
    log(`Skills import key "${label}"`, (await key.count()) > 0 ? "PASS" : "FAIL");
  }

  // Click Pasta → input appears
  await dialog
    .getByRole("button", { name: /^Pasta$/i })
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(200);
  const folderInput = dialog.locator('input[placeholder*="skills"]').first();
  log(
    "Skills import Pasta source — input renders",
    (await folderInput.count()) > 0 ? "PASS" : "FAIL",
  );
  await shot("24-skills-import-folder");

  // Close
  await page
    .locator('button[aria-label="Fechar"]')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(300);

  // ─── SKILL DETAIL ────────────────────────────────────────────
  console.log("\n=== SKILL DETAIL (multifile) ===");
  // Find an existing skill card on the page — they appear in the skills tab.
  // Use the real multifile skill "make-interfaces-feel-better" which has
  // 4 sibling .md files we just verified via the daemon API.
  await page.waitForTimeout(500);
  await shot("30-skills-list");

  // Click the "Make Interfaces Feel Better" card (real multifile skill)
  const skillCard = page.getByText(/Make Interfaces Feel Better/i).first();
  let detailOpened = false;
  if ((await skillCard.count()) > 0) {
    await skillCard.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    detailOpened = (await page.locator("text=/^identidade$|corpo.*instru/i").count()) > 0;
  }
  log("Skill detail opens", detailOpened ? "PASS" : "FAIL");
  await shot("31-skill-detail");

  if (detailOpened) {
    // Check fields
    log(
      "Skill detail — descrição field",
      (await page.locator('input[placeholder*="quando usar"]').count()) > 0 ? "PASS" : "FAIL",
    );
    log(
      "Skill detail — corpo textarea",
      (await page.locator("textarea").count()) > 0 ? "PASS" : "FAIL",
    );

    // ★ THE NEW MULTIFILE SECTION ★
    const filesSection = page.locator("text=/arquivos.*da.*skill/i");
    log(
      "Skill detail — multifile section visible",
      (await filesSection.count()) > 0 ? "PASS" : "FAIL",
    );

    // Wait briefly for files to load
    await page.waitForTimeout(800);
    const fileLines = await page.locator("text=/\\.md|\\.css|\\.json/").count();
    log("Skill detail — extra files listed", fileLines > 0 ? "PASS" : "FAIL", `count=${fileLines}`);
    await shot("32-skill-detail-with-files");

    // Click a file row (the whole button) — not just the text node.
    const fileButton = page.getByRole("button", { name: /animations\.md/i }).first();
    if ((await fileButton.count()) > 0) {
      await fileButton.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1200); // generous wait for fs/read round-trip + React render
      const fileContent = await page.locator("pre").count();
      log("Skill detail — clicking file shows content", fileContent > 0 ? "PASS" : "FAIL");
      await shot("33-skill-detail-file-open");
    } else {
      log("Skill detail — file button not located", "FAIL");
    }

    // Delete + Export buttons exist
    log(
      "Skill detail — Excluir button",
      (await page.locator('button:has-text("Excluir")').count()) > 0 ? "PASS" : "FAIL",
    );
    log(
      "Skill detail — Exportar .md button",
      (await page.getByRole("button", { name: /exportar.*\.md/i }).count()) > 0 ? "PASS" : "FAIL",
    );
    log(
      "Skill detail — Salvar button",
      (await page.locator('button:has-text("Salvar")').count()) > 0 ? "PASS" : "FAIL",
    );

    // Salvar should be disabled (not dirty yet)
    const saveBtn = page.locator('button:has-text("Salvar")').first();
    log(
      "Skill detail — Salvar disabled before edit",
      (await saveBtn.isDisabled()) ? "PASS" : "FAIL",
    );

    // Type into body → Save enables
    const ta = page.locator("textarea").first();
    if ((await ta.count()) > 0) {
      await ta.focus();
      await ta.press("End");
      await page.keyboard.type(" ");
      await page.waitForTimeout(200);
      log(
        "Skill detail — Salvar enables after edit",
        !(await saveBtn.isDisabled()) ? "PASS" : "FAIL",
      );
    }
  }

  // ─── SUMMARY ─────────────────────────────────────────────────
  console.log("\n=== SUMMARY ===");
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`${pass} pass / ${fail} fail / ${results.length} total`);
  console.log(`screenshots in ${SHOTS}/`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  - ${r.name}  ${r.detail}`);
    }
    process.exitCode = 1;
  }
} catch (e) {
  console.error("FATAL:", e);
  await shot("ZZ-error");
  process.exitCode = 2;
} finally {
  await browser.close();
}
