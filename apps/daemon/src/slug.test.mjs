// regression tests — slug normalization for project folders.
// Locks the contract for ("zip 404 — UUID vs slug").
//
// Reference: see also `docs/agent-contract.md` §1 (project workspace).

import { describe, it, expect } from "vitest";
import { normalizeProjectSlug, sanitizeVersionId } from "./slug.mjs";

describe("normalizeProjectSlug — UUID-vs-slug regression", () => {
  it("lowercases and dashifies non-slug characters", () => {
    expect(normalizeProjectSlug("Aqua Field")).toBe("aqua-field");
    expect(normalizeProjectSlug("My Project!")).toBe("my-project");
  });

  it("preserves dots and underscores (legal slug chars)", () => {
    expect(normalizeProjectSlug("v1.2_test")).toBe("v1.2_test");
  });

  it("collapses runs of non-slug chars into a single dash", () => {
    expect(normalizeProjectSlug("foo!!!bar")).toBe("foo-bar");
    expect(normalizeProjectSlug("a   b  c")).toBe("a-b-c");
  });

  it("strips leading and trailing dashes", () => {
    expect(normalizeProjectSlug("---hello---")).toBe("hello");
    expect(normalizeProjectSlug("!!!world!!!")).toBe("world");
  });

  it("caps at 80 chars", () => {
    const long = "x".repeat(100);
    const slug = normalizeProjectSlug(long);
    expect(slug.length).toBe(80);
    expect(slug).toBe("x".repeat(80));
  });

  it("UUID input is preserved (would-be 404 path resolves)", () => {
    // The UUID itself is a valid slug — lowercase hex + dashes. Before
    // the fix, the bridge appended the UUID to /projects/{uuid}/zip
    // even though the folder on disk was /projects/{name-slug}/. This
    // test pins the normalization so the daemon always treats whatever
    // it gets as the canonical folder name. The fix is at the
    // call site (using the slug from the meta lookup, not the UUID) —
    // this test ensures the slug helper itself doesn't corrupt UUIDs.
    const uuid = "30a83bc7-7e22-4f8c-9b1e-aa44ee558800";
    expect(normalizeProjectSlug(uuid)).toBe(uuid);
  });

  it("returns empty string for input that normalizes to nothing", () => {
    expect(normalizeProjectSlug("")).toBe("");
    expect(normalizeProjectSlug("---")).toBe("");
    expect(normalizeProjectSlug("!!!")).toBe("");
    expect(normalizeProjectSlug(".")).toBe("");
    expect(normalizeProjectSlug("..")).toBe("");
  });

  it("does not produce parent-directory slugs", () => {
    expect(normalizeProjectSlug("../outside")).toBe("..-outside");
    expect(normalizeProjectSlug("../../outside")).toBe("..-..-outside");
    expect(normalizeProjectSlug("foo/../bar")).toBe("foo-..-bar");
  });

  it("returns empty string for non-string input", () => {
    // Defensive: caller bug should fall through to the 400 path, not
    // crash the daemon.
    expect(normalizeProjectSlug(undefined)).toBe("");
    expect(normalizeProjectSlug(null)).toBe("");
    expect(normalizeProjectSlug(42)).toBe("");
  });

  it("idempotent — normalizing twice yields the same string", () => {
    const inputs = ["Aqua Field", "v1.2_test", "30a83bc7-7e22-4f8c"];
    for (const input of inputs) {
      const once = normalizeProjectSlug(input);
      const twice = normalizeProjectSlug(once);
      expect(twice).toBe(once);
    }
  });

  it("Unicode and emoji are dashified (folder safety)", () => {
    expect(normalizeProjectSlug("café résumé")).toBe("caf-r-sum");
    expect(normalizeProjectSlug("hello 👋 world")).toBe("hello-world");
  });
});

describe("sanitizeVersionId — filesystem-version regressions", () => {
  it("preserves UUID hex case (mixed case allowed in filenames)", () => {
    const uuid = "v-1a2B3c4D5e";
    expect(sanitizeVersionId(uuid)).toBe(uuid);
  });

  it("preserves the v-{ts}-{rand} format produced by the frontend", () => {
    const vid = "v-1746556800000-abc123";
    expect(sanitizeVersionId(vid)).toBe(vid);
  });

  it("strips leading dots — no dotfile escapes", () => {
    // Defense in depth against an attacker submitting ".bashrc" or similar.
    expect(sanitizeVersionId(".bashrc")).toBe("bashrc");
    expect(sanitizeVersionId("..hidden")).toBe("hidden");
  });

  it("strips leading dashes", () => {
    expect(sanitizeVersionId("---vid")).toBe("vid");
  });

  it("dashifies runs of unsafe characters", () => {
    expect(sanitizeVersionId("foo / bar")).toBe("foo-bar");
    expect(sanitizeVersionId("a\\b\\c")).toBe("a-b-c");
  });

  it("caps at 80 chars", () => {
    const long = "v" + "1".repeat(120);
    const safe = sanitizeVersionId(long);
    expect(safe.length).toBe(80);
  });

  it("returns empty string for invalid input", () => {
    expect(sanitizeVersionId("")).toBe("");
    expect(sanitizeVersionId("...")).toBe("");
    expect(sanitizeVersionId(undefined)).toBe("");
    expect(sanitizeVersionId(null)).toBe("");
  });

  it("rejects path traversal attempts via separator dashification", () => {
    // Even if a malicious vid contains "../", slashes collapse to a
    // single dash and leading dots get stripped — so the resulting
    // filename can never navigate up directories. Internal dots survive
    // (legal filename char), but they can't form a separator pair
    // because there's no slash left to combine with.
    expect(sanitizeVersionId("../../../etc/passwd")).toBe("etc-passwd");
    const internal = sanitizeVersionId("foo/../bar");
    // Internal ".." survives but slashes are gone, so it's a single
    // filename like "foo-..-bar" — cannot escape directory.
    expect(internal).toBe("foo-..-bar");
    expect(internal.includes("/")).toBe(false);
  });
});
