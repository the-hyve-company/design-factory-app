// body-cap tests — bounded raw-body accumulation (POST /audio/transcribe).

import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { readBodyWithCap, BodyTooLargeError } from "./body-cap.mjs";

const stream = (...chunks) => Readable.from(chunks.map((c) => Buffer.from(c)));

describe("readBodyWithCap", () => {
  it("returns the full buffer when under the cap", async () => {
    const body = await readBodyWithCap(stream("hello ", "world"), 1024);
    expect(body.toString("utf8")).toBe("hello world");
  });

  it("accepts a body exactly at the cap", async () => {
    const body = await readBodyWithCap(stream("x".repeat(10)), 10);
    expect(body.length).toBe(10);
  });

  it("throws BodyTooLargeError (code BODY_TOO_LARGE) when the cap is exceeded", async () => {
    const big = stream("x".repeat(8), "y".repeat(8));
    const err = await readBodyWithCap(big, 10).catch((e) => e);
    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect(err.code).toBe("BODY_TOO_LARGE");
    expect(err.maxBytes).toBe(10);
  });

  it("aborts mid-stream — later chunks are never accumulated", async () => {
    let pulled = 0;
    async function* chunks() {
      for (let i = 0; i < 100; i++) {
        pulled = i + 1;
        yield Buffer.alloc(1024, 1);
      }
    }
    const err = await readBodyWithCap(Readable.from(chunks()), 4 * 1024).catch((e) => e);
    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect(pulled).toBeLessThan(10); // stopped near the cap, not after 100 chunks
  });

  it("rejects a non-positive or non-numeric cap", async () => {
    await expect(readBodyWithCap(stream("x"), 0)).rejects.toThrow(TypeError);
    await expect(readBodyWithCap(stream("x"), NaN)).rejects.toThrow(TypeError);
  });
});
