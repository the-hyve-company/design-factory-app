import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PreviewSandboxBadge } from "./PreviewSandboxBadge";

describe("PreviewSandboxBadge", () => {
  it("renders 'strict' label when sandbox lacks allow-same-origin", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewSandboxBadge, { sandbox: "allow-scripts" }),
    );
    expect(html).toContain("sandbox · strict");
    expect(html).toContain('data-df="sandbox-badge"');
  });

  it("renders 'permissive' label when sandbox includes allow-same-origin", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewSandboxBadge, { sandbox: "allow-scripts allow-same-origin" }),
    );
    expect(html).toContain("sandbox · permissive");
  });

  it("renders 'strict' for empty sandbox (most restrictive)", () => {
    const html = renderToStaticMarkup(createElement(PreviewSandboxBadge, { sandbox: "" }));
    expect(html).toContain("sandbox · strict");
  });

  it("includes the full sandbox tokens in the title attribute", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewSandboxBadge, { sandbox: "allow-scripts allow-popups" }),
    );
    expect(html).toContain('title="Sandbox: allow-scripts allow-popups"');
  });

  it("warns visually when permissive AND warnIfPermissive is set", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewSandboxBadge, {
        sandbox: "allow-scripts allow-same-origin",
        warnIfPermissive: true,
      }),
    );
    // Border tone uses the warn accent var when warning is on.
    expect(html).toContain("--df-accent-warn");
  });
});
