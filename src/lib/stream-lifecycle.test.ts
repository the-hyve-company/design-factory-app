import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSuspiciousDone,
  createIdleWatchdog,
  STREAM_IDLE_TIMEOUT_MS,
  SUSPICIOUS_TEXT_CHAR_LIMIT,
} from "./stream-lifecycle";

describe("isSuspiciousDone", () => {
  it("flags the user's 3d21 repro (4 chars 'Você', zero tools)", () => {
    expect(
      isSuspiciousDone({
        text: "Você",
        toolCount: 0,
        promptText: "tem algo errado, distorcendo a forma, refine a experiencia",
      }),
    ).toBe(true);
  });

  it("flags 'Vou refazer todo o' (18 chars, zero tools)", () => {
    expect(
      isSuspiciousDone({
        text: "Vou refazer todo o",
        toolCount: 0,
        promptText: "divisao entre sections deve ser sempre gradiente",
      }),
    ).toBe(true);
  });

  it("does not flag a turn that produced any tool call", () => {
    expect(isSuspiciousDone({ text: "x", toolCount: 1, promptText: "anything" })).toBe(false);
  });

  it("does not flag a normal-length response", () => {
    const longText = "x".repeat(SUSPICIOUS_TEXT_CHAR_LIMIT);
    expect(isSuspiciousDone({ text: longText, toolCount: 0, promptText: "anything" })).toBe(false);
  });

  it("does not flag short replies to trivial prompts", () => {
    expect(isSuspiciousDone({ text: "ok", toolCount: 0, promptText: "?" })).toBe(false);
    expect(isSuspiciousDone({ text: "sim", toolCount: 0, promptText: "?!" })).toBe(false);
    expect(isSuspiciousDone({ text: "hi", toolCount: 0, promptText: "hi" })).toBe(false);
  });

  it("treats null/undefined text as truncation when prompt is non-trivial", () => {
    expect(isSuspiciousDone({ text: null, toolCount: 0, promptText: "build me X" })).toBe(true);
    expect(isSuspiciousDone({ text: undefined, toolCount: 0, promptText: "build me X" })).toBe(
      true,
    );
    expect(isSuspiciousDone({ text: "", toolCount: 0, promptText: "build me X" })).toBe(true);
  });

  it("trims whitespace before measuring", () => {
    expect(isSuspiciousDone({ text: "   ", toolCount: 0, promptText: "build me X" })).toBe(true);
  });

  it("default constant is 90 seconds", () => {
    expect(STREAM_IDLE_TIMEOUT_MS).toBe(90_000);
  });
});

describe("createIdleWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onIdleTimeout after the silence window elapses", () => {
    const cb = vi.fn();
    createIdleWatchdog(cb, 1000);
    vi.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("bump() resets the deadline (silence has to start over)", () => {
    const cb = vi.fn();
    const wd = createIdleWatchdog(cb, 1000);
    vi.advanceTimersByTime(900);
    wd.bump();
    vi.advanceTimersByTime(900);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stop() prevents the timeout from firing", () => {
    const cb = vi.fn();
    const wd = createIdleWatchdog(cb, 1000);
    wd.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not fire twice even if multiple bumps happen post-timeout", () => {
    const cb = vi.fn();
    const wd = createIdleWatchdog(cb, 1000);
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(1);
    wd.bump();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent", () => {
    const cb = vi.fn();
    const wd = createIdleWatchdog(cb, 1000);
    wd.stop();
    wd.stop();
    wd.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });
});
