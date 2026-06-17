// defaults-canonicalization.test.ts — sanity-check the 7 canonical
// defaults categories live in /data/ and export the expected shapes.
//
// User direction 2026-05-18: every default surface must live in
// src/data/ with a `DEFAULT_*` export. The 7 categories:
//   canvas · formats · rules · dials · commands · skills · system prompts
//
// These tests catch silent regressions where a refactor moves a
// default body out of /data/ or breaks a category's surface shape.

import { describe, it, expect } from "vitest";
import { DEFAULT_CANVAS_PRESETS } from "@/data/canvas-presets";
import { DEFAULT_FORMAT_TAXONOMY } from "@/data/format-taxonomy";
import { DEFAULT_BUILTIN_RULES } from "@/data/rules-taxonomy";
import { DEFAULT_BUILTIN_DIALS, DIAL_KEYS, DIAL_STOPS, stopForValue } from "@/data/dials-taxonomy";
import {
  DEFAULT_BUILTIN_COMMANDS,
  commandsByKind,
  findCommandByTrigger,
} from "@/data/commands-taxonomy";
import { DEFAULT_BUILTIN_SKILLS } from "@/data/skills-taxonomy";
import {
  DEFAULT_BUILTIN_PROMPTS,
  EDITABLE_PROMPT_IDS,
  getDefaultPromptBody,
} from "@/data/prompts-taxonomy";

describe("defaults canonicalisation / 7 categories present in /data/", () => {
  it("1) canvas presets — at least 4 entries", () => {
    expect(DEFAULT_CANVAS_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("2) format taxonomy — at least 4 categories with items", () => {
    expect(DEFAULT_FORMAT_TAXONOMY.length).toBeGreaterThanOrEqual(4);
    const totalItems = DEFAULT_FORMAT_TAXONOMY.reduce((acc, c) => acc + c.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(12);
  });

  it("3) builtin rules — at least 5", () => {
    expect(DEFAULT_BUILTIN_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("4) builtin dials — 6 dials × 4 stops = 24 phrases", () => {
    expect(DIAL_KEYS.length).toBe(6);
    expect(DIAL_STOPS.length).toBe(4);
    for (const key of DIAL_KEYS) {
      for (const stop of DIAL_STOPS) {
        const phrase = DEFAULT_BUILTIN_DIALS[key][stop];
        expect(phrase, `${key}.${stop} must be non-empty`).toBeTruthy();
        expect(phrase.length).toBeGreaterThan(10);
      }
    }
  });

  it("5) builtin commands — nine editorial agent verbs only", () => {
    // User ask 2026-05-21: trimmed the taxonomy to the nine
    // editorial verbs. App handlers live on the canvas toolbar
    // pills; Claude passthroughs were dropped.
    expect(DEFAULT_BUILTIN_COMMANDS.length).toBe(9);
    expect(commandsByKind("agent").length).toBe(9);
    expect(commandsByKind("app").length).toBe(0);
    expect(commandsByKind("provider").length).toBe(0);
  });

  it("5b) commands — every entry has a unique id + trigger", () => {
    const ids = new Set<string>();
    const triggers = new Set<string>();
    for (const c of DEFAULT_BUILTIN_COMMANDS) {
      expect(ids.has(c.id), `duplicate id: ${c.id}`).toBe(false);
      expect(triggers.has(c.trigger), `duplicate trigger: ${c.trigger}`).toBe(false);
      ids.add(c.id);
      triggers.add(c.trigger);
    }
  });

  it("5c) agent commands carry a non-empty systemPrompt body", () => {
    for (const c of commandsByKind("agent")) {
      expect(c.agentSystemPrompt?.length, `${c.id} agent body must be non-empty`).toBeGreaterThan(
        0,
      );
    }
  });

  it("6) builtin skills — placeholder empty (user uploads manually)", () => {
    // The contract is "exists and is a frozen array" — empty today.
    expect(Array.isArray(DEFAULT_BUILTIN_SKILLS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BUILTIN_SKILLS)).toBe(true);
  });

  it("7) builtin prompts — 3 editable ids with non-empty bodies", () => {
    expect(EDITABLE_PROMPT_IDS.length).toBe(3);
    for (const id of EDITABLE_PROMPT_IDS) {
      const body = getDefaultPromptBody(id);
      expect(body.length, `${id} prompt body must be non-empty`).toBeGreaterThan(50);
    }
    expect(DEFAULT_BUILTIN_PROMPTS.map((p) => p.id).sort()).toEqual([
      "generate",
      "refine",
      "tweaks",
    ]);
  });
});

describe("defaults canonicalisation / category separation", () => {
  it("commands and skills do NOT share ids (separation invariant)", () => {
    const cmdIds = new Set(DEFAULT_BUILTIN_COMMANDS.map((c) => c.id));
    const skillIds = new Set(DEFAULT_BUILTIN_SKILLS.map((s) => s.id));
    for (const id of skillIds) {
      expect(cmdIds.has(id), `${id} is both a command and a skill — separate concepts`).toBe(false);
    }
  });

  it("agent commands and provider commands use distinct triggers", () => {
    const agentTriggers = new Set(commandsByKind("agent").map((c) => c.trigger));
    const providerTriggers = new Set(commandsByKind("provider").map((c) => c.trigger));
    for (const t of agentTriggers) {
      expect(providerTriggers.has(t), `${t} ambiguous (agent vs provider)`).toBe(false);
    }
  });
});

describe("defaults canonicalisation / dial value → stop mapping", () => {
  it("snap stops map correctly", () => {
    expect(stopForValue(0)).toBe("extremeLow");
    expect(stopForValue(9)).toBe("extremeLow");
    expect(stopForValue(25)).toBe("softLow");
    expect(stopForValue(50)).toBe(null); // neutral — no phrase
    expect(stopForValue(75)).toBe("softHigh");
    expect(stopForValue(100)).toBe("extremeHigh");
  });

  it("neutral grace window: 38..62 returns null", () => {
    for (let v = 38; v <= 62; v++) {
      expect(stopForValue(v), `${v} should be neutral`).toBe(null);
    }
  });
});

describe("defaults canonicalisation / commands lookup helpers", () => {
  it("findCommandByTrigger resolves with and without leading slash", () => {
    const a = findCommandByTrigger("/polish");
    const b = findCommandByTrigger("polish");
    expect(a?.id).toBe("polish");
    expect(b?.id).toBe("polish");
  });

  it("findCommandByTrigger returns null for unknown", () => {
    expect(findCommandByTrigger("/nonsense-xyz")).toBeNull();
  });
});
