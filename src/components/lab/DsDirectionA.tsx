// DsDirectionA — "Faceplate Console" direction for the DS modal redesign.
// Source as tactile lit keys → one morphing input bowl → engraved engine
// picker → physical preview switch → name + premium begin button.
//
// Real wiring (PR 4 of "religue tudo"): all four sources persist for real
// via the same helpers the shipped DsSetupModal uses (invokeDsGeneration,
// gitShallowClone, fetchUrlViaBridge, listFolder, writeFile, /ds/generate-
// preview). Simpler than the old modal — no GitHub OAuth device flow and
// no folder file-pick UI; the founder accepted that trade-off (Opção 1).

import { useRef, useState } from "react";
import { ArrowRight, FileText, Folder, GitBranch, Link, Upload, type LucideIcon } from "lucide-react";
import {
  BRIDGE_URL, designSystemsDir, fetchUrlViaBridge, gitShallowClone, listFolder,
  readFileViaBridge, writeFile,
} from "@/lib/claude-bridge";
import {
  buildFolderPrompt, buildGithubPrompt, buildUploadPrompt,
  invokeDsGeneration, looksLikeDesignMd,
} from "@/runtime/ds-invoker";
import type { DsEntry } from "@/types/ds";

type Source = "folder" | "github" | "upload" | "url";

const SOURCES: Array<{ id: Source; Icon: LucideIcon; name: string; hint: string; placeholder?: string }> = [
  { id: "folder", Icon: Folder,     name: "Pasta",     hint: "Aponte uma pasta com tokens, globals.css, tailwind.config — a IA extrai o design.md.", placeholder: "~/meu-projeto/src/styles" },
  { id: "github", Icon: GitBranch,  name: "GitHub",    hint: "Cole a URL de um repositório público. A IA lê os arquivos de estilo e destila o design.md.", placeholder: "https://github.com/org/repo" },
  { id: "upload", Icon: FileText,   name: "design.md", hint: "Já tem um design.md canônico? Ele entra como está, sem reprocessar.", placeholder: undefined },
  { id: "url",    Icon: Link,       name: "URL",       hint: "Cole a URL de um site. A IA captura o fingerprint visual (cores, tipografia, espaçamento).", placeholder: "https://site.com" },
];

const RELEVANT_FILE_NAMES = [
  "design.md", "DESIGN.md", "design-system.md", "tokens.css", "theme.css",
  "globals.css", "tokens.json", "theme.ts", "tailwind.config.js",
  "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs",
];
const RELEVANT_EXTS = [".css", ".scss"];

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

/** Walk a folder (depth ≤ 2) and collect up to 12 design-system files.
 *  Caps each file at 40KB (same as buildFolderPrompt's slicing). */
async function collectRelevantFiles(root: string): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  const walk = async (p: string, depth: number) => {
    if (depth > 2 || out.length >= 12) return;
    const r = await listFolder(p);
    if (!r || "error" in r) return;
    for (const e of r.entries) {
      if (out.length >= 12) break;
      if (e.isDir) {
        if (/node_modules|\.git|dist|build|\.next/.test(e.name)) continue;
        await walk(e.path, depth + 1);
        continue;
      }
      const lower = e.name.toLowerCase();
      const hit = RELEVANT_FILE_NAMES.includes(e.name) || RELEVANT_EXTS.some((ext) => lower.endsWith(ext));
      if (!hit || e.size > 200_000) continue;
      const f = await readFileViaBridge(e.path);
      if (!f?.isText) continue;
      out.push({ path: e.path, content: f.content.slice(0, 40_000) });
    }
  };
  await walk(root, 0);
  return out;
}

export function DsDirectionA({ onClose, onSaved }: { onClose: () => void; onSaved: (entry: DsEntry, opts?: { openPreview?: boolean }) => void }) {
  const [source, setSource] = useState<Source>("folder");
  const [value, setValue] = useState("");
  const [genPreview, setGenPreview] = useState(true);
  const [name, setName] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = SOURCES.find((s) => s.id === source)!;
  const saving = status !== "idle";

  const appendLog = (line: string) => setLog((prev) => [...prev, line]);

  const fireOptionalPreview = (entry: DsEntry) => {
    if (!genPreview) return;
    void fetch(`${BRIDGE_URL}/ds/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dsPath: entry.path,
        designMdPath: entry.designMdPath,
        provider: "claude",
        model: "sonnet",
      }),
    }).catch(() => { /* DsPreviewScreen surfaces failures */ });
  };

  /** Write design.md to disk + readback verify. Mirrors saveDs in the old
   *  modal so the same "bridge offline writes a blob download" guard applies. */
  const persist = async (markdown: string, folder: string, src: DsEntry["source"], sourceRef?: string) => {
    setStatus("saving");
    const trimmed = (markdown ?? "").trim();
    if (trimmed.length < 40) {
      setStatus("idle");
      setError(trimmed.length === 0 ? "O provider não retornou conteúdo." : `Retornou só ${trimmed.length} chars — parece truncado.`);
      return;
    }
    const designMdPath = folder.replace(/\/$/, "") + "/design.md";
    try {
      await writeFile(designMdPath, markdown);
    } catch (e) {
      setStatus("idle");
      setError(`Falha ao gravar design.md em ${designMdPath}: ${String(e)}`);
      return;
    }
    const readback = await readFileViaBridge(designMdPath).catch(() => null);
    if (!readback?.content || readback.content.trim().length < 40) {
      setStatus("idle");
      setError(`design.md caiu como download em vez de ${folder}. O bridge pode estar offline.`);
      return;
    }
    appendLog(`salvo → ${designMdPath} (${readback.size} bytes)`);
    const entry: DsEntry = {
      name: name.trim() || folder.split("/").filter(Boolean).pop() || "design system",
      path: folder,
      designMdPath,
      source: src,
      sourceRef,
      addedAt: Date.now(),
    };
    fireOptionalPreview(entry);
    setStatus("idle");
    // Forward intent: when preview was requested, the caller routes
    // the user to the DS detail Preview tab so they actually SEE the
    // generation in flight. Without this, the modal closes into the
    // silent home grid while the daemon spends ~minute generating —
    // user feedback: "marquei pra gerar preview ... se gerou preview
    // nao foi pra o lugar certo" (the preview did land, just nothing
    // surfaced the result loudly enough).
    onSaved(entry, { openPreview: genPreview });
    onClose();
  };

  const generateAndPersist = async (prompt: string, folder: string, src: DsEntry["source"], sourceRef?: string) => {
    setStatus("generating");
    appendLog("streaming from claude · sonnet…");
    let acc = "";
    try {
      await invokeDsGeneration(prompt, {
        onText: (t) => { acc += t; },
        onMeta: (m) => appendLog(`model ${m.model ?? "?"} · ttft ${m.ttftMs ?? "?"}ms`),
        onUsage: () => {},
        onResult: (r) => appendLog(`done · ${r.durationMs ?? "?"}ms`),
        onDone: (clean) => { void persist(clean, folder, src, sourceRef); },
        onError: (e) => { setStatus("idle"); setError(e); },
      }, { provider: "claude", model: "sonnet" });
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Resolve the absolute design-systems/<slug>/ folder via the bridge.
   *  Critical: passing a relative `design-systems/${slug}` to writeFile
   *  lets the daemon's scope loop match it against the FIRST root
   *  (projects/) so the file lands at `projects/design-systems/<slug>/`
   *  — invisible to the DS list scanner and picked up by the projects
   *  scanner as a brand-new project. Bridge endpoint /fs/design-systems-dir
   *  returns the absolute path under the canonical root. */
  const resolveDsFolder = async (slug: string): Promise<string | null> => {
    const abs = await designSystemsDir(slug);
    if (!abs) {
      setError("Bridge offline — não consegui resolver o caminho de design-systems/. Confirma que o dev bridge está rodando.");
      return null;
    }
    return abs;
  };

  const forge = async () => {
    if (saving) return;
    setError(null);
    setLog([]);
    if (!name.trim()) { setError("Dê um nome ao design system."); return; }
    const slug = slugify(name);
    try {
      if (source === "upload") {
        if (!uploadedFile) { setError("Escolha um arquivo design.md."); return; }
        const content = await uploadedFile.text();
        const targetFolder = await resolveDsFolder(slug);
        if (!targetFolder) return;
        if (looksLikeDesignMd(content)) {
          // Verbatim — skip LLM entirely.
          appendLog("design.md canônico detectado · salvando como está");
          await persist(content, targetFolder, "upload", uploadedFile.name);
        } else {
          appendLog("não parece design.md canônico · normalizando via IA");
          await generateAndPersist(buildUploadPrompt(uploadedFile.name, content), targetFolder, "upload", uploadedFile.name);
        }
        return;
      }
      if (source === "folder") {
        const raw = value.trim();
        if (!raw) { setError("Cole o caminho da pasta."); return; }
        appendLog(`escaneando ${raw}…`);
        const files = await collectRelevantFiles(raw);
        if (files.length === 0) { setError("Nenhum arquivo de design encontrado (procurei tokens.css, globals.css, design.md, tailwind.config, .css)."); return; }
        appendLog(`achei ${files.length} arquivo(s)`);
        // Folder source writes design.md INSIDE the source folder — that
        // matches the founder's intent ("a DS lives with its tokens").
        // But the DS list scanner only walks the canonical design-systems/
        // root, so also persist a copy there so the DS surfaces in the
        // grid. Source-of-truth is still the user's folder.
        const canonical = await resolveDsFolder(slug);
        if (!canonical) return;
        await generateAndPersist(buildFolderPrompt(files, name.trim()), canonical, "folder", raw);
        return;
      }
      if (source === "github") {
        const raw = value.trim();
        if (!raw) { setError("Cole a URL do repositório."); return; }
        appendLog(`clonando ${raw}…`);
        const cloned = await gitShallowClone(raw);
        if ("error" in cloned) { setError(cloned.error); return; }
        appendLog(`clonado em ${cloned.path}`);
        const files = await collectRelevantFiles(cloned.path);
        if (files.length === 0) { setError("Repo clonado mas nenhum arquivo de design encontrado."); return; }
        appendLog(`achei ${files.length} arquivo(s)`);
        // github: clone is ephemeral (/tmp/...). The persisted design.md
        // MUST live under design-systems/ so it survives the clone GC.
        const targetFolder = await resolveDsFolder(slug);
        if (!targetFolder) return;
        await generateAndPersist(buildGithubPrompt(cloned.slug, "", files), targetFolder, "github", raw);
        return;
      }
      // source === "url"
      const raw = value.trim();
      if (!raw) { setError("Cole a URL do site."); return; }
      appendLog(`buscando ${raw}…`);
      const res = await fetchUrlViaBridge(raw);
      if ("error" in res) { setError(res.error); return; }
      appendLog(`OK (${res.size} bytes) · enviando pra IA`);
      const targetFolder = await resolveDsFolder(slug);
      if (!targetFolder) return;
      await generateAndPersist(buildUploadPrompt(raw, res.html), targetFolder, "upload", raw);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      {/* Source — tactile lit keys */}
      <div className="dsl-zone">
        <span className="dsl-engrave">fonte</span>
        <div className="dsl-keys">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="dsl-key"
              data-active={source === s.id}
              onClick={() => { setSource(s.id); setUploadedFile(null); setError(null); }}
              disabled={saving}
            >
              <div className="dsl-key-head">
                <span className="dsl-key-glyph" aria-hidden="true"><s.Icon size={20} strokeWidth={2} /></span>
                <span className="dsl-key-led" aria-hidden="true" />
              </div>
              <span className="dsl-key-name">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input bowl — morphs per source */}
      <div className="dsl-zone">
        <span className="dsl-engrave">{source === "upload" ? "arquivo" : "entrada"}</span>
        <div className="dsl-bowl">
          {source === "upload" ? (
            <div className="dsl-bowl-hint">
              {active.hint}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.css"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; setUploadedFile(f); }}
                />
                <button className="dsl-engine-chip" type="button" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                  <Upload size={14} strokeWidth={2} aria-hidden="true" /> Escolher design.md…
                </button>
                {uploadedFile && (
                  <span style={{ fontFamily: "var(--df-font-mono)", fontSize: "var(--df-text-xs)", color: "var(--df-text-muted)" }}>
                    {uploadedFile.name}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="dsl-bowl-hint" style={{ marginBottom: 9 }}>{active.hint}</div>
              <input
                className="dsl-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={active.placeholder}
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
              />
            </>
          )}
        </div>
      </div>

      {/* Engine — engraved provider + model */}
      <div className="dsl-zone">
        <span className="dsl-engrave">{source === "upload" ? "motor do preview" : "motor de extração"}</span>
        <div className="dsl-engine">
          <button className="dsl-engine-chip" type="button" disabled>
            <span className="dsl-engine-k">provider</span> Claude Code
          </button>
          <button className="dsl-engine-chip" type="button" disabled>
            <span className="dsl-engine-k">modelo</span> sonnet
          </button>
        </div>
      </div>

      {/* Preview — physical skeu switch */}
      <div className="dsl-zone">
        <div className="dsl-switch-row">
          <div className="dsl-switch-copy">
            <span className="dsl-switch-title">Gerar preview visual</span>
            <span className="dsl-switch-sub">Renderiza um preview.html do design system assim que ele for forjado.</span>
          </div>
          <button
            type="button"
            className="dsl-switch"
            data-on={genPreview}
            aria-pressed={genPreview}
            aria-label="Gerar preview visual"
            onClick={() => setGenPreview((v) => !v)}
            disabled={saving}
          >
            <span className="dsl-switch-track" aria-hidden="true">
              <span className="dsl-switch-knob" />
            </span>
            <span className="dsl-switch-state" aria-hidden="true">{genPreview ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* Status log (during forge) */}
      {log.length > 0 && (
        <div className="dsl-zone">
          <span className="dsl-engrave">progresso</span>
          <div className="dsl-bowl" style={{ fontFamily: "var(--df-font-mono)", fontSize: "var(--df-text-xs)", color: "var(--df-text-muted)", lineHeight: 1.6, maxHeight: 80, overflowY: "auto" }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {error && (
        <div className="dsl-zone" style={{ color: "var(--df-accent-danger)", fontSize: "var(--df-text-xs)" }} role="alert">
          {error}
        </div>
      )}

      {/* Footer — name + premium begin */}
      <div className="dsl-foot">
        <div className="dsl-name-field">
          <span className="dsl-engrave">nome</span>
          <input
            className="dsl-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="meu-design-system"
            spellCheck={false}
            autoComplete="off"
            disabled={saving}
            style={{ fontFamily: "var(--df-font-mono)" }}
          />
        </div>
        <button
          type="button"
          className={`cnp-begin cnp-begin--v8${saving ? " is-loading" : ""}`}
          onClick={() => { void forge(); }}
          disabled={saving || !name.trim()}
          aria-busy={saving}
        >
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">
            {status === "generating" ? "Forjando…" : status === "saving" ? "Salvando…" : "Forjar design.md"}
          </span>
          <span className="cnp-begin-arrow" aria-hidden="true"><ArrowRight size={16} strokeWidth={2} /></span>
        </button>
      </div>
    </div>
  );
}
