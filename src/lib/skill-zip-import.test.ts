import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSkillZip } from "./skill-zip-import";

describe("skill zip import parser", () => {
  it("turns the minimal skill zip into an installSkill payload preserving extra files", () => {
    const zip = readFileSync(resolve(process.cwd(), "examples/fixtures/skills/minimal-skill.zip"));
    const parsed = parseSkillZip(new Uint8Array(zip), "minimal-skill.zip");

    expect(parsed.manifestPath).toBe("minimal-skill/SKILL.md");
    expect(parsed.installInput.forceSlug).toBe("minimal-skill");
    expect(parsed.installInput.name).toBe("Minimal Smoke Skill");
    expect(parsed.installInput.trigger).toBe("/smoke-skill");
    expect(parsed.installInput.body).toContain("That is the entire instruction.");
    expect(parsed.installInput.extraFiles).toEqual({
      "references/style.md": expect.any(String),
    });

    const decoded = Buffer.from(
      parsed.installInput.extraFiles!["references/style.md"],
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("preserves the");
    expect(decoded).toContain("references/` subfolder verbatim");
  });

  it("uses the zip filename stem for flat archives without frontmatter name", () => {
    const zip = zipSync({
      "SKILL.md": new TextEncoder().encode(
        [
          "---",
          'trigger: "/flat-skill"',
          "---",
          "",
          "Use this flat archive as a smoke skill body.",
        ].join("\n"),
      ),
    });

    const parsed = parseSkillZip(zip, "flat-skill.zip");

    expect(parsed.manifestPath).toBe("SKILL.md");
    expect(parsed.installInput.forceSlug).toBe("flat-skill");
    expect(parsed.installInput.name).toBe("flat-skill");
    expect(parsed.installInput.trigger).toBe("/flat-skill");
  });
});
