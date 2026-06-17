import { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  groupByCategory,
  type Verb,
} from "@/runtime/verbs/registry";
import { useT } from "@/i18n";

/**
 * CommandLibrary — centered modal listing every editorial verb.
 * Factory-tactile: monochrome shades only, recessed inputs, raised
 * cards. No corner glows, no chromatic eyebrows, no per-category hues.
 * Hierarchy comes from depth physics (inset hairline + drop shadows)
 * and weight contrast.
 */
export function CommandLibrary({
  open,
  verbs,
  onClose,
  onPick,
}: {
  open: boolean;
  verbs: Verb[];
  onClose: () => void;
  onPick: (verb: Verb, sendImmediately: boolean) => void;
}) {
  const { t } = useT();
  const grouped = useMemo(() => groupByCategory(verbs), [verbs]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = (list: Verb[]) =>
    !q
      ? list
      : list.filter(
          (v) =>
            v.label.toLowerCase().includes(q) ||
            v.id.toLowerCase().includes(q) ||
            v.description.toLowerCase().includes(q),
        );

  const totalShown = CATEGORY_ORDER.reduce(
    (acc, cat) => acc + filtered(grouped[cat] ?? []).length,
    0,
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        background: "var(--df-surface-overlay)",
        backdropFilter: "blur(18px) saturate(1.02)",
        WebkitBackdropFilter: "blur(18px) saturate(1.02)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "df-lib-fade 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(760px, 100%)",
          maxHeight: "min(86vh, 760px)",
          background: "var(--df-surface-elevated)",
          borderRadius: "var(--df-r-3xl)",
          boxShadow: "var(--df-shadow-card)",
          display: "flex",
          flexDirection: "column",
          animation: "df-lib-rise 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          overflow: "hidden",
        }}
      >
        {/* HEADER */}
        <div
          style={{
            padding: "22px 26px 18px",
            borderBottom: "1px solid var(--df-border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--df-font-mono)",
                  fontSize: 10,
                  fontWeight: "var(--df-fw-bold, 700)",
                  letterSpacing: "var(--df-tracking-label)",
                  textTransform: "uppercase",
                  color: "var(--df-text-muted)",
                  marginBottom: 8,
                }}
              >
                {t("cmdlib.kicker")}
              </div>
              <h2
                style={{
                  margin: 0,
                  fontFamily: "var(--df-font-display)",
                  fontSize: "var(--df-text-xl, 28px)",
                  fontWeight: "var(--df-fw-bold, 700)",
                  letterSpacing: "var(--df-tracking-display)",
                  lineHeight: 1.05,
                  color: "var(--df-text-primary)",
                }}
              >
                {t("cmdlib.title")}
              </h2>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "var(--df-text-sm)",
                  color: "var(--df-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {t("cmdlib.subtitle")}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label={t("cmdlib.close")}
              style={{
                width: 30,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--df-surface-raised)",
                border: "none",
                borderRadius: 999,
                color: "var(--df-text-muted)",
                cursor: "pointer",
                boxShadow: `inset 0 1px 0 var(--df-skeu-top-light), inset 0 0 0 1px var(--df-border-subtle), 0 1px 2px var(--df-skeu-near)`,
                transition: "color 140ms var(--df-ease-out), transform 140ms var(--df-ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--df-text-primary)";
                e.currentTarget.style.transform = "scale(1.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--df-text-muted)";
                e.currentTarget.style.transform = "";
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* SEARCH — recessed bowl */}
          <div style={{ position: "relative", marginTop: 18 }}>
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 14,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--df-text-faint)",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("cmdlib.search")}
              style={{
                width: "100%",
                padding: "11px 14px 11px 38px",
                background: "var(--df-bg-section)",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-lg)",
                color: "var(--df-text-primary)",
                fontSize: "var(--df-text-sm)",
                fontFamily: "var(--df-font-body)",
                outline: "none",
                boxShadow: "var(--df-skeu-recess)",
                transition:
                  "border-color 160ms var(--df-ease-out), box-shadow 160ms var(--df-ease-out)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--df-border-focus)";
                e.currentTarget.style.boxShadow = "var(--df-skeu-recess), var(--df-focus-ring)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--df-border-subtle)";
                e.currentTarget.style.boxShadow = "var(--df-skeu-recess)";
              }}
            />
          </div>
        </div>

        {/* BODY */}
        <div
          style={{
            padding: "18px 26px 24px",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {totalShown === 0 ? (
            <div
              style={{
                padding: "44px 8px",
                textAlign: "center",
                color: "var(--df-text-muted)",
                fontSize: "var(--df-text-sm)",
              }}
            >
              {t("cmdlib.empty")}{" "}
              <code
                style={{
                  fontFamily: "var(--df-font-mono)",
                  fontSize: 12,
                  padding: "2px 7px",
                  background: "var(--df-surface-raised)",
                  borderRadius: 5,
                  color: "var(--df-text-secondary)",
                  boxShadow: "var(--df-skeu-recess)",
                }}
              >
                {query}
              </code>
            </div>
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const list = filtered(grouped[cat] ?? []);
              if (list.length === 0) return null;
              return (
                <section key={cat} style={{ marginBottom: 24 }}>
                  <h3
                    style={{
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 10,
                      fontWeight: "var(--df-fw-bold, 700)",
                      textTransform: "uppercase",
                      letterSpacing: "var(--df-tracking-label)",
                      color: "var(--df-text-muted)",
                      margin: "0 0 12px 0",
                    }}
                  >
                    {CATEGORY_LABEL[cat]}
                  </h3>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gap: 10,
                    }}
                  >
                    {list.map((v) => (
                      <VerbCard key={v.id} verb={v} onPick={onPick} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* FOOTER */}
        <div
          style={{
            padding: "13px 26px",
            borderTop: "1px solid var(--df-border-subtle)",
            fontFamily: "var(--df-font-mono)",
            fontSize: 11,
            color: "var(--df-text-muted)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "var(--df-bg-section)",
          }}
        >
          <span>{t("cmdlib.foot.shortcut")}</span>
          <span>{t("cmdlib.foot.esc")}</span>
        </div>

        <style>{`
          @keyframes df-lib-fade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes df-lib-rise {
            from { opacity: 0; transform: translateY(12px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}

function VerbCard({ verb, onPick }: { verb: Verb; onPick: (v: Verb, sendNow: boolean) => void }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={(e) => onPick(verb, e.shiftKey)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        padding: "14px 15px 13px",
        background: hover ? "var(--df-surface-raised)" : "var(--df-bg-section)",
        border: "none",
        borderRadius: "var(--df-r-xl)",
        cursor: "pointer",
        textAlign: "left",
        transform: pressed ? "translateY(0)" : hover ? "translateY(-1px)" : "none",
        boxShadow: pressed
          ? `var(--df-skeu-recess)`
          : hover
            ? `inset 0 1px 0 var(--df-skeu-top-light),
               inset 0 0 0 1px var(--df-border-hover),
               0 2px 4px var(--df-skeu-near),
               0 8px 16px -4px var(--df-skeu-deep-near)`
            : `inset 0 1px 0 var(--df-skeu-top-light),
               inset 0 0 0 1px var(--df-border-subtle),
               0 1px 1px var(--df-skeu-near)`,
        transition:
          "transform 160ms var(--df-ease-out), background 140ms var(--df-ease-out), box-shadow 180ms var(--df-ease-out)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            fontSize: "var(--df-text-sm)",
            fontWeight: "var(--df-fw-semibold, 600)",
            color: "var(--df-text-primary)",
            letterSpacing: "var(--df-tracking-tight)",
          }}
        >
          {verb.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            color: hover ? "var(--df-text-muted)" : "var(--df-text-faint)",
            transition: "color 160ms var(--df-ease-out)",
          }}
        >
          /{verb.id}
        </span>
        {verb.source !== "builtin" && (
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 9,
              color: "var(--df-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "var(--df-tracking-label)",
              padding: "2px 6px",
              background: "var(--df-surface-elevated)",
              borderRadius: 4,
              boxShadow: "inset 0 0 0 1px var(--df-border-subtle)",
            }}
          >
            {verb.source === "override" ? "edited" : "custom"}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: "var(--df-text-xs)",
          color: "var(--df-text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {verb.description || `Run /${verb.id} on the current design`}
      </div>
    </button>
  );
}
