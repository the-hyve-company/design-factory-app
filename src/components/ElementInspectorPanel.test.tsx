import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ElementInspectorPanel } from "./ElementInspectorPanel";
import { ELEMENT_OVERLAY_SOURCE_ID, type ElementSelectedPayload } from "@/runtime/element-overlay";

const fixture: ElementSelectedPayload = {
  source: ELEMENT_OVERLAY_SOURCE_ID,
  type: "df:element-selected",
  selector: "main > section:nth-of-type(2) > h2",
  xpath: "/html/body/main/section[2]/h2",
  outerHtml: '<h2 class="title">Hello</h2>',
  parentOuterHtml: '<section><h2 class="title">Hello</h2></section>',
  textContent: "Hello",
  tagName: "h2",
  attrs: { class: "title", "data-test": "x" },
  boundingBox: { x: 24, y: 48, width: 320, height: 36 },
};

describe("ElementInspectorPanel — server render shape", () => {
  it("renders the selector, tag, and box dimensions", () => {
    const html = renderToStaticMarkup(
      createElement(ElementInspectorPanel, {
        selection: fixture,
        onClose: () => {},
        onSendToAgent: () => {},
      }),
    );
    expect(html).toContain('data-df="element-inspector"');
    expect(html).toContain("&lt;h2&gt;");
    expect(html).toContain("main &gt; section:nth-of-type(2) &gt; h2");
    expect(html).toContain("320 × 36 px");
  });

  it("renders attribute table with correct count", () => {
    const html = renderToStaticMarkup(
      createElement(ElementInspectorPanel, {
        selection: fixture,
        onClose: () => {},
        onSendToAgent: () => {},
      }),
    );
    expect(html).toContain("Attributes (2)");
    expect(html).toContain("data-test");
  });

  it("hides text section when textContent is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ElementInspectorPanel, {
        selection: { ...fixture, textContent: "" },
        onClose: () => {},
        onSendToAgent: () => {},
      }),
    );
    expect(html).not.toContain(">Text<");
  });

  it("hides attribute section when attrs is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ElementInspectorPanel, {
        selection: { ...fixture, attrs: {} },
        onClose: () => {},
        onSendToAgent: () => {},
      }),
    );
    expect(html).not.toContain("Attributes (");
  });

  it("renders a Send-to-agent button with disabled state when intent empty", () => {
    const html = renderToStaticMarkup(
      createElement(ElementInspectorPanel, {
        selection: fixture,
        onClose: () => {},
        onSendToAgent: () => {},
      }),
    );
    // The button starts disabled because intent is "".
    expect(html).toMatch(/disabled[^>]*>\s*Send to agent/);
  });
});
