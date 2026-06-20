import { VerbShader, type VerbCategory } from "design-factory";

// Self-contained CSS shaders that live behind the editorial verb cards. One
// per verb category — shown as a labeled gallery of framed tiles (each shader
// fills its positioned parent). Animation captured as a single frame.
const VERBS: Array<{ category: VerbCategory; label: string }> = [
  { category: "evaluate", label: "evaluate · scan" },
  { category: "refine", label: "refine · polish" },
  { category: "direction", label: "direction · aurora" },
  { category: "enhance", label: "enhance · sparkle" },
  { category: "fix", label: "fix · glitch" },
  { category: "export", label: "export · polish" },
];

function Gallery({ theme = "dark" }: { theme?: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        width: 560,
      }}
    >
      {VERBS.map(({ category, label }) => (
        <div
          key={category}
          style={{
            position: "relative",
            height: 96,
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--df-border-subtle)",
            background: "var(--df-bg-sunken)",
            display: "flex",
            alignItems: "flex-end",
            padding: 8,
          }}
        >
          <VerbShader category={category} />
          <span
            style={{
              position: "relative",
              zIndex: 1,
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: "var(--df-text-secondary)",
              letterSpacing: "0.04em",
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AllVerbs() {
  return <Gallery />;
}
