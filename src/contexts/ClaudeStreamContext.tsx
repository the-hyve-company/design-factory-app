// ClaudeStreamContext — hoists the singleton stream state out of
// EditorScreen so it survives route navigation.
//
// Before: `useClaude()` was instantiated inside EditorScreen. Navigating
// to /settings unmounted EditorScreen → unlistenRef died → SSE
// connection torn down → in-flight assistant response lost. User
// repro 2026-05-11 on project `newsss-1jvw`: started "Aplicar 16
// comentários", clicked Settings, came back, response was gone.
//
// After: the Provider lives at App level (above the Router's Routes).
// It calls `useClaudeState()` once and exposes the full return object
// via Context. Any consumer (today only EditorScreen) reads the same
// singleton instance. Navigating between routes does NOT unmount the
// Provider, so `unlistenRef`, the watchdog, the accumulated text, and
// the stream status all survive.
//
// Side-channel callbacks (onSession / onToolCall / onInterrupted) are
// still passed by the caller on each `generate(...)` call — when the
// caller unmounts, those closures become stale and their setMessages
// invocations silently no-op (React drops state updates against an
// unmounted component). The stream itself continues; the assistant's
// disk-side `chat-snapshot` write loop (driven by EditorScreen's
// useEffect on messages) pauses until the caller remounts and resyncs
// messages from disk + the live `output` text from this context.
//
// Future expansion (out of scope here): move message state per project
// into this context so re-entry shows the full assistant reply even if
// the user navigated away mid-stream. Today the user still has to
// rely on the daemon-side snapshot to recover partial responses.

import { createContext, useContext, type ReactNode } from "react";
import { useClaudeState, type UseClaudeReturn } from "@/hooks/useClaude";

const ClaudeStreamContext = createContext<UseClaudeReturn | null>(null);

export function ClaudeStreamProvider({ children }: { children: ReactNode }) {
  const value = useClaudeState();
  return <ClaudeStreamContext.Provider value={value}>{children}</ClaudeStreamContext.Provider>;
}

/** Read the singleton Claude stream state. Must be called inside a
 *  `<ClaudeStreamProvider>`. Throws otherwise — silent fallback would
 *  mask routing/render-tree mistakes that would lead back to the
 *  per-component-instance regression this Provider was created to
 *  prevent. */
export function useClaudeStream(): UseClaudeReturn {
  const ctx = useContext(ClaudeStreamContext);
  if (!ctx) {
    throw new Error(
      "useClaudeStream() must be used inside <ClaudeStreamProvider>. " +
        "Add the provider at the App level, above your Routes.",
    );
  }
  return ctx;
}
