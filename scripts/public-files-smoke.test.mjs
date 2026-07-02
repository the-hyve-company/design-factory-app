// Tests for the OSS/IP gate itself (scripts/public-files-smoke.mjs).
// Each check is exercised against throwaway fixtures, and the full gate is
// run against the real repository — which must pass.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSkillLicenses,
  checkNoticeParity,
  checkDesignSystemsEmpty,
  checkSecrets,
  listSkillDirs,
  runAllChecks,
  SECRET_PATTERNS,
  COPYLEFT_RE,
} from "./public-files-smoke.mjs";

let fx;

function skill(root, slug, files) {
  const dir = join(root, "skills", slug);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

beforeAll(() => {
  fx = mkdtempSync(join(tmpdir(), "ip-gate-"));
});

afterAll(() => {
  rmSync(fx, { recursive: true, force: true });
});

describe("checkSkillLicenses", () => {
  it("passes a skill with SKILL.md + LICENSE, fails one without any license file", () => {
    const root = join(fx, "licenses");
    skill(root, "licensed", { "SKILL.md": "---\nname: a\n---\nbody", LICENSE: "MIT" });
    skill(root, "provenance-only", { "SKILL.md": "---\nname: b\n---\nbody", "NOTICE.md": "prov" });
    skill(root, "naked", { "SKILL.md": "---\nname: c\n---\nbody" });
    const failures = checkSkillLicenses(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("skills/naked/");
  });

  it("fails a skill folder without SKILL.md", () => {
    const root = join(fx, "no-manifest");
    skill(root, "empty-ish", { LICENSE: "MIT" });
    const failures = checkSkillLicenses(root);
    expect(failures.some((f) => f.includes("must contain SKILL.md"))).toBe(true);
  });

  it("lists skill dirs sorted and ignores dotdirs", () => {
    const root = join(fx, "listing");
    skill(root, "b-skill", { "SKILL.md": "x" });
    skill(root, "a-skill", { "SKILL.md": "x" });
    mkdirSync(join(root, "skills", ".hidden"), { recursive: true });
    expect(listSkillDirs(root)).toEqual(["a-skill", "b-skill"]);
  });
});

describe("checkNoticeParity", () => {
  it("fails when a disk skill is missing from NOTICE and when NOTICE references a ghost", () => {
    const root = join(fx, "parity");
    skill(root, "real-skill", { "SKILL.md": "x", LICENSE: "MIT" });
    writeFileSync(join(root, "NOTICE"), "bundled: skills/ghost-skill/ (MIT)\n");
    const failures = checkNoticeParity(root);
    expect(failures.some((f) => f.includes("skills/real-skill/"))).toBe(true);
    expect(failures.some((f) => f.includes("skills/ghost-skill/"))).toBe(true);
  });

  it("passes when NOTICE and disk agree", () => {
    const root = join(fx, "parity-ok");
    skill(root, "in-sync", { "SKILL.md": "x", LICENSE: "MIT" });
    writeFileSync(join(root, "NOTICE"), "in-sync (skills/in-sync/)\n  License preserved.\n");
    expect(checkNoticeParity(root)).toEqual([]);
  });
});

describe("checkDesignSystemsEmpty", () => {
  it("passes when design-systems/ is absent or placeholder-only", () => {
    const root = join(fx, "ds-ok");
    mkdirSync(root, { recursive: true });
    expect(checkDesignSystemsEmpty(root)).toEqual([]);
    mkdirSync(join(root, "design-systems"));
    writeFileSync(join(root, "design-systems", "README.md"), "ships empty");
    expect(checkDesignSystemsEmpty(root)).toEqual([]);
  });

  it("fails when a bundled design system reappears", () => {
    const root = join(fx, "ds-bad");
    mkdirSync(join(root, "design-systems", "some-brand"), { recursive: true });
    writeFileSync(join(root, "design-systems", "some-brand", "design.md"), "# brand");
    const failures = checkDesignSystemsEmpty(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("some-brand");
  });
});

describe("checkSecrets", () => {
  // Fixture secrets are assembled by concatenation so this test file never
  // contains a secret-shaped literal itself.
  const fakeOpenAi = "sk-" + "a1B2".repeat(6);
  const fakeAws = "AKIA" + "ABCDEFGH12345678";
  const fakePem = ["-----BEGIN RSA PRIVATE", "KEY-----"].join(" ");

  it("flags secret-shaped strings in scanned files", () => {
    const root = join(fx, "secrets");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "leaky.md"), `token: ${fakeOpenAi}\n${fakeAws}\n${fakePem}\n`);
    const failures = checkSecrets(root, ["leaky.md"]);
    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(failures.every((f) => f.includes("leaky.md"))).toBe(true);
  });

  it("skips lockfiles and binary extensions", () => {
    const root = join(fx, "secrets-skip");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package-lock.json"), fakeOpenAi);
    writeFileSync(join(root, "img.png"), fakeAws);
    expect(checkSecrets(root, ["package-lock.json", "img.png"])).toEqual([]);
  });

  it("does not flag ordinary prose or short sk- fragments", () => {
    const root = join(fx, "secrets-clean");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "clean.md"), "use sk-tokens responsibly; AKIA is an AWS prefix\n");
    expect(checkSecrets(root, ["clean.md"])).toEqual([]);
  });

  it("pattern table covers the canonical families", () => {
    const names = SECRET_PATTERNS.map((p) => p.name).join(" | ");
    for (const family of ["sk-", "ghp_", "PAT", "AKIA", "PEM"]) {
      expect(names).toContain(family);
    }
  });
});

describe("copyleft matcher", () => {
  it("matches copyleft identifiers and not permissive ones", () => {
    for (const bad of ["GPL-3.0", "AGPL-3.0-only", "LGPL-2.1", "SSPL-1.0", "GPL-2.0 OR MIT"]) {
      expect(COPYLEFT_RE.test(bad)).toBe(true);
    }
    for (const ok of ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "MPL-2.0", "0BSD", "Unlicense"]) {
      expect(COPYLEFT_RE.test(ok)).toBe(false);
    }
  });
});

describe("the real repository", () => {
  it("passes the full OSS/IP gate", () => {
    const failures = runAllChecks(process.cwd());
    expect(failures).toEqual([]);
  });
});
