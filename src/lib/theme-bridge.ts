// Theme bridge — HTTP client for the daemon's /config/theme endpoint.
// Schema v2 (presets): { active, presets: { name: { dark, light } } }
// Daemon migrates legacy v1 ({dark, light}) into a "default" preset on read.

import { BRIDGE_URL } from "@/lib/claude-bridge";

export type ThemeId = "dark" | "light";

export interface ThemePreset {
  dark: Record<string, string>;
  light: Record<string, string>;
}

export interface ThemeConfig {
  active: string;
  presets: Record<string, ThemePreset>;
}

export const DEFAULT_PRESET_NAME = "default";

export function emptyPreset(): ThemePreset {
  return { dark: {}, light: {} };
}

export function emptyThemeConfig(): ThemeConfig {
  return { active: DEFAULT_PRESET_NAME, presets: { [DEFAULT_PRESET_NAME]: emptyPreset() } };
}

export async function getThemeConfig(): Promise<ThemeConfig> {
  try {
    const res = await fetch(`${BRIDGE_URL}/config/theme`);
    if (!res.ok) return emptyThemeConfig();
    const body = (await res.json()) as Partial<ThemeConfig>;
    if (body && body.presets && Object.keys(body.presets).length > 0) {
      const active =
        body.active && body.presets[body.active] ? body.active : Object.keys(body.presets)[0];
      return { active, presets: body.presets as Record<string, ThemePreset> };
    }
    return emptyThemeConfig();
  } catch {
    return emptyThemeConfig();
  }
}

export async function setThemeConfig(config: ThemeConfig): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/config/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `bridge HTTP ${res.status}`);
  }
}

/** Editable color token catalog. */
export interface EditableToken {
  id: string;
  label: string;
  group: TokenGroup;
}

export type TokenGroup = "Surfaces" | "Text" | "Borders" | "Accents";

export const EDITABLE_TOKENS: EditableToken[] = [
  // Surfaces
  { id: "--df-bg-sunken", label: "Background sunken", group: "Surfaces" },
  { id: "--df-bg-base", label: "Background base", group: "Surfaces" },
  { id: "--df-bg-section", label: "Background section", group: "Surfaces" },
  { id: "--df-surface-raised", label: "Surface raised", group: "Surfaces" },
  { id: "--df-surface-elevated", label: "Surface elevated", group: "Surfaces" },
  // Text
  { id: "--df-text-primary", label: "Text primary", group: "Text" },
  { id: "--df-text-secondary", label: "Text secondary", group: "Text" },
  { id: "--df-text-muted", label: "Text muted", group: "Text" },
  { id: "--df-text-faint", label: "Text faint", group: "Text" },
  // Borders
  { id: "--df-border-subtle", label: "Border subtle", group: "Borders" },
  { id: "--df-border-hover", label: "Border hover", group: "Borders" },
  { id: "--df-border-strong", label: "Border strong", group: "Borders" },
  // Accents (shared across themes by default — overrides apply per-theme via specificity)
  { id: "--df-accent-user", label: "Accent (success/info)", group: "Accents" },
  { id: "--df-accent-warn", label: "Accent warn", group: "Accents" },
  { id: "--df-accent-danger", label: "Accent danger", group: "Accents" },
];

/** Read the live computed value of a CSS var for a given theme. */
export function getComputedTokenValue(varName: string, theme: ThemeId): string {
  if (typeof document === "undefined") return "";
  const root = document.documentElement;
  const active = (root.getAttribute("data-theme") as ThemeId | null) ?? "dark";
  if (active === theme) {
    return getComputedStyle(root).getPropertyValue(varName).trim();
  }
  const original = root.getAttribute("data-theme");
  root.setAttribute("data-theme", theme);
  const v = getComputedStyle(root).getPropertyValue(varName).trim();
  if (original) root.setAttribute("data-theme", original);
  else root.removeAttribute("data-theme");
  return v;
}
