// Shared image-attachment extraction for the API adapters.
//
// CLI providers (claude/codex/gemini/kimi/opencode) receive image
// attachments as `[attached image: <abs-path>]` markers in the prompt and
// read the file themselves via a Read/ReadMediaFile tool. The direct HTTP
// API adapters (anthropic/openai/openrouter/gemini-api/ollama) can't read
// the user's disk, so the path is useless to them — they need the image
// inlined as a base64 vision block in the request.
//
// This helper pulls the markers out of the prompt, reads each file from
// disk (the daemon has fs access + the path is absolute), base64-encodes it,
// and returns the cleaned text + the decoded images. Each adapter then
// formats the images into its own vision schema.

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const MARKER_RE = /\[attached image:\s*([^\]]+)\]/g;

const EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function mimeForPath(p) {
  // null = unsupported extension → caller keeps the marker, never reads the file.
  return EXT_MIME[extname(p).toLowerCase()] || null;
}

/**
 * Extract `[attached image: PATH]` markers from a prompt.
 * @returns {{ text: string, images: Array<{ mime: string, base64: string, path: string }> }}
 *   `text` is the prompt with the markers stripped; `images` are the ones
 *   that resolved to a real file on disk. Markers whose file is missing are
 *   left in the text (so the model still sees a reference) and skipped.
 */
export function extractImageAttachments(prompt, opts = {}) {
  // `isInScope(path)` gates which absolute paths may be read off disk. The API
  // adapters pass the daemon's workspace-scope check so a forged
  // `[attached image: /home/user/.aws/credentials]` can't exfiltrate an
  // arbitrary file to a third-party provider. Defaults to allow-all only when
  // omitted (e.g. unit tests); production callers always pass it.
  const isInScope = typeof opts.isInScope === "function" ? opts.isInScope : () => true;
  if (typeof prompt !== "string" || !prompt.includes("[attached image:")) {
    return { text: prompt, images: [] };
  }
  const images = [];
  const text = prompt.replace(MARKER_RE, (whole, rawPath) => {
    const path = String(rawPath).trim();
    try {
      const mime = mimeForPath(path);
      // Unsupported extension or SVG (most vision APIs reject SVG base64):
      // keep the marker in text so the model still knows it was referenced.
      if (!mime || mime === "image/svg+xml") return whole;
      // Out of workspace scope → never read (anti-exfiltration).
      if (!isInScope(path)) return whole;
      if (!existsSync(path)) return whole; // keep the marker; file gone
      const buf = readFileSync(path);
      images.push({ mime, base64: buf.toString("base64"), path });
      return ""; // drop the marker; the image rides as a vision block now
    } catch {
      return whole;
    }
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), images };
}
