// SkillsDirectionA — unified Criar/Importar skill flow in the faceplate
// language. Mode toggle (two tactile keys) → the matching form. Reuses the
// dsl-* tactile vocabulary from the DS lab. Presentational: submit is stubbed
// (logs intent); real installSkill / import re-wires when this is chosen.

import { useState } from "react";

type Mode = "create" | "import";
type ImportSource = "upload" | "url" | "folder";

function slugify(name: string): string {
  return "/" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const IMPORT_SOURCES: Array<{ id: ImportSource; glyph: string; name: string; hint: string; placeholder?: string }> = [
  { id: "upload", glyph: "↥", name: "Upload", hint: "Suba um arquivo .md ou um bundle .zip de skill.", placeholder: undefined },
  { id: "url", glyph: "◌", name: "URL", hint: "Cole a URL de um SKILL.md ou bundle publicado.", placeholder: "https://…/SKILL.md" },
  { id: "folder", glyph: "▣", name: "Pasta", hint: "Escolha skills de uma pasta skills/ (ou .claude/skills/ legado).", placeholder: "~/projeto/skills" },
];

export function SkillsDirectionA({ initialMode, onClose }: { initialMode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  // create state
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [triggerEdited, setTriggerEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");

  // import state
  const [source, setSource] = useState<ImportSource>("upload");
  const [importValue, setImportValue] = useState("");
  const activeSource = IMPORT_SOURCES.find((s) => s.id === source)!;

  const onNameChange = (v: string) => {
    setName(v);
    if (!triggerEdited) setTrigger(v ? slugify(v) : "");
  };

  const submit = () => {
    // Presentational stub — real installSkill / import re-wires here.
    // eslint-disable-next-line no-console
    console.info("[skills-lab A] submit", mode === "create"
      ? { mode, name, trigger, description, bodyLen: body.length }
      : { mode, source, importValue });
    onClose();
  };

  return (
    <div>
      {/* Mode — two tactile keys */}
      <div className="dsl-zone">
        <span className="dsl-engrave">o que você quer</span>
        <div className="dsl-keys dsl-keys--2">
          <button type="button" className="dsl-key" data-active={mode === "create"} onClick={() => setMode("create")}>
            <div className="dsl-key-head">
              <span className="dsl-key-glyph" aria-hidden="true">✶</span>
              <span className="dsl-key-led" aria-hidden="true" />
            </div>
            <span className="dsl-key-name">Criar do zero</span>
          </button>
          <button type="button" className="dsl-key" data-active={mode === "import"} onClick={() => setMode("import")}>
            <div className="dsl-key-head">
              <span className="dsl-key-glyph" aria-hidden="true">↥</span>
              <span className="dsl-key-led" aria-hidden="true" />
            </div>
            <span className="dsl-key-name">Importar</span>
          </button>
        </div>
      </div>

      {mode === "create" ? (
        <>
          <div className="dsl-zone">
            <span className="dsl-engrave">nome</span>
            <input className="dsl-input" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Minha skill" spellCheck={false} autoComplete="off" style={{ fontFamily: "var(--df-font-sans)" }} />
          </div>
          <div className="dsl-zone">
            <span className="dsl-engrave">trigger</span>
            <input className="dsl-input" value={trigger} onChange={(e) => { setTrigger(e.target.value); setTriggerEdited(true); }} placeholder="/minha-skill" spellCheck={false} autoComplete="off" />
          </div>
          <div className="dsl-zone">
            <span className="dsl-engrave">descrição</span>
            <input className="dsl-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que essa skill faz e quando usar" spellCheck={false} autoComplete="off" style={{ fontFamily: "var(--df-font-sans)" }} />
          </div>
          <div className="dsl-zone">
            <span className="dsl-engrave">corpo (instruções)</span>
            <textarea className="dsl-textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="As instruções que o agente segue quando a skill é ativada…" spellCheck={false} />
          </div>
        </>
      ) : (
        <>
          <div className="dsl-zone">
            <span className="dsl-engrave">de onde</span>
            <div className="dsl-keys dsl-keys--3">
              {IMPORT_SOURCES.map((s) => (
                <button key={s.id} type="button" className="dsl-key" data-active={source === s.id} onClick={() => setSource(s.id)}>
                  <div className="dsl-key-head">
                    <span className="dsl-key-glyph" aria-hidden="true">{s.glyph}</span>
                    <span className="dsl-key-led" aria-hidden="true" />
                  </div>
                  <span className="dsl-key-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="dsl-zone">
            <span className="dsl-engrave">{source === "upload" ? "arquivo" : "entrada"}</span>
            <div className="dsl-bowl">
              {source === "upload" ? (
                <div className="dsl-bowl-hint">
                  {activeSource.hint}
                  <div style={{ marginTop: 10 }}>
                    <button className="dsl-engine-chip" type="button">↥ Escolher .md ou .zip…</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="dsl-bowl-hint" style={{ marginBottom: 9 }}>{activeSource.hint}</div>
                  <input className="dsl-input" value={importValue} onChange={(e) => setImportValue(e.target.value)} placeholder={activeSource.placeholder} spellCheck={false} autoComplete="off" />
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Footer — premium begin */}
      <div className="dsl-foot" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="cnp-begin cnp-begin--v8" onClick={submit}>
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">{mode === "create" ? "Criar skill" : "Importar skill"}</span>
          <span className="cnp-begin-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
