// ProviderBadge — small pill that identifies which provider produced an
// assistant message. Renders inline at the top of the bubble. Provider
// Handoff Layer v1 (spec §4.6).

import type { ProviderIdValue } from "@/lib/schemas";

// Labels stay short — the pill is small.
const LABEL: Record<ProviderIdValue, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "Opencode",
  kimi: "Kimi",
  anthropic: "Anthropic",
  openai: "OpenAI",
  "gemini-api": "Gemini API",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

// Per-provider hue stays minimal — the pill itself is muted, the dot
// gives the eye a color anchor without sliding into rainbow chip
// territory. Hex picked by hand to be distinguishable on both dark + light.
const DOT_COLOR: Record<ProviderIdValue, string> = {
  claude: "#cf8a4a", // claude warm tan
  codex: "#10a37f", // openai green (CLI)
  gemini: "#4285f4", // google blue (CLI)
  opencode: "#f97316", // sst orange
  kimi: "#1c64f2", // moonshot deep blue
  anthropic: "#cf8a4a", // same warm tan as claude (same provider, API transport)
  openai: "#10a37f", // openai green (API)
  "gemini-api": "#4285f4", // google blue (API)
  openrouter: "#a855f7", // openrouter purple
  ollama: "#7b8794", // local-grey
};

interface Props {
  provider?: ProviderIdValue;
  /** Optional model id to show in the tooltip. */
  model?: string;
  /** Smaller variant for dense layouts (header, separators). */
  size?: "sm" | "md";
}

export function ProviderBadge({ provider, model, size = "md" }: Props) {
  if (!provider) return null;
  const label = LABEL[provider];
  const dot = DOT_COLOR[provider];
  const isSm = size === "sm";
  return (
    <span
      title={model ? `${label} · ${model}` : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isSm ? 4 : 6,
        padding: isSm ? "2px 6px" : "3px 8px",
        borderRadius: 999,
        background: "var(--df-surface-raised, rgba(0,0,0,0.06))",
        border: "1px solid var(--df-border-subtle, rgba(0,0,0,0.08))",
        fontSize: isSm ? 10 : 11,
        fontWeight: 500,
        letterSpacing: 0.2,
        color: "var(--df-text-secondary, currentColor)",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: isSm ? 6 : 7,
          height: isSm ? 6 : 7,
          borderRadius: "50%",
          background: dot,
          boxShadow: `0 0 0 1px color-mix(in oklab, ${dot} 50%, transparent)`,
        }}
      />
      {label}
    </span>
  );
}
