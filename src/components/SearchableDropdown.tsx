// SearchableDropdown.tsx — reusable searchable picker.
//
// Designed so it scales to hundreds of options (e.g. design system
// pickers, OpenRouter-style model lists) and gives the app a single
// canonical dropdown shape.
//
// Anatomy (matches OpenRouter model picker):
//   · Trigger pill — host renders. We render the popover.
//   · Popover — anchored absolute below trigger. 280px min, auto height,
//     max ~400px so >8 items scroll without ballooning the page.
//   · Search input — sticky top, autoFocus on open. Fuzzy match on
//     option label + optional `searchText` payload (e.g. tags, slug).
//   · List — virtualized only via `max-height + overflow-y: auto`. We
//     don't pull a virtualization lib for sub-1000-item lists.
//   · Highlight — keyboard ↑↓ moves a highlight. Enter picks. ESC closes.
//   · Empty state — "Nenhum resultado para …" with the query echoed.
//   · Selected indicator — bolinha accent + checkmark on the right.
//   · Animation — 160ms scale(0.98)→1 + opacity. Respects
//     prefers-reduced-motion (set in CSS, no JS check).
//
// Reusability:
//   · Props are generic over `<T>` so the host can store any record
//     and we only need an `id` + `label` + optional `subLabel`/`leading`.
//   · Headless-ish: trigger is a slot the host owns. We expose `open`,
//     `onClose`, `triggerRef` so the host can position the popover and
//     manage outside-click together with its own buttons.
//   · No CSS-in-JS — all styling lives in `searchable-dropdown.css`.
//
// IDS: SEARCH performed across `src/components/`, `src/screens/`. No
// existing reusable searchable-dropdown found. The existing
// `ScreenModelMenu` in `NewProjectFormSkeu.tsx` had inline search markup
// that I considered ADAPTING, but it (a) doesn't expose keyboard nav,
// (b) renders inside an already-positioned parent menu, and (c) couples
// to provider/model option types. Decision: CREATE a generic component
// + migrate `ScreenModelMenu` and the `DsDropdown` to use it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@/styles/searchable-dropdown.css";

// extracted item renderer so the grouped-list branch can reuse it
// without duplicating markup. Lives at module scope to keep refs stable.
function renderItem<T>(
  it: SearchableDropdownItem<T>,
  idx: number,
  selectedId: string | null | undefined,
  highlightIdx: number,
  role: "listbox" | "menu",
  onPick: (it: SearchableDropdownItem<T>) => void,
  setHighlightIdx: (n: number) => void,
) {
  const isSelected = it.id === selectedId;
  const isHighlighted = idx === highlightIdx;
  const cls = [
    "sd-pop-opt",
    isSelected ? "is-selected" : "",
    isHighlighted ? "is-highlighted" : "",
    it.footerAction ? "sd-pop-opt--footer" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      key={it.id}
      type="button"
      role={role === "listbox" ? "option" : "menuitem"}
      aria-selected={role === "listbox" ? isSelected : undefined}
      data-sd-idx={idx}
      className={cls}
      onClick={() => onPick(it)}
      onMouseEnter={() => setHighlightIdx(idx)}
    >
      {it.leading && (
        <span className="sd-pop-opt-leading" aria-hidden>
          {it.leading}
        </span>
      )}
      <span className="sd-pop-opt-text">
        <span className="sd-pop-opt-label">{it.label}</span>
        {it.sub && <span className="sd-pop-opt-sub">{it.sub}</span>}
      </span>
      {isSelected && !it.footerAction && (
        <span className="sd-pop-opt-check" aria-hidden>
          ✓
        </span>
      )}
      {it.footerAction && (
        <span className="sd-pop-opt-caret" aria-hidden>
          ›
        </span>
      )}
    </button>
  );
}

export interface SearchableDropdownItem<T = unknown> {
  /** Stable id — used for `key` and selection. */
  id: string;
  /** Visible label (rendered prominently). */
  label: string;
  /** Optional sub-line (rendered muted under label). */
  sub?: string;
  /** Optional leading slot (swatches, dot, icon) rendered before the label. */
  leading?: ReactNode;
  /** Optional extra search corpus (tags, slug, kbd shortcuts). */
  searchText?: string;
  /** Original payload — opaque to the dropdown, returned verbatim to onPick. */
  payload?: T;
  /** Mark this row as a special "footer" action (e.g. "View more"). Pinned to
   *  bottom of the list, never filtered, rendered with caret. */
  footerAction?: boolean;
  /** optional group key. When ≥1 item carries a group, the list
   *  renders sticky group headers (`groupLabel` from the items map).
   *  Items without a group fall under an implicit empty group rendered
   *  before any labeled group. */
  group?: string;
  /** display label for the group header. Use the same value across
   *  all items that share a group key. */
  groupLabel?: string;
}

export interface SearchableDropdownProps<T = unknown> {
  /** Whether the popover is shown. Host owns this state. */
  open: boolean;
  /** Called when the popover should close (outside click, ESC, pick). */
  onClose: () => void;
  /** All selectable items. */
  items: SearchableDropdownItem<T>[];
  /** Currently selected item id (or null). */
  selectedId?: string | null;
  /** Picker callback — receives the full item including payload. */
  onPick: (item: SearchableDropdownItem<T>) => void;
  /** i18n placeholder for the search input. */
  searchPlaceholder?: string;
  /** i18n empty-state text. `{query}` placeholder is replaced. */
  emptyTemplate?: string;
  /** Aria role for the list. Default `listbox`. */
  role?: "listbox" | "menu";
  /** Aria label for the popover container. */
  ariaLabel?: string;
  /** Threshold below which the search input is hidden. Default 6. */
  searchThreshold?: number;
  /** Width of the popover. Default 280. Use "trigger" to match the trigger. */
  width?: number | "trigger";
  /** Anchor side relative to trigger. Default "bottom-start".
   *  `top-*` opens upward (composer toolbar context). */
  anchor?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Optional className on the popover root. */
  className?: string;
  /** Optional clear button row (rendered between search and list). */
  onClear?: () => void;
  /** Label for clear button. Default "Limpar". */
  clearLabel?: string;
  /** Ref to the popover element — host can use it for outside-click logic. */
  popoverRef?: React.RefObject<HTMLDivElement>;
  /** Ref to the trigger element. When provided, the popover renders via
   *  React Portal into document.body and uses computed fixed coordinates
   *  relative to this trigger — escapes ALL parent `overflow: hidden`
   *  / stacking-context traps (np-modal-card has overflow: hidden +
   *  transform animation, which used to clip the DS / Model rocker
   *  popovers). When omitted, behaves like the legacy inline absolute
   *  positioning. */
  triggerRef?: React.RefObject<HTMLElement>;
}

export function SearchableDropdown<T = unknown>({
  open,
  onClose,
  items,
  selectedId,
  onPick,
  searchPlaceholder = "Buscar…",
  emptyTemplate = 'Nenhum resultado para "{query}"',
  role = "listbox",
  ariaLabel,
  searchThreshold = 6,
  width = 280,
  anchor = "bottom-start",
  className,
  onClear,
  clearLabel = "Limpar",
  popoverRef,
  triggerRef,
}: SearchableDropdownProps<T>) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset query + highlight whenever the popover closes/reopens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightIdx(0);
    } else {
      // Defer so the popover renders before we focus.
      requestAnimationFrame(() => {
        try {
          inputRef.current?.focus();
        } catch {
          /* ignore */
        }
      });
    }
  }, [open]);

  // Filter — case-insensitive substring on label + sub + searchText.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const footers = items.filter((it) => it.footerAction);
    const body = items.filter((it) => !it.footerAction);
    if (!q) return [...body, ...footers];
    const matched = body.filter((it) => {
      const corpus = `${it.label} ${it.sub ?? ""} ${it.searchText ?? ""}`.toLowerCase();
      return corpus.includes(q);
    });
    return [...matched, ...footers];
  }, [query, items]);

  // Keep highlight in range when filter shrinks the list.
  useEffect(() => {
    if (highlightIdx >= filtered.length) {
      setHighlightIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIdx]);

  // Scroll the highlighted item into view (mid-list nav).
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-sd-idx="${highlightIdx}"]`);
    if (el) {
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        /* ignore */
      }
    }
  }, [highlightIdx, open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[highlightIdx];
      if (it) onPick(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlightIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlightIdx(filtered.length - 1);
    }
  };

  // Compute popover coordinates relative to the trigger when the host
  // opts into portal mode by passing `triggerRef`. We re-measure on
  // open / window resize / scroll so the popover tracks the trigger
  // even if the modal scrolls internally. coords are in viewport
  // space → used with `position: fixed` to escape overflow:hidden +
  // transform containing blocks (np-modal-card has BOTH).
  const [portalCoords, setPortalCoords] = useState<{
    top: number;
    left: number;
    triggerWidth: number;
  } | null>(null);
  // User ask 2026-05-21: "drop de modelos ta abrindo no lugar
  // errado deslocado". Previous logic used a hardcoded popH=380 (the
  // CSS max-height) and clamped negative tops to 8 — so when the
  // popover couldn't fit above the trigger (chat input is at the
  // bottom of the viewport, anchor="top-start", trigger sits ~50px
  // from the viewport bottom), the algorithm placed the popover at
  // the top of the screen instead of next to the trigger. Now:
  //   • Measure the real popover height once it mounts via popoverElRef
  //     + ResizeObserver (falls back to 380 on first paint).
  //   • If the requested anchor doesn't fit, flip side automatically
  //     instead of clamping into the corner.
  // User repro 2026-05-21 (round 2): the previous fix still let
  // the user see a one-frame flash at the wrong position. The
  // popover renders with popH=380 (the CSS max-height fallback)
  // before the ResizeObserver fires and corrects the placement.
  // Now we hold the popover at `opacity:0` until the height has
  // been measured at least once; the placement pass that follows
  // sees the real number and writes the final coords before the
  // user sees anything.
  const popoverElRef = useRef<HTMLDivElement | null>(null);
  const [popH, setPopH] = useState(380);
  const [hasMeasured, setHasMeasured] = useState(false);
  useLayoutEffect(() => {
    if (!open) {
      setHasMeasured(false);
      return;
    }
    if (!popoverElRef.current) return;
    const el = popoverElRef.current;
    const update = () => {
      const h = el.offsetHeight;
      if (h > 0) {
        setPopH(h);
        setHasMeasured(true);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef?.current) {
      setPortalCoords(null);
      return;
    }
    const measure = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const requestUpward = anchor.startsWith("top");
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      // Auto-flip when the requested side can't fit but the opposite can.
      const opensUpward = requestUpward
        ? spaceAbove >= popH + 14 || spaceAbove >= spaceBelow
        : !(spaceBelow >= popH + 14 || spaceBelow >= spaceAbove);
      const top = opensUpward
        ? Math.max(8, rect.top - popH - 6)
        : Math.min(window.innerHeight - popH - 8, rect.bottom + 6);
      const popoverW = width === "trigger" ? rect.width : Number(width);
      const isEndAnchor = anchor.endsWith("end");
      let left = isEndAnchor ? rect.right - popoverW : rect.left;
      // Clamp into viewport (8px safe margin on both sides).
      const minLeft = 8;
      const maxLeft = window.innerWidth - popoverW - 8;
      left = Math.min(Math.max(left, minLeft), maxLeft);
      setPortalCoords({ top, left, triggerWidth: rect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, triggerRef, anchor, width, popH]);

  if (!open) return null;

  const showSearch = items.length >= searchThreshold;
  const portalActive = !!triggerRef && !!portalCoords;
  const widthStyle: React.CSSProperties = portalActive
    ? {
        width: width === "trigger" ? portalCoords.triggerWidth : Number(width),
      }
    : width === "trigger"
      ? { width: "100%" }
      : { width: `${width}px` };
  const portalStyle: React.CSSProperties = portalActive
    ? {
        position: "fixed",
        top: portalCoords.top,
        left: portalCoords.left,
        // High enough to clear any in-modal stacking context. fixed
        // positioning + portal-to-body sidesteps the parent stacking
        // walls, but we still want a sane z-order vs the modal
        // backdrop (z-index 60) and other top-layer overlays.
        zIndex: 1300,
        // Hide the first paint while we measure the real popover
        // height — the placement pass uses popH=380 as a default
        // until the ResizeObserver runs, which would otherwise show
        // a one-frame flash at the wrong spot. `visibility:hidden`
        // (not display:none) keeps the layout intact so the measure
        // can read offsetHeight on the very first paint.
        visibility: hasMeasured ? "visible" : "hidden",
      }
    : {};
  const anchorClass = portalActive ? "sd-pop" : `sd-pop sd-pop--${anchor}`;

  // Callback ref forwards the DOM node to both the host-provided
  // `popoverRef` (outside-click dismiss) and our internal
  // `popoverElRef` (ResizeObserver-driven height measurement for
  // accurate anchor flipping). Without this the host ref + our
  // measurement compete for the single `ref` slot.
  const popoverNode = (
    <div
      ref={(node) => {
        popoverElRef.current = node;
        if (popoverRef) {
          // popoverRef is typed RefObject<HTMLDivElement> (current is
          // readonly in that flavour); the cast bypasses the type
          // checker for the rare callsites that pass a real
          // useRef-backed ref (mutable in practice).
          (popoverRef as unknown as { current: HTMLDivElement | null }).current = node;
        }
      }}
      role={role}
      aria-label={ariaLabel}
      className={`${anchorClass}${className ? ` ${className}` : ""}`}
      style={{ ...widthStyle, ...portalStyle }}
      onKeyDown={handleKeyDown}
    >
      {showSearch && (
        <div className="sd-pop-search">
          <input
            ref={inputRef}
            type="text"
            className="sd-pop-search-input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}

      {onClear && selectedId && (
        <button type="button" className="sd-pop-opt sd-pop-opt--clear" onClick={onClear}>
          <span className="sd-pop-opt-label">{clearLabel}</span>
        </button>
      )}

      <div ref={listRef} className="sd-pop-list">
        {filtered.length === 0 ? (
          <div className="sd-pop-empty" role="status">
            {emptyTemplate.replace("{query}", query)}
          </div>
        ) : (
          (() => {
            // group mode kicks in when at least one item declares a
            // group key. Header rows are inserted between groups; the
            // highlight index still refers to ITEMS only (not headers).
            const hasGroups = filtered.some((it) => it.group !== undefined);
            if (!hasGroups) {
              return filtered.map((it, idx) =>
                renderItem(it, idx, selectedId, highlightIdx, role, onPick, setHighlightIdx),
              );
            }
            // Preserve the original order of groups — first appearance wins.
            const groupOrder: string[] = [];
            const groupLabels: Record<string, string> = {};
            const groupBuckets: Record<
              string,
              Array<{ item: SearchableDropdownItem<T>; idx: number }>
            > = {};
            filtered.forEach((it, idx) => {
              const key = it.group ?? "__none__";
              if (!groupBuckets[key]) {
                groupBuckets[key] = [];
                groupOrder.push(key);
                groupLabels[key] = it.groupLabel ?? "";
              }
              groupBuckets[key].push({ item: it, idx });
            });
            return groupOrder.map((gk) => {
              const bucket = groupBuckets[gk];
              const label = groupLabels[gk];
              return (
                <div key={`g-${gk}`} className="sd-pop-group">
                  {label && (
                    <div className="sd-pop-group-head" role="presentation">
                      <span className="sd-pop-group-label">{label}</span>
                      <span className="sd-pop-group-count">{bucket.length}</span>
                    </div>
                  )}
                  {bucket.map(({ item, idx }) =>
                    renderItem(item, idx, selectedId, highlightIdx, role, onPick, setHighlightIdx),
                  )}
                </div>
              );
            });
          })()
        )}
      </div>
    </div>
  );

  // Portal escapes ancestor `overflow: hidden` / transform containing
  // blocks (the np-modal-card has both). When no triggerRef passed,
  // fall back to inline absolute positioning so non-modal callers
  // (settings dropdowns rendered in normal flow) don't pay the cost.
  return portalActive ? createPortal(popoverNode, document.body) : popoverNode;
}
