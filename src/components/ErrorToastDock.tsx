// ErrorToastDock — surfaces runtime errors that would otherwise be silent.
//
// Subscribes to error-surface listeners and renders a stack of dismissible
// toasts in the bottom-right. Auto-dismiss after 8s; user can click "x"
// to remove sooner. Multiple errors stack.
//
// Mounted ONCE in App.tsx. Listens globally — any module that calls
// surfaceError() lands here.

import { useEffect, useState } from "react";
import { onSurfacedError, type SurfacedError } from "@/lib/error-surface";

interface ToastEntry extends SurfacedError {
  uid: number;
}

const AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE = 4;
let nextUid = 1;

export function ErrorToastDock() {
  const [items, setItems] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const off = onSurfacedError((err) => {
      const uid = nextUid++;
      const entry: ToastEntry = { ...err, uid };
      setItems((prev) => [...prev, entry].slice(-MAX_VISIBLE));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.uid !== uid));
      }, AUTO_DISMISS_MS);
    });
    return off;
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="error-dock" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.uid} className={`error-toast error-toast--${t.severity}`}>
          <div className="error-toast-head">
            <span className="error-toast-context">{t.context}</span>
            <button
              type="button"
              className="error-toast-close"
              onClick={() => setItems((prev) => prev.filter((x) => x.uid !== t.uid))}
              aria-label="Dismiss"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div className="error-toast-msg">{t.message}</div>
        </div>
      ))}
    </div>
  );
}
