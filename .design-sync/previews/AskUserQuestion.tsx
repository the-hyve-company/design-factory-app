import { useState } from "react";
import { AskUserQuestion, type ParsedQuestion } from "design-factory";

// The inline ::question UI Claude renders in chat — header, prompt, option
// buttons. Shows the unanswered state and the answered (locked + dimmed)
// state.
const QUESTION: ParsedQuestion = {
  header: "Direction",
  question: "How should the landing page lead?",
  options: [
    { label: "Bold hero", description: "Oversized type, single accent, lots of negative space." },
    { label: "Product-first", description: "Screenshot above the fold, features in a tight grid." },
    { label: "Editorial", description: "Long-form narrative, mono accents, restrained palette." },
  ],
  raw: "",
};

function Chat({
  theme = "dark",
  answered,
}: {
  theme?: "dark" | "light";
  answered?: string;
}) {
  const [picked, setPicked] = useState<string | undefined>(answered);
  return (
    <div
      data-theme={theme}
      style={{ background: "var(--df-bg-base)", padding: 28, width: 460 }}
    >
      <AskUserQuestion question={QUESTION} onPick={setPicked} answered={picked} />
    </div>
  );
}

export function Unanswered() {
  return <Chat />;
}

export function Answered() {
  return <Chat answered="Editorial" />;
}

export function LightTheme() {
  return <Chat theme="light" />;
}
