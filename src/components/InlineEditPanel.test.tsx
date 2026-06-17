// InlineEditPanel.test.tsx — server-render shape tests + pure helper tests.
//
// Project pattern (no @testing-library/react in deps): renderToStaticMarkup
// + HTML substring assertions. State-dependent behavior (BoxSidesField
// expanded toggle) is exercised via the pure parse/format helpers.
//
// History: re-aligned to the floating layout on 2026-05-20 after the
// fixed-right drawer (#156) was reverted. Bucket-based contextual
// rendering added on the same pass.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  InlineEditPanel,
  PANEL_WIDTH,
  parseBoxSides,
  formatBoxSides,
  pxifyLength,
  rgbToHex,
  opacityToPercent,
  percentToOpacity,
  getBucket,
  extractTagFromPath,
} from "./InlineEditPanel";
import type { InlineEditSelectPayload, InlineEditStyles } from "@/runtime/inline-edit-bridge";

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

function makeStyles(over: Partial<InlineEditStyles> = {}): Required<InlineEditStyles> {
  return {
    fontFamily: "Geist, system-ui, sans-serif",
    fontWeight: "400",
    fontSize: "16px",
    color: "rgb(20, 24, 32)",
    textAlign: "left",
    lineHeight: "1.5",
    letterSpacing: "0px",
    width: "auto",
    height: "auto",
    opacity: "1",
    padding: "8px 16px",
    margin: "0px",
    borderWidth: "0px",
    borderStyle: "none",
    borderColor: "rgb(0, 0, 0)",
    borderRadius: "0px",
    ...over,
  };
}

function makeSelection(over: Partial<InlineEditSelectPayload> = {}): InlineEditSelectPayload {
  return {
    path: "body[1] > h1[1]",
    text: "Hello world",
    styles: makeStyles(),
    rect: { x: 24, y: 48, width: 320, height: 36 },
    scrollY: 0,
    ...over,
  };
}

/** Mimic a viewport rect for the iframe. The floating panel requires
 *  iframeRect to render — null hides it. */
function makeIframeRect(over: Partial<DOMRect> = {}): DOMRect {
  const base = {
    x: 280,
    y: 60,
    width: 1000,
    height: 700,
    top: 60,
    right: 1280,
    bottom: 760,
    left: 280,
    toJSON: () => ({}),
  };
  return { ...base, ...over } as DOMRect;
}

function render(props: Parameters<typeof InlineEditPanel>[0]): string {
  return renderToStaticMarkup(createElement(InlineEditPanel, props));
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

describe("pxifyLength", () => {
  it("appends px to bare integers", () => {
    expect(pxifyLength("12")).toBe("12px");
  });
  it("appends px to bare floats", () => {
    expect(pxifyLength("1.5")).toBe("1.5px");
  });
  it("passes through values with units", () => {
    expect(pxifyLength("1rem")).toBe("1rem");
    expect(pxifyLength("auto")).toBe("auto");
    expect(pxifyLength("16px")).toBe("16px");
  });
  it("passes through shorthand", () => {
    expect(pxifyLength("8 16 8 16")).toBe("8 16 8 16");
  });
  it("returns empty for empty / whitespace", () => {
    expect(pxifyLength("")).toBe("");
    expect(pxifyLength("   ")).toBe("");
  });
});

describe("rgbToHex", () => {
  it("converts rgb()", () => {
    expect(rgbToHex("rgb(255, 85, 36)")).toBe("#ff5524");
  });
  it("converts rgba()", () => {
    expect(rgbToHex("rgba(255, 85, 36, 0.5)")).toBe("#ff5524");
  });
  it("passes hex through", () => {
    expect(rgbToHex("#ff5524")).toBe("#ff5524");
  });
  it("returns empty on unparseable", () => {
    expect(rgbToHex("currentColor")).toBe("");
    expect(rgbToHex("")).toBe("");
  });
});

describe("opacityToPercent / percentToOpacity", () => {
  it("formats 0..1 as percent", () => {
    expect(opacityToPercent("0.8")).toBe("80%");
    expect(opacityToPercent("1")).toBe("100%");
    expect(opacityToPercent("0")).toBe("0%");
  });
  it("converts percent to 0..1", () => {
    expect(percentToOpacity("80%")).toBe("0.8");
    expect(percentToOpacity("100%")).toBe("1");
  });
  it("treats bare numbers >1 as percent", () => {
    expect(percentToOpacity("80")).toBe("0.8");
  });
  it("clamps to 0..1", () => {
    expect(percentToOpacity("200%")).toBe("1");
    expect(percentToOpacity("-10%")).toBe("0");
  });
});

describe("parseBoxSides", () => {
  it("expands 1 value to all four sides", () => {
    expect(parseBoxSides("8px")).toEqual({
      top: "8px",
      right: "8px",
      bottom: "8px",
      left: "8px",
    });
  });
  it("expands 2 values to vertical + horizontal", () => {
    expect(parseBoxSides("8px 16px")).toEqual({
      top: "8px",
      right: "16px",
      bottom: "8px",
      left: "16px",
    });
  });
  it("expands 3 values to top / horizontal / bottom", () => {
    expect(parseBoxSides("8px 16px 4px")).toEqual({
      top: "8px",
      right: "16px",
      bottom: "4px",
      left: "16px",
    });
  });
  it("expands 4 values one-to-one", () => {
    expect(parseBoxSides("1px 2px 3px 4px")).toEqual({
      top: "1px",
      right: "2px",
      bottom: "3px",
      left: "4px",
    });
  });
  it("returns all-empty for empty input", () => {
    expect(parseBoxSides("")).toEqual({ top: "", right: "", bottom: "", left: "" });
    expect(parseBoxSides("   ")).toEqual({ top: "", right: "", bottom: "", left: "" });
  });
  it("ignores values past the fourth", () => {
    expect(parseBoxSides("1px 2px 3px 4px 5px")).toEqual({
      top: "1px",
      right: "2px",
      bottom: "3px",
      left: "4px",
    });
  });
});

describe("formatBoxSides", () => {
  it("collapses to single value when all sides equal", () => {
    expect(formatBoxSides({ top: "8px", right: "8px", bottom: "8px", left: "8px" })).toBe("8px");
  });
  it("collapses to 2-value form for vertical/horizontal symmetry", () => {
    expect(formatBoxSides({ top: "8px", right: "16px", bottom: "8px", left: "16px" })).toBe(
      "8px 16px",
    );
  });
  it("collapses to 3-value form when horizontal is symmetric", () => {
    expect(formatBoxSides({ top: "8px", right: "16px", bottom: "4px", left: "16px" })).toBe(
      "8px 16px 4px",
    );
  });
  it("falls back to 4-value form when nothing is symmetric", () => {
    expect(formatBoxSides({ top: "1px", right: "2px", bottom: "3px", left: "4px" })).toBe(
      "1px 2px 3px 4px",
    );
  });
  it("emits empty string when all sides empty", () => {
    expect(formatBoxSides({ top: "", right: "", bottom: "", left: "" })).toBe("");
  });
  it("pxifies bare numbers per side", () => {
    expect(formatBoxSides({ top: "8", right: "16", bottom: "8", left: "16" })).toBe("8px 16px");
  });
  it("substitutes 0 for missing sides when at least one is set", () => {
    expect(formatBoxSides({ top: "8px", right: "", bottom: "", left: "" })).toBe("8px 0 0");
  });
  it("roundtrips through parseBoxSides for canonical 4-value shorthand", () => {
    const input = "1px 2px 3px 4px";
    expect(formatBoxSides(parseBoxSides(input))).toBe(input);
  });
});

// ────────────────────────────────────────────────────────────────────
// Bucket detection (Sprint B)
// ────────────────────────────────────────────────────────────────────

describe("extractTagFromPath", () => {
  it("returns last segment tag for canonical paths", () => {
    expect(extractTagFromPath("body[1] > h1[1]")).toBe("h1");
    expect(extractTagFromPath("body[1] > div[2] > p[3]")).toBe("p");
  });
  it("lowercases", () => {
    expect(extractTagFromPath("BODY[1] > IMG[1]")).toBe("img");
  });
  it("strips [nth-of-type]", () => {
    expect(extractTagFromPath("button[12]")).toBe("button");
  });
  it("handles custom element names", () => {
    expect(extractTagFromPath("body[1] > my-card[1]")).toBe("my-card");
  });
  it("returns empty string for malformed paths", () => {
    expect(extractTagFromPath("")).toBe("");
    expect(extractTagFromPath("[1]")).toBe("");
  });
});

describe("getBucket", () => {
  it("classifies semantic text tags as text", () => {
    expect(getBucket("h1")).toBe("text");
    expect(getBucket("h6")).toBe("text");
    expect(getBucket("p")).toBe("text");
    expect(getBucket("a")).toBe("text");
    expect(getBucket("button")).toBe("text");
    expect(getBucket("span")).toBe("text");
    expect(getBucket("li")).toBe("text");
  });
  it("classifies media tags as image", () => {
    expect(getBucket("img")).toBe("image");
    expect(getBucket("video")).toBe("image");
    expect(getBucket("svg")).toBe("image");
    expect(getBucket("picture")).toBe("image");
  });
  it("classifies layout tags as container", () => {
    expect(getBucket("div")).toBe("container");
    expect(getBucket("section")).toBe("container");
    expect(getBucket("article")).toBe("container");
    expect(getBucket("nav")).toBe("container");
  });
  it("falls back to container for unknown / custom tags", () => {
    expect(getBucket("my-widget")).toBe("container");
    expect(getBucket("")).toBe("container");
  });
  it("is case-insensitive", () => {
    expect(getBucket("H1")).toBe("text");
    expect(getBucket("IMG")).toBe("image");
  });
});

// ────────────────────────────────────────────────────────────────────
// Render shape — floating panel
// ────────────────────────────────────────────────────────────────────

describe("InlineEditPanel — visibility", () => {
  it("renders nothing when there is no selection", () => {
    const html = render({
      selection: null,
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toBe("");
  });

  it("renders nothing when iframeRect is null (not yet measured)", () => {
    const html = render({
      selection: makeSelection(),
      iframeRect: null,
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toBe("");
  });

  it("renders the panel container when selection + iframeRect are set", () => {
    const html = render({
      selection: makeSelection(),
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toContain('data-testid="inline-edit-panel"');
    expect(html).toContain(`width:${PANEL_WIDTH}px`);
  });
});

describe("InlineEditPanel — contextual rendering (bucket=text)", () => {
  const props = {
    selection: makeSelection({ path: "body[1] > h1[1]" }),
    iframeRect: makeIframeRect(),
    onApplyStyle: () => {},
    onApplyText: () => {},
    onSave: () => {},
    onCancel: () => {},
    dirty: false,
  } as Parameters<typeof InlineEditPanel>[0];

  it("tags the container with bucket=text", () => {
    const html = render(props);
    expect(html).toContain('data-bucket="text"');
    expect(html).toContain('data-tag="h1"');
  });

  it("renders Text + Typography sections", () => {
    const html = render(props);
    expect(html).toContain("<textarea");
    expect(html).toContain("Typography");
    expect(html).toContain("Align");
    expect(html).toContain("Line Height");
    expect(html).toContain("Tracking");
  });

  it("renders Box with Padding but not Margin / Border", () => {
    const html = render(props);
    expect(html).toContain("Box");
    expect(html).toContain("Opacity");
    expect(html).toContain('aria-label="Padding shorthand"');
    expect(html).not.toContain('aria-label="Margin shorthand"');
    expect(html).not.toContain("Border Radius");
  });

  it("does not render Size for text", () => {
    const html = render(props);
    // The heading "Size" is unique to the Size section; the Field
    // "Size" inside Typography uses placeholder "16px" but the label is
    // also "Size" — keep the assertion specific to the section heading
    // by checking absence of "Width" + "Height" labels.
    expect(html).not.toContain(">Width</span>");
    expect(html).not.toContain(">Height</span>");
  });
});

describe("InlineEditPanel — contextual rendering (bucket=image)", () => {
  const props = {
    selection: makeSelection({ path: "body[1] > img[1]", text: "" }),
    iframeRect: makeIframeRect(),
    onApplyStyle: () => {},
    onApplyText: () => {},
    onSave: () => {},
    onCancel: () => {},
    dirty: false,
  } as Parameters<typeof InlineEditPanel>[0];

  it("tags the container with bucket=image", () => {
    const html = render(props);
    expect(html).toContain('data-bucket="image"');
    expect(html).toContain('data-tag="img"');
  });

  it("does not render Text / Typography", () => {
    const html = render(props);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Typography");
    expect(html).not.toContain("Tracking");
  });

  it("renders Size + Box with Border + Border Radius (no Padding/Margin)", () => {
    const html = render(props);
    expect(html).toContain(">Width</span>");
    expect(html).toContain(">Height</span>");
    expect(html).toContain("Border Radius");
    expect(html).toContain("Opacity");
    expect(html).not.toContain('aria-label="Padding shorthand"');
    expect(html).not.toContain('aria-label="Margin shorthand"');
  });
});

describe("InlineEditPanel — contextual rendering (bucket=container)", () => {
  const props = {
    selection: makeSelection({ path: "body[1] > div[1]", text: "" }),
    iframeRect: makeIframeRect(),
    onApplyStyle: () => {},
    onApplyText: () => {},
    onSave: () => {},
    onCancel: () => {},
    dirty: false,
  } as Parameters<typeof InlineEditPanel>[0];

  it("tags the container with bucket=container", () => {
    const html = render(props);
    expect(html).toContain('data-bucket="container"');
    expect(html).toContain('data-tag="div"');
  });

  it("does not render Typography", () => {
    const html = render(props);
    expect(html).not.toContain("Typography");
    expect(html).not.toContain("Tracking");
  });

  it("renders Size + Box with full padding/margin/border surface", () => {
    const html = render(props);
    expect(html).toContain(">Width</span>");
    expect(html).toContain(">Height</span>");
    expect(html).toContain('aria-label="Padding shorthand"');
    expect(html).toContain('aria-label="Margin shorthand"');
    expect(html).toContain("Border Radius");
    expect(html).toContain("Opacity");
  });
});

describe("InlineEditPanel — header + footer", () => {
  it("shows the unsaved indicator when dirty", () => {
    const html = render({
      selection: makeSelection(),
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: true,
    });
    expect(html).toContain("● unsaved");
  });

  it("shows the synced indicator when not dirty", () => {
    const html = render({
      selection: makeSelection(),
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toContain("● synced");
  });

  it("renders Save and Cancel buttons", () => {
    const html = render({
      selection: makeSelection(),
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: true,
    });
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Save</button>");
  });

  it("BoxSidesField renders the shorthand input + caret toggle when shown", () => {
    // Container bucket exposes both Padding and Margin → both carets.
    const html = render({
      selection: makeSelection({ path: "body[1] > div[1]", text: "" }),
      iframeRect: makeIframeRect(),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toContain('aria-label="Expand Padding sides"');
    expect(html).toContain('aria-label="Expand Margin sides"');
    expect(html).not.toContain("box-sides-padding-expanded");
    expect(html).not.toContain("box-sides-margin-expanded");
  });
});

// ────────────────────────────────────────────────────────────────────
// Position calc — sanity check
// ────────────────────────────────────────────────────────────────────

describe("InlineEditPanel — position", () => {
  it("places the panel to the right of the selected element when there is room", () => {
    // iframeRect at left=200, selection rect at x=24,width=300 → element
    // right edge is 200 + 24 + 300 = 524. Panel preferred left = 524 + 12 = 536.
    const html = render({
      selection: makeSelection({ rect: { x: 24, y: 48, width: 300, height: 36 } }),
      iframeRect: makeIframeRect({ left: 200, top: 60 }),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toContain("left:536px");
    // top = iframeRect.top (60) + selection.rect.y (48) = 108
    expect(html).toContain("top:108px");
  });

  it("swings left when right-of-element overflows the viewport", () => {
    // jsdom default innerWidth = 1024. iframeRect.left=200,
    // selection.rect.x=24,width=900 → right edge = 1124, panel right
    // would be 1124 + 12 + PANEL_WIDTH > 1024. Should swing to
    // 1124 - 12 - 290 = ... wait: panelLeft swing = elLeft - PANEL_WIDTH - GAP
    // elLeft = 200 + 24 = 224. swing = 224 - 290 - 12 = -78, clamped to 8.
    const html = render({
      selection: makeSelection({ rect: { x: 24, y: 48, width: 900, height: 36 } }),
      iframeRect: makeIframeRect({ left: 200, top: 60 }),
      onApplyStyle: () => {},
      onApplyText: () => {},
      onSave: () => {},
      onCancel: () => {},
      dirty: false,
    });
    expect(html).toContain("left:8px");
  });
});
