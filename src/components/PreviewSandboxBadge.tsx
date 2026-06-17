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
