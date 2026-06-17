// PromptConsole — direction preview/inspector for the New Project
// modal and inside-project consultation surface (decision doc §5).
//
// Surface invariants:
//   · Every customization the user made surfaces here as its own
//     section (DS, canvas, format, rules, taste, provider, attachments,
//     user prompt, compiled direction).
//   · Skeu chrome — tactile section cards, recessed `<pre>` blocks,
//     mono uppercase eyebrows in the DF letterspacing.
//   · i18n via useT — strings live in src/i18n/strings.ts under the
//     `promptconsole.*` namespace.
//
// Not a terminal. No PTY, no shell exec. Read-only when `onConfirm` is
// omitted (inside-project surface); editable handoff back to the form
// when `onConfirm` is provided (New Project surface).
//
// User direction 2026-05-15: "modal de prompt previem nao mostra
// design system selecionado, nem prompt do user. garanta q mostra td
// q eh personalizavel ... atualize no detalhe".

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import { DfModal } from "@/components/DfModal";
import {
  buildCanonicalPlusBlock,
  type CanonicalPlusInput,
  type DialDirection,
  type DialKey,
} from "@/runtime/canonical-plus-prompt";
import type { TurnPreviewBlock } from "@/runtime/turn-pipeline";
import { useT, tf } from "@/i18n";
import type { CanvasSelection } from "@/data/canvas-presets";
import type { FormatSelection } from "@/data/format-taxonomy";
import type { ProviderId } from "@/providers/types";

const DIAL_LABELS: Record<DialKey, string> = {
  density: "Density",
  motion: "Motion",
  contrast: "Contrast",
  interactions: "Interactions",
  surface: "Surface",
  originality: "Originality",
};

export interface PromptConsoleAttachment {
  name: string;
  size?: number;
  kind?: string;
}

export interface PromptConsoleProps {
  open: boolean;
  onClose: () => void;
  /** Project / draft name shown in the header. */
  projectName?: string;
  /** Raw user prompt typed in the chat composer. */
  userPrompt?: string;
  /** Slug of the selected design system (resolves under design-systems/). */
  designSystem?: string | null;
  /** Canvas selection — preset id or custom WxH. */
  canvas?: CanvasSelection | null;
  /** Format pick — used for the section AND for the compiled block. */
  format?: FormatSelection | null;
  /** Format pretty descriptor (resolved by caller). */
  formatLabel?: string;
  /** Rule ids picked. */
  rules?: string[];
  /** Pretty labels for the chosen rules (resolved by caller). */
  ruleLabels?: string[];
  /** 6 dial values (0..100). */
  taste?: Partial<Record<DialKey, number>>;
  /** Per-dial low/high text overrides (from Settings → Taste). */
  dialOverrides?: Partial<Record<DialKey, Partial<DialDirection>>>;
  /** Provider + model bound to this turn. */
  provider?: ProviderId;
  model?: string;
  /** Chat attachments (name, size, kind). */
  attachments?: PromptConsoleAttachment[];
  /** Full workspace preamble + DS markdown that ships as the system
   *  prompt's preamble to the provider. When undefined the section is
   *  hidden (legacy projects without a synthesized preamble). */
  systemPreamble?: string;
  /** The actual blocks the V2 engine assembles for the turn (preamble,
   *  project direction, current file, contract, user message). When provided
   *  the console shows these verbatim — the real prompt — instead of the
   *  legacy split preamble/compiled sections. Built via assembleTurnBlocks so
   *  it matches what gets sent. */
  engineBlocks?: TurnPreviewBlock[];
  /** Optional confirm CTA — surfaces a "Iniciar projeto" button in the
   *  footer. Omitted = read-only console (inside-project surface). */
  onConfirm?: () => void;
  /** Optional confirm CTA label. */
  confirmLabel?: string;
}

export function PromptConsole({
  open,
  onClose,
  projectName,
  userPrompt,
  designSystem,
  canvas,
  format,
  formatLabel,
  rules,
  ruleLabels,
  taste,
  dialOverrides,
  provider,
  model,
  attachments,
  systemPreamble,
  engineBlocks,
  onConfirm,
  confirmLabel,
}: PromptConsoleProps) {
  const { t } = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      })
      .catch(() => {});
  };
  const engineTokens = useMemo(
    () =>
      engineBlocks ? Math.round(engineBlocks.reduce((n, b) => n + b.content.length, 0) / 4) : 0,
    [engineBlocks],
  );

  // Compose the canonical+ block (Format + Rules + Taste calibration)
  // using the same builder the runtime ships to the provider.
  const canonicalBlock = useMemo<string>(() => {
    const input: CanonicalPlusInput = { format: format ?? null, rules: rules ?? [], taste };
    return buildCanonicalPlusBlock(input, dialOverrides);
  }, [format, rules, taste, dialOverrides]);

  const tasteActive = useMemo(() => {
    if (!taste) return [] as Array<{ key: DialKey; value: number }>;
    const out: Array<{ key: DialKey; value: number }> = [];
    for (const k of Object.keys(taste) as DialKey[]) {
      const v = taste[k];
      if (typeof v === "number" && (v <= 30 || v >= 70)) {
        out.push({ key: k, value: v });
      }
    }
    return out;
  }, [taste]);

  const title = projectName
    ? tf("promptconsole.title.with.project", projectName)
    : t("promptconsole.title");

  const note = onConfirm ? t("promptconsole.note") : t("promptconsole.note.readonly");

  // ── Derived display strings ────────────────────────────────────
  const canvasText = useMemo(() => {
    if (!canvas) return null;
    if (canvas.kind === "preset" && canvas.presetId) {
      return canvas.presetId;
    }
    if (canvas.width && canvas.height) {
      return `${canvas.width} × ${canvas.height}`;
    }
    return null;
  }, [canvas]);

  const providerText = useMemo(() => {
    if (!provider) return null;
    return model && model !== "default" ? `${provider} · ${model}` : provider;
  }, [provider, model]);

  const rulesCountLabel = useMemo(() => {
    const n = rules?.length ?? 0;
    return n > 0 ? tf("promptconsole.section.rules.count", n) : t("promptconsole.section.rules");
  }, [rules, t]);

  const tasteCountLabel = useMemo(() => {
    const n = tasteActive.length;
    if (n === 0) return t("promptconsole.section.taste");
    return n === 1
      ? tf("promptconsole.section.taste.count", n)
      : tf("promptconsole.section.taste.count.plural", n);
  }, [tasteActive.length, t]);

  const attachmentsCountLabel = useMemo(() => {
    const n = attachments?.length ?? 0;
    return n > 0
      ? tf("promptconsole.section.attachments.count", n)
      : t("promptconsole.section.attachments");
  }, [attachments, t]);

  // Footer rendered via DfModal's `foot` prop so it stays pinned to
  // the modal frame while only the body scrolls. The previous inline
  // footer scrolled with the content because DfModal's body owns the
  // overflow; native `foot` slot sits in the modal flex column outside
  // the scrollable region.
  // Footer rendered via DfModal's `foot` prop so it stays pinned to
  // the modal frame while only the body scrolls. Back button matches
  // the v8 tactile button height/font so the pair reads as same-family
  // chrome — Voltar isn't a tiny pill next to a tall premium key.
  const footer = (
    <>
      <button type="button" className="cnp-foot-reset" style={footBackBtnStyle} onClick={onClose}>
        {onConfirm ? t("promptconsole.back") : t("promptconsole.close")}
      </button>
      {onConfirm ? (
        <button
          type="button"
          className="cnp-begin cnp-begin--v8"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          <span className="cnp-begin-led" aria-hidden="true" />
          <span className="cnp-begin-label">{confirmLabel ?? t("promptconsole.confirm")}</span>
          <span className="cnp-begin-arrow" aria-hidden="true">
            →
          </span>
        </button>
      ) : null}
    </>
  );

  return (
    <DfModal open={open} onClose={onClose} size="lg" title={title} foot={footer}>
      <div className="pc-body" style={bodyStyle}>
        <p className="pc-note" style={noteStyle}>
          {note}
        </p>

        {/* User prompt */}
        <Section eyebrow={t("promptconsole.section.prompt")}>
          {userPrompt && userPrompt.trim().length > 0 ? (
            <BodyText>{userPrompt.trim()}</BodyText>
          ) : (
            <EmptyText>{t("promptconsole.empty.prompt")}</EmptyText>
          )}
        </Section>

        {/* Design system */}
        <Section eyebrow={t("promptconsole.section.designsystem")}>
          {designSystem ? (
            <Chip>{designSystem}</Chip>
          ) : (
            <EmptyText>{t("promptconsole.empty.designsystem")}</EmptyText>
          )}
        </Section>

        {/* Canvas */}
        <Section eyebrow={t("promptconsole.section.canvas")}>
          {canvasText ? (
            <Chip>{canvasText}</Chip>
          ) : (
            <EmptyText>{t("promptconsole.empty.canvas")}</EmptyText>
          )}
        </Section>

        {/* Format */}
        <Section eyebrow={t("promptconsole.section.format")}>
          {format && formatLabel ? (
            <Chip>{formatLabel}</Chip>
          ) : format ? (
            <Chip>{`${format.categoryId} / ${format.itemId}`}</Chip>
          ) : (
            <EmptyText>{t("promptconsole.empty.format")}</EmptyText>
          )}
        </Section>

        {/* Rules */}
        <Section eyebrow={rulesCountLabel}>
          {rules && rules.length > 0 ? (
            <div style={chipRowStyle}>
              {(ruleLabels && ruleLabels.length === rules.length ? ruleLabels : rules).map(
                (label, i) => (
                  <Chip key={`${rules[i]}-${i}`}>{label}</Chip>
                ),
              )}
            </div>
          ) : (
            <EmptyText>{t("promptconsole.empty.rules")}</EmptyText>
          )}
        </Section>

        {/* Taste calibration */}
        <Section eyebrow={tasteCountLabel}>
          {tasteActive.length > 0 ? (
            <div style={chipRowStyle}>
              {tasteActive.map(({ key, value }) => (
                <Chip key={key}>
                  {DIAL_LABELS[key]}: {value}
                </Chip>
              ))}
            </div>
          ) : (
            <EmptyText>{t("promptconsole.empty.taste")}</EmptyText>
          )}
        </Section>

        {/* Provider + model */}
        <Section eyebrow={t("promptconsole.section.provider")}>
          {providerText ? <Chip>{providerText}</Chip> : <EmptyText>—</EmptyText>}
        </Section>

        {/* Attachments */}
        <Section eyebrow={attachmentsCountLabel}>
          {attachments && attachments.length > 0 ? (
            <div style={chipRowStyle}>
              {attachments.map((a, i) => (
                <Chip key={`${a.name}-${i}`}>{a.name}</Chip>
              ))}
            </div>
          ) : (
            <EmptyText>{t("promptconsole.empty.attachments")}</EmptyText>
          )}
        </Section>

        {/* Assembled prompt — the exact blocks the V2 engine ships, in
         * order. Replaces the old split preamble/compiled sections so the
         * inspector matches what's actually sent. */}
        {engineBlocks && engineBlocks.length > 0 ? (
          <section className="pc-section" style={sectionStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div className="pc-eyebrow" style={eyebrowStyle}>
                {t("promptconsole.section.assembled")}
              </div>
              <button
                type="button"
                style={copyBtnStyle}
                onClick={() =>
                  copy(
                    engineBlocks.map((b) => `## ${b.label}\n\n${b.content}`).join("\n\n---\n\n"),
                    "_all",
                  )
                }
              >
                {copied === "_all" ? t("promptconsole.copied") : t("promptconsole.copyall")} · ~
                {engineTokens.toLocaleString()} tok
              </button>
            </div>
            {engineBlocks.map((b) => (
              <div key={b.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ ...eyebrowStyle, color: "var(--df-text-muted)" }}>{b.label}</span>
                  <button type="button" style={copyBtnStyle} onClick={() => copy(b.content, b.id)}>
                    {copied === b.id ? t("promptconsole.copied") : t("promptconsole.copy")}
                  </button>
                </div>
                <pre className="pc-compiled" style={preStyle}>
                  {b.content || "—"}
                </pre>
              </div>
            ))}
          </section>
        ) : (
          <>
            {systemPreamble ? (
              <Section eyebrow={t("promptconsole.section.systemprompt")}>
                <pre className="pc-compiled" style={preStyle}>
                  {systemPreamble}
                </pre>
              </Section>
            ) : null}
            <Section eyebrow={t("promptconsole.section.compiled")}>
              <pre className="pc-compiled" style={preStyle}>
                {canonicalBlock || t("promptconsole.empty.compiled")}
              </pre>
            </Section>
          </>
        )}
      </div>
    </DfModal>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function Section({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <section className="pc-section" style={sectionStyle}>
      <div className="pc-eyebrow" style={eyebrowStyle}>
        {eyebrow}
      </div>
      <div className="pc-content" style={contentStyle}>
        {children}
      </div>
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="pc-chip" style={chipStyle}>
      {children}
    </span>
  );
}

function BodyText({ children }: { children: ReactNode }) {
  return (
    <p className="pc-text" style={textStyle}>
      {children}
    </p>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return (
    <p className="pc-empty" style={emptyTextStyle}>
      {children}
    </p>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
// Skeu treatment: tactile section cards on the recessed modal body.
// Eyebrows use mono uppercase with the DF letter-spacing engraving
// pattern (matches NewProject "stack" trigger chrome).

// Body sits inside .df-modal-body which already owns the overflow
// scrolling; we just stack the sections in a flex column with
// breathing room.
const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--df-sp-3)",
  margin: 0,
};

const noteStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--df-text-sm)",
  color: "var(--df-text-muted)",
  lineHeight: 1.5,
  fontFamily: "var(--df-font-sans)",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "12px 14px 14px",
  background: "var(--df-bg-section)",
  borderRadius: "var(--df-r-md, 10px)",
  boxShadow: [
    "inset 0 1px 0 var(--df-skeu-top-light)",
    "inset 0 0 0 1px var(--df-border-subtle)",
    "0 1px 1px var(--df-skeu-near, rgba(0,0,0,0.04))",
  ].join(", "),
};

const eyebrowStyle: CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--df-text-faint)",
};

const contentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const copyBtnStyle: CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  color: "var(--df-text-muted)",
  background: "var(--df-bg-base)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: "var(--df-r-sm, 6px)",
  padding: "3px 8px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  letterSpacing: "0.02em",
  color: "var(--df-text-secondary)",
  background: "var(--df-bg-base)",
  borderRadius: 999,
  boxShadow: [
    "inset 0 1px 0 var(--df-skeu-top-light)",
    "inset 0 0 0 1px var(--df-border-subtle)",
  ].join(", "),
};

const textStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--df-text-sm)",
  color: "var(--df-text-primary)",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--df-text-sm)",
  color: "var(--df-text-faint)",
  fontStyle: "italic",
};

const preStyle: CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: "var(--df-text-xs)",
  lineHeight: 1.55,
  background: "var(--df-bg-base)",
  color: "var(--df-text-primary)",
  padding: 14,
  borderRadius: "var(--df-r-sm, 6px)",
  border: "0",
  boxShadow:
    "var(--df-skeu-recess, inset 0 2px 4px rgba(0,0,0,0.18), inset 0 0 0 1px var(--df-border-subtle))",
  maxHeight: "32vh",
  overflow: "auto",
  margin: 0,
  whiteSpace: "pre-wrap",
};

// Back button overrides — match the v8 tactile button's height/font
// so the pair reads as same-family chrome. User QA 2026-05-15:
// "botao voltar quero no mesmo padrao skeu, ta comprimido e
// arredondado".
const footBackBtnStyle: CSSProperties = {
  padding: "16px 22px",
  fontFamily: "var(--df-font-sans)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0,
  textTransform: "none",
  borderRadius: "var(--df-r-md)",
};
