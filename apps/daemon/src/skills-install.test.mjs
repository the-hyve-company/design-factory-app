// skills-install extraFiles scope tests (skills-extrafiles-scope-unify).
//
// installDfSkill.extraFiles used to validate paths by raw string
// (`includes("..")` / `startsWith(dir + "/")`) — misses symlinks and
// normalized traversals. Now routed through realpath-based
// assertPathInScope; these tests lock the contract: out-of-scope entries
// are skipped (never written), in-scope entries land, the manifest can't
// be clobbered, and the 5MB per-file cap holds.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDfSkill, MAX_EXTRA_FILE_BYTES } from "./skills-install.mjs";

const b64 = (s) => Buffer.from(s).toString("base64");

const BASE_INPUT = {
  name: "Scope Test Skill",
  trigger: "/scope-test",
  body: "This is a long enough instruction body for the validator to accept.",
};

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "df-skill-scope-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("installDfSkill extraFiles scope", () => {
  it("writes in-scope nested files", async () => {
    await installDfSkill(
      { ...BASE_INPUT, extraFiles: { "references/style.md": b64("in scope") } },
      { repoRoot },
    );
    const dest = join(repoRoot, "skills", "scope-test", "references", "style.md");
    expect(await readFile(dest, "utf8")).toBe("in scope");
  });

  it("skips traversal paths that escape the skill dir — nothing lands outside", async () => {
    await installDfSkill(
      {
        ...BASE_INPUT,
        extraFiles: {
          "../escape.md": b64("escaped"),
          "../../deep-escape.md": b64("escaped"),
          "references/../../sibling.md": b64("escaped"),
        },
      },
      { repoRoot },
    );
    expect(existsSync(join(repoRoot, "skills", "escape.md"))).toBe(false);
    expect(existsSync(join(repoRoot, "escape.md"))).toBe(false);
    expect(existsSync(join(repoRoot, "deep-escape.md"))).toBe(false);
    expect(existsSync(join(repoRoot, "skills", "sibling.md"))).toBe(false);
  });

  it("allows a normalized in-scope traversal (a/../b.md ends up inside the dir)", async () => {
    await installDfSkill(
      { ...BASE_INPUT, extraFiles: { "refs/../notes.md": b64("normalized") } },
      { repoRoot },
    );
    const dest = join(repoRoot, "skills", "scope-test", "notes.md");
    expect(await readFile(dest, "utf8")).toBe("normalized");
  });

  it("skips absolute paths (unix and windows shapes)", async () => {
    const outside = join(repoRoot, "abs-escape.md");
    await installDfSkill(
      {
        ...BASE_INPUT,
        extraFiles: { [outside]: b64("escaped"), "C:\\evil.md": b64("escaped") },
      },
      { repoRoot },
    );
    expect(existsSync(outside)).toBe(false);
  });

  it("never overwrites SKILL.md — even via a normalized traversal", async () => {
    await installDfSkill(
      {
        ...BASE_INPUT,
        extraFiles: {
          "SKILL.md": b64("clobbered"),
          "references/../SKILL.md": b64("clobbered"),
        },
      },
      { repoRoot },
    );
    const manifest = await readFile(join(repoRoot, "skills", "scope-test", "SKILL.md"), "utf8");
    expect(manifest).not.toContain("clobbered");
    expect(manifest).toContain("long enough instruction body");
  });

  it("does not follow a symlinked subdir out of the skill dir", async () => {
    // The exact miss of the old string check: a symlink inside the skill
    // dir pointing outside. "link/evil.md" contains no ".." and stays under
    // dir as a STRING, but resolves outside via the symlink. Pre-create the
    // dir with the link (no SKILL.md, so the install proceeds) — the
    // realpath-based scope check must refuse to write through it.
    const outside = await mkdtemp(join(tmpdir(), "df-skill-outside-"));
    try {
      const skillDir = join(repoRoot, "skills", "scope-test");
      await mkdir(skillDir, { recursive: true });
      await symlink(outside, join(skillDir, "link"));
      await installDfSkill(
        { ...BASE_INPUT, extraFiles: { "link/evil.md": b64("escaped") } },
        { repoRoot },
      );
      expect(existsSync(join(outside, "evil.md"))).toBe(false);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("skips files over the 5MB per-file cap", async () => {
    const big = Buffer.alloc(MAX_EXTRA_FILE_BYTES + 1, 65).toString("base64");
    await installDfSkill(
      { ...BASE_INPUT, extraFiles: { "big.bin": big, "small.md": b64("kept") } },
      { repoRoot },
    );
    const dir = join(repoRoot, "skills", "scope-test");
    expect(existsSync(join(dir, "big.bin"))).toBe(false);
    expect(await readFile(join(dir, "small.md"), "utf8")).toBe("kept");
  });
});
