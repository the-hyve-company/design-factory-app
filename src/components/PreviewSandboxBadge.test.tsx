import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  PreviewSandboxBadge,
  decidePreviewSandbox,
  isPermissiveSandbox,
  PREVIEW_SANDBOX_STRICT,
  PREVIEW_SANDBOX_PERMISSIVE,
} from "./PreviewSandboxBadge";

function fakeStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

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

describe("decidePreviewSandbox — strict by default, permissive opt-in", () => {
  it("defaults to strict with no query and no storage", () => {
    expect(decidePreviewSandbox({})).toBe(PREVIEW_SANDBOX_STRICT);
    expect(decidePreviewSandbox({ search: "", storage: fakeStorage(null) })).toBe(
      PREVIEW_SANDBOX_STRICT,
    );
  });

  it("opts into permissive via ?permissiveSandbox=1", () => {
    expect(decidePreviewSandbox({ search: "?permissiveSandbox=1" })).toBe(
      PREVIEW_SANDBOX_PERMISSIVE,
    );
  });

  it("opts into permissive via DF_PERMISSIVE_SANDBOX=1 storage", () => {
    expect(decidePreviewSandbox({ storage: fakeStorage("1") })).toBe(PREVIEW_SANDBOX_PERMISSIVE);
  });

  it("stays strict for the legacy strict signals (now redundant, still safe)", () => {
    // The old opt-INTO-strict params must never accidentally grant permissive.
    expect(decidePreviewSandbox({ search: "?strictSandbox=1" })).toBe(PREVIEW_SANDBOX_STRICT);
    expect(decidePreviewSandbox({ storage: fakeStorage("0") })).toBe(PREVIEW_SANDBOX_STRICT);
  });

  it("stays strict when storage access throws (private mode / strict CSP)", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(decidePreviewSandbox({ storage: throwingStorage })).toBe(PREVIEW_SANDBOX_STRICT);
  });
});

describe("isPermissiveSandbox", () => {
  it("true only when allow-same-origin is present", () => {
    expect(isPermissiveSandbox("allow-scripts allow-same-origin")).toBe(true);
    expect(isPermissiveSandbox("allow-scripts")).toBe(false);
    expect(isPermissiveSandbox("")).toBe(false);
    expect(isPermissiveSandbox("allow-scripts allow-popups")).toBe(false);
  });
});
