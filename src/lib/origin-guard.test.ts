import { describe, it, expect } from "vitest";
import { checkOrigin, ALLOWED_BRIDGE_ORIGINS } from "./origin-guard";

describe("origin-guard", () => {
  it.each([...ALLOWED_BRIDGE_ORIGINS])("accepts canonical origin %s", (origin) => {
    const result = checkOrigin(origin);
    expect(result.ok).toBe(true);
    expect(result.currentOrigin).toBe(origin);
  });

  it("rejects http://localhost:3000 — the auditor's flagged case", () => {
    const result = checkOrigin("http://localhost:3000");
    expect(result.ok).toBe(false);
    expect(result.currentOrigin).toBe("http://localhost:3000");
    expect(result.expectedOrigins).toEqual(ALLOWED_BRIDGE_ORIGINS);
  });

  it("rejects file:// origins (preview surfaces, exported HTML)", () => {
    expect(checkOrigin("file://").ok).toBe(false);
  });

  it("rejects production-looking origins", () => {
    expect(checkOrigin("https://design-factory.example.com").ok).toBe(false);
    expect(checkOrigin("https://localhost:1420").ok).toBe(false); // wrong protocol
    expect(checkOrigin("http://localhost:1421").ok).toBe(false); // bridge port leak
  });

  it("rejects empty / null / undefined inputs as ok=false", () => {
    expect(checkOrigin("").ok).toBe(false);
    expect(checkOrigin(null).ok).toBe(false);
    expect(checkOrigin(undefined).ok).toBe(false);
  });

  it("accepts an injected dev origin via extraAllowed (reclaimed Vite port)", () => {
    const result = checkOrigin("http://localhost:1429", [
      "http://localhost:1429",
      "http://127.0.0.1:1429",
    ]);
    expect(result.ok).toBe(true);
    expect(result.expectedOrigins).toEqual([
      ...ALLOWED_BRIDGE_ORIGINS,
      "http://localhost:1429",
      "http://127.0.0.1:1429",
    ]);
  });

  it("still rejects :3000 even when another dev port is allowed", () => {
    expect(checkOrigin("http://localhost:3000", ["http://localhost:1429"]).ok).toBe(false);
  });

  it("exposes the full canonical origin list (parity with daemon)", () => {
    expect(ALLOWED_BRIDGE_ORIGINS).toEqual(["http://localhost:1420", "http://127.0.0.1:1420"]);
  });
});
