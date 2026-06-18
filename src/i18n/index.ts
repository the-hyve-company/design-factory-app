// i18n — minimal hook + module-level state.
//
// Design (v7):
//   · Module-level `_lang` is the source of truth at runtime.
//   · `t(key)` and `format()` work both inside and outside React.
//   · `useT()` subscribes to language-change events so components re-render
//     when the user flips the toggle in Settings.
//   · Persistence: GlobalConfig.language (filesystem, canonical) +
//     localStorage `df_language` (instant boot before bridge probes) + DB
//     fallback as `language` setting.
//   · Hot-switch: `setLang(next)` updates module state, persists, and
//     dispatches `df:language-change` on the window. Listeners (including
//     useT) re-render. No app reload needed.
//   · No new lib — single file ~80 LOC.

import { useEffect, useState, useCallback } from "react";
import { DEFAULT_LANG, LANG_VALUES, STRINGS, format as fmt, type Lang } from "./strings";

// ─── Module-level state ───────────────────────────────────────────────

let _lang: Lang = DEFAULT_LANG;

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANG_VALUES as ReadonlyArray<string>).includes(v);
}

/** Read whatever value is in localStorage at boot — runs synchronously
 *  before React mounts so the very first render already has the right
 *  language. The bridge-driven config read happens later in App.tsx and
 *  calls setLang() if the disk value differs (rare). */
function readBootLang(): Lang {
  try {
    if (typeof window === "undefined") return DEFAULT_LANG;
    const raw = window.localStorage?.getItem("df_language");
    return isLang(raw) ? raw : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

_lang = readBootLang();

// ─── Public API ───────────────────────────────────────────────────────

export const LANGUAGE_CHANGE_EVENT = "df:language-change";

/** Current language. Cheap, synchronous, no React. */
export function getLang(): Lang {
  return _lang;
}

/**
 * Lookup a string by key. Falls back: requested lang → pt → key itself.
 * The fallback to the key (not "") is intentional: missing keys surface
 * as "newproject.title" in the UI during dev so we catch gaps fast.
 */
export function t(key: string): string {
  const table = STRINGS[_lang] ?? STRINGS[DEFAULT_LANG];
  const v = table[key];
  if (typeof v === "string") return v;
  // Fallback to default language if requested lang is missing the key.
  const def = STRINGS[DEFAULT_LANG][key];
  if (typeof def === "string") return def;
  return key;
}

/** Convenience: lookup + positional format. */
export function tf(key: string, ...args: Array<string | number>): string {
  return fmt(t(key), ...args);
}

/** Programmatic setter — used by Settings + boot config rehydrate. */
export function setLang(next: Lang): void {
  if (!isLang(next) || next === _lang) return;
  _lang = next;
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("df_language", next);
      window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { lang: next } }));
    }
  } catch {
    /* swallow — non-fatal */
  }
}

// ─── React hook ───────────────────────────────────────────────────────

/**
 * Subscribe to language changes inside a React component. Returns a
 * stable `t` function and the current `lang`. The component re-renders
 * automatically when `setLang()` is called from anywhere in the app.
 *
 * Usage:
 *   const { t, lang } = useT();
 *   return <h1>{t("newproject.title")}</h1>;
 */
export function useT(): {
  t: (key: string) => string;
  tf: (key: string, ...args: Array<string | number>) => string;
  lang: Lang;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const onChange = () => force((n) => n + 1);
    if (typeof window === "undefined") return;
    window.addEventListener(LANGUAGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onChange);
  }, []);

  // Capture the current lang at render time so consumers can use it as a
  // dependency in their own effects.
  const lang = _lang;

  // Stable refs — t/tf delegate to module-level functions which read _lang.
  const localT = useCallback((key: string) => t(key), []);
  const localTf = useCallback(
    (key: string, ...args: Array<string | number>) => tf(key, ...args),
    [],
  );

  return { t: localT, tf: localTf, lang };
}

export type { Lang };
export { LANG_VALUES, USER_LANG_VALUES, DEFAULT_LANG } from "./strings";
