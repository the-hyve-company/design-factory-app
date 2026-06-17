import { useEffect, useMemo, useRef, useState } from "react";
import {
  readFileViaBridge,
  writeFile,
  gitShallowClone,
  db,
  BRIDGE_URL,
  openFolderViaBridge,
} from "@/lib/claude-bridge";
import { parseDesignSystem, type ParsedDesignSystem } from "@/lib/ds-google";
import { renderMarkdownSafe } from "@/lib/safe-markdown";
import type { DsEntry } from "@/types/ds";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GeneratePreviewModal } from "@/components/GeneratePreviewModal";
import { TabCornerLeft, TabCornerRight } from "@/components/TabCorner";
import { FolderOpen, Settings } from "lucide-react";

interface GenerationState {
  provider: string;
  model: string;
  startedAt: number;
}

interface Props {
  entry: DsEntry;
  onBack: () => void;
  onOpenSettings?: () => void;
  theme?: "dark" | "light";
  onThemeChange?: (theme: "dark" | "light") => void;
}

export function DsPreviewScreen({ entry, onBack, onOpenSettings, theme, onThemeChange }: Props) {
  const [md, setMd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftMd, setDraftMd] = useState("");
  const [tab, setTab] = useState<"design" | "preview">("design");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [genModalOpen, setGenModalOpen] = useState(false);
  /** When non-null, a generation is in flight. Survives modal close +
   *  tab switching — only the screen owns it. The Preview tab reads it
   *  to render the "Gerando…" banner. Cleared on success/error. */
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  /** Mirror of `generation` for the design.md extraction stage. Set when
   *  the daemon's `.design-md-generating.json` marker exists. The DS lab
   *  modal writes a placeholder design.md first + the daemon overwrites
   *  with the real content when the LLM finishes; this flag drives the
   *  "Extraindo design system…" status on the Design.md tab. */
  const [extraction, setExtraction] = useState<GenerationState | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  /** startedAt of a preview marker the user explicitly cancelled. The
   *  chained-preview watcher below otherwise re-adopts any in-flight
   *  .preview-generating.json it finds — including a stale one left by a
   *  killed background process — which would resurrect the "Gerando…"
   *  banner the instant the user dismissed it. Remembering the dismissed
   *  marker's timestamp lets the watcher skip that exact one while still
   *  picking up any genuinely new generation (different startedAt). */
  const dismissedPreviewMarkerRef = useRef<number | null>(null);
  const previewPath = entry.previewPath || `${entry.path}/preview.html`;

  // Load preview.html via bridge whenever we enter the Preview tab OR
  // the entry's previewPath flips on (after Generate Preview completes).
  // Falls through to "no preview yet" when the file doesn't exist on disk.
  useEffect(() => {
    if (tab !== "preview") return;
    let cancelled = false;
    setPreviewLoading(true);
    readFileViaBridge(previewPath)
      .then((f) => {
        if (!cancelled) setPreviewHtml(f?.content ?? null);
      })
      .catch(() => {
        if (!cancelled) setPreviewHtml(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, previewPath, entry.previewPath]);

  // On mount: restore in-flight state from disk so the "Gerando…"
  // UI survives screen unmount / navigation / page refresh. The
  // daemon writes .preview-generating.json at the start of every
  // run and removes it at the end (success or error), so its mere
  // presence is the source of truth for "still running". If a prior
  // crash left a stale marker, the timestamp inside lets the user
  // see when it started — we don't auto-time-out, just surface.
  useEffect(() => {
    const generatingPath = `${entry.path}/.preview-generating.json`;
    readFileViaBridge(generatingPath)
      .then((f) => {
        if (!f?.content) return;
        try {
          const parsed = JSON.parse(f.content);
          const startedAt = parsed?.startedAt ? Date.parse(parsed.startedAt) : Date.now();
          setGeneration({
            provider: parsed?.provider || "unknown",
            model: parsed?.model || "default",
            startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
          });
          setTab("preview");
        } catch {}
      })
      .catch(() => {});
  }, [entry.path]);

  // Same mount-time restore for design.md EXTRACTION state. Daemon
  // writes .design-md-generating.json at the start of /ds/generate-
  // design-md and clears it once the real design.md lands. While the
  // marker exists the Design.md tab renders the placeholder content
  // with an "Extraindo…" banner; once cleared the polling effect
  // below re-reads the real design.md and refreshes the markdown.
  useEffect(() => {
    const generatingPath = `${entry.path}/.design-md-generating.json`;
    readFileViaBridge(generatingPath)
      .then((f) => {
        if (!f?.content) return;
        try {
          const parsed = JSON.parse(f.content);
          const startedAt = parsed?.startedAt ? Date.parse(parsed.startedAt) : Date.now();
          setExtraction({
            provider: parsed?.provider || "unknown",
            model: parsed?.model || "default",
            startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
          });
        } catch {}
      })
      .catch(() => {});
  }, [entry.path]);

  // Polling for design.md EXTRACTION completion. Every 4s while an
  // extraction is in flight: re-read design.md (it may have flipped
  // from placeholder to real content), check the error marker, and
  // verify the generating marker hasn't been cleared by the daemon.
  useEffect(() => {
    if (!extraction) return;
    const errorPath = `${entry.path}/.design-md-error.json`;
    const generatingPath = `${entry.path}/.design-md-generating.json`;
    const handle = setInterval(() => {
      // Re-read design.md — daemon overwrites placeholder when LLM done.
      // Polling the file itself (rather than relying on a "done" marker)
      // keeps the content in sync if the user manually edits while a
      // run is in flight (rare but harmless).
      readFileViaBridge(entry.designMdPath)
        .then((f) => {
          if (f?.content && f.content !== md) {
            setMd(f.content);
            setDraftMd(f.content);
          }
          return readFileViaBridge(generatingPath);
        })
        .then((gen) => {
          if (!gen?.content) {
            // Marker cleared → extraction done (or failed). Let the
            // error file check below own the decision; this just frees
            // the spinner.
            return readFileViaBridge(errorPath).then((errF) => {
              if (errF?.content) {
                try {
                  const parsed = JSON.parse(errF.content);
                  setExtractionError(parsed?.error || "Erro desconhecido");
                } catch {
                  setExtractionError(errF.content.slice(0, 200));
                }
              }
              setExtraction(null);
            });
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(handle);
  }, [extraction, entry.designMdPath, entry.path, md]);

  // Background polling while a generation is in flight — every 4s
  // check the DS folder for preview.html (success), .preview-error
  // .json (failure) or .preview-generating.json (still running).
  // The daemon writes them; the polling decouples result delivery
  // from the user's HTTP request so the UI doesn't need to keep a
  // connection open for the full 5-30 min generation window.
  useEffect(() => {
    if (!generation) return;
    const errorPath = `${entry.path}/.preview-error.json`;
    const generatingPath = `${entry.path}/.preview-generating.json`;
    const handle = setInterval(() => {
      // Check success file first — preview.html wins over any
      // residual marker from a prior attempt.
      readFileViaBridge(previewPath)
        .then((f) => {
          if (f?.content) {
            setPreviewHtml(f.content);
            setGeneration(null);
            setGenerationError(null);
            return null;
          }
          // Then check for an error file.
          return readFileViaBridge(errorPath).then((errF) => {
            if (errF?.content) {
              try {
                const parsed = JSON.parse(errF.content);
                setGenerationError(parsed?.error || "Erro desconhecido");
              } catch {
                setGenerationError(errF.content.slice(0, 200));
              }
              setGeneration(null);
              return null;
            }
            // Neither result file is on disk. Re-read the in-flight
            // marker — if the daemon has cleared it (e.g. on retry
            // race), clear our React state too so we don't show a
            // ghost spinner forever.
            return readFileViaBridge(generatingPath).then((gen) => {
              if (!gen?.content) {
                setGeneration(null);
              }
            });
          });
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(handle);
  }, [generation, previewPath, entry.path]);

  // Observe a CHAINED / server-started preview. After design.md
  // extraction finishes, the daemon kicks a preview generation on its
  // own (POST /ds/generate-design-md with generatePreviewAfter), writing
  // .preview-generating.json server-side. That path never runs through
  // startGeneration() and the mount-restore effect already fired (before
  // the marker existed, while design.md was still extracting), so without
  // this watcher the UI sits on the "Ainda sem preview" CTA even though a
  // preview is actively generating — or already landed — on disk.
  //
  // Runs only when nothing else owns the preview state: no generation we
  // already track, no preview loaded, and extraction no longer in flight.
  // The !extraction gate hands off cleanly — the extraction poll clears
  // `extraction` the moment design.md completes, then this watcher takes
  // over within a tick and catches the chained marker whenever it lands
  // (covering the small race where the daemon clears the design.md marker
  // just before writing the preview one). As soon as it adopts a marker /
  // result it flips the relevant state and its own guard stops it.
  useEffect(() => {
    if (generation || previewHtml || extraction) return;
    const generatingPath = `${entry.path}/.preview-generating.json`;
    const errorPath = `${entry.path}/.preview-error.json`;
    let cancelled = false;

    const probe = () => {
      // preview.html wins — a chained generation already finished.
      readFileViaBridge(previewPath)
        .then((f) => {
          if (cancelled) return null;
          if (f?.content) {
            setPreviewHtml(f.content);
            setTab("preview");
            return null;
          }
          // In-flight marker → adopt it as our generation state so the
          // banner shows and the preview polling effect above takes over.
          return readFileViaBridge(generatingPath).then((gen) => {
            if (cancelled) return;
            if (!gen?.content) {
              // No marker — surface a leftover error if one exists so a
              // failed chain isn't silently swallowed.
              return readFileViaBridge(errorPath).then((errF) => {
                if (cancelled || !errF?.content) return;
                try {
                  const parsed = JSON.parse(errF.content);
                  setGenerationError(parsed?.error || "Erro desconhecido");
                } catch {
                  setGenerationError(errF.content.slice(0, 200));
                }
                setTab("preview");
              });
            }
            try {
              const parsed = JSON.parse(gen.content);
              const startedAt = parsed?.startedAt ? Date.parse(parsed.startedAt) : Date.now();
              const startedAtMs = Number.isFinite(startedAt) ? startedAt : Date.now();
              // Skip a marker the user already dismissed (stale orphan
              // from a killed background run) — otherwise cancelling just
              // resurrects the banner on the next probe.
              if (dismissedPreviewMarkerRef.current === startedAtMs) return;
              setGeneration({
                provider: parsed?.provider || "unknown",
                model: parsed?.model || "default",
                startedAt: startedAtMs,
              });
              setTab("preview");
            } catch {}
          });
        })
        .catch(() => {});
    };

    probe(); // immediate first check, then poll
    const handle = setInterval(probe, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [generation, previewHtml, extraction, entry.path, previewPath]);

  // Kick off a generation. The endpoint is fire-and-forget — daemon
  // returns 202 immediately and writes the result file when done.
  // The polling effect above picks it up; this fetch just primes the
  // generation state so the UI flips to "Gerando…" + start time.
  const startGeneration = (provider: string, model: string) => {
    generationAbortRef.current?.abort();
    const abort = new AbortController();
    generationAbortRef.current = abort;
    setGeneration({ provider, model, startedAt: Date.now() });
    setGenerationError(null);
    setTab("preview");

    (async () => {
      try {
        const r = await fetch(`${BRIDGE_URL}/ds/generate-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dsPath: entry.path,
            designMdPath: entry.designMdPath,
            provider,
            model,
          }),
          signal: abort.signal,
        });
        // Daemon returns 202 to ack the start. Anything else is a
        // hard failure (bad request, daemon unreachable, etc.).
        if (r.status !== 202) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        // From here we trust the polling effect to deliver the result.
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setGenerationError(e?.message || String(e));
        setGeneration(null);
      }
    })();
  };

  // Abort the kickoff fetch on unmount. The daemon's async pipeline
  // keeps running regardless — preview.html appears when it does.
  useEffect(() => () => generationAbortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const tryRead = async () => {
      const f = await readFileViaBridge(entry.designMdPath).catch(() => null);
      if (cancelled) return;
      if (f) {
        setMd(f.content);
        setDraftMd(f.content);
        setLoading(false);
        return;
      }
      // Recovery path: if the DS was originally cloned from GitHub, the cache
      // folder may have been wiped between app runs (old timestamped paths
      // don't exist anymore). Re-clone into the new deterministic path and
      // patch the persisted design_systems entry so subsequent opens hit it
      // directly.
      if (entry.source === "github" && entry.sourceRef) {
        const recloned = await gitShallowClone(entry.sourceRef).catch(() => null);
        if (cancelled) return;
        if (recloned && "path" in recloned) {
          const newPath = recloned.path;
          const newDesignMdPath = `${newPath}/design.md`;
          // Update entry in persisted design_systems list
          try {
            const raw = await db.getSetting("design_systems");
            if (raw) {
              const list: DsEntry[] = JSON.parse(raw);
              const patched = list.map((e) =>
                e.path === entry.path || e.designMdPath === entry.designMdPath
                  ? { ...e, path: newPath, designMdPath: newDesignMdPath }
                  : e,
              );
              await db.setSetting("design_systems", JSON.stringify(patched));
              // Mirror ds_path if this was the active one
              const currentActive = await db.getSetting("ds_path");
              if (currentActive === entry.path) {
                await db.setSetting("ds_path", newPath);
              }
            }
          } catch {}
          const f2 = await readFileViaBridge(newDesignMdPath).catch(() => null);
          if (cancelled) return;
          if (f2) {
            // Mutate the in-memory entry so the topbar reflects the new path.
            entry.path = newPath;
            entry.designMdPath = newDesignMdPath;
            setMd(f2.content);
            setDraftMd(f2.content);
            setLoading(false);
            return;
          }
        }
      }
      setError(`Could not read ${entry.designMdPath}`);
      setLoading(false);
    };

    void tryRead();
    return () => {
      cancelled = true;
    };
  }, [entry.designMdPath]);

  const parsed: ParsedDesignSystem | null = useMemo(
    () => (md ? parseDesignSystem(md) : null),
    [md],
  );

  const save = async () => {
    await writeFile(entry.designMdPath, draftMd);
    setMd(draftMd);
    setEditing(false);
  };

  return (
    <div className="screen" data-active="true" style={{ background: "var(--df-bg-base)" }}>
      {/* Topbar — mirrors the Home topbar (Aqua 3-zone layout). Left:
          Logo (clickable back to home) + DS name. Center: Design.md /
          Preview tabs with concave-corner highlight. Right: theme
          toggle + settings. Everything else (Edit, View raw,
          best-effort badge, source meta) was stripped per user
          request — "tabs na topbar, settings, toggle, nome do DS,
          nada mais". Edit lives inside the Design.md tab body now. */}
      {/* Layout override: Home topbar pins brand absolute left:0 and
          right cluster absolute right:0, with tabs locked at the feed
          margin. That design assumes the brand is a fixed-width "Design
          Factory" wordmark. Here the brand is a user-supplied DS name
          (could be anything from "Apple" to a long phrase), so we
          unpin every zone and let them flow horizontally — brand
          natural width, tabs immediately after with a small gap, right
          cluster pushed to the edge via margin-left:auto. Long brand
          names now visibly push the tabs. */}
      <header className="editor-topbar home-topbar">
        <div className="topbar-floor" />

        <div
          className="home-topbar-brand"
          style={{
            position: "static",
            flexShrink: 0,
            padding: "0 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            // Match Home tabs landing on the feed-left line by default.
            // The min-width reserves space up to that line so short DS
            // names (Spotify, Nike) leave tabs exactly where they sit
            // on Home. Longer names expand the box and naturally push
            // the tabs further right.
            minWidth: "max(80px, calc((100vw - 1180px) / 2))",
            boxSizing: "border-box",
          }}
        >
          {/* Skeu back button — uses the canonical .df-btn--secondary
              skeu treatment (inset top highlight + 1px hairline + 1px
              shadow) at icon-button proportions, mirroring how Home's
              right cluster renders the settings circle. */}
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to home"
            title="Back to home"
            className="df-btn df-btn--secondary"
            style={{
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: "var(--df-r-md)",
              flexShrink: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          {/* DS name only — exactly the name the user gave when
              creating the DS (entry.name). parsed?.name is ignored
              because it reflects whatever the design.md author wrote
              as title ("Design System Inspired by Spotify"), which
              isn't what the user typed in the DF picker. Class
              .home-brand-name carries the Design Factory wordmark
              styling — same weight + size by design. */}
          <span className="home-brand-name">{entry.name}</span>
        </div>

        <div className="topbar-center" style={{ marginLeft: 0, flexShrink: 0 }}>
          {(
            [
              { id: "design", label: "Design.md" },
              { id: "preview", label: "Preview" },
            ] as const
          ).map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              className="topbar-file-tab"
              aria-selected={tab === tabDef.id}
              onClick={() => setTab(tabDef.id)}
            >
              {tab === tabDef.id && (
                <>
                  <TabCornerLeft outerColor="var(--df-bg-base)" />
                  <TabCornerRight outerColor="var(--df-bg-base)" />
                </>
              )}
              <span className="topbar-file-tab-name">{tabDef.label}</span>
            </button>
          ))}
        </div>

        <div
          className="topbar-right"
          style={{
            position: "static",
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* Open folder — dispatches Finder/Explorer/xdg-open on the
              DS folder. Same shape the skill detail uses. Requested:
              a button on the design system page to open the folder
              locally. */}
          {entry.path && (
            <button
              type="button"
              className="df-btn df-btn--secondary"
              title={`Abrir ${entry.path}`}
              aria-label="Open design system folder"
              onClick={() => {
                void openFolderViaBridge(entry.path).then((r) => {
                  if ("error" in r) {
                    // Best-effort surfacing — fallback to a console log
                    // when no toast surface is mounted in this screen.
                    console.warn("[ds] open-folder failed:", r.error);
                  }
                });
              }}
              style={{
                width: 32,
                height: 32,
                padding: 0,
                borderRadius: "var(--df-r-md)",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          {theme && onThemeChange && <ThemeToggle theme={theme} onChange={onThemeChange} />}
          {onOpenSettings && (
            <button
              className="editor-avatar"
              title="Settings"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <Settings size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {/* Body — fills the viewport edge-to-edge. Padding lives on the
          inner wrapper (not main) so the sticky scroll-fade overlay
          can pin to the actual top of the scrolling container without
          being eaten by main's padding box. User asked for both
          (a) bigger top breathing room before the design.md and (b)
          a soft fade where content scrolls under the topbar. */}
      <main
        style={{
          padding: "0 clamp(20px, 4vw, 56px) 60px",
          width: "100%",
          boxSizing: "border-box",
          overflowY: "auto",
          flex: 1,
        }}
      >
        {/* Sticky fade — sits at the top of the main scroll container,
            so as the user scrolls body content up it passes UNDER the
            fade before reaching the topbar. zIndex 5 keeps it above
            the iframe + markdown but below the modal layer. */}
        <div
          aria-hidden="true"
          style={{
            position: "sticky",
            top: 0,
            height: 36,
            marginBottom: -36, // pull the next sibling back up so the fade overlays it instead of pushing it down
            background:
              "linear-gradient(180deg, var(--df-bg-base) 0%, var(--df-bg-base) 30%, transparent 100%)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
        {/* Top breathing room — explicit 72px gap between the topbar
            and the first body element. Larger than the fade height so
            the user sees space + a soft transition, not a hard cut. */}
        <div style={{ height: 72, flexShrink: 0 }} />
        {loading && (
          <div style={{ padding: 60, textAlign: "center", color: "var(--df-text-muted)" }}>
            Loading design.md…
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              padding: "var(--df-sp-8) var(--df-sp-5)",
              textAlign: "center",
              color: "var(--df-text-secondary)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--df-accent-warn)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2
              style={{
                fontSize: "var(--df-text-md)",
                fontWeight: 500,
                margin: 0,
                color: "var(--df-text-primary)",
              }}
            >
              Can't reach this design system
            </h2>
            <p
              style={{ fontSize: "var(--df-text-sm)", maxWidth: 460, lineHeight: 1.55, margin: 0 }}
            >
              {error}
            </p>
            <p
              style={{
                fontSize: "var(--df-text-xs)",
                color: "var(--df-text-faint)",
                maxWidth: 460,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              GitHub-sourced DSes keep their{" "}
              <code style={{ fontFamily: "var(--df-font-mono)" }}>design.md</code> in an ephemeral
              cache that gets wiped between runs. Remove this entry and re-add the repo to
              regenerate.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 6,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                className="df-btn df-btn--primary"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("df-ds-remove-request", { detail: { path: entry.path } }),
                  );
                  onBack();
                }}
              >
                Remove from list
              </button>
              <button className="df-btn df-btn--secondary" onClick={onBack}>
                Back to workspace
              </button>
            </div>
          </div>
        )}

        {parsed && (
          <>
            {tab === "design" && (
              <>
                {(extraction || extractionError) && (
                  <div
                    style={{
                      maxWidth: 820,
                      width: "100%",
                      boxSizing: "border-box",
                      margin: "0 auto 18px",
                      padding: "14px 18px",
                      border: "1px solid var(--df-border-subtle)",
                      borderRadius: "var(--df-r-md)",
                      background: extractionError
                        ? "color-mix(in srgb, var(--df-accent-danger) 6%, transparent)"
                        : "var(--df-surface-recessed)",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    {extraction && !extractionError && (
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          border: "2px solid var(--df-border-subtle)",
                          borderTopColor: "var(--df-accent-user, var(--df-accent-ok))",
                          animation: "spin 1s linear infinite",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "var(--df-text-sm)",
                          color: extractionError
                            ? "var(--df-accent-danger)"
                            : "var(--df-text-primary)",
                        }}
                      >
                        {extractionError
                          ? `Erro ao extrair design.md: ${extractionError}`
                          : `Extraindo design system com ${extraction?.provider} · ${extraction?.model}`}
                      </div>
                      {extraction && !extractionError && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: "var(--df-text-xs)",
                            color: "var(--df-text-muted)",
                            fontFamily: "var(--df-font-mono)",
                          }}
                        >
                          {Math.max(0, Math.floor((Date.now() - extraction.startedAt) / 1000))}s
                          decorridos · roda em background, pode fechar tabs
                        </div>
                      )}
                    </div>
                    {extractionError && (
                      <button
                        type="button"
                        onClick={() => setExtractionError(null)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--df-text-muted)",
                          fontSize: "var(--df-text-xs)",
                        }}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                )}
                <DesignMdTab
                  md={md}
                  editing={editing}
                  draftMd={draftMd}
                  onDraftChange={setDraftMd}
                  onStartEdit={() => {
                    setDraftMd(md);
                    setEditing(true);
                  }}
                  onCancelEdit={() => setEditing(false)}
                  onSave={save}
                />
              </>
            )}

            {tab === "preview" && (
              <PreviewTab
                previewHtml={previewHtml}
                loading={previewLoading}
                generation={generation}
                generationError={generationError}
                onGenerate={() => setGenModalOpen(true)}
                onCancelGeneration={() => {
                  generationAbortRef.current?.abort();
                  // Remember this marker so the chained-preview watcher
                  // doesn't immediately re-adopt it (e.g. a stale orphan
                  // from a killed background run).
                  if (generation) dismissedPreviewMarkerRef.current = generation.startedAt;
                  setGeneration(null);
                }}
              />
            )}
          </>
        )}

        {genModalOpen && (
          <GeneratePreviewModal
            entry={entry}
            onClose={() => setGenModalOpen(false)}
            onSubmit={(provider, model) => {
              setGenModalOpen(false);
              startGeneration(provider, model);
            }}
          />
        )}

        {/* Empty-content guard: read succeeded but design.md has < 40 chars.
            This usually means the original generation failed silently.
            Surface clearly and offer an action. */}
        {!loading && !error && !editing && !parsed && md.trim().length < 40 && (
          <div
            style={{
              padding: "var(--df-sp-8) var(--df-sp-5)",
              textAlign: "center",
              color: "var(--df-text-secondary)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--df-accent-warn)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2
              style={{
                fontSize: "var(--df-text-md)",
                fontWeight: 500,
                margin: 0,
                color: "var(--df-text-primary)",
              }}
            >
              This DS has no content
            </h2>
            <p
              style={{ fontSize: "var(--df-text-sm)", maxWidth: 420, lineHeight: 1.55, margin: 0 }}
            >
              The <code style={{ fontFamily: "var(--df-font-mono)" }}>design.md</code> at{" "}
              <code style={{ fontFamily: "var(--df-font-mono)" }}>{entry.designMdPath}</code> exists
              but is empty — likely the original generation failed silently. Edit the file directly
              below, or remove this DS and create a new one.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 6,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                className="df-btn df-btn--primary"
                onClick={() => {
                  setEditing(true);
                  setDraftMd("");
                }}
              >
                Edit design.md
              </button>
              <button
                className="df-btn df-btn--secondary"
                onClick={() => {
                  // Broadcast so HomeScreen removes this DS from its list; then
                  // navigate back. HomeScreen's listener owns the persist write.
                  window.dispatchEvent(
                    new CustomEvent("df-ds-remove-request", { detail: { path: entry.path } }),
                  );
                  onBack();
                }}
              >
                Remove from list
              </button>
              <button className="df-btn df-btn--ghost" onClick={onBack}>
                Back to workspace
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Design.md tab — rendered markdown with an inline Edit toggle ────────

function DesignMdTab({
  md,
  editing,
  draftMd,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSave,
}: {
  md: string;
  editing: boolean;
  draftMd: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
}) {
  const html = useMemo(() => renderMarkdownSafe(md), [md]);

  // Inline edit mode — textarea blends with the rendered markdown
  // surface (no bordered container, no monospace switch, no skeu
  // recess). User feedback "modo edicao fosse no proprio conteudo,
  // que nao abrisse ui diferente". Save/Cancel float in the same
  // top-right slot where the Edit pencil used to sit.
  if (editing) {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            right: 0,
            top: -8,
            display: "flex",
            gap: 6,
            zIndex: 2,
          }}
        >
          <button
            type="button"
            onClick={onCancelEdit}
            className="df-btn df-btn--ghost"
            style={{ fontSize: "var(--df-text-xs)", padding: "4px 10px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="df-btn df-btn--primary"
            style={{ fontSize: "var(--df-text-xs)", padding: "4px 10px" }}
          >
            Save
          </button>
        </div>
        <textarea
          value={draftMd}
          onChange={(e) => onDraftChange(e.target.value)}
          spellCheck={false}
          autoFocus
          style={{
            // Match the rendered markdown article exactly: same width,
            // same font, same line-height. The only visible change on
            // entering edit mode is the cursor + the buttons up top —
            // the document itself stays in place.
            width: "100%",
            minHeight: "70vh",
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--df-text-primary)",
            fontFamily: "var(--df-font-mono)",
            fontSize: 14,
            lineHeight: 1.7,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
            display: "block",
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", position: "relative" }}>
      {/* Small ghost-style Edit toggle floating top-right of the read
          column. Activates markdown edit mode (textarea + Save/Cancel)
          without taking up topbar real-estate. */}
      <button
        type="button"
        onClick={onStartEdit}
        className="df-btn df-btn--ghost"
        title="Edit markdown"
        aria-label="Edit markdown"
        style={{
          position: "absolute",
          right: 0,
          top: -8,
          fontSize: "var(--df-text-xs)",
          padding: "4px 10px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        Edit
      </button>
      <article
        className="markdown-preview ds-design-md"
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--df-text-primary)",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ─── Preview tab — iframe of preview.html, or a Generate CTA ─────────────

function PreviewTab({
  previewHtml,
  loading,
  generation,
  generationError,
  onGenerate,
  onCancelGeneration,
}: {
  previewHtml: string | null;
  loading: boolean;
  generation: GenerationState | null;
  generationError: string | null;
  onGenerate: () => void;
  onCancelGeneration: () => void;
}) {
  const [height, setHeight] = useState(800);
  const [elapsed, setElapsed] = useState(0);
  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    if (!doc?.body) return;
    const measure = () => setHeight(doc.body.scrollHeight + 24);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc.body);
  };

  // Tick a wall-clock counter while generating so the user sees
  // progress instead of a frozen screen.
  useEffect(() => {
    if (!generation) {
      setElapsed(0);
      return;
    }
    const handle = setInterval(() => {
      setElapsed(Math.floor((Date.now() - generation.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, [generation]);

  // GENERATING — render a prominent banner with provider/model + elapsed
  // time + cancel button. Stays put even when previewHtml exists (the
  // user may be regenerating over the top of an existing preview).
  if (generation) {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            padding: "16px 20px",
            background: "var(--df-bg-section)",
            border: "1px solid var(--df-border-subtle)",
            borderRadius: "var(--df-r-md)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "2px solid var(--df-text-muted)",
              borderTopColor: "var(--df-text-primary)",
              animation: "spin 1s linear infinite",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--df-text-sm)",
                color: "var(--df-text-primary)",
                fontWeight: 500,
                marginBottom: 2,
              }}
            >
              Gerando preview com {generation.provider} · {generation.model}
            </div>
            <div
              style={{
                fontSize: "var(--df-text-xs)",
                color: "var(--df-text-muted)",
                fontFamily: "var(--df-font-mono)",
              }}
            >
              {mins > 0 ? `${mins}m ` : ""}
              {secs}s decorridos · roda em background, pode fechar tabs
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelGeneration}
            className="df-btn df-btn--ghost"
            style={{ fontSize: "var(--df-text-xs)", padding: "4px 10px" }}
          >
            Cancelar
          </button>
        </div>
        {previewHtml && (
          <div
            style={{
              borderRadius: "var(--df-r-2xl)",
              overflow: "hidden",
              border: "1px solid var(--df-border-subtle)",
              boxShadow: "var(--df-shadow-card)",
              opacity: 0.55,
            }}
          >
            <iframe
              title="Design system preview (stale while regenerating)"
              srcDoc={previewHtml}
              onLoad={onLoad}
              sandbox="allow-same-origin"
              style={{
                width: "100%",
                height,
                border: "none",
                display: "block",
                background: "transparent",
              }}
            />
          </div>
        )}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--df-text-muted)" }}>
        Carregando preview…
      </div>
    );
  }

  // ERROR — show message + retry CTA. The previous preview (if any)
  // stays accessible below the banner.
  if (generationError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            padding: "14px 18px",
            background: "color-mix(in srgb, var(--df-accent-warn) 12%, transparent)",
            border: "1px solid var(--df-accent-warn)",
            borderRadius: "var(--df-r-md)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--df-accent-warn)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div
            style={{
              flex: 1,
              fontSize: "var(--df-text-sm)",
              color: "var(--df-text-primary)",
              lineHeight: 1.5,
            }}
          >
            Falha ao gerar preview:{" "}
            <span style={{ fontFamily: "var(--df-font-mono)", fontSize: "var(--df-text-xs)" }}>
              {generationError}
            </span>
          </div>
          <button
            className="df-btn df-btn--primary"
            onClick={onGenerate}
            style={{ fontSize: "var(--df-text-xs)", padding: "6px 12px" }}
          >
            Tentar de novo
          </button>
        </div>
        {previewHtml && (
          <div
            style={{
              borderRadius: "var(--df-r-2xl)",
              overflow: "hidden",
              border: "1px solid var(--df-border-subtle)",
              boxShadow: "var(--df-shadow-card)",
            }}
          >
            <iframe
              title="Design system preview"
              srcDoc={previewHtml}
              onLoad={onLoad}
              sandbox="allow-same-origin"
              style={{
                width: "100%",
                height,
                border: "none",
                display: "block",
                background: "transparent",
              }}
            />
          </div>
        )}
      </div>
    );
  }

  if (!previewHtml) {
    return (
      <div
        style={{
          padding: "var(--df-sp-8) var(--df-sp-5)",
          textAlign: "center",
          color: "var(--df-text-secondary)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ color: "var(--df-text-muted)" }}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
        <h2
          style={{
            fontSize: "var(--df-text-md)",
            fontWeight: 500,
            margin: 0,
            color: "var(--df-text-primary)",
          }}
        >
          Ainda sem preview
        </h2>
        <p style={{ fontSize: "var(--df-text-sm)", lineHeight: 1.55, margin: 0 }}>
          O preview é um <code style={{ fontFamily: "var(--df-font-mono)" }}>preview.html</code>{" "}
          gerado por um modelo de IA aplicando o seu{" "}
          <code style={{ fontFamily: "var(--df-font-mono)" }}>design.md</code>. Escolha o provider e
          o modelo no próximo passo.
        </p>
        <button className="df-btn df-btn--primary" onClick={onGenerate}>
          Gerar Preview
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: "var(--df-r-2xl)",
        overflow: "hidden",
        border: "1px solid var(--df-border-subtle)",
        boxShadow: "var(--df-shadow-card)",
      }}
    >
      <iframe
        title="Design system preview"
        srcDoc={previewHtml}
        onLoad={onLoad}
        sandbox="allow-same-origin"
        style={{
          width: "100%",
          height,
          border: "none",
          display: "block",
          background: "transparent",
        }}
      />
    </div>
  );
}
