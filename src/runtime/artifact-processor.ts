// artifact-processor.ts — parser core.
//
// Path B contract: providers without a native Write tool (Codex, Gemini,
// Anthropic API, Ollama, OpenRouter, opencode) end their turn with one
// artifact block:
//
//   <artifact identifier="projects/{slug}/{slug}.html"
//             type="text/html"
//             title="Optional Title">
//     ...complete standalone document...
//   </artifact>
//
// The runtime parser extracts that block and POSTs it to /fs/write/artifact
// (the daemon does atomic write + Static P0 + backup + lock). UI never
// consumes artifacts directly — it observes events for status only (D18).
//
// Why core, not UI: the parser must run from worker, CLI, tests, replay.
// Coupling to React would block every one of those (D18 / Anti-pattern A12).
//
// Quote-aware state machine: HTML/JS content can legally contain the
// substring "</artifact>" inside a string literal (e.g. `const tag =
// "</artifact>";`). A naive regex would bite. We use a tiny attribute
// scanner for the start tag and a balanced-tag scanner for the end. The
// content body is opaque text — we don't try to parse HTML inside.
//
// "Multiple artifacts in one turn → reject ALL" (D23 / Amendment v0.3.2):
// the parser flags `multiple-artifacts` instead of taking-the-last. Caller
// preserves the current file and re-prompts the agent.
//
// Pure text in / structured result out. No I/O, no fetch, no DOM.

export const DEFAULT_MAX_ARTIFACT_BYTES = 5 * 1024 * 1024; // 5 MB (§5).

export type ArtifactRejectionReason =
  | "multiple-artifacts" // D23 — more than one <artifact> opens in the same turn.
  | "unclosed-artifact" // Provider truncated mid-stream; no </artifact>.
  | "oversize" // content body exceeds maxBytes.
  | "invalid-attributes"; // missing identifier/type, malformed attribute syntax.

export interface ArtifactBlock {
  /** Path inside the project, as declared by the provider in the start tag. */
  identifier: string;
  /** MIME type ("text/html", "text/markdown", "image/svg+xml", ...). */
  type: string;
  /** Optional human label (rendered in the file picker). */
  title?: string;
  /** Raw inner content between <artifact> and </artifact>. */
  content: string;
  /** sha256 hex of `content`. CLIENT-SIDE HINT ONLY. The daemon recalculates
   *  server-side before any decision is made (D28 / Anti-pattern A18). */
  contentHash: string;
  /** Byte offset of `<` in the start tag. */
  startOffset: number;
  /** Byte offset just past `>` in the end tag. */
  endOffset: number;
}

export type ParseResult =
  | { status: "none"; cleanedText: string }
  | { status: "artifact"; artifact: ArtifactBlock; cleanedText: string }
  | {
      status: "rejected";
      reason: ArtifactRejectionReason;
      cleanedText: string;
      partial?: ArtifactBlock;
    };

export interface ParseOptions {
  /** Hard cap on artifact body size. Default 5 MB. */
  maxBytes?: number;
}

interface AttributeMap {
  [key: string]: string;
}

interface StartTagMatch {
  index: number; // offset of `<`
  endIndex: number; // offset just past `>`
  attributes: AttributeMap;
}

const ARTIFACT_OPEN = "<artifact";
const ARTIFACT_CLOSE = "</artifact>";

/**
 * Locate the next `<artifact ...>` start tag at or after `from`.
 * Returns null if none found or if the tag is malformed (unterminated,
 * invalid attribute syntax). The caller decides whether "malformed" means
 * "rejected" or "keep scanning".
 */
function findStartTag(
  text: string,
  from: number,
): StartTagMatch | { malformed: true; index: number } | null {
  let cursor = from;
  while (cursor < text.length) {
    const open = text.indexOf(ARTIFACT_OPEN, cursor);
    if (open === -1) return null;
    // Must be followed by whitespace or `>` to be a real `<artifact` tag
    // (and not, e.g., `<artifact-foo`).
    const next = text.charCodeAt(open + ARTIFACT_OPEN.length);
    const isTagBoundary =
      next === 0x20 ||
      next === 0x09 ||
      next === 0x0a ||
      next === 0x0d ||
      next === 0x2f /* / */ ||
      next === 0x3e; /* > */
    if (!isTagBoundary) {
      cursor = open + ARTIFACT_OPEN.length;
      continue;
    }
    // Scan attributes up to the closing `>`.
    const attrStart = open + ARTIFACT_OPEN.length;
    const parsed = scanStartTagAttributes(text, attrStart);
    if (parsed === null) {
      // Malformed start tag (truncated or invalid quoting). Surface it so
      // the caller can decide between "unclosed-artifact" and "invalid".
      return { malformed: true, index: open };
    }
    return { index: open, endIndex: parsed.endIndex, attributes: parsed.attributes };
  }
  return null;
}

/**
 * Walk through attributes after `<artifact`. Supports:
 *  - bare names ignored as boolean (we don't use any)
 *  - quoted values: `name="value"` or `name='value'`
 *  - HTML entity escapes inside values: `&quot;`, `&amp;`, `&apos;`,
 *    `&lt;`, `&gt;`, `&#NN;`, `&#xHH;`
 *  - self-closing `/>` is treated identically to `>`
 *
 * Returns null if the tag is unterminated (no `>` before EOF) OR if a
 * value's opening quote never closes (truncation mid-attribute).
 */
function scanStartTagAttributes(
  text: string,
  from: number,
): { attributes: AttributeMap; endIndex: number } | null {
  const attrs: AttributeMap = {};
  let i = from;
  while (i < text.length) {
    // Skip whitespace.
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) return null;
    const ch = text[i]!;
    if (ch === ">") return { attributes: attrs, endIndex: i + 1 };
    if (ch === "/" && text[i + 1] === ">") return { attributes: attrs, endIndex: i + 2 };
    // Read attribute name: alnum, dash, underscore, colon.
    const nameStart = i;
    while (i < text.length && /[A-Za-z0-9_:.\-]/.test(text[i]!)) i++;
    if (i === nameStart) {
      // Garbage character. Treat as malformed.
      return null;
    }
    const name = text.slice(nameStart, i).toLowerCase();
    // Skip whitespace and look for `=`.
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (text[i] !== "=") {
      // Bare attribute. Record as empty string; continue.
      attrs[name] = "";
      continue;
    }
    i++; // consume `=`
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) return null;
    const quote = text[i]!;
    if (quote !== '"' && quote !== "'") {
      // Unquoted value: read until whitespace or `>`.
      const valStart = i;
      while (i < text.length && !/[\s>]/.test(text[i]!)) i++;
      attrs[name] = decodeHtmlEntities(text.slice(valStart, i));
      continue;
    }
    i++; // consume opening quote
    const valStart = i;
    const close = text.indexOf(quote, i);
    if (close === -1) {
      // Truncated mid-attribute.
      return null;
    }
    attrs[name] = decodeHtmlEntities(text.slice(valStart, close));
    i = close + 1;
  }
  return null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:quot|apos|amp|lt|gt|#x?[0-9a-fA-F]+);/g, (entity) => {
    const fixed = HTML_ENTITIES[entity];
    if (fixed !== undefined) return fixed;
    if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
      const hex = entity.slice(3, -1);
      const code = parseInt(hex, 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    if (entity.startsWith("&#")) {
      const dec = entity.slice(2, -1);
      const code = parseInt(dec, 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return entity;
  });
}

/**
 * Locate the matching `</artifact>` for an open tag at `bodyStart`.
 * The body is opaque to us — we cannot HTML-parse it (it might contain
 * arbitrary JS, CSS, markdown). However we MUST avoid being fooled by:
 *
 *  1. `</artifact>` literal inside a JS/CSS string:
 *       const tag = "</artifact>"
 *     We track string state only when we encounter `<script>` / `<style>`
 *     blocks. Inside script/style, we honour single/double/template-quote
 *     state. Outside, every `</artifact>` ends the artifact.
 *
 *  2. `</script>` escape inside a JS string literal that opens
 *     `<script>...</script>`. We respect quote state inside script blocks,
 *     so a literal `"</script>"` does not prematurely close the script
 *     block — but our tracking is only for matching `</script>`/`</style>`,
 *     not for parsing the JS itself.
 *
 *  3. `<artifact>` nested inside the body — that's a multi-artifact case,
 *     handled at a higher level. Inside a single body we still scan only
 *     for `</artifact>`.
 *
 * Returns the offset of `<` in the closing tag, or -1 if not found.
 */
function findCloseTag(text: string, bodyStart: number): number {
  let i = bodyStart;
  // State: outside any script/style, or inside one (with quote tracking).
  let scriptOrStyleEnd: string | null = null; // e.g. "</script>" / "</style>"
  let stringQuote: '"' | "'" | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const ch = text[i]!;

    if (scriptOrStyleEnd) {
      // Inside <script> or <style>. Track string and comment state to avoid
      // false-positive close tags inside JS string literals.
      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        i++;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && text[i + 1] === "/") {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (stringQuote) {
        if (ch === "\\" && i + 1 < text.length) {
          // Escape sequence — skip next char.
          i += 2;
          continue;
        }
        if (ch === stringQuote) stringQuote = null;
        i++;
        continue;
      }
      // Not in a string/comment.
      if (ch === '"' || ch === "'" || ch === "`") {
        stringQuote = ch as '"' | "'" | "`";
        i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      // Look for end of script/style block.
      if (ch === "<" && matchesAtCaseInsensitive(text, i, scriptOrStyleEnd)) {
        i += scriptOrStyleEnd.length;
        scriptOrStyleEnd = null;
        continue;
      }
      i++;
      continue;
    }

    // Outside any script/style. Look for entry into one, OR for </artifact>.
    if (ch === "<") {
      if (matchesAtCaseInsensitive(text, i, ARTIFACT_CLOSE)) {
        return i;
      }
      // Check for <script ...> or <style ...> (with optional attributes).
      // The next char after the keyword must be a tag boundary so we don't
      // match e.g. <scripted-marker>.
      const lookahead = text.slice(i, Math.min(i + 12, text.length)).toLowerCase();
      if (lookahead.startsWith("<script") && isBoundary(text, i + 7)) {
        const close = text.indexOf(">", i);
        if (close === -1) return -1; // truncated tag
        scriptOrStyleEnd = "</script>";
        i = close + 1;
        continue;
      }
      if (lookahead.startsWith("<style") && isBoundary(text, i + 6)) {
        const close = text.indexOf(">", i);
        if (close === -1) return -1;
        scriptOrStyleEnd = "</style>";
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

function isBoundary(text: string, pos: number): boolean {
  if (pos >= text.length) return true;
  const ch = text[pos]!;
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ">" || ch === "/";
}

function matchesAtCaseInsensitive(text: string, pos: number, needle: string): boolean {
  if (pos + needle.length > text.length) return false;
  for (let k = 0; k < needle.length; k++) {
    const a = text.charCodeAt(pos + k);
    const b = needle.charCodeAt(k);
    if (a === b) continue;
    // Case-insensitive ASCII compare (artifact tag is ASCII).
    const aLower = a >= 0x41 && a <= 0x5a ? a + 0x20 : a;
    const bLower = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
    if (aLower !== bLower) return false;
  }
  return true;
}

/**
 * sha256 hex digest of a string. Uses Web Crypto when available (browser,
 * worker, Deno, Node 18+). The ONLY caller-visible synchronous-looking
 * helper in this file — but Web Crypto's digest() is async, so we expose
 * a sync fallback via a tiny pure-JS sha256 implementation for environments
 * that lack `crypto.subtle` synchronously (mostly historical Node).
 *
 * Daemon recalculates the hash anyway (D28), so this is just a hint.
 */
export async function sha256Hex(input: string): Promise<string> {
  // crypto.subtle returns a Promise<ArrayBuffer>. Async digest is the
  // canonical Web Crypto path; older sync-only callers used to live here
  // but every modern runtime has crypto.subtle.
  const subtle =
    (typeof globalThis !== "undefined" &&
      (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle) ||
    null;
  if (subtle) {
    const bytes = new TextEncoder().encode(input);
    const buf = await subtle.digest("SHA-256", bytes);
    return bufferToHex(new Uint8Array(buf));
  }
  // Last-resort pure JS fallback for environments without WebCrypto.
  return sha256JsFallback(input);
}

function bufferToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += (b < 0x10 ? "0" : "") + b.toString(16);
  }
  return out;
}

// Minimal sha256 in pure JS — only invoked when Web Crypto is missing.
// Adapted from public-domain reference (RFC 6234). Keeps the parser
// runnable from contexts that disable WebCrypto (e.g. some test workers).
function sha256JsFallback(message: string): string {
  function rrotate(n: number, x: number) {
    return (x >>> n) | (x << (32 - n));
  }
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  // Pre-processing: append 0x80, then zeros, then 64-bit length.
  const padLen = (56 - ((bytes.length + 1) % 64) + 64) % 64;
  const total = new Uint8Array(bytes.length + 1 + padLen + 8);
  total.set(bytes);
  total[bytes.length] = 0x80;
  // 64-bit big-endian length (only low 32 bits used here — message size is
  // bounded by maxBytes ≤ 5 MB so high 32 bits are always zero).
  const view = new DataView(total.buffer);
  view.setUint32(total.length - 4, bitLen >>> 0, false);
  view.setUint32(total.length - 8, Math.floor(bitLen / 0x100000000), false);
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  for (let chunk = 0; chunk < total.length; chunk += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rrotate(7, w[i - 15]!) ^ rrotate(18, w[i - 15]!) ^ (w[i - 15]! >>> 3);
      const s1 = rrotate(17, w[i - 2]!) ^ rrotate(19, w[i - 2]!) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rrotate(6, e) ^ rrotate(11, e) ^ rrotate(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rrotate(2, a) ^ rrotate(13, a) ^ rrotate(22, a);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  function toHex32(n: number) {
    return ("00000000" + (n >>> 0).toString(16)).slice(-8);
  }
  return (
    toHex32(h0) +
    toHex32(h1) +
    toHex32(h2) +
    toHex32(h3) +
    toHex32(h4) +
    toHex32(h5) +
    toHex32(h6) +
    toHex32(h7)
  );
}

/**
 * Strip the artifact block (and surrounding chat noise around it) from
 * `text` so the chat UI can render only the prose portion. We trim a
 * blank line on either side of the cut so the chat doesn't get a gaping
 * paragraph break where the artifact used to be.
 */
function stripArtifactRange(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  // Eat one newline before / one newline after the artifact, if present.
  if (s > 0 && text[s - 1] === "\n") s -= 1;
  if (e < text.length && text[e] === "\n") e += 1;
  return text.slice(0, s) + text.slice(e);
}

/**
 * parseArtifact — synchronous-ish entry point.
 *
 * NOTE: returns a Promise because it computes sha256 (`crypto.subtle.digest`
 * is async). All other work is sync. Callers that need a strictly-sync
 * variant for tests can import `sha256Hex` separately and reconstruct.
 */
export async function parseArtifact(
  streamText: string,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  if (typeof streamText !== "string") {
    return { status: "rejected", reason: "invalid-attributes", cleanedText: "" };
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;

  const first = findStartTag(streamText, 0);
  if (first === null) {
    // Fallback: some BYOK models (notably OpenRouter routes to OSS models)
    // insist on wrapping HTML in markdown fences (```html ... ```) instead
    // of the canonical <artifact ...> block. When we detect a fenced HTML
    // block, treat it as a synthetic artifact so the iframe still hydrates.
    // The daemon also nudges the model toward <artifact>; this is the
    // belt-and-suspenders client-side recovery.
    const fenceMatch = streamText.match(/```(?:html?|svg)\s*\n([\s\S]*?)\n```/i);
    if (
      fenceMatch &&
      fenceMatch[1] &&
      /^\s*<(!doctype|html|svg|\?xml)/i.test(fenceMatch[1].trimStart())
    ) {
      const content = fenceMatch[1];
      const byteSize = new TextEncoder().encode(content).byteLength;
      if (byteSize <= maxBytes && content.length >= 50) {
        const contentHash = await sha256Hex(content);
        const fenceStart = streamText.indexOf(fenceMatch[0]);
        const fenceEnd = fenceStart + fenceMatch[0].length;
        return {
          status: "artifact",
          artifact: {
            identifier: "index.html",
            type: "text/html",
            title: "Recovered from markdown fence",
            content,
            contentHash,
            startOffset: fenceStart,
            endOffset: fenceEnd,
          },
          cleanedText: streamText.slice(0, fenceStart) + streamText.slice(fenceEnd),
        };
      }
    }
    return { status: "none", cleanedText: streamText };
  }
  if ("malformed" in first) {
    // Open `<artifact` with broken attribute syntax.
    return {
      status: "rejected",
      reason: "invalid-attributes",
      cleanedText: streamText,
    };
  }

  // Look for a SECOND start tag anywhere after the first one's end. If
  // found we reject the whole turn (D23 / Amendment v0.3.2) without
  // attempting to write either.
  const second = findStartTag(streamText, first.endIndex);
  if (second !== null && !("malformed" in second)) {
    return {
      status: "rejected",
      reason: "multiple-artifacts",
      cleanedText: streamText,
    };
  }

  // Parse attributes from the start tag.
  const { identifier, type, title } = first.attributes;
  if (!identifier || !type) {
    return {
      status: "rejected",
      reason: "invalid-attributes",
      cleanedText: streamText,
    };
  }

  // Find matching close tag.
  const bodyStart = first.endIndex;
  const closeStart = findCloseTag(streamText, bodyStart);
  if (closeStart === -1) {
    // Truncated mid-stream. Surface a partial block so callers can persist
    // it as `.partial` for debug if they want.
    const partialContent = streamText.slice(bodyStart);
    const partialHash = await sha256Hex(partialContent);
    return {
      status: "rejected",
      reason: "unclosed-artifact",
      cleanedText: streamText,
      partial: {
        identifier,
        type,
        title,
        content: partialContent,
        contentHash: partialHash,
        startOffset: first.index,
        endOffset: streamText.length,
      },
    };
  }

  const content = streamText.slice(bodyStart, closeStart);
  const byteSize = new TextEncoder().encode(content).byteLength;
  if (byteSize > maxBytes) {
    return {
      status: "rejected",
      reason: "oversize",
      cleanedText: streamText,
    };
  }

  const contentHash = await sha256Hex(content);
  const endOffset = closeStart + ARTIFACT_CLOSE.length;
  const cleanedText = stripArtifactRange(streamText, first.index, endOffset);

  return {
    status: "artifact",
    artifact: {
      identifier,
      type,
      title,
      content,
      contentHash,
      startOffset: first.index,
      endOffset,
    },
    cleanedText,
  };
}
