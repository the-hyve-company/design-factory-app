// EntityCard — unified card pattern for HomeScreen v8.
//
// two refinements per spec — horizontal dots and no green dot on the card:
//   · Three-dot glyph rotated to HORIZONTAL (⋯ instead of ⋮). Reads as
//     "more options" without colliding visually with the vertical chevrons
//     used elsewhere in the app (provider rows, dropdowns).
//   · LED accent (entity-card-led) REMOVED. The green dot was reading as
//     a status indicator and adding noise to a footer that should be
//     calm — title + date + dots, nothing else. `showLed` prop kept on
//     the type for one cycle of back-compat but is now a no-op.
//
// footer redesign per user spec:
//   "cards de projetos, templates, design systems e skills devem ter os 3
//    pontos no canto para manipular ... vamos padronizar esses cards pra
//    todas paginas"
//
// Anatomy now:
//   ┌─────────────────────────────┐
//   │                             │
//   │      (thumb 16:9)           │
//   │                             │
//   ├─────────────────────────────┤
//   │ Title                  ⋯    │  ← title left, 3-dots horizontal right
//   │ Subtitle (date · ~size)     │  ← meta left, no LED
//   └─────────────────────────────┘
//
// Stays a pure render component. No internal state — host owns menu open
// state and confirmation prompts.

import { type ReactNode } from "react";

export type EntityCardSize = "sm" | "md";

export interface EntityCardAction {
  label: string;
  onSelect: () => void;
  /** Tone hint — `danger` paints the row red. */
  tone?: "default" | "danger";
}

export interface EntityCardProps {
  /** Stable id for testing + keyed list rendering. */
  id: string;
  /** Title shown bold under the thumb. */
  title: string;
  /** Optional sub line (date, kb, source). */
  subtitle?: string;
  /** Tooltip on the card. Defaults to title. */
  hoverTitle?: string;
  /** Slot rendered inside .home-pcard-thumb (16:9 box). Could be ProjectCover,
   *  template iframe, palette swatches, etc. */
  thumb: ReactNode;
  /** Card primary click handler. */
  onOpen: () => void;
  /** When provided + `menuOpen` is true, render a dropdown of actions. */
  actions?: EntityCardAction[];
  /** Whether the dropdown is open. Host owns this state. */
  menuOpen?: boolean;
  /** Toggle menu visibility. */
  onMenuToggle?: (next: boolean) => void;
  /** Back-compat: when no `actions[]` is passed, callers used to use
   *  `onDelete` for a simple inline x. collapses both paths into a
   *  one-item menu (label "Deletar"). Hosts that pass actions[] should
   *  ignore this prop. */
  onDelete?: () => void;
  /** Aria label for the options trigger. */
  optionsLabel?: string;
  /** Aria label / menu label for the back-compat delete affordance. */
  deleteLabel?: string;
  /** DEPRECATED no-op. Kept for one cycle so existing callers
   *  compile. The LED accent has been removed from cards. */
  showLed?: boolean;
  /** Render the subtitle in mono / dimmed style (user Editorial-mono
   *  direction 2026-05-21). Used for technical identifiers — skill
   *  trigger, project slug, byte size — that should sit visually behind
   *  the title rather than competing with it. Default false. */
  subtitleMono?: boolean;
}

export function EntityCard({
  id,
  title,
  subtitle,
  hoverTitle,
  thumb,
  onOpen,
  actions,
  menuOpen = false,
  onMenuToggle,
  onDelete,
  optionsLabel = "Options",
  deleteLabel = "Deletar",
  // showLed prop deliberately consumed but not used — kept for
  // back-compat. LED was removed from the footer.
  showLed: _showLed = true,
  subtitleMono = false,
}: EntityCardProps) {
  void _showLed;
  // Normalise: if `onDelete` was passed without explicit actions, shape a
  // one-item menu so every card uses the same control surface (footer
  // dots). Eliminates the legacy `.entity-card-x` corner button.
  const effectiveActions: EntityCardAction[] | undefined =
    actions && actions.length > 0
      ? actions
      : onDelete
        ? [{ label: deleteLabel, onSelect: onDelete, tone: "danger" as const }]
        : undefined;
  const hasMenu = Array.isArray(effectiveActions) && effectiveActions.length > 0;

  return (
    <div className="home-pcard-tile entity-card" data-entity-id={id}>
      <button
        type="button"
        className="home-pcard"
        style={{ width: "100%" }}
        onClick={onOpen}
        title={hoverTitle ?? title}
      >
        <div className="home-pcard-thumb">{thumb}</div>
        <div className="home-pcard-meta">
          <div className="home-pcard-meta-text">
            <div className="home-pcard-name">{title}</div>
            {subtitle && (
              <div
                className="home-pcard-sub"
                style={
                  subtitleMono
                    ? {
                        fontFamily: "var(--df-font-mono)",
                        color: "var(--df-text-faint)",
                        fontSize: "var(--df-text-xs)",
                        letterSpacing: "0.01em",
                      }
                    : undefined
                }
              >
                {subtitle}
              </div>
            )}
          </div>
          {hasMenu && (
            <div className="home-pcard-meta-actions">
              <span
                role="button"
                tabIndex={0}
                className="home-pcard-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={optionsLabel}
                title={optionsLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onMenuToggle?.(!menuOpen);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onMenuToggle?.(!menuOpen);
                  }
                }}
              >
                {/* Horizontal three-dot glyph (cx=3,7,11) at a single
                    baseline. */}
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="3" cy="7" r="1.3" fill="currentColor" />
                  <circle cx="7" cy="7" r="1.3" fill="currentColor" />
                  <circle cx="11" cy="7" r="1.3" fill="currentColor" />
                </svg>
              </span>
            </div>
          )}
        </div>
      </button>

      {hasMenu && menuOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onClick={() => onMenuToggle?.(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="home-pcard-menu"
            style={{
              position: "absolute",
              right: 12,
              bottom: 8,
              minWidth: 168,
              background: "var(--df-surface-elevated)",
              borderRadius: "var(--df-r-lg)",
              boxShadow: "var(--df-shadow-card-hover)",
              border: "1px solid var(--df-border-subtle)",
              zIndex: 51,
              overflow: "hidden",
              transform: "translateY(calc(100% + 8px))",
            }}
          >
            {effectiveActions!.map((a, i) => (
              <button
                type="button"
                role="menuitem"
                key={`${id}-action-${i}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onMenuToggle?.(false);
                  a.onSelect();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "9px 12px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: a.tone === "danger" ? "#ff6b6b" : "var(--df-text-primary)",
                  fontSize: "var(--df-text-sm)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    a.tone === "danger" ? "rgba(255,107,107,0.1)" : "var(--df-interactive-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
