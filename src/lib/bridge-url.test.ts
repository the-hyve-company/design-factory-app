import { describe, it, expect } from "vitest";
import { resolveBridgeBase, resolveBridgeWs } from "./bridge-url";

describe("resolveBridgeBase", () => {
  it("resolves a relative bridge path against the page origin (same-origin proxy)", () => {
    expect(resolveBridgeBase("/__bridge", "http://localhost:1423")).toBe(
      "http://localhost:1423/__bridge",
    );
  });

  it("passes an absolute bridge URL through unchanged", () => {
    expect(resolveBridgeBase("http://127.0.0.1:1424", "http://localhost:1423")).toBe(
      "http://127.0.0.1:1424",
    );
  });

  it("falls back to the default daemon port when unset", () => {
    expect(resolveBridgeBase(false, "http://localhost:1423")).toBe("http://127.0.0.1:1421");
    expect(resolveBridgeBase(undefined)).toBe("http://127.0.0.1:1421");
  });

  it("returns the relative value as-is when there is no origin (SSR/test)", () => {
    expect(resolveBridgeBase("/__bridge", undefined)).toBe("/__bridge");
  });
});

describe("resolveBridgeWs", () => {
  it("builds a ws URL from a relative path + host", () => {
    expect(resolveBridgeWs("/__bridge", "localhost:1423", "http:")).toBe(
      "ws://localhost:1423/__bridge",
    );
  });

  it("uses wss when the page is served over https", () => {
    expect(resolveBridgeWs("/__bridge", "app.example.com", "https:")).toBe(
      "wss://app.example.com/__bridge",
    );
  });

  it("swaps http→ws for an absolute bridge URL", () => {
    expect(resolveBridgeWs("http://127.0.0.1:1424")).toBe("ws://127.0.0.1:1424");
  });

  it("falls back to the default daemon ws when unset", () => {
    expect(resolveBridgeWs(false)).toBe("ws://127.0.0.1:1421");
  });
});
