import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSkillZip } from "../../../src/lib/skill-zip-import.ts";
import { installDfSkill } from "./skills-install.mjs";

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "df-skill-zip-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("skill ZIP import round-trip", () => {
  it("installs the minimal skill zip into skills/<zip-folder>/ with sibling files intact", async () => {
    const zip = await readFile(
      resolve(process.cwd(), "examples/fixtures/skills/minimal-skill.zip"),
    );
    const parsed = parseSkillZip(new Uint8Array(zip), "minimal-skill.zip");

    const skill = await installDfSkill(parsed.installInput, { repoRoot });
    const skillMd = await readFile(join(repoRoot, "skills", "minimal-skill", "SKILL.md"), "utf8");
    const reference = await readFile(
      join(repoRoot, "skills", "minimal-skill", "references", "style.md"),
      "utf8",
    );

    expect(skill.id).toBe("df:skills/minimal-skill/SKILL.md");
    expect(skill.name).toBe("Minimal Smoke Skill");
    expect(skill.trigger).toBe("/smoke-skill");
    expect(skillMd).toContain('trigger: "/smoke-skill"');
    expect(skillMd).toContain("That is the entire instruction.");
    expect(reference).toContain("preserves the");
    expect(reference).toContain("references/` subfolder verbatim");
  });
});
