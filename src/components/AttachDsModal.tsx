// AttachDsModal — attach / replace / remove the project's Design
// System mid-flight. User ask 2026-05-20: "queria poder escolher
// anexar design system no meio de projeto". Until now a DS could only
// be picked at NewProject time; after that the user had to restart.
//
// Lists every DS the daemon discovers under design-systems/* and lets
// the user pick one or detach the current pick. Creating a NEW DS still
// happens through the existing DsSetupModal (Home → DS rail) — keeping
// this modal narrow on purpose so it doesn't grow into a duplicate of
// the home-screen flow.

import { useEffect, useMemo, useState } from "react";
import { listDesignSystemsFromFilesystem, type FsDesignSystem } from "@/lib/claude-bridge";
import { useT } from "@/i18n";

interface Props {
  /** Whether the modal is open. Parent owns the state. */
  open: boolean;
  /** Currently-attached DS path (so we can highlight the active row and
   *  enable the "detach" affordance). */
  currentDsPath: string | null;
  /** User picked a DS (or `null` to detach). Parent persists to meta.json
   *  and updates `dsPath` / `dsName` state. */
  onSelect: (ds: FsDesignSystem | null) => void | Promise<void>;
  /** Close requested without picking. */
  onClose: () => void;
}

export function AttachDsModal({ open, currentDsPath, onSelect, onClose }: Props) {
  const { t } = useT();
  const [list, setList] = useState<FsDesignSystem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listDesignSystemsFromFilesystem()
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError(t("attachds.error.bridge"));
          setList([]);
        } else {
          setList(res);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  // Sort: currently-attached first, then by name. Stable across opens so
  // the list doesn't reshuffle while the modal stays mounted.
  const sorted = useMemo(() => {
    if (!list) return [];
    return [...list].sort((a, b) => {
      if (a.path === currentDsPath) return -1;
      if (b.path === currentDsPath) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [list, currentDsPath]);

  if (!open) return null;

  const handlePick = async (ds: FsDesignSystem) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSelect(ds);
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async () => {
    if (busy || !currentDsPath) return;
    setBusy(true);
    try {
      await onSelect(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(560px, 85vh)",
          display: "flex",
          flexDirection: "column",
          background: "var(--df-surface-raised)",
          border: "1px solid var(--df-border-subtle)",
          borderRadius: "var(--df-r-lg)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--df-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--df-text-primary)" }}>
              {t("attachds.title")}
            </div>
            <div style={{ fontSize: 11, color: "var(--df-text-faint)", marginTop: 2 }}>
              {t("attachds.subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--df-text-secondary)",
              fontSize: 18,
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "10px 8px",
          }}
        >
          {loading && (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                color: "var(--df-text-faint)",
                fontSize: 12,
              }}
            >
              {t("attachds.loading")}
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 16, color: "#ef5d3b", fontSize: 12 }}>{error}</div>
          )}
          {!loading && !error && sorted.length === 0 && (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                color: "var(--df-text-faint)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {t("attachds.empty")}
            </div>
          )}
          {!loading &&
            !error &&
            sorted.map((ds) => {
              const isActive = ds.path === currentDsPath;
              return (
                <button
                  key={ds.path}
                  type="button"
                  onClick={() => void handlePick(ds)}
                  disabled={busy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 12px",
                    margin: "2px 0",
                    background: isActive ? "var(--df-bg-section)" : "transparent",
                    border: "1px solid",
                    borderColor: isActive ? "var(--df-accent)" : "transparent",
                    borderRadius: "var(--df-r-md)",
                    color: "var(--df-text-primary)",
                    textAlign: "left",
                    cursor: busy ? "default" : "pointer",
                    opacity: busy && !isActive ? 0.7 : 1,
                    transition: "background 100ms ease, border-color 100ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive && !busy)
                      e.currentTarget.style.background = "var(--df-bg-section)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--df-r-sm)",
                      background: "var(--df-bg-section)",
                      border: "1px solid var(--df-border-subtle)",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--df-text-faint)",
                      fontFamily: "var(--df-font-mono)",
                      fontSize: 13,
                      textTransform: "uppercase",
                    }}
                  >
                    {ds.name.slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ds.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--df-text-faint)",
                        fontFamily: "var(--df-font-mono)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ds.slug}
                    </div>
                  </div>
                  {isActive && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--df-accent)",
                        fontWeight: 500,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {t("attachds.active")}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {currentDsPath && (
          <footer
            style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--df-border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--df-text-faint)" }}>
              {t("attachds.detach.hint")}
            </span>
            <button
              type="button"
              onClick={() => void handleDetach()}
              disabled={busy}
              className="df-btn df-btn--sm df-btn--ghost"
            >
              {t("attachds.detach")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
