import { useState } from "react";
import { CardMenuButton, CharacterCover } from "design-factory";

// CardMenuButton anchors absolutely to the top-right of a card thumbnail —
// shown on a real 16:9 thumb so its concentric-corner radius reads.
function Thumb({
  open,
  theme = "dark",
}: {
  open: boolean;
  theme?: "dark" | "light";
}) {
  const [o, setO] = useState(open);
  return (
    <div data-theme={theme} style={{ background: "var(--df-bg-base)", padding: 28 }}>
      <div
        style={{
          position: "relative",
          width: 240,
          aspectRatio: "16 / 9",
          borderRadius: "var(--df-r-xl, 12px)",
          overflow: "hidden",
          border: "1px solid var(--df-border-subtle)",
        }}
      >
        <CharacterCover seed="card-menu-demo" />
        <CardMenuButton open={o} onClick={() => setO((v) => !v)} />
      </div>
    </div>
  );
}

export function OnThumbnail() {
  return <Thumb open={false} />;
}

export function LightTheme() {
  return <Thumb open={false} theme="light" />;
}
