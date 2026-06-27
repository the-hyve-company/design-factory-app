import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { resolveBridgeWs } from "@/lib/bridge-url";
import "@xterm/xterm/css/xterm.css";

interface Props {
  onClose: () => void;
  /** Render as an inline flex-filling block (for canvas tabs) instead of a fixed bottom drawer. */
  inline?: boolean;
}

// Same-origin bridge: VITE_BRIDGE_URL is "/__bridge" (relative) under the
// launcher, so the terminal socket rides the page origin through the Vite proxy
// (wss when the page is https). See src/lib/bridge-url.ts.
const BRIDGE_WS = resolveBridgeWs(
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env?.VITE_BRIDGE_URL
    : undefined,
  typeof window !== "undefined" ? window.location.host : undefined,
  typeof window !== "undefined" ? window.location.protocol : undefined,
);

type ConnState = "connecting" | "connected" | "disconnected" | "error";

// Skeumorphic redesign 2026-04-27: tactile toolbar (Clear / Copy / Close),
// recessed terminal frame, status pill (connecting/connected/disconnected),
// SVG icons. xterm engine + behavior unchanged.
export function TerminalDrawer({ onClose, inline }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");

  useEffect(() => {
    if (!hostRef.current) return;

    // Resolve a CSS custom property to a string at construction time. xterm
    // accepts color strings, so we read tokens once at mount.
    const css = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const term = new Terminal({
      convertEol: true,
      // User ask 2026-05-20: "texto ta todo espaçado, mal formatado, quero
      // o padrao funcional, nao invente moda" — drop DS mono token (could be
      // a proportional/styled font), use xterm-native tight line-height.
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      cursorBlink: true,
      theme: {
        // Chrome (bg / fg / cursor / selection) reads the terminal-specific
        // tokens that DO NOT flip on theme change — terminal is always dark.
        // ANSI codes (red / green / yellow / blue ...) preserve canonical
        // shell convention so `git status` and friends still differentiate.
        // Approved 2026-04-27: keep ANSI, neutralize chrome.
        background: css("--df-terminal-bg") || "#0F0F0D",
        foreground: css("--df-terminal-fg") || "#D7E0CC",
        cursor: css("--df-terminal-cursor") || "#D7E0CC",
        selectionBackground: css("--df-terminal-selection") || "rgba(215, 224, 204, 0.22)",
        black: "#000000",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#D7E0CC",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#FFFFFF",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;

    // ─── Batched stdout: accumulate chunks in a buffer and flush once per
    // animation frame. Without this, a single `cat bigfile.log` triggers one
    // term.write() per WebSocket message, each forcing a reflow. Batching cuts
    // 200+ writes/sec down to 60 (vsync) and dramatically reduces jank when
    // a noisy command runs in a background tab.
    let flushQueued = false;
    const pending: string[] = [];
    const host = hostRef.current;
    const flush = () => {
      flushQueued = false;
      if (pending.length === 0) return;
      term.write(pending.join(""));
      pending.length = 0;
    };
    const schedule = () => {
      if (flushQueued) return;
      flushQueued = true;
      requestAnimationFrame(flush);
    };

    const ws = new WebSocket(`${BRIDGE_WS}/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnState("connected");
      term.writeln("\x1b[2m[bridge] connected · type 'claude /login' or any shell command\x1b[0m");
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "data") {
          pending.push(msg.data);
          schedule();
        } else if (msg.type === "exit") {
          pending.push(`\r\n\x1b[2m[process exited ${msg.exitCode}]\x1b[0m`);
          schedule();
        }
      } catch {}
    };
    ws.onerror = () => {
      setConnState("error");
      term.writeln("\r\n\x1b[31m[bridge] connection error\x1b[0m");
    };
    ws.onclose = () => {
      setConnState("disconnected");
      term.writeln("\r\n\x1b[2m[bridge] disconnected\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "data", data }));
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    // ─── Re-fit when the host becomes visible again. Tabs hidden via
    // display:none don't fire `resize`, so xterm's rows/cols can end up stale
    // after a switch. IntersectionObserver fires on visibility change.
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting && ent.target === host) {
            try {
              fit.fit();
            } catch {}
          }
        }
      },
      { threshold: 0.01 },
    );
    io.observe(host);

    // Re-fit on container size changes too. IntersectionObserver only fires
    // on visibility — not on layout shifts (e.g. devtools open, panel resize,
    // canvas tab divider drag). Without this the terminal can clip the bottom
    // rows after the parent container changes height. Users reported
    // "terminal cortando parte de baixo" 2026-04-27.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(host);

    const onResize = () => {
      try {
        fit.fit();
      } catch {}
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      io.disconnect();
      ro.disconnect();
      try {
        ws.close();
      } catch {}
      try {
        term.dispose();
      } catch {}
    };
  }, []);

  const handleClear = () => {
    termRef.current?.clear();
  };

  const handleCopy = async () => {
    const term = termRef.current;
    if (!term) return;
    // Prefer the user's selection if any; fall back to the entire scrollback.
    const selection = term.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
      } catch {}
      return;
    }
    // Walk the buffer and concatenate visible lines.
    const lines: string[] = [];
    const buf = term.buffer.active;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    const text = lines.join("\n").replace(/\n+$/, "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  // Grayscale brightness gradient — locked to terminal-fg (always
  // warm-light, doesn't theme-flip). The terminal chrome is dark in
  // both app themes, so binding state colors to --df-* surface tokens
  // would make the status pill disappear in light mode. Locking to
  // terminal tokens keeps the status readable.
  const stateColor = {
    connecting: "rgba(215, 224, 204, 0.42)",
    connected: "rgba(215, 224, 204, 0.92)",
    disconnected: "rgba(215, 224, 204, 0.55)",
    error: "var(--df-terminal-fg)",
  }[connState];

  const stateLabel = {
    connecting: "connecting",
    connected: "connected",
    disconnected: "disconnected",
    error: "error",
  }[connState];

  return (
    <div
      style={
        inline
          ? {
              flex: 1,
              minHeight: 0,
              background: "var(--df-terminal-bg)",
              display: "flex",
              flexDirection: "column",
            }
          : {
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              height: 360,
              background: "var(--df-terminal-bg)",
              borderTop: "1px solid var(--df-border-subtle)",
              boxShadow: "var(--df-shadow-lg)",
              zIndex: 180,
              display: "flex",
              flexDirection: "column",
            }
      }
    >
      {/* Common-terminal style header — minimal, dark, monospace
       * status text. The skeu pill (which was disappearing in light
       * theme) and the recess frame around xterm are intentionally
       * absent here — the chrome is closer to Warp / iTerm than to
       * the rest of the DF skeu language. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 14px",
          borderBottom: "1px solid rgba(215, 224, 204, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: stateColor,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 11,
              color: "rgba(215, 224, 204, 0.92)",
              letterSpacing: "0.02em",
            }}
          >
            Terminal
          </span>
          <span
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: 10,
              color: stateColor,
              letterSpacing: "0.04em",
            }}
          >
            · {stateLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <MinimalBtn onClick={handleClear} title="Clear scrollback (process keeps running)">
            Clear
          </MinimalBtn>
          <MinimalBtn
            onClick={handleCopy}
            title="Copy selection (or full buffer if nothing selected)"
          >
            Copy
          </MinimalBtn>
          <MinimalBtn onClick={onClose} title="Close terminal" iconOnly>
            <XIcon size={11} color="rgba(215, 224, 204, 0.7)" />
          </MinimalBtn>
        </div>
      </div>

      {/* Terminal area — flat fill, no skeu recess, no margin. Closer to a
       * native terminal app: chrome on top, content fills the rest. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          ref={hostRef}
          style={{ flex: 1, minHeight: 0, padding: "10px 14px 14px", overflow: "hidden" }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Inline SVG icons
// ============================================================================

interface IconProps {
  size?: number;
  color?: string;
}

function XIcon({ size = 12, color = "currentColor" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Minimal text/icon button — terminal chrome should feel native (Warp / iTerm
// / VS Code integrated terminal). No skeu socket, no glow. Just hoverable
// monospace text on dark.
function MinimalBtn({
  onClick,
  children,
  title,
  iconOnly = false,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  iconOnly?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: iconOnly ? "4px 6px" : "3px 8px",
        background: hover ? "rgba(215, 224, 204, 0.08)" : "transparent",
        border: "none",
        borderRadius: 4,
        color: hover ? "rgba(215, 224, 204, 0.95)" : "rgba(215, 224, 204, 0.7)",
        fontFamily: "var(--df-font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        cursor: "pointer",
        userSelect: "none",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
