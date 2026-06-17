import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { geminiProvider } from "./gemini";
import { opencodeProvider } from "./opencode";
import { kimiProvider } from "./kimi";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { openaiProvider } from "./openai";
import { geminiApiProvider } from "./gemini-api";
import { openrouterProvider } from "./openrouter";
import type { LLMProvider, ProviderId, ProviderStatusReport } from "./types";

// Multi-provider registry. DF ships with 10 adapters split across
// three transports: CLI spawn, BYOK HTTP API, and local Ollama. No
// provider is the "center". Removed in v1 beta cleanup (user
// direction 2026-05-15): cursor, copilot, qwen, deepseek.

export const PROVIDERS: LLMProvider[] = [
  // CLI providers (PATH-resolved spawn)
  claudeProvider,
  codexProvider,
  geminiProvider,
  opencodeProvider,
  kimiProvider,
  // API providers (BYOK HTTP)
  anthropicProvider,
  openaiProvider,
  geminiApiProvider,
  openrouterProvider,
  // Local server
  ollamaProvider,
];

export function getProvider(id: ProviderId): LLMProvider | null {
  return PROVIDERS.find((p) => p.meta.id === id) ?? null;
}

export async function probeAllProviders(): Promise<Record<ProviderId, ProviderStatusReport>> {
  const entries = await Promise.all(
    PROVIDERS.map(async (p) => {
      try {
        const r = await p.status();
        return [p.meta.id, r] as const;
      } catch (e) {
        return [p.meta.id, { status: "error" as const, detail: String(e) }] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<ProviderId, ProviderStatusReport>;
}
