// ChatHistoryDropdown — "+" button at the top of the chat that opens a
// menu with "New chat" + the list of past chats for the current project.
// Each chat = a .df/chat/{threadId}.jsonl file on disk; daemon's
// /fs/chat-list returns metadata.
//
// Rules:
// - "main" is the legacy default thread; if it has messages, it shows up
//   in the list. Otherwise hidden so first-time projects don't see a
//   placeholder entry.
// - New chat creates `chat-{epochSec36}` and selects it; the chat-load
//   effect on EditorScreen hydrates the empty thread.
// - Click on a past chat → switches activeThreadId; chat-load effect
//   pulls its messages.

import { useEffect, useRef, useState } from "react";
import { listChatThreads, type ChatThreadSummary } from "@/lib/claude-bridge";
import { useT } from "@/i18n";

interface Props {
  projectSlug: string;
  activeThreadId: string;
  onSwitch: (threadId: string) => void;
}

function newThreadId(): string {
  const t = Math.floor(Date.now() / 1000).toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `chat-${t}${r}`;
}

function formatTime(
  ms: number,
  t: (k: string) => string,
  tf: (k: string, ...a: Array<string | number>) => string,
): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return t("chat.history.time.justnow");
  if (s < 3600) return tf("chat.history.time.minutes", Math.floor(s / 60));
  if (s < 86400) return tf("chat.history.time.hours", Math.floor(s / 3600));
  return tf("chat.history.time.days", Math.floor(s / 86400));
}

export function ChatHistoryDropdown({ projectSlug, activeThreadId, onSwitch }: Props) {
  const { t, tf } = useT();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fetch list when dropdown opens
  useEffect(() => {
    if (!open || !projectSlug) return;
    setLoading(true);
    void listChatThreads(projectSlug)
      .then((t) => setThreads(t))
      .finally(() => setLoading(false));
  }, [open, projectSlug]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const handleNewChat = () => {
    onSwitch(newThreadId());
    setOpen(false);
  };

  const handlePick = (threadId: string) => {
    if (threadId !== activeThreadId) onSwitch(threadId);
    setOpen(false);
  };

  // Hide empty "main" entry on brand-new projects so the dropdown isn't
  // littered with placeholder rows. Threads with msgCount > 0 always show.
  const visibleThreads = threads.filter((t) => t.msgCount > 0 || t.threadId !== "main");

  return (
    <div ref={rootRef} style={rootStyle}>
      <button
        type="button"
        className="df-btn df-btn--icon"
        onClick={() => setOpen((o) => !o)}
        title={t("chat.history.title")}
        aria-label={t("chat.history.aria")}
        style={{ position: "relative" }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {open && (
        <div role="menu" style={menuStyle}>
          <button
            type="button"
            role="menuitem"
            onClick={handleNewChat}
            style={newItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--df-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t("chat.history.new")}</span>
          </button>
          {visibleThreads.length > 0 && (
            <>
              <div style={separatorStyle}>{t("chat.history.past")}</div>
              {visibleThreads.map((th) => {
                const isActive = th.threadId === activeThreadId;
                return (
                  <button
                    key={th.threadId}
                    type="button"
                    role="menuitem"
                    onClick={() => handlePick(th.threadId)}
                    style={threadItemStyle(isActive)}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        e.currentTarget.style.background = "var(--df-interactive-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={threadLabelRowStyle}>
                      <span style={threadLabelStyle}>
                        {th.firstMsg ||
                          (th.threadId === "main" ? t("chat.history.main") : th.threadId)}
                      </span>
                      <span style={threadMetaStyle}>{formatTime(th.mtime, t, tf)}</span>
                    </div>
                    <span style={threadCountStyle}>
                      {th.msgCount}{" "}
                      {th.msgCount === 1 ? t("chat.history.msg") : t("chat.history.msgs")}
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {loading && <div style={loadingStyle}>{t("chat.history.loading")}</div>}
        </div>
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  // Pin above sibling chat fade/scrim layers so the dropdown isn't cut.
  zIndex: 1200,
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  minWidth: 320,
  maxHeight: 480,
  overflow: "auto",
  background: "var(--df-surface-elevated)",
  border: "1px solid var(--df-border-subtle)",
  borderRadius: 8,
  boxShadow: "var(--df-shadow-card, 0 12px 32px rgba(0,0,0,0.32))",
  padding: "4px 0",
  zIndex: 1300,
  isolation: "isolate",
};

const newItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 14px",
  background: "transparent",
  border: "none",
  color: "var(--df-text-primary)",
  fontFamily: "var(--df-font-body, inherit)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  textAlign: "left",
};

const separatorStyle: React.CSSProperties = {
  padding: "8px 14px 4px",
  borderTop: "1px solid var(--df-border-subtle)",
  marginTop: 4,
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  color: "var(--df-text-faint)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

function threadItemStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "100%",
    padding: "8px 14px",
    background: active ? "var(--df-interactive-hover, rgba(255,255,255,0.04))" : "transparent",
    border: "none",
    borderLeft: active ? "2px solid var(--df-accent-user)" : "2px solid transparent",
    color: "var(--df-text-primary)",
    fontFamily: "var(--df-font-body, inherit)",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
  };
}

const threadLabelRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  justifyContent: "space-between",
};

const threadLabelStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const threadMetaStyle: React.CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  color: "var(--df-text-faint)",
  flex: "none",
};

const threadCountStyle: React.CSSProperties = {
  fontFamily: "var(--df-font-mono)",
  fontSize: 10,
  color: "var(--df-text-faint)",
};

const loadingStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontFamily: "var(--df-font-mono)",
  fontSize: 11,
  color: "var(--df-text-faint)",
  textAlign: "center",
};
