import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import {
  REGISTRY_VERSION,
  REGISTRY_BASENAME,
  REGISTRY_DIRNAME,
  validateRegistryShape,
  registryPathForSlug,
  toRegistryKey,
  fromRegistryKey,
  inferRegistryFromFilesystem,
  readRegistry,
  writeRegistry,
  validateOrRebuild,
  upsertFile,
  __TEST_INTERNALS__,
} from "./project-files.mjs";

let repoRoot;
let projectsRoot;
let slug;

const HTML = "<!DOCTYPE html><html><body>" + "x".repeat(300) + "</body></html>";

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "df-pf-"));
  try {
    execFileSync("git", ["init", "-q", repoRoot], { stdio: "pipe" });
  } catch {
    /* */
  }
  slug = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  projectsRoot = join(repoRoot, "projects");
  await mkdir(join(projectsRoot, slug), { recursive: true });
  // Resolve realpath so symlinks/case-insensitive fs match what the
  // daemon will see.
  projectsRoot = realpathSync(projectsRoot);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("validateRegistryShape", () => {
  it("accepts a minimal valid registry", () => {
    const r = {
      version: 1,
      primaryFile: `projects/${slug}/index.html`,
      activeFile: `projects/${slug}/index.html`,
      files: {
        [`projects/${slug}/index.html`]: {
          type: "text/html",
          role: "primary",
          previewable: true,
          createdAt: "2026-05-04T00:00:00Z",
          updatedAt: "2026-05-04T00:00:00Z",
        },
      },
    };
    expect(validateRegistryShape(r)).toBeNull();
  });

  it("rejects unknown version", () => {
    const r = {
      version: 99,
      primaryFile: "x",
      activeFile: "x",
      files: {
        x: {
          type: "text/html",
          role: "primary",
          previewable: true,
          createdAt: "x",
          updatedAt: "x",
        },
      },
    };
    const out = validateRegistryShape(r);
    expect(out?.error).toMatch(/unsupported-version/);
  });

  it("rejects when primaryFile not in files", () => {
    const r = {
      version: 1,
      primaryFile: "nope",
      activeFile: "x",
      files: {
        x: {
          type: "text/html",
          role: "primary",
          previewable: true,
          createdAt: "x",
          updatedAt: "x",
        },
      },
    };
    expect(validateRegistryShape(r)?.error).toBe("primaryFile-not-in-files");
  });

  it("rejects when activeFile not in files", () => {
    const r = {
      version: 1,
      primaryFile: "x",
      activeFile: "nope",
      files: {
        x: {
          type: "text/html",
          role: "primary",
          previewable: true,
          createdAt: "x",
          updatedAt: "x",
        },
      },
    };
    expect(validateRegistryShape(r)?.error).toBe("activeFile-not-in-files");
  });

  it("rejects entry with bad role", () => {
    const r = {
      version: 1,
      primaryFile: "x",
      activeFile: "x",
      files: {
        x: { type: "text/html", role: "blorp", previewable: true, createdAt: "x", updatedAt: "x" },
      },
    };
    expect(validateRegistryShape(r)?.error).toMatch(/entry-role-invalid/);
  });
});

describe("registryPathForSlug / toRegistryKey / fromRegistryKey", () => {
  it("registryPathForSlug returns .df/project-files.json under slug", () => {
    const p = registryPathForSlug(slug, projectsRoot);
    expect(p.endsWith(`${slug}/${REGISTRY_DIRNAME}/${REGISTRY_BASENAME}`)).toBe(true);
  });

  it("toRegistryKey converts an absolute path to projects/slug/... form", () => {
    const abs = join(projectsRoot, slug, "variants", "dark.html");
    const key = toRegistryKey(abs, projectsRoot);
    expect(key).toBe(`projects/${slug}/variants/dark.html`);
  });

  it("fromRegistryKey reverses toRegistryKey", () => {
    const key = `projects/${slug}/docs/notes.md`;
    const abs = fromRegistryKey(key, projectsRoot);
    expect(abs).toBe(join(projectsRoot, slug, "docs", "notes.md"));
  });

  it("fromRegistryKey throws on invalid key", () => {
    expect(() => fromRegistryKey("not-prefixed/x.html", projectsRoot)).toThrow();
  });
});

describe("inferRegistryFromFilesystem", () => {
  it("returns a placeholder registry for an empty project (no files)", async () => {
    const r = await inferRegistryFromFilesystem(slug, projectsRoot);
    expect(r.version).toBe(REGISTRY_VERSION);
    expect(r.primaryFile).toBe(`projects/${slug}/index.html`);
    expect(r.activeFile).toBe(r.primaryFile);
    expect(r.files[r.primaryFile]).toBeDefined();
    expect(r.files[r.primaryFile].role).toBe("primary");
  });

  it("picks index.html as primary when present at top level", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    const r = await inferRegistryFromFilesystem(slug, projectsRoot);
    expect(r.primaryFile).toBe(`projects/${slug}/index.html`);
    expect(r.files[r.primaryFile].role).toBe("primary");
    expect(r.files[r.primaryFile].hash).toBeDefined();
  });

  it("picks {slug}.html as primary when index.html absent", async () => {
    await writeFile(join(projectsRoot, slug, `${slug}.html`), HTML);
    const r = await inferRegistryFromFilesystem(slug, projectsRoot);
    expect(r.primaryFile).toBe(`projects/${slug}/${slug}.html`);
    expect(r.files[r.primaryFile].role).toBe("primary");
  });

  it("walks variants/ docs/ data/ assets/ subfolders and tags roles", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await mkdir(join(projectsRoot, slug, "variants"), { recursive: true });
    await mkdir(join(projectsRoot, slug, "docs"), { recursive: true });
    await mkdir(join(projectsRoot, slug, "data"), { recursive: true });
    await mkdir(join(projectsRoot, slug, "assets", "images"), { recursive: true });
    await writeFile(join(projectsRoot, slug, "variants", "dark.html"), HTML);
    await writeFile(join(projectsRoot, slug, "docs", "notes.md"), "# notes");
    await writeFile(join(projectsRoot, slug, "data", "config.json"), "{}");
    await writeFile(
      join(projectsRoot, slug, "assets", "images", "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const r = await inferRegistryFromFilesystem(slug, projectsRoot);
    expect(r.files[`projects/${slug}/index.html`].role).toBe("primary");
    expect(r.files[`projects/${slug}/variants/dark.html`].role).toBe("variant");
    expect(r.files[`projects/${slug}/docs/notes.md`].role).toBe("doc");
    expect(r.files[`projects/${slug}/data/config.json`].role).toBe("data");
    expect(r.files[`projects/${slug}/assets/images/logo.png`].role).toBe("asset");
    expect(r.files[`projects/${slug}/docs/notes.md`].previewable).toBe(false);
    expect(r.files[`projects/${slug}/index.html`].previewable).toBe(true);
  });

  it("ignores .df/ and node_modules/ during walk", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await mkdir(join(projectsRoot, slug, ".df"), { recursive: true });
    await writeFile(join(projectsRoot, slug, ".df", "noise.json"), "{}");
    await mkdir(join(projectsRoot, slug, "node_modules"), { recursive: true });
    await writeFile(join(projectsRoot, slug, "node_modules", "fake.js"), "//");
    const r = await inferRegistryFromFilesystem(slug, projectsRoot);
    const keys = Object.keys(r.files);
    expect(keys).toContain(`projects/${slug}/index.html`);
    expect(keys.some((k) => k.includes(".df/"))).toBe(false);
    expect(keys.some((k) => k.includes("node_modules"))).toBe(false);
  });
});

describe("readRegistry / writeRegistry roundtrip", () => {
  it("returns null when registry file does not exist", async () => {
    const r = await readRegistry(slug, projectsRoot);
    expect(r).toBeNull();
  });

  it("write then read returns the same shape", async () => {
    const reg = {
      version: 1,
      primaryFile: `projects/${slug}/index.html`,
      activeFile: `projects/${slug}/index.html`,
      files: {
        [`projects/${slug}/index.html`]: {
          type: "text/html",
          role: "primary",
          previewable: true,
          createdAt: "2026-05-04T00:00:00Z",
          updatedAt: "2026-05-04T00:00:00Z",
        },
      },
    };
    await writeRegistry(slug, projectsRoot, reg);
    const back = await readRegistry(slug, projectsRoot);
    expect(back).toEqual(reg);
  });

  it("returns null on corrupted JSON (caller will rebuild)", async () => {
    const path = registryPathForSlug(slug, projectsRoot);
    await mkdir(join(projectsRoot, slug, REGISTRY_DIRNAME), { recursive: true });
    await writeFile(path, "{ not json", "utf8");
    const r = await readRegistry(slug, projectsRoot);
    expect(r).toBeNull();
  });

  it("returns null on schema-invalid registry", async () => {
    const path = registryPathForSlug(slug, projectsRoot);
    await mkdir(join(projectsRoot, slug, REGISTRY_DIRNAME), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ version: 1, primaryFile: "x", activeFile: "x", files: {} }),
      "utf8",
    );
    const r = await readRegistry(slug, projectsRoot);
    expect(r).toBeNull();
  });

  it("writeRegistry rejects invalid registry shape", async () => {
    const bad = { version: 1, primaryFile: "x", activeFile: "x", files: {} };
    let caught = null;
    try {
      await writeRegistry(slug, projectsRoot, bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe("INVALID_REGISTRY");
  });
});

describe("validateOrRebuild", () => {
  it("rebuilds and persists when no file exists", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    const r = await validateOrRebuild(slug, projectsRoot);
    expect(r.primaryFile).toBe(`projects/${slug}/index.html`);
    // File should now exist on disk.
    const path = registryPathForSlug(slug, projectsRoot);
    expect(existsSync(path)).toBe(true);
    // Second call returns the persisted registry without re-walking.
    const r2 = await validateOrRebuild(slug, projectsRoot);
    expect(r2).toEqual(r);
  });

  it("rebuilds when existing registry is corrupted", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    const path = registryPathForSlug(slug, projectsRoot);
    await mkdir(join(projectsRoot, slug, REGISTRY_DIRNAME), { recursive: true });
    await writeFile(path, "garbage", "utf8");
    const r = await validateOrRebuild(slug, projectsRoot);
    expect(r.primaryFile).toBe(`projects/${slug}/index.html`);
    // File should have been rewritten with valid content.
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
  });
});

describe("upsertFile", () => {
  it("inserts a new variant entry and updates activeFile", async () => {
    // Seed primary.
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await validateOrRebuild(slug, projectsRoot);

    const variantKey = `projects/${slug}/variants/dark.html`;
    const out = await upsertFile({
      slug,
      projectsRoot,
      key: variantKey,
      entry: {
        type: "text/html",
        role: "variant",
        previewable: true,
        hash: "deadbeef".repeat(8),
        parent: `projects/${slug}/index.html`,
      },
      setActive: true,
    });
    expect(out.registry.activeFile).toBe(variantKey);
    expect(out.registry.primaryFile).toBe(`projects/${slug}/index.html`);
    expect(out.registry.files[variantKey].role).toBe("variant");
    expect(out.registry.files[variantKey].parent).toBe(`projects/${slug}/index.html`);
  });

  it("does not change activeFile when setActive is false", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await validateOrRebuild(slug, projectsRoot);
    const docKey = `projects/${slug}/docs/notes.md`;
    const out = await upsertFile({
      slug,
      projectsRoot,
      key: docKey,
      entry: { type: "text/markdown", role: "doc", previewable: false },
      setActive: false,
    });
    expect(out.registry.activeFile).toBe(`projects/${slug}/index.html`);
    expect(out.registry.files[docKey].role).toBe("doc");
  });

  it("setPrimary updates primaryFile and forces role=primary", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await validateOrRebuild(slug, projectsRoot);
    const newKey = `projects/${slug}/variants/dark.html`;
    const out = await upsertFile({
      slug,
      projectsRoot,
      key: newKey,
      entry: { type: "text/html", role: "variant", previewable: true },
      setPrimary: true,
    });
    expect(out.registry.primaryFile).toBe(newKey);
    expect(out.registry.files[newKey].role).toBe("primary");
  });

  it("creates registry on first upsert when project has no files yet", async () => {
    const out = await upsertFile({
      slug,
      projectsRoot,
      key: `projects/${slug}/index.html`,
      entry: { type: "text/html", role: "primary", previewable: true, hash: "f".repeat(64) },
      setActive: true,
      setPrimary: true,
    });
    expect(out.registry.primaryFile).toBe(`projects/${slug}/index.html`);
    expect(out.registry.files[`projects/${slug}/index.html`].hash).toBe("f".repeat(64));
  });

  it("merges over existing entry preserving createdAt + bumping updatedAt", async () => {
    const key = `projects/${slug}/index.html`;
    const r1 = await upsertFile({
      slug,
      projectsRoot,
      key,
      entry: { type: "text/html", role: "primary", previewable: true, hash: "a".repeat(64) },
      setActive: true,
      setPrimary: true,
    });
    const created = r1.entry.createdAt;
    // Sleep a tick so updatedAt definitely differs.
    await new Promise((r) => setTimeout(r, 10));
    const r2 = await upsertFile({
      slug,
      projectsRoot,
      key,
      entry: { type: "text/html", role: "primary", previewable: true, hash: "b".repeat(64) },
      setActive: true,
      setPrimary: true,
    });
    expect(r2.entry.createdAt).toBe(created);
    expect(r2.entry.updatedAt).not.toBe(created);
    expect(r2.entry.hash).toBe("b".repeat(64));
  });
});

describe("upsertFile — concurrency", () => {
  it("serialises concurrent upserts on the same registry via lock", async () => {
    await writeFile(join(projectsRoot, slug, "index.html"), HTML);
    await validateOrRebuild(slug, projectsRoot);

    const tasks = [];
    for (let i = 0; i < 5; i++) {
      const key = `projects/${slug}/variants/v-${i}.html`;
      tasks.push(
        upsertFile({
          slug,
          projectsRoot,
          key,
          entry: {
            type: "text/html",
            role: "variant",
            previewable: true,
            hash: String(i).repeat(64),
          },
          setActive: true,
        }),
      );
    }
    const results = await Promise.all(tasks);
    expect(results.every((r) => r.registry)).toBe(true);
    // Final registry should have all 5 variants present.
    const finalReg = await readRegistry(slug, projectsRoot);
    for (let i = 0; i < 5; i++) {
      expect(finalReg.files[`projects/${slug}/variants/v-${i}.html`]).toBeDefined();
    }
    // ActiveFile equals one of the 5 (whichever wrote last).
    expect(finalReg.activeFile).toMatch(/v-\d\.html$/);
    // Lock map should drain.
    await new Promise((r) => setTimeout(r, 10));
    expect(__TEST_INTERNALS__.inspectLocks().length).toBeLessThanOrEqual(1);
  });
});

describe("internals — pickPrimary / roleForRelParts", () => {
  it("pickPrimary prefers index.html over slug.html", () => {
    const fileRels = [["index.html"], [`${slug}.html`]];
    expect(__TEST_INTERNALS__.pickPrimary(slug, fileRels)).toBe("index.html");
  });

  it("pickPrimary returns null when no html exists", () => {
    expect(__TEST_INTERNALS__.pickPrimary(slug, [])).toBeNull();
    expect(__TEST_INTERNALS__.pickPrimary(slug, [["docs", "x.md"]])).toBeNull();
  });

  it("roleForRelParts maps subfolders correctly", () => {
    expect(__TEST_INTERNALS__.roleForRelParts(["variants", "x.html"])).toBe("variant");
    expect(__TEST_INTERNALS__.roleForRelParts(["docs", "x.md"])).toBe("doc");
    expect(__TEST_INTERNALS__.roleForRelParts(["prompts", "x.txt"])).toBe("prompt");
    expect(__TEST_INTERNALS__.roleForRelParts(["data", "x.json"])).toBe("data");
    expect(__TEST_INTERNALS__.roleForRelParts(["assets", "img", "x.png"])).toBe("asset");
  });

  it("roleForRelParts top-level: previewable → primary, others by ext", () => {
    expect(__TEST_INTERNALS__.roleForRelParts(["index.html"])).toBe("primary");
    expect(__TEST_INTERNALS__.roleForRelParts(["notes.md"])).toBe("doc");
    expect(__TEST_INTERNALS__.roleForRelParts(["config.json"])).toBe("data");
    expect(__TEST_INTERNALS__.roleForRelParts(["readme.txt"])).toBe("doc");
  });
});
