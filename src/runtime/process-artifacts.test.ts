import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { processArtifacts, dispatchParseResult } from "./process-artifacts";

// the feature-flag gate moved out of processArtifacts. The
// capability dispatch lives in `turn-stages/process-artifacts.ts`; this
// module is the canonical parser+writer and assumes the caller has
// already decided to invoke it.

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HTML_BIG = "<!DOCTYPE html><html><body>" + "x".repeat(300) + "</body></html>";

describe("processArtifacts — gating", () => {
  it("skips with reason no-artifact when prose contains no <artifact>", async () => {
    const out = await processArtifacts("just a chat reply");
    expect(out.status).toBe("skipped");
    if (out.status === "skipped") expect(out.reason).toBe("no-artifact");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("processArtifacts — happy path", () => {
  it("POSTs artifact JSON to /fs/write/artifact and returns written outcome", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        finalPath: "/abs/projects/x/x.html",
        hash: "feedface".repeat(8),
        backupPath: "/abs/projects/x/.df/backups/2026-05-04T19-00-00-000Z-x.html",
        noop: false,
      }),
    });
    const stream = `<artifact identifier="projects/x/x.html" type="text/html" title="X">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon:1421" });
    expect(out.status).toBe("written");
    if (out.status === "written") {
      expect(out.finalPath).toBe("/abs/projects/x/x.html");
      expect(out.noop).toBe(false);
      expect(out.backupPath).toContain("backups");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://daemon:1421/fs/write/artifact");
    const sentBody = JSON.parse(init.body);
    expect(sentBody.identifier).toBe("projects/x/x.html");
    expect(sentBody.type).toBe("text/html");
    expect(sentBody.content).toBe(HTML_BIG);
    expect(sentBody.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("forwards minBytes when caller supplies a skill-specific override", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: false }),
    });
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    await processArtifacts(stream, { bridgeUrl: "http://daemon", minBytes: 50 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).minBytes).toBe(50);
  });

  it("surfaces noop=true when daemon reports idempotent write", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: true }),
    });
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon" });
    if (out.status === "written") expect(out.noop).toBe(true);
  });
});

describe("processArtifacts — error mapping", () => {
  it("returns status:rejected when parser sees multiple artifacts", async () => {
    const stream =
      `<artifact identifier="a.html" type="text/html">A</artifact>` +
      `<artifact identifier="b.html" type="text/html">B</artifact>`;
    const out = await processArtifacts(stream);
    expect(out.status).toBe("rejected");
    if (out.status === "rejected") expect(out.reason).toBe("multiple-artifacts");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns write-failed when daemon responds 422 STATIC_FAIL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "static-fail: below-min-bytes",
        code: "static-fail",
        reason: "below-min-bytes",
      }),
    });
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon" });
    expect(out.status).toBe("write-failed");
    if (out.status === "write-failed") {
      expect(out.httpStatus).toBe(422);
      expect(out.code).toBe("static-fail");
    }
  });

  it("returns write-failed with NETWORK code when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon" });
    expect(out.status).toBe("write-failed");
    if (out.status === "write-failed") {
      expect(out.code).toBe("NETWORK");
      expect(out.error).toContain("network down");
    }
  });
});

describe("dispatchParseResult", () => {
  it("calls daemon when given an artifact ParseResult", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: false }),
    });
    const result = {
      status: "artifact" as const,
      artifact: {
        identifier: "projects/x/x.html",
        type: "text/html",
        title: "X",
        content: HTML_BIG,
        contentHash: "a".repeat(64),
        startOffset: 0,
        endOffset: 10,
      },
      cleanedText: "ok",
    };
    const out = await dispatchParseResult(result, { bridgeUrl: "http://daemon" });
    expect(out.status).toBe("written");
  });
});

// ── (spec v0.3.4 §): intent hint + multi-file fields. ──
//
// Frontend forwards `intent` to the daemon's resolveArtifactTarget(); when
// the daemon has DF_ENABLE_PROJECT_FILES=1, it returns role/setActive/etc.
// We just verify those are plumbed through end-to-end.

describe("processArtifacts — intent + multi-file fields", () => {
  it("forwards intent in the POST body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: false }),
    });
    const stream = `<artifact identifier="projects/x/variants/dark.html" type="text/html">${HTML_BIG}</artifact>`;
    await processArtifacts(stream, { bridgeUrl: "http://daemon", intent: "variant" });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.intent).toBe("variant");
  });

  it("omits intent when caller doesn't supply it", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: false }),
    });
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    await processArtifacts(stream, { bridgeUrl: "http://daemon" });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect("intent" in body).toBe(false);
  });

  it("surfaces role / setActive / setPrimary / isNewFile / previewAfterWrite when daemon returns them", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        finalPath: "/abs/projects/x/variants/dark.html",
        hash: "abc",
        backupPath: null,
        noop: false,
        role: "variant",
        setActive: true,
        setPrimary: false,
        isNewFile: true,
        previewAfterWrite: true,
      }),
    });
    const stream = `<artifact identifier="projects/x/variants/dark.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon", intent: "variant" });
    expect(out.status).toBe("written");
    if (out.status === "written") {
      expect(out.role).toBe("variant");
      expect(out.setActive).toBe(true);
      expect(out.setPrimary).toBe(false);
      expect(out.isNewFile).toBe(true);
      expect(out.previewAfterWrite).toBe(true);
    }
  });

  it("does NOT include fields when daemon omits them (legacy flag-off)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, finalPath: "f", hash: "h", backupPath: null, noop: false }),
    });
    const stream = `<artifact identifier="x.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon" });
    if (out.status === "written") {
      expect("role" in out).toBe(false);
      expect("setActive" in out).toBe(false);
    }
  });

  it("returns write-failed when daemon returns INTENT_PATH_CONFLICT (422)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'intent="doc" but path "projects/x/variants/dark.html" lives under role "variant"',
        code: "INTENT_PATH_CONFLICT",
      }),
    });
    const stream = `<artifact identifier="projects/x/variants/dark.html" type="text/html">${HTML_BIG}</artifact>`;
    const out = await processArtifacts(stream, { bridgeUrl: "http://daemon", intent: "doc" });
    expect(out.status).toBe("write-failed");
    if (out.status === "write-failed") {
      expect(out.code).toBe("INTENT_PATH_CONFLICT");
      expect(out.httpStatus).toBe(422);
    }
  });
});
