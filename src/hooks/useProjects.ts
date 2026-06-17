import { useState, useEffect, useCallback } from "react";
import { warn } from "@/lib/error-surface";
import {
  db,
  copyDirViaBridge,
  moveDirViaBridge,
  listProjectsFromFilesystem,
  removeProjectFolder,
  readProjectMeta,
  writeProjectMeta,
  type DbProject,
  type FsProject,
  type ProjectMeta,
} from "@/lib/claude-bridge";
import { slugFromPath } from "@/lib/project-files";

export type { DbProject as Project };

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 48) || "project"
  );
}

// Collapse multiple entries that point at the same folder (same slug), keeping
// the most recently updated. Guards against the duplicate-id rendering + shared
// dropdown state when the un-canonical DB list is shown (packaged app fallback).
function dedupeBySlug<T extends { path: string; updated_at?: number }>(list: T[]): T[] {
  const bySlug = new Map<string, T>();
  for (const p of list) {
    const slug = slugFromPath(p.path);
    const prev = bySlug.get(slug);
    if (!prev || (p.updated_at ?? 0) >= (prev.updated_at ?? 0)) bySlug.set(slug, p);
  }
  return [...bySlug.values()];
}

/**
 * Project listing is now filesystem-first: bridge scans
 * <repoRoot>/projects/*, and the DB only contributes metadata (name,
 * mode, timestamps) for slugs that actually have a folder on disk. Stale
 * DB entries (folder rm'd out-of-band) are auto-pruned on every reload.
 *
 * Tauri mode keeps the DB as source until we wire the native scanner.
 */
export function useProjects() {
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [loading, setLoading] = useState(true);

  const reconcile = useCallback(async () => {
    // The daemon sidecar may not be listening yet at first paint (packaged
    // app). Retry the FS scan a few times before falling back to the DB, so a
    // startup race doesn't surface the un-canonical (possibly stale/dup) DB list.
    let fsList = await listProjectsFromFilesystem();
    for (let i = 0; i < 3 && !fsList; i++) {
      await new Promise((r) => setTimeout(r, 400));
      fsList = await listProjectsFromFilesystem();
    }
    const dbList = await db.getProjects().catch(() => [] as DbProject[]);
    // Bridge still unreachable (Tauri or offline) — fall back to DB-only,
    // deduped by slug so stale duplicate entries don't render twice or share
    // dropdown state (menuOpenFor === p.id).
    if (!fsList) {
      setProjects(dedupeBySlug(dbList ?? []));
      return;
    }
    const dbBySlug = new Map<string, DbProject>();
    for (const e of dbList ?? []) {
      const slug = slugFromPath(e.path);
      const prev = dbBySlug.get(slug);
      if (prev) {
        // Duplicate DB entry for the same folder (accumulated bloat) — keep the
        // newer, prune the older so it can't haunt the DB-fallback list.
        const drop = (e.updated_at ?? 0) >= (prev.updated_at ?? 0) ? prev : e;
        dbBySlug.set(slug, drop === prev ? e : prev);
        void db.deleteProject(drop.id).catch(warn("deleteProject:dup-slug"));
      } else {
        dbBySlug.set(slug, e);
      }
    }
    const dbSlugsSeen = new Set<string>();
    // For each folder: prefer .df/meta.json; fall back to DB metadata;
    // fall back to synthesized defaults. On any miss, write the meta.json
    // so subsequent loads stay filesystem-canonical.
    const merged = await Promise.all(
      fsList.map(async (fs): Promise<DbProject> => {
        dbSlugsSeen.add(fs.slug);
        const meta = await readProjectMeta(fs.slug);
        const dbEntry = dbBySlug.get(fs.slug);
        if (meta) {
          // meta.json wins. Refresh updated_at from disk mtime when newer so
          // the grid sorts by real activity, not only the last metadata write.
          const updatedAt = Math.max(meta.updated_at ?? 0, fs.mtime || 0);
          return {
            id: meta.id,
            name: meta.name,
            path: fs.path,
            mode: meta.mode,
            created_at: meta.created_at,
            updated_at: updatedAt,
          };
        }
        // No meta.json yet — migrate from DB if we have an entry, otherwise
        // synthesize defaults. Either way, persist to meta.json.
        const now = Date.now();
        const synth: ProjectMeta = dbEntry
          ? {
              id: dbEntry.id,
              name: dbEntry.name,
              mode: dbEntry.mode,
              created_at: dbEntry.created_at,
              updated_at: Math.max(dbEntry.updated_at || 0, fs.mtime || now),
            }
          : {
              id: crypto.randomUUID(),
              name: fs.slug,
              mode: "hifi",
              created_at: fs.mtime || now,
              updated_at: fs.mtime || now,
            };
        void writeProjectMeta(fs.slug, synth).catch(warn("writeProjectMeta:fs.slug"));
        // Keep the DB cache in sync for Tauri + quick reads.
        if (!dbEntry) {
          void db
            .createProject(synth.name, fs.path, synth.mode)
            .catch(warn("createProject:reconcile-synth"));
        }
        return {
          id: synth.id,
          name: synth.name,
          path: fs.path,
          mode: synth.mode,
          created_at: synth.created_at,
          updated_at: synth.updated_at,
        };
      }),
    );
    // DB entries whose folder disappeared — remove them so they stop
    // haunting the UI.
    for (const [slug, entry] of dbBySlug) {
      if (!dbSlugsSeen.has(slug)) {
        void db.deleteProject(entry.id).catch(warn("deleteProject:reconcile-stale"));
      }
    }
    setProjects(merged);
  }, []);

  useEffect(() => {
    void reconcile().finally(() => setLoading(false));
  }, [reconcile]);

  // Re-scan when the tab regains focus — covers the case where the user
  // rm's a folder in the terminal and expects the UI to catch up without
  // a full reload.
  useEffect(() => {
    const onFocus = () => {
      void reconcile();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reconcile]);

  const addProject = useCallback(
    async (name: string, path: string, mode: "wireframe" | "hifi"): Promise<DbProject> => {
      const dbProject = await db.createProject(name, path, mode).catch(() => null);
      const project: DbProject = dbProject ?? {
        id: crypto.randomUUID(),
        name,
        path,
        mode,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      // Canonical record on disk — the DB entry is now a cache. We MUST
      // await the write here: if reconcile() runs after addProject (e.g.
      // window focus listener fires after the modal closes) and it sees
      // the project folder without a meta.json, it synthesizes a NEW
      // UUID and overwrites our entry. The EditorRoute then can't find
      // the id we navigated to and redirects to home ("piscou e voltou
      // pra home" repro). Awaiting the write closes that race window.
      const slug = slugFromPath(path);
      if (slug) {
        await writeProjectMeta(slug, {
          id: project.id,
          name: project.name,
          mode: project.mode,
          created_at: project.created_at,
          updated_at: project.updated_at,
        }).catch(warn("writeProjectMeta:addProject"));
      }
      setProjects((prev) => [project, ...prev]);
      return project;
    },
    [],
  );

  const touchProject = useCallback(async (id: string) => {
    await db.touchProject(id).catch(warn("touchProject"));
    const now = Date.now();
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const updated = { ...prev[idx], updated_at: now };
      // Mirror into meta.json so the canonical record stays fresh.
      const slug = slugFromPath(updated.path);
      if (slug) {
        void writeProjectMeta(slug, {
          id: updated.id,
          name: updated.name,
          mode: updated.mode,
          created_at: updated.created_at,
          updated_at: now,
        }).catch(warn("writeProjectMeta:touchProject"));
      }
      const rest = prev.filter((_, i) => i !== idx);
      return [updated, ...rest];
    });
  }, []);

  /**
   * Remove a project end-to-end: folder + DB entry. Throws if the
   * filesystem delete fails so the UI can surface the error instead
   * of silently leaving an orphan folder that reappears on next focus.
   */
  const removeProject = useCallback(
    async (id: string) => {
      const proj =
        (await db.getProjects().catch(() => [])).find((p) => p.id === id) ??
        projects.find((p) => p.id === id);
      const slug = proj ? slugFromPath(proj.path) : null;
      if (!slug) throw new Error(`removeProject: couldn't resolve slug for id=${id}`);
      const fsOk = await removeProjectFolder(slug);
      if (!fsOk) {
        throw new Error(`removeProject: bridge failed to rm -rf projects/${slug}`);
      }
      await db.deleteProject(id).catch(warn("deleteProject:removeProject"));
      setProjects((prev) => prev.filter((p) => p.id !== id));
    },
    [projects],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const next = name.trim();
      if (!next) return;
      const src = projects.find((p) => p.id === id);
      if (!src) return;
      if (next === src.name) return;

      const oldSlug = slugFromPath(src.path);
      const newSlug = slugify(next);
      const cleanSrc = src.path.replace(/\/+$/, "");
      const parent = cleanSrc.replace(/\/[^/]+$/, "") || cleanSrc;
      const newPath = `${parent}/${newSlug}`;
      const now = Date.now();

      let finalPath = src.path;

      // If the slug derived from the new name differs from the current
      // folder slug, try to move the folder. The bridge's /fs/move-dir
      // works on files too, so we can also rename the primary HTML file
      // inside the new folder afterwards. If anything fails, fall back to
      // a name-only rename so the user isn't blocked.
      if (oldSlug && newSlug && oldSlug !== newSlug) {
        const moved = await moveDirViaBridge(src.path, newPath).catch(() => false);
        if (moved) {
          finalPath = newPath;
          // Best-effort rename of the primary HTML file inside the new folder.
          const oldHtml = `${newPath}/${oldSlug}.html`;
          const newHtml = `${newPath}/${newSlug}.html`;
          await moveDirViaBridge(oldHtml, newHtml).catch(warn("moveDirViaBridge:rename-html"));
        }
      }

      // Persist DB + meta with the (possibly new) path + the new name.
      await db
        .updateProject(id, { name: next, path: finalPath })
        .catch(warn("updateProject:rename"));
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: next, path: finalPath, updated_at: now } : p)),
      );
      const finalSlug = slugFromPath(finalPath);
      if (finalSlug) {
        void writeProjectMeta(finalSlug, {
          id: src.id,
          name: next,
          mode: src.mode,
          created_at: src.created_at,
          updated_at: now,
        }).catch(warn("writeProjectMeta:rename"));
      }
    },
    [projects],
  );

  /**
   * Duplicate a project: new DB entry + folder copy + associated chat
   * messages, html snapshot, versions, start-mode preference. New name
   * defaults to "{orig} copy" and the path sits alongside the original.
   */
  const duplicateProject = useCallback(
    async (id: string): Promise<DbProject | null> => {
      const src = projects.find((p) => p.id === id);
      if (!src) return null;
      const newName = `${src.name} copy`;
      const cleanSrc = src.path.replace(/\/+$/, "");
      const parent = cleanSrc.replace(/\/[^/]+$/, "") || cleanSrc;
      const baseSlug = slugify(newName);
      const suffix = Date.now().toString(36).slice(-4);
      const newPath = `${parent}/${baseSlug}-${suffix}`;
      const dup = await addProject(newName, newPath, src.mode);
      copyDirViaBridge(src.path, dup.path).catch(warn("copyDirViaBridge:duplicate"));
      const keys = [
        `html:${src.id}`,
        `versions:${src.id}`,
        `startMode:${src.id}`,
        `edit:${src.id}`,
      ];
      await Promise.all(
        keys.map(async (k) => {
          const v = await db.getSetting(k).catch(() => null);
          if (v != null)
            await db
              .setSetting(k.replace(src.id, dup.id), v)
              .catch(warn("setSetting:k.replace(src.id,dup.id)"));
        }),
      );
      const msgs = await db.getMessages(src.id).catch(() => []);
      for (const m of msgs) {
        await db.saveMessage(dup.id, m.role, m.content, m.is_design).catch(warn("saveMessage:dup"));
      }
      return dup;
    },
    [projects, addProject],
  );

  /**
   * Move a project folder and update the DB path. If the source folder doesn't
   * exist on disk the DB still moves — useful when the user wants to retarget.
   */
  const moveProject = useCallback(
    async (id: string, newPath: string) => {
      const src = projects.find((p) => p.id === id);
      if (!src) return;
      if (src.path !== newPath) {
        moveDirViaBridge(src.path, newPath).catch(warn("moveDirViaBridge:move"));
      }
      await db.updateProject(id, { path: newPath }).catch(warn("updateProject:move"));
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, path: newPath, updated_at: Date.now() } : p)),
      );
    },
    [projects],
  );

  return {
    projects,
    loading,
    addProject,
    touchProject,
    removeProject,
    renameProject,
    duplicateProject,
    moveProject,
    // Expose a manual refresh — handy from tests + the "Rescan projects"
    // affordance we might add later.
    refresh: reconcile,
  };
}

// Re-export the FS type for consumers that want to know we're fs-driven now.
export type { FsProject };
