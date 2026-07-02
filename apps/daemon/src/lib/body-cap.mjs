// body-cap.mjs — bounded body accumulation for raw (non-JSON) uploads.
//
// readJson() in index.mjs already caps JSON bodies (DF_MAX_JSON_BODY_BYTES),
// but raw-body endpoints (POST /audio/transcribe) used to accumulate chunks
// unbounded — a memory-DoS vector reachable from any allowed origin. This
// helper accumulates with a hard byte ceiling and throws a typed error the
// route maps to HTTP 413.

export class BodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`request body too large (>${maxBytes} bytes)`);
    this.name = "BodyTooLargeError";
    this.code = "BODY_TOO_LARGE";
    this.maxBytes = maxBytes;
  }
}

// Read an async-iterable request stream into a Buffer, aborting as soon as
// the running total exceeds `maxBytes` (no full-buffer accumulation first).
export async function readBodyWithCap(req, maxBytes) {
  const cap = Number(maxBytes);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new TypeError(`readBodyWithCap: invalid maxBytes: ${maxBytes}`);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > cap) throw new BodyTooLargeError(cap);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
