// SearchableDropdown.test.tsx — render snapshot tests via renderToStaticMarkup.
//
// Project pattern (no @testing-library/react in deps): we render to static
// markup and assert on the resulting HTML. This covers the contract:
//   · open=false → empty render
//   · search input gates by searchThreshold
//   · footer actions render with the caret
//   · clear button gates on (selectedId && onClear)
//   · selected item renders the check glyph

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SearchableDropdown, type SearchableDropdownItem } from "./SearchableDropdown";

const BIG: SearchableDropdownItem<string>[] = [
  { id: "a", label: "Alpha", payload: "A" },
  { id: "b", label: "Beta", payload: "B" },
  { id: "g", label: "Gamma", payload: "G" },
  { id: "d", label: "Delta", payload: "D" },
  { id: "e", label: "Epsilon", payload: "E" },
  { id: "z", label: "Zeta", payload: "Z" },
];

const SMALL: SearchableDropdownItem<string>[] = BIG.slice(0, 3);

function html(props: Parameters<typeof SearchableDropdown>[0]): string {
  return renderToStaticMarkup(createElement(SearchableDropdown, props));
}

describe("SearchableDropdown — render contract", () => {
  it("returns empty render when open=false", () => {
    expect(
      html({
        open: false,
        onClose: () => {},
        items: BIG,
        onPick: () => {},
      }),
    ).toBe("");
  });

  it("renders all items when open=true", () => {
    const out = html({
      open: true,
      onClose: () => {},
      items: BIG,
      onPick: () => {},
    });
    for (const it of BIG) {
      expect(out).toContain(it.label);
    }
  });

  it("shows search input when items >= threshold", () => {
    const out = html({
      open: true,
      onClose: () => {},
      items: BIG,
      onPick: () => {},
      searchThreshold: 6,
      searchPlaceholder: "Buscar…",
    });
    expect(out).toContain('placeholder="Buscar…"');
  });

  it("hides search input when items < threshold", () => {
    const out = html({
      open: true,
      onClose: () => {},
      items: SMALL,
      onPick: () => {},
      searchThreshold: 6,
      searchPlaceholder: "Buscar…",
    });
    expect(out).not.toContain('placeholder="Buscar…"');
  });

  it("renders footer-action items with caret", () => {
    const items: SearchableDropdownItem<string>[] = [
      ...SMALL,
      { id: "more", label: "View more", footerAction: true },
    ];
    const out = html({
      open: true,
      onClose: () => {},
      items,
      onPick: () => {},
    });
    expect(out).toContain("View more");
    expect(out).toContain("sd-pop-opt--footer");
    expect(out).toContain("›"); // caret
  });

  it("renders clear button only when selectedId + onClear are both provided", () => {
    // Without selectedId — no clear row.
    const noSelect = html({
      open: true,
      onClose: () => {},
      items: BIG,
      onPick: () => {},
      onClear: () => {},
      clearLabel: "LIMPAR",
    });
    expect(noSelect).not.toContain("LIMPAR");

    // With selectedId — clear row appears.
    const withSelect = html({
      open: true,
      onClose: () => {},
      items: BIG,
      selectedId: "a",
      onPick: () => {},
      onClear: () => {},
      clearLabel: "LIMPAR",
    });
    expect(withSelect).toContain("LIMPAR");
    expect(withSelect).toContain("sd-pop-opt--clear");
  });

  it("marks selected item with the check glyph", () => {
    const out = html({
      open: true,
      onClose: () => {},
      items: BIG,
      selectedId: "g",
      onPick: () => {},
    });
    // The selected option carries `is-selected` class and the ✓ glyph.
    expect(out).toContain('aria-selected="true"');
    // Selected button should have is-selected.
    expect(out).toMatch(/data-sd-idx="\d"[^>]*is-selected/);
    expect(out).toContain("✓");
  });

  it("respects anchor variants in the popover className", () => {
    const top = html({
      open: true,
      onClose: () => {},
      items: BIG,
      onPick: () => {},
      anchor: "top-end",
    });
    expect(top).toContain("sd-pop--top-end");

    const bot = html({
      open: true,
      onClose: () => {},
      items: BIG,
      onPick: () => {},
      anchor: "bottom-start",
    });
    expect(bot).toContain("sd-pop--bottom-start");
  });
});
