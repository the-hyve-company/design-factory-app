import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSkillsRegistry,
  type Skill,
  type SkillsRegistry,
  type SkillSource,
} from "@/lib/claude-bridge";

/**
 * useSkillRegistry — source-classified skill state for a given cwd.
 *
 * Contract (Frame blueprint):
 * - Scan-on-demand (no filesystem watcher). Re-scan triggers: cwd change,
 *   manual rescan(), window regains focus (throttled 10s).
 * - bySource is the canonical grouping. skills is the flat merge for consumers
 *   that don't care about origin (e.g. slash-menu search).
 * - byTrigger surfaces collisions — the same `/canvas` can appear in both df
 *   and project sources. Array value per key.
 * - Lookup is pure (no I/O). Resolution of "which skill runs" lives in the
 *   dispatcher (PR 5), not in this hook.
 */

const FOCUS_THROTTLE_MS = 10_000;

export type CollisionLookup = {
  matches: Skill[];
  resolved: Skill | null; // default pick per precedence
  hasCollision: boolean;
};

export interface UseSkillRegistry {
  registry: SkillsRegistry | null;
  skills: Skill[];
  bySource: Record<SkillSource, Skill[]>;
  byTrigger: Map<string, Skill[]>;
  isScanning: boolean;
  lastScanAt: number | null;
  error: string | null;
  truncated: boolean;
  rescan: () => Promise<void>;
  lookup: (trigger: string) => CollisionLookup;
}

const EMPTY_BY_SOURCE: Record<SkillSource, Skill[]> = {
  df: [],
  project: [],
  global: [],
  builtin: [],
};

// Precedence order when the user doesn't explicitly pick a collision winner.
// df (user-managed) wins over project > global > builtin.
const PRECEDENCE: SkillSource[] = ["df", "project", "global", "builtin"];

function resolveCollision(matches: Skill[]): Skill | null {
  if (matches.length === 0) return null;
  for (const src of PRECEDENCE) {
    const hit = matches.find((s) => s.source === src);
    if (hit) return hit;
  }
  return matches[0];
}

function flatten(registry: SkillsRegistry | null): Skill[] {
  if (!registry) return [];
  const out: Skill[] = [];
  for (const bucket of Object.values(registry.sources)) {
    if (Array.isArray(bucket.items)) out.push(...bucket.items);
  }
  return out;
}

function groupBySource(skills: Skill[]): Record<SkillSource, Skill[]> {
  const base: Record<SkillSource, Skill[]> = { df: [], project: [], global: [], builtin: [] };
  for (const s of skills) {
    if (base[s.source]) base[s.source].push(s);
  }
  return base;
}

function groupByTrigger(skills: Skill[]): Map<string, Skill[]> {
  const map = new Map<string, Skill[]>();
  for (const s of skills) {
    const arr = map.get(s.trigger);
    if (arr) arr.push(s);
    else map.set(s.trigger, [s]);
  }
  return map;
}

export function useSkillRegistry(cwd: string | null | undefined): UseSkillRegistry {
  const [registry, setRegistry] = useState<SkillsRegistry | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFocusScanRef = useRef<number>(0);
  const inFlightRef = useRef<AbortController | null>(null);

  const doScan = useCallback(async (targetCwd: string | null | undefined) => {
    // Scan even when cwd is null — builtin and df (user) skills surface without
    // a workspace. Only project-scoped skills require cwd to be set.
    inFlightRef.current?.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    setIsScanning(true);
    setError(null);
    try {
      const r = await fetchSkillsRegistry(targetCwd ?? null);
      if (ctrl.signal.aborted) return;
      if (r) setRegistry(r);
      else setError("Could not reach skills registry");
    } catch (e) {
      if (!ctrl.signal.aborted) setError(String(e));
    } finally {
      if (!ctrl.signal.aborted) setIsScanning(false);
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void doScan(cwd ?? null);
  }, [cwd, doScan]);

  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusScanRef.current < FOCUS_THROTTLE_MS) return;
      lastFocusScanRef.current = now;
      void doScan(cwd ?? null);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [cwd, doScan]);

  const rescan = useCallback(() => doScan(cwd ?? null), [cwd, doScan]);

  const skills = flatten(registry);
  const bySource = registry ? groupBySource(skills) : EMPTY_BY_SOURCE;
  const byTrigger = groupByTrigger(skills);

  const lookup = useCallback(
    (trigger: string): CollisionLookup => {
      const matches = byTrigger.get(trigger) ?? [];
      return {
        matches,
        resolved: resolveCollision(matches),
        hasCollision: matches.length > 1,
      };
    },
    [byTrigger],
  );

  return {
    registry,
    skills,
    bySource,
    byTrigger,
    isScanning,
    lastScanAt: registry?.scanned_at ?? null,
    error,
    truncated: !!registry?.truncated,
    rescan,
    lookup,
  };
}
