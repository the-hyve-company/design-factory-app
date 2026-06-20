import { CharacterCover } from "design-factory";

// Deterministic dot-grid creatures — same seed always yields the same
// character. A gallery of seeds shows the variety; one row pins a custom
// accent. Background stays neutral so it reads on both themes.
const SEEDS = ["aurora", "verb-shaders", "brand-kit", "hyve", "design-factory", "skeuomorph"];

function Gallery({
  theme = "dark",
  accent,
}: {
  theme?: "dark" | "light";
  accent?: string;
}) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "grid",
        gridTemplateColumns: "repeat(3, 150px)",
        gap: 14,
      }}
    >
      {SEEDS.map((s) => (
        <div
          key={s}
          style={{
            aspectRatio: "16 / 9",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--df-border-subtle)",
          }}
        >
          <CharacterCover seed={s} accent={accent} />
        </div>
      ))}
    </div>
  );
}

export function Gallery6() {
  return <Gallery />;
}

export function AccentTinted() {
  return <Gallery accent="#c7955a" />;
}

export function LightTheme() {
  return <Gallery theme="light" />;
}
