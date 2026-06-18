// Unit test for the multifile listing behavior exposed by
// GET /skills/:id/files. The endpoint walks a real skill folder; we
// reproduce the walker logic in isolation so the manifest-exclude rule
// and the text/binary classification can be locked down without
// spinning up the HTTP layer.
//
// The walker logic mirrors the implementation at apps/daemon/src/index.mjs:
// recurse depth ≤ 3, skip .git / .DS_Store, drop the manifest itself,
// flag files as text via the TEXT_EXT_RX whitelist, sort text-first.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

// Mirror of the route's walker — see apps/daemon/src/index.mjs
// `GET /skills/:id/files`. Kept in sync by hand; if the endpoint
// changes, update both. The route's HTTP/scope-guard layer is exercised
// by the live E2E harness (`scripts/validate-modals.mjs`); this test
// pins the file-system walk semantics.
const TEXT_EXT_RX =
  /\.(html?|svg|xml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|json|jsonc|md|markdown|mdx|txt|csv|tsv|yaml|yml|toml|ini|conf|sh|bash|zsh|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|sql|graphql|gql)$/i;

async function walkSkillFolder(skillDir, manifestName) {
  const out = [];
  const walk = async (p, depth, relPrefix) => {
    if (depth > 3 || out.length >= 200) return;
    let entries;
    try {
      entries = await readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= 200) break;
      if (/^\.(git|DS_Store)/.test(e.name)) continue;
      const childPath = join(p, e.name);
      const childRel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(childPath, depth + 1, childRel);
        continue;
      }
      if (!e.isFile()) continue;
      let st;
      try {
        st = await stat(childPath);
      } catch {
        continue;
      }
      if (childRel === manifestName && p === skillDir) continue;
      out.push({
        rel: childRel,
        name: e.name,
        path: childPath,
        size: st.size,
        isText: TEXT_EXT_RX.test(e.name),
      });
    }
  };
  await walk(skillDir, 0, "");
  out.sort((a, b) => {
    if (a.isText !== b.isText) return a.isText ? -1 : 1;
    return a.rel.localeCompare(b.rel);
  });
  return out;
}

let skillDir;
let manifestName;

beforeEach(async () => {
  skillDir = await mkdtemp(join(tmpdir(), "df-skill-files-"));
  manifestName = "SKILL.md";
  await writeFile(join(skillDir, manifestName), "---\nname: t\ntrigger: /t\n---\nbody");
});

afterEach(async () => {
  await rm(skillDir, { recursive: true, force: true });
});

describe("skill-files walker — multifile listing", () => {
  it("excludes the SKILL.md manifest from the result", async () => {
    const files = await walkSkillFolder(skillDir, manifestName);
    expect(files.find((f) => f.rel === "SKILL.md")).toBeUndefined();
  });

  it("lists sibling .md files (the common reference-doc shape)", async () => {
    await writeFile(join(skillDir, "references.md"), "# refs");
    await writeFile(join(skillDir, "examples.md"), "# examples");
    const files = await walkSkillFolder(skillDir, manifestName);
    const names = files.map((f) => f.rel).sort();
    expect(names).toEqual(["examples.md", "references.md"]);
    expect(files.every((f) => f.isText)).toBe(true);
  });

  it("walks nested subdirectories (depth ≤ 3)", async () => {
    await mkdir(join(skillDir, "examples", "deep"), { recursive: true });
    await writeFile(join(skillDir, "examples", "a.md"), "a");
    await writeFile(join(skillDir, "examples", "deep", "b.md"), "b");
    const files = await walkSkillFolder(skillDir, manifestName);
    expect(files.map((f) => f.rel).sort()).toEqual(["examples/a.md", "examples/deep/b.md"]);
  });

  it("stops at depth 3 — files deeper than that are dropped", async () => {
    // skillDir/a/b/c/d.md is depth 4 — should be excluded.
    await mkdir(join(skillDir, "a", "b", "c", "d"), { recursive: true });
    await writeFile(join(skillDir, "a", "b", "c", "d", "too-deep.md"), "x");
    await writeFile(join(skillDir, "a", "b", "c", "ok.md"), "y");
    const files = await walkSkillFolder(skillDir, manifestName);
    expect(files.map((f) => f.rel)).toContain("a/b/c/ok.md");
    expect(files.map((f) => f.rel)).not.toContain("a/b/c/d/too-deep.md");
  });

  it("flags binary files (image, font) as isText=false", async () => {
    // We don't need real binary content — the flag is keyed on extension.
    await writeFile(join(skillDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(skillDir, "diagram.svg"), "<svg></svg>");
    const files = await walkSkillFolder(skillDir, manifestName);
    const png = files.find((f) => f.rel === "icon.png");
    const svg = files.find((f) => f.rel === "diagram.svg");
    expect(png?.isText).toBe(false);
    expect(svg?.isText).toBe(true); // .svg is in the text whitelist
  });

  it("sorts text files first, then by path (alphabetical)", async () => {
    await writeFile(join(skillDir, "z.png"), Buffer.from([0]));
    await writeFile(join(skillDir, "a.md"), "a");
    await writeFile(join(skillDir, "b.png"), Buffer.from([0]));
    await writeFile(join(skillDir, "c.md"), "c");
    const files = await walkSkillFolder(skillDir, manifestName);
    // Expected order: a.md, c.md, b.png, z.png
    expect(files.map((f) => f.rel)).toEqual(["a.md", "c.md", "b.png", "z.png"]);
  });

  it("ignores .git and .DS_Store directories", async () => {
    await mkdir(join(skillDir, ".git"), { recursive: true });
    await writeFile(join(skillDir, ".git", "config"), "[core]");
    await writeFile(join(skillDir, ".DS_Store"), "junk");
    await writeFile(join(skillDir, "real.md"), "real");
    const files = await walkSkillFolder(skillDir, manifestName);
    const rels = files.map((f) => f.rel);
    expect(rels).toEqual(["real.md"]);
  });

  it("returns absolute paths so the UI can chain /fs/read", async () => {
    await writeFile(join(skillDir, "thing.md"), "x");
    const files = await walkSkillFolder(skillDir, manifestName);
    const f = files.find((x) => x.rel === "thing.md");
    expect(f?.path).toBe(join(skillDir, "thing.md"));
    expect(basename(f.path)).toBe("thing.md");
  });

  it("returns empty when only SKILL.md is present", async () => {
    const files = await walkSkillFolder(skillDir, manifestName);
    expect(files).toEqual([]);
  });
});
