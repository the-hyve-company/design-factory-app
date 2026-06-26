// PreviewSandboxBadge — sandbox-posture indicator.
//
// Tiny informational pill that renders the iframe's current sandbox
// posture. Users see at a glance whether the preview is running in
// strict mode (`allow-scripts` only — the default) or in the
// permissive mode (`allow-scripts allow-same-origin`) needed by the
// older Edit / Comment / VideoTab features.
//
// We keep this read-only on purpose: flipping sandbox at runtime would
// require a full iframe re-mount with state lost. The toggle lives in
// settings or a feature flag; this badge just reflects reality.
//
// The badge is purely visual — no business logic depends on it. If the
// component is missing the canvas still works.

// ─── Sandbox posture resolution (strict by default) ────────────────────────
//
// The artifact preview runs user/model-generated HTML in a sandboxed iframe.
//   strict      → `allow-scripts`                    (DEFAULT)
//   permissive  → `allow-scripts allow-same-origin`  (opt-in)
//
// `allow-same-origin` lets generated HTML share the parent origin — read the
// parent's localStorage (provider tokens), call the daemon's same-origin
// endpoints (/fs/write, /<provider>/stream), open the WS terminal. That
// defeats the sandbox, so it is NO LONGER the default: a prompt-injected
// generation can't silently escape the frame.
//
// Four legacy editor features read `iframe.contentDocument` cross-frame and
// need permissive: inline Edit, Comment-mode click, in-place DOM patch
// (degrades to a full reload when strict), and the VideoTab transport. The
// modern bridges (tweaks, element-overlay, inline-edit channel) use
// postMessage and work under strict. EditorScreen surfaces an actionable
// prompt when the user reaches for a permissive-only feature.
//
// Opt into permissive via `?permissiveSandbox=1` OR `DF_PERMISSIVE_SANDBOX`
// localStorage. (These helpers live here so the posture component and its
// resolution share one source of truth.)

export const PREVIEW_SANDBOX_PERMISSIVE = "allow-scripts allow-same-origin";
export const PREVIEW_SANDBOX_STRICT = "allow-scripts";

export const PERMISSIVE_SANDBOX_STORAGE_KEY = "DF_PERMISSIVE_SANDBOX";
export const PERMISSIVE_SANDBOX_QUERY_PARAM = "permissiveSandbox";

/**
 * Pure decision: which sandbox string applies given the URL query + a storage
 * backend. Strict unless the caller explicitly opted into permissive.
 * Testable without a real `window`.
 */
export function decidePreviewSandbox(opts: {
  search?: string;
  storage?: Pick<Storage, "getItem"> | null;
}): string {
  try {
    const params = new URLSearchParams(opts.search ?? "");
    if (params.get(PERMISSIVE_SANDBOX_QUERY_PARAM) === "1") return PREVIEW_SANDBOX_PERMISSIVE;
    if (opts.storage?.getItem(PERMISSIVE_SANDBOX_STORAGE_KEY) === "1") {
      return PREVIEW_SANDBOX_PERMISSIVE;
    }
  } catch {
    /* private mode / strict CSP → fall through to strict */
  }
  return PREVIEW_SANDBOX_STRICT;
}

/** Resolve the active sandbox posture from the real browser environment. */
export function resolvePreviewSandbox(): string {
  if (typeof window === "undefined") return PREVIEW_SANDBOX_STRICT;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return decidePreviewSandbox({ search: window.location.search, storage });
}

/** True when the given sandbox string carries `allow-same-origin`. */
export function isPermissiveSandbox(sandbox: string): boolean {
  return sandbox.split(/\s+/).filter(Boolean).includes("allow-same-origin");
}

/**
 * Persist the permissive opt-in and reload. Sandbox changes need a fresh
 * iframe mount and the posture is read once at module load, so a reload is
 * the honest way to flip it — the project is route-addressed, nothing is lost
 * beyond the current in-memory canvas mode.
 */
export function enablePermissiveSandboxAndReload(): void {
  try {
    window.localStorage?.setItem(PERMISSIVE_SANDBOX_STORAGE_KEY, "1");
  } catch {
    /* storage unavailable — the query-param path still works if used */
  }
  window.location.reload();
}

interface PreviewSandboxBadgeProps {
  sandbox: string;
  // Optional — if true, render the badge in a "warning" tone to
  // remind contributors that allow-same-origin defeats some isolation.
  warnIfPermissive?: boolean;
}

export function PreviewSandboxBadge({
  sandbox,
  warnIfPermissive = false,
}: PreviewSandboxBadgeProps) {
  const tokens = sandbox.split(/\s+/).filter(Boolean);
  const isStrict = !tokens.includes("allow-same-origin");
  const isPermissive = tokens.includes("allow-same-origin");
  const showWarning = warnIfPermissive && isPermissive;

  const labelTone = showWarning
    ? "var(--df-accent-warn, #f0a500)"
    : isStrict
      ? "var(--df-accent-ok, #5faa54)"
      : "var(--df-text-muted)";

  const label = isStrict ? "sandbox · strict" : "sandbox · permissive";

  return (
    <div
      data-df="sandbox-badge"
      title={`Sandbox: ${tokens.join(" ") || "(empty — most restrictive)"}`}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 10,
        padding: "3px 8px",
        background: "color-mix(in srgb, var(--df-bg-base) 80%, transparent)",
        border: `1px solid ${showWarning ? labelTone : "var(--df-border-subtle)"}`,
        borderRadius: "var(--df-r-sm, 4px)",
        fontFamily: "var(--df-font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: labelTone,
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}
