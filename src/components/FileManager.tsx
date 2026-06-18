import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listFolder,
  mkdirViaBridge,
  readFileViaBridge,
  removeFsEntryViaBridge,
  writeFile,
  isUsableHtmlContent,
  type FsEntry,
} from "@/lib/claude-bridge";
import { TactileBtn, TactileIconBtn } from "@/components/Tactile";
import { EntityCard } from "@/components/EntityCard";
import { HtmlPreviewCover } from "@/components/ProjectCover";

interface Props {
  initialPath: string;
  onOpen: (entry: FsEntry) => void;
  onClose: () => void;
  /** Bumped externally to force a fresh listFolder — used by EditorScreen
   *  to re-scan after the agent writes new files (user ask 2026-05-20:
   *  "auto-refresh do Files quando agente escreve arquivo novo"). */
  refreshKey?: number;
}

// Drive-style gallery view. User ask 2026-05-20: "queria uma gestao de
// files mais com cara de google drive gallery view". Replaces the previous
// tree-list with a grid of EntityCards — same anatomy as project cards on
// HomeScreen (16:9 thumb + title + sub + ⋯ menu).
//
// Thumbs render the actual content:
//   · HTML / SVG → HtmlPreviewCover (sandboxed iframe at 16:9, lazy)
//   · Image      → <img src> via /fs/read data URI (lazy)
//   · Folder     → big folder glyph, drill-down on click
//   · Other      → big language glyph
//
// Navigation: clicking a folder card replaces the current view with that
// folder's contents and pushes a breadcrumb segment. Breadcrumb back-clicks
// pop the trail.
export function FileManager({ initialPath, onOpen, onClose, refreshKey }: Props) {
  // Source of truth for which folder the gallery is showing. Starts at the
  // project's initialPath, mutates on drill-down / breadcrumb-back.
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline-create state — rendered as an EntityCard-shaped tile at the top
  // of the grid instead of a tree row.
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  // One menu open at a time. Keyed by entry.path.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // If the host swaps the project (initialPath prop changes) — reset the
  // breadcrumb back to root. Otherwise an old subfolder path would survive
  // the project switch and 404 the listing.
  useEffect(() => {
    setCurrentPath(initialPath);
    setOpenMenuId(null);
    setCreating(null);
  }, [initialPath]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await listFolder(currentPath);
    if (!data || "error" in data) {
      setError(data && "error" in data ? data.error : "Could not read folder");
      setEntries([]);
      setLoading(false);
      return;
    }
    setEntries(data.entries);
    setLoading(false);
  }, [currentPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // External refresh trigger — bumps when the agent writes a file so the
  // gallery picks up the change without the user clicking Refresh.
  useEffect(() => {
    if (refreshKey === undefined) return;
    void refresh();
  }, [refreshKey, refresh]);

  // Auto-focus the inline create input when entering create mode.
  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const drillInto = useCallback((entry: FsEntry) => {
    if (entry.isDir) {
      setCurrentPath(entry.path);
      setOpenMenuId(null);
    }
  }, []);

  const goTo = useCallback((path: string) => {
    setCurrentPath(path);
    setOpenMenuId(null);
  }, []);

  const commitCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) {
      setCreating(null);
      setCreateName("");
      return;
    }
    if (name.includes("/") || name.includes("\\")) {
      setError("Name can't contain slashes — drag the file into a subfolder after creating it.");
      return;
    }
    const target = `${currentPath.replace(/\/$/, "")}/${name}`;
    try {
      if (creating === "folder") {
        const ok = await mkdirViaBridge(target);
        if (!ok) throw new Error("mkdir failed");
      } else {
        await writeFile(target, "");
      }
      setCreating(null);
      setCreateName("");
      void refresh();
    } catch (err) {
      setError(`Could not create ${creating}: ${String(err)}`);
    }
  }, [createName, creating, currentPath, refresh]);

  const handleDelete = useCallback(
    async (entry: FsEntry) => {
      if (typeof window !== "undefined" && !window.confirm(`Deletar "${entry.name}"?`)) return;
      const ok = await removeFsEntryViaBridge(entry.path);
      if (ok) void refresh();
      else setError("Could not delete");
    },
    [refresh],
  );

  // Categories — same triage the tree-view used. Mirrors the user's
  // mental model: deliverables first, then attachments, then folders.
  const { htmls, uploads, folders } = useMemo(() => {
    const isHtml = (e: FsEntry) => !e.isDir && /\.(html?|svg)$/i.test(e.name);
    const isUpload = (e: FsEntry) => !e.isDir && !isHtml(e) && !e.name.startsWith(".");
    const isFolder = (e: FsEntry) => e.isDir;
    const sortByName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name);
    return {
      htmls: entries.filter(isHtml).sort(sortByName),
      uploads: entries.filter(isUpload).sort(sortByName),
      folders: entries.filter(isFolder).sort((a, b) => {
        const aDot = a.name.startsWith(".");
        const bDot = b.name.startsWith(".");
        if (aDot !== bDot) return aDot ? 1 : -1;
        return sortByName(a, b);
      }),
    };
  }, [entries]);

  const projectLabel = initialPath.replace(/\/$/, "").split("/").pop() || "project";
  const atRoot = currentPath === initialPath;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: "100%",
        background: "var(--df-bg-section)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header — breadcrumb + close */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--df-border-subtle)",
          boxShadow: "var(--df-shadow-tab-inset)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <FolderIcon size={14} color="var(--df-text-secondary)" />
          <Breadcrumb
            rootLabel={projectLabel}
            rootPath={initialPath}
            currentPath={currentPath}
            onGo={goTo}
          />
        </div>
        <TactileIconBtn onClick={onClose} title="Close panel">
          <XIcon size={14} />
        </TactileIconBtn>
      </div>

      {/* Toolbar — tactile actions (skeumorphic) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid var(--df-border-subtle)",
          background: "var(--df-bg-section)",
        }}
      >
        <TactileBtn
          onClick={() => {
            setCreating("file");
            setCreateName("");
            setError(null);
          }}
          disabled={creating !== null}
        >
          <PlusIcon size={11} />
          <span>File</span>
        </TactileBtn>
        <TactileBtn
          onClick={() => {
            setCreating("folder");
            setCreateName("");
            setError(null);
          }}
          disabled={creating !== null}
        >
          <PlusIcon size={11} />
          <span>Folder</span>
        </TactileBtn>
        <div style={{ flex: 1 }} />
        <TactileIconBtn onClick={() => void refresh()} title="Refresh">
          <RefreshIcon size={13} />
        </TactileIconBtn>
      </div>

      {/* Body — gallery grid. User ask 2026-05-21: 'aba de files ta com
          pouca margem, mt colado nas bordas'. Bumped 14/18 → 28/32 so the
          gallery breathes more, matches the visual weight of the home
          screen project grid. */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 32px" }}>
        {creating && (
          <div style={{ marginBottom: 20 }}>
            <div className="home-right-grid">
              <InlineCreateCard
                kind={creating}
                name={createName}
                onChange={setCreateName}
                onCommit={() => void commitCreate()}
                onCancel={() => {
                  setCreating(null);
                  setCreateName("");
                }}
                inputRef={createInputRef}
              />
            </div>
          </div>
        )}

        {loading && (
          <div style={{ padding: "12px 0", fontSize: 11, color: "var(--df-text-faint)" }}>
            Loading…
          </div>
        )}

        {error && (
          <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--df-text-secondary)",
                fontFamily: "var(--df-font-body)",
                lineHeight: 1.5,
              }}
            >
              {/ENOENT|no such file/i.test(error)
                ? "This folder doesn't exist on disk yet."
                : error}
            </div>
            {/ENOENT|no such file/i.test(error) && (
              <TactileBtn
                onClick={async () => {
                  const ok = await mkdirViaBridge(currentPath);
                  if (ok) {
                    setError(null);
                    void refresh();
                  }
                }}
              >
                Create folder
              </TactileBtn>
            )}
          </div>
        )}

        {!loading && !error && entries.length === 0 && !creating && (
          <div
            style={{
              padding: "60px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              color: "var(--df-text-muted)",
              textAlign: "center",
            }}
          >
            <FolderIcon size={28} color="var(--df-text-faint)" />
            <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 240 }}>
              {atRoot
                ? "No files in this project yet. Claude will create them automatically when you generate a design."
                : "Empty folder."}
            </div>
            <TactileBtn
              onClick={() => {
                setCreating("file");
                setCreateName("");
              }}
            >
              <PlusIcon size={11} />
              <span>Create first file</span>
            </TactileBtn>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            {htmls.length > 0 && (
              <Section label="HTML" count={htmls.length}>
                {htmls.map((e) => (
                  <FileGalleryCard
                    key={e.path}
                    entry={e}
                    menuOpen={openMenuId === e.path}
                    onMenuToggle={(open) => setOpenMenuId(open ? e.path : null)}
                    onOpen={() => onOpen(e)}
                    onDelete={() => void handleDelete(e)}
                  />
                ))}
              </Section>
            )}
            {uploads.length > 0 && (
              <Section label="Uploads & assets" count={uploads.length}>
                {uploads.map((e) => (
                  <FileGalleryCard
                    key={e.path}
                    entry={e}
                    menuOpen={openMenuId === e.path}
                    onMenuToggle={(open) => setOpenMenuId(open ? e.path : null)}
                    onOpen={() => onOpen(e)}
                    onDelete={() => void handleDelete(e)}
                  />
                ))}
              </Section>
            )}
            {folders.length > 0 && (
              <Section label="Folders" count={folders.length}>
                {folders.map((e) => (
                  <FileGalleryCard
                    key={e.path}
                    entry={e}
                    menuOpen={openMenuId === e.path}
                    onMenuToggle={(open) => setOpenMenuId(open ? e.path : null)}
                    onOpen={() => drillInto(e)}
                    onDelete={() => void handleDelete(e)}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Layout primitives
// ============================================================================

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          padding: "0 0 8px 4px",
          fontFamily: "var(--df-font-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--df-text-faint)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>{count}</span>
      </div>
      <div className="home-right-grid">{children}</div>
    </div>
  );
}

function Breadcrumb({
  rootLabel,
  rootPath,
  currentPath,
  onGo,
}: {
  rootLabel: string;
  rootPath: string;
  currentPath: string;
  onGo: (p: string) => void;
}) {
  // Build segments from rootPath → currentPath. The root is always the
  // first crumb, displayed with the project folder name. Subsequent crumbs
  // come from path segments deeper than rootPath.
  const segments = useMemo(() => {
    const out: { name: string; path: string }[] = [{ name: rootLabel, path: rootPath }];
    if (currentPath === rootPath) return out;
    const root = rootPath.replace(/\/$/, "");
    const cur = currentPath.replace(/\/$/, "");
    if (!cur.startsWith(root + "/")) return out;
    const rest = cur.slice(root.length + 1).split("/");
    let acc = root;
    for (const part of rest) {
      acc = `${acc}/${part}`;
      out.push({ name: part, path: acc });
    }
    return out;
  }, [rootLabel, rootPath, currentPath]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        minWidth: 0,
        overflow: "hidden",
        flex: 1,
      }}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <Fragment key={`${seg.path}-${i}`}>
            {i > 0 && (
              <span
                style={{
                  color: "var(--df-text-faint)",
                  fontSize: 12,
                  padding: "0 2px",
                  flexShrink: 0,
                }}
              >
                ›
              </span>
            )}
            <button
              type="button"
              onClick={() => !isLast && onGo(seg.path)}
              disabled={isLast}
              title={seg.path}
              style={{
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "var(--df-font-display)",
                fontSize: "var(--df-text-sm)",
                fontWeight: isLast ? 600 : 400,
                color: isLast ? "var(--df-text-primary)" : "var(--df-text-secondary)",
                letterSpacing: "var(--df-tracking-tight)",
                cursor: isLast ? "default" : "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 180,
                flexShrink: i === 0 ? 0 : 1,
              }}
            >
              {seg.name}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

// ============================================================================
// Gallery card
// ============================================================================

function FileGalleryCard({
  entry,
  menuOpen,
  onMenuToggle,
  onOpen,
  onDelete,
}: {
  entry: FsEntry;
  menuOpen: boolean;
  onMenuToggle: (open: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const subtitle = entry.isDir
    ? "folder"
    : `${formatSize(entry.size)} · ${formatRelative(entry.mtime)}`;
  return (
    <EntityCard
      id={entry.path}
      title={entry.name}
      subtitle={subtitle}
      hoverTitle={entry.path}
      thumb={<FileThumb entry={entry} />}
      onOpen={onOpen}
      menuOpen={menuOpen}
      onMenuToggle={onMenuToggle}
      actions={[
        { label: entry.isDir ? "Abrir" : "Abrir", onSelect: onOpen },
        { label: "Deletar", onSelect: onDelete, tone: "danger" },
      ]}
      optionsLabel={`Options for ${entry.name}`}
    />
  );
}

function FileThumb({ entry }: { entry: FsEntry }) {
  // pointerEvents: none on every thumb path — clicks pass through to the
  // parent .home-pcard <button> so the entire card area is the click target.
  // Without this, the inner iframe / div wrappers can absorb the click and
  // the card never opens. User repro 2026-05-20.
  if (entry.isDir) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "var(--df-surface-raised)",
          pointerEvents: "none",
        }}
      >
        <FolderIcon size={56} color="var(--df-text-faint)" />
      </div>
    );
  }
  const ext = entry.name.toLowerCase().split(".").pop() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "ico"].includes(ext)) {
    return <LazyImageThumb path={entry.path} alt={entry.name} />;
  }
  if (["html", "htm", "svg"].includes(ext)) {
    return <LazyHtmlThumb path={entry.path} />;
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--df-surface-raised)",
        pointerEvents: "none",
      }}
    >
      {iconForExtBig(entry.name)}
    </div>
  );
}

// Lazy HTML thumb — defers the bridge read until the card scrolls into
// view. Keeps a folder with 50 HTML files from issuing 50 simultaneous
// bridge calls on mount.
function LazyHtmlThumb({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            io.disconnect();
            (async () => {
              const file = await readFileViaBridge(path);
              if (cancelled) return;
              if (file && file.isText && isUsableHtmlContent(file.content)) {
                setHtml(file.content);
              }
              setTried(true);
            })();
          }
        }
      },
      { threshold: 0.01, rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [path]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        height: "100%",
        background: "var(--df-surface-raised)",
        pointerEvents: "none",
      }}
    >
      {html ? (
        <HtmlPreviewCover html={html} ratio="16:9" />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            color: "var(--df-text-faint)",
          }}
        >
          {tried ? (
            <HtmlIcon size={56} color="var(--df-text-faint)" />
          ) : (
            <HtmlIcon size={56} color="var(--df-text-faint)" />
          )}
        </div>
      )}
    </div>
  );
}

// Lazy image thumb — same IntersectionObserver pattern. Bridge returns a
// data URI with the proper image MIME (daemon /fs/read updated 2026-05-20).
function LazyImageThumb({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            io.disconnect();
            (async () => {
              const file = await readFileViaBridge(path);
              if (cancelled) return;
              if (file && !file.isText && file.content.startsWith("data:image/")) {
                setSrc(file.content);
              }
            })();
          }
        }
      },
      { threshold: 0.01, rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [path]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--df-surface-raised)",
        pointerEvents: "none",
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <ImageIcon size={48} color="var(--df-text-faint)" />
      )}
    </div>
  );
}

// ============================================================================
// Inline create card
// ============================================================================

function InlineCreateCard({
  kind,
  name,
  onChange,
  onCommit,
  onCancel,
  inputRef,
}: {
  kind: "file" | "folder";
  name: string;
  onChange: (s: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="home-pcard-tile entity-card">
      <div className="home-pcard" style={{ width: "100%" }}>
        <div
          className="home-pcard-thumb"
          style={{ display: "grid", placeItems: "center", background: "var(--df-surface-raised)" }}
        >
          {kind === "folder" ? (
            <FolderIcon size={56} color="var(--df-text-faint)" />
          ) : (
            <FileIcon size={56} color="var(--df-text-faint)" />
          )}
        </div>
        <div className="home-pcard-meta">
          <div
            className="home-pcard-meta-text"
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder={kind === "folder" ? "folder-name" : "file.html"}
              style={{
                flex: 1,
                background: "var(--df-bg-sunken)",
                border: "none",
                borderRadius: "var(--df-r-sm)",
                padding: "4px 8px",
                color: "var(--df-text-primary)",
                fontFamily: "var(--df-font-mono)",
                fontSize: 12,
                outline: "none",
                boxShadow: "var(--df-skeu-recess)",
                minWidth: 0,
              }}
            />
            <TactileIconBtn onClick={onCommit} title="Create (Enter)">
              <CheckIcon size={11} />
            </TactileIconBtn>
            <TactileIconBtn onClick={onCancel} title="Cancel (Esc)">
              <XIcon size={11} />
            </TactileIconBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRelative(ts: number): string {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "today";
  if (diffMs < 2 * day) return "yesterday";
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function iconForExtBig(name: string): React.ReactNode {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const color = "var(--df-text-faint)";
  if (["html", "htm", "svg"].includes(ext)) return <HtmlIcon size={56} color={color} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "ico"].includes(ext))
    return <ImageIcon size={48} color={color} />;
  if (["css", "scss", "sass"].includes(ext)) return <CssIcon size={48} color={color} />;
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx"].includes(ext))
    return <CodeIcon size={48} color={color} />;
  if (["md", "txt", "json", "yml", "yaml"].includes(ext))
    return <DocIcon size={48} color={color} />;
  return <FileIcon size={48} color={color} />;
}

// ============================================================================
// Inline SVG icons (Lucide-style — single source, no emoji)
// ============================================================================

interface IconProps {
  size?: number;
  color?: string;
}

function FolderIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h5l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function FileIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function HtmlIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ImageIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

function CssIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="13.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="10.5" r="2.5" />
      <circle cx="8.5" cy="7.5" r="2.5" />
      <circle cx="6.5" cy="12.5" r="2.5" />
      <path d="M12 2a10 10 0 1 0 0 20 4 4 0 0 1 0-8 2 2 0 0 0 0-4Z" />
    </svg>
  );
}

function CodeIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function DocIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function PlusIcon({ size = 12, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon({ size = 12, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ size = 12, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RefreshIcon({ size = 12, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
