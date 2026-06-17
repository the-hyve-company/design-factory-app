// SkillCoverPreviewScreen.tsx — internal preview surface.
//
// User ask 2026-05-21: "quero ver na pratica em preview, nao em
// ascii". This screen renders 6 candidate cover styles for Skills,
// each repeated across 4 mocked skills, so the user can pick the
// direction by sight before we ship one to production.
//
// Accessed via `?preview=skill-covers` query string in dev (no router
// change; App.tsx checks the param and mounts this screen instead of
// the regular app shell).

import { Logo } from "@/components/Logo";
import { CharacterCover } from "@/components/CharacterCover";

// ─── Mock skills used as the seed across every option ──────────────────

interface MockSkill {
  id: string;
  name: string;
  trigger: string;
  description: string;
  /** Free-form icon hint for option B (the icon glyph). */
  iconHint: "audit" | "transform" | "research" | "polish";
}

const MOCK_SKILLS: ReadonlyArray<MockSkill> = [
  {
    id: "make-interfaces-feel-better",
    name: "Make Interfaces Feel Better",
    trigger: "/make-interfaces",
    description: "Polish + micro-details on any UI",
    iconHint: "polish",
  },
  {
    id: "audit-design-system",
    name: "Audit Design System",
    trigger: "/audit-ds",
    description: "Token counting + drift check",
    iconHint: "audit",
  },
  {
    id: "translate-into-portuguese",
    name: "Translate Into Portuguese",
    trigger: "/translate-pt",
    description: "Locale + tone-aware translation",
    iconHint: "transform",
  },
  {
    id: "research-competitors",
    name: "Research Competitors",
    trigger: "/research",
    description: "Surface + summarize competitors",
    iconHint: "research",
  },
];

// ─── Deterministic hash so option B/C/F can pull color/letter from name ─

function djb2(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function hslFromSeed(seed: string, sat = 38, light = 58): string {
  const h = djb2(seed);
  return `hsl(${((h >>> 8) & 0xff) * (360 / 256)} ${sat}% ${light}%)`;
}

// ─── Icon set used in option B ──────────────────────────────────────────

function SkillIcon({ hint, size = 36 }: { hint: MockSkill["iconHint"]; size?: number }) {
  const stroke = "currentColor";
  const sw = 1.5;
  switch (hint) {
    case "audit":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
          <path d="M11 8v6M8 11h6" />
        </svg>
      );
    case "transform":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 7h13l-3-3" />
          <path d="M21 17H8l3 3" />
        </svg>
      );
    case "research":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <path d="M8 7h8M8 11h6" />
        </svg>
      );
    case "polish":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m12 2 2.4 5.2 5.6.5-4.2 3.8 1.3 5.5L12 14.7l-5.1 2.3 1.3-5.5L4 7.7l5.6-.5L12 2Z" />
        </svg>
      );
  }
}

// ─── 6 cover options as small components ───────────────────────────────

function CoverA_Character({ skill }: { skill: MockSkill }) {
  return <CharacterCover seed={skill.id} />;
}

function CoverB_ColorIcon({ skill }: { skill: MockSkill }) {
  const bg = hslFromSeed(skill.id, 24, 42);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg,
        color: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SkillIcon hint={skill.iconHint} size={56} />
    </div>
  );
}

function CoverC_Monogram({ skill }: { skill: MockSkill }) {
  const letter = (skill.name.match(/[A-Za-zÀ-ú]/)?.[0] ?? "?").toUpperCase();
  const accent = hslFromSeed(skill.id, 55, 56);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--df-bg-section)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <span
        style={{
          fontFamily: "var(--df-font-display, var(--df-font-sans))",
          fontSize: 92,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          color: "var(--df-text-primary)",
          opacity: 0.92,
          lineHeight: 1,
        }}
      >
        {letter}
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 18,
          width: 36,
          height: 2,
          background: accent,
          borderRadius: 2,
        }}
      />
    </div>
  );
}

function CoverD_TriggerHero({ skill }: { skill: MockSkill }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--df-bg-section)",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "0 18px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--df-font-mono)",
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: "var(--df-text-primary)",
          lineHeight: 1.1,
          wordBreak: "break-word",
          opacity: 0.88,
        }}
      >
        {skill.trigger}
      </span>
    </div>
  );
}

function CoverE_SoftLogo() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--df-bg-section)",
        color: "var(--df-text-faint)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Logo size={56} style={{ opacity: 0.22 }} />
    </div>
  );
}

function CoverF_ColorBlock({ skill }: { skill: MockSkill }) {
  const bg = hslFromSeed(skill.id, 30, 50);
  const hex = `#${(djb2(skill.id) & 0xffffff).toString(16).padStart(6, "0")}`;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg,
        color: "rgba(255,255,255,0.85)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-start",
        padding: 14,
        fontFamily: "var(--df-font-mono)",
        fontSize: 11,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {hex}
    </div>
  );
}

// ─── Layout: a column per option, a row per skill ──────────────────────

const OPTIONS = [
  { id: "A", label: "Personagem dot-grid (atual)", Comp: CoverA_Character },
  { id: "B", label: "Color bg + ícone", Comp: CoverB_ColorIcon },
  { id: "C", label: "Monogram tipográfico", Comp: CoverC_Monogram },
  { id: "D", label: "Trigger hero", Comp: CoverD_TriggerHero },
  { id: "E", label: "Logo DF suave", Comp: CoverE_SoftLogo },
  { id: "F", label: "Color block + hex", Comp: CoverF_ColorBlock },
] as const;

export function SkillCoverPreviewScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "32px 40px",
        background: "var(--df-bg-base)",
        color: "var(--df-text-primary)",
        fontFamily: "var(--df-font-sans)",
      }}
    >
      <header style={{ marginBottom: 24, maxWidth: 1100 }}>
        <div
          style={{
            fontFamily: "var(--df-font-mono)",
            fontSize: 11,
            color: "var(--df-text-faint)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Preview · Skill covers
        </div>
        <h1
          style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: "6px 0 8px" }}
        >
          6 direções, 4 skills mockadas cada
        </h1>
        <p style={{ fontSize: 14, color: "var(--df-text-secondary)", lineHeight: 1.55, margin: 0 }}>
          Cada coluna é uma direção visual. Cada linha é a mesma skill renderizada em todas. Olha o
          conjunto e me diz qual letra (A-F).
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(180px, 1fr))",
          gap: 16,
          maxWidth: 1380,
        }}
      >
        {/* Column headers */}
        {OPTIONS.map((opt) => (
          <div
            key={`h-${opt.id}`}
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: "var(--df-text-faint)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              paddingBottom: 4,
              borderBottom: "1px solid var(--df-border-subtle)",
            }}
          >
            {opt.id} · {opt.label}
          </div>
        ))}

        {/* Card grid: for each skill, render across all options */}
        {MOCK_SKILLS.flatMap((skill) =>
          OPTIONS.map((opt) => {
            const Comp = opt.Comp;
            return (
              <div
                key={`${skill.id}-${opt.id}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: "var(--df-r-md)",
                  overflow: "hidden",
                  border: "1px solid var(--df-border-subtle)",
                  background: "var(--df-surface-raised)",
                }}
              >
                <div style={{ aspectRatio: "16 / 9", position: "relative" }}>
                  <Comp skill={skill} />
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderTop: "1px solid var(--df-border-subtle)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--df-text-primary)",
                      lineHeight: 1.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {skill.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 11,
                      color: "var(--df-text-faint)",
                      letterSpacing: "0.02em",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {skill.trigger}
                  </div>
                </div>
              </div>
            );
          }),
        )}
      </div>

      <footer
        style={{
          marginTop: 28,
          padding: "12px 14px",
          borderRadius: "var(--df-r-sm)",
          background: "var(--df-bg-section)",
          border: "1px solid var(--df-border-subtle)",
          fontSize: 12,
          color: "var(--df-text-muted)",
          lineHeight: 1.5,
          maxWidth: 1100,
        }}
      >
        Manda a letra (A, B, C, D, E ou F) — se quiser combinar (e.g. "C com cor de B"), descreve
        que aplico.
      </footer>
    </div>
  );
}
