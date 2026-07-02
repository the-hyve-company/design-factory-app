#!/usr/bin/env node
// public-files-smoke.mjs — OSS/IP readiness gate.
//
// Extends the original "public files exist" smoke into the IP-leak gate
// that CI runs on every push/PR (npm run smoke:public-files):
//
//   1. Public governance files exist and license metadata is coherent.
//   2. Every bundled skill folder carries its own LICENSE and/or NOTICE.md.
//   3. The root NOTICE index and the skills/ directory agree (both ways).
//   4. design-systems/ ships empty — bundled third-party design systems
//      were removed for IP safety (#101) and must not silently return.
//   5. No secret-shaped strings in tracked text files (API keys, tokens,
//      private key blocks).
//   6. No copyleft licenses in the resolved dependency tree (scanned from
//      node_modules when present, i.e. always in CI after `npm ci`).
//
// Every check is exported for unit tests (scripts/public-files-smoke.test.mjs).

import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ─── 1. Public governance files ────────────────────────────────────────────

export function checkPublicFiles(root) {
  const failures = [];
  const read = (p) => readFileSync(join(root, p), "utf8");
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  try {
    const pkg = JSON.parse(read("package.json"));
    assert(pkg.license === "Apache-2.0", 'package.json license must be "Apache-2.0"');
  } catch {
    failures.push("package.json must exist and parse");
  }
  try {
    const lock = JSON.parse(read("package-lock.json"));
    assert(
      lock.packages?.[""]?.license === "Apache-2.0",
      'package-lock.json root license must be "Apache-2.0"',
    );
  } catch {
    failures.push("package-lock.json must exist and parse");
  }
  try {
    assert(read("LICENSE").includes("Apache License"), "LICENSE must contain Apache License text");
  } catch {
    failures.push("LICENSE must exist");
  }
  for (const f of [
    "NOTICE",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "GOVERNANCE.md",
    "SUPPORT.md",
    "PRIVACY.md",
  ]) {
    assert(existsSync(join(root, f)), `${f} must exist`);
  }
  assert(existsSync(join(root, "docs", "README.md")), "docs/README.md must exist");
  return failures;
}

// ─── 2. Per-skill license / provenance files ───────────────────────────────

const SKILL_LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE.md"];

export function listSkillDirs(root) {
  const skillsRoot = join(root, "skills");
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

export function checkSkillLicenses(root) {
  const failures = [];
  for (const dir of listSkillDirs(root)) {
    const base = join(root, "skills", dir);
    if (!existsSync(join(base, "SKILL.md"))) {
      failures.push(`skills/${dir}/ must contain SKILL.md`);
    }
    const hasLicenseFile = SKILL_LICENSE_FILES.some((f) => existsSync(join(base, f)));
    if (!hasLicenseFile) {
      failures.push(
        `skills/${dir}/ must carry a LICENSE (upstream license, preserved) ` +
          `and/or NOTICE.md (provenance record) — see NOTICE § Third-party bundled skills`,
      );
    }
  }
  return failures;
}

// ─── 3. NOTICE ↔ disk parity ───────────────────────────────────────────────

export function checkNoticeParity(root) {
  const failures = [];
  let notice = "";
  try {
    notice = readFileSync(join(root, "NOTICE"), "utf8");
  } catch {
    return ["NOTICE must exist for skill attribution parity"];
  }
  const onDisk = listSkillDirs(root);
  // Every skill on disk must be indexed in NOTICE.
  for (const dir of onDisk) {
    if (!notice.includes(`skills/${dir}/`)) {
      failures.push(`NOTICE must index the bundled skill skills/${dir}/`);
    }
  }
  // Every skill folder NOTICE references must exist on disk.
  const referenced = new Set([...notice.matchAll(/skills\/([A-Za-z0-9._-]+)\//g)].map((m) => m[1]));
  for (const slug of referenced) {
    if (!existsSync(join(root, "skills", slug))) {
      failures.push(`NOTICE references skills/${slug}/ which does not exist on disk`);
    }
  }
  return failures;
}

// ─── 4. design-systems/ ships empty (IP decision #101) ─────────────────────

const DESIGN_SYSTEMS_ALLOWED = new Set(["README.md", ".gitkeep"]);

export function checkDesignSystemsEmpty(root) {
  const dsRoot = join(root, "design-systems");
  if (!existsSync(dsRoot)) return []; // absent == empty == OK
  const extras = readdirSync(dsRoot).filter((name) => !DESIGN_SYSTEMS_ALLOWED.has(name));
  if (extras.length === 0) return [];
  return [
    `design-systems/ must ship empty (bundled design systems were removed for IP safety); found: ${extras.join(", ")}`,
  ];
}

// ─── 5. Secret scan over tracked text files ────────────────────────────────

// Built via RegExp constructors so the patterns never match their own source.
export const SECRET_PATTERNS = [
  { name: "OpenAI-style key (sk-...)", re: new RegExp("\\bsk-[A-Za-z0-9_-]{20,}\\b") },
  { name: "GitHub token (ghp_...)", re: new RegExp("\\bghp_[A-Za-z0-9]{36}\\b") },
  { name: "GitHub fine-grained PAT", re: new RegExp("\\bgithub_pat_[A-Za-z0-9_]{22,}\\b") },
  { name: "AWS access key (AKIA...)", re: new RegExp("\\bAKIA[0-9A-Z]{16}\\b") },
  {
    name: "Private key block (PEM)",
    re: new RegExp("-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"),
  },
];

const SECRET_SCAN_SKIP = new Set(["package-lock.json"]);
const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "svg",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "pdf",
  "zip",
  "mp4",
  "mp3",
]);

export function listTrackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return out.toString("utf8").split("\0").filter(Boolean);
}

export function checkSecrets(root, files = null) {
  const failures = [];
  const candidates = (files ?? listTrackedFiles(root)).filter((f) => {
    if (SECRET_SCAN_SKIP.has(f) || f.endsWith(".lock")) return false;
    const ext = f.split(".").pop()?.toLowerCase() ?? "";
    return !BINARY_EXT.has(ext);
  });
  for (const file of candidates) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) {
        failures.push(`possible secret in ${file}: ${name}`);
      }
    }
  }
  return failures;
}

// ─── 6. Copyleft dependency scan ───────────────────────────────────────────

// Matches the policy stated in NOTICE § Third-party software.
export const COPYLEFT_RE = /(^|[^A-Za-z])(AGPL|LGPL|GPL|SSPL|EUPL)(?![A-Za-z])/i;

export function checkCopyleftDeps(root) {
  const failures = [];
  let nmRoot = join(root, "node_modules");
  if (!existsSync(nmRoot)) {
    // Outside CI a checkout may not be installed; the CI job always runs
    // after `npm ci`, so the scan is enforced where it matters.
    console.warn("copyleft scan: node_modules not found — skipped (CI runs it after npm ci)");
    return failures;
  }
  try {
    nmRoot = realpathSync(nmRoot); // follow worktree symlinks
  } catch {
    return failures;
  }
  const readLicense = (pkgPath) => {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const lic =
        typeof pkg.license === "string"
          ? pkg.license
          : (pkg.license?.type ??
            (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l?.type).join(" OR ") : ""));
      return { name: pkg.name ?? pkgPath, license: String(lic ?? "") };
    } catch {
      return null;
    }
  };
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.name.startsWith("@") && depth === 0) {
        visit(full, depth + 1);
        continue;
      }
      const info = readLicense(join(full, "package.json"));
      if (info && COPYLEFT_RE.test(info.license)) {
        failures.push(`copyleft dependency: ${info.name} (${info.license})`);
      }
    }
  };
  visit(nmRoot, 0);
  return failures;
}

// ─── Orchestration ─────────────────────────────────────────────────────────

export function runAllChecks(root) {
  return [
    ...checkPublicFiles(root),
    ...checkSkillLicenses(root),
    ...checkNoticeParity(root),
    ...checkDesignSystemsEmpty(root),
    ...checkSecrets(root),
    ...checkCopyleftDeps(root),
  ];
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const root = process.cwd();
  const failures = runAllChecks(root);
  if (failures.length) {
    console.error("public-files / IP gate: FAIL");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("public-files / IP gate: PASS");
}
