// DsDirectionA — "Faceplate Console" direction for the DS modal redesign.
// Source as tactile lit keys → one morphing input bowl → engraved engine
// picker → physical preview switch → name + premium begin button.
//
// Real wiring (PR 4 of "religue tudo"): all four sources persist for real
// via the same helpers the shipped DsSetupModal uses (invokeDsGeneration,
// gitShallowClone, fetchUrlViaBridge, listFolder, writeFile, /ds/generate-
// preview). Simpler than the old modal — no GitHub OAuth device flow and
// no folder file-pick UI; we accepted that trade-off.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FileText,
  Folder,
  GitBranch,
  Link,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  BRIDGE_URL,
  designSystemsDir,
  fetchUrlViaBridge,
  generateDsDesignMd,
  gitShallowClone,
  listFolder,
  readFileViaBridge,
  writeFile,
} from "@/lib/claude-bridge";
import { buildFolderPrompt, buildGithubPrompt, buildUploadPrompt } from "@/runtime/ds-invoker";
import type { DsEntry } from "@/types/ds";
import type { ProviderId } from "@/providers/types";
import {
  defaultModelForProvider,
  readLastModel,
  writeLastModel,
  useLiveModelOptions,
} from "@/providers/model-lists";

type Source = "folder" | "github" | "upload" | "url";

const SOURCES: Array<{
  id: Source;
  Icon: LucideIcon;
  name: string;
  hint: string;
  placeholder?: string;
}> = [
  {
    id: "folder",
    Icon: Folder,
    name: "Pasta",
    hint: "Aponte uma pasta com tokens, globals.css, tailwind.config — a IA extrai o design.md.",
    placeholder: "~/meu-projeto/src/styles",
  },
  {
    id: "github",
    Icon: GitBranch,
    name: "GitHub",
    hint: "Cole a URL de um repositório público. A IA lê os arquivos de estilo e destila o design.md.",
    placeholder: "https://github.com/org/repo",
  },
  {
    id: "upload",
    Icon: FileText,
    name: "design.md",
    hint: "Já tem um design.md canônico? Ele entra como está, sem reprocessar.",
    placeholder: undefined,
  },
  {
    id: "url",
    Icon: Link,
    name: "URL",
    hint: "Cole a URL de um site. A IA captura o fingerprint visual (cores, tipografia, espaçamento).",
    placeholder: "https://site.com",
  },
];

// Providers the DS forge can ask to generate the design.md (folder/url/
// github sources) and the preview HTML. CLI providers spawn locally;
// BYOK APIs need a token in the daemon's config; Ollama needs a model
// pulled. The picker greys out unavailable providers but keeps them
// selectable so the user can switch to install them and retry.
const PROVIDER_OPTIONS: Array<{ id: ProviderId; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "Opencode CLI" },
  { id: "kimi", label: "Kimi Code CLI" },
  { id: "ollama", label: "Ollama (local)" },
  { id: "openrouter", label: "OpenRouter (BYOK)" },
  { id: "anthropic", label: "Anthropic API (BYOK)" },
  { id: "openai", label: "OpenAI API (BYOK)" },
  { id: "gemini-api", label: "Gemini API (BYOK)" },
];

const RELEVANT_FILE_NAMES = [
  "design.md",
  "DESIGN.md",
  "design-system.md",
  "tokens.css",
  "theme.css",
  "globals.css",
  "tokens.json",
  "theme.ts",
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];
const RELEVANT_EXTS = [".css", ".scss"];

function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

// Directory blocklist. Recursing into these dumps unrelated design
// surfaces into the prompt and confuses the model — most common
// repro: pointed at the DF repo itself, walker
// pulled in 10+ OTHER DSes' design.md files from `design-systems/`
// (apple, claude, nike, framer…) alongside DF's actual src/styles.
// Model saw 11 candidate aesthetics and synthesised a generic mush.
// Each name here is either a known meta surface (build outputs, deps,
// fixtures) or a place where unrelated DS files commonly live.
const SKIP_DIRS_RX =
  /^(node_modules|\.git|\.github|dist|build|\.next|design-systems|apps|docs|tests|test|__tests__|scripts|projects|skills|landing|examples|public|coverage|\.turbo|\.cache|\.vite|\.husky)$/i;

/** Walk a folder (depth ≤ 2) and collect up to 12 design-system files.
 *  Caps each file at 40KB (same as buildFolderPrompt's slicing). */
async function collectRelevantFiles(
  root: string,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  const walk = async (p: string, depth: number) => {
    if (depth > 2 || out.length >= 12) return;
    const r = await listFolder(p);
    if (!r || "error" in r) return;
    for (const e of r.entries) {
      if (out.length >= 12) break;
      if (e.isDir) {
        if (SKIP_DIRS_RX.test(e.name)) continue;
        await walk(e.path, depth + 1);
        continue;
      }
      const lower = e.name.toLowerCase();
      const hit =
        RELEVANT_FILE_NAMES.includes(e.name) || RELEVANT_EXTS.some((ext) => lower.endsWith(ext));
      if (!hit || e.size > 200_000) continue;
      const f = await readFileViaBridge(e.path);
      if (!f?.isText) continue;
      out.push({ path: e.path, content: f.content.slice(0, 40_000) });
    }
  };
  await walk(root, 0);
  return out;
}

export function DsDirectionA({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (entry: DsEntry, opts?: { openPreview?: boolean }) => void;
}) {
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

  // Provider + model picker — replaces the disabled "Claude Code/sonnet"
  // chips. Remembers the last picked provider via localStorage so the
  // user doesn't re-select on every modal open. Switching provider
  // resets the model to that provider's last-picked (or its default).
  const [provider, setProvider] = useState<ProviderId>(
    () => (readLastModel("__df:ds-provider" as ProviderId) as ProviderId) || "claude",
  );
  const [model, setModel] = useState<string>(
    () => readLastModel(provider) ?? defaultModelForProvider(provider),
  );
  // Ollama / OpenRouter get LIVE model lists from the local server /
  // public catalog. Other providers fall back to the static catalog.
  const modelChoices = useLiveModelOptions(provider);
  // When the user switches provider, restore the last-used model for
  // that provider (or its default). Avoids leaking e.g. "sonnet" into
  // a kimi run, which the daemon would reject as a foreign alias.
  useEffect(() => {
    setModel(readLastModel(provider) ?? defaultModelForProvider(provider));
  }, [provider]);

  const appendLog = (line: string) => setLog((prev) => [...prev, line]);

  const fireOptionalPreview = (entry: DsEntry) => {
    if (!genPreview) return;
    void fetch(`${BRIDGE_URL}/ds/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dsPath: entry.path,
        designMdPath: entry.designMdPath,
        provider,
        model,
      }),
    }).catch(() => {
      /* DsPreviewScreen surfaces failures */
    });
  };

  /** UPLOAD fast path: design.md content is already in hand (user
   *  uploaded a canonical .md). Synchronous write → instant navigate.
   *  No LLM step, no background, no marker files needed. */
  const persistInstant = async (
    markdown: string,
    folder: string,
    src: DsEntry["source"],
    sourceRef?: string,
  ) => {
    setStatus("saving");
    const trimmed = (markdown ?? "").trim();
    if (trimmed.length < 40) {
      setStatus("idle");
      setError(
        trimmed.length === 0
          ? "O arquivo está vazio."
          : `Apenas ${trimmed.length} chars — parece truncado.`,
      );
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
    onSaved(entry, { openPreview: true });
    onClose();
  };

  /** EXTRACTION path (folder/github/url): fire-and-forget. Daemon
   *  creates the DS folder + placeholder design.md so the DS appears
   *  in the grid immediately, then runs the LLM in background. Modal
   *  closes instantly; user lands on /ds/:slug with "Extraindo…"
   *  status. The Forjar click must return INSTANTLY so the user can
   *  do other things while generation runs in the background.
   *
   *  When the genPreview toggle is ON, the daemon chains into preview
   *  generation as soon as design.md lands. Both stages have their own
   *  marker files that the detail screen polls independently. */
  const persistAsync = async (
    prompt: string,
    folder: string,
    src: DsEntry["source"],
    sourceRef?: string,
  ) => {
    setStatus("generating");
    writeLastModel(provider, model);
    writeLastModel("__df:ds-provider" as ProviderId, provider);
    const designMdPath = folder.replace(/\/$/, "") + "/design.md";
    const dsName = name.trim() || folder.split(/[/\\]/).filter(Boolean).pop() || "design system";
    const result = await generateDsDesignMd({
      dsPath: folder,
      designMdPath,
      prompt,
      provider,
      model,
      generatePreviewAfter: genPreview,
      name: dsName,
    });
    setStatus("idle");
    if ("error" in result) {
      setError(`Falha ao iniciar extração: ${result.error}`);
      return;
    }
    // Daemon writes a placeholder design.md so the DS appears in the
    // grid + the detail screen has a real file to load. The entry we
    // send to onSaved is the placeholder; the polling in DsPreviewScreen
    // will refresh once the real design.md and preview.html land.
    const entry: DsEntry = {
      name: dsName,
      path: folder,
      designMdPath,
      source: src,
      sourceRef,
      addedAt: Date.now(),
    };
    onSaved(entry, { openPreview: true });
    onClose();
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
      setError(
        "Bridge offline — não consegui resolver o caminho de design-systems/. Confirma que o dev bridge está rodando.",
      );
      return null;
    }
    return abs;
  };

  const forge = async () => {
    if (saving) return;
    setError(null);
    setLog([]);
    if (!name.trim()) {
      setError("Dê um nome ao design system.");
      return;
    }
    const slug = slugify(name);
    try {
      if (source === "upload") {
        if (!uploadedFile) {
          setError("Escolha um arquivo design.md.");
          return;
        }
        const content = await uploadedFile.text();
        const targetFolder = await resolveDsFolder(slug);
        if (!targetFolder) return;
        // The "design.md" source is upload-only: the user already has the
        // file they want, so we save it VERBATIM — never run the LLM
        // normalization pass. That pass reorders + summarizes the markdown
        // = silent data loss (the "enxugou meu design.md" bug). Extraction
        // from CSS / sites / repos lives in the folder/url/github sources,
        // not here. (design.md is upload-only — never processed.)
        appendLog("upload · salvando como está, sem reprocessar");
        await persistInstant(content, targetFolder, "upload", uploadedFile.name);
        return;
      }
      if (source === "folder") {
        const raw = value.trim();
        if (!raw) {
          setError("Cole o caminho da pasta.");
          return;
        }
        appendLog(`escaneando ${raw}…`);
        const files = await collectRelevantFiles(raw);
        if (files.length === 0) {
          setError(
            "Nenhum arquivo de design encontrado (procurei tokens.css, globals.css, design.md, tailwind.config, .css).",
          );
          return;
        }
        appendLog(`achei ${files.length} arquivo(s) · enviando pra IA em background`);
        const canonical = await resolveDsFolder(slug);
        if (!canonical) return;
        await persistAsync(buildFolderPrompt(files, name.trim()), canonical, "folder", raw);
        return;
      }
      if (source === "github") {
        const raw = value.trim();
        if (!raw) {
          setError("Cole a URL do repositório.");
          return;
        }
        appendLog(`clonando ${raw}…`);
        const cloned = await gitShallowClone(raw);
        if ("error" in cloned) {
          setError(cloned.error);
          return;
        }
        appendLog(`clonado em ${cloned.path}`);
        const files = await collectRelevantFiles(cloned.path);
        if (files.length === 0) {
          setError("Repo clonado mas nenhum arquivo de design encontrado.");
          return;
        }
        appendLog(`achei ${files.length} arquivo(s) · enviando pra IA em background`);
        // github: clone is ephemeral (/tmp/...). The persisted design.md
        // MUST live under design-systems/ so it survives the clone GC.
        const targetFolder = await resolveDsFolder(slug);
        if (!targetFolder) return;
        await persistAsync(buildGithubPrompt(cloned.slug, "", files), targetFolder, "github", raw);
        return;
      }
      // source === "url"
      const raw = value.trim();
      if (!raw) {
        setError("Cole a URL do site.");
        return;
      }
      appendLog(`buscando ${raw}…`);
      const res = await fetchUrlViaBridge(raw);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      appendLog(`OK (${res.size} bytes) · enviando pra IA em background`);
      const targetFolder = await resolveDsFolder(slug);
      if (!targetFolder) return;
      await persistAsync(buildUploadPrompt(raw, res.html), targetFolder, "upload", raw);
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
              onClick={() => {
                setSource(s.id);
                setUploadedFile(null);
                setError(null);
              }}
              disabled={saving}
            >
              <div className="dsl-key-head">
                <span className="dsl-key-glyph" aria-hidden="true">
                  <s.Icon size={20} strokeWidth={2} />
                </span>
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
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    setUploadedFile(f);
                  }}
                />
                <button
                  className="dsl-engine-chip"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  <Upload size={14} strokeWidth={2} aria-hidden="true" /> Escolher design.md…
                </button>
                {uploadedFile && (
                  <span
                    style={{
                      fontFamily: "var(--df-font-mono)",
                      fontSize: "var(--df-text-xs)",
                      color: "var(--df-text-muted)",
                    }}
                  >
                    {uploadedFile.name}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="dsl-bowl-hint" style={{ marginBottom: 9 }}>
                {active.hint}
              </div>
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

      {/* Engine — provider + model picker. The wrapping label says
          "motor do preview" for the upload source (the only stage the
          engine touches is preview generation, since the design.md is
          already canonical), and "motor de extração" for the other
          sources (the engine first DISTILLS design.md from the inputs,
          then generates the preview if the toggle is on). Both stages
          use the same provider/model — keeping it one pick avoids
          UI complexity for the rare case where they'd legitimately
          differ. */}
      <div className="dsl-zone">
        <span className="dsl-engrave">
          {source === "upload" ? "motor do preview" : "motor de extração"}
        </span>
        <div className="dsl-engine">
          <label className="dsl-engine-chip" style={{ cursor: saving ? "default" : "pointer" }}>
            <span className="dsl-engine-k">provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              disabled={saving}
              style={{
                background: "transparent",
                color: "inherit",
                border: "none",
                fontFamily: "inherit",
                fontSize: "inherit",
                outline: "none",
                cursor: saving ? "default" : "pointer",
                appearance: "auto",
              }}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dsl-engine-chip" style={{ cursor: saving ? "default" : "pointer" }}>
            <span className="dsl-engine-k">modelo</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={saving || modelChoices.loading}
              style={{
                background: "transparent",
                color: "inherit",
                border: "none",
                fontFamily: "inherit",
                fontSize: "inherit",
                outline: "none",
                cursor: saving ? "default" : "pointer",
                appearance: "auto",
              }}
            >
              {modelChoices.options.length === 0 && (
                <option value="">— sem modelos disponíveis —</option>
              )}
              {modelChoices.options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.sub ? `  ·  ${m.sub}` : ""}
                </option>
              ))}
            </select>
          </label>
          {modelChoices.loading && (
            <span
              style={{
                fontFamily: "var(--df-font-mono)",
                fontSize: "10px",
                color: "var(--df-text-muted)",
                alignSelf: "center",
              }}
            >
              listando…
            </span>
          )}
          {!modelChoices.loading && modelChoices.source === "static" && provider !== "claude" && (
            <span
              title="Lista de fallback — configure a API key do provider em Configurações para ver os modelos ao vivo"
              style={{
                fontFamily: "var(--df-font-mono)",
                fontSize: "10px",
                color: "var(--df-text-faint)",
                alignSelf: "center",
              }}
            >
              fallback · configure key
            </span>
          )}
        </div>
      </div>

      {/* Preview — physical skeu switch */}
      <div className="dsl-zone">
        <div className="dsl-switch-row">
          <div className="dsl-switch-copy">
            <span className="dsl-switch-title">Gerar preview visual</span>
            <span className="dsl-switch-sub">
              Renderiza um preview.html do design system assim que ele for forjado.
            </span>
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
            <span className="dsl-switch-state" aria-hidden="true">
              {genPreview ? "ON" : "OFF"}
            </span>
          </button>
        </div>
      </div>

      {/* Status log (during forge) */}
      {log.length > 0 && (
        <div className="dsl-zone">
          <span className="dsl-engrave">progresso</span>
          <div
            className="dsl-bowl"
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              color: "var(--df-text-muted)",
              lineHeight: 1.6,
              maxHeight: 80,
              overflowY: "auto",
            }}
          >
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          className="dsl-zone"
          style={{ color: "var(--df-accent-danger)", fontSize: "var(--df-text-xs)" }}
          role="alert"
        >
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
          onClick={() => {
            void forge();
          }}
          disabled={saving || !name.trim()}
          aria-busy={saving}
        >
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">
            {status === "generating"
              ? "Forjando…"
              : status === "saving"
                ? "Salvando…"
                : "Forjar design.md"}
          </span>
          <span className="cnp-begin-arrow" aria-hidden="true">
            <ArrowRight size={16} strokeWidth={2} />
          </span>
        </button>
      </div>
    </div>
  );
}
