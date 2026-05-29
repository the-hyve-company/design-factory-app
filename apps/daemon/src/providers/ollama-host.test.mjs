// ollama-host.test.mjs — shared host resolution for detection + chat.
//
// Guards the 2026-05-29 fix: detection probed 127.0.0.1 → localhost → [::1]
// while the chat path hard-coded 127.0.0.1, so on IPv6-only / localhost-only
// setups the picker listed models but generation "fetch failed". Both paths
// now derive their host candidates from this one helper.

import { describe, expect, it, afterEach } from "vitest";
import { ollamaHostCandidates } from "./ollama-host.mjs";
import ollamaAdapter from "./ollama.mjs";

const ORIG = process.env.DF_OLLAMA_HOST;
afterEach(() => {
  if (ORIG === undefined) delete process.env.DF_OLLAMA_HOST;
  else process.env.DF_OLLAMA_HOST = ORIG;
});

describe("ollamaHostCandidates", () => {
  it("defaults to IPv4, then localhost, then IPv6 (covers Windows/WSL/Docker splits)", () => {
    delete process.env.DF_OLLAMA_HOST;
    expect(ollamaHostCandidates()).toEqual([
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://[::1]:11434",
    ]);
  });

  it("collapses to a single host when DF_OLLAMA_HOST is set", () => {
    process.env.DF_OLLAMA_HOST = "http://my-box:11434";
    expect(ollamaHostCandidates()).toEqual(["http://my-box:11434"]);
  });
});

describe("ollama adapter import chain", () => {
  it("loads and wires the shared host resolver without error", () => {
    expect(ollamaAdapter.id).toBe("ollama");
    expect(typeof ollamaAdapter.stream).toBe("function");
    expect(typeof ollamaAdapter.once).toBe("function");
  });
});
