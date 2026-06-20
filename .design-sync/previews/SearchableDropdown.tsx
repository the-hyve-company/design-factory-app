import { SearchableDropdown, type SearchableDropdownItem } from "design-factory";

// Open popover (open is a prop, so the real list renders statically): search
// input, optional group headers, selected check. Rendered inside a tall
// relative host since with no triggerRef it positions absolutely below it.
const MODELS: SearchableDropdownItem[] = [
  { id: "opus", label: "Claude Opus 4.8", sub: "anthropic · most capable", group: "anthropic", groupLabel: "Anthropic" },
  { id: "sonnet", label: "Claude Sonnet 4.6", sub: "anthropic · balanced", group: "anthropic", groupLabel: "Anthropic" },
  { id: "haiku", label: "Claude Haiku 4.5", sub: "anthropic · fast", group: "anthropic", groupLabel: "Anthropic" },
  { id: "gpt", label: "GPT-5", sub: "openai", group: "openai", groupLabel: "OpenAI" },
  { id: "gemini", label: "Gemini 2.5 Pro", sub: "google", group: "google", groupLabel: "Google" },
];

function Host({
  theme = "dark",
  items,
  selectedId,
}: {
  theme?: "dark" | "light";
  items: SearchableDropdownItem[];
  selectedId: string;
}) {
  return (
    <div
      data-theme={theme}
      style={{ background: "var(--df-bg-base)", padding: 28, width: 340, minHeight: 460 }}
    >
      <div style={{ position: "relative", height: 1 }}>
        <SearchableDropdown
          open
          onClose={() => {}}
          items={items}
          selectedId={selectedId}
          onPick={() => {}}
          ariaLabel="Pick a model"
          searchPlaceholder="Search models…"
        />
      </div>
    </div>
  );
}

export function Grouped() {
  return <Host items={MODELS} selectedId="opus" />;
}

export function Flat() {
  return (
    <Host
      items={MODELS.map(({ group, groupLabel, ...m }) => m)}
      selectedId="sonnet"
    />
  );
}

export function LightTheme() {
  return <Host theme="light" items={MODELS} selectedId="opus" />;
}
