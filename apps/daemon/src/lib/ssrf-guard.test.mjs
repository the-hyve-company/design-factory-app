// Regression tests — SSRF guard for the daemon's outbound /fetch-url.
// Pins the IP blocklist + scheme/redirect rules so a forged URL can't
// pivot the daemon into the internal network or cloud metadata endpoint.

import { describe, it, expect } from "vitest";
import { isBlockedIp, assertPublicUrl, ssrfSafeFetch } from "./ssrf-guard.mjs";

describe("isBlockedIp — private/loopback/metadata ranges", () => {
  it("blocks IPv4 loopback + this-network", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks link-local + the cloud metadata IP", () => {
    expect(isBlockedIp("169.254.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // AWS/GCP metadata
  });

  it("blocks multicast/reserved (>=224)", () => {
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("255.255.255.255")).toBe(true);
  });

  it("allows ordinary public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("172.15.0.1")).toBe(false); // just below RFC1918
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just above RFC1918
  });

  it("blocks IPv6 loopback / link-local / ULA", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 that wraps a private address", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows ordinary public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // cloudflare
  });

  it("treats non-string / garbage as blocked (fail closed)", () => {
    expect(isBlockedIp(undefined)).toBe(true);
    expect(isBlockedIp(null)).toBe(true);
    expect(isBlockedIp(12345)).toBe(true);
  });
});

describe("assertPublicUrl — scheme + resolved-IP gate", () => {
  it("rejects non-http(s) schemes before any lookup", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/scheme not allowed/);
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow(/scheme not allowed/);
    await expect(assertPublicUrl("gopher://x")).rejects.toThrow(/scheme not allowed/);
  });

  it("rejects malformed URLs", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toThrow(/invalid url/);
  });

  it("rejects a host that is a private/metadata IP literal (no network)", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:8080/x")).rejects.toThrow(/blocked ip/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /blocked ip/,
    );
    await expect(assertPublicUrl("http://10.0.0.1/")).rejects.toThrow(/blocked ip/);
  });

  it("accepts a public IP literal host (no network)", async () => {
    const u = await assertPublicUrl("http://93.184.216.34/path");
    expect(u.hostname).toBe("93.184.216.34");
  });
});

describe("ssrfSafeFetch — validates before fetching", () => {
  it("throws on a blocked target before any network call", async () => {
    // assertPublicUrl runs first, so this rejects without ever hitting fetch().
    await expect(ssrfSafeFetch("http://127.0.0.1/")).rejects.toThrow(/blocked ip/);
    await expect(ssrfSafeFetch("file:///etc/hostname")).rejects.toThrow(/scheme not allowed/);
  });
});
