import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncRecoveryQueue, lastSyncReport } from "./chat-recovery-sync";
import { saveRecovery, readRecovery, listAllPendingRecovery } from "./chat-recovery";
import type { Turn } from "./chat-turns";

const turn = (id: string, text: string): Turn => ({
  id,
  ts: 1_700_000_000_000,
  user: { text, attachments: [] },
  ai: null,
});

describe("chat-recovery-sync", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes pending entries and clears them when the daemon accepts the write", async () => {
    saveRecovery("p1", "thread-a", "slug-a", turn("t1", "hi"), "timeout");
    saveRecovery("p1", "thread-a", "slug-a", turn("t2", "yo"), "timeout");
    expect(listAllPendingRecovery()).toHaveLength(2);

    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;

    const report = await syncRecoveryQueue({ delayBetweenMs: 0 });
    expect(report.attempted).toBe(2);
    expect(report.flushed).toBe(2);
    expect(report.remaining).toBe(0);
    expect(readRecovery("p1", "thread-a")).toEqual([]);
  });

  it("keeps entries queued when the daemon write fails (HTTP non-OK)", async () => {
    saveRecovery("p1", "thread", "slug", turn("t1", "hi"), "timeout");
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    const report = await syncRecoveryQueue({ delayBetweenMs: 0 });
    expect(report.attempted).toBe(1);
    expect(report.flushed).toBe(0);
    expect(report.remaining).toBe(1);
    expect(readRecovery("p1", "thread")).toHaveLength(1);
  });

  it("partial flush — successful entries clear, failed entries stay", async () => {
    saveRecovery("p1", "thread", "slug", turn("ok-1", "hi"), "timeout");
    saveRecovery("p1", "thread", "slug", turn("ok-2", "yo"), "timeout");
    saveRecovery("p1", "thread", "slug", turn("fail", "x"), "timeout");

    let call = 0;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call++;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const status = body?.turn?.id === "fail" ? 500 : 200;
      return new Response(status === 200 ? "{}" : "boom", { status });
    }) as typeof fetch;

    const report = await syncRecoveryQueue({ delayBetweenMs: 0 });
    expect(call).toBe(3);
    expect(report.attempted).toBe(3);
    expect(report.flushed).toBe(2);
    const left = readRecovery("p1", "thread");
    expect(left.map((e) => e.turn.id)).toEqual(["fail"]);
  });

  it("returns a no-op report when the queue is empty (no daemon call)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const report = await syncRecoveryQueue();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.attempted).toBe(0);
    expect(report.flushed).toBe(0);
    expect(report.remaining).toBe(0);
  });

  it("skips entries with no slug — they stay queued for a future migration", async () => {
    // Entry written by a pre-Fase-2 caller (no slug field).
    const entryWithoutSlug = {
      turn: turn("legacy", "old"),
      reason: "timeout" as const,
      savedAt: Date.now(),
    };
    globalThis.localStorage.setItem(
      "df:recovery-chat:p1:thread",
      JSON.stringify({ ts: Date.now(), turns: [entryWithoutSlug] }),
    );
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const report = await syncRecoveryQueue();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.attempted).toBe(0);
    expect(report.flushed).toBe(0);
    // Still in storage — not lost, just dormant.
    expect(readRecovery("p1", "thread")).toHaveLength(1);
  });

  it("re-entry while a sync is in flight returns the most recent report (no concurrent passes)", async () => {
    saveRecovery("p1", "thread", "slug", turn("t1", "hi"), "timeout");
    let resolve: (v: Response) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ) as typeof fetch;

    const first = syncRecoveryQueue({ delayBetweenMs: 0 });
    // Kick off a second pass while the first is still pending — it
    // should resolve immediately with the cached/last-known report.
    const second = await syncRecoveryQueue();
    expect(second.flushed).toBe(0);

    resolve(new Response("{}", { status: 200 }));
    await first;
    expect(lastSyncReport()?.flushed).toBe(1);
  });

  it("uses the slug stored on the entry, not a re-derived one", async () => {
    // Verifies the daemon body contains the slug we saved (slug travels
    // in the JSON body, not the URL — see appendChatTurn impl).
    saveRecovery("p1", "thread", "real-slug-xyz", turn("t1", "hi"), "timeout");
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await syncRecoveryQueue({ delayBetweenMs: 0 });
    expect(bodies).toHaveLength(1);
    expect((bodies[0] as { slug: string }).slug).toBe("real-slug-xyz");
  });
});
