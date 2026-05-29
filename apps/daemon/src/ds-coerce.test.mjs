// Unit tests for coerceDesignMd — locks down the design.md extraction
// repair/validation the /ds/generate-design-md endpoint relies on.
// Each case is a real provider-response shape:
//
//   - well-formed doc (perfect compliance) → untouched, ok
//   - UNCLOSED frontmatter + ## body (founder repro 2026-05-29, claude
//     opus 10663B) → repaired with a closing fence, ok
//   - whole-body ```markdown fence → stripped, ok
//   - heading-first doc, no frontmatter → ok
//   - tool-use summary prose (no frontmatter, no heading) → rejected
//   - long prose summary that happens to contain a ## heading → rejected
//   - short prose lead-in before frontmatter → sliced, ok

import { describe, it, expect } from "vitest";
import { coerceDesignMd } from "./ds-coerce.mjs";

const FRONTMATTER = `---
name: design-factory
description: Skeuomorphic, dark-first design system.
colors:
  primary: "#5FAA54"
  surface: "#1B1A16"
typography:
  display:
    fontFamily: "Geist"
    fontSize: 38px
    fontWeight: 700`;

const BODY = `## Overview

A tactile, skeuomorphic system.

## Do's and Don'ts

- **Do** keep shadows warm-tinted.
- **Don't** reintroduce pills.`;

describe("coerceDesignMd", () => {
  it("leaves a well-formed doc (closed frontmatter + body) untouched", () => {
    const doc = `${FRONTMATTER}\n---\n\n${BODY}`;
    const r = coerceDesignMd(doc);
    expect(r.ok).toBe(true);
    expect(r.md).toBe(doc);
  });

  it("repairs an UNCLOSED frontmatter (founder repro: claude omits closing ---)", () => {
    // No closing `---` — straight from YAML into `## Overview`.
    const broken = `${FRONTMATTER}\n\n${BODY}`;
    const r = coerceDesignMd(broken);
    expect(r.ok).toBe(true);
    // closing fence inserted before the first heading
    expect(/^---\s*\n[\s\S]*?\n---\s*\n/.test(r.md)).toBe(true);
    expect(r.md).toContain("## Overview");
    expect(r.md).toContain("typography:");
  });

  it("strips a whole-body ```markdown fence", () => {
    const doc = `${FRONTMATTER}\n---\n\n${BODY}`;
    const wrapped = "```markdown\n" + doc + "\n```";
    const r = coerceDesignMd(wrapped);
    expect(r.ok).toBe(true);
    expect(r.md.startsWith("---")).toBe(true);
  });

  it("accepts a heading-first doc with no frontmatter", () => {
    const r = coerceDesignMd(`# My Design System\n\nSome real content here that is well over forty chars.`);
    expect(r.ok).toBe(true);
  });

  it("slices a short prose lead-in before the frontmatter", () => {
    const r = coerceDesignMd(`Here's the design.md:\n\n${FRONTMATTER}\n---\n\n${BODY}`);
    expect(r.ok).toBe(true);
    expect(r.md.startsWith("---")).toBe(true);
  });

  it("rejects a tool-use summary with no frontmatter and no heading", () => {
    const r = coerceDesignMd(
      "I've written the DESIGN.md to /tmp/sandbox/design.md. It covers the color palette, typography ramp, spacing scale, and component tokens for the system.",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a long prose summary even if it contains a ## heading", () => {
    const longPreamble = "I analyzed the source files and wrote the design system specification to disk. ".repeat(4);
    const r = coerceDesignMd(`${longPreamble}\n\n## What the document covers\n\n- colors\n- typography`);
    expect(r.ok).toBe(false);
  });

  it("rejects empty / too-short input", () => {
    expect(coerceDesignMd("").ok).toBe(false);
    expect(coerceDesignMd("nope").ok).toBe(false);
  });
});
