// PickerKey — unified trigger key shared by Canvas, Formato, Regras
// (and any future external picker added to the form).
//
// One template — same skeu bezel, same accent-dot LED. The dot is the
// "configured" indicator: empty bowl when no pick, filled with
// --df-accent when something is picked. Shares the cnp-trigger-dot
// class for CSS reuse.
//
// Layout (left → right):
//   [label/value · accent LED]

import { forwardRef, type ReactNode } from "react";

export interface PickerKeyProps {
  /** Visible label / current value. Truncates with ellipsis. */
  label: ReactNode;
  /** Whether to show the active accent dot (caller decides what "active" means). */
  active: boolean;
  /** Click handler. */
  onClick: () => void;
  /** Optional ARIA label override (used when label is JSX with mixed content). */
  ariaLabel?: string;
  /** Optional className extension (rare; reserved for site-specific tweaks). */
  className?: string;
  /** Optional `disabled` flag — same behavior as a native button. */
  disabled?: boolean;
  /** Optional id for label association. */
  id?: string;
}

/**
 * Unified picker trigger key. One bezel pattern, one accent-dot LED.
 *
 * Visual is provided by `.cnp-picker-key` in np-canonical-plus.css. The
 * component is intentionally thin — all skeu state lives in CSS so a
 * theme tweak doesn't require a TS edit.
 */
export const PickerKey = forwardRef<HTMLButtonElement, PickerKeyProps>(function PickerKey(
  { label, active, onClick, ariaLabel, className, disabled, id },
  ref,
) {
  const cls = `cnp-picker-key${active ? " is-on" : ""}${className ? ` ${className}` : ""}`;
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
    >
      <span className="cnp-picker-key-label">{label}</span>
      {/* Accent dot LED — empty bowl when not picked, fills with
       * --df-accent when configured. Shares cnp-trigger-dot for CSS. */}
      <span className="cnp-picker-key-dot cnp-trigger-dot" aria-hidden />
    </button>
  );
});
