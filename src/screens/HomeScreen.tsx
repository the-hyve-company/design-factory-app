import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { SkeuHero } from "@/components/SkeuHero";
import { DfModal } from "@/components/DfModal";
import { DirectionModal } from "@/components/DirectionModal";
import { NewProjectModal, type NewProjectFormPayload } from "@/components/NewProjectModal";
import type { DirectionSelection } from "@/data/direction-data";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProjectCover } from "@/components/ProjectCover";
import { AgentPicker } from "@/components/AgentPicker";
import { ProviderBanner } from "@/components/ProviderBanner";
import { TabCornerLeft, TabCornerRight } from "@/components/TabCorner";
import { EntityCard } from "@/components/EntityCard";
import { useT, tf } from "@/i18n";
import { db, readFileViaBridge, refreshBridgeStatus, fetchWorkspaceInfo, writeGlobalConfig, writeBinaryViaBridge, writeFile, listDesignSystemsFromFilesystem, removeDsFolder, readProjectMeta, installSkill, parseSkillMarkdown, deleteSkill, listFolder, type Skill } from "@/lib/claude-bridge";
import { slugFromPath } from "@/lib/project-files";
// CharacterCover import removed 2026-05-21 — Skills now use the soft
// Logo cover (option E). Component file kept at
// src/components/CharacterCover.tsx for the preview gallery
// (?preview=skill-covers) and for a possible future setting that
// brings the creatures back.
import type { RatioId } from "@/runtime/hyperframes-invoker";
import { parseDesignSystem } from "@/lib/ds-google";
import { DsSetupModal, type DsEntry } from "@/components/DsSetupModal";
import { DsModalLab } from "@/components/lab/DsModalLab";
import { PadroesConfirmModal } from "@/components/PadroesConfirmModal";
import { SkillCreateModal } from "@/components/SkillCreateModal";
import { SkillImportModal } from "@/components/SkillImportModal";
import { SkillDetailModal } from "@/components/SkillDetailModal";
import { useSkillRegistry } from "@/hooks/useSkillRegistry";
import { parseSkillZip } from "@/lib/skill-zip-import";
import type { Project } from "@/hooks/useProjects";
import type { ProviderId } from "@/providers/types";
import {
  getModelsForProvider,
  defaultModelForProvider,
  readLastModel,
  writeLastModel,
  useLiveModelOptions,
} from "@/providers/model-lists";
import { ProviderIdSchema } from "@/lib/schemas";
// Regions Lab CSS — provides the .reg-* classes used by the New
// Project create card.
import "@/styles/np-regions-lab.css";
// Home layout: unified topbar, single-stage body, 3-col grid, CTA
// plate, premium TE-vibe.
import "@/styles/np-v8.css";
// Canonical skeumorphic hero pattern (DNA reference). Provides
// .skeu-hero + bezel depth tokens reused everywhere.
import "@/styles/skeu-hero.css";

// Modal-lab toggle (dev only). ?modalLab=1 swaps the DS / Skills modals for
// the redesign directions so they can be compared live in dev:web. The flag
// sticks in localStorage once seen, so it survives the dev:web auto-open
// landing on a paramless URL and any in-app navigation. ?modalLab=0 clears it.
// Off by default — production renders the shipped modals.
const MODAL_LAB = (() => {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("modalLab");
    if (param === "1") { window.localStorage?.setItem("DF_MODAL_LAB", "1"); return true; }
    if (param === "0") { window.localStorage?.removeItem("DF_MODAL_LAB"); return false; }
    return window.localStorage?.getItem("DF_MODAL_LAB") === "1";
  } catch { return false; }
})();

type DesignSystem = DsEntry;

// Session-scoped caches for project cover data. HomeScreen unmounts every
// time the user navigates into a project and back, which reset the in-state
// maps to {} and re-read EVERY project's full HTML from disk, sequentially,
// on each return — the "carrega tudo do 0 / previews demoram" the user hit.
// These module-level maps survive remounts (cleared only on full page
// reload), so returning to Home is instant for already-seen projects.
// Keyed by project id; carries the updated_at it was loaded at so an edited
// project (folder mtime bumps updated_at) invalidates and re-fetches instead
// of showing a stale cover.
const projectHtmlCache = new Map<string, { updatedAt: number; html: string }>();
const projectRatioCache = new Map<string, { updatedAt: number; ratio: RatioId }>();
// Parsed DS cover palette, keyed by design.md path. DsCardPreview re-read +
// re-parsed the full design.md on every mount (slow with several DS cards,
// "capas de ds demorando pra carregar só cores"). Cache the parsed result so
// remounts paint instantly. Session-scoped (cleared on full reload).
const dsColorCache = new Map<string, { state: "ok" | "empty" | "missing"; colors: string[] | null }>();

interface HomeScreenProps {
  projects: Project[];
  onOpenProject: (
    path: string,
    name: string,
    mode: "wireframe" | "hifi",
    id: string
  ) => void;
  onCreateProject: (
    name: string,
    path: string,
    mode: "wireframe" | "hifi",
    startMode?: "prototype" | "slide" | "template" | "other",
    initialPrompt?: string,
    cwdOverride?: string,
    initialHtml?: string,
    extras?: {
      /** User's raw prompt before formato/direction composition */
      rawPrompt?: string;
      /** Snapshot of the DirectionSelection at creation */
      directionSelection?: DirectionSelection | null;
    },
  ) => void | Promise<void>;
  onOpenSettings: (section?: string) => void;
  theme?: "dark" | "light";
  onThemeChange?: (theme: "dark" | "light") => void;
  onRenameProject: (id: string, name: string) => void | Promise<void>;
  onDeleteProject: (id: string) => void | Promise<void>;
  onDuplicateProject?: (id: string) => void | Promise<void>;
  onOpenDs?: (entry: DsEntry) => void;
}

type RightTab = "projects" | "templates" | "design-systems" | "skills";
const PATH_TO_TAB: Record<string, RightTab> = {
  "/": "projects",
  "/projects": "projects",
  "/templates": "templates",
  "/design-systems": "design-systems",
  "/skills": "skills",
};
const TAB_TO_PATH: Record<RightTab, string> = {
  projects: "/",
  templates: "/templates",
  "design-systems": "/design-systems",
  skills: "/skills",
};
// ProviderId now imported from @/providers/types (Provider Handoff Layer v0
// — was a literal "claude" type alias that quietly forced this whole screen
// to single-provider mode despite 7 adapters shipping in the registry).

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "Today";
  if (diffMs < 2 * day) return "Yesterday";
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// User ask 2026-05-21 (Editorial mono card direction): title-case
// the name so kebab/snake/lowercase slugs read as proper titles in the
// card hero. Trigger / source / date go to the subtitle + tooltip, not
// the title.
function prettifyName(raw: string): string {
  if (!raw) return raw;
  const cleaned = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  // If the source already mixes case (e.g. "My Project"), leave it
  // alone — only the all-lower / all-kebab slugs need title-casing.
  if (/[A-Z]/.test(cleaned) && /[a-z]/.test(cleaned)) return cleaned;
  return cleaned.split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}


export function HomeScreen({
  projects,
  onOpenProject,
  onCreateProject,
  onOpenSettings,
  theme,
  onThemeChange,
  onRenameProject,
  onDeleteProject,
  onDuplicateProject,
  onOpenDs,
}: HomeScreenProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  // Active tab derives from the URL. `/` → projects, `/templates`, `/design-systems`,
  // `/skills`. Tab click navigates so every state is shareable/reloadable.
  const rightTab: RightTab = PATH_TO_TAB[location.pathname] ?? "projects";
  const setRightTab = useCallback((next: RightTab) => {
    const path = TAB_TO_PATH[next];
    if (path && path !== location.pathname) navigate(path);
  }, [navigate, location.pathname]);
  const [projectName, setProjectName] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [directionSelection, setDirectionSelection] = useState<DirectionSelection | null>(null);
  const [showDirectionModal, setShowDirectionModal] = useState(false);
  // Provider chosen in the topbar AgentPicker. We mirror it here so the
  // create-form can show "Provider: X" + offer the matching model dropdown.
  // Updated via the `df:provider-change` event the AgentPicker fires on pick.
  const [createProvider, setCreateProvider] = useState<ProviderId>("claude");
  // Model picked for this new project. Falls back to defaultModelForProvider
  // when no per-provider memory exists. Persisted via writeLastModel so the
  // next New Project session remembers what the user picked.
  const [createModel, setCreateModel] = useState<string>(() =>
    readLastModel("claude") ?? defaultModelForProvider("claude"),
  );
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelMenuQuery, setModelMenuQuery] = useState("");
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelRockerRef = useRef<HTMLButtonElement>(null);
  // Computed coords for the menu — anchored to the rocker rect so it
  // opens right above/below the trigger instead of bottom-right of viewport.
  const [modelMenuCoords, setModelMenuCoords] = useState<{ top: number; left: number; width: number; openUpward: boolean } | null>(null);
  // Live model options for the inline rocker — Ollama/OpenRouter probe
  // runtime, others fall back to the static catalog.
  const { options: liveModelOpts, loading: modelsLoading } = useLiveModelOptions(createProvider);
  // Reset query + close menu when provider switches.
  useEffect(() => { setShowModelMenu(false); setModelMenuQuery(""); }, [createProvider]);
  // Click-outside handler — closes the floating menu, but ignore the
  // rocker trigger itself (it toggles via aria-expanded).
  useEffect(() => {
    if (!showModelMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelMenuRef.current?.contains(target)) return;
      const trigger = (target as Element)?.closest?.('[data-model-trigger="true"]');
      if (trigger) return;
      setShowModelMenu(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showModelMenu]);
  // Compute menu coords from the rocker's bounding rect on open + on
  // resize/scroll while open. Opens UPWARD when the rocker sits in the
  // bottom half of the viewport (typical case — prompt bar lives near
  // the bottom of the create card).
  useEffect(() => {
    if (!showModelMenu) { setModelMenuCoords(null); return; }
    const update = () => {
      const r = modelRockerRef.current?.getBoundingClientRect();
      if (!r) return;
      const menuMaxH = Math.min(window.innerHeight * 0.6, 480);
      const spaceBelow = window.innerHeight - r.bottom;
      const openUpward = spaceBelow < menuMaxH + 24 && r.top > menuMaxH + 24;
      const width = Math.min(420, window.innerWidth - 48);
      // Anchor right edge to rocker right edge; keep min margin from window.
      let left = r.right - width;
      if (left < 12) left = 12;
      const top = openUpward ? r.top - 8 : r.bottom + 6;
      setModelMenuCoords({ top, left, width, openUpward });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showModelMenu]);
  const [query, setQuery] = useState("");
  // CWD = folder the claude CLI spawns in. Now pinned to the design-factory
  // repo root via the bridge's workspace-info — no per-project override, no
  // user-picked folder. User decision: "quero q o app so funcione agora
  // dentro da pasta design-factory, sem opcao de apontar outra pasta".
  const [defaultCwd, setDefaultCwd] = useState<string>("");
  // projectsFolder = where new project directories get created. Default
  // comes from the bridge's workspace-info (<repoRoot>/projects) so we never
  // ship a literal `~/...` into syscall-based writes. User can override in
  // Settings > Agents & workspace.
  const [projectsFolder, setProjectsFolder] = useState<string>("");
  useEffect(() => {
    // Always trust the bridge's repo root — no more persisted overrides.
    // The old workspace_root / projects_folder settings are intentionally
    // ignored so the user can't end up in a stale directory.
    fetchWorkspaceInfo().then((info) => {
      if (!info) return;
      setProjectsFolder(info.projectsDir);
      setDefaultCwd(info.repoRoot);
    }).catch(() => {});
    // Read the topbar AgentPicker's choice from global config + listen for
    // changes. P0 fix: the prior `if (raw === "claude")` literal silently
    // dropped every other provider, locking the New Project form to Claude.
    db.getSetting("default_provider").then((raw) => {
      const parsed = ProviderIdSchema.safeParse(raw);
      if (parsed.success) {
        setCreateProvider(parsed.data);
        const remembered = readLastModel(parsed.data);
        setCreateModel(remembered ?? defaultModelForProvider(parsed.data));
      }
    }).catch(() => {});
    const onProviderChange = (e: Event) => {
      const detail = (e as CustomEvent<{ providerId?: string }>).detail;
      const parsed = ProviderIdSchema.safeParse(detail?.providerId);
      if (parsed.success) {
        setCreateProvider(parsed.data);
        const remembered = readLastModel(parsed.data);
        setCreateModel(remembered ?? defaultModelForProvider(parsed.data));
      }
    };
    window.addEventListener("df:provider-change", onProviderChange);
    return () => window.removeEventListener("df:provider-change", onProviderChange);
  }, []);
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [selectedDsPath, setSelectedDsPath] = useState<string | null>(null);
  const [dsLastUsed, setDsLastUsed] = useState<Record<string, number>>({});
  const [showAllDs, setShowAllDs] = useState(false);
  // Sorted list for the create-card row: most-recently-used first. The
  // active selection always wins position 0 even if older — the user wants
  // to see what's chosen.
  const sortedDs = useMemo(() => {
    const copy = [...designSystems];
    copy.sort((a, b) => {
      if (selectedDsPath) {
        if (a.path === selectedDsPath) return -1;
        if (b.path === selectedDsPath) return 1;
      }
      const ta = dsLastUsed[a.path] ?? 0;
      const tb = dsLastUsed[b.path] ?? 0;
      return tb - ta;
    });
    return copy;
  }, [designSystems, dsLastUsed, selectedDsPath]);
  // v8: legacy sidebar removed — sortedDs is still used by the
  // "all DS" modal further below.
  // Cache de swatches por DS: lemos design.md uma vez por path e derivamos
  // os primeiros 4 hex codes pra render. Map<path, hex[]>.
  const [dsColors, setDsColors] = useState<Record<string, string[]>>({});
  const [showDsSetup, setShowDsSetup] = useState(false);
  // Prompt attachments: files/images dragged or picked, plus mic recording.
  // Kept as a flat list so they surface as chips above the textarea and feed
  // the initial prompt via inline refs like "see attachment: foo.png".
  //
  // 2026-04-29 fix: previously this only stored metadata (name/kind/size)
  // and the actual File payload was discarded. User reported anexar
  // logo no Home → Claude ignored it because nothing was ever passed to
  // the editor. Now we keep the File objects too; on project create we
  // persist them to `<projectPath>/.df-attachments/` and inject absolute
  // path refs into the seed (mirrors EditorScreen.handleAttach).
  // v8: legacy sidebar attachments + mic state removed. Modal owns the
  // entire NewProject lifecycle now.

  // Bridge availability polling — kept as a side-effect so other surfaces
  // that read getBridgeStatus() see fresh data. The UI no longer surfaces
  // a "Provider: X · offline" chip (that lived in the removed M4.5 row).
  // User ask 2026-05-21: "sinto q estamos fazendo varias coisas de
  // forma burra". Background tab gets no probes — `document.hidden`
  // skips the tick when the user is on another tab/window. The poll
  // resumes on `visibilitychange` (immediate tick + interval keeps
  // running) so coming back doesn't wait the full 6s for fresh status.
  useEffect(() => {
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      await refreshBridgeStatus();
    };
    void tick();
    const iv = setInterval(tick, 6000);
    const onVisibility = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  // Project delete confirmation. Uses an in-app modal instead of
  // window.confirm — browsers/webviews offer "prevent this page from
  // creating additional dialogs" after the first native dialog, so the
  // SECOND window.confirm() silently returned false and the delete never
  // fired ("tentei apagar 2 projetos e não funcionou").
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // DS detach confirm — same in-app modal instead of window.confirm.
  const [dsDeleteTarget, setDsDeleteTarget] = useState<{ path: string; name: string } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load DS list. Filesystem (design-systems/*/design.md) is canonical —
  // wave 4 of the DB-less migration. The legacy db.getSetting
  // ("design_systems") JSON still hydrates as fallback when bridge is
  // offline / Tauri hasn't wired the scanner yet, but stale entries
  // that don't have a folder on disk are pruned automatically on mount.
  const reconcileDesignSystems = useCallback(async () => {
    const fsList = await listDesignSystemsFromFilesystem();
    if (fsList) {
      // Filesystem hit — enrich with any extra metadata (sourceRef/addedAt)
      // still in the legacy DB cache for entries that match.
      let legacyBySlug = new Map<string, any>();
      try {
        const raw = await db.getSetting("design_systems").catch(() => null);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const x of parsed) {
              const slug = slugFromPath(x.path ?? "");
              if (slug) legacyBySlug.set(slug, x);
            }
          }
        }
      } catch {}
      const merged: DesignSystem[] = fsList.map((fs) => {
        const legacy = legacyBySlug.get(fs.slug);
        return {
          name: fs.name || legacy?.name || fs.slug,
          path: fs.path,
          designMdPath: fs.designMdPath,
          source: legacy?.source || "folder",
          sourceRef: legacy?.sourceRef,
          addedAt: legacy?.addedAt ?? fs.mtime,
          // Daemon scans cover.{png,jpg,jpeg,webp} and emits the first
          // match. Absent for DSes without an uploaded cover.
          ...(fs.coverPath ? { coverPath: fs.coverPath } : {}),
          // Daemon also surfaces preview.html when present. Drives the
          // DS preview screen's Preview tab (vs the Generate CTA).
          ...(fs.previewPath ? { previewPath: fs.previewPath } : {}),
        };
      });
      setDesignSystems(merged);
      return;
    }
    // Bridge offline — fall back to DB (legacy path).
    try {
      const raw = await db.getSetting("design_systems").catch(() => null);
      if (!raw) { setDesignSystems([]); return; }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const migrated: DesignSystem[] = parsed.map((x: any) => ({
          name: x.name ?? "design system",
          path: x.path,
          designMdPath: x.designMdPath || `${x.path?.replace(/\/$/, "")}/design.md`,
          source: x.source || "folder",
          sourceRef: x.sourceRef,
          addedAt: x.addedAt ?? Date.now(),
        }));
        setDesignSystems(migrated);
      }
    } catch {}
  }, []);
  useEffect(() => { void reconcileDesignSystems(); }, [reconcileDesignSystems]);

  // Re-scan on window focus so DSes added via the terminal or another
  // session show up without a page reload.
  useEffect(() => {
    const onFocus = () => { void reconcileDesignSystems(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reconcileDesignSystems]);

  // Persist the DS list. Filesystem is canonical — the list itself is
  // derived from design-systems/*/design.md — but we keep the DB mirror
  // so legacy readers (and offline mode) still have it. Active DS
  // pointer (ds_path/ds_name) stays DB-only for now; it's small and
  // per-session.
  const persistDesignSystems = async (list: DesignSystem[]) => {
    setDesignSystems(list);
    try {
      await db.setSetting("design_systems", JSON.stringify(list));
      if (list.length > 0) {
        await db.setSetting("ds_path", list[0].path);
        await db.setSetting("ds_name", list[0].name);
      } else {
        await db.setSetting("ds_path", "");
        await db.setSetting("ds_name", "");
      }
    } catch (e) {
      console.error("[ds] failed to persist design_systems", e);
    }
  };

  // Selected DS = whatever ds_path holds (could be null = "no DS", a valid
  // path, or an orphaned path whose folder was removed). DS is OPTIONAL —
  // user can create a project without a DS and add one later. User
  // feedback 2026-04-27: "n me deixa criar projeto sem escolher ds, nao tem
  // opcao de deselecionar". The previous behavior force-fell-back to the
  // first DS in the list when ds_path was unset, which made null DS
  // unreachable from the UI.
  useEffect(() => {
    if (designSystems.length === 0) { setSelectedDsPath(null); return; }
    if (selectedDsPath && designSystems.some((d) => d.path === selectedDsPath)) return;
    db.getSetting("ds_path").then((stored) => {
      const match = stored && designSystems.find((d) => d.path === stored);
      setSelectedDsPath(match ? stored : null);
    }).catch(() => setSelectedDsPath(null));
  }, [designSystems, selectedDsPath]);

  // Hydrate last-used timestamps from db. One key per DS path so we don't
  // need a list. Touched whenever the user picks a DS in the create card.
  useEffect(() => {
    if (designSystems.length === 0) return;
    (async () => {
      const next: Record<string, number> = {};
      await Promise.all(designSystems.map(async (ds) => {
        const raw = await db.getSetting(`ds_lastUsed:${ds.path}`).catch(() => null);
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n)) next[ds.path] = n;
      }));
      setDsLastUsed((prev) => ({ ...prev, ...next }));
    })();
  }, [designSystems]);

  const markDsUsed = useCallback((path: string) => {
    const now = Date.now();
    setDsLastUsed((prev) => ({ ...prev, [path]: now }));
    void db.setSetting(`ds_lastUsed:${path}`, String(now)).catch(() => {});
  }, []);

  const pickDs = useCallback((ds: DesignSystem) => {
    setSelectedDsPath(ds.path);
    void db.setSetting("ds_path", ds.path).catch(() => {});
    void db.setSetting("ds_name", ds.name).catch(() => {});
    markDsUsed(ds.path);
  }, [markDsUsed]);

  const clearDsSelection = useCallback(() => {
    setSelectedDsPath(null);
    void db.setSetting("ds_path", "").catch(() => {});
    void db.setSetting("ds_name", "").catch(() => {});
  }, []);

  // Parsea design.md de cada DS uma vez e cacheia os 4 primeiros hex codes.
  // Fallback silencioso se o arquivo foi movido/renomeado — swatches ficam
  // neutros e a UI renderiza mesmo assim.
  useEffect(() => {
    designSystems.forEach(async (ds) => {
      if (dsColors[ds.path]) return;
      try {
        const content = await readFileViaBridge(ds.designMdPath);
        if (!content) return;
        const text = typeof content === "string" ? content : (content as any).content ?? "";
        const parsed = parseDesignSystem(text);
        const hexes = parsed.colors.slice(0, 4).map((c) => c.hex).filter(Boolean);
        if (hexes.length > 0) {
          setDsColors((prev) => ({ ...prev, [ds.path]: hexes }));
        }
      } catch {}
    });
  }, [designSystems]); // eslint-disable-line react-hooks/exhaustive-deps

  // cwd existence probe removed — the workspace is now the design-factory
  // repo root resolved by the bridge and always exists by definition.

  // ⌘N / Ctrl+N → focus no name input. Só quando não estiver já em outro
  // form (evita hijack quando user tá digitando em outro campo).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "n") return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        // Permite se for o próprio name input (no-op).
        if (active !== nameInputRef.current) return;
      }
      e.preventDefault();
      nameInputRef.current?.focus();
      nameInputRef.current?.select?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleAddDesignSystem = () => setShowDsSetup(true);

  // After the modal saves: persist, close, and land on the design-systems tab
  // so the new card is visible in the grid. No second navigate to /ds/:slug —
  // the user explicitly wants the DS to live inside the Home tab.
  const handleDsSaved = (entry: DsEntry) => {
    const next = [entry, ...designSystems.filter((d) => d.path !== entry.path)];
    persistDesignSystems(next);
    setShowDsSetup(false);
    if (rightTab !== "design-systems") setRightTab("design-systems");
  };

  // Removes a DS from the persisted list. Confirm dialog guards against
  // accidental clicks — ed for explicit confirmation on every
  // destructive action. DS folder on disk is NOT deleted; only the list
  // entry (bridge scan would re-surface the folder next focus if left).
  const handleRemoveDs = async (path: string) => {
    // Optimistic UI: drop from list immediately so the user sees the
    // result. The bridge then actually `rm -rf` the folder; if that fails
    // we surface the error and reconcile will bring it back on next focus.
    persistDesignSystems(designSystems.filter((d) => d.path !== path));
    const slug = slugFromPath(path || "");
    if (!slug) {
      console.warn("[ds] remove: couldn't resolve slug from path", path);
      return;
    }
    const ok = await removeDsFolder(slug);
    if (!ok) {
      // Silent fail — the UI already dropped the entry. If the bridge
      // is offline / endpoint missing, reconcile on next focus brings
      // it back. Console log keeps the trail for diagnostics.
      console.error("[ds] remove: bridge failed to rm -rf design-systems/", slug);
    }
  };

  // DsPreviewScreen fires this when the user removes a stale/empty DS from
  // its empty-state. The preview screen already asked for confirmation there
  // (remove + back button), so we skip the second confirm here.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path) handleRemoveDs(detail.path);
    };
    window.addEventListener("df-ds-remove-request", handler);
    return () => window.removeEventListener("df-ds-remove-request", handler);
  }, [designSystems]); // eslint-disable-line react-hooks/exhaustive-deps

  // v8: legacy handleCreate (sidebar form submit) removed. The modal
  // path uses handleCreateFromNpModal below; the From-HTML modal inlines
  // its own create logic.

  const [showFromHtml, setShowFromHtml] = useState(false);
  const [htmlPaste, setHtmlPaste] = useState("");
  const [htmlPasteError, setHtmlPasteError] = useState<string | null>(null);

  // New Project full-screen skeu modal. Hosts <NewProjectFormSkeu /> with
  // the canonical+ surface (prompt + format + direction + DS + model +
  // anti-slop + refs + 5 taste dials). User triggered by clicking the
  // "OPEN PROJECT CONSOLE" plate that lives at the top of the sidebar.
  // The inline sidebar form below is preserved as the fast path.
  const [showNpModal, setShowNpModal] = useState(false);
  const handleCreateFromNpModal = useCallback(
    async (payload: NewProjectFormPayload) => {
      const trimmed = payload.name.trim();
      if (!trimmed) return;
      const baseSlug = trimmed.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, "");
      // Suffix the path with a short timestamp so two projects that
      // slugify to the same string (e.g. same name + same imported HTML)
      // land in distinct folders. Without this, the meta.json + chat
      // history of the previous project bleed into the "new" one because
      // the folder is reused. Matches the pattern already used by the
      // TemplatesTab create flow below.
      // `slug` below is the suffixed folder name AND the primary canvas
      // filename (App.tsx writes `${slug}.html` derived from the last path
      // segment). The context block further down MUST reference this same
      // `${slug}.html` or the agent's first Read hits "file does not exist".
      const slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
      const projectPath = `${projectsFolder.replace(/\/$/, "")}/${slug}`;
      // v4 payload schema: canvas + format + rules[] + attachments[].
      // Anti-slop is now part of rules (any rule with category 'anti-slop').
      // Refs were removed — links/files come through attachments now.
      //
      // Attachments LAND ON DISK before the agent boots, organized
      // by kind, and the agent receives a `<context>` block in the
      // seed prompt describing what's available.
      //   · 1st HTML  → projectPath/{slug}.html         (canvas primary tab)
      //   · 2..n HTML → projectPath/tab-N-{name}.html   (secondary canvas tabs)
      //   · images    → projectPath/assets/{safeName}   (agent reads as refs)
      //   · text      → inline as ``` blocks in the seed (legacy behavior)
      //
      // The "primary" picked is whatever sits at attachments[0] in the
      // user-ordered chip array (drag-reorder in the modal). HTML is
      // identified by mime OR filename extension to handle browsers that
      // hand .html as application/octet-stream.
      const userPrompt = payload.prompt.trim();

      function isHtmlAtt(att: NewProjectFormPayload["attachments"][number]): boolean {
        return att.mime === "text/html" || /\.html?$/i.test(att.name);
      }
      function safeFsName(name: string): string {
        return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
      }
      function htmlContentOf(att: NewProjectFormPayload["attachments"][number]): string | null {
        // Text-kind HTMLs arrive with raw markup in `content`.
        if (att.kind === "text") return att.content;
        // Image/binary HTMLs (rare — browser misclassified the mime) arrive
        // as data URLs. Decode the base64 segment back to UTF-8.
        const m = att.content.match(/^data:[^;]+;base64,(.*)$/);
        if (!m) return null;
        try {
          const bin = atob(m[1]);
          // bin is a binary string — round-trip through TextDecoder so
          // multi-byte UTF-8 markup survives. We can't use TextDecoder
          // directly on the base64; we have to build a Uint8Array first.
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new TextDecoder("utf-8").decode(bytes);
        } catch { return null; }
      }

      const atts = payload.attachments ?? [];
      const htmlAtts = atts.filter(isHtmlAtt);
      const imageAtts = atts.filter((a) => a.kind === "image" && !isHtmlAtt(a));
      const textAtts = atts.filter((a) => !isHtmlAtt(a) && a.kind === "text");

      // First HTML — passed downstream as initialHtml so App.tsx writes it
      // at projectPath/{slug}.html (the canonical primary canvas path).
      let primaryHtml: string | undefined;
      const primaryHtmlAtt = htmlAtts[0];
      if (primaryHtmlAtt) {
        const c = htmlContentOf(primaryHtmlAtt);
        if (c && c.trim().length >= 20) primaryHtml = c;
      }

      // Secondary HTMLs — write each as tab-{N}-{name}.html so EditorScreen
      // can scan and hydrate canvasTabs at boot. N starts at 2 to mirror
      // the user's "primeiro = principal" ordering (1 is the canvas
      // itself, named after the project slug).
      const tabRefs: string[] = [];
      for (let i = 1; i < htmlAtts.length; i++) {
        const att = htmlAtts[i];
        const c = htmlContentOf(att);
        if (!c || c.trim().length < 20) continue;
        const baseName = safeFsName(att.name.replace(/\.html?$/i, ""));
        const fileName = `tab-${i + 1}-${baseName}.html`;
        const diskPath = `${projectPath}/${fileName}`;
        try {
          await writeFile(diskPath, c);
          tabRefs.push(fileName);
        } catch (e) {
          console.error("[home/np] tab html write failed", fileName, e);
        }
      }

      // Image attachments — flushed to projectPath/assets/{safeName}. The
      // agent reads this folder as the project's "media bucket" — surfaced
      // in the context block below.
      const assetRefs: string[] = [];
      for (const att of imageAtts) {
        try {
          const m = att.content.match(/^data:[^;]+;base64,(.*)$/);
          const b64 = m ? m[1] : att.content;
          const safe = safeFsName(att.name);
          const diskPath = `${projectPath}/assets/${safe}`;
          const written = await writeBinaryViaBridge(diskPath, b64);
          if (written) assetRefs.push(`assets/${safe}`);
        } catch (e) {
          console.error("[home/np] image flush failed", att.name, e);
        }
      }

      // Text attachments — keep legacy inline behavior (markdown code block).
      const textBlocks: string[] = textAtts.map(
        (a) => `\`\`\`\n# ${a.name}\n${a.content}\n\`\`\``,
      );

      // Seed prompt — assemble [context block?][text blocks?][user prompt].
      // The context block is added only when attachments produced disk
      // artifacts; pure text-only flows skip it to avoid noise.
      const contextLines: string[] = [];
      if (primaryHtmlAtt || tabRefs.length > 0 || assetRefs.length > 0) {
        contextLines.push("<context>");
        contextLines.push(`Project workspace: ${projectPath}`);
        if (primaryHtmlAtt) {
          contextLines.push(`Primary canvas: ${slug}.html (HTML attached by user — open in canvas)`);
        }
        if (tabRefs.length > 0) {
          contextLines.push("Other canvas tabs (secondary HTMLs attached):");
          for (const r of tabRefs) contextLines.push(`  - ${r}`);
        }
        if (assetRefs.length > 0) {
          contextLines.push(`Assets folder (${projectPath}/assets/):`);
          for (const r of assetRefs) contextLines.push(`  - ${r}`);
        }
        contextLines.push("</context>");
      }
      const contextBlock = contextLines.length > 0 ? contextLines.join("\n") : "";
      const prefixParts: string[] = [];
      if (contextBlock) prefixParts.push(contextBlock);
      if (textBlocks.length > 0) prefixParts.push(textBlocks.join("\n\n"));
      const prefix = prefixParts.join("\n\n");
      let seed: string | undefined = userPrompt.length > 0 ? userPrompt : undefined;
      if (prefix) seed = `${prefix}\n\n${seed ?? ""}`.trim();

      // Mirror provider preference.
      void writeGlobalConfig({ default_provider: payload.provider }).catch(() => {});
      void db.setSetting("default_provider", payload.provider).catch(() => {});
      // Pass extras as passthrough — survives existing extras typing.
      // v5: `taste` é o objeto completo (6 dials, 50 = neutral) e
      // `tasteActive` é o subset que o user mexeu de fato. Downstream
      // (prompt suffix etc) DEVE usar tasteActive — dials neutros são
      // explicitamente "no opinion" e não devem influenciar o modelo.
      const extras = {
        rawPrompt: userPrompt || undefined,
        canonicalPlus: {
          canvas: payload.canvas,
          format: payload.format,
          rules: payload.rules,
          designSystem: payload.designSystem,
          provider: payload.provider,
          model: payload.model,
          attachments: payload.attachments?.map((a) => ({ name: a.name, mime: a.mime, size: a.size, kind: a.kind })) ?? [],
          taste: payload.taste,
          tasteActive: payload.tasteActive,
        },
      } as unknown as { rawPrompt?: string; directionSelection?: DirectionSelection | null };
      // pass primaryHtml as initialHtml (7th arg). App.tsx writes it
      // to projectPath/{slug}.html so the EditorScreen iframe loads with
      // the user's HTML as the canvas. Secondary HTMLs sit on disk as
      // tab-N-*.html for the editor's boot scan.
      await onCreateProject(trimmed, projectPath, "hifi", undefined, seed, undefined, primaryHtml, extras);
      setShowNpModal(false);
    },
    [projectsFolder, onCreateProject],
  );
  // Name typed inside the From-HTML modal — independent from the sidebar
  // name input so the user can upload a file and land in the editor
  // without first filling the sidebar form.
  const [fromHtmlName, setFromHtmlName] = useState("");
  const [fromHtmlSourceFile, setFromHtmlSourceFile] = useState<string | null>(null);
  const [fromHtmlSubmitting, setFromHtmlSubmitting] = useState(false);
  const fromHtmlFileInputRef = useRef<HTMLInputElement>(null);

  const handleStartFromHtml = async () => {
    const content = htmlPaste.trim();
    // Lenient validation: any HTML-like content starting with `<` and at
    // least one closing angle bracket somewhere. Bridge does the strict
    // markup check on write.
    if (content.length < 20) {
      setHtmlPasteError("Paste or upload an HTML document (min 20 chars).");
      return;
    }
    if (!/^\s*<.+/.test(content) || !content.includes(">")) {
      setHtmlPasteError("Doesn't look like HTML — must start with a tag like <!DOCTYPE html> or <body>.");
      return;
    }
    // Resolve project name: prefer modal input, fall back to sidebar input,
    // then derive from filename, then synth.
    const resolvedName =
      fromHtmlName.trim()
      || projectName.trim()
      || (fromHtmlSourceFile ? fromHtmlSourceFile.replace(/\.html?$/i, "").replace(/[_\s]+/g, "-") : "")
      || `untitled-${Date.now().toString(36).slice(-4)}`;

    setHtmlPasteError(null);
    setFromHtmlSubmitting(true);
    try {
      // Mirror the modal name into the sidebar input so the user can
      // see what was created.
      if (!projectName.trim() && resolvedName) setProjectName(resolvedName);
      // Inline what handleCreate does so we can await + surface errors
      // (handleCreate is fire-and-forget and the caller can't tell if
      // mkdir/write failed).
      const slug = resolvedName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, "");
      const seed = initialPrompt.trim() || undefined;
      void writeGlobalConfig({ default_provider: createProvider }).catch(() => {});
      void db.setSetting("default_provider", createProvider).catch(() => {});
      // Suffix path with short timestamp — same reason as
      // handleCreateFromNpModal above: prevents two "new project from
      // HTML" runs of the same file from colliding on the same folder
      // (which would leak chat history from the previous one).
      const projectPath = `${projectsFolder.replace(/\/$/, "")}/${slug}-${Date.now().toString(36).slice(-4)}`;
      await onCreateProject(resolvedName, projectPath, "hifi", undefined, seed, undefined, content);
      setShowFromHtml(false);
      setHtmlPaste("");
      setFromHtmlName("");
      setFromHtmlSourceFile(null);
      setInitialPrompt("");
    } catch (e) {
      setHtmlPasteError(`Couldn't create project: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
    } finally {
      setFromHtmlSubmitting(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
    : projects;
  // User ask 2026-05-21: "diz q tem 69 projetos, mas na home so carrega
  // alguns, teria q ter opcao de carregar mais". The grid still pages 20
  // at a time (cover-image fetch + iframe srcdoc per card stays heavy)
  // but exposes a "carregar mais" button so the user can reach the
  // entire roster without paging the URL.
  const PROJECTS_PAGE_SIZE = 20;
  const [projectsLimit, setProjectsLimit] = useState(PROJECTS_PAGE_SIZE);
  // Reset paging when the search query changes — going back to "show
  // first 20" matches each filtered set instead of carrying over a
  // stale offset.
  useEffect(() => { setProjectsLimit(PROJECTS_PAGE_SIZE); }, [q]);
  const recentProjects = filtered.slice(0, projectsLimit);
  const hasMoreProjects = filtered.length > projectsLimit;

  // Per-project HTML cache for the cover preview. Reads {project.path}/{slug}.html
  // from the filesystem and keeps the content in state. When the project hasn't
  // been generated yet, the entry stays empty and ProjectCover falls back to its
  // generative dot grid.
  const [projectHtmls, setProjectHtmls] = useState<Record<string, string>>(
    () => Object.fromEntries([...projectHtmlCache].map(([id, v]) => [id, v.html])),
  );
  useEffect(() => {
    let cancelled = false;
    const toLoad = recentProjects.filter((p) => {
      const cached = projectHtmlCache.get(p.id);
      return !cached || cached.updatedAt < p.updated_at;
    });
    if (toLoad.length === 0) return;
    (async () => {
      // Load covers in parallel (bounded) instead of one-await-at-a-time —
      // a sequential for-loop made first paint scale with project count.
      const loadOne = async (p: Project) => {
        const folder = p.path.replace(/[\\/]+$/, "");
        const slug = slugFromPath(folder) || p.id;
        // Fast path: assume {slug}.html. Fall back to listing the folder +
        // first .html (untitled-* projects: folder "untitled-XYZW" but file
        // "untitled.html" — the suffix is on the folder only).
        let html: string | null = null;
        const primary = await readFileViaBridge(`${folder}/${slug}.html`).catch(() => null);
        if (primary?.content) {
          html = primary.content;
        } else {
          const listing = await listFolder(folder).catch(() => null);
          if (listing && !("error" in listing) && Array.isArray(listing.entries)) {
            const htmlEntry = listing.entries.find((e) => !e.isDir && /\.html?$/i.test(e.name));
            if (htmlEntry) {
              const f = await readFileViaBridge(`${folder}/${htmlEntry.name}`).catch(() => null);
              if (f?.content) html = f.content;
            }
          }
        }
        projectHtmlCache.set(p.id, { updatedAt: p.updated_at, html: html ?? "" });
        if (!cancelled) setProjectHtmls((prev) => ({ ...prev, [p.id]: html ?? "" }));
      };
      const CONCURRENCY = 6;
      for (let i = 0; i < toLoad.length; i += CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(toLoad.slice(i, i + CONCURRENCY).map(loadOne));
      }
    })();
    return () => { cancelled = true; };
  }, [recentProjects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-project ratio cache. Reads .df/meta.json once per project so the
  // cover thumbnail renders the iframe at the actual aspect (a 9:16 video
  // doesn't get squashed into a 16:9 viewport). Undefined means 'not
  // loaded yet'; ProjectCover defaults to 16:9 in that window.
  const [projectRatios, setProjectRatios] = useState<Record<string, RatioId>>(
    () => Object.fromEntries([...projectRatioCache].map(([id, v]) => [id, v.ratio])),
  );
  useEffect(() => {
    let cancelled = false;
    const toLoad = recentProjects.filter((p) => {
      const cached = projectRatioCache.get(p.id);
      return !cached || cached.updatedAt < p.updated_at;
    });
    if (toLoad.length === 0) return;
    (async () => {
      const loadOne = async (p: Project) => {
        const slug = slugFromPath(p.path) || p.id;
        const meta = await readProjectMeta(slug).catch(() => null);
        const ratio = (meta?.video_ratio ?? "16:9") as RatioId;
        projectRatioCache.set(p.id, { updatedAt: p.updated_at, ratio });
        if (!cancelled) setProjectRatios((prev) => ({ ...prev, [p.id]: ratio }));
      };
      const CONCURRENCY = 6;
      for (let i = 0; i < toLoad.length; i += CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(toLoad.slice(i, i + CONCURRENCY).map(loadOne));
      }
    })();
    return () => { cancelled = true; };
  }, [recentProjects]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen" data-active="true">
      {/* TOPBAR — Aqua canonical 3-zone layout: left brand+divider,
          center Aqua tabs (concave corners), right CLI + search +
          theme + settings. */}
      <header className="editor-topbar home-topbar">
        <div className="topbar-floor" />

        {/* LEFT — brand */}
        <div className="home-topbar-brand">
          <Logo size={26} className="home-brand-mark" />
          <span className="home-brand-name">{t("home.brand.name")}</span>
          <span className="home-brand-badge">{t("home.brand.badge")}</span>
        </div>

        {/* CENTER — nav tabs Aqua (concave corner arcs on selected). */}
        <div className="topbar-center">
          {(
            [
              { id: "projects", labelKey: "home.tab.projects" },
              { id: "templates", labelKey: "home.tab.templates" },
              { id: "design-systems", labelKey: "home.tab.designsystems" },
              { id: "skills", labelKey: "home.tab.skills" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="topbar-file-tab"
              aria-selected={rightTab === tab.id}
              onClick={() => setRightTab(tab.id)}
            >
              {rightTab === tab.id && (
                <>
                  <TabCornerLeft outerColor="var(--df-bg-base)" />
                  <TabCornerRight outerColor="var(--df-bg-base)" />
                </>
              )}
              <span className="topbar-file-tab-name">{t(tab.labelKey)}</span>
            </button>
          ))}
        </div>

        {/* RIGHT — agent + theme + settings. The search bar lives
            below the Projects hero (only relevant on the Projects tab
            anyway), not in the topbar. */}
        <div className="topbar-right">
          <AgentPicker />
          {theme && onThemeChange && <ThemeToggle theme={theme} onChange={onThemeChange} />}
          <button
            className="editor-avatar"
            title={t("home.brand.settings.title")}
            aria-label={t("home.brand.settings")}
            onClick={() => onOpenSettings()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
            </svg>
          </button>
        </div>
      </header>

      <ProviderBanner onOpenSettings={onOpenSettings} />

      {/* BODY — single stage (no sidebar). Three columns of projects,
          centered, with the "new project" button above the grid that
          opens the modal. */}
      <div className="home-body-v2 home-body-v2--v8">
        <div className="home-stage-v8">

          {/* HERO — canonical SkeuHero (DNA reference) for /projects.
              Uses the unified SkeuHero component (size lg + tactile
              CTA slot). Anatomy (ascii grain + corner mark + engraved
              title + bezel inset) comes from .skeu-hero CSS — single
              source of truth. The tactile CTA keeps its existing
              premium TE button styling. Other tabs (templates / ds /
              skills) intentionally use the simple .skills-header. */}
          {rightTab === "projects" && (
            <div className="home-hero-wrap">
              <SkeuHero
                size="lg"
                kicker={t("home.hero.kicker").replace("{count}", String(projects.length))}
                title={t("home.brand.name")}
                ariaLabelledBy="home-hero-title"
                ctaLayout="left-right"
                /* left brand decoration: oversized Logo as
                 * faceplate stamp anchoring the left side of the wide
                 * feed-aligned hero. Replaces the corner mark stamp.
                 * User Opção A craft. */
                decoration={<Logo size={64} className="home-hero-decoration-logo" />}
                cta={
                  <button
                    type="button"
                    className="home-hero-cta"
                    onClick={() => setShowNpModal(true)}
                    aria-label={t("home.cta.aria")}
                  >
                    {/* v16 — Logo replaces the LED bolinha. The mark
                      * "acende" no hover (opacity + accent + soft glow)
                      * and "afunda" no active (translateY + bezel pressed).
                      * User explicit: "sem essa shadow forte". */}
                    <Logo size={16} className="home-hero-cta-mark" />
                    <span className="home-hero-cta-label">{t("home.hero.cta")}</span>
                    <span className="home-hero-cta-arrow" aria-hidden="true">→</span>
                  </button>
                }
              />
              {/* Search bar sits immediately below the Projects hero,
                  not in the topbar. Same width as the feed grid so it
                  lines up cleanly with project cards below. */}
              <div className="home-projects-search">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  placeholder={t("home.search.placeholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("home.search.placeholder")}
                />
              </div>
            </div>
          )}

          {/* Tab content */}
          {rightTab === "templates" ? (
            <TemplatesTab
              onUseTemplate={(name, html) => {
                const slug = (name || "novo-projeto").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 80);
                const projectPath = `${projectsFolder.replace(/\/$/, "")}/${slug}-${Date.now().toString(36).slice(-4)}`;
                void onCreateProject(name || t("home.project.defaultname"), projectPath, "hifi", "template", undefined, undefined, html);
              }}
            />
          ) : rightTab === "design-systems" ? (
            <div className="ds-tab">
              {/* Simple header on Skills/DS — only the Projects hero
                  is differentiated. Skills + DS + Templates share the
                  same `.skills-header` anatomy. */}
              <header className="skills-header">
                <div>
                  <h2 className="skills-title">{t("home.hero.ds.title")}</h2>
                  <p className="skills-lede">
                    {t("home.hero.ds.subtitle")}
                  </p>
                </div>
                <div className="skills-header-actions">
                  <button className="skills-cta" onClick={handleAddDesignSystem}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {t("home.hero.ds.cta")}
                  </button>
                </div>
              </header>

              {designSystems.length === 0 ? (
                <div className="skills-empty">
                  <span className="skills-empty-title">{t("home.ds.empty.title")}</span>
                  <span className="skills-empty-body" dangerouslySetInnerHTML={{ __html: t("home.ds.empty.body") }} />
                  <button className="skills-cta" onClick={handleAddDesignSystem} style={{ marginTop: 12 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {t("home.ds.empty.cta")}
                  </button>
                </div>
              ) : (
                /* DS cards use EntityCard now — same anatomy
                  * as Projects + Templates (16:9 thumb + meta footer + delete-x
                  * affordance on hover). User spec: "por que o card de
                  * design system eh tao diferente do de projeto e template?
                  * queria padronizar esses cards." Only the thumb content
                  * differs (palette band + Aa sample) so DS cards remain
                  * legible at thumbnail size. */
                <div className="home-right-grid">
                  {designSystems.map((ds) => (
                    <EntityCard
                      key={ds.path}
                      id={ds.path}
                      title={prettifyName(ds.name)}
                      hoverTitle={ds.path}
                      optionsLabel={t("home.ds.options.aria")}
                      thumb={<DsCardPreview designMdPath={ds.designMdPath} coverPath={ds.coverPath} />}
                      onOpen={() => onOpenDs?.(ds)}
                      menuOpen={menuOpenFor === `ds:${ds.path}`}
                      onMenuToggle={(open) => setMenuOpenFor(open ? `ds:${ds.path}` : null)}
                      actions={[
                        {
                          label: t("home.ds.action.open"),
                          onSelect: () => onOpenDs?.(ds),
                        },
                        {
                          label: t("home.ds.action.delete"),
                          tone: "danger" as const,
                          onSelect: () => setDsDeleteTarget({ path: ds.path, name: ds.name }),
                        },
                      ]}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : rightTab === "skills" ? (
            <SkillsTabContent cwd={defaultCwd} onCreateProject={onCreateProject} />
          ) : (
            /* Projects grid — 3-col centered, EntityCard pattern. */
            <div className="home-right-grid">
              {recentProjects.length === 0 ? (
                <div className="canvas-empty" style={{ gridColumn: "1 / -1" }}>
                  <div className="canvas-empty-inner">
                    <div style={{ color: "var(--df-text-secondary)", fontSize: "var(--df-text-md)", fontWeight: 600 }}>
                      {q ? t("home.empty.search.title") : t("home.empty.projects.title")}
                    </div>
                    <div style={{ color: "var(--df-text-faint)", fontSize: "var(--df-text-sm)", marginTop: 4 }}>
                      {q ? tf("home.project.search.empty", query) : t("home.empty.projects.body")}
                    </div>
                  </div>
                </div>
              ) : (
                recentProjects.map((p) => (
                  <EntityCard
                    key={p.id}
                    id={p.id}
                    title={prettifyName(p.name)}
                    hoverTitle={`${p.name} · ${formatRelative(p.updated_at)}`}
                    optionsLabel={t("home.project.options.aria")}
                    thumb={
                      <ProjectCover
                        slug={slugFromPath(p.path) || p.id}
                        htmlContent={projectHtmls[p.id]}
                        ratio={projectRatios[p.id]}
                      />
                    }
                    onOpen={() => onOpenProject(p.path, p.name, p.mode, p.id)}
                    menuOpen={menuOpenFor === p.id}
                    onMenuToggle={(next) => setMenuOpenFor(next ? p.id : null)}
                    actions={[
                      {
                        label: t("home.project.action.rename"),
                        onSelect: () => {
                          setRenameTarget({ id: p.id, name: p.name });
                          setRenameInput(p.name);
                        },
                      },
                      ...(onDuplicateProject
                        ? [
                            {
                              label: t("home.project.action.duplicate"),
                              onSelect: () => onDuplicateProject(p.id),
                            },
                          ]
                        : []),
                      {
                        label: t("home.project.action.delete"),
                        tone: "danger" as const,
                        onSelect: () => setDeleteTarget({ id: p.id, name: p.name }),
                      },
                    ]}
                  />
                ))
              )}
              {/* "Carregar mais" pager — only shown on the projects tab
                  when filtered.length exceeds the current limit. */}
              {hasMoreProjects && (
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", padding: "20px 0 8px" }}>
                  <button
                    type="button"
                    className="df-btn df-btn--secondary"
                    onClick={() => setProjectsLimit((n) => n + PROJECTS_PAGE_SIZE)}
                  >
                    Carregar mais ({filtered.length - projectsLimit} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* NEW PROJECT CONSOLE MODAL — full-screen skeu surface. */}
      <NewProjectModal
        open={showNpModal}
        onClose={() => setShowNpModal(false)}
        onCreate={handleCreateFromNpModal}
      />

      {/* START FROM HTML MODAL */}
      {showFromHtml && (
        <div
          style={{ position: "fixed", inset: 0, background: "var(--df-surface-overlay)", backdropFilter: "blur(18px) saturate(1.02)", WebkitBackdropFilter: "blur(18px) saturate(1.02)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={() => { if (!fromHtmlSubmitting) setShowFromHtml(false); }}
        >
          <div
            style={{
              width: "min(640px, 90vw)",
              maxHeight: "calc(100vh - 48px)",
              background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-3xl)",
              boxShadow: "var(--df-shadow-card)",
              padding: 26,
              display: "flex", flexDirection: "column", gap: 14,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div style={{ fontFamily: "var(--df-font-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "var(--df-tracking-label)", color: "var(--df-text-muted)", marginBottom: 6 }}>
                {t("home.fromhtml.kicker")}
              </div>
              <h2 style={{ margin: 0, fontFamily: "var(--df-font-display)", fontSize: "var(--df-text-lg)", fontWeight: 700, letterSpacing: "var(--df-tracking-display)", color: "var(--df-text-primary)" }}>
                {t("home.fromhtml.title")}
              </h2>
              <p
                style={{ margin: "6px 0 0", fontSize: "var(--df-text-sm)", color: "var(--df-text-secondary)", lineHeight: 1.55 }}
                dangerouslySetInnerHTML={{ __html: t("home.fromhtml.body") }}
              />
            </div>

            {/* Project name (independent from the sidebar input) */}
            <div>
              <label style={{ display: "block", fontFamily: "var(--df-font-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "var(--df-tracking-label)", color: "var(--df-text-muted)", marginBottom: 6 }}>
                {t("home.fromhtml.name.label")}
              </label>
              <input
                className="df-input"
                value={fromHtmlName}
                onChange={(e) => setFromHtmlName(e.target.value)}
                placeholder={projectName.trim() || t("home.fromhtml.name.placeholder")}
                style={{ width: "100%", padding: "8px 10px", fontSize: "var(--df-text-sm)" }}
              />
            </div>

            {/* Drop / pick zone */}
            <button
              type="button"
              onClick={() => fromHtmlFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={async (e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (!f) return;
                const text = await f.text();
                setHtmlPaste(text);
                setFromHtmlSourceFile(f.name);
                if (!fromHtmlName.trim()) {
                  setFromHtmlName(f.name.replace(/\.html?$/i, "").replace(/[_\s]+/g, "-"));
                }
                setHtmlPasteError(null);
              }}
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "var(--df-bg-section)",
                border: "1px dashed var(--df-border-subtle)",
                borderRadius: "var(--df-r-md)",
                color: "var(--df-text-secondary)",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12,
                fontFamily: "inherit",
                textAlign: "left",
                transition: "border-color 160ms var(--df-ease-out), background 160ms var(--df-ease-out)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--df-border-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--df-border-subtle)"; }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--df-text-sm)", fontWeight: 600, color: "var(--df-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fromHtmlSourceFile ? fromHtmlSourceFile : t("home.fromhtml.drop.label")}
                </div>
                <div style={{ fontSize: "var(--df-text-xs)", color: "var(--df-text-faint)", marginTop: 2 }}>
                  {fromHtmlSourceFile ? tf("home.fromhtml.drop.replace", htmlPaste.length.toLocaleString()) : t("home.fromhtml.drop.below")}
                </div>
              </div>
            </button>
            <input
              ref={fromHtmlFileInputRef}
              type="file"
              accept=".html,.htm,text/html,.svg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setHtmlPaste(text);
                setFromHtmlSourceFile(f.name);
                if (!fromHtmlName.trim()) {
                  setFromHtmlName(f.name.replace(/\.html?$/i, "").replace(/[_\s]+/g, "-"));
                }
                setHtmlPasteError(null);
              }}
              style={{ display: "none" }}
            />

            <textarea
              value={htmlPaste}
              onChange={(e) => { setHtmlPaste(e.target.value); setFromHtmlSourceFile(null); setHtmlPasteError(null); }}
              placeholder={'<!DOCTYPE html>\n<html lang="en">\n  <head>...</head>\n  <body>...</body>\n</html>'}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 200,
                padding: 12,
                background: "var(--df-bg-section)",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-md)",
                color: "var(--df-text-primary)",
                fontFamily: "var(--df-font-mono)",
                fontSize: 12,
                lineHeight: 1.55,
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
                boxShadow: "var(--df-skeu-recess)",
              }}
            />
            {htmlPasteError && (
              <div style={{ fontSize: "var(--df-text-xs)", color: "var(--df-accent-danger, #C25450)" }}>{htmlPasteError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--df-font-mono)", fontSize: 10, color: "var(--df-text-faint)" }}>
                {tf("home.fromhtml.chars", htmlPaste.length.toLocaleString())}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="df-btn df-btn--secondary" onClick={() => setShowFromHtml(false)} disabled={fromHtmlSubmitting}>{t("home.fromhtml.cancel")}</button>
                <button
                  className="df-btn df-btn--primary"
                  onClick={() => { void handleStartFromHtml(); }}
                  disabled={fromHtmlSubmitting || htmlPaste.trim().length < 20}
                >
                  {fromHtmlSubmitting ? t("home.fromhtml.creating") : t("home.fromhtml.create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETACH DESIGN SYSTEM CONFIRM — in-app modal. */}
      <PadroesConfirmModal
        open={!!dsDeleteTarget}
        title={t("home.ds.delete.title")}
        body={dsDeleteTarget ? tf("home.ds.delete.confirm", dsDeleteTarget.name) : ""}
        confirmLabel={t("home.ds.delete.title")}
        tone="danger"
        onClose={() => setDsDeleteTarget(null)}
        onConfirm={() => {
          if (dsDeleteTarget) void handleRemoveDs(dsDeleteTarget.path);
          setDsDeleteTarget(null);
        }}
      />

      {/* DELETE PROJECT CONFIRM — in-app modal (not window.confirm). */}
      <PadroesConfirmModal
        open={!!deleteTarget}
        title={t("home.project.action.delete")}
        body={deleteTarget ? tf("home.project.delete.confirm", deleteTarget.name) : ""}
        confirmLabel={t("home.project.action.delete")}
        tone="danger"
        busy={deleteBusy}
        onClose={() => { if (!deleteBusy) setDeleteTarget(null); }}
        onConfirm={async () => {
          if (!deleteTarget || deleteBusy) return;
          const target = deleteTarget;
          setDeleteBusy(true);
          try {
            await onDeleteProject(target.id);
            setDeleteTarget(null);
          } catch (err) {
            console.error("[project] delete failed", err);
            window.alert(
              tf("home.project.delete.failed", target.name, err instanceof Error ? err.message : String(err)),
            );
          } finally {
            setDeleteBusy(false);
          }
        }}
      />

      {/* RENAME PROJECT MODAL */}
      {renameTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={() => setRenameTarget(null)}
        >
          <div
            style={{
              width: 420, background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-3xl)",
              boxShadow: "var(--df-shadow-card)", padding: "var(--df-sp-5)",
              display: "flex", flexDirection: "column", gap: "var(--df-sp-3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "var(--df-text-md)", fontWeight: 600 }}>{t("home.rename.title")}</div>
            <input
              autoFocus
              className="df-input"
              type="text"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameInput.trim()) {
                  onRenameProject(renameTarget.id, renameInput.trim());
                  setRenameTarget(null);
                }
                if (e.key === "Escape") setRenameTarget(null);
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--df-sp-2)" }}>
              <button className="df-btn df-btn--secondary" onClick={() => setRenameTarget(null)}>{t("home.rename.cancel")}</button>
              <button
                className="df-btn df-btn--primary"
                disabled={!renameInput.trim()}
                onClick={() => { onRenameProject(renameTarget.id, renameInput.trim()); setRenameTarget(null); }}
              >{t("home.rename.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {showDsSetup && (
        MODAL_LAB ? (
          <DsModalLab open onClose={() => setShowDsSetup(false)} />
        ) : (
          <DsSetupModal
            onClose={() => setShowDsSetup(false)}
            onAutoPersist={handleDsSaved}
            onSaved={handleDsSaved}
          />
        )
      )}

      <DirectionModal
        open={showDirectionModal}
        initial={directionSelection}
        onClose={() => setShowDirectionModal(false)}
        onApply={(next) => setDirectionSelection(next)}
      />

      <DfModal
        open={showAllDs}
        onClose={() => setShowAllDs(false)}
        size="md"
        title={t("home.dsall.dialog.title")}
        head={
          <div className="dsall-head">
            <div className="dsall-head-text">
              <div className="dsall-eyebrow">{t("home.dsall.kicker")}</div>
              <h2 className="dsall-title">{t("home.dsall.title")}</h2>
              <p className="dsall-sub">{t("home.dsall.subtitle")}</p>
            </div>
            <button
              type="button"
              className="dsall-close"
              aria-label={t("home.dsall.close")}
              onClick={() => setShowAllDs(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        }
      >
        <div className="dsall-list">
          {sortedDs.map((ds) => {
            const isSelected = selectedDsPath === ds.path;
            const swatches = dsColors[ds.path] ?? [];
            const lastUsed = dsLastUsed[ds.path];
            return (
              <button
                key={ds.path}
                type="button"
                className={`dsall-row${isSelected ? " is-on" : ""}`}
                onClick={() => {
                  if (isSelected) {
                    clearDsSelection();
                  } else {
                    pickDs(ds);
                    setShowAllDs(false);
                  }
                }}
              >
                <div className="dsall-row-swatches" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="dsall-row-swatch"
                      style={{ background: swatches[i] ?? "var(--df-surface-raised)" }}
                    />
                  ))}
                </div>
                <div className="dsall-row-meta">
                  <div className="dsall-row-name">{ds.name}</div>
                  <div className="dsall-row-sub">
                    {swatches.length > 0
                      ? (swatches.length === 1 ? t("home.ds.tokens.one") : tf("home.ds.tokens.many", swatches.length))
                      : t("home.ds.designmd")}
                    <span className="dsall-row-sep">·</span>
                    {ds.source}
                    {lastUsed && (
                      <>
                        <span className="dsall-row-sep">·</span>
                        {t("home.ds.used")} {formatRelativeTime(lastUsed)}
                      </>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <svg className="dsall-row-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </DfModal>

      {/* Screen-level model menu — fixed position, escapes prompt-bar
          overflow + stacking context. Wide enough for OpenRouter's 200+
          catalog. Search appears when the catalog is long. */}
      {showModelMenu && (() => {
        const opts = liveModelOpts.length > 0 ? liveModelOpts : getModelsForProvider(createProvider);
        const filtered = modelMenuQuery.trim()
          ? opts.filter((o) =>
              o.label.toLowerCase().includes(modelMenuQuery.toLowerCase()) ||
              o.id.toLowerCase().includes(modelMenuQuery.toLowerCase())
            )
          : opts;
        const showSearch = opts.length > 8;
        return (
          <div
            ref={modelMenuRef}
            className="reg-model-menu"
            role="listbox"
            style={{
              top: modelMenuCoords?.top ?? 0,
              left: modelMenuCoords?.left ?? 0,
              width: modelMenuCoords?.width ?? 420,
              right: "auto",
              bottom: "auto",
              transform: modelMenuCoords?.openUpward ? "translateY(-100%)" : undefined,
              visibility: modelMenuCoords ? "visible" : "hidden",
            }}
          >
            {showSearch && (
              <div style={{ position: "sticky", top: 0, padding: 4, background: "var(--df-surface-elevated)", borderBottom: "1px solid var(--df-border-subtle)" }}>
                <input
                  type="text"
                  autoFocus
                  value={modelMenuQuery}
                  onChange={(e) => setModelMenuQuery(e.target.value)}
                  placeholder={`search ${opts.length} models…`}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    background: "var(--df-bg-section)",
                    border: "1px solid var(--df-border-subtle)",
                    borderRadius: "var(--df-r-sm)",
                    fontFamily: "var(--df-font-mono)",
                    fontSize: 11,
                    color: "var(--df-text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}
            {opts.length === 0 && modelsLoading && (
              <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--df-text-faint)" }}>{t("common.loading")}</div>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                role="option"
                aria-selected={m.id === createModel}
                onClick={() => {
                  setCreateModel(m.id);
                  writeLastModel(createProvider, m.id);
                  setShowModelMenu(false);
                  setModelMenuQuery("");
                }}
                className={`reg-model-menu-opt${m.id === createModel ? " is-on" : ""}`}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", flex: 1 }}>
                  <span>{m.label}</span>
                  {m.sub && <span style={{ fontSize: 10, color: "var(--df-text-faint)" }}>{m.sub}</span>}
                </span>
                {m.id === createModel && <span style={{ color: "var(--df-accent-ok)", marginLeft: 8 }}>✓</span>}
              </button>
            ))}
          </div>
        );
      })()}

    </div>
  );
}

// Lightweight relative-time formatter used by the All-design-systems modal.
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ─── Skills tab content ───────────────────────────────────────────────────
//
// Grouped into 2 visible sections:
//  1. Your skills     — source 'df' (user-managed, editable)
//  2. Project skills  — source 'project' (detected in cwd, read-only)
//
// builtin and global sources surface via the slash menu in chat, but not
// in this tab (they're contextual utilities, not manageable assets).

// Skills tab — simplified Claude-style layout.
// Target audience: non-technical users. Keep 3 controls total:
//   search · [+ New] button · skill cards.
// Import is folded into the New-skill modal as a tab.
// Custom folder picker and Refresh moved to Settings > Skills.
// Project+Your skills render in one grid with a subtle source chip per card.
function SkillsTabContent({
  cwd,
  onCreateProject,
}: {
  cwd: string;
  onCreateProject: HomeScreenProps["onCreateProject"];
}) {
  // Skills live at <repoRoot>/skills/ as the canonical location, with
  // <repoRoot>/.claude/skills/ kept read-only for backward
  // compatibility. The custom-folder pick and skills_custom_path
  // setting are no longer surfaced — projects always cache against
  // the project folder.
  const { t } = useT();
  const registryState = useSkillRegistry(cwd || null);
  const { bySource, rescan } = registryState;

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // skills also use EntityCard now — needs per-card menu open state.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [skillDeleteTarget, setSkillDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  // User ask 2026-05-21: "botao de upload skill ja queria q abrisse
  // dialogo, podendo tambem escolher pasta local". Two hidden inputs
  // drive the file/folder pickers; the visible button toggles a small
  // menu with explicit picks so the user knows which dialog they're
  // about to summon. Modal stays for URL / advanced flows.
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importDirInputRef = useRef<HTMLInputElement>(null);
  const handleQuickFileImport = async (file: File): Promise<void> => {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const parsed = parseSkillZip(new Uint8Array(await file.arrayBuffer()), file.name);
        const res = await installSkill(parsed.installInput);
        if ("error" in res) flashToast(`Falha: ${res.error}`);
        else { flashToast(tf("home.skills.toast.imported", res.name)); await rescan(); }
      } else if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
        const text = await file.text();
        const parsed = parseSkillMarkdown(text);
        const fallback = file.name.replace(/\.(markdown|md)$/i, "").replace(/[-_]/g, " ").trim();
        const name = parsed.name ?? fallback;
        const res = await installSkill({
          name: name || file.name,
          trigger: parsed.trigger ?? "",
          description: parsed.description,
          body: parsed.body,
        });
        if ("error" in res) flashToast(`Falha: ${res.error}`);
        else { flashToast(tf("home.skills.toast.imported", res.name)); await rescan(); }
      } else {
        flashToast(`Tipo de arquivo não suportado: ${file.name}`);
      }
    } catch (err) {
      flashToast(`Falha: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleQuickFolderImport = async (files: FileList): Promise<void> => {
    // Walk every selected file; pick those ending in .md. Prefer
    // SKILL.md when sibling .md files compete in the same folder.
    const mds = Array.from(files).filter((f) => /\.md$/i.test(f.name));
    if (mds.length === 0) { flashToast("Nenhum .md na pasta selecionada"); return; }
    const byFolder = new Map<string, File>();
    for (const f of mds) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const folder = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
      const isSkillMd = /(^|\/)SKILL\.md$/i.test(rel);
      const existing = byFolder.get(folder);
      if (!existing || isSkillMd) byFolder.set(folder, f);
    }
    let ok = 0; let fail = 0;
    for (const [folder, f] of byFolder.entries()) {
      try {
        const text = await f.text();
        const parsed = parseSkillMarkdown(text);
        const fallback = (folder.split("/").pop() || f.name.replace(/\.md$/i, "")).replace(/[-_]/g, " ").trim();
        const name = parsed.name ?? fallback;
        const res = await installSkill({
          name: name || f.name,
          trigger: parsed.trigger ?? "",
          description: parsed.description,
          body: parsed.body,
        });
        if ("error" in res) fail++; else ok++;
      } catch { fail++; }
    }
    await rescan();
    flashToast(`Importadas ${ok} skill(s)${fail ? `, ${fail} falha(s)` : ""}.`);
  };
  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  // Keep `selected` fresh when the registry updates after an edit/delete.
  useEffect(() => {
    if (!selected) return;
    const all = [
      ...bySource.df, ...bySource.project,
      ...bySource.global, ...bySource.builtin,
    ];
    const match = all.find((s) => s.id === selected.id);
    if (match && match !== selected) setSelected(match);
    else if (!match) setSelected(null);
  }, [bySource, selected]);

  const handleTestInChat = (skill: Skill) => {
    const slug = (skill.name || skill.trigger.replace(/^\//, ""))
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skill-test";
    const projectName = `test: ${skill.name}`;
    const effectiveCwd = cwd || undefined;
    const seedPrompt = `${skill.trigger}`;
    // Use absolute workspace root when available; fall back to literal
    // ~ only if the bridge never set defaultCwd (browser-only / degraded).
    const scratchRoot = cwd ? `${cwd.replace(/\/$/, "")}/scratch` : "~/design-factory/scratch";
    void onCreateProject(
      projectName,
      `${scratchRoot}/${slug}-${Date.now().toString(36)}`,
      "hifi",
      "prototype",
      seedPrompt,
      effectiveCwd,
    );
    setSelected(null);
  };

  // Union of user-editable (df) and project (read-only) skills.
  // Global + builtin are advanced — hidden by default, accessible via Settings.
  const unified = useMemo(() => [...bySource.df, ...bySource.project], [bySource.df, bySource.project]);

  const filtered = useMemo(() => {
    if (!search) return unified;
    const q = search.toLowerCase();
    return unified.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.trigger.toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q)
    );
  }, [unified, search]);

  return (
    <div className="skills-tab">
      {/* Simple header on Skills/DS — only the Projects hero is
          differentiated. Mirrors DS + Templates tabs. */}
      <header className="skills-header">
        <div>
          <h2 className="skills-title">{t("home.hero.skills.title")}</h2>
          <p className="skills-lede">
            {t("home.hero.skills.subtitle")}
          </p>
        </div>
        <div className="skills-header-actions">
          <div style={{ position: "relative" }}>
            <button
              className="skills-cta skills-cta--ghost"
              onClick={() => setImportMenuOpen((v) => !v)}
              title={t("home.skills.import.title")}
              aria-haspopup="menu"
              aria-expanded={importMenuOpen}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {t("home.hero.skills.cta.import")}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, transform: importMenuOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {importMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setImportMenuOpen(false)} />
                <div
                  role="menu"
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0,
                    minWidth: 220, zIndex: 100,
                    background: "var(--df-surface-elevated)",
                    border: "1px solid var(--df-border-subtle)",
                    borderRadius: "var(--df-r-lg)",
                    boxShadow: "var(--df-shadow-card)",
                    overflow: "hidden",
                  }}
                >
                  {[
                    { id: "file", label: "Arquivo (.md ou .zip)", onSelect: () => { setImportMenuOpen(false); importFileInputRef.current?.click(); } },
                    { id: "folder", label: "Pasta local", onSelect: () => { setImportMenuOpen(false); importDirInputRef.current?.click(); } },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={opt.onSelect}
                      style={{
                        display: "block", width: "100%", padding: "10px 14px",
                        background: "none", border: "none",
                        color: "var(--df-text-primary)", fontSize: "var(--df-text-sm)",
                        textAlign: "left", cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--df-interactive-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".md,.markdown,.zip,text/markdown,application/zip,application/x-zip-compressed"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await handleQuickFileImport(f);
              e.target.value = "";
            }}
          />
          <input
            ref={importDirInputRef}
            type="file"
            // webkitdirectory + multiple let Chrome/Edge expose a directory
            // picker. TS types don't cover webkitdirectory natively, so cast.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            multiple
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = e.target.files;
              if (files && files.length > 0) await handleQuickFolderImport(files);
              e.target.value = "";
            }}
          />
          <button className="skills-cta" onClick={() => setShowCreate(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t("home.hero.skills.cta")}
          </button>
        </div>
      </header>

      {/* Custom folder row removed. The canonical path is
          <repoRoot>/skills/, with <repoRoot>/.claude/skills/ as legacy
          read-only compat. */}

      <div className="skills-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          type="search"
          placeholder={t("home.skills.search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("home.skills.search.aria")}
        />
      </div>

      {filtered.length === 0 ? (
        search ? (
          <div className="skills-empty">
            <span className="skills-empty-title">{tf("home.skills.empty.match", search)}</span>
            <span className="skills-empty-body">{t("home.skills.empty.match.body")}</span>
          </div>
        ) : (
          <div className="skills-empty">
            <span className="skills-empty-title">{t("home.skills.empty.title")}</span>
            <span className="skills-empty-body">{t("home.skills.empty.body")}</span>
            <button className="skills-cta" onClick={() => setShowCreate(true)} style={{ marginTop: 12 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t("home.skills.empty.cta")}
            </button>
          </div>
        )
      ) : (
        /* skill cards use EntityCard — same anatomy as
         * Projects/Templates/DS so all 4 surfaces share one visual
         * language. The thumb renders trigger + source as a typographic
         * preview (skills have no visual cover). */
        <div className="home-right-grid">
          {filtered.map((s) => {
            const isReadOnly = s.source !== "df";
            const sourceLabel = s.source === "df"
              ? t("home.skills.tag.yours")
              : s.source === "project"
              ? t("home.skills.tag.project")
              : s.source;
            // User ask 2026-05-21: "remova opcao testar no chat (...)
            // nos 3 pontos deixe apenas apagar e editar". `setSelected`
            // opens the modal in detail/edit view, so a single "Editar"
            // entry is enough for both view + edit. project-source
            // skills stay non-editable + non-deletable from the home
            // (they live under projects/<slug>/skills/ and belong to
            // that project's lifecycle).
            const actions: { label: string; onSelect: () => void; tone?: "default" | "danger" }[] = [];
            if (!isReadOnly) {
              actions.push({
                label: t("home.skill.action.edit"),
                onSelect: () => setSelected(s),
              });
              actions.push({
                label: t("home.skill.action.delete"),
                tone: "danger" as const,
                onSelect: () => { setSkillDeleteTarget({ id: s.id, name: s.name }); setMenuOpenId(null); },
              });
            }
            return (
              <EntityCard
                key={s.id}
                id={s.id}
                title={prettifyName(s.name)}
                hoverTitle={`${sourceLabel} · ${s.path || s.id}`}
                optionsLabel={t("home.skill.options.aria")}
                thumb={<SkillCardPreview skill={s} sourceLabel={sourceLabel} />}
                onOpen={() => setSelected(s)}
                menuOpen={menuOpenId === s.id}
                onMenuToggle={(open) => setMenuOpenId(open ? s.id : null)}
                actions={actions}
              />
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <SkillCreateModal
          registry={registryState}
          onClose={() => setShowCreate(false)}
          onSaved={(skill) => {
            setShowCreate(false);
            flashToast(tf("home.skills.toast.saved", skill.name));
            void rescan();
          }}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <SkillImportModal
          registry={registryState}
          onClose={() => setShowImport(false)}
          onImported={(skill) => {
            setShowImport(false);
            flashToast(tf("home.skills.toast.imported", skill.name));
            void rescan();
          }}
        />
      )}

      {/* Detail modal */}
      {selected && (
        <SkillDetailModal
          skill={selected}
          onClose={() => setSelected(null)}
          onChanged={(next) => {
            setSelected(next);
            flashToast(tf("home.skills.toast.saved", next.name));
            void rescan();
          }}
          onDeleted={() => {
            flashToast(t("home.skills.toast.deleted"));
            void rescan();
          }}
          onTestInChat={handleTestInChat}
        />
      )}

      <PadroesConfirmModal
        open={!!skillDeleteTarget}
        title={t("home.skill.delete.title")}
        body={skillDeleteTarget ? tf("home.skill.delete.confirm", skillDeleteTarget.name) : ""}
        confirmLabel={t("home.skill.delete.title")}
        tone="danger"
        onClose={() => setSkillDeleteTarget(null)}
        onConfirm={async () => {
          if (!skillDeleteTarget) return;
          const ok = await deleteSkill(skillDeleteTarget.id);
          if (ok) { flashToast(t("home.skills.toast.deleted")); await rescan(); }
          else { flashToast(t("home.skill.delete.failed")); }
          setSkillDeleteTarget(null);
        }}
      />

      {toast && (
        <div className="skills-toast" role="status" aria-live="polite">{toast}</div>
      )}
    </div>
  );
}

// ─── DS card preview ───────────────────────────────────────────────────────
// Reads the DS's design.md once, parses the first few color tokens, and
// renders them as a horizontal swatch BAND filling the EntityCard thumb
// (16:9). User spec "queria padronizar esses cards"
// — DS cards now share EntityCard anatomy with Project + Template cards;
// only the thumb content differs. Band = 4–6 swatches stretched edge-
// to-edge with a faint "Aa" sample overlay so DS cards read instantly
// as design systems even at thumbnail size.

function DsCardPreview({ designMdPath, coverPath }: { designMdPath: string; coverPath?: string }) {
  const { t } = useT();
  const cached = dsColorCache.get(designMdPath);
  const [colors, setColors] = useState<string[] | null>(cached?.colors ?? null);
  const [state, setState] = useState<"loading" | "ok" | "empty" | "missing">(cached?.state ?? "loading");
  const [coverDataUri, setCoverDataUri] = useState<string | null>(null);

  // Cover image (when present) takes over the whole thumb band — full
  // bleed image cover instead of the swatch+Aa palette band. We still
  // load the design.md colors in parallel so a future cover removal
  // falls back instantly to the palette view without a re-fetch.
  useEffect(() => {
    if (!coverPath) { setCoverDataUri(null); return; }
    let cancelled = false;
    readFileViaBridge(coverPath).then((f) => {
      if (cancelled) return;
      // /fs/read returns binary as `data:application/octet-stream;base64,…`.
      // For images we need the right MIME so <img src> renders correctly.
      if (f?.content?.startsWith("data:")) {
        const ext = coverPath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
                  : ext === "webp" ? "image/webp"
                  : "image/png";
        const base64 = f.content.split(",")[1] || "";
        setCoverDataUri(`data:${mime};base64,${base64}`);
      }
    }).catch(() => setCoverDataUri(null));
    return () => { cancelled = true; };
  }, [coverPath]);

  useEffect(() => {
    // Already cached from a prior mount → skip the disk read + parse entirely.
    if (dsColorCache.has(designMdPath)) return;
    let cancelled = false;
    readFileViaBridge(designMdPath).then((f) => {
      if (cancelled) return;
      if (!f) { dsColorCache.set(designMdPath, { state: "missing", colors: null }); setState("missing"); return; }
      const content = (f.content ?? "").trim();
      if (content.length < 40) { dsColorCache.set(designMdPath, { state: "empty", colors: null }); setState("empty"); return; }
      try {
        const parsed = parseDesignSystem(content);
        const hex = parsed.colors
          .map((c) => c.hex)
          .filter((v) => /^#[0-9a-f]{3,8}$/i.test(v))
          .slice(0, 4); // user: 4 main colors only — 6 was too busy
        if (hex.length > 0) { dsColorCache.set(designMdPath, { state: "ok", colors: hex }); setColors(hex); setState("ok"); }
        else { dsColorCache.set(designMdPath, { state: "empty", colors: null }); setState("empty"); }
      } catch {
        setState("empty");
      }
    }).catch(() => setState("missing"));
    return () => { cancelled = true; };
  }, [designMdPath]);

  // Cover present → render it full-bleed and let the palette/Aa fallback
  // hide. The EntityCard frame supplies the 16:9 aspect; the img just
  // fills it.
  if (coverDataUri) {
    return (
      <div className="ds-card-thumb-band ds-card-thumb-band--cover">
        <img
          src={coverDataUri}
          alt=""
          aria-hidden="true"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="ds-card-thumb-band ds-card-thumb-band--loading">
        <span className="ds-card-thumb-status">{t("common.loading")}</span>
      </div>
    );
  }

  // Empty / missing design.md — surface clearly instead of faking gray dots
  // that look like a real palette. This is the root of the "cores sumiram"
  // report — the file was empty all along, we just hid it.
  if (state === "empty" || state === "missing" || !colors) {
    return (
      <div className="ds-card-thumb-band ds-card-thumb-band--empty">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="ds-card-thumb-status">
          {state === "missing" ? t("home.ds.thumb.missing") : t("home.ds.thumb.empty")}
        </span>
      </div>
    );
  }

  // edge-to-edge horizontal swatch band + Aa typography sample overlay.
  // The band reads as "this is a palette" at thumbnail size; the Aa adds
  // typographic context so the card doesn't get confused with a paint
  // sample. 4 swatches max — 6 was reading as carnival per user
  // 2026-05-17; the 4 main brand colors are enough to ID the system.
  const palette = colors.slice(0, 4);
  return (
    <div className="ds-card-thumb-band">
      <div className="ds-card-thumb-swatches" aria-hidden>
        {palette.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="ds-card-thumb-swatch"
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Skill card preview ────────────────────────────────────────────────
// Typographic thumb for skill cards. Skills have no visual cover
// (they're markdown files), so the thumb is composed: monospace
// trigger as hero text (the part the user types in chat) plus a
// source chip in the corner. Stays inside the EntityCard 16:9 thumb
// so all four tabs share the same frame.

function SkillCardPreview({ skill, sourceLabel }: { skill: Skill; sourceLabel: string }) {
  // User ask 2026-05-21: "essa tag SUAS ta ridicula, remova". Source
  // chip dropped from the thumb. sourceLabel still threads through (the
  // card subtitle / hoverTitle can use it elsewhere). Logo DF soft
  // stays — flat neutral background + low-contrast DF logo centred.
  void skill; void sourceLabel;
  return (
    <div
      className="skill-card-thumb"
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--df-bg-section)",
        color: "var(--df-text-faint)",
        width: "100%", height: "100%",
      }}
    >
      <Logo size={48} style={{ opacity: 0.22 }} />
    </div>
  );
}

// ─── TemplatesTab — saved snapshots + golden references ──────────────
// Reads `df:templates` from localStorage (populated by the Share →
// "Save as template" action in the editor) and exposes them as
// reusable starting points. New project clones the template HTML
// straight into the new file.

interface SavedTemplate {
  id: string;
  name: string;
  html: string;
  createdAt: number;
}

function TemplatesTab({ onUseTemplate }: { onUseTemplate: (name: string, html: string) => void }) {
  const { t } = useT();
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("df:templates") || "[]";
      const arr = JSON.parse(raw) as SavedTemplate[];
      if (Array.isArray(arr)) setTemplates(arr);
    } catch {}
  }, []);
  const persist = (next: SavedTemplate[]) => {
    setTemplates(next);
    try { localStorage.setItem("df:templates", JSON.stringify(next)); } catch {}
  };
  const handleDelete = (id: string) => {
    persist(templates.filter((tpl) => tpl.id !== id));
  };
  const handleRename = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const next = window.prompt(t("home.template.rename.prompt"), tpl.name);
    if (next && next.trim() && next !== tpl.name) {
      persist(templates.map((t) => (t.id === id ? { ...t, name: next.trim() } : t)));
    }
  };
  const handleDuplicate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const copy: SavedTemplate = {
      ...tpl,
      id: `${tpl.id}-${Date.now().toString(36).slice(-4)}`,
      name: `${tpl.name} (cópia)`,
      createdAt: Date.now(),
    };
    persist([copy, ...templates]);
  };
  // header simples seguindo Skills/DS (user spec: "templates eh
  // pra seguir mesma linha de skills"). Pre- had no header at all on
  // Templates tab; added a label hero; standardizes on the same
  // .skills-header anatomy across Skills/DS/Templates.
  // wrap in `.skills-tab` envelope so width / margin /
  // gap match Skills/DS exactly. User spec: "largura da pagina de
  // tempaltes ta diferente das outras quero tudo padronizado igual,
  // mesmas alturas, larguras, posições etc". Without this wrapper the
  // Templates tab content rendered directly inside .home-stage-v8
  // (1180px max), while Skills/DS rendered inside their own 1080px
  // .skills-tab/.ds-tab containers — visible 100px width divergence.
  return (
    <div className="skills-tab">
      <header className="skills-header">
        <div>
          <h2 className="skills-title">{t("home.hero.templates.title")}</h2>
          <p className="skills-lede">
            {t("home.hero.templates.subtitle")}
          </p>
        </div>
      </header>

      {templates.length === 0 ? (
        <div className="home-right-grid">
          <div className="canvas-empty" style={{ gridColumn: "1 / -1" }}>
            <div className="canvas-empty-inner">
              <div style={{ color: "var(--df-text-secondary)", fontSize: "var(--df-text-md)", fontWeight: 600 }}>
                {t("home.empty.templates.title")}
              </div>
              <div style={{ color: "var(--df-text-faint)", fontSize: "var(--df-text-sm)", marginTop: 6, maxWidth: 420, lineHeight: 1.5 }}>
                {t("home.empty.templates.body")}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="home-right-grid">
          {templates.map((tpl) => (
            <EntityCard
              key={tpl.id}
              id={tpl.id}
              title={prettifyName(tpl.name)}
              hoverTitle={`${t("home.template.use")} · ${new Date(tpl.createdAt).toLocaleDateString()}`}
              optionsLabel={t("home.template.options.aria")}
              thumb={
                <div className="entity-card-template-thumb">
                  <iframe
                    srcDoc={tpl.html}
                    title={tpl.name}
                    sandbox=""
                    aria-hidden
                  />
                </div>
              }
              onOpen={() => onUseTemplate(tpl.name, tpl.html)}
              menuOpen={menuOpenId === tpl.id}
              onMenuToggle={(open) => setMenuOpenId(open ? tpl.id : null)}
              actions={[
                { label: t("home.template.action.use"), onSelect: () => onUseTemplate(tpl.name, tpl.html) },
                { label: t("home.template.action.rename"), onSelect: () => handleRename(tpl.id) },
                { label: t("home.template.action.duplicate"), onSelect: () => handleDuplicate(tpl.id) },
                { label: t("home.template.action.delete"), onSelect: () => handleDelete(tpl.id), tone: "danger" },
              ]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
