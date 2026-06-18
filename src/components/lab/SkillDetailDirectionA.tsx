// SkillDetailDirectionA — view + edit a skill in the faceplate language.
// Trigger + source as engraved meta chips, description as a single field,
// body in the recessed bowl (always editable; Save is enabled when dirty).
// Delete is destructive — confirms before stub-firing. Real updateSkill /
// deleteSkill re-wire onto this when the direction is approved.

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, FileText, Folder, FolderOpen, Trash2 } from "lucide-react";
import {
  deleteSkill,
  listSkillFiles,
  openFolderViaBridge,
  readFileViaBridge,
  updateSkill,
  type Skill,
  type SkillExtraFile,
} from "@/lib/claude-bridge";

// Daemon-side validators (skills-install.mjs validateSkillInput). Mirror
// here so the Save button can pre-flight the input before the round-trip
// + render a clear hint when the user types something invalid.
const TRIGGER_RX = /^\/[a-z0-9:_-]{1,40}$/i;
const NAME_MAX = 80;

function validateNameTrigger(name: string, trigger: string): string | null {
  const n = name.trim();
  if (!n) return "Dê um nome à skill.";
  if (n.length > NAME_MAX) return `Nome máximo ${NAME_MAX} caracteres.`;
  const t = trigger.trim();
  if (t && !TRIGGER_RX.test(t))
    return "Comando inválido — começa com / e usa letras, números, _ ou - (máx 40).";
  return null;
}

// Same frontmatter shape the shipped SkillDetailModal exports — kept in
// sync so both surfaces produce identical .md downloads.
function buildFrontmatter(skill: Skill): string {
  const lines = ["---", `name: ${skill.name}`];
  if (skill.description) lines.push(`description: ${JSON.stringify(skill.description)}`);
  lines.push(`trigger: ${skill.trigger}`);
  if (skill.requires.length > 0) lines.push(`requires: [${skill.requires.join(", ")}]`);
  if (skill.override_trigger) lines.push(`override: ${JSON.stringify(skill.override_trigger)}`);
  if (skill.version) lines.push(`version: ${skill.version}`);
  lines.push("---");
  return lines.join("\n");
}

interface Props {
  skill: Skill;
  onClose: () => void;
  onChanged: (next: Skill) => void;
  onDeleted: (id: string) => void;
}

export function SkillDetailDirectionA({ skill, onClose, onChanged, onDeleted }: Props) {
  const [name, setName] = useState(skill.name);
  const [trigger, setTrigger] = useState(skill.trigger);
  const [description, setDescription] = useState(skill.description ?? "");
  const [body, setBody] = useState(skill.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);
  const dirty =
    name !== skill.name ||
    trigger !== skill.trigger ||
    description !== (skill.description ?? "") ||
    body !== skill.body;
  const validationError = useMemo(
    () => (dirty ? validateNameTrigger(name, trigger) : null),
    [dirty, name, trigger],
  );

  // Multifile display — fetch the skill's extra files once on mount.
  // Skills imported via folder/zip carry references/, scripts/, assets/
  // alongside SKILL.md; without this list they're invisible to the user.
  const [extraFiles, setExtraFiles] = useState<SkillExtraFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<SkillExtraFile | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileContentLoading, setFileContentLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    listSkillFiles(skill.id).then((r) => {
      if (cancelled) return;
      setFilesLoading(false);
      if ("error" in r) {
        // Silent: extras are a nice-to-have. The detail screen still
        // functions for editing body/description without them.
        setExtraFiles([]);
        return;
      }
      setExtraFiles(r.files);
    });
    return () => {
      cancelled = true;
    };
  }, [skill.id]);

  // Lazy-load file content when the user clicks one. Text files are
  // rendered as-is; binary files just show "binary, N bytes".
  const openFile = async (f: SkillExtraFile) => {
    setSelectedFile(f);
    if (!f.isText) {
      setFileContent(null);
      return;
    }
    setFileContentLoading(true);
    const r = await readFileViaBridge(f.path);
    setFileContentLoading(false);
    if (!r || !r.isText) {
      setFileContent(null);
      return;
    }
    setFileContent(r.content);
  };

  const save = async () => {
    if (!dirty || saving) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    // Pre-flight check: only forward fields the user actually edited.
    // Sending unchanged fields would be harmless but bloats the request
    // and makes diffs in logs noisy.
    const patch: Parameters<typeof updateSkill>[1] = {};
    if (name.trim() !== skill.name) patch.name = name.trim();
    if (trigger.trim() !== skill.trigger) patch.trigger = trigger.trim();
    if (description.trim() !== (skill.description ?? "")) {
      patch.description = description.trim() || null;
    }
    if (body !== skill.body) patch.body = body;
    const result = await updateSkill(skill.id, patch);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChanged(result);
    onClose();
  };

  /** Open the skill folder in the OS file manager (Finder / Explorer /
   *  xdg-open). The daemon resolves skill.path's parent dir; we just
   *  need to send the path. Falls back to a copy-to-clipboard / log
   *  message when GUI integration is unavailable (SSH / headless). */
  const openFolder = async () => {
    if (openingFolder) return;
    if (!skill.path) {
      setError("Skill sem path conhecido — não dá pra abrir.");
      return;
    }
    setOpeningFolder(true);
    setError(null);
    const r = await openFolderViaBridge(skill.path);
    setOpeningFolder(false);
    if ("error" in r) setError(`Não consegui abrir a pasta — ${r.error}`);
  };

  const remove = async () => {
    if (saving) return;
    if (!window.confirm(`Excluir a skill "${skill.name}"? Essa ação não tem volta.`)) return;
    setSaving(true);
    const ok = await deleteSkill(skill.id);
    setSaving(false);
    if (!ok) {
      setError("Falha ao excluir.");
      return;
    }
    onDeleted(skill.id);
    onClose();
  };

  const exportMd = () => {
    const content = `${buildFrontmatter(skill)}\n\n${body}`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = skill.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    a.download = `${safe || "skill"}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  };

  return (
    <div>
      {/* Identity — name + trigger editable; source stays a read-only
          chip (it's not a property the user picks, it's how the registry
          classified the skill). The daemon's updateSkill accepts name +
          trigger in the patch; both go through the same validator that
          installSkill uses (TRIGGER_RX + 80-char name limit). */}
      <div className="dsl-zone">
        <span className="dsl-engrave">nome</span>
        <input
          className="dsl-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da skill"
          spellCheck={false}
          autoComplete="off"
          style={{ fontFamily: "var(--df-font-sans)" }}
          maxLength={NAME_MAX}
        />
      </div>
      <div className="dsl-zone">
        <span className="dsl-engrave">comando</span>
        <input
          className="dsl-input"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="/minha-skill"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="dsl-zone">
        <span className="dsl-engrave">fonte</span>
        <div className="dsl-engine">
          <div className="dsl-engine-chip" style={{ cursor: "default" }}>
            <span className="dsl-engine-k">tipo</span> {skill.source}
          </div>
          {skill.path && (
            <div className="dsl-engine-chip" style={{ cursor: "default", maxWidth: 360 }}>
              <span className="dsl-engine-k">path</span>{" "}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {skill.path}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="dsl-zone">
        <span className="dsl-engrave">descrição</span>
        <input
          className="dsl-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="O que essa skill faz e quando usar"
          spellCheck={false}
          autoComplete="off"
          style={{ fontFamily: "var(--df-font-sans)" }}
        />
      </div>

      <div className="dsl-zone">
        <span className="dsl-engrave">corpo (instruções)</span>
        <textarea
          className="dsl-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Multifile section — only renders when the skill has extras.
          The summary line groups files by top-level folder so the user
          can see "references (3), scripts (2)" at a glance instead of
          eyeballing a flat list. */}
      {(filesLoading || extraFiles.length > 0) && (
        <div className="dsl-zone">
          <span className="dsl-engrave">
            arquivos da skill{extraFiles.length > 0 && ` · ${extraFiles.length}`}
          </span>
          {extraFiles.length > 0 &&
            (() => {
              // Group by first path segment. Files at the root group as
              // "raiz". Sort groups by count desc so the densest section
              // shows first.
              const groups = new Map<string, number>();
              for (const f of extraFiles) {
                const slash = f.rel.indexOf("/");
                const key = slash === -1 ? "raiz" : f.rel.slice(0, slash);
                groups.set(key, (groups.get(key) ?? 0) + 1);
              }
              const sorted = [...groups.entries()].sort(
                (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
              );
              return (
                <div
                  style={{
                    marginBottom: 8,
                    color: "var(--df-text-muted)",
                    fontSize: "var(--df-text-xs)",
                    fontFamily: "var(--df-font-mono)",
                    lineHeight: 1.6,
                  }}
                >
                  {sorted.map(([key, count], i) => (
                    <span key={key}>
                      {i > 0 && " · "}
                      <span style={{ color: "var(--df-text-primary)" }}>{key}</span> ({count})
                    </span>
                  ))}
                </div>
              );
            })()}
          <div className="dsl-bowl" style={{ padding: 0 }}>
            {filesLoading ? (
              <div
                style={{
                  padding: "12px 14px",
                  color: "var(--df-text-muted)",
                  fontSize: "var(--df-text-xs)",
                }}
              >
                Carregando…
              </div>
            ) : (
              <>
                <div
                  style={{
                    maxHeight: 160,
                    overflowY: "auto",
                    borderBottom: selectedFile ? "1px solid var(--df-border-subtle)" : "none",
                  }}
                >
                  {extraFiles.map((f) => (
                    <button
                      key={f.rel}
                      type="button"
                      onClick={() => void openFile(f)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "16px 1fr auto",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "8px 14px",
                        background:
                          selectedFile?.rel === f.rel ? "var(--df-surface-hover)" : "none",
                        border: "none",
                        borderTop: "1px solid var(--df-border-subtle)",
                        cursor: "pointer",
                        color: "var(--df-text-primary)",
                        fontSize: "var(--df-text-xs)",
                        fontFamily: "var(--df-font-mono)",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ color: "var(--df-text-muted)" }} aria-hidden="true">
                        {f.isText ? (
                          <FileText size={14} strokeWidth={2} />
                        ) : (
                          <Folder size={14} strokeWidth={2} />
                        )}
                      </span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {f.rel}
                      </span>
                      <span style={{ color: "var(--df-text-muted)", fontSize: "10px" }}>
                        {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedFile && (
                  <div
                    style={{
                      padding: "12px 14px",
                      borderTop: extraFiles.length > 0 ? "0" : "1px solid var(--df-border-subtle)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--df-font-mono)",
                        fontSize: "10px",
                        color: "var(--df-text-muted)",
                        marginBottom: 8,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {selectedFile.rel}
                    </div>
                    {fileContentLoading ? (
                      <div style={{ color: "var(--df-text-muted)", fontSize: "var(--df-text-xs)" }}>
                        Lendo…
                      </div>
                    ) : selectedFile.isText && fileContent != null ? (
                      <pre
                        style={{
                          margin: 0,
                          padding: "10px 12px",
                          background: "var(--df-surface-recessed)",
                          border: "1px solid var(--df-border-subtle)",
                          borderRadius: "var(--df-r-sm)",
                          fontFamily: "var(--df-font-mono)",
                          fontSize: "11px",
                          lineHeight: 1.5,
                          color: "var(--df-text-primary)",
                          maxHeight: 240,
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {fileContent}
                      </pre>
                    ) : (
                      <div style={{ color: "var(--df-text-muted)", fontSize: "var(--df-text-xs)" }}>
                        Arquivo binário · {selectedFile.size} bytes · não renderizável em texto
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {(error || validationError) && (
        <div
          className="dsl-zone"
          style={{ color: "var(--df-accent-danger)", fontSize: "var(--df-text-xs)" }}
          role="alert"
        >
          {error || validationError}
        </div>
      )}

      <div
        className="dsl-foot"
        style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="dsl-engine-chip"
            onClick={remove}
            disabled={saving}
            title="Excluir skill"
            style={{
              color: "var(--df-accent-danger)",
              borderColor:
                "color-mix(in srgb, var(--df-accent-danger) 40%, var(--df-border-subtle))",
            }}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Excluir
          </button>
          <button
            type="button"
            className="dsl-engine-chip"
            onClick={exportMd}
            title="Baixar como .md"
          >
            <Download size={14} strokeWidth={2} aria-hidden="true" /> Exportar .md
          </button>
          {skill.path && (
            <button
              type="button"
              className="dsl-engine-chip"
              onClick={() => {
                void openFolder();
              }}
              disabled={openingFolder || saving}
              title={`Abrir ${skill.path} no Finder / Explorer`}
            >
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />{" "}
              {openingFolder ? "Abrindo…" : "Abrir pasta"}
            </button>
          )}
        </div>
        <button
          type="button"
          className={`cnp-begin cnp-begin--v8${saving ? " is-loading" : ""}`}
          onClick={() => {
            void save();
          }}
          disabled={!dirty || saving || validationError !== null}
          aria-busy={saving}
        >
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">{saving ? "Salvando…" : "Salvar"}</span>
          <span className="cnp-begin-arrow" aria-hidden="true">
            <ArrowRight size={16} strokeWidth={2} />
          </span>
        </button>
      </div>
    </div>
  );
}
