import { DfLoader, type DfLoaderRelation } from "design-factory";

// The canonical 3-dot goo loader. Six relation choreographies — shown as a
// labeled gallery so the distinct motions read. (Animation is captured as a
// single frame in the static sheet.)
const RELATIONS: DfLoaderRelation[] = [
  "bloom",
  "stream",
  "heartbeat",
  "triad",
  "cascade",
  "morse",
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
        gap: 8,
        color: "var(--df-text-primary)",
        fontFamily: "var(--df-font-mono)",
        width: 420,
      }}
    >
      {RELATIONS.map((r) => (
        <div key={r} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <DfLoader relation={r} size={88} />
          <span style={{ fontSize: 10, color: "var(--df-text-faint)", letterSpacing: "0.06em" }}>{r}</span>
        </div>
      ))}
    </div>
  );
}

export function AllRelations() {
  return <Gallery />;
}

export function LightTheme() {
  return <Gallery theme="light" />;
}
