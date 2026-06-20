import { SkeuHero, TactileBtn } from "design-factory";

// The canonical skeu hero pattern — bezel surface, ASCII dot grain, corner
// logo decal, kicker + title, optional CTA. Sizes sm / md / lg.
function Frame({
  theme = "dark",
  children,
}: {
  theme?: "dark" | "light";
  children: React.ReactNode;
}) {
  return (
    <div data-theme={theme} style={{ background: "var(--df-bg-base)", padding: 28, width: 640 }}>
      {children}
    </div>
  );
}

export function Medium() {
  return (
    <Frame>
      <SkeuHero kicker="DESIGN FACTORY" title="Turn prompts into editable artifacts" size="md" />
    </Frame>
  );
}

export function LargeWithCta() {
  return (
    <Frame>
      <SkeuHero
        kicker="NEW PROJECT"
        title="Start from a blank canvas"
        size="lg"
        cta={<TactileBtn onClick={() => {}}>Create project</TactileBtn>}
      />
    </Frame>
  );
}

export function Small() {
  return (
    <Frame>
      <SkeuHero kicker="SECTION" title="Recent projects" size="sm" />
    </Frame>
  );
}

export function LightTheme() {
  return (
    <Frame theme="light">
      <SkeuHero kicker="DESIGN FACTORY" title="Turn prompts into editable artifacts" size="md" />
    </Frame>
  );
}
