// Unit tests for stripHtmlFence — locks down the HTML-extraction
// heuristics the /ds/generate-preview endpoint relies on. Each test
// is a real scenario we've seen in provider responses:
//
//   - clean raw HTML (perfect compliance — most providers)
//   - leading ``` or ```html fence wrapping the whole response
//   - prose preamble ("Here's the HTML:") before <!DOCTYPE
//   - mid-text fenced ```html block surrounded by analysis (regression
//     for founder repro 2026-05-28 "provider returned no recognizable
//     HTML (got 65932B)" — claude returned 65KB of design analysis
//     with the HTML buried in a single code block in the middle)
//   - trailing prose after </html> ("Let me know if you'd like…")

import { describe, it, expect } from "vitest";
import { stripHtmlFence } from "./ds-preview-prompt.mjs";

const HTML = `<!DOCTYPE html>\n<html><head><title>x</title></head><body>ok</body></html>`;

describe("stripHtmlFence", () => {
  it("returns raw HTML unchanged when the response is already clean", () => {
    expect(stripHtmlFence(HTML)).toBe(HTML);
  });

  it("strips a leading triple-backtick fence (no language tag)", () => {
    const wrapped = "```\n" + HTML + "\n```";
    expect(stripHtmlFence(wrapped)).toBe(HTML);
  });

  it("strips a leading ```html fence (language tag)", () => {
    const wrapped = "```html\n" + HTML + "\n```";
    expect(stripHtmlFence(wrapped)).toBe(HTML);
  });

  it("drops prose preamble before <!DOCTYPE", () => {
    const withPreamble = "Here's the HTML:\n\n" + HTML;
    expect(stripHtmlFence(withPreamble)).toBe(HTML);
  });

  it("extracts a fenced ```html block buried in surrounding analysis", () => {
    // The 65KB-of-prose case. Model returned a markdown analysis with
    // the actual HTML in a single fenced block deep in the middle of
    // commentary. The doctype-search alone misses it (doctype is way
    // past the start) — we look for any fenced html block first.
    const wrapped =
      "# Design Analysis\n\n" +
      "I'll create a preview for this design system. Let me walk through " +
      "the tokens first:\n\n## Tokens\n- bg: white\n- fg: black\n\n" +
      "## The HTML\n\n```html\n" + HTML + "\n```\n\n" +
      "## Notes\n\nThe layout uses a 12-column grid…";
    expect(stripHtmlFence(wrapped)).toBe(HTML);
  });

  it("truncates trailing prose after </html>", () => {
    const withTrailing = HTML + "\n\nLet me know if you'd like adjustments!";
    expect(stripHtmlFence(withTrailing)).toBe(HTML);
  });

  it("handles preamble + mid-block fence + trailing prose all at once", () => {
    const messy =
      "Sure! Here's the design system preview:\n\n```html\n" +
      HTML +
      "\n```\n\nFeel free to tweak the tokens.";
    expect(stripHtmlFence(messy)).toBe(HTML);
  });

  it("returns empty string for non-string input", () => {
    expect(stripHtmlFence(null)).toBe("");
    expect(stripHtmlFence(undefined)).toBe("");
    expect(stripHtmlFence(42)).toBe("");
  });

  it("returns the input trimmed when no HTML markers are present (caller will reject)", () => {
    // The caller (/ds/generate-preview) re-tests with /<html[\s>]/ and
    // throws if missing, so stripHtmlFence just returns what it has.
    const noHtml = "Sorry, I cannot generate that.";
    expect(stripHtmlFence(noHtml)).toBe(noHtml);
  });
});
