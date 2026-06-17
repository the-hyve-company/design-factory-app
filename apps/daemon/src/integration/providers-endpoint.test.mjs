// providers-endpoint integration test.
//
// We can't easily boot the daemon HTTP server here (it's a singleton with
// side effects: file watchers, project init, terminal WS hooks). Instead,
// we exercise the same code paths the GET /providers handler runs:
//
//   1. listProviders() returns 13 entries
//   2. describeProvider() shape is contractually stable for each
//   3. every provider declares a valid readiness
//   4. every provider declares a complete capability set
//   5. ids are unique
//
// This is the smallest meaningful end-to-end check on the registry —
// real HTTP tests would need a daemon harness (deferred to ).
//
// @file integration/providers-endpoint.test.mjs

import { describe, it, expect } from "vitest";
import { PROVIDERS, listProviders, getProvider, describeProvider } from "../providers/index.mjs";

const READINESS = new Set(["stable", "beta", "experimental"]);
const FILE_WRITE = new Set(["tool", "artifact"]);
const REQUIRED_CAPS = ["streaming", "tools", "multimodal", "sessions", "mcp", "fileWrite"];

describe("GET /providers — registry contract", () => {
  it("listProviders returns 10 entries", () => {
    const list = listProviders();
    expect(list).toHaveLength(10);
  });

  it("every provider id is unique", () => {
    const list = listProviders();
    const ids = list.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every provider declares a complete capability set", () => {
    const offenders = [];
    for (const p of listProviders()) {
      const caps = p.capabilities ?? {};
      for (const key of REQUIRED_CAPS) {
        if (!(key in caps)) {
          offenders.push(`${p.id}.${key}`);
        }
      }
      if (caps.fileWrite && !FILE_WRITE.has(caps.fileWrite)) {
        offenders.push(`${p.id}.fileWrite=${caps.fileWrite}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every provider declares a valid readiness", () => {
    const offenders = [];
    for (const p of listProviders()) {
      if (!READINESS.has(p.readiness)) {
        offenders.push(`${p.id}: ${p.readiness ?? "(missing)"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("readiness distribution matches the release matrix", () => {
    const counts = { stable: 0, beta: 0, experimental: 0 };
    for (const p of listProviders()) counts[p.readiness]++;
    // Lock the current public distribution. Promoting an adapter past
    // experimental requires updating this assertion alongside the
    // README/providers.md narrative.
    expect(counts.stable).toBe(1); // claude
    expect(counts.beta).toBe(7); // codex, gemini, anthropic, openai, gemini-api, openrouter, ollama
    expect(counts.experimental).toBe(2); // opencode, kimi
  });

  it("describeProvider returns the public-shape descriptor", () => {
    const claude = getProvider("claude");
    expect(claude).not.toBeNull();
    const desc = describeProvider(claude);
    expect(desc).toEqual({
      id: "claude",
      label: "Claude Code",
      capabilities: claude.capabilities,
      readiness: "stable",
    });
    // No function references leak into the descriptor.
    expect(typeof desc.stream).toBe("undefined");
    expect(typeof desc.once).toBe("undefined");
  });

  it("getProvider returns null for unknown id", () => {
    expect(getProvider("nonexistent")).toBeNull();
    expect(getProvider("")).toBeNull();
    expect(getProvider(null)).toBeNull();
    expect(getProvider(undefined)).toBeNull();
    expect(getProvider(123)).toBeNull();
  });

  it("every adapter exposes stream + once functions", () => {
    const offenders = [];
    for (const p of listProviders()) {
      if (typeof p.stream !== "function") offenders.push(`${p.id}.stream`);
      if (typeof p.once !== "function") offenders.push(`${p.id}.once`);
    }
    expect(offenders).toEqual([]);
  });

  it("PROVIDERS map keys match adapter ids (registry consistency)", () => {
    for (const [key, p] of Object.entries(PROVIDERS)) {
      expect(p.id).toBe(key);
    }
  });
});
