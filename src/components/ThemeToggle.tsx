export interface ThemeToggleProps {
  theme: "dark" | "light";
  onChange: (theme: "dark" | "light") => void;
  /** Optional compact modifier if topbar runs tight. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Icon-only theme toggle. Sun when dark (click → light), moon when light
 * (click → dark). Drops into any topbar right-side slot. Uses .df-btn--ghost
 * + .df-btn--icon so it blends with other topbar icon buttons.
 */
export function ThemeToggle({ theme, onChange, size = "md", className }: ThemeToggleProps) {
  const next = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const classes = ["df-theme-toggle", `df-theme-toggle--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      type="button"
      title={label}
      aria-label="Toggle theme"
      onClick={() => onChange(next)}
    >
      {theme === "dark" ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
