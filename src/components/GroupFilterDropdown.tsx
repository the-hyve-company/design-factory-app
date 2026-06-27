// GroupFilterDropdown — premium custom select that replaces the row of group
// filter pills in TaxonomyManager (rules / canvas presets / formats). A native
// <select> looks like the OS, not the app; this is a skeu-consistent trigger +
// floating menu with count badges, a check on the active option, full keyboard
// nav (↑/↓/Home/End/Enter/Esc), click-outside and roving focus.
//
// Stateless about WHAT it filters — the parent owns `value`/`onChange`; this
// only renders the control. Used wherever TaxonomyManager has >1 group.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface GroupFilterOption {
  /** null = the "all" pseudo-option (no filter). */
  id: string | null;
  label: string;
  count: number;
  hint?: string;
}

interface Props {
  options: GroupFilterOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  /** aria-label for the control (e.g. "Filter by category"). */
  ariaLabel: string;
}

export function GroupFilterDropdown({ options, value, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const selected = options[selectedIdx] ?? options[0];

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // On open: seed the active row to the current selection and move focus into
  // the list so arrow keys work immediately.
  useEffect(() => {
    if (!open) return;
    setActiveIdx(selectedIdx);
    listRef.current?.focus();
  }, [open, selectedIdx]);

  const commit = (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIdx);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="tx-mgr-group-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`tx-mgr-group-select-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="tx-mgr-group-select-value">{selected?.label}</span>
        <span className="tx-mgr-group-select-count">{selected?.count}</span>
        <svg
          className="tx-mgr-group-select-chevron"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          className="tx-mgr-group-menu"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${baseId}-opt-${activeIdx}`}
          onKeyDown={onListKey}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.id === value;
            const isActive = idx === activeIdx;
            return (
              <li
                key={opt.id ?? "__all__"}
                id={`${baseId}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                title={opt.hint}
                className={`tx-mgr-group-option${isActive ? " is-active" : ""}${
                  isSelected ? " is-selected" : ""
                }`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => commit(idx)}
              >
                <span className="tx-mgr-group-option-check" aria-hidden="true">
                  {isSelected ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : null}
                </span>
                <span className="tx-mgr-group-option-label">{opt.label}</span>
                <span className="tx-mgr-group-option-count">{opt.count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
