import { describe, expect, it } from "vitest";
import { findMatches, triggerAtCursor, type SlashCommand } from "./slash-data";

const commands: SlashCommand[] = [
  {
    id: "polish",
    trigger: "/polish",
    label: "Polish",
    description: "Tighten hierarchy",
    category: "Commands",
  },
  {
    id: "rewrite",
    trigger: "/rewrite",
    label: "Rewrite",
    description: "Fresh approach",
    category: "Commands",
  },
  {
    id: "tweaks",
    trigger: "/tweaks",
    label: "Tweaks",
    description: "Build live controls",
    category: "Actions",
  },
  {
    id: "skill-polish",
    trigger: "/polish",
    label: "Polish Skill",
    description: "Skill collision",
    category: "Skills",
  },
  {
    id: "brand",
    trigger: "/brand-audit",
    label: "Brand Audit",
    description: "Visual identity review",
    category: "Skills",
  },
];

describe("slash-data", () => {
  it("initial suggestions hide toolbar-only commands but preserve collisions and order", () => {
    const matches = findMatches("/", commands);
    expect(matches.map((cmd) => cmd.id)).toEqual(["polish", "rewrite", "skill-polish", "brand"]);
  });

  it("ranks trigger and label prefixes before substring matches", () => {
    const matches = findMatches("re", commands);
    expect(matches.map((cmd) => cmd.id)).toEqual(["rewrite", "brand"]);
  });

  it("matches substrings in descriptions for visible commands", () => {
    const matches = findMatches("identity", commands);
    expect(matches.map((cmd) => cmd.id)).toEqual(["brand"]);
  });

  it("keeps hidden commands out of substring matches but allows explicit prefixes", () => {
    expect(findMatches("controls", commands).map((cmd) => cmd.id)).not.toContain("tweaks");
    expect(findMatches("/tw", commands).map((cmd) => cmd.id)).toEqual(["tweaks"]);
  });

  it("extracts slash and at-trigger tokens at cursor positions", () => {
    expect(triggerAtCursor("/", 1)).toEqual({ token: "/", start: 0 });
    expect(triggerAtCursor("run /pol", "run /pol".length)).toEqual({ token: "/pol", start: 4 });
    expect(triggerAtCursor("ask @canvas now", "ask @canvas".length)).toEqual({
      token: "@canvas",
      start: 4,
    });
  });

  it("returns null outside a slash or at-token context", () => {
    expect(triggerAtCursor("plain text", "plain".length)).toBeNull();
    expect(triggerAtCursor("use /pol now", "use /pol now".length)).toBeNull();
  });
});
