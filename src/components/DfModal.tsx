import { useCallback, useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg" | "xl";

export interface DfModalProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  onClose: () => void;
  size?: Size;
  title?: ReactNode;
  /** Suppress focus trap + escape key — useful for nested confirmation modals. */
  noTrap?: boolean;
  head?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}

/**
 * Canonical modal. Portal to document.body, backdrop click + Escape close,
 * focus trap on mount, return focus to previously-focused element on
 * unmount. Sizes match the artifact: sm 420, md 560, lg 800, xl 1024.
 */
export function DfModal({
  open,
  onClose,
  size = "md",
  title,
  head,
  foot,
  noTrap = false,
  className,
  children,
  ...rest
}: DfModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (noTrap || e.key !== "Tab" || !modalRef.current) return;
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, noTrap],
  );

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    // First focusable inside modal
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus.current?.focus();
    };
  }, [open, handleKey]);

  if (!open) return null;

  const classes = ["df-modal", `df-modal--${size}`, className].filter(Boolean).join(" ");

  return createPortal(
    <div
      className="df-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        {...rest}
      >
        {head ??
          (title && (
            <div className="df-modal-head">
              <div id={titleId} className="df-modal-title">
                {title}
              </div>
              <button className="close" type="button" onClick={onClose} aria-label="Close dialog">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        <div className="df-modal-body">{children}</div>
        {foot && <div className="df-modal-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}
