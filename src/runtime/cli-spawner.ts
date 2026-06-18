// cli-spawner.ts — Provider-agnostic dispatch for chat-style prompts.
//
// History (Provider Handoff Layer v0, 2026-05-03):
//   Pre-v0 this module imported streamClaude/claudeOnce directly. That made
//   the whole prompt runtime Claude-cêntric: switching the picker to Codex
//   only changed the badge, not who actually responded. Now we resolve the
//   provider via getProvider(id) and dispatch through the LLMProvider
//   adapter — every CLI listed in src/providers/registry.ts plays nice.
//
// Back-compat: callers that don't pass providerId still get Claude. Once v1
// lands, EditorScreen passes providerId on every send and the default goes
// away.

import type { ClaudeConfig, StreamCallbacks } from "@/lib/claude-bridge";
import { getProvider } from "@/providers/registry";
import type { ProviderId } from "@/providers/types";

type UnlistenFn = () => void;

export type PromptCategory =
  | "generate" // full streaming, HTML output
  | "refine" // streaming, edit existing HTML
  | "tweaks" // one-shot JSON, no tools
  | "export" // one-shot, format conversion
  | "consult" // streaming, conversation only — no Write/Edit
  | "comment"; // one-shot, annotation

const CATEGORY_CONFIG: Record<PromptCategory, Partial<ClaudeConfig>> = {
  generate: {
    model: "opus",
    maxTokens: 8192,
  },
  refine: {
    model: "opus",
    maxTokens: 8192,
  },
  tweaks: {
    model: "haiku",
    maxTokens: 1024,
  },
  export: {
    model: "sonnet",
    maxTokens: 8192,
  },
  consult: {
    model: "sonnet",
    maxTokens: 1024,
  },
  comment: {
    model: "haiku",
    maxTokens: 512,
  },
};

export interface SpawnOverrides {
  /**
   * Which provider runs this prompt. Defaults to "claude" when omitted.
   * v1 (Provider Handoff Layer) will populate this on every send so the
   * picker selection actually drives execution.
   */
  providerId?: ProviderId;
  model?: string;
  cwd?: string;
  agent?: string;
  /**
   * Forwarded to ClaudeConfig → bridge emits `<provider> --resume <sessionId>`
   * instead of expecting the prompt to carry history. Only meaningful for
   * providers whose adapter supports resume (currently Claude; Codex/Gemini
   * being POC'd).
   */
  sessionId?: string;
}

const DEFAULT_PROVIDER_ID: ProviderId = "claude";

function resolveProvider(id: ProviderId | undefined) {
  const target = id ?? DEFAULT_PROVIDER_ID;
  const provider = getProvider(target);
  if (!provider) {
    throw new Error(
      `[cli-spawner] Unknown providerId "${target}". Registered providers: see src/providers/registry.ts`,
    );
  }
  return provider;
}

/**
 * Credential gate (defense in depth). Returns a clear, actionable message
 * when the provider isn't ready to stream (no API key, server offline),
 * or null when it's connected. Centralizing this here means every
 * generation entry point that routes through spawnStream/spawnOnce is
 * gated — the daemon never gets a request it can only reject with a
 * cryptic "bridge HTTP 400".
 */
async function checkProviderReady(
  provider: ReturnType<typeof resolveProvider>,
): Promise<string | null> {
  const st = await provider.status();
  if (st.status === "connected") return null;
  const detail = st.detail ?? "credencial ausente ou serviço indisponível";
  return `${provider.meta.label} não está pronto: ${detail}. Configure em Settings → Providers.`;
}

export async function spawnStream(
  category: PromptCategory,
  prompt: string,
  systemPrompt: string,
  callbacks: StreamCallbacks,
  overrides?: string | SpawnOverrides,
): Promise<UnlistenFn> {
  const config = CATEGORY_CONFIG[category];
  const o: SpawnOverrides =
    typeof overrides === "string" ? { model: overrides } : (overrides ?? {});
  const provider = resolveProvider(o.providerId);
  const notReady = await checkProviderReady(provider);
  if (notReady) {
    callbacks.onError(notReady);
    return () => {};
  }
  return provider.stream(
    prompt,
    {
      ...config,
      systemPrompt,
      ...(o.model ? { model: o.model } : {}),
      cwd: o.cwd,
      agent: o.agent,
      sessionId: o.sessionId,
    },
    callbacks,
  );
}

export async function spawnOnce(
  category: PromptCategory,
  prompt: string,
  systemPrompt: string,
  overrides?: string | SpawnOverrides,
): Promise<string> {
  const config = CATEGORY_CONFIG[category];
  const o: SpawnOverrides =
    typeof overrides === "string" ? { model: overrides } : (overrides ?? {});
  const provider = resolveProvider(o.providerId);
  const notReady = await checkProviderReady(provider);
  if (notReady) throw new Error(notReady);
  return provider.once(prompt, {
    ...config,
    systemPrompt,
    ...(o.model ? { model: o.model } : {}),
    cwd: o.cwd,
    agent: o.agent,
    sessionId: o.sessionId,
  });
}
