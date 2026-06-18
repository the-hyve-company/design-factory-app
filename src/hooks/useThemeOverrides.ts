import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PRESET_NAME,
  emptyPreset,
  emptyThemeConfig,
  getThemeConfig,
  setThemeConfig,
  type ThemeConfig,
  type ThemeId,
  type ThemePreset,
} from "@/lib/theme-bridge";

const STYLE_TAG_ID = "df-theme-overrides";

function renderPresetCss(preset: ThemePreset): string {
  const block = (theme: ThemeId): string => {
    const entries = Object.entries(preset[theme] ?? {});
    if (entries.length === 0) return "";
    const decls = entries
      .filter(([k, v]) => k.startsWith("--") && typeof v === "string" && v.trim().length > 0)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    if (!decls) return "";
    return `:root[data-theme="${theme}"] {\n${decls}\n}`;
  };
  return [block("dark"), block("light")].filter(Boolean).join("\n\n");
}

function applyPreset(preset: ThemePreset): void {
  if (typeof document === "undefined") return;
  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  const next = renderPresetCss(preset);
  // Guard against re-writing identical CSS — setting textContent forces a
  // style recalc + repaint of every element using the affected vars, even
  // when the content is byte-identical. Without this, any spurious effect
  // re-fire (e.g. config object identity flap) would visibly flash the app.
  if (tag.textContent !== next) {
    tag.textContent = next;
  }
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Single source of truth for theme presets. Mounted once at the App
 *  root — applies the active preset on mount and live-updates when the
 *  user edits in Settings → Appearance. */
export function useThemeOverrides() {
  const [config, setConfig] = useState<ThemeConfig>(emptyThemeConfig());
  const [loaded, setLoaded] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await getThemeConfig();
      if (cancelled) return;
      setConfig(cfg);
      applyPreset(cfg.presets[cfg.active] ?? emptyPreset());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-apply on every change (live preview without save)
  useEffect(() => {
    if (!loaded) return;
    applyPreset(config.presets[config.active] ?? emptyPreset());
  }, [config, loaded]);

  // ── Token mutations (always target the active preset) ───────────
  const setTokenOverride = useCallback((theme: ThemeId, varName: string, value: string | null) => {
    setConfig((prev) => {
      const active = prev.active;
      const preset = prev.presets[active] ?? emptyPreset();
      const themeMap = { ...preset[theme] };
      if (value === null || value.trim() === "") {
        delete themeMap[varName];
      } else {
        themeMap[varName] = value;
      }
      return {
        ...prev,
        presets: { ...prev.presets, [active]: { ...preset, [theme]: themeMap } },
      };
    });
  }, []);

  const resetTheme = useCallback((theme: ThemeId) => {
    setConfig((prev) => {
      const active = prev.active;
      const preset = prev.presets[active] ?? emptyPreset();
      return {
        ...prev,
        presets: { ...prev.presets, [active]: { ...preset, [theme]: {} } },
      };
    });
  }, []);

  // ── Preset management ──────────────────────────────────────────
  const switchPreset = useCallback((name: string) => {
    setConfig((prev) => (prev.presets[name] ? { ...prev, active: name } : prev));
  }, []);

  const createPreset = useCallback((name: string, fromActive = false) => {
    setConfig((prev) => {
      const cleanName = name.trim() || `Preset ${Object.keys(prev.presets).length + 1}`;
      const taken = new Set(Object.keys(prev.presets));
      const finalName = uniqueName(cleanName, taken);
      const seed = fromActive ? (prev.presets[prev.active] ?? emptyPreset()) : emptyPreset();
      const cloned: ThemePreset = {
        dark: { ...seed.dark },
        light: { ...seed.light },
      };
      return {
        active: finalName,
        presets: { ...prev.presets, [finalName]: cloned },
      };
    });
  }, []);

  /** Seed a new preset with arbitrary values (used by "Capture current state"). */
  const seedPreset = useCallback((name: string, preset: ThemePreset) => {
    setConfig((prev) => {
      const cleanName = name.trim() || `Snapshot ${Object.keys(prev.presets).length + 1}`;
      const taken = new Set(Object.keys(prev.presets));
      const finalName = uniqueName(cleanName, taken);
      return {
        active: finalName,
        presets: {
          ...prev.presets,
          [finalName]: { dark: { ...preset.dark }, light: { ...preset.light } },
        },
      };
    });
  }, []);

  const renamePreset = useCallback((from: string, to: string) => {
    setConfig((prev) => {
      const cleanTo = to.trim();
      if (!cleanTo || cleanTo === from || !prev.presets[from] || prev.presets[cleanTo]) return prev;
      const { [from]: moved, ...rest } = prev.presets;
      return {
        active: prev.active === from ? cleanTo : prev.active,
        presets: { ...rest, [cleanTo]: moved },
      };
    });
  }, []);

  const deletePreset = useCallback((name: string) => {
    setConfig((prev) => {
      if (!prev.presets[name] || Object.keys(prev.presets).length === 1) return prev;
      const { [name]: _, ...rest } = prev.presets;
      const nextActive = prev.active === name ? Object.keys(rest)[0] : prev.active;
      return { active: nextActive, presets: rest };
    });
  }, []);

  const save = useCallback(async () => {
    await setThemeConfig(config);
  }, [config]);

  const reload = useCallback(async () => {
    const cfg = await getThemeConfig();
    setConfig(cfg);
  }, []);

  const activePreset = config.presets[config.active] ?? emptyPreset();
  const presetNames = Object.keys(config.presets);

  return {
    config,
    activeName: config.active,
    activePreset,
    presetNames,
    setTokenOverride,
    resetTheme,
    switchPreset,
    createPreset,
    seedPreset,
    renamePreset,
    deletePreset,
    save,
    reload,
    loaded,
    DEFAULT_PRESET_NAME,
  };
}
