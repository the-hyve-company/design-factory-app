import { useRef, useState } from "react";
import {
  installSkill,
  fetchUrlViaBridge,
  listFolder,
  readFileViaBridge,
  parseSkillMarkdown,
  type Skill,
} from "@/lib/claude-bridge";
import { ModalClose } from "@/components/dfds";
import type { UseSkillRegistry } from "@/hooks/useSkillRegistry";
import { parseSkillZip } from "@/lib/skill-zip-import";

// Import skill modal — 3 sub-tabs:
//   Upload .md   — drop or browse a local file
//   From URL     — GitHub raw / Gist / Pages URL
//   Scan folder  — walk a skills/ or .claude/skills/ dir
//
// Every path terminates in a preview → confirm flow so the user
// always reviews the body before it lands in <repoRoot>/skills/.

interface Props {
  onClose: () => void;
  onImported: (skill: Skill) => void;
  registry: UseSkillRegistry;
}

type Tab = "upload" | "url" | "folder";
type Staged = {
  name: string;
  trigger: string;
  description: string | null;
  body: string;
  sourceHint: string; // "upload: foo.md" / "url: https://…" / "folder: /path"
  extraFiles?: Record<string, string>;
  forceSlug?: string;
};

export function SkillImportModal({ onClose, onImported, registry }: Props) {
  const [tab, setTab] = useState<Tab>("upload");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!staged) return;
    setImporting(true);
    setError(null);
    const result = await installSkill({
      name: staged.name,
      trigger: staged.trigger,
      description: staged.description,
      body: staged.body,
      extraFiles: staged.extraFiles,
      forceSlug: staged.forceSlug,
    });
    setImporting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onImported(result);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "var(--df-surface-overlay)",
        backdropFilter: "blur(14px) saturate(1.02)",
        WebkitBackdropFilter: "blur(14px) saturate(1.02)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1024, height: 720,
          maxWidth: "94vw", maxHeight: "92vh",
          background: "var(--df-surface-elevated)",
          borderRadius: "var(--df-r-3xl)",
          boxShadow: "var(--df-shadow-card)",
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gridTemplateRows: "auto 1fr",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          gridColumn: "1 / -1",
          padding: "14px 18px",
          borderBottom: "1px solid var(--df-border-subtle)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--df-bg-section)",
        }}>
          <div style={{ fontSize: "var(--df-text-md)", fontWeight: 600, color: "var(--df-text-primary)" }}>
            Import skill
          </div>
          <ModalClose onClick={onClose} />
        </div>

        {/* Left rail */}
        <nav style={{
          borderRight: "1px solid var(--df-border-subtle)",
          background: "var(--df-bg-section)",
          padding: "12px 10px",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <RailItem active={tab === "upload"} onClick={() => { setTab("upload"); setStaged(null); setError(null); }} label="Upload" helper=".md or .zip bundle" />
          <RailItem active={tab === "url"}    onClick={() => { setTab("url"); setStaged(null); setError(null); }}    label="From URL"   helper="GitHub raw or Gist" />
          <RailItem active={tab === "folder"} onClick={() => { setTab("folder"); setStaged(null); setError(null); }} label="Scan folder" helper="Pick skills from a skills/ dir (or .claude/skills/ legacy)" />
        </nav>

        {/* Main */}
        <main style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!staged && (
            <>
              {tab === "upload" && <UploadTab onStage={(s) => { setStaged(s); setError(null); }} onError={setError} />}
              {tab === "url"    && <UrlTab    onStage={(s) => { setStaged(s); setError(null); }} onError={setError} />}
              {tab === "folder" && <FolderTab onStage={(s) => { setStaged(s); setError(null); }} onError={setError} />}
            </>
          )}
          {staged && (
            <PreviewStage
              staged={staged}
              registry={registry}
              error={error}
              importing={importing}
              onBack={() => { setStaged(null); setError(null); }}
              onConfirm={handleImport}
              onEdit={(updated) => setStaged(updated)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Rail item ────────────────────────────────────────────────────────────

function RailItem({ active, onClick, label, helper }: { active: boolean; onClick: () => void; label: string; helper: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", gap: 2,
        padding: "10px 10px",
        borderRadius: "var(--df-r-sm)",
        background: active ? "var(--df-surface-raised)" : "transparent",
        border: active ? "1px solid var(--df-border-subtle)" : "1px solid transparent",
        color: active ? "var(--df-text-primary)" : "var(--df-text-secondary)",
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--df-interactive-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.1 }}>{label}</div>
      <div style={{ fontSize: 10, color: "var(--df-text-faint)", fontFamily: "var(--df-font-mono)" }}>{helper}</div>
    </button>
  );
}

// ─── Upload tab ───────────────────────────────────────────────────────────

function UploadTab({ onStage, onError }: { onStage: (s: Staged) => void; onError: (e: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // User ask 2026-05-21: "skills deveria ser criar ou upload. upload
  // podendo ser um zip q vamos descompactar um um skill md que precisamos
  // dar nome e colocar me uma pasta de skill". So this tab now accepts:
  //   • a single .md (legacy path) — name optional, editable in preview
  //   • a .zip bundle — first SKILL.md/*.md inside becomes the body; the
  //     filename or top-level folder becomes the suggested name.
  const handleZip = async (file: File): Promise<void> => {
    try {
      const parsed = parseSkillZip(new Uint8Array(await file.arrayBuffer()), file.name);
      const input = parsed.installInput;
      onStage({
        name: input.name,
        trigger: input.trigger ?? "",
        description: input.description ?? null,
        body: input.body,
        sourceHint: parsed.sourceHint,
        extraFiles: input.extraFiles,
        forceSlug: input.forceSlug,
      });
    } catch (err) {
      onError(`Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".zip")) {
      await handleZip(file);
      return;
    }
    if (file.size > 200_000) {
      onError(`${file.name} too large (max 200KB for SKILL.md)`);
      return;
    }
    const text = await file.text();
    const parsed = parseSkillMarkdown(text);
    // Pre-fix, missing `name:` aborted the import. User ask: a bare
    // SKILL.md should still load — the user picks the name on the
    // preview screen (it carries an editable input).
    const fallbackFromFilename = file.name.replace(/\.md$/i, "").replace(/[-_]/g, " ").trim();
    const name = parsed.name ?? fallbackFromFilename;
    onStage({
      name: name || "",
      trigger: parsed.trigger ?? "",
      description: parsed.description,
      body: parsed.body,
      sourceHint: `upload: ${file.name}`,
    });
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) await handleFile(f);
      }}
      style={{
        flex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 480,
          padding: "36px 24px",
          border: `1px dashed ${dragOver ? "var(--df-border-strong)" : "var(--df-border-subtle)"}`,
          borderRadius: "var(--df-r-md)",
          background: dragOver ? "var(--df-bg-section)" : "transparent",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--df-text-muted)" }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <div style={{ fontSize: "var(--df-text-sm)", color: "var(--df-text-primary)" }}>
          Drop a <code>SKILL.md</code> or <code>.zip</code> bundle here
        </div>
        <div style={{ fontSize: "var(--df-text-xs)", color: "var(--df-text-faint)" }}>
          or
        </div>
        <button
          className="df-btn df-btn--secondary"
          onClick={() => inputRef.current?.click()}
          style={{ fontSize: "var(--df-text-xs)" }}
        >
          Browse
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.zip,text/markdown,application/zip,application/x-zip-compressed"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await handleFile(f);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}

// ─── URL tab ──────────────────────────────────────────────────────────────

function UrlTab({ onStage, onError }: { onStage: (s: Staged) => void; onError: (e: string) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFetch = async () => {
    const u = url.trim();
    if (!u) return;
    setLoading(true);
    // Transform GitHub /blob/ URLs into raw.githubusercontent when detected
    const raw = u.replace(/^https:\/\/github\.com\/(.+?)\/blob\//, "https://raw.githubusercontent.com/$1/");
    const res = await fetchUrlViaBridge(raw);
    setLoading(false);
    if ("error" in res) {
      onError(`Couldn't reach ${raw} — ${res.error}`);
      return;
    }
    const parsed = parseSkillMarkdown(res.html);
    const name = parsed.name ?? raw.split("/").pop()?.replace(/\.md$/i, "").replace(/[-_]/g, " ") ?? "";
    if (!name) { onError("Fetched content doesn't look like a skill — missing `name:` frontmatter"); return; }
    onStage({
      name,
      trigger: parsed.trigger ?? "",
      description: parsed.description,
      body: parsed.body,
      sourceHint: `url: ${raw}`,
    });
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        padding: "10px 12px",
        background: "var(--df-bg-section)",
        border: "1px solid var(--df-border-subtle)",
        borderRadius: "var(--df-r-sm)",
        fontSize: "var(--df-text-xs)",
        color: "var(--df-text-secondary)",
        lineHeight: 1.6,
      }}>
        Paste a URL to a <code>SKILL.md</code> on GitHub, Gist, or Pages.
        GitHub <code>/blob/</code> URLs are auto-converted to raw content.
        <br />
        <strong>Imported skills aren't reviewed</strong> — check the preview before enabling.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="df-input"
          type="url"
          placeholder="https://github.com/owner/repo/blob/main/skill.md"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleFetch(); }}
          style={{ flex: 1, fontFamily: "var(--df-font-mono)", fontSize: 12 }}
          autoFocus
        />
        <button
          className="df-btn df-btn--primary"
          onClick={() => void handleFetch()}
          disabled={!url.trim() || loading}
          style={{ fontSize: "var(--df-text-xs)" }}
        >
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </div>
    </div>
  );
}

// ─── Folder tab ───────────────────────────────────────────────────────────

interface FoundSkill { path: string; name: string; trigger: string; description: string | null; body: string; }

function FolderTab({ onStage, onError }: { onStage: (s: Staged) => void; onError: (e: string) => void }) {
  const [folder, setFolder] = useState("");
  const [found, setFound] = useState<FoundSkill[]>([]);
  const [scanning, setScanning] = useState(false);

  const handlePick = async () => {
    const picked = window.prompt("Paste absolute path of the folder to scan:");
    if (!picked) return;
    const p = picked.trim();
    setFolder(p);
    await scan(p);
  };

  const scan = async (root: string) => {
    setScanning(true);
    setFound([]);
    try {
      const results: FoundSkill[] = [];
      const walk = async (p: string, depth: number) => {
        if (depth > 3 || results.length >= 50) return;
        const r = await listFolder(p);
        if (!r || "error" in r) return;
        for (const e of r.entries) {
          if (results.length >= 50) break;
          if (e.isDir) {
            if (/node_modules|\.git|dist|build/.test(e.name)) continue;
            await walk(e.path, depth + 1);
          } else if (e.name.toLowerCase().endsWith(".md")) {
            if (e.size > 200_000) continue;
            const f = await readFileViaBridge(e.path);
            if (!f?.isText) continue;
            const parsed = parseSkillMarkdown(f.content);
            if (!parsed.name) continue; // not a skill
            results.push({
              path: e.path,
              name: parsed.name,
              trigger: parsed.trigger ?? "",
              description: parsed.description,
              body: parsed.body,
            });
          }
        }
      };
      await walk(root, 0);
      setFound(results);
      if (results.length === 0) onError("No SKILL.md files found under that folder");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, flex: 1, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="df-btn df-btn--secondary" onClick={() => void handlePick()} style={{ fontSize: "var(--df-text-xs)" }}>
          Pick folder…
        </button>
        {folder && (
          <span style={{ flex: 1, fontFamily: "var(--df-font-mono)", fontSize: "var(--df-text-xs)", color: "var(--df-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {folder}
          </span>
        )}
        {folder && (
          <button className="df-btn df-btn--secondary" onClick={() => void scan(folder)} disabled={scanning} style={{ fontSize: "var(--df-text-xs)" }}>
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
        )}
      </div>

      {found.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "var(--df-text-faint)", fontFamily: "var(--df-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Found {found.length} · click to preview + import
          </div>
          <div style={{
            flex: 1, overflow: "auto",
            border: "1px solid var(--df-border-subtle)",
            borderRadius: "var(--df-r-sm)",
          }}>
            {found.map((s) => (
              <button
                key={s.path}
                onClick={() => onStage({
                  name: s.name,
                  trigger: s.trigger,
                  description: s.description,
                  body: s.body,
                  sourceHint: `folder: ${s.path}`,
                })}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--df-border-subtle)",
                  cursor: "pointer",
                  color: "var(--df-text-primary)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--df-interactive-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontSize: "var(--df-text-sm)", fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 10, fontFamily: "var(--df-font-mono)", color: "var(--df-text-muted)", marginTop: 2 }}>
                  {s.trigger || "(no trigger)"} · {s.path.split("/").slice(-3).join("/")}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Preview stage ────────────────────────────────────────────────────────

function PreviewStage({
  staged, registry, error, importing, onBack, onConfirm, onEdit,
}: {
  staged: Staged;
  registry: UseSkillRegistry;
  error: string | null;
  importing: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onEdit: (s: Staged) => void;
}) {
  const [editingMeta, setEditingMeta] = useState(false);

  const t = staged.trigger.trim();
  const collision = t ? registry.byTrigger.get(t)?.[0] ?? null : null;
  const isUnreviewed = staged.sourceHint.startsWith("url:");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "12px 22px",
        borderBottom: "1px solid var(--df-border-subtle)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button className="df-btn df-btn--secondary" onClick={onBack} style={{ fontSize: "var(--df-text-xs)", padding: "4px 10px" }}>
          ← Back
        </button>
        <div style={{ fontSize: "var(--df-text-sm)", fontWeight: 500, color: "var(--df-text-primary)" }}>
          Preview before import
        </div>
        <div style={{ flex: 1, fontSize: 10, color: "var(--df-text-faint)", fontFamily: "var(--df-font-mono)", textAlign: "right" }}>
          {staged.sourceHint}
        </div>
      </div>

      {/* Metadata strip */}
      <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--df-border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
        {editingMeta ? (
          <>
            <input
              className="df-input"
              type="text"
              value={staged.name}
              onChange={(e) => onEdit({ ...staged, name: e.target.value })}
              placeholder="Name"
              style={{ fontSize: "var(--df-text-sm)" }}
            />
            <input
              className="df-input"
              type="text"
              value={staged.trigger}
              onChange={(e) => onEdit({ ...staged, trigger: e.target.value })}
              placeholder="/command"
              style={{ fontSize: "var(--df-text-xs)", fontFamily: "var(--df-font-mono)" }}
            />
            <input
              className="df-input"
              type="text"
              value={staged.description ?? ""}
              onChange={(e) => onEdit({ ...staged, description: e.target.value || null })}
              placeholder="Description"
              style={{ fontSize: "var(--df-text-xs)" }}
            />
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontSize: "var(--df-text-md)", fontWeight: 600, color: "var(--df-text-primary)" }}>{staged.name}</div>
              <code style={{ fontSize: 11, fontFamily: "var(--df-font-mono)", color: "var(--df-text-secondary)", padding: "1px 6px", background: "var(--df-surface-raised)", borderRadius: 3 }}>
                {staged.trigger || "(no trigger set)"}
              </code>
              <button onClick={() => setEditingMeta(true)} style={{ fontSize: 10, background: "transparent", border: "none", color: "var(--df-text-muted)", cursor: "pointer" }}>edit</button>
            </div>
            {staged.description && (
              <div style={{ fontSize: "var(--df-text-xs)", color: "var(--df-text-muted)" }}>
                {staged.description}
              </div>
            )}
          </>
        )}
        {collision && (
          <div style={{ fontSize: 11, color: "#e5c07b", fontFamily: "var(--df-font-mono)" }}>
            warning · `{t}` already used by {collision.source} · import will fail unless you pick a different command
          </div>
        )}
        {isUnreviewed && (
          <div style={{ fontSize: 11, color: "var(--df-text-muted)" }}>
            This skill is unreviewed. Read the instructions before enabling — skills run as system prompt context.
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflow: "auto",
        padding: "14px 22px",
        fontFamily: "var(--df-font-mono)", fontSize: 11, lineHeight: 1.55,
        color: "var(--df-text-primary)",
        whiteSpace: "pre-wrap",
      }}>
        {staged.body}
      </div>

      {/* Footer */}
      <div style={{
        padding: "12px 22px",
        borderTop: "1px solid var(--df-border-subtle)",
        background: "var(--df-bg-section)",
        display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center",
      }}>
        {error && (
          <div style={{ flex: 1, fontSize: 11, color: "#ff8b8b" }}>
            {error}
          </div>
        )}
        <button className="df-btn df-btn--secondary" onClick={onBack} disabled={importing}>Cancel</button>
        <button className="df-btn df-btn--primary" onClick={onConfirm} disabled={importing || !staged.name.trim() || staged.body.length < 20}>
          {importing ? "Importing…" : "Import skill"}
        </button>
      </div>
    </div>
  );
}
