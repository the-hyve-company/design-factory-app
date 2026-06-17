import type { Verb } from "@/runtime/verbs/registry";

/**
 * ActiveVerbPill — appears at the top of the chat panel while an
 * editorial verb is streaming. Shimmer-animated background + breathing
 * dot + label. Designed to be unmissable so the user knows the verb
 * is actually running.
 */
export function ActiveVerbPill({ verb }: { verb: Verb | null }) {
  if (!verb) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px 9px 14px",
        background: "var(--df-surface-elevated)",
        borderRadius: 999,
        boxShadow: `
          inset 0 1px 0 var(--df-skeu-top-light),
          inset 0 0 0 1px var(--df-border-subtle),
          0 1px 2px var(--df-skeu-near),
          0 6px 18px -4px var(--df-skeu-deep-near),
          0 14px 36px -8px var(--df-skeu-deep-far)
        `,
        backdropFilter: "blur(12px) saturate(1.05)",
        WebkitBackdropFilter: "blur(12px) saturate(1.05)",
        fontSize: "var(--df-text-sm)",
        color: "var(--df-text-primary)",
        zIndex: 80,
        animation: "df-verb-pill-in 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        overflow: "hidden",
      }}
    >
      {/* Shimmer band sweeping across the pill — Apple Intelligence vibe */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(110deg, transparent 0%, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%, transparent 100%)",
          backgroundSize: "260% 100%",
          animation: "df-verb-shimmer 1.8s linear infinite",
          pointerEvents: "none",
        }}
      />

      <span
        aria-hidden
        style={{
          position: "relative",
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: "var(--df-text-primary)",
          boxShadow: "0 0 0 4px color-mix(in srgb, var(--df-text-primary) 14%, transparent)",
          animation: "df-verb-pill-breath 1400ms ease-in-out infinite",
        }}
      />
      <span
        style={{
          position: "relative",
          fontWeight: "var(--df-fw-semibold, 600)",
          letterSpacing: "var(--df-tracking-tight)",
        }}
      >
        {verb.label}
      </span>
      <span
        style={{
          position: "relative",
          color: "var(--df-text-muted)",
          fontFamily: "var(--df-font-mono)",
          fontSize: 10,
          letterSpacing: "0.04em",
        }}
      >
        running
        <span className="df-verb-dots" aria-hidden>
          ...
        </span>
      </span>
      <style>{`
        @keyframes df-verb-pill-in {
          from { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
          to { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes df-verb-pill-breath {
          0%, 100% { opacity: 0.55; transform: scale(0.85); }
          50%      { opacity: 1;    transform: scale(1.18); }
        }
        @keyframes df-verb-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes df-verb-dots {
          0%, 20%   { content: ""; }
          40%       { content: "."; }
          60%       { content: ".."; }
          80%, 100% { content: "..."; }
        }
        .df-verb-dots {
          display: inline-block;
          width: 14px;
          text-align: left;
        }
        .df-verb-dots::after {
          content: "";
          animation: df-verb-dots 1400ms steps(4, end) infinite;
        }
        .df-verb-dots {
          color: transparent;
        }
      `}</style>
    </div>
  );
}
