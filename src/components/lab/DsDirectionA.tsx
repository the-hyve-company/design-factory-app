// DsDirectionA — "Faceplate Console" direction for the DS modal redesign.
// Source as tactile lit keys → one morphing input bowl → engraved engine
// picker → physical preview switch → name + premium begin button. Mirrors
// the New Project modal's hardware feel. Presentational: submit is stubbed
// (logs intent) so the founder can judge layout/options/style; generation
// gets re-wired when this direction is chosen.

import { useState } from "react";

type Source = "folder" | "github" | "upload" | "url";

const SOURCES: Array<{ id: Source; glyph: string; name: string; hint: string; placeholder?: string }> = [
  { id: "folder", glyph: "▣", name: "Pasta", hint: "Aponte uma pasta com tokens, globals.css, tailwind.config — a IA extrai o design.md.", placeholder: "~/meu-projeto/src/styles" },
  { id: "github", glyph: "◐", name: "GitHub", hint: "Cole a URL de um repositório público. A IA lê os arquivos de estilo e destila o design.md.", placeholder: "https://github.com/org/repo" },
  { id: "upload", glyph: "↥", name: "design.md", hint: "Já tem um design.md canônico? Ele entra como está, sem reprocessar.", placeholder: undefined },
  { id: "url", glyph: "◌", name: "URL", hint: "Cole a URL de um site. A IA captura o fingerprint visual (cores, tipografia, espaçamento).", placeholder: "https://site.com" },
];

export function DsDirectionA({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<Source>("folder");
  const [value, setValue] = useState("");
  const [genPreview, setGenPreview] = useState(true);
  const [name, setName] = useState("");
  const active = SOURCES.find((s) => s.id === source)!;

  const forge = () => {
    // Presentational stub — the real DsSetupModal logic is re-wired here
    // once this direction is approved.
    // eslint-disable-next-line no-console
    console.info("[ds-lab A] forge", { source, value, genPreview, name });
    onClose();
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
              onClick={() => setSource(s.id)}
            >
              <div className="dsl-key-head">
                <span className="dsl-key-glyph" aria-hidden="true">{s.glyph}</span>
                <span className="dsl-key-led" aria-hidden="true" />
              </div>
              <span className="dsl-key-name">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input bowl — morphs per source */}
      <div className="dsl-zone">
        <span className="dsl-engrave">
          {source === "upload" ? "arquivo" : "entrada"}
        </span>
        <div className="dsl-bowl">
          {source === "upload" ? (
            <div className="dsl-bowl-hint">
              {active.hint}
              <div style={{ marginTop: 10 }}>
                <button className="dsl-engine-chip" type="button">↥ Escolher design.md…</button>
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
              />
            </>
          )}
        </div>
      </div>

      {/* Engine — engraved provider + model (skip for upload, which is verbatim) */}
      {source !== "upload" && (
        <div className="dsl-zone">
          <span className="dsl-engrave">motor de extração</span>
          <div className="dsl-engine">
            <button className="dsl-engine-chip" type="button">
              <span className="dsl-engine-k">provider</span> Claude Code
            </button>
            <button className="dsl-engine-chip" type="button">
              <span className="dsl-engine-k">modelo</span> default
            </button>
          </div>
        </div>
      )}

      {/* Preview — physical switch */}
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
          >
            <span className="dsl-switch-knob" aria-hidden="true" />
          </button>
        </div>
      </div>

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
            style={{ fontFamily: "var(--df-font-mono)" }}
          />
        </div>
        <button type="button" className="cnp-begin cnp-begin--v8" onClick={forge}>
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">Forjar design.md</span>
          <span className="cnp-begin-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
