// Diagnostics buffer — captures errors, warnings, and dev-log events in a
// ring buffer that survives reloads via localStorage. The UI drawer reads
// from here and can dump the whole thing for bug reports.
//
// Install installDiagnostics() once at app boot (main.tsx).

const STORAGE_KEY = "df_diagnostics_v1";
const MAX_ENTRIES = 250;

export type DiagLevel = "error" | "warn" | "info" | "debug";

export interface DiagEntry {
  ts: number;
  level: DiagLevel;
  scope: string; // "console", "network", "bridge", "react", "ds", …
  message: string;
  detail?: string;
}

type Listener = (entries: DiagEntry[]) => void;

let buffer: DiagEntry[] = [];
const listeners = new Set<Listener>();
let installed = false;

function load(): DiagEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function save() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)));
  } catch {
    /* quota */
  }
}

function stringifyDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined;
  if (typeof detail === "string") return detail;
  if (detail instanceof Error) return `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`;
  try {
    return JSON.stringify(detail, null, 2).slice(0, 4000);
  } catch {
    return String(detail).slice(0, 4000);
  }
}

export function pushDiag(level: DiagLevel, scope: string, message: string, detail?: unknown) {
  const entry: DiagEntry = {
    ts: Date.now(),
    level,
    scope,
    message: String(message).slice(0, 1000),
    detail: stringifyDetail(detail),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  save();
  listeners.forEach((l) => {
    try {
      l(buffer);
    } catch {}
  });
}

export function getDiag(): DiagEntry[] {
  return [...buffer];
}

export function subscribeDiag(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearDiag() {
  buffer = [];
  save();
  listeners.forEach((l) => {
    try {
      l(buffer);
    } catch {}
  });
}

export interface DiagSnapshot {
  takenAt: string;
  userAgent: string;
  url: string;
  buildMode: string;
  storage: {
    used: number;
    keyCount: number;
    keys: Array<{ key: string; size: number }>;
  };
  entries: DiagEntry[];
}

export function snapshot(): DiagSnapshot {
  const keys: Array<{ key: string; size: number }> = [];
  let used = 0;
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) ?? "";
      keys.push({ key, size: value.length });
      used += value.length;
    }
  }
  keys.sort((a, b) => b.size - a.size);
  return {
    takenAt: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    url: typeof window !== "undefined" ? window.location.href : "",
    buildMode:
      typeof import.meta !== "undefined" && (import.meta as any).env?.MODE
        ? String((import.meta as any).env.MODE)
        : "unknown",
    storage: { used, keyCount: keys.length, keys },
    entries: [...buffer],
  };
}

export async function copySnapshotToClipboard(): Promise<boolean> {
  try {
    const text = JSON.stringify(snapshot(), null, 2);
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Install global hooks ─────────────────────────────────────────────────
// Idempotent: call once from main.tsx. Wraps console.error/warn, captures
// uncaught errors + unhandled rejections, mirrors df-dev-log events, and
// loads any persisted buffer.
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  buffer = load();

  if (typeof window !== "undefined") {
    window.addEventListener("error", (ev) => {
      pushDiag("error", "window.error", ev.message, {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: ev.error?.stack,
      });
    });
    window.addEventListener("unhandledrejection", (ev) => {
      pushDiag("error", "unhandled-rejection", String(ev.reason), {
        stack: (ev.reason as any)?.stack,
      });
    });
    window.addEventListener("df-dev-log", (ev) => {
      const d = (ev as CustomEvent).detail || {};
      const level: DiagLevel =
        d.level === "error"
          ? "error"
          : d.level === "warn"
            ? "warn"
            : d.level === "debug"
              ? "debug"
              : "info";
      pushDiag(level, "dev-log", d.message || "(no message)", d);
    });
  }

  // Wrap console.error + console.warn so ad-hoc console.error("[ds] ...") calls
  // surface in the drawer. We still forward to the real console.
  if (typeof console !== "undefined") {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      origError(...args);
      const first = args[0];
      const scope =
        typeof first === "string" && /^\[([a-z0-9-]+)\]/i.test(first)
          ? first.match(/^\[([a-z0-9-]+)\]/i)![1]
          : "console";
      const msg = args
        .map((a) => (typeof a === "string" ? a : (stringifyDetail(a) ?? "")))
        .join(" ")
        .slice(0, 1000);
      pushDiag("error", scope, msg, args.length > 1 ? args.slice(1) : undefined);
    };
    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      const first = args[0];
      const scope =
        typeof first === "string" && /^\[([a-z0-9-]+)\]/i.test(first)
          ? first.match(/^\[([a-z0-9-]+)\]/i)![1]
          : "console";
      const msg = args
        .map((a) => (typeof a === "string" ? a : (stringifyDetail(a) ?? "")))
        .join(" ")
        .slice(0, 1000);
      pushDiag("warn", scope, msg, args.length > 1 ? args.slice(1) : undefined);
    };
  }

  pushDiag("info", "boot", "Diagnostics installed");
}
