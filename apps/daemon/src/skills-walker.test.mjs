// skills-walker contract tests.
//
// These tests don't import index.mjs (singleton with side effects). They
// recreate the dedupe + walker semantic on isolated tmpdirs and validate
// the contract: canonical (/skills/) wins over legacy (.claude/skills/)
// on (source, trigger) collision; both paths are walked; legacy-only
// skills still surface.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "df-skills-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

// Re-implement the walker contract under test. Mirrors index.mjs:
// - parseSkillFile: pluck name, trigger from frontmatter
// - buildSkill: rel-from-cwd → id "df:<rel>"
// - dedupe: first occurrence wins per (source, trigger)
// - buildRegistry: walk canonical FIRST, then legacy, then dedupe.

function parseSkillFile(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fm = fmMatch ? fmMatch[1] : "";
  const body = (fmMatch ? raw.slice(fmMatch[0].length) : raw).trim();
  const pick = (key) => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
    if (!m) return null;
    return m[1].trim().replace(/^["'](.*)["']$/, "$1");
  };
  return { name: pick("name"), trigger: pick("trigger"), body };
}

function buildSkill({ raw, absPath, source, cwd }) {
  const parsed = parseSkillFile(raw);
  if (!parsed) return null;
  const rel = cwd && absPath.startsWith(cwd + "/") ? absPath.slice(cwd.length + 1) : absPath;
  const trigger =
    parsed.trigger || "/" + (parsed.name || "skill").toLowerCase().replace(/\s+/g, "-");
  const id = source + ":" + (rel || absPath);
  return { id, name: parsed.name, trigger, source, path: absPath };
}

async function walk(root, { source, cwd, out }) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude") continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      await walk(full, { source, cwd, out });
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      const raw = await readFile(full, "utf8").catch(() => null);
      if (!raw) continue;
      const skill = buildSkill({ raw, absPath: full, source, cwd });
      if (skill && skill.name) out.push(skill);
    }
  }
}

function dedupe(skills) {
  const seen = new Map();
  for (const s of skills) {
    const key = s.source + "::" + s.trigger;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

async function buildRegistry(cwdAbs) {
  const out = [];
  await walk(join(cwdAbs, "skills"), { source: "df", cwd: cwdAbs, out });
  await walk(join(cwdAbs, ".claude", "skills"), { source: "df", cwd: cwdAbs, out });
  return dedupe(out);
}

const SKILL_BODY = (name, trigger) => `---
name: ${name}
trigger: ${trigger}
---

System prompt body that the provider receives when this skill fires.
`;

async function makeSkill(root, slug, name, trigger) {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), SKILL_BODY(name, trigger), "utf8");
}

describe("skills walker", () => {
  it("walks the canonical /skills/ path", async () => {
    await makeSkill(join(repoRoot, "skills"), "alpha", "Alpha", "/alpha");
    const skills = await buildRegistry(repoRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Alpha");
    expect(skills[0].trigger).toBe("/alpha");
    expect(skills[0].id).toBe("df:skills/alpha/SKILL.md");
  });

  it("walks the legacy .claude/skills/ path for backward-compat", async () => {
    await makeSkill(join(repoRoot, ".claude", "skills"), "beta", "Beta", "/beta");
    const skills = await buildRegistry(repoRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Beta");
    expect(skills[0].id).toBe("df:.claude/skills/beta/SKILL.md");
  });

  it("merges canonical + legacy when both have unique skills", async () => {
    await makeSkill(join(repoRoot, "skills"), "alpha", "Alpha", "/alpha");
    await makeSkill(join(repoRoot, ".claude", "skills"), "beta", "Beta", "/beta");
    const skills = await buildRegistry(repoRoot);
    expect(skills).toHaveLength(2);
    const triggers = skills.map((s) => s.trigger).sort();
    expect(triggers).toEqual(["/alpha", "/beta"]);
  });

  it("canonical wins over legacy on (source, trigger) collision", async () => {
    // Same trigger /shared, different bodies and slug names. Canonical
    // should be the one surfaced; legacy gets dedupe-dropped.
    await makeSkill(join(repoRoot, "skills"), "canonical-slug", "Canonical Version", "/shared");
    await makeSkill(
      join(repoRoot, ".claude", "skills"),
      "legacy-slug",
      "Legacy Version",
      "/shared",
    );
    const skills = await buildRegistry(repoRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Canonical Version");
    expect(skills[0].id).toBe("df:skills/canonical-slug/SKILL.md");
  });

  it("returns empty when neither path exists", async () => {
    const skills = await buildRegistry(repoRoot);
    expect(skills).toEqual([]);
  });

  it("ids are repo-root relative (consistent across install/registry)", async () => {
    await makeSkill(join(repoRoot, "skills"), "gamma", "Gamma", "/gamma");
    const skills = await buildRegistry(repoRoot);
    // The id is "df:<rel-from-cwd>" — same shape produced by buildSkill
    // in install path (cwd: getRepoRoot()), so install/registry/update
    // share one contract.
    expect(skills[0].id).toMatch(/^df:skills\/gamma\/SKILL\.md$/);
  });
});
