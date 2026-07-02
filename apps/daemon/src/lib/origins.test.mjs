// origins tests — default CORS/WS allowlist must stay narrow.
//
// Regression guard for origin-allowlist-narrow: the old default included
// generic :3000/:5173 guesses, which let ANY local app on those common
// dev ports drive the daemon (origin confusion).

import { describe, it, expect } from "vitest";
import { computeDefaultAllowedOrigins } from "./origins.mjs";

describe("computeDefaultAllowedOrigins", () => {
  it("default is only the app origin (1420) — no generic port guesses", () => {
    const origins = computeDefaultAllowedOrigins({});
    expect(origins).toEqual(["http://localhost:1420", "http://127.0.0.1:1420"]);
  });

  it("never includes :3000 or :5173 by default", () => {
    const origins = computeDefaultAllowedOrigins({});
    for (const o of origins) {
      expect(o).not.toMatch(/:3000$/);
      expect(o).not.toMatch(/:5173$/);
    }
  });

  it("trusts DF_VITE_PORT (set by the dev launcher) for both host forms", () => {
    const origins = computeDefaultAllowedOrigins({ DF_VITE_PORT: "4321" });
    expect(origins).toContain("http://localhost:4321");
    expect(origins).toContain("http://127.0.0.1:4321");
    expect(origins).toHaveLength(4);
  });

  it("ignores empty/whitespace DF_VITE_PORT", () => {
    expect(computeDefaultAllowedOrigins({ DF_VITE_PORT: "" })).toHaveLength(2);
    expect(computeDefaultAllowedOrigins({ DF_VITE_PORT: "   " })).toHaveLength(2);
  });
});
