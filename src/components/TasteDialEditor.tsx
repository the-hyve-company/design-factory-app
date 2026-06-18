import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DIAL_LANGUAGE,
  DIAL_KEYS,
  DIAL_STOPS,
  type DialDirection,
  type DialKey,
} from "@/runtime/canonical-plus-prompt";
import { db } from "@/lib/claude-bridge";
import { warn } from "@/lib/error-surface";

// TasteDialEditor — Settings panel for the canonical+ taste dials.
//
// 4-prompt model (user 2026-05-17): each dial now carries FOUR
// phrases — one per non-neutral stop on the 0/25/50/75/100 snap
// slider. Position 50 is neutral, no prompt. The editor exposes the
// 24 strings (6 dials × 4 stops) for free-form override.
//
// Storage shape (db.setSetting):
//   tasteDial:density:extremeLow   ← was `tasteDial:density:low`
//   tasteDial:density:softLow      ← new
//   tasteDial:density:softHigh     ← new
//   tasteDial:density:extremeHigh  ← was `tasteDial:density:high`
//   ... 24 keys total
//
// Migration: any existing :low → :extremeLow, :high → :extremeHigh.
// Two new soft slots seed empty (baseline DEFAULT_DIAL_LANGUAGE).
// Empty value = use baseline.

const DIAL_LABELS: Record<DialKey, { label: string; tags: Record<keyof DialDirection, string> }> = {
  density: {
    label: "Density",
    tags: { extremeLow: "Spare", softLow: "Quiet", softHigh: "Layered", extremeHigh: "Dense" },
  },
  motion: {
    label: "Motion",
    tags: { extremeLow: "Inert", softLow: "Quiet", softHigh: "Animated", extremeHigh: "Kinetic" },
  },
  contrast: {
    label: "Contrast",
    tags: { extremeLow: "Whisper", softLow: "Muted", softHigh: "Bold", extremeHigh: "Electric" },
  },
  interactions: {
    label: "Interactions",
    tags: {
      extremeLow: "Read-only",
      softLow: "Quiet",
      softHigh: "Playful",
      extremeHigh: "Tactile",
    },
  },
  surface: {
    label: "Surface",
    tags: { extremeLow: "Flat", softLow: "Soft", softHigh: "Tactile", extremeHigh: "Skeu" },
  },
  originality: {
    label: "Originality",
    tags: {
      extremeLow: "Strict",
      softLow: "Conventional",
      softHigh: "Authorial",
      extremeHigh: "Experimental",
    },
  },
};

// Stop → slider value, for the "(0)"/"(25)"/etc hints next to each
// textarea heading.
const STOP_VALUES: Record<keyof DialDirection, number> = {
  extremeLow: 0,
  softLow: 25,
  softHigh: 75,
  extremeHigh: 100,
};

function settingKey(dial: DialKey, stop: keyof DialDirection): string {
  return `tasteDial:${dial}:${stop}`;
}

// Legacy keys from the pre-4-prompt era. Read on hydration; if a new
// key is empty but the legacy one has content, we MIGRATE it by
// writing to the new key and clearing the old one. One-shot per slot.
function legacyKey(dial: DialKey, side: "low" | "high"): string {
  return `tasteDial:${dial}:${side}`;
}

export async function readTasteDialOverrides(): Promise<
  Partial<Record<DialKey, Partial<DialDirection>>>
> {
  const out: Partial<Record<DialKey, Partial<DialDirection>>> = {};
  await Promise.all(
    DIAL_KEYS.flatMap((dial) =>
      DIAL_STOPS.map(async (stop) => {
        try {
          const raw = await db.getSetting(settingKey(dial, stop));
          if (typeof raw === "string" && raw.trim().length > 0) {
            if (!out[dial]) out[dial] = {};
            (out[dial] as DialDirection)[stop] = raw;
          }
        } catch {
          /* tolerate; baseline kicks in */
        }
      }),
    ),
  );
  // Migrate any legacy :low / :high values into :extremeLow / :extremeHigh
  // when those targets are still empty. Best-effort; failure leaves the
  // baseline in place rather than dropping the override.
  await Promise.all(
    DIAL_KEYS.flatMap((dial) =>
      [
        { legacy: "low" as const, target: "extremeLow" as keyof DialDirection },
        { legacy: "high" as const, target: "extremeHigh" as keyof DialDirection },
      ].map(async ({ legacy, target }) => {
        const existing = out[dial]?.[target];
        if (typeof existing === "string" && existing.trim().length > 0) return;
        try {
          const raw = await db.getSetting(legacyKey(dial, legacy));
          if (typeof raw !== "string" || !raw.trim()) return;
          if (!out[dial]) out[dial] = {};
          (out[dial] as DialDirection)[target] = raw;
          // Persist forward + clear legacy so we don't re-migrate next mount.
          await db.setSetting(settingKey(dial, target), raw).catch(() => {});
          await db.setSetting(legacyKey(dial, legacy), "").catch(() => {});
        } catch {
          /* tolerate */
        }
      }),
    ),
  );
  return out;
}

export function TasteDialEditor() {
  // Local state mirrors what's in db.settings. We hydrate on mount and
  // save on blur (avoid hammering the bridge on every keystroke).
  const [values, setValues] = useState<Record<DialKey, DialDirection>>(() =>
    DIAL_KEYS.reduce(
      (acc, k) => {
        acc[k] = { ...DEFAULT_DIAL_LANGUAGE[k] };
        return acc;
      },
      {} as Record<DialKey, DialDirection>,
    ),
  );
  const [savedTickByKey, setSavedTickByKey] = useState<Partial<Record<string, number>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const overrides = await readTasteDialOverrides();
      if (cancelled) return;
      setValues((prev) => {
        const next = { ...prev };
        for (const dial of DIAL_KEYS) {
          const o = overrides[dial];
          if (!o) continue;
          next[dial] = {
            extremeLow: o.extremeLow ?? prev[dial].extremeLow,
            softLow: o.softLow ?? prev[dial].softLow,
            softHigh: o.softHigh ?? prev[dial].softHigh,
            extremeHigh: o.extremeHigh ?? prev[dial].extremeHigh,
          };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (dial: DialKey, stop: keyof DialDirection, text: string) => {
    const trimmed = text.trim();
    const baseline = DEFAULT_DIAL_LANGUAGE[dial][stop];
    // Empty OR matches baseline → clear the override.
    if (!trimmed || trimmed === baseline) {
      await db.setSetting(settingKey(dial, stop), "").catch(warn("setSetting:tasteDial::cleared"));
    } else {
      await db.setSetting(settingKey(dial, stop), text).catch(warn("setSetting:tasteDial::saved"));
    }
    const key = settingKey(dial, stop);
    setSavedTickByKey((p) => ({ ...p, [key]: Date.now() }));
    window.setTimeout(() => {
      setSavedTickByKey((p) => {
        if (p[key] && Date.now() - p[key]! < 1700) return p;
        const { [key]: _drop, ...rest } = p;
        void _drop;
        return rest;
      });
    }, 1800);
  }, []);

  const handleReset = useCallback(
    (dial: DialKey, stop: keyof DialDirection) => {
      setValues((p) => ({
        ...p,
        [dial]: { ...p[dial], [stop]: DEFAULT_DIAL_LANGUAGE[dial][stop] },
      }));
      void persist(dial, stop, DEFAULT_DIAL_LANGUAGE[dial][stop]);
    },
    [persist],
  );

  return (
    <>
      {/* Hero (kicker + title + intro paragraph) removed 2026-05-21 —
          user ask: "tirar esses hero editoriais, facilitar navegação
          e edição". InsumosPanel's parent header + active sub-tab pill
          already identify this surface; readers go straight to the dials. */}
      <section className="settings-group" style={{ borderTop: 0, paddingTop: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {DIAL_KEYS.map((dial) => {
            const labels = DIAL_LABELS[dial];
            const cur = values[dial];
            return (
              <div
                key={dial}
                style={{
                  border: "1px solid var(--df-border-subtle)",
                  borderRadius: "var(--df-r-lg, 10px)",
                  padding: "14px 16px",
                  background: "var(--df-surface-elevated)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--df-font-mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    color: "var(--df-text-faint)",
                    marginBottom: 12,
                  }}
                >
                  {labels.label}
                </div>

                {DIAL_STOPS.map((stop, i) => (
                  <div key={stop}>
                    {i === 2 && (
                      <div
                        style={{
                          margin: "12px 0",
                          height: 1,
                          background: "var(--df-border-subtle)",
                          position: "relative",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -8,
                            transform: "translateX(-50%)",
                            background: "var(--df-surface-elevated)",
                            padding: "0 8px",
                            fontFamily: "var(--df-font-mono)",
                            fontSize: 9,
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                            color: "var(--df-text-faint)",
                          }}
                        >
                          50 · neutral (no prompt)
                        </span>
                      </div>
                    )}
                    <DialStop
                      dial={dial}
                      stop={stop}
                      tag={labels.tags[stop]}
                      stopValue={STOP_VALUES[stop]}
                      value={cur[stop]}
                      baseline={DEFAULT_DIAL_LANGUAGE[dial][stop]}
                      saved={!!savedTickByKey[settingKey(dial, stop)]}
                      onChange={(text) =>
                        setValues((p) => ({ ...p, [dial]: { ...p[dial], [stop]: text } }))
                      }
                      onPersist={(text) => persist(dial, stop, text)}
                      onReset={() => handleReset(dial, stop)}
                    />
                    {i !== DIAL_STOPS.length - 1 && i !== 1 && <div style={{ height: 10 }} />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

interface DialStopProps {
  dial: DialKey;
  stop: keyof DialDirection;
  tag: string;
  stopValue: number;
  value: string;
  baseline: string;
  saved: boolean;
  onChange: (text: string) => void;
  onPersist: (text: string) => void;
  onReset: () => void;
}

function DialStop({
  dial,
  stop,
  tag,
  stopValue,
  value,
  baseline,
  saved,
  onChange,
  onPersist,
  onReset,
}: DialStopProps) {
  const isOverride = value.trim() !== baseline.trim() && value.trim().length > 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: "var(--df-font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: "var(--df-text-secondary)",
          }}
        >
          {stopValue} · {tag}
        </span>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontSize: 10,
            color: "var(--df-text-faint)",
          }}
        >
          {isOverride && <span>● override</span>}
          {saved && <span style={{ color: "var(--df-accent-ok, #5faa54)" }}>saved</span>}
          <button
            type="button"
            onClick={onReset}
            style={{
              background: "transparent",
              border: "1px solid var(--df-border-subtle)",
              borderRadius: 4,
              color: "var(--df-text-secondary)",
              padding: "2px 8px",
              fontSize: 10,
              cursor: "pointer",
            }}
            disabled={!isOverride}
            title="Restore default phrase"
          >
            Reset
          </button>
        </div>
      </div>
      <textarea
        id={`tasteDial-${dial}-${stop}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onPersist(e.target.value)}
        rows={2}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          background: "var(--df-surface-sunken-1)",
          border: "1px solid var(--df-border-subtle)",
          borderRadius: 6,
          color: "var(--df-text-primary)",
          fontFamily: "var(--df-font-mono)",
          fontSize: 12,
          lineHeight: 1.45,
          resize: "vertical",
          minHeight: 48,
        }}
      />
    </div>
  );
}
