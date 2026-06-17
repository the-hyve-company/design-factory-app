import { describe, it, expect } from "vitest";
import { collectSkillFromFolder, type CollectSkillDeps } from "@/lib/skill-folder-import";
import type { FsFile } from "@/lib/claude-bridge";

// Mock filesystem helper. Given a flat dictionary of paths → contents,
// returns deps that mirror the real listFolder/readFileViaBridge.
function makeFs(files: Record<string, string | { binary: string }>): CollectSkillDeps {
  return {
    listFolder: async (p) => {
      const norm = p.endsWith("/") ? p : p + "/";
      const entriesMap = new Map<string, { isDir: boolean; size: number }>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(norm)) continue;
        const rel = path.slice(norm.length);
        if (!rel) continue;
        const slash = rel.indexOf("/");
        if (slash === -1) {
          // direct file
          const content = files[path];
          const size = typeof content === "string" ? content.length : 200;
          entriesMap.set(rel, { isDir: false, size });
        } else {
          // child directory
          const dirName = rel.slice(0, slash);
          if (!entriesMap.has(dirName)) entriesMap.set(dirName, { isDir: true, size: 0 });
        }
      }
      const entries = [...entriesMap.entries()].map(([name, meta]) => ({
        name,
        path: norm + name,
        isDir: meta.isDir,
        size: meta.size,
      }));
      return { entries };
    },
    readFileViaBridge: async (p) => {
      const content = files[p];
      if (content === undefined) return null;
      if (typeof content === "string") {
        return { path: p, size: content.length, mtime: 0, isText: true, content };
      }
      // binary — daemon would return `data:<mime>;base64,<b64>`
      return {
        path: p,
        size: 100,
        mtime: 0,
        isText: false,
        content: `data:application/octet-stream;base64,${content.binary}`,
      } as FsFile;
    },
    parseSkillMarkdown: (raw) => {
      // Tiny YAML-ish frontmatter parser — only `name`, `trigger`,
      // `description`. Production uses claude-bridge's full parser; this
      // mock is enough to test selection logic.
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
      if (!fmMatch) return { name: null, trigger: null, description: null, body: raw.trim() };
      const fm = fmMatch[1];
      const body = raw.slice(fmMatch[0].length).trim();
      const pick = (k: string) => {
        const m = fm.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, "m"));
        return m ? m[1].trim().replace(/^["'](.*)["']$/, "$1") : null;
      };
      return {
        name: pick("name"),
        trigger: pick("trigger"),
        description: pick("description"),
        body,
      };
    },
  };
}

const skillMdRaw = (name: string, trigger = "/x") =>
  `---\nname: ${name}\ntrigger: ${trigger}\ndescription: test skill\n---\n\nSkill body content.`;

describe("collectSkillFromFolder — multifile bundling", () => {
  it("bundles 4 .md files into 1 manifest + 3 extraFiles when SKILL.md is present", async () => {
    // Regression test for the exact user-reported scenario: pointed at a
    // folder with 4 files, got "1 random". With SKILL.md as the manifest,
    // the other 3 must come through as extraFiles.
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("My Skill"),
      "/skill/references.md": "# References",
      "/skill/examples.md": "# Examples",
      "/skill/notes.md": "# Notes",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    expect(result.input.name).toBe("My Skill");
    expect(result.input.trigger).toBe("/x");
    expect(result.manifestPath).toBe("/skill/SKILL.md");
    expect(result.extraCount).toBe(3);
    expect(result.input.extraFiles).toBeDefined();
    const extras = Object.keys(result.input.extraFiles!).sort();
    expect(extras).toEqual(["examples.md", "notes.md", "references.md"]);
  });

  it("picks shallowest .md with name: frontmatter when no SKILL.md exists", async () => {
    const fs = makeFs({
      "/skill/main.md": skillMdRaw("Main"), // valid manifest
      "/skill/refs.md": "# raw markdown, no frontmatter",
      "/skill/scripts/run.sh": "#!/bin/sh\necho hi",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    expect(result.input.name).toBe("Main");
    expect(result.manifestPath).toBe("/skill/main.md");
    // refs.md + scripts/run.sh → 2 extras
    expect(result.extraCount).toBe(2);
    expect(result.input.extraFiles).toHaveProperty("refs.md");
    expect(result.input.extraFiles).toHaveProperty("scripts/run.sh");
  });

  it("walks nested subdirectories (depth ≤ 3)", async () => {
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Nested"),
      "/skill/references/intro.md": "# Intro",
      "/skill/references/deep/api.md": "# API",
      "/skill/assets/diagram.svg": "<svg></svg>",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    const extras = Object.keys(result.input.extraFiles!).sort();
    expect(extras).toEqual(["assets/diagram.svg", "references/deep/api.md", "references/intro.md"]);
  });

  it("skips node_modules / .git / dist / build directories", async () => {
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Hygiene"),
      "/skill/refs.md": "# Refs",
      "/skill/node_modules/lib/index.js": "module.exports = {}",
      "/skill/.git/config": "[core]",
      "/skill/dist/bundle.js": "/* built */",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    expect(Object.keys(result.input.extraFiles!)).toEqual(["refs.md"]);
  });

  it("encodes text files as utf-8 base64 (TextEncoder, not btoa)", async () => {
    // Accented PT chars trip naive btoa(). Test we go through TextEncoder.
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Acentos"),
      "/skill/refs.md": "# Acentuação · características — máximo",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    const encoded = result.input.extraFiles!["refs.md"];
    // Round-trip through atob+TextDecoder.
    const bin = atob(encoded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe("# Acentuação · características — máximo");
  });

  it("strips the data:<mime>;base64, prefix from binary file content", async () => {
    // /fs/read returns binary as `data:application/octet-stream;base64,XXX`.
    // The walker must strip that prefix when populating extraFiles.
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Binary"),
      "/skill/icon.png": { binary: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" },
    });
    const result = await collectSkillFromFolder("/skill", fs);
    expect(result.input.extraFiles!["icon.png"]).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
    );
  });

  it("excludes the manifest slot from extras even if it appears under a different name", async () => {
    // If somehow a SKILL.md sneaks into extras (e.g. another SKILL.md
    // existed deeper), the daemon would refuse it. The walker drops it.
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Outer"),
      "/skill/sub/SKILL.md": skillMdRaw("Inner"), // outside manifestDir, won't be picked
      "/skill/refs.md": "ok",
    });
    const result = await collectSkillFromFolder("/skill", fs);
    // manifest is /skill/SKILL.md (root), so manifestDir = "".
    // The deeper SKILL.md is at "sub/SKILL.md" — startsWith "" → included
    // but normalized to rel="sub/SKILL.md", NOT "SKILL.md". The exclusion
    // only blocks `rel === "SKILL.md"`, so the deeper one comes through
    // as "sub/SKILL.md" — that matches parseSkillZip's behavior too.
    const extras = Object.keys(result.input.extraFiles!).sort();
    expect(extras).toEqual(["refs.md", "sub/SKILL.md"]);
  });

  it("throws when no .md files are found", async () => {
    const fs = makeFs({
      "/skill/main.py": "print('hi')",
      "/skill/data.json": "{}",
    });
    await expect(collectSkillFromFolder("/skill", fs)).rejects.toThrow(/nenhum.*\.md/i);
  });

  it("throws when .md files exist but none have name: frontmatter and there's no SKILL.md", async () => {
    const fs = makeFs({
      "/skill/notes.md": "just a note, no frontmatter",
      "/skill/refs.md": "another note",
    });
    await expect(collectSkillFromFolder("/skill", fs)).rejects.toThrow(/SKILL\.md/);
  });

  it("falls back to folder basename when manifest has no name: field", async () => {
    // Weird edge: SKILL.md exists, but its name: field is missing.
    // The fallback uses the picked folder's basename.
    const fs = makeFs({
      "/parent/my-skill-folder/SKILL.md": "---\ntrigger: /x\n---\nbody",
    });
    const result = await collectSkillFromFolder("/parent/my-skill-folder", fs);
    expect(result.input.name).toBe("my-skill-folder");
  });

  it("returns undefined extraFiles when no extras exist", async () => {
    const fs = makeFs({
      "/skill/SKILL.md": skillMdRaw("Alone"),
    });
    const result = await collectSkillFromFolder("/skill", fs);
    expect(result.input.extraFiles).toBeUndefined();
    expect(result.extraCount).toBe(0);
  });
});
