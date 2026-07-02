// loopback-auth tests — opt-in session-token gate for the daemon.
//
// The daemon HTTP server is a singleton with side effects, so the guard
// logic lives in pure helpers tested here without booting it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTokenRequired,
  isTerminalEnabled,
  loadOrCreateSessionToken,
  extractRequestToken,
  tokensMatch,
  isStateChangingMethod,
  checkRequestToken,
  TOKEN_FILE_NAME,
} from "./loopback-auth.mjs";

describe("isTokenRequired (DF_REQUIRE_TOKEN)", () => {
  it("defaults OFF — unset env keeps the current single-user behavior", () => {
    expect(isTokenRequired({})).toBe(false);
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: "" })).toBe(false);
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: "0" })).toBe(false);
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: "false" })).toBe(false);
  });

  it("turns ON with truthy flags", () => {
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: "1" })).toBe(true);
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: "true" })).toBe(true);
    expect(isTokenRequired({ DF_REQUIRE_TOKEN: " TRUE " })).toBe(true);
  });
});

describe("isTerminalEnabled (DF_ENABLE_TERMINAL)", () => {
  it("unset + no token mode → enabled (current local behavior preserved)", () => {
    expect(isTerminalEnabled({})).toBe(true);
  });

  it("unset + hardened mode (DF_REQUIRE_TOKEN=1) → disabled by default", () => {
    expect(isTerminalEnabled({ DF_REQUIRE_TOKEN: "1" })).toBe(false);
  });

  it("explicit DF_ENABLE_TERMINAL wins in both modes", () => {
    expect(isTerminalEnabled({ DF_ENABLE_TERMINAL: "0" })).toBe(false);
    expect(isTerminalEnabled({ DF_ENABLE_TERMINAL: "false" })).toBe(false);
    expect(isTerminalEnabled({ DF_REQUIRE_TOKEN: "1", DF_ENABLE_TERMINAL: "1" })).toBe(true);
    expect(isTerminalEnabled({ DF_REQUIRE_TOKEN: "1", DF_ENABLE_TERMINAL: "true" })).toBe(true);
  });
});

describe("loadOrCreateSessionToken", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "df-token-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a 64-hex token file with mode 0600", async () => {
    const { token, file, created } = loadOrCreateSessionToken(dir);
    expect(created).toBe(true);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(file).toBe(join(dir, TOKEN_FILE_NAME));
    const onDisk = (await readFile(file, "utf8")).trim();
    expect(onDisk).toBe(token);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("is stable across calls — second call reuses the persisted token", () => {
    const first = loadOrCreateSessionToken(dir);
    const second = loadOrCreateSessionToken(dir);
    expect(second.created).toBe(false);
    expect(second.token).toBe(first.token);
  });

  it("regenerates when the file holds garbage", async () => {
    await writeFile(join(dir, TOKEN_FILE_NAME), "not-a-token!!\n");
    const { token, created } = loadOrCreateSessionToken(dir);
    expect(created).toBe(true);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("extractRequestToken", () => {
  it("reads X-DF-Token header", () => {
    expect(extractRequestToken({ headers: { "x-df-token": " abc123 " }, url: "/" })).toBe("abc123");
  });

  it("reads Authorization: Bearer", () => {
    expect(extractRequestToken({ headers: { authorization: "Bearer tok9" }, url: "/" })).toBe(
      "tok9",
    );
  });

  it("reads ?df_token= from the URL (WS upgrade path)", () => {
    expect(extractRequestToken({ headers: {}, url: "/terminal?df_token=deadbeef" })).toBe(
      "deadbeef",
    );
  });

  it("returns null when absent", () => {
    expect(extractRequestToken({ headers: {}, url: "/fs/write" })).toBe(null);
    expect(extractRequestToken({})).toBe(null);
  });
});

describe("tokensMatch", () => {
  it("matches equal tokens, rejects mismatch / length drift / non-strings", () => {
    expect(tokensMatch("abcd", "abcd")).toBe(true);
    expect(tokensMatch("abcd", "abce")).toBe(false);
    expect(tokensMatch("abcd", "abcde")).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(null, "abcd")).toBe(false);
    expect(tokensMatch("abcd", undefined)).toBe(false);
  });
});

describe("isStateChangingMethod", () => {
  it("GET/HEAD/OPTIONS are safe; POST/PUT/PATCH/DELETE are state-changing", () => {
    expect(isStateChangingMethod("GET")).toBe(false);
    expect(isStateChangingMethod("HEAD")).toBe(false);
    expect(isStateChangingMethod("OPTIONS")).toBe(false);
    expect(isStateChangingMethod("POST")).toBe(true);
    expect(isStateChangingMethod("PUT")).toBe(true);
    expect(isStateChangingMethod("PATCH")).toBe(true);
    expect(isStateChangingMethod("DELETE")).toBe(true);
  });
});

describe("checkRequestToken", () => {
  const token = "a".repeat(64);

  it("required=false short-circuits to ok (backward-compatible default)", () => {
    expect(
      checkRequestToken({ headers: {}, url: "/fs/write" }, { required: false, token }),
    ).toEqual({ ok: true });
  });

  it("401 when the token is missing", () => {
    const verdict = checkRequestToken({ headers: {}, url: "/fs/write" }, { required: true, token });
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
  });

  it("403 when the token is wrong", () => {
    const verdict = checkRequestToken(
      { headers: { "x-df-token": "b".repeat(64) }, url: "/fs/write" },
      { required: true, token },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(403);
  });

  it("ok when the token matches (header or query param)", () => {
    expect(
      checkRequestToken(
        { headers: { "x-df-token": token }, url: "/fs/write" },
        { required: true, token },
      ).ok,
    ).toBe(true);
    expect(
      checkRequestToken(
        { headers: {}, url: `/terminal?df_token=${token}` },
        { required: true, token },
      ).ok,
    ).toBe(true);
  });
});
