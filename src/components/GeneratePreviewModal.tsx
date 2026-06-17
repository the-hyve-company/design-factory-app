/**
 * GeneratePreviewModal — provider + model picker for the DS preview
 * generation flow. Reuses the same canonical model lists the chat uses
 * (src/providers/model-lists.ts) so:
 *   - every provider exposes its real model catalog (no hardcoded
 *     defaults drifting from the chat's source of truth)
 *   - the "default" option is always present where it makes sense
 *     (codex / gemini / opencode / kimi / anthropic-api — providers
 *     where the CLI / API ships with its own default)
 *   - ollama + openrouter probe live (useLiveModelOptions)
 *   - last-selected model is persisted per provider (readLastModel /
 *     writeLastModel)
 *
 * The endpoint POSTs to /ds/generate-preview with { dsPath,
 * designMdPath, provider, model } and the daemon dispatches to the
 * provider's /once. Identical wiring to how the chat picks a provider
 * and dispatches messages.
 */

import { useEffect, useState } from "react";
import { DfModal } from "@/components/DfModal";
import { BRIDGE_URL } from "@/lib/claude-bridge";
import type { DsEntry } from "@/types/ds";
import type { ProviderId } from "@/providers/types";
import {
  defaultModelForProvider,
  readLastModel,
  writeLastModel,
  useLiveModelOptions,
} from "@/providers/model-lists";

interface ProviderInfo {
  id: ProviderId;
  label: string;
  readiness?: string;
  available?: boolean;
}

interface Props {
  entry: DsEntry;
  onClose: () => void;
  /** Called when the user submits — owner triggers the generation in
   *  screen scope so the modal can close immediately and the request
   *  survives modal unmount. */
  onSubmit: (provider: ProviderId, model: string) => void;
}

export function GeneratePreviewModal({ entry, onClose, onSubmit }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [model, setModel] = useState<string>(
    () => readLastModel("claude") ?? defaultModelForProvider("claude"),
  );

  // Live model catalog for the picked provider — falls back to static
  // when the live probe doesn't apply (everything except ollama /
  // openrouter, which probe at runtime).
  const liveModels = useLiveModelOptions(provider);
  const modelOptions = liveModels.options;

  // Fetch registered providers + availability. Prefer the first
  // `available: true` provider as the initial selection so the user
  // can't pick a CLI that isn't on PATH.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BRIDGE_URL}/providers`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: ProviderInfo[] = Array.isArray(data?.providers) ? data.providers : [];
        setProviders(list);
        const firstAvailable = list.find((p) => p.available) || list[0];
        if (firstAvailable) {
          const pid = firstAvailable.id as ProviderId;
          setProvider(pid);
          setModel(readLastModel(pid) ?? defaultModelForProvider(pid));
        }
      })
      .catch(() => {
        /* fall through to defaults */
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProviderChange = (id: ProviderId) => {
    setProvider(id);
    // Restore last-used model for the new provider; if none, fall back
    // to the canonical default. Mirrors how the chat's picker behaves.
    setModel(readLastModel(id) ?? defaultModelForProvider(id));
  };

  // Submit handler — persist the picked model, then fire-and-forget
  // the parent's onSubmit. Modal closes immediately; the actual fetch
  // lives in DsPreviewScreen so it survives unmount.
  const handleSubmit = () => {
    writeLastModel(provider, model);
    onSubmit(provider, model);
  };

  // Modal is never "busy" — the parent owns the in-flight request and
  // renders progress on the Preview tab. Keeping the variable name so
  // the existing button labels stay readable in the JSX below.
  const isBusy = false;

  return (
    <DfModal
      open={true}
      onClose={isBusy ? () => {} : onClose}
      size="md"
      title="Gerar preview do design system"
      foot={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--df-border-subtle)",
              color: "var(--df-text-primary)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              borderRadius: "var(--df-r-md)",
              cursor: isBusy ? "not-allowed" : "pointer",
              opacity: isBusy ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isBusy || !provider || !model}
            style={{
              padding: "8px 14px",
              background: "var(--df-text-primary)",
              border: "1px solid var(--df-text-primary)",
              color: "var(--df-bg-base)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              fontWeight: 500,
              borderRadius: "var(--df-r-md)",
              cursor: isBusy ? "wait" : "pointer",
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            {isBusy ? "Gerando…" : "Gerar preview"}
          </button>
        </div>
      }
    >
      <p
        style={{
          fontSize: "var(--df-text-sm)",
          color: "var(--df-text-secondary)",
          lineHeight: 1.55,
          margin: 0,
          marginBottom: 18,
        }}
      >
        O <code style={{ fontFamily: "var(--df-font-mono)" }}>design.md</code> de{" "}
        <strong>{entry.name}</strong> vai ser enviado ao provider escolhido com um prompt fixo que
        pede uma página HTML completa aplicando todos os tokens, componentes e regras descritas. O
        resultado é salvo em{" "}
        <code style={{ fontFamily: "var(--df-font-mono)" }}>{entry.path}/preview.html</code>.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: "var(--df-text-muted)",
              letterSpacing: "var(--df-tracking-label)",
              textTransform: "uppercase",
            }}
          >
            Provider
          </span>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
            disabled={providersLoading || isBusy}
            style={{
              padding: "8px 12px",
              background: "var(--df-bg-section)",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-md)",
              color: "var(--df-text-primary)",
              fontFamily: "inherit",
              fontSize: "var(--df-text-sm)",
            }}
          >
            {providersLoading && <option>Carregando…</option>}
            {!providersLoading && providers.length === 0 && (
              <option value="claude">Claude Code (default)</option>
            )}
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.available === false}>
                {p.label}
                {p.readiness && p.readiness !== "stable" ? ` · ${p.readiness}` : ""}
                {p.available === false ? " · não disponível" : ""}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: "var(--df-text-muted)",
              letterSpacing: "var(--df-tracking-label)",
              textTransform: "uppercase",
            }}
          >
            Modelo{" "}
            {liveModels.loading
              ? "· carregando…"
              : liveModels.source === "static" && provider !== "claude"
                ? "· fallback (configure key)"
                : ""}
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isBusy}
            style={{
              padding: "8px 12px",
              background: "var(--df-bg-section)",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-md)",
              color: "var(--df-text-primary)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-sm)",
            }}
          >
            {modelOptions.length === 0 && <option value="">(sem modelos)</option>}
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.sub ? ` · ${m.sub}` : ""}
              </option>
            ))}
          </select>
          {/* If the chosen model isn't in the canonical list (custom
              id, e.g. preview-only model from Moonshot), surface a
              custom input so the user can override without leaving
              the modal. */}
          {modelOptions.length > 0 && !modelOptions.find((m) => m.id === model) && (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="custom model id"
              style={{
                padding: "6px 10px",
                background: "var(--df-bg-section)",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-md)",
                color: "var(--df-text-primary)",
                fontFamily: "var(--df-font-mono)",
                fontSize: "var(--df-text-xs)",
              }}
            />
          )}
        </label>

        {/* Catch-all custom override. Always visible (collapsed by
            default via <details>) so power users can paste any model
            id without having to drift the picker into a "not in list"
            state first. Mirrors the Custom input pattern that the
            chat's NewProject form exposes. */}
        <details style={{ fontSize: "var(--df-text-xs)", color: "var(--df-text-muted)" }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>Modelo customizado</summary>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="ex: claude-sonnet-4-6"
            style={{
              marginTop: 6,
              width: "100%",
              padding: "6px 10px",
              background: "var(--df-bg-section)",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-md)",
              color: "var(--df-text-primary)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              boxSizing: "border-box",
            }}
          />
        </details>
      </div>
    </DfModal>
  );
}
