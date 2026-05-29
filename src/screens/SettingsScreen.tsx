import { useState, useEffect, useMemo } from "react";
import { Logo } from "@/components/Logo";
import { db, readGlobalConfig, writeGlobalConfig } from "@/lib/claude-bridge";
import { useT, setLang, type Lang } from "@/i18n";
import { PROVIDERS, probeAllProviders } from "@/providers/registry";
import { type ProviderId, type ProviderStatusReport } from "@/providers/types";
import { InsumosPanel, type InsumoTab } from "@/components/InsumosPanel";
// DS components panel removed from Settings nav (user: "pagina de
// componentes podemos apagar"). Vercel publish + GitHub auth removed
// from Settings → Providers — users authenticate via `vercel login` /
// `gh auth` in the terminal directly when they need those flows
// (VercelPublishCard / GithubProviderCard exports in
// ProviderTokenInline.tsx are marked DEPRECATED and no longer rendered).
import { InlineProviderToken } from "@/components/ProviderTokenInline";
import { ColorPickerPopover } from "@/components/dfds";
import "@/styles/settings-appearance.css";

interface SettingsScreenProps {
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  onBack: () => void;
  /** Short label shown on the Back button, e.g. "Back to home" or "Back to Teste". */
  returnLabel?: string;
  /** URL-driven active sub-tab. When absent, defaults to "agents-workspace"
   *  (the workspace picker — the most useful first-run section). */
  section?: string;
  /** Called when user clicks a sub-tab; App wraps it in navigate(). */
  onSectionChange?: (section: NavItem) => void;
}

// Settings pared down to surfaces the Home tabs don't already cover:
// - appearance → removed (theme toggle lives in the topbar)
// - skills → removed (custom folder input moved into the Skills tab)
// - design-systems → removed (managed directly from the DS tab)
// - agents-workspace → removed (workspace pinned to the design-factory repo root)
// - components (DFDSPanel) → removed (user: "pagina de componentes
//   podemos apagar"). Legacy /settings/components URL redirects to
//   providers (the default landing tab).
// Canvas + Formats + Rules collapsed into "insumos"
// (one entry, internal sub-tabs). Legacy URLs /settings/canvas|formats|
// rules redirect to /settings/insumos and remember which sub-tab to show.
// Appearance refactor — editorial layout with Direções
// block + 4 subgroups (Tema, Cores, Idioma, Tema editor avançado as
// disclosure). Skeu reduced. Mirrors Padrões pattern.
type NavItem =
  | "providers"
  | "appearance"
  | "defaults";

const VALID_NAV: NavItem[] = [
  "providers",
  "appearance",
  "defaults",
];

/** Legacy slugs surface as /settings/canvas, /settings/formats,
 *  /settings/rules, /settings/built-ins, /settings/commands, and
 *  /settings/insumos (PT slug retired 2026-05-18). All redirect to
 *  /settings/defaults with the desired sub-tab stashed. */
const LEGACY_DEFAULTS_TAB: Record<string, InsumoTab> = {
  canvas:      "canvas",
  formats:     "formats",
  rules:       "rules",
  taste:       "taste",
  commands:    "commands",
  prompts:     "prompts",
  "built-ins": "prompts",
  insumos:     "canvas",
};

function parseSection(raw: string | undefined): NavItem {
  if (!raw) return "providers";
  if (raw === "insumos") return "defaults";
  if (raw in LEGACY_DEFAULTS_TAB) return "defaults";
  // legacy /settings/components → redirect to default (providers).
  if (raw === "components") return "providers";
  if ((VALID_NAV as string[]).includes(raw)) return raw as NavItem;
  return "providers";
}

function parseInsumosTab(raw: string | undefined): InsumoTab {
  if (raw && raw in LEGACY_DEFAULTS_TAB) return LEGACY_DEFAULTS_TAB[raw];
  return "canvas";
}

// Built-in prompt definitions moved to BuiltinPromptsPanel.

export function SettingsScreen({ theme, onThemeChange, onBack, returnLabel, section, onSectionChange }: SettingsScreenProps) {
  const { t, lang } = useT();
  const nav: NavItem = parseSection(section);
  // when section URL is "canvas"|"formats"|"rules" we resolve to
  // insumos + the corresponding sub-tab. The InsumosPanel keeps its own
  // sub-tab state so deep-linking continues to work after the consolidation.
  const insumosInitialTab = parseInsumosTab(section);
  const [insumosTab, setInsumosTab] = useState<InsumoTab>(insumosInitialTab);
  // Sync local state when URL section changes (e.g. user navigates via
  // back/forward). parseInsumosTab maps both legacy + canonical slugs.
  useEffect(() => {
    setInsumosTab(parseInsumosTab(section));
  }, [section]);

  // Persist language to filesystem config + DB mirror, then call setLang()
  // which dispatches the window event so all useT() consumers re-render.
  const handleLangChange = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    void writeGlobalConfig({ language: next }).catch(() => {});
    void db.setSetting("language", next).catch(() => {});
  };
  const setNav = (next: NavItem) => {
    onSectionChange?.(next);
  };
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>("claude");
  const [providerStatus, setProviderStatus] = useState<Record<ProviderId, ProviderStatusReport> | null>(null);
  const [probing, setProbing] = useState(false);
  const [accentColor, setAccentColor] = useState<string>("#8ab06b");

  const refreshProviders = async () => {
    setProbing(true);
    try {
      const next = await probeAllProviders();
      setProviderStatus(next);
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    (async () => {
      // Filesystem config is canonical — DB mirror used only if bridge is
      // offline / Tauri hasn't wired /config yet.
      const fromFs = await readGlobalConfig();
      const raw = fromFs?.default_provider
        ?? (await db.getSetting("default_provider").catch(() => null));
      if (raw === "claude") setDefaultProvider(raw);
      // Built-in prompt overrides: filesystem stores them together under
      // builtin_prompts; DB still uses the old per-key format
      // ("builtin_prompt:{id}") as fallback.
      const next: Record<string, string> = {};
      // Built-in prompt overrides moved into BuiltinPromptsPanel — it
      // hydrates them itself. Map building above kept for compatibility
      // with callers not yet ported (none currently).
      void next;
      // Accent color (single user-controlled accent)
      const accent =
        (fromFs?.accent_color as string | undefined) ??
        (await db.getSetting("accent_color").catch(() => null));
      if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
        setAccentColor(accent);
      }
    })();
    void refreshProviders();
  }, []);

  // Handler — persist accent + apply to documentElement immediately
  const handleAccentChange = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setAccentColor(hex);
    document.documentElement.style.setProperty("--df-accent-user", hex);
    void writeGlobalConfig({ accent_color: hex }).catch(() => {});
    db.setSetting("accent_color", hex).catch(() => {});
  };
  const handleAccentReset = () => {
    setAccentColor("#8ab06b");
    document.documentElement.style.removeProperty("--df-accent-user");
    void writeGlobalConfig({ accent_color: "" }).catch(() => {});
    db.setSetting("accent_color", "").catch(() => {});
  };

  // Folder pickers + skills/DS handlers live in the tabs that own those
  // surfaces now (Home > Skills, Home > Design systems). Kept the modes
  // editor + providers + built-ins + shortcuts here — those don't have a
  // dedicated home yet.

  // Built-in prompt handlers moved to BuiltinPromptsPanel.

  return (
    <div className="screen" data-active="true">
      <div className="settings">
        {/* SIDEBAR */}
        <aside className="settings-sidebar" style={{ display: "flex", flexDirection: "column" }}>
          <Logo size={36} className="settings-mark" />
          <nav className="settings-nav" style={{ flex: 1 }}>
            {(
              [
                { id: "providers", label: t("settings.nav.providers") },
                { id: "appearance", label: t("settings.nav.appearance") },
                { id: "defaults", label: t("settings.insumos.title") },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                className="df-nav-item"
                aria-selected={nav === item.id}
                onClick={() => setNav(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Footer: single back button for the whole settings screen */}
          <button
            onClick={onBack}
            className="settings-back"
            title={t("settings.back")}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 14px",
              margin: "8px 10px 10px",
              background: "transparent",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: "var(--df-r-sm)",
              color: "var(--df-text-secondary)",
              fontSize: 11,
              fontFamily: "var(--df-font-mono)",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--df-interactive-hover)"; e.currentTarget.style.color = "var(--df-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--df-text-secondary)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {returnLabel ?? t("settings.back")}
            </span>
          </button>
        </aside>

        {/* MAIN */}
        <main className="settings-main">

          {nav === "providers" && (
            <ProvidersPanel
              defaultProvider={defaultProvider}
              providerStatus={providerStatus}
              probing={probing}
              onRefresh={refreshProviders}
              onSetDefault={(id) => {
                setDefaultProvider(id);
                void writeGlobalConfig({ default_provider: id as any }).catch(() => {});
                db.setSetting("default_provider", id).catch(() => {});
              }}
            />
          )}



          {nav === "appearance" && (
            <section className="settings-page appearance-panel" aria-label={t("settings.appearance.title")}>
              <h1 className="settings-title">{t("settings.appearance.title")}</h1>
              <p className="settings-group-sub">
                {t("settings.appearance.subtitle")}
              </p>

              {/* Directions block dropped from Settings pages.
                  Strings preserved in i18n for potential reuse. */}

              {/* ── 1. Tema (theme toggle) ──────────────────────────── */}
              <div className="appearance-group">
                <div className="appearance-group-head">
                  <h2 className="appearance-group-title">{t("settings.appearance.theme.title")}</h2>
                </div>
                <p className="appearance-group-sub">{t("settings.appearance.theme.subtitle")}</p>
                <div className="appearance-theme-toggle" role="group" aria-label={t("settings.appearance.theme.title")}>
                  <button
                    type="button"
                    className="appearance-theme-chip"
                    aria-pressed={theme === "dark"}
                    onClick={() => { if (theme !== "dark") onThemeChange("dark"); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    <span>{t("settings.appearance.theme.dark")}</span>
                  </button>
                  <button
                    type="button"
                    className="appearance-theme-chip"
                    aria-pressed={theme === "light"}
                    onClick={() => { if (theme !== "light") onThemeChange("light"); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                    <span>{t("settings.appearance.theme.light")}</span>
                  </button>
                </div>
              </div>

              {/* ── 2. Cores (accent color) ─────────────────────────── */}
              <div className="appearance-group">
                <div className="appearance-group-head">
                  <h2 className="appearance-group-title">{t("settings.appearance.accent.title")}</h2>
                </div>
                <p className="appearance-group-sub">{t("settings.appearance.accent.body")}</p>

                {/* Preset swatches grid removed 2026-05-21 — user ask:
                    "remova a fileira (...) deixe so o hex custom". The
                    8 i18n keys still live in strings.ts in case we need
                    to surface presets again. */}
                <div className="appearance-accent-custom">
                  <span className="appearance-accent-custom-label">
                    {t("settings.appearance.accent.custom")}
                  </span>
                  <ColorPickerPopover
                    value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#8ab06b"}
                    onChange={handleAccentChange}
                    onReset={handleAccentReset}
                  />
                </div>
              </div>

              {/* ── 3. Idioma — app-wide language toggle ────────────── */}
              <div className="appearance-group">
                <div className="appearance-group-head">
                  <h2 className="appearance-group-title">{t("settings.appearance.language.title")}</h2>
                </div>
                <p className="appearance-group-sub">{t("settings.appearance.language.subtitle")}</p>
                <div
                  className="appearance-lang-group"
                  role="radiogroup"
                  aria-label={t("settings.appearance.language.title")}
                >
                  {((): readonly Lang[] => {
                    // `xx` is the pseudo-locale: DEV-only debug option that
                    // wraps every translated string with ⟨…⟩ markers.
                    const showDebug = import.meta.env.DEV;
                    return showDebug
                      ? (["pt", "en", "xx"] as const)
                      : (["pt", "en"] as const);
                  })().map((opt) => {
                    const active = lang === opt;
                    const labelKey = opt === "pt"
                      ? "settings.appearance.language.pt"
                      : opt === "en"
                      ? "settings.appearance.language.en"
                      : "settings.appearance.language.xx";
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className="appearance-lang-chip"
                        onClick={() => handleLangChange(opt)}
                      >
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Advanced theme editor disclosure dropped from the
                  current public surface. Three groups remain — Tema,
                  Cores, Idioma. */}
            </section>
          )}

          {nav === "defaults" && (
            <InsumosPanel
              tab={insumosTab}
              onTabChange={(next) => {
                setInsumosTab(next);
                // Persist to URL by routing to /settings/defaults so the
                // section parser still recognizes the canonical slug
                // even when sub-tabs swap.
                onSectionChange?.("defaults" as never);
              }}
            />
          )}

        </main>
      </div>

    </div>
  );
}

// ─── Providers helpers ─────────────────────────────────────────────────────


function ProviderDetail({ detail }: { detail: string }) {
  const { t } = useT();
  // Detail strings from the bridge/Rust probes typically contain shell commands
  // wrapped in backticks (e.g. "Install with `npm i -g @openai/codex`."). Render
  // those runs as a copy-on-click chip so the user doesn't have to hunt for the
  // command. The rest of the string stays as prose.
  const [copied, setCopied] = useState<string | null>(null);
  const parts = useMemo(() => {
    const out: Array<{ kind: "text" | "code"; value: string }> = [];
    const re = /`([^`]+)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(detail))) {
      if (m.index > last) out.push({ kind: "text", value: detail.slice(last, m.index) });
      out.push({ kind: "code", value: m[1] });
      last = m.index + m[0].length;
    }
    if (last < detail.length) out.push({ kind: "text", value: detail.slice(last) });
    return out;
  }, [detail]);

  const handleCopy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      setTimeout(() => setCopied((cur) => (cur === cmd ? null : cur)), 1600);
    } catch {}
  };

  return (
    <div style={{
      fontSize: "var(--df-text-xs)",
      color: "var(--df-text-muted)",
      background: "var(--df-surface-elevated)",
      border: "1px solid var(--df-border-subtle)",
      borderRadius: "var(--df-r-sm)",
      padding: "8px 10px",
      marginBottom: 10,
      lineHeight: 1.5,
    }}>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.value}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => void handleCopy(part.value)}
            title={copied === part.value ? t("settings.providers.copy.copied") : t("settings.providers.copy.title")}
            style={{
              display: "inline-block",
              fontFamily: "var(--df-font-mono)",
              fontSize: 11,
              color: "var(--df-text-primary)",
              background: copied === part.value
                ? "rgba(220,234,208,0.26)"
                : "var(--df-surface-raised)",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: 4,
              padding: "1px 6px",
              margin: "0 2px",
              cursor: "pointer",
              verticalAlign: "baseline",
            }}
          >
            {copied === part.value ? `${t("settings.providers.copy.copied").toLowerCase()} · ` : ""}{part.value}
          </button>
        )
      )}
    </div>
  );
}

// ─── ProvidersPanel — redesign ────────────────────────────────────
//
// User spec 2026-05-05: "pagina de providers em settings ta confusa
// e crowded queria repensar design dela pra ser mais imples e direta
// ao ponto, melhor ux e ui".
//
// Anatomy:
//   · Single section header (kicker + title + check-again button row).
//   · Vertical list of provider rows — NO category sub-groupings inline.
//     The CLIs/API/Local distinction is signaled via a small mono tag
//     in the row itself (right of name) instead of separate headers.
//   · Each row: dot · name · type-tag · status pill · chevron · CTA.
//   · Click row to expand → blurb + detail + InlineProviderToken (for
//     API key providers). Default state is COLLAPSED — the panel reads
//     as a clean list at first glance.
//   · Default provider always pinned to top of the list so the user
//     sees their active choice immediately.
//
// Visual hierarchy: connected (green dot) > needs-auth (warn) >
// not-installed (faint) > unknown. Same status color logic as before
// but rows are sorted so the "live" providers cluster at top.
interface ProvidersPanelProps {
  defaultProvider: ProviderId;
  providerStatus: Record<ProviderId, ProviderStatusReport> | null;
  probing: boolean;
  onRefresh: () => void | Promise<void>;
  onSetDefault: (id: ProviderId) => void;
}

function ProvidersPanel({ defaultProvider, providerStatus, probing, onRefresh, onSetDefault }: ProvidersPanelProps) {
  const { t, tf } = useT();
  const [expandedId, setExpandedId] = useState<ProviderId | null>(null);

  // Categorize providers via meta.id whitelists. Used to label each row.
  const PROVIDER_TYPE: Record<string, "cli" | "api" | "local"> = {
    claude: "cli", codex: "cli", gemini: "cli", opencode: "cli", kimi: "cli",
    anthropic: "api", openai: "api",
    "gemini-api": "api", openrouter: "api",
    ollama: "local",
  };

  // Visible-in-Settings whitelist — mirrors AgentPicker + the daemon
  // registry. V1 beta roster (10 entries). Removed in cleanup
  // 2026-05-15: cursor, copilot, qwen, deepseek.
  const VISIBLE_IN_SETTINGS = new Set([
    "claude", "codex", "gemini", "opencode",
    "kimi", "anthropic", "openai", "gemini-api", "openrouter",
    "ollama",
  ]);

  // Sort: default first, then connected, then by status priority.
  const orderedProviders = useMemo(() => {
    const STATUS_RANK: Record<string, number> = {
      connected: 0,
      "needs-auth": 1,
      "not-installed": 2,
      unknown: 3,
    };
    return [...PROVIDERS]
      .filter((p) => VISIBLE_IN_SETTINGS.has(p.meta.id))
      .sort((a, b) => {
        if (a.meta.id === defaultProvider) return -1;
        if (b.meta.id === defaultProvider) return 1;
        const aStatus = providerStatus?.[a.meta.id]?.status ?? "unknown";
        const bStatus = providerStatus?.[b.meta.id]?.status ?? "unknown";
        return (STATUS_RANK[aStatus] ?? 99) - (STATUS_RANK[bStatus] ?? 99);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerStatus, defaultProvider]);

  return (
    <section className="settings-page" aria-label={t("settings.providers.title")}>
      <h1 className="settings-title">{t("settings.providers.title")}</h1>

      <section className="settings-group" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="providers-v13-head">
          <p className="settings-group-sub" style={{ margin: 0, maxWidth: 560 }}>
            {t("settings.providers.lede")}
          </p>
          <button
            className="df-btn df-btn--secondary"
            onClick={() => void onRefresh()}
            disabled={probing}
            style={{ fontSize: "var(--df-text-xs)" }}
          >
            {probing ? t("settings.providers.checking") : t("settings.providers.checkagain")}
          </button>
        </div>

        <div className="providers-v13-list">
          {orderedProviders.map((p) => {
            const report = providerStatus?.[p.meta.id];
            const isConnected = report?.status === "connected";
            const active = defaultProvider === p.meta.id;
            const expanded = expandedId === p.meta.id;
            const type = PROVIDER_TYPE[p.meta.id] ?? "cli";
            const statusLabel =
              report?.status === "connected"
                ? (report.version ? `${t("settings.providers.status.ready")} · v${report.version}` : t("settings.providers.status.ready"))
                : report?.status === "not-installed"
                  ? t("settings.providers.status.notinstalled")
                  : report?.status === "needs-auth"
                    ? t("settings.providers.status.needsauth")
                    : t("settings.providers.status.checking");
            const tagLabel = type === "cli" ? t("settings.providers.tag.cli") : type === "api" ? t("settings.providers.tag.api") : t("settings.providers.tag.local");

            return (
              <div key={p.meta.id} className={`provider-v13${active ? " is-active" : ""}${expanded ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="provider-v13-row"
                  onClick={() => setExpandedId(expanded ? null : p.meta.id)}
                  aria-expanded={expanded}
                >
                  <span className={`provider-dot${isConnected ? " is-on" : ""}`} aria-hidden="true" />
                  <span className="provider-v13-name">{p.meta.label}</span>
                  <span className={`provider-v13-tag provider-v13-tag--${type}`} aria-label={tf("settings.providers.tag.aria", tagLabel)}>
                    {tagLabel}
                  </span>
                  {active && <span className="provider-default-pill">{t("settings.providers.default.pill")}</span>}
                  <span className={`provider-status provider-status--${report?.status ?? "unknown"}`}>
                    {statusLabel}
                  </span>
                  <span className="provider-v13-chev" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 160ms var(--df-ease-out)" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>

                {expanded && (
                  <div className="provider-v13-detail">
                    <p className="provider-v13-blurb">{p.meta.blurb}</p>
                    {report?.detail && !isConnected && <ProviderDetail detail={report.detail} />}
                    {(p.meta.id === "anthropic" || p.meta.id === "openrouter" || p.meta.id === "openai" || p.meta.id === "gemini-api" || p.meta.id === "kimi") && (
                      <InlineProviderToken provider={p.meta.id} onSaved={() => void onRefresh()} />
                    )}
                    <div className="provider-v13-actions">
                      <button
                        className={active ? "df-btn df-btn--secondary" : "df-btn df-btn--primary"}
                        disabled={!isConnected || active}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetDefault(p.meta.id);
                        }}
                        title={!isConnected ? t("settings.providers.cta.unavailable.title") : undefined}
                        style={{ fontSize: "var(--df-text-xs)", minWidth: 96 }}
                      >
                        {active ? t("settings.providers.cta.selected") : isConnected ? t("settings.providers.cta.usethis") : t("settings.providers.cta.unavailable")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* VercelPublishCard + GithubProviderCard removed. Vercel publish
          and GitHub auth are not part of the current public surface. */}
    </section>
  );
}

