// ProviderTokenInline — token input rendered inline under each
// API-key provider row in Settings → Providers. Replaces the older
// standalone Tokens tab.
//
// Two providers need a key today: Anthropic (sk-ant-) and OpenRouter.
// Each round-trips through the daemon's PUT /config/{service}
// endpoint, chmod 600 on disk. The browser only ever sees
// `tokenSet:bool + source`.

import { useEffect, useState, useCallback } from "react";
import { BRIDGE_URL } from "@/lib/claude-bridge";
import {
  getVercelConfigState,
  getVercelUser,
  testVercelConnection,
  type VercelConfigState,
  type VercelUserProfile,
} from "@/lib/vercel-bridge";
import {
  ghHasToken,
  ghGetUser,
  type GithubUserProfile,
} from "@/lib/github-bridge";
import { CliInstallHint } from "@/components/CliInstallHint";
import { useT } from "@/i18n";

type Provider = "anthropic" | "openrouter" | "openai" | "gemini-api" | "kimi";

// Every BYOK key round-trips through the daemon's GET/PUT /config/{service}
// endpoints — same contract: GET → {tokenSet, source}; PUT {token} →
// {ok, error?}. The browser never sees the token value back. provider id
// → config service name (gemini-api stores under the shared "gemini" key).
const CONFIG_SERVICE: Record<Provider, string> = {
  anthropic: "anthropic",
  openrouter: "openrouter",
  openai: "openai",
  "gemini-api": "gemini",
  kimi: "kimi",
};

async function getTokenStatus(service: string): Promise<{ tokenSet: boolean; source: "env" | "disk" | null }> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/${service}`);
    if (!res.ok) return { tokenSet: false, source: null };
    return await res.json();
  } catch {
    return { tokenSet: false, source: null };
  }
}

async function putToken(service: string, token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/${service}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: body.ok ?? true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

interface InlineProviderTokenProps {
  provider: Provider;
  onSaved?: () => void;
}

export function InlineProviderToken({ provider, onSaved }: InlineProviderTokenProps) {
  const { t, tf } = useT();
  const [tokenSet, setTokenSet] = useState(false);
  const [source, setSource] = useState<"env" | "disk" | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"saved" | "cleared" | null>(null);

  const meta = META[provider];
  const service = CONFIG_SERVICE[provider];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getTokenStatus(service);
      if (!cancelled) {
        setTokenSet(s.tokenSet);
        setSource(s.source ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [service]);

  const validate = (value: string): string | null => {
    if (!value) return null;
    if (meta.prefix && !value.startsWith(meta.prefix)) return tf("provtok.must.start.with", meta.prefix);
    if (value.length < 20) return t("provtok.too.short");
    return null;
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    const v = validate(trimmed);
    if (v) { setError(v); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await putToken(service, trimmed);
      if (!r.ok) { setError(r.error ?? t("provtok.save.failed")); setSaving(false); return; }
      setDraft("");
      const next = await getTokenStatus(service);
      setTokenSet(next.tokenSet);
      setSource(next.source ?? null);
      setFlash("saved");
      window.setTimeout(() => setFlash(null), 2200);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await putToken(service, "");
      const next = await getTokenStatus(service);
      setTokenSet(next.tokenSet);
      setSource(next.source ?? null);
      setFlash("cleared");
      window.setTimeout(() => setFlash(null), 2200);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const disableSave = saving || !draft.trim() || !!validate(draft.trim());

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <span style={labelStyle}>{t(meta.labelKey)}</span>
        <span style={badgeStyle(tokenSet)}>
          {tokenSet ? (source === "env" ? tf("provtok.from.env", meta.envVar) : t("provtok.saved.badge")) : t("provtok.notset")}
        </span>
      </div>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={tokenSet ? t("provtok.placeholder.replace") : t(meta.placeholderKey)}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        style={inputStyle}
      />
      {error && <div style={errStyle}>{error}</div>}
      {flash && <div style={okStyle}>{flash === "saved" ? t("provtok.savedflash") : t("provtok.cleared")}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          className="df-btn df-btn--primary"
          onClick={handleSave}
          disabled={disableSave}
          style={btnStyle}
        >
          {saving ? t("provtok.saving") : t("provtok.save.key")}
        </button>
        {tokenSet && source !== "env" && (
          <button
            className="df-btn df-btn--secondary"
            onClick={handleClear}
            disabled={saving}
            style={btnStyle}
          >
            {t("provtok.clear")}
          </button>
        )}
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          style={linkStyle}
        >
          {t("provtok.getkey")}
        </a>
      </div>
    </div>
  );
}

// Static metadata that doesn't change with language. Labels + placeholders
// are i18n keys resolved at render time so the component flips with the
// active language.
const META: Record<Provider, { labelKey: string; envVar: string; placeholderKey: string; prefix?: string; docsUrl: string }> = {
  anthropic: {
    labelKey: "provtok.label.anthropic",
    envVar: "ANTHROPIC_API_KEY",
    placeholderKey: "provtok.placeholder.anthropic",
    prefix: "sk-ant-",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  openrouter: {
    labelKey: "provtok.label.openrouter",
    envVar: "OPENROUTER_API_KEY",
    placeholderKey: "provtok.placeholder.openrouter",
    docsUrl: "https://openrouter.ai/keys",
  },
  openai: {
    labelKey: "provtok.label.openai",
    envVar: "OPENAI_API_KEY",
    placeholderKey: "provtok.placeholder.openai",
    prefix: "sk-",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  "gemini-api": {
    labelKey: "provtok.label.gemini",
    envVar: "GEMINI_API_KEY",
    placeholderKey: "provtok.placeholder.gemini",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  kimi: {
    labelKey: "provtok.label.kimi",
    envVar: "MOONSHOT_API_KEY",
    placeholderKey: "provtok.placeholder.kimi",
    prefix: "sk-",
    docsUrl: "https://platform.moonshot.ai/console/api-keys",
  },
};

// ─── Vercel publish (Providers tab — CLI detection only, ) ───
//
// ed: "deixe so detecção de cli".
// Removed: BYOK token paste input, teamId input, OAuth Device Flow button.
// Kept: CLI detection (when `vercel login` ran in terminal, daemon picks
// up `~/.local/share/com.vercel.cli/auth.json` — see ). Two states:
//   1. Connected via CLI — avatar + username + email + team chip + "Atualizar
//      status" button (re-detect). Disconnect is disabled with tip "rode
//      `vercel logout` no terminal".
//   2. Disconnected — CliInstallHint expanded (install + login commands)
//      + "Verificar novamente" button (re-runs detection).
//
// BYOK and OAuth daemon endpoints are intentionally preserved for now
// (deferred cleanup) — only the UI surfaces them as "CLI only".
//
// [DEPRECATED] VercelPublishCard is not part of the current public
// surface. SettingsScreen.tsx no longer renders this component. The
// function is preserved for a future polished surface.
export function VercelPublishCard() {
  const { t, tf } = useT();
  const [state, setState] = useState<VercelConfigState>({ tokenSet: false, teamId: "", teamSlug: "" });
  const [profile, setProfile] = useState<VercelUserProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    const cfg = await getVercelConfigState();
    setState(cfg);
    if (cfg.tokenSet) {
      const p = await getVercelUser();
      setProfile(p);
    } else {
      setProfile(null);
    }
    setBusy(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    const r = await testVercelConnection();
    setTesting(false);
    if (!r.ok) {
      setError(tf("provtok.vercel.test.failed", r.error ?? "unknown"));
      return;
    }
    setFlash(tf("provtok.vercel.test.ok", r.username ?? ""));
    window.setTimeout(() => setFlash(null), 2400);
  };

  // only CLI source counts as "connected" — BYOK paste flow removed
  // from UI. If the daemon already has a saved BYOK token from before we
  // still surface it as connected (don't break users mid-state), but
  // we no longer offer paste.
  const isConnected = state.tokenSet && profile?.ok;
  const isCliSource = state.source === "vercel-cli" || profile?.source === "vercel-cli";
  const sourceLabel = isCliSource
    ? t("provtok.vercel.source.cli")
    : t("provtok.vercel.source.byok");

  return (
    <section className="settings-group" style={{ marginTop: 28 }}>
      <h2 className="settings-group-title">{t("provtok.vercel.publish.title")}</h2>
      <p className="settings-group-sub" style={{ marginTop: 4, marginBottom: 12 }}>
        {t("provtok.vercel.publish.body")}
      </p>
      <div className="provider-oauth-card">
        <div className="provider-oauth-head">
          <span className="provider-oauth-label">{t("provtok.vercel.label")}</span>
          <span className={`provider-oauth-badge${isConnected ? " is-on" : ""}`}>
            {isConnected ? t("provtok.connected") : t("provtok.notset")}
          </span>
        </div>

        {/* Connected — show profile + Test connection + Refresh status.
            Disconnect is disabled with a CLI tip (`vercel logout`). */}
        {isConnected && profile && (
          <>
            <div className="provider-oauth-profile">
              <div className="provider-oauth-avatar" aria-hidden="true">
                {profile.avatar
                  ? <img src={profile.avatar} alt="" />
                  : <span>{(profile.username || "?").slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="provider-oauth-id">
                <span className="provider-oauth-name">{profile.name || profile.username || ""}</span>
                <span className="provider-oauth-meta">
                  {profile.email || profile.username}
                  {profile.teamLabel ? ` · ${profile.teamLabel}` : ""}
                  {sourceLabel ? ` · ${sourceLabel}` : ""}
                </span>
              </div>
            </div>
            <div className="provider-oauth-actions">
              <button
                className="df-btn df-btn--secondary"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? t("provtok.vercel.test.testing") : t("provtok.vercel.test")}
              </button>
              <button
                className="df-btn df-btn--secondary"
                onClick={() => void refresh()}
                disabled={busy}
                title={t("provtok.vercel.cli.tip")}
              >
                {t("provtok.refresh")}
              </button>
            </div>
          </>
        )}

        {/* Disconnected — CLI hint expanded (install + login commands), plus
         * a "Verificar novamente" button to re-run detection after the
         * user logs in via the terminal. : removed BYOK paste +
         * OAuth Device Flow button per . */}
        {!isConnected && (
          <>
            <div className="provider-oauth-cli-hint">
              {t("provtok.vercel.cli.hint")}
              <code>vercel login</code>
            </div>
            <CliInstallHint provider="vercel" defaultOpen />
            <div className="provider-oauth-actions" style={{ marginTop: 12 }}>
              <button
                className="df-btn df-btn--primary"
                onClick={() => void refresh()}
                disabled={busy}
              >
                {busy ? t("provtok.vercel.checking") : t("provtok.vercel.recheck")}
              </button>
            </div>
          </>
        )}

        {error && <div className="provider-oauth-error">{error}</div>}
        {flash && <div className="provider-oauth-flash">{flash}</div>}
      </div>
    </section>
  );
}

// ─── GitHub provider card (CLI detection only, ) ───
//
// ed: "deixe so detecção de cli".
// Removed: "Conectar com GitHub" Device Flow button + flow rendering.
// Kept: gh CLI auto-detection (daemon picks up `~/.config/gh/hosts.yml`).
// Two states:
//   1. Connected via gh CLI — avatar + login + meta + "Atualizar status".
//      Disconnect disabled with CLI tip (user runs `gh auth logout`).
//   2. Disconnected — CliInstallHint expanded (install + auth login) +
//      "Verificar novamente" button.
//
// Daemon device-flow endpoints stay (deferred cleanup) — only UI hides.
//
// [DEPRECATED] GithubProviderCard is not part of the current public
// surface. SettingsScreen.tsx no longer renders this component. The
// function is preserved for a future polished surface.
export function GithubProviderCard() {
  const { t } = useT();
  const [profile, setProfile] = useState<GithubUserProfile | null>(null);
  const [tokenSource, setTokenSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    const t1 = await ghHasToken();
    setTokenSource(t1.source);
    if (t1.hasToken) {
      const p = await ghGetUser();
      setProfile(p);
    } else {
      setProfile(null);
    }
    setBusy(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isConnected = profile?.ok;
  const sourceLabel = tokenSource === "gh-cli"
    ? t("provtok.gh.source.cli")
    : tokenSource === "device-flow"
      ? t("provtok.gh.source.device")
      : "";

  return (
    <section className="settings-group" style={{ marginTop: 24 }}>
      <h2 className="settings-group-title">{t("provtok.gh.title")}</h2>
      <p className="settings-group-sub" style={{ marginTop: 4, marginBottom: 12 }}>
        {t("provtok.gh.body")}
      </p>
      <div className="provider-oauth-card">
        <div className="provider-oauth-head">
          <span className="provider-oauth-label">{t("provtok.gh.label")}</span>
          <span className={`provider-oauth-badge${isConnected ? " is-on" : ""}`}>
            {isConnected ? t("provtok.connected") : t("provtok.notset")}
          </span>
        </div>

        {isConnected && profile && (
          <>
            <div className="provider-oauth-profile">
              <div className="provider-oauth-avatar" aria-hidden="true">
                {profile.avatar
                  ? <img src={profile.avatar} alt="" />
                  : <span>{(profile.login || "?").slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="provider-oauth-id">
                <span className="provider-oauth-name">{profile.name || profile.login || ""}</span>
                <span className="provider-oauth-meta">
                  @{profile.login}
                  {sourceLabel ? ` · ${sourceLabel}` : ""}
                  {typeof profile.publicRepos === "number" ? ` · ${profile.publicRepos} repos` : ""}
                </span>
              </div>
            </div>
            <div className="provider-oauth-actions">
              <button
                className="df-btn df-btn--secondary"
                onClick={() => void refresh()}
                disabled={busy}
                title={tokenSource === "gh-cli" ? t("provtok.gh.cli.tip") : undefined}
              >
                {t("provtok.refresh")}
              </button>
              <a
                href="https://github.com/settings/applications"
                target="_blank"
                rel="noreferrer"
                className="provider-oauth-link"
              >
                {t("provtok.gh.manage")}
              </a>
            </div>
          </>
        )}

        {!isConnected && (
          <>
            <div className="provider-oauth-cli-hint">
              {t("provtok.gh.cli.hint")}
              <code>gh auth login</code>
            </div>
            <CliInstallHint provider="github" defaultOpen />
            <div className="provider-oauth-actions" style={{ marginTop: 12 }}>
              <button
                className="df-btn df-btn--primary"
                onClick={() => void refresh()}
                disabled={busy}
              >
                {busy ? t("provtok.vercel.checking") : t("provtok.vercel.recheck")}
              </button>
            </div>
          </>
        )}

        {flash && <div className="provider-oauth-flash">{flash}</div>}
      </div>
    </section>
  );
}

// ─── Shared inline styles ─────────────────────────────────────────────
//
// `wrapStyle` is used INSIDE provider rows (Anthropic, OpenRouter expand
// view). Inset 24px left to nest under the row content.
//
// Vercel + GitHub cards moved to `.provider-oauth-card`
// chrome in oauth-device-flow.css — no inline style needed for them.
const wrapStyle: React.CSSProperties = {
  margin: "8px 0 14px 24px",
  padding: "12px 14px",
  background: "var(--df-bg-section)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 6,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  color: "var(--df-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 11px",
  background: "var(--df-bg-base)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 6,
  color: "var(--df-text-primary)",
  fontFamily: "var(--df-font-mono)",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = { fontSize: "var(--df-text-xs)" };

const linkStyle: React.CSSProperties = {
  marginLeft: "auto",
  alignSelf: "center",
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  color: "var(--df-text-muted)",
  textDecoration: "none",
};

const errStyle: React.CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  color: "var(--df-accent-warn, #f0a500)",
};

const okStyle: React.CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  color: "var(--df-accent-ok, #5faa54)",
};

function badgeStyle(set: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--df-font-mono)",
    fontSize: 10,
    color: set ? "var(--df-accent-ok, #5faa54)" : "var(--df-text-faint)",
    border: "1px solid var(--df-border-subtle)",
    background: set ? "color-mix(in srgb, var(--df-accent-ok, #5faa54) 12%, transparent)" : "transparent",
    padding: "2px 8px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };
}
