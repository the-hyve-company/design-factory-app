import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  writeArtifactSafely,
  deleteArtifactSafely,
  validateArtifactStaticP0Minimal,
  MAX_ARTIFACT_BYTES,
  DEFAULT_MIN_HTML_BYTES,
  BACKUP_RETENTION,
  __TEST_INTERNALS__,
} from "./artifact-writer.mjs";

// Each test gets a fresh tmp repo with `projects/{slug}/` already laid out.
// We initialise a real git repo because writeArtifactSafely() resolves the
// projectsRoot via realpathSync(repoRoot/projects) — needs a real path.

let repoRoot;
let projectsRoot;
let slug;

const HTML_BIG = "<!DOCTYPE html><html><body>" + "x".repeat(300) + "</body></html>";
function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "df-aw-"));
  // Make it a git repo (so `git rev-parse` resolves; not strictly required
  // because writeArtifactSafely resolves repoRoot from the caller, but
  // mirrors the production runtime).
  try {
    execFileSync("git", ["init", "-q", repoRoot], { stdio: "pipe" });
  } catch {
    /* fine */
  }
  slug = `gooey-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  projectsRoot = join(repoRoot, "projects");
  await mkdir(join(projectsRoot, slug), { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("validateArtifactStaticP0Minimal", () => {
  it("passes for a real HTML document above the byte floor", () => {
    const r = validateArtifactStaticP0Minimal({ type: "text/html", content: HTML_BIG });
    expect(r.ok).toBe(true);
  });

  it("fails for empty content", () => {
    const r = validateArtifactStaticP0Minimal({ type: "text/html", content: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty-content");
  });

  it("fails for HTML below the byte floor", () => {
    const r = validateArtifactStaticP0Minimal({
      type: "text/html",
      content: "<html><body>x</body></html>",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("below-min-bytes");
      expect(r.details?.minBytes).toBe(DEFAULT_MIN_HTML_BYTES);
    }
  });

  it("fails for HTML that starts with prose", () => {
    const r = validateArtifactStaticP0Minimal({
      type: "text/html",
      content: "Sure! Here is your HTML doc.\n\n" + HTML_BIG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-structured-markup");
  });

  it("does not enforce byte floor for markdown (type-aware)", () => {
    const r = validateArtifactStaticP0Minimal({ type: "text/markdown", content: "# x" });
    expect(r.ok).toBe(true);
  });

  it("respects custom minBytes override", () => {
    const r = validateArtifactStaticP0Minimal({
      type: "text/html",
      content: "<html><body>" + "x".repeat(50) + "</body></html>",
      minBytes: 50,
    });
    expect(r.ok).toBe(true);
  });
});

describe("writeArtifactSafely — happy path", () => {
  it("writes a fresh artifact and returns the recalculated hash", async () => {
    const r = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.noop).toBe(false);
    expect(r.hash).toBe(sha256(HTML_BIG));
    expect(r.backupPath).toBeNull(); // first write — no previous file
    const onDisk = await readFile(r.finalPath, "utf8");
    expect(onDisk).toBe(HTML_BIG);
  });

  it("creates .df/temp and .df/backups under the project slug", async () => {
    await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    const tempStat = await stat(join(projectsRoot, slug, ".df", "temp"));
    const backStat = await stat(join(projectsRoot, slug, ".df", "backups"));
    expect(tempStat.isDirectory()).toBe(true);
    expect(backStat.isDirectory()).toBe(true);
  });

  it("backs up the previous file on a second write to the same path", async () => {
    const first = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    const second = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG.replace("body", "BODY"),
      repoRoot,
    });
    expect(first.backupPath).toBeNull();
    expect(second.backupPath).not.toBeNull();
    expect(second.noop).toBe(false);
    const backedUp = await readFile(second.backupPath, "utf8");
    expect(backedUp).toBe(HTML_BIG);
  });

  it("is idempotent when the on-disk hash matches", async () => {
    const first = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    const second = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    expect(second.ok).toBe(true);
    expect(second.noop).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(second.backupPath).toBeNull();
  });

  it("writes into a nested variant path that doesn't exist yet", async () => {
    const r = await writeArtifactSafely({
      identifier: `projects/${slug}/variants/dark-v1.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    const onDisk = await readFile(r.finalPath, "utf8");
    expect(onDisk).toBe(HTML_BIG);
  });

  it("logs hash hint mismatch but uses recalculated hash", async () => {
    const r = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      contentHash: "deadbeef".repeat(8), // wrong client hash
      repoRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.hashHintMismatch).toBe(true);
    expect(r.hash).toBe(sha256(HTML_BIG));
  });
});

describe("writeArtifactSafely — failure modes", () => {
  it("rejects content with code STATIC_FAIL when below min bytes", async () => {
    let caught = null;
    try {
      await writeArtifactSafely({
        identifier: `projects/${slug}/index.html`,
        type: "text/html",
        content: "<html><body>too small</body></html>",
        repoRoot,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe("STATIC_FAIL");
    expect(caught.reason).toBe("below-min-bytes");
  });

  it("rejects oversized content with code OVERSIZE", async () => {
    const huge = "x".repeat(MAX_ARTIFACT_BYTES + 1);
    let caught = null;
    try {
      await writeArtifactSafely({
        identifier: `projects/${slug}/index.html`,
        type: "text/html",
        content: huge,
        repoRoot,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe("OVERSIZE");
  });

  it("rejects identifier that escapes the projects/ scope", async () => {
    let caught = null;
    try {
      await writeArtifactSafely({
        identifier: `projects/${slug}/../../etc/passwd`,
        type: "text/html",
        content: HTML_BIG,
        repoRoot,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.name).toBe("PathScopeError");
  });

  it("preserves the previous good file when Static P0 fails on a second write", async () => {
    const first = await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    let caught = null;
    try {
      await writeArtifactSafely({
        identifier: `projects/${slug}/index.html`,
        type: "text/html",
        content: "<html>tiny</html>",
        repoRoot,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe("STATIC_FAIL");
    // Previous good file untouched.
    const onDisk = await readFile(first.finalPath, "utf8");
    expect(onDisk).toBe(HTML_BIG);
  });

  it("rejects empty identifier", async () => {
    let caught = null;
    try {
      await writeArtifactSafely({ identifier: "", type: "text/html", content: HTML_BIG, repoRoot });
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe("BAD_REQUEST");
  });

  it("rejects identifier resolving to PROJECTS_ROOT itself", async () => {
    let caught = null;
    try {
      await writeArtifactSafely({
        identifier: "projects/",
        type: "text/html",
        content: HTML_BIG,
        repoRoot,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    // Either path-scope error (e.g. PATH_NO_SLUG) or PATH_INVALID — both
    // signal "not a valid file target".
    expect(["PathScopeError", "Error"]).toContain(caught.name);
  });
});

describe("writeArtifactSafely — backup retention", () => {
  it("prunes old backups beyond BACKUP_RETENTION", async () => {
    // Seed with the first write.
    await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    // Now write BACKUP_RETENTION+5 distinct versions. Each will create a
    // backup of the previous file. After the loop, only BACKUP_RETENTION
    // backups should remain on disk.
    for (let i = 0; i < BACKUP_RETENTION + 5; i++) {
      // Sleep a tiny bit so the ISO timestamp is distinct (millisecond
      // granularity is enough but tests can be fast on hot paths).
      await new Promise((r) => setTimeout(r, 5));
      await writeArtifactSafely({
        identifier: `projects/${slug}/index.html`,
        type: "text/html",
        content: HTML_BIG.replace("body", `body-${i}-${Math.random()}`),
        repoRoot,
      });
    }
    const backupDir = join(projectsRoot, slug, ".df", "backups");
    const entries = await readdir(backupDir);
    const indexBackups = entries.filter((n) => n.endsWith("-index.html"));
    expect(indexBackups.length).toBeLessThanOrEqual(BACKUP_RETENTION);
    // Should be at the cap, not below it (we wrote 16 distinct versions).
    expect(indexBackups.length).toBe(BACKUP_RETENTION);
  });
});

describe("writeArtifactSafely — concurrency", () => {
  it("serialises concurrent writes to the same finalPath via lock", async () => {
    // Fire 5 writes in parallel, each with distinct content. All should
    // succeed; the last one to land determines the on-disk hash. The lock
    // guarantees the backup chain stays consistent (no torn renames).
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push(
        writeArtifactSafely({
          identifier: `projects/${slug}/index.html`,
          type: "text/html",
          content: HTML_BIG.replace("body", `body-${i}-${"y".repeat(50)}`),
          repoRoot,
        }),
      );
    }
    const results = await Promise.all(tasks);
    expect(results.every((r) => r.ok)).toBe(true);
    // Backups: the FIRST writer doesn't back up (no prev file). The other
    // 4 each back up the predecessor. Total backup files >= 4 (some of
    // those backups might themselves be pruned if BACKUP_RETENTION is
    // small, but not for 4 vs 10).
    const backupDir = join(projectsRoot, slug, ".df", "backups");
    const entries = await readdir(backupDir);
    const indexBackups = entries.filter((n) => n.endsWith("-index.html"));
    expect(indexBackups.length).toBe(4);
    // Lock map should be drained after settle (eventual consistency — wait
    // a tick for the cleanup chain).
    await new Promise((r) => setTimeout(r, 10));
    expect(__TEST_INTERNALS__.inspectLocks().length).toBeLessThanOrEqual(1);
  });
});

describe("timestampForBackup — uniqueness under collision pressure", () => {
  it("produces distinct names for rapid-fire calls within the same millisecond", () => {
    // Regression: ISO timestamp alone has ms precision, so concurrent
    // writes (or just two writes ≤1ms apart) generate identical backup
    // filenames and the second overwrites the first. CI runners hit this
    // routinely on the concurrency test below; we lock it down here with
    // a tight loop guaranteed to land in the same millisecond.
    const seen = new Set();
    const N = 5000;
    for (let i = 0; i < N; i++) {
      seen.add(__TEST_INTERNALS__.timestampForBackup());
    }
    expect(seen.size).toBe(N);
  });

  it("preserves lexicographic sort order with the sequence suffix", () => {
    // The sort in pruneBackups() is ASCII lexicographic. The ISO timestamp
    // must remain the dominant key so older entries still come first across
    // ms boundaries; the seq suffix is only a within-ms tiebreaker.
    const earlier = __TEST_INTERNALS__.timestampForBackup(new Date("2026-01-01T00:00:00.000Z"));
    const later = __TEST_INTERNALS__.timestampForBackup(new Date("2026-12-31T23:59:59.999Z"));
    expect(earlier < later).toBe(true);
  });
});

describe("writeArtifactSafely — markdown / non-html types", () => {
  it("writes a markdown doc with skill-specific byte floor override", async () => {
    // type-aware Static P0 enforces a default 200-byte floor
    // across all text types. Skills (notes, prompts) that legitimately
    // emit shorter documents pass their own `minBytes` override — this is
    // the authoritative pattern for "I know my output is small, just
    // structurally valid".
    const md = "# Notes\n\nShort but valid markdown.";
    const r = await writeArtifactSafely({
      identifier: `projects/${slug}/docs/notes.md`,
      type: "text/markdown",
      content: md,
      repoRoot,
      minBytes: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.hash).toBe(sha256(md));
    const onDisk = await readFile(r.finalPath, "utf8");
    expect(onDisk).toBe(md);
  });

  it("writes a JSON file with the daemon-recalculated hash", async () => {
    const json = JSON.stringify({ foo: "bar" }, null, 2);
    const r = await writeArtifactSafely({
      identifier: `projects/${slug}/data/sample.json`,
      type: "application/json",
      content: json,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.hash).toBe(sha256(json));
  });
});

// ─── : deleteArtifactSafely (catastrophic-no-backup rollback) ────

describe("deleteArtifactSafely — happy path", () => {
  it("deletes a real artifact and returns deleted=true", async () => {
    // First write an artifact via writeArtifactSafely so it lives at the
    // canonical path the rollback would target.
    await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    const r = await deleteArtifactSafely({
      requestedPath: `projects/${slug}/index.html`,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(true);
    // Verify the file is actually gone.
    let exists = true;
    try {
      await stat(r.finalPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("is idempotent — missing file returns deleted=false", async () => {
    const r = await deleteArtifactSafely({
      requestedPath: `projects/${slug}/never-existed.html`,
      repoRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(false);
  });
});

describe("deleteArtifactSafely — failure modes", () => {
  it("rejects empty path with BAD_REQUEST", async () => {
    await expect(deleteArtifactSafely({ requestedPath: "", repoRoot })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects path that escapes scope", async () => {
    await expect(
      deleteArtifactSafely({ requestedPath: "../../../etc/passwd", repoRoot }),
    ).rejects.toThrow(); // PathScopeError
  });

  it("refuses to delete files inside .df/ (PROTECTED_PATH)", async () => {
    // First create the .df/ tree by writing a real artifact.
    await writeArtifactSafely({
      identifier: `projects/${slug}/index.html`,
      type: "text/html",
      content: HTML_BIG,
      repoRoot,
    });
    // Backup file lives in .df/backups; manufacture a known path inside .df.
    const sentinel = join(projectsRoot, slug, ".df", "project-files.json");
    await writeFile(sentinel, "{}");
    await expect(
      deleteArtifactSafely({
        requestedPath: `projects/${slug}/.df/project-files.json`,
        repoRoot,
      }),
    ).rejects.toMatchObject({ code: "PROTECTED_PATH" });
    // And the file is still there.
    const txt = await readFile(sentinel, "utf8");
    expect(txt).toBe("{}");
  });
});
