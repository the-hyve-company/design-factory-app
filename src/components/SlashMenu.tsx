import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SlashCommand } from "./slash-data";

// Component-only file: data + helpers live in ./slash-data so React Fast
// Refresh can hot-update SlashMenu without forcing a full page reload.
// Importers of constants (DF_BUILTINS, CLAUDE_BUILTINS, etc) should pull
// from "@/components/slash-data" directly — this file no longer re-exports
// them. 2026-04-27.

interface Props {
  matches: SlashCommand[];
  highlightIdx: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (idx: number) => void;
  /** Anchor element (the chat input box). Menu is portaled to body and
      positioned with its bottom aligned to the anchor's top minus gap. */
  anchor: HTMLElement | null;
}

export function SlashMenu({ matches, highlightIdx, onSelect, onHover, anchor }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);

  // Compute viewport coordinates of the menu based on the anchor rect.
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    const gap = 8;
    const vh = window.innerHeight;
    setPos({
      left: r.left,
      bottom: vh - r.top + gap,
      width: r.width,
    });
    const onWin = () => {
      const rr = anchor.getBoundingClientRect();
      setPos({ left: rr.left, bottom: window.innerHeight - rr.top + gap, width: rr.width });
    };
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [anchor]);

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { cmd: SlashCommand; idx: number }[]>();
    matches.forEach((cmd, idx) => {
      const cat = cmd.category ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push({ cmd, idx });
    });
    return Array.from(map.entries());
  }, [matches]);

  if (!pos) return null;

  const styleAttrs: React.CSSProperties = {
    position: "fixed",
    left: pos.left,
    bottom: pos.bottom,
    width: pos.width,
    maxWidth: "min(520px, 92vw)",
  };

  if (matches.length === 0) {
    return createPortal(
      <div className="slash-menu" style={styleAttrs}>
        <div style={{ padding: 10, fontSize: 11, color: "var(--df-text-faint)" }}>No matches</div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="slash-menu" ref={listRef} style={styleAttrs}>
      {byCategory.map(([cat, items]) => (
        <div key={cat}>
          <div className="slash-menu-heading">{cat}</div>
          {items.map(({ cmd, idx }) => (
            <button
              key={cmd.id}
              data-idx={idx}
              onMouseEnter={() => onHover(idx)}
              onClick={(e) => {
                e.preventDefault();
                onSelect(cmd);
              }}
              className={`slash-menu-item${idx === highlightIdx ? " is-active" : ""}`}
              title={cmd.description ? `${cmd.label} — ${cmd.description}` : cmd.label}
            >
              <span className="slash-menu-label">{cmd.label}</span>
              {cmd.description && <span className="slash-menu-desc">{cmd.description}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
