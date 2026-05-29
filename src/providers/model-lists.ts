import { useEffect, useMemo, useState } from "react";
import { BRIDGE_URL } from "@/lib/claude-bridge";
import { fetchOllamaModels } from "@/lib/ollama-bridge";
import { fetchOpenrouterModels } from "@/lib/openrouter-bridge";
import type { ProviderId } from "./types";

// Per-provider model lists. Each provider exposes its own canonical ids;
// the user picks one from the matching dropdown. Codex doesn't expose
// a `models` subcommand — these are the well-known ids accepted by
// `codex exec --model X`.

export interface ModelOption {
  id: string;
  label: string;
  sub: string;
}

// Generic live-model fetch — every daemon /…/models endpoint speaks the
// same { models: [{ id, sub }], error? } contract. Empty array on any
// failure so the caller falls back to the minimal static catalog.
async function fetchModelsVia(path: string): Promise<{ id: string; sub: string }[]> {
  try {
    const res = await fetch(`${BRIDGE_URL}${path}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { id: string; sub: string }[] };
    return body.models ?? [];
  } catch {
    return [];
  }
}

// Providers that fetch their catalog live from the daemon. ollama +
// openrouter keep their dedicated bridge fns (handled in the hook); the
// rest go through fetchModelsVia. codex/gemini (CLI) reuse the BYOK
// endpoint of their underlying provider — they share the same catalog
// and the daemon returns {error:'no-key'} (→ static fallback) when the
// matching API key isn't configured. `claude` has NO live endpoint: its
// ids are aliases (opus/sonnet/haiku) the CLI resolves on its own, so
// the static list IS the contract, not a rotting catalog.
const LIVE_MODEL_ENDPOINTS: Partial<Record<ProviderId, string>> = {
  anthropic: "/anthropic/models",
  openai: "/openai/models",
  "gemini-api": "/gemini-api/models",
  kimi: "/kimi/models",
  opencode: "/opencode/models",
  codex: "/openai/models",
  gemini: "/gemini-api/models",
};

// claude CLI aliases — the CLI resolves these to the latest version on
// the Anthropic API (opus→4.8, sonnet→4.6, haiku→4.5). Not a fallback:
// these aliases ARE the picker contract for the claude provider.
export const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { id: "opus",   label: "opus 4.8",   sub: "max quality" },
  { id: "sonnet", label: "sonnet 4.6", sub: "balanced" },
  { id: "haiku",  label: "haiku 4.5",  sub: "fastest" },
];

// FALLBACK ONLY — codex live-fetches via /openai/models (it accepts the
// OpenAI catalog through `--model X`). This minimal list shows only when
// no OpenAI key is configured / the fetch fails. Custom input covers the
// rest. Source of truth = the live OpenAI catalog.
export const CODEX_MODEL_OPTIONS: ModelOption[] = [
  { id: "default", label: "default",  sub: "from codex CLI config" },
  { id: "gpt-5.5", label: "gpt-5.5",  sub: "fallback · configure OpenAI key" },
];

// FALLBACK ONLY — gemini (CLI) + gemini-api live-fetch via
// /gemini-api/models (Google Generative Language API). This minimal list
// shows only when no Gemini key is configured / the fetch fails.
export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
  { id: "default",            label: "default",            sub: "from gemini CLI config (safest)" },
  { id: "gemini-3.5-flash",   label: "gemini-3.5-flash",   sub: "fallback · configure Gemini key" },
];

// FALLBACK ONLY — anthropic BYOK live-fetches via /anthropic/models.
// This minimal list shows only when no Anthropic key is configured /
// the fetch fails. claude-opus-4-8 is the current frontier (2026-05-28).
export const ANTHROPIC_API_MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-opus-4-8",   label: "opus 4.8",   sub: "fallback · configure Anthropic key" },
  { id: "claude-sonnet-4-6", label: "sonnet 4.6", sub: "fallback" },
];

// FALLBACK ONLY — openai BYOK live-fetches via /openai/models. This
// minimal list shows only when no OpenAI key is configured / the fetch
// fails. gpt-5.5 is the current flagship (May 2026).
export const OPENAI_API_MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.5", label: "gpt-5.5", sub: "fallback · configure OpenAI key" },
  { id: "gpt-5.4", label: "gpt-5.4", sub: "fallback" },
];

// Gemini API (BYOK) — reuses the Gemini CLI catalog; same model ids
// work over the public Generative Language API. Without this entry the
// picker fell back to the Claude list when the provider was `gemini-api`,
// surfacing opus/sonnet/haiku when the user expected gemini-2.5/3.1.
export const GEMINI_API_MODEL_OPTIONS: ModelOption[] = GEMINI_MODEL_OPTIONS;

// Ollama models are pulled by the user (`ollama pull llama3.2`). The picker
// fetches the live list from the Ollama server via /ollama/models — these
// constants are fallbacks for when the probe hasn't run yet.
export const OLLAMA_MODEL_OPTIONS: ModelOption[] = [
  { id: "llama3.2",       label: "llama3.2",       sub: "Meta · 3B / 8B" },
  { id: "qwen2.5-coder",  label: "qwen2.5-coder",  sub: "Alibaba · code" },
  { id: "mistral",        label: "mistral",        sub: "Mistral 7B" },
];

// OpenRouter has 200+ models. The picker fetches the live list via
// /openrouter/models — these constants are fallbacks for when the probe
// hasn't run yet. Default 2026-05-15 = google/gemini-2.5-flash-lite —
// cheapest reliable model in catalog ($0.10/$0.40 per 1M, 1M ctx, no
// free-tier 429 surprises).
export const OPENROUTER_MODEL_OPTIONS: ModelOption[] = [
  { id: "google/gemini-2.5-flash-lite",           label: "Gemini 2.5 Flash-Lite", sub: "Google · cheapest paid" },
  { id: "google/gemini-2.5-flash",                label: "Gemini 2.5 Flash",      sub: "Google · balanced" },
  { id: "anthropic/claude-3.5-sonnet",            label: "Claude 3.5 Sonnet",     sub: "Anthropic · paid" },
  { id: "openai/gpt-4o-mini",                     label: "GPT-4o mini",           sub: "OpenAI · cheap" },
  { id: "deepseek/deepseek-v3.2",                 label: "DeepSeek V3.2",         sub: "DeepSeek · cheap" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)",  sub: "Meta · free tier" },
];

// FALLBACK ONLY — opencode live-fetches via `opencode models` (shell-out
// → /opencode/models), emitting the real provider/model catalog from the
// user's configured providers (Models.dev registry). This minimal list
// shows only when the CLI is unavailable / the command fails.
export const OPENCODE_MODEL_OPTIONS: ModelOption[] = [
  { id: "default",                     label: "default",          sub: "from opencode config" },
  { id: "openai/gpt-5.4-mini",         label: "openai/gpt-5.4-mini",       sub: "fallback · run opencode auth" },
  { id: "anthropic/claude-opus-4-8",   label: "anthropic/claude-opus-4-8", sub: "fallback" },
];

// FALLBACK ONLY — kimi BYOK live-fetches via /kimi/models (Moonshot,
// OpenAI-compatible). This minimal list shows only when no Moonshot key
// is configured / the fetch fails. kimi-k2.6 is current (Apr 2026);
// kimi-latest + kimi-k2-0905-preview were discontinued (Jan/May 2026).
export const KIMI_MODEL_OPTIONS: ModelOption[] = [
  { id: "kimi-k2.6", label: "kimi-k2.6", sub: "fallback · configure Moonshot key" },
  { id: "kimi-k2.5", label: "kimi-k2.5", sub: "fallback" },
];

export function getModelsForProvider(id: ProviderId): ModelOption[] {
  if (id === "codex") return CODEX_MODEL_OPTIONS;
  if (id === "gemini") return GEMINI_MODEL_OPTIONS;
  if (id === "gemini-api") return GEMINI_API_MODEL_OPTIONS;
  if (id === "anthropic") return ANTHROPIC_API_MODEL_OPTIONS;
  if (id === "openai") return OPENAI_API_MODEL_OPTIONS;
  if (id === "ollama") return OLLAMA_MODEL_OPTIONS;
  if (id === "openrouter") return OPENROUTER_MODEL_OPTIONS;
  if (id === "opencode") return OPENCODE_MODEL_OPTIONS;
  if (id === "kimi") return KIMI_MODEL_OPTIONS;
  return CLAUDE_MODEL_OPTIONS;
}

/** First model in the list — used as the reset target when switching providers. */
export function defaultModelForProvider(id: ProviderId): string {
  const list = getModelsForProvider(id);
  return list[0]?.id ?? "";
}

const ALL_PROVIDER_IDS: ProviderId[] = [
  "claude", "codex", "gemini", "gemini-api", "anthropic",
  "openai", "ollama", "openrouter", "opencode", "kimi",
];

/** True only when `model` belongs to a DIFFERENT provider's catalog and not
 *  this provider's. Used to gate applying a persisted model id (e.g. from the
 *  NewProject modal) without dropping legitimate custom/live model ids that
 *  no static catalog lists. The static catalogs are intentionally partial —
 *  openrouter/ollama/codex/openai/kimi all accept custom ids via the picker's
 *  Custom input — so a plain membership check would wrongly reject them. This
 *  only flags the cross-provider leak we actually care about (e.g. Claude's
 *  "opus" riding into a kimi project). */
export function isModelForeignToProvider(model: string, provider: ProviderId): boolean {
  if (!model) return false;
  if (getModelsForProvider(provider).some((o) => o.id === model)) return false;
  return ALL_PROVIDER_IDS.some(
    (p) => p !== provider && getModelsForProvider(p).some((o) => o.id === model),
  );
}

/** localStorage key used to remember the last-selected model per provider. */
export function lastModelKey(id: ProviderId): string {
  return `df:last-model:${id}`;
}

/** Read the persisted last-selected model for a provider, if any. */
export function readLastModel(id: ProviderId): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(lastModelKey(id)) : null;
  } catch { return null; }
}

/** Persist the last-selected model for a provider. */
export function writeLastModel(id: ProviderId, model: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(lastModelKey(id), model);
  } catch {}
}

/** Live model list with fallback to the minimal static catalog.
 *  - ollama: probes the local ollama server for actually-pulled models
 *  - openrouter: fetches the public model catalog (200+)
 *  - anthropic/openai/gemini-api/kimi: BYOK /…/models via the daemon
 *  - codex/gemini (CLI): reuse the underlying provider's BYOK endpoint
 *  - opencode: shell-out `opencode models`
 *  - claude: no live endpoint (aliases are the contract) → static
 *
 *  Live results win over static when the probe succeeds and returns rows.
 *  On failure, empty list, or no API key, the static fallback is used so
 *  the picker never goes blank — `source: "static"` lets the UI flag it. */
export function useLiveModelOptions(provider: ProviderId): {
  options: ModelOption[];
  loading: boolean;
  source: "live" | "static";
} {
  const [live, setLive] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const endpoint = LIVE_MODEL_ENDPOINTS[provider];
    const hasLive = provider === "ollama" || provider === "openrouter" || !!endpoint;
    if (!hasLive) {
      setLive(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = provider === "ollama"
          ? await fetchOllamaModels()
          : provider === "openrouter"
            ? await fetchOpenrouterModels()
            : await fetchModelsVia(endpoint!);
        if (cancelled) return;
        // Probe returns { id, sub } — promote to ModelOption (label = id).
        const opts: ModelOption[] = rows.map((r) => ({ id: r.id, label: r.id, sub: r.sub }));
        setLive(opts.length > 0 ? opts : null);
      } catch {
        if (!cancelled) setLive(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  // Memoize the return value so consumers don't see a fresh object reference
  // on every parent re-render (e.g. while user types in chat input — the
  // EditorScreen re-renders on every keystroke). Without this, downstream
  // useMemo/useEffect deps that include the destructured options/source
  // invalidate every render and can cascade into perceptible UI flicker.
  return useMemo(() => {
    if (live && live.length > 0) {
      return { options: live, loading, source: "live" as const };
    }
    return { options: getModelsForProvider(provider), loading, source: "static" as const };
  }, [live, loading, provider]);
}
