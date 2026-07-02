import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSkillOffered, UNSUPPORTED_CHANNELS } from "./skill-capability-gate";

describe("skill-capability-gate", () => {
  it("offers skills with no requires", () => {
    expect(isSkillOffered({})).toBe(true);
    expect(isSkillOffered({ requires: [] })).toBe(true);
    expect(isSkillOffered({ requires: null })).toBe(true);
  });

  it("offers skills with informational requires", () => {
    expect(isSkillOffered({ requires: ["tools"] })).toBe(true);
    expect(isSkillOffered({ requires: ["mcp", "sub-agents"] })).toBe(true);
  });

  it("gates skills that require an unsupported channel", () => {
    expect(isSkillOffered({ requires: ["image-generation"] })).toBe(false);
    // A single unsupported channel gates even alongside supported values.
    expect(isSkillOffered({ requires: ["tools", "image-generation"] })).toBe(false);
  });

  it("image-generation is declared unsupported (no DF provider has an image channel)", () => {
    expect(UNSUPPORTED_CHANNELS.has("image-generation")).toBe(true);
  });

  it("the bundled brandkit skill declares the image-generation requirement", () => {
    // Guards the frontmatter wiring: if brandkit's `requires:` is dropped,
    // the gate silently stops applying to it.
    const raw = readFileSync(join(process.cwd(), "skills", "brandkit", "SKILL.md"), "utf8");
    const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(fm).toMatch(/^requires:\s*\[\s*"image-generation"\s*\]\s*$/m);
    const parsed = { requires: ["image-generation"] };
    expect(isSkillOffered(parsed)).toBe(false);
  });
});
