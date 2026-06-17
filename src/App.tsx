import { useEffect, useState, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ClaudeStreamProvider } from "@/contexts/ClaudeStreamContext";
import { HomeScreen } from "@/screens/HomeScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SkillCoverPreviewScreen } from "@/screens/SkillCoverPreviewScreen";
import { DsPreviewScreen } from "@/screens/DsPreviewScreen";
import type { DsEntry } from "@/types/ds";
import { useProjects } from "@/hooks/useProjects";
import {
  db,
  mkdirViaBridge,
  writeFile,
  readGlobalConfig,
  writeGlobalConfig,
  listDesignSystemsFromFilesystem,
} from "@/lib/claude-bridge";
import { setLang, t as tFn, type Lang } from "@/i18n";
import {
  setFormatOverrides,
  setDirectionOverrides,
  setDisabledFormatIds,
  setDisabledDirectionIds,
  setCustomFormats,
  setCustomDirections,
} from "@/data/direction-data";
import { warn } from "@/lib/error-surface";
import { slugFromPath } from "@/lib/project-files";
import {
  setUserRules as setRulesUserSlot,
  setBuiltinOverrides as setRulesBuiltinOverrides,
  setDisabledRuleIds,
  setCustomRuleCategories,
  setCategoryLabelOverrides,
  RuleSchema,
  type Rule,
} from "@/data/rules-taxonomy";
import { setCustomFormatCategories } from "@/data/format-taxonomy";
import { ErrorToastDock } from "@/components/ErrorToastDock";
import { OriginGuardBanner } from "@/components/OriginGuardBanner";
import { startRecoverySync } from "@/lib/chat-recovery-sync";
import { useThemeOverrides } from "@/hooks/useThemeOverrides";

export type StartMode = "prototype" | "slide" | "template" | "other";

// Every screen, tab, sub-tab and project has a URL. Single source of truth.
// Route map:
//   /                        → Home (projects tab)
//   /templates               → Home (templates tab)
//   /design-systems          → Home (design-systems tab)
//   /directions              → Home (directions tab)
//   /skills                  → Home (skills tab)
//   /projects/:id            → Editor for a project
//   /ds/:slug                → DS preview (legacy DsPreviewScreen)
//   /settings                → Settings (default section)
//   /settings/:section       → Settings at a specific sub-tab
//   *                        → /
// Dev-only (import.meta.env.DEV; tree-shaken from the public build):
//   /dev                     → Dev harness (?dev=1 query also forwards here)
//   /showcase, /showcase/skeu, /skeu, /shaders → component galleries
//   /lab, /regions, /np-* , /np-hub → experimental new-project flows
export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const navigate = useNavigate();
  const location = useLocation();

  // User ask 2026-05-21: "quero ver na pratica em preview, nao em
  // ascii". When the URL carries ?preview=skill-covers, render the
  // candidate-cover gallery instead of the regular app shell. Plain
  // query check — no router change, no nav menu, no link. Type
  // ?preview=skill-covers manually to open it.
  const isCoverPreview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "skill-covers";

  // Mount theme override hook at the app root so user-customized color
  // tokens apply everywhere. Hook injects a <style id="df-theme-overrides">
  // tag on top of tokens.css.
  useThemeOverrides();

  // Audit Fase 2 — start the chat-recovery sync worker. Fires a pass at
  // boot and re-runs on window focus / online events so turns that
  // landed in localStorage during a daemon outage flush back to disk
  // without manual intervention.
  useEffect(() => {
    const teardown = startRecoverySync();
    return teardown;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Load theme + accent + orphan cleanup on first mount. Filesystem config
  // wins over DB so a device sync (config.json via rsync) carries
  // appearance along. DB fallback kicks in when bridge is offline / Tauri
  // hasn't wired /config yet.
  useEffect(() => {
    (async () => {
      const fromFs = await readGlobalConfig();
      if (fromFs && (fromFs.theme === "light" || fromFs.theme === "dark")) {
        setTheme(fromFs.theme);
      } else {
        const val = await db.getSetting("theme").catch(() => null);
        if (val === "light" || val === "dark") setTheme(val);
      }
      // Rehydrate the UI language from filesystem config (or DB
      // fallback). The `df_language` localStorage entry already
      // bootstrapped synchronously at i18n module load — this brings
      // the canonical disk value forward in case it differs (e.g.
      // the user changed language on another device + rsynced
      // config). In DEV the pseudo-locale "xx" is also valid; it's
      // persisted in localStorage only (the filesystem config never
      // sees it), so a deliberately-set "xx" must not be overwritten
      // by the disk value.
      const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
      let nextLang: Lang | null = null;
      if (fromFs?.language === "pt" || fromFs?.language === "en") {
        nextLang = fromFs.language;
      } else {
        const dbLang = await db.getSetting("language").catch(() => null);
        if (dbLang === "pt" || dbLang === "en") nextLang = dbLang;
      }
      // If we're already in xx (DEV pseudo-locale), keep it — disk value
      // would be pt/en and would clobber the debug toggle on every reload.
      try {
        const lsLang = window.localStorage?.getItem("df_language");
        if (isDev && lsLang === "xx") nextLang = null;
      } catch {
        /* swallow */
      }
      if (nextLang) setLang(nextLang);
      // Apply user accent (single app-wide accent color, set in Settings →
      // Appearance). Falls back to the token default (olive) when unset.
      const accent =
        (fromFs?.accent_color as string | undefined) ??
        (await db.getSetting("accent_color").catch(() => null));
      if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
        document.documentElement.style.setProperty("--df-accent-user", accent);
      }
      // Bootstrap user overrides for formats + directions. Defaults live
      // in direction-data.ts (read-only); these maps are merged on top at
      // runtime via the effective-getter functions.
      if (fromFs?.format_overrides) {
        setFormatOverrides(fromFs.format_overrides);
      }
      if (fromFs?.direction_overrides) {
        setDirectionOverrides(fromFs.direction_overrides);
      }
      // Disabled lists — items toggled OFF in Settings should NOT appear in
      // the Direction Modal. Stored in db.setSetting (per-device).
      try {
        const fmtRaw = await db.getSetting("formats_disabled").catch(() => null);
        if (fmtRaw) {
          const a = JSON.parse(fmtRaw);
          if (Array.isArray(a)) setDisabledFormatIds(a);
        }
        const dirRaw = await db.getSetting("directions_disabled").catch(() => null);
        if (dirRaw) {
          const a = JSON.parse(dirRaw);
          if (Array.isArray(a)) setDisabledDirectionIds(a);
        }
      } catch {}
      // Custom formats / directions authored by the user. Persisted in
      // global config (filesystem) so they sync between devices.
      if (Array.isArray(fromFs?.custom_formats)) {
        setCustomFormats(fromFs!.custom_formats as never);
      }
      if (Array.isArray(fromFs?.custom_directions)) {
        setCustomDirections(fromFs!.custom_directions as never);
      }
      // Unified rules catalog bootstrap.
      if (Array.isArray(fromFs?.custom_rules)) {
        const parsed: Rule[] = [];
        for (const raw of fromFs!.custom_rules) {
          const r = RuleSchema.safeParse(raw);
          if (r.success) parsed.push(r.data);
        }
        setRulesUserSlot(parsed);
      } else {
        // DB fallback when filesystem bridge is offline.
        const dbRules = await db.getSetting("custom_rules").catch(() => null);
        if (dbRules) {
          try {
            const arr = JSON.parse(dbRules);
            if (Array.isArray(arr)) {
              const parsed: Rule[] = [];
              for (const raw of arr) {
                const r = RuleSchema.safeParse(raw);
                if (r.success) parsed.push(r.data);
              }
              setRulesUserSlot(parsed);
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (fromFs?.builtin_rule_overrides && typeof fromFs.builtin_rule_overrides === "object") {
        setRulesBuiltinOverrides(fromFs.builtin_rule_overrides as never);
      } else {
        const dbOver = await db.getSetting("builtin_rule_overrides").catch(() => null);
        if (dbOver) {
          try {
            const obj = JSON.parse(dbOver);
            if (obj && typeof obj === "object") setRulesBuiltinOverrides(obj as never);
          } catch {
            /* ignore */
          }
        }
      }
      const dbDisabled = await db.getSetting("rules_disabled").catch(() => null);
      if (dbDisabled) {
        try {
          const arr = JSON.parse(dbDisabled);
          if (Array.isArray(arr)) setDisabledRuleIds(arr);
        } catch {
          /* ignore */
        }
      }

      // category overrides + custom categories (Padrões mgmt)
      if (Array.isArray(fromFs?.custom_rule_categories)) {
        setCustomRuleCategories(fromFs!.custom_rule_categories as never);
      } else {
        const dbCats = await db.getSetting("custom_rule_categories").catch(() => null);
        if (dbCats) {
          try {
            const arr = JSON.parse(dbCats);
            if (Array.isArray(arr)) setCustomRuleCategories(arr);
          } catch {
            /* ignore */
          }
        }
      }
      if (fromFs?.rule_category_overrides && typeof fromFs.rule_category_overrides === "object") {
        setCategoryLabelOverrides(fromFs.rule_category_overrides as never);
      } else {
        const dbCatOver = await db.getSetting("rule_category_overrides").catch(() => null);
        if (dbCatOver) {
          try {
            const obj = JSON.parse(dbCatOver);
            if (obj && typeof obj === "object") setCategoryLabelOverrides(obj as never);
          } catch {
            /* ignore */
          }
        }
      }
      if (Array.isArray(fromFs?.custom_format_categories)) {
        setCustomFormatCategories(fromFs!.custom_format_categories as never);
      } else {
        const dbFmtCats = await db.getSetting("custom_format_categories").catch(() => null);
        if (dbFmtCats) {
          try {
            const arr = JSON.parse(dbFmtCats);
            if (Array.isArray(arr)) setCustomFormatCategories(arr);
          } catch {
            /* ignore */
          }
        }
      }
    })();
    (document.documentElement.style as unknown as { zoom?: string }).zoom = "1";
    const ORPHANS = [
      "ui_zoom",
      "loader_selection",
      "loader_rotation_ms",
      "loader_transition_ms",
      "default_agent",
      "initial_commands",
    ];
    ORPHANS.forEach((k) => db.setSetting(k, "").catch(warn("setSetting:k")));
  }, []);

  // Legacy ?dev=1 → forward to /dev and strip the query.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("dev") === "1" && !location.pathname.startsWith("/dev")) {
      sp.delete("dev");
      const qs = sp.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      navigate("/dev", { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleThemeChange = (t: "dark" | "light") => {
    setTheme(t);
    // Canonical store is filesystem config; DB mirror kept for offline
    // read paths until we nuke the db wrapper entirely.
    void writeGlobalConfig({ theme: t }).catch(warn("writeGlobalConfig:theme"));
    db.setSetting("theme", t).catch(warn("setSetting:theme"));
  };

  const projectsApi = useProjects();

  // Navigates to settings while remembering where we came from. Defaults to
  // "agents-workspace" when explicitly opening Settings from an onboarding
  // prompt (the workspace picker lives there — not Appearance).
  const openSettings = (section?: string) => {
    const target = `/settings${section ? `/${section}` : ""}`;
    navigate(target, { state: { from: location.pathname } });
  };

  // Dev preview short-circuit. Skip the rest of the shell so the gallery
  // gets the full viewport without sidebar/topbar competing for space.
  if (isCoverPreview) {
    return <SkillCoverPreviewScreen />;
  }

  return (
    <ClaudeStreamProvider>
      <div style={{ height: "100%", position: "relative" }}>
        <OriginGuardBanner />
        <Suspense fallback={null}>
          <Routes>
            <Route
              path="/"
              element={
                <HomeRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />
            <Route
              path="/templates"
              element={
                <HomeRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />
            <Route
              path="/design-systems"
              element={
                <HomeRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />
            <Route
              path="/directions"
              element={
                <HomeRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />
            <Route
              path="/skills"
              element={
                <HomeRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />

            <Route
              path="/projects/:id"
              element={
                <EditorRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                  projectsApi={projectsApi}
                />
              }
            />

            <Route
              path="/ds/:slug"
              element={
                <DsPreviewRoute
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  openSettings={openSettings}
                />
              }
            />

            <Route
              path="/settings"
              element={<SettingsRoute theme={theme} onThemeChange={handleThemeChange} />}
            />
            <Route
              path="/settings/:section"
              element={<SettingsRoute theme={theme} onThemeChange={handleThemeChange} />}
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {/* Diagnostics drawer — opened via ⌘⇧D keyboard shortcut or the
          "Inspector" button in the editor footer. No floating button:
          the entry point is pinned to the status bar rather than a
          standalone FAB. */}

        {/* Surfaces silent runtime failures (persist, load, schema drift, etc).
          Replaces the old `.catch(() => {})` patterns where the user
          had no idea something failed. See lib/error-surface.ts. */}
        <ErrorToastDock />
      </div>
    </ClaudeStreamProvider>
  );
}

// ── Stable slug from a DS entry path. ─────────────────────────────────────
export function dsSlug(entry: { path: string; name?: string }): string {
  const tail = entry.path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  const seed = (tail || entry.name || "ds").toLowerCase();
  return seed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ds";
}

// ── Route wrappers ────────────────────────────────────────────────────────

interface SharedProps {
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
  openSettings: (section?: string) => void;
  projectsApi: ReturnType<typeof useProjects>;
}

function HomeRoute({ theme, onThemeChange, openSettings, projectsApi }: SharedProps) {
  const navigate = useNavigate();
  const { projects, addProject, touchProject, removeProject, renameProject, duplicateProject } =
    projectsApi;

  const handleOpenProject = async (
    path: string,
    _name: string,
    _mode: "wireframe" | "hifi",
    id: string,
  ) => {
    touchProject(id);
    mkdirViaBridge(path).catch(warn("mkdirViaBridge:path"));
    navigate(`/projects/${id}`);
  };

  const handleCreateProject = async (
    name: string,
    path: string,
    mode: "wireframe" | "hifi",
    startMode: StartMode = "prototype",
    initialPrompt?: string,
    cwdOverride?: string,
    initialHtml?: string,
    extras?: {
      rawPrompt?: string;
      directionSelection?: unknown;
      /** canonicalPlus carries the NewProject modal selections that
       *  used to be discarded (format · rules · taste). Persisted as
       *  `canonicalPlus:${projectId}` so EditorScreen can read it
       *  on the project's first turn and inject the corresponding
       *  block into the system prompt via canonical-plus-prompt.ts. */
      canonicalPlus?: unknown;
    },
  ) => {
    const p = await addProject(name, path, mode);
    await db.setSetting(`startMode:${p.id}`, startMode).catch(warn("setSetting:startMode::p.id"));
    if (cwdOverride && cwdOverride.trim()) {
      await db.setSetting(`cwd:${p.id}`, cwdOverride.trim()).catch(warn("setSetting:cwd::p.id"));
    }
    if (initialPrompt && initialPrompt.trim()) {
      await db
        .setSetting(`initialPrompt:${p.id}`, initialPrompt.trim())
        .catch(warn("setSetting:initialPrompt::p.id"));
    }
    if (extras?.rawPrompt && extras.rawPrompt.trim()) {
      await db
        .setSetting(`rawPrompt:${p.id}`, extras.rawPrompt.trim())
        .catch(warn("setSetting:rawPrompt::p.id"));
    }
    if (extras?.directionSelection) {
      await db
        .setSetting(`directionSelection:${p.id}`, JSON.stringify(extras.directionSelection))
        .catch(warn("setSetting:directionSelection::p.id"));
    }
    if (extras?.canonicalPlus) {
      // The NewProject modal hands a `canonicalPlus` payload with
      // { format, rules, taste, ... }. Persist verbatim — the shape is
      // owned by canonical-plus-prompt.ts on the read side, and we
      // don't want App.tsx to grow a parallel schema definition.
      await db
        .setSetting(`canonicalPlus:${p.id}`, JSON.stringify(extras.canonicalPlus))
        .catch(warn("setSetting:canonicalPlus::p.id"));
    }
    await mkdirViaBridge(p.path).catch((e) => {
      console.error("[create-project] mkdirViaBridge failed", p.path, e);
    });
    if (initialHtml && initialHtml.trim().length >= 20) {
      const slug = slugFromPath(p.path) || p.id;
      const filePath = `${p.path.replace(/\/$/, "")}/${slug}.html`;
      // Cache the HTML first so the editor can render even if the bridge
      // write fails (e.g. content didn't pass markup validation).
      await db.setSetting(`html:${p.id}`, initialHtml).catch(warn("setSetting:html::p.id"));
      try {
        await writeFile(filePath, initialHtml);
      } catch (e) {
        console.error("[create-project] writeFile failed", filePath, e);
        throw e;
      }
    }
    navigate(`/projects/${p.id}`);
  };

  return (
    <HomeScreen
      projects={projects}
      onOpenProject={handleOpenProject}
      onCreateProject={handleCreateProject}
      onOpenSettings={openSettings}
      theme={theme}
      onThemeChange={onThemeChange}
      onRenameProject={renameProject}
      onDeleteProject={async (id) => {
        try {
          await removeProject(id);
        } catch (e) {
          console.error("[projects] delete failed", e);
          alert(`Failed to delete project: ${String(e instanceof Error ? e.message : e)}`);
        }
      }}
      onDuplicateProject={(id) => {
        void duplicateProject(id);
      }}
      onOpenDs={(entry) => navigate(`/ds/${dsSlug(entry)}`)}
    />
  );
}

function EditorRoute({ theme, onThemeChange, openSettings, projectsApi }: SharedProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, duplicateProject } = projectsApi;
  const [startMode, setStartMode] = useState<StartMode | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
  // Grace window before bailing back to home when projects[] doesn't yet
  // contain the navigated id. Right after creation, addProject's
  // setProjects + a focus-driven reconcile() can race; the new id may
  // briefly be absent before propagating. Without grace the editor
  // mounted, found nothing, and bounced to home — the "piscou e voltou
  // pra home" repro the user hit.
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const project = id ? projects.find((p) => p.id === id) : undefined;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const rawMode = await db.getSetting(`startMode:${id}`).catch(() => null);
      if (cancelled) return;
      setStartMode(
        rawMode === "slide" || rawMode === "template" || rawMode === "other"
          ? rawMode
          : "prototype",
      );
      const rawPrompt = await db.getSetting(`initialPrompt:${id}`).catch(() => null);
      if (cancelled) return;
      setInitialPrompt(rawPrompt || undefined);
      if (rawPrompt)
        await db.setSetting(`initialPrompt:${id}`, "").catch(warn("setSetting:initialPrompt::id"));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Redirect home only AFTER waiting ~600ms for projects[] to settle. If
  // the project shows up in that window (race resolves), we skip the
  // redirect entirely.
  useEffect(() => {
    if (project) {
      setShouldRedirect(false);
      return;
    }
    if (projects.length === 0) return;
    if (!id) return;
    const t = window.setTimeout(() => {
      console.warn("[editor-route] project not found after grace, redirecting", {
        id,
        projectsLen: projects.length,
      });
      setShouldRedirect(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [project, projects.length, id]);

  if (!id) return <Navigate to="/" replace />;
  if (projects.length === 0) return null;
  if (!project && shouldRedirect) return <Navigate to="/" replace />;
  if (!project) return null;
  if (!startMode) return null;

  return (
    <EditorScreen
      // Force a full remount whenever the user switches projects. Without this
      // key, React Router replaces the URL but EditorScreen keeps its prior
      // useState (iframeHtml, messages, selectedProvider, etc), so opening a
      // new project right after another could send the OLD project's iframeHtml
      // into the next turn's system prompt before the async file-load effect
      // overwrote it. The leak surfaced as "the model is using HTML from a
      // different project" when two projects shared a base name. Remount is
      // cheap; the effects re-hydrate from disk on mount.
      key={project.id}
      projectId={project.id}
      projectName={project.name}
      projectPath={project.path}
      mode={project.mode}
      startMode={startMode}
      initialPrompt={initialPrompt}
      theme={theme}
      onThemeChange={onThemeChange}
      onHome={() => navigate("/")}
      onOpenSettings={() => openSettings()}
      onDuplicateProject={(dupId) => {
        void duplicateProject(dupId);
        navigate("/");
      }}
    />
  );
}

function DsPreviewRoute({ theme, onThemeChange, openSettings }: Omit<SharedProps, "projectsApi">) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<DsEntry | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not-found" | "no-list">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Filesystem first (wave 4) — derive the DS list from
      // design-systems/*/design.md. DB fallback kept for offline / Tauri.
      const fsList = await listDesignSystemsFromFilesystem();
      if (cancelled) return;
      if (fsList && fsList.length > 0) {
        const match = fsList.find(
          (d) => d.slug === slug || dsSlug({ path: d.path, name: d.name }) === slug,
        );
        if (!match) {
          setStatus("not-found");
          return;
        }
        setEntry({
          name: match.name,
          path: match.path,
          designMdPath: match.designMdPath,
          source: "folder",
          addedAt: match.mtime,
        });
        setStatus("ok");
        return;
      }
      // Bridge reachable but empty — check DB before giving up.
      const raw = await db.getSetting("design_systems").catch(() => null);
      if (cancelled) return;
      if (!raw) {
        setStatus("no-list");
        return;
      }
      try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.length === 0) {
          setStatus("no-list");
          return;
        }
        const match =
          list.find((x: any) => dsSlug({ path: x.path, name: x.name }) === slug) ?? null;
        if (!match) {
          setStatus("not-found");
          return;
        }
        setEntry({
          name: match.name ?? "design system",
          path: match.path,
          designMdPath: match.designMdPath || `${match.path?.replace(/\/$/, "")}/design.md`,
          source: match.source || "folder",
          sourceRef: match.sourceRef,
          addedAt: match.addedAt ?? Date.now(),
        });
        setStatus("ok");
      } catch {
        setStatus("not-found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (status === "loading") return null;
  if (status !== "ok" || !entry) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "var(--df-sp-5)",
          background: "var(--df-bg-base)",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            textAlign: "center",
            color: "var(--df-text-secondary)",
            fontFamily: "var(--df-font-sans)",
          }}
        >
          <h1
            style={{
              fontSize: "var(--df-text-xl)",
              color: "var(--df-text-primary)",
              marginBottom: 8,
            }}
          >
            {status === "no-list" ? "No design systems yet" : "Design system not found"}
          </h1>
          <p style={{ fontSize: "var(--df-text-sm)", lineHeight: 1.55, marginBottom: 18 }}>
            {status === "no-list" ? (
              "You haven't added any DS. Create one from the design systems tab."
            ) : (
              <>
                No DS matches <code style={{ fontFamily: "var(--df-font-mono)" }}>{slug}</code>. It
                may have been renamed or removed.
              </>
            )}
          </p>
          <button className="df-btn df-btn--primary" onClick={() => navigate("/design-systems")}>
            Back to design systems
          </button>
        </div>
      </div>
    );
  }

  return (
    <DsPreviewScreen
      entry={entry}
      onBack={() => navigate("/design-systems")}
      onOpenSettings={() => openSettings()}
      theme={theme}
      onThemeChange={onThemeChange}
    />
  );
}

function SettingsRoute({
  theme,
  onThemeChange,
}: Omit<SharedProps, "openSettings" | "projectsApi">) {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  // label flips with language. Reads tFn at render
  // time — Settings re-renders when lang event fires (via useT) and the
  // wrapper passes the freshly-localized label as a prop.
  const backLabel =
    !from || from === "/"
      ? tFn("settings.back.home")
      : from.startsWith("/projects/")
        ? tFn("settings.back.project")
        : from.startsWith("/ds/")
          ? tFn("settings.back.ds")
          : from === "/design-systems"
            ? tFn("settings.back.designsystems")
            : tFn("settings.back");

  return (
    <SettingsScreen
      theme={theme}
      onThemeChange={onThemeChange}
      onBack={() => navigate(from || "/")}
      returnLabel={backLabel}
      section={section}
      onSectionChange={(s) => navigate(`/settings/${s}`, { state: { from }, replace: true })}
    />
  );
}
