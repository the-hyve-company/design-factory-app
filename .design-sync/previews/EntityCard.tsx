import { useState } from "react";
import { EntityCard, CharacterCover } from "design-factory";

// EntityCard is a tile that lives in a card grid. Frame it at a realistic
// tile width on the DS surface. The `thumb` slot takes any node — here the
// generative CharacterCover, exactly how Home renders project/skill tiles.
function Grid({
  theme = "dark",
  children,
}: {
  theme?: "dark" | "light";
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--df-bg-base)",
        padding: 28,
        display: "grid",
        gridTemplateColumns: "repeat(2, 240px)",
        gap: 20,
        fontFamily: "var(--df-font-sans)",
      }}
    >
      {children}
    </div>
  );
}

export function ProjectTiles() {
  return (
    <Grid>
      <EntityCard
        id="aurora"
        title="Aurora landing"
        subtitle="2 days ago · 14 KB"
        thumb={<CharacterCover seed="aurora-landing" />}
        onOpen={() => {}}
        actions={[
          { label: "Rename", onSelect: () => {} },
          { label: "Duplicate", onSelect: () => {} },
          { label: "Delete", onSelect: () => {}, tone: "danger" },
        ]}
      />
      <EntityCard
        id="shaders"
        title="Verb shaders"
        subtitle="just now · 8 KB"
        thumb={<CharacterCover seed="verb-shaders" />}
        onOpen={() => {}}
        actions={[{ label: "Delete", onSelect: () => {}, tone: "danger" }]}
      />
    </Grid>
  );
}

export function MenuOpen() {
  const [open, setOpen] = useState(true);
  return (
    <Grid>
      <EntityCard
        id="brand-kit"
        title="Brand kit"
        subtitle="brand-kit"
        subtitleMono
        thumb={<CharacterCover seed="brand-kit" accent="#c7955a" />}
        onOpen={() => {}}
        menuOpen={open}
        onMenuToggle={setOpen}
        actions={[
          { label: "Open", onSelect: () => {} },
          { label: "Export", onSelect: () => {} },
          { label: "Delete", onSelect: () => {}, tone: "danger" },
        ]}
      />
    </Grid>
  );
}

export function LightTheme() {
  return (
    <Grid theme="light">
      <EntityCard
        id="aurora"
        title="Aurora landing"
        subtitle="2 days ago · 14 KB"
        thumb={<CharacterCover seed="aurora-landing" />}
        onOpen={() => {}}
        actions={[{ label: "Delete", onSelect: () => {}, tone: "danger" }]}
      />
    </Grid>
  );
}
