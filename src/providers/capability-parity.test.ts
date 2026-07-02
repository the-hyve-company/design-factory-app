// capability-parity.test.ts — audit WS3 `capability-parity-test` +
// `unify-capability-shape`.
//
// DF keeps TWO capability matrices: the frontend one
// (src/providers/*.ts, drives prompt composition / dispatch / resume
// gating) and the daemon one (apps/daemon/src/providers/*.mjs, drives
// the wire descriptor + adapter behavior). Nothing structural forced
// them to agree — this test does.
//
// Shared vocabulary (same name = same concept, must be equal):
//   tools · mcp · fileWrite · supportsResume
// Side-specific fields are intentional and CLOSED sets — adding a new
// field to either matrix fails this test until it's classified here:
//   front-only : nativeSkills, nativeAgents, streamJson (harness
//                features only the browser runtime consumes)
//   daemon-only: streaming, multimodal (transport truths only the
//                daemon can honestly claim)
//
// Reconciliation log:
//   2026-07-02 · kimi.mcp — front said true, daemon said false. DF's
//     kimi spawn doesn't forward any MCP config, so the conservative
//     daemon value won; front flipped to false.
//   2026-07-02 · daemon `sessions` renamed to `supportsResume` (same
//     concept as the front field; the wire descriptor had no consumer
//     reading the old key).

import { describe, it, expect } from "vitest";
import { PROVIDERS } from "./registry";
import type { ProviderCapabilities, ProviderId } from "./types";
// The daemon registry is a side-effect-free module (unlike the daemon's
// root index.mjs, which starts the HTTP server on import).
import {
  PROVIDERS as DAEMON_PROVIDERS,
  listProviders as listDaemonProviders,
} from "../../apps/daemon/src/providers/index.mjs";

interface DaemonCapabilities {
  streaming: boolean;
  tools: boolean;
  multimodal: boolean;
  supportsResume: boolean;
  mcp: boolean;
  fileWrite: "tool" | "artifact";
}

const daemonProviders = DAEMON_PROVIDERS as Record<
  string,
  { id: string; capabilities: DaemonCapabilities }
>;

const SHARED_KEYS = ["tools", "mcp", "fileWrite", "supportsResume"] as const;
const FRONT_ONLY_KEYS = ["nativeSkills", "nativeAgents", "streamJson"] as const;
const DAEMON_ONLY_KEYS = ["streaming", "multimodal"] as const;

describe("capability parity — front (types.ts) ↔ daemon (types.mjs)", () => {
  it("both registries expose exactly the same 10 provider ids", () => {
    const frontIds = PROVIDERS.map((p) => p.meta.id).sort();
    const daemonIds = Object.keys(daemonProviders).sort();
    expect(frontIds).toEqual(daemonIds);
    expect(frontIds).toHaveLength(10);
    // listProviders() must agree with the record keys (registry sanity).
    expect((listDaemonProviders() as { id: string }[]).map((p) => p.id).sort()).toEqual(daemonIds);
  });

  for (const provider of PROVIDERS) {
    const id = provider.meta.id as ProviderId;
    it(`${id}: shared capability fields agree between front and daemon`, () => {
      const daemon = daemonProviders[id];
      expect(daemon, `daemon adapter missing for ${id}`).toBeTruthy();
      for (const key of SHARED_KEYS) {
        const frontValue =
          key === "supportsResume"
            ? (provider.capabilities.supportsResume ?? false) // optional on the front — absent = stateless
            : provider.capabilities[key];
        expect(
          daemon.capabilities[key],
          `${id}.${key}: front=${String(frontValue)} daemon=${String(daemon.capabilities[key])}`,
        ).toBe(frontValue);
      }
    });
  }

  it("front matrix has no unclassified capability fields", () => {
    const allowed = new Set<string>([...SHARED_KEYS, ...FRONT_ONLY_KEYS]);
    for (const provider of PROVIDERS) {
      const keys = Object.keys(provider.capabilities) as (keyof ProviderCapabilities)[];
      const unknown = keys.filter((k) => !allowed.has(k));
      expect(
        unknown,
        `${provider.meta.id}: new front capability field(s) ${unknown.join(", ")} — classify as shared or front-only in capability-parity.test.ts (and mirror in the daemon if shared)`,
      ).toEqual([]);
    }
  });

  it("daemon matrix has no unclassified capability fields", () => {
    const allowed = new Set<string>([...SHARED_KEYS, ...DAEMON_ONLY_KEYS]);
    for (const [id, adapter] of Object.entries(daemonProviders)) {
      const unknown = Object.keys(adapter.capabilities).filter((k) => !allowed.has(k));
      expect(
        unknown,
        `${id}: new daemon capability field(s) ${unknown.join(", ")} — classify as shared or daemon-only in capability-parity.test.ts (and mirror in the front if shared)`,
      ).toEqual([]);
    }
  });

  it("channel split is the audited 4 tool / 6 artifact", () => {
    const tool = PROVIDERS.filter((p) => p.capabilities.fileWrite === "tool").map((p) => p.meta.id);
    const artifact = PROVIDERS.filter((p) => p.capabilities.fileWrite === "artifact").map(
      (p) => p.meta.id,
    );
    expect(tool.sort()).toEqual(["claude", "codex", "kimi", "opencode"]);
    expect(artifact.sort()).toEqual([
      "anthropic",
      "gemini",
      "gemini-api",
      "ollama",
      "openai",
      "openrouter",
    ]);
  });

  it("resume-capable set is claude/codex/gemini on both sides", () => {
    const front = PROVIDERS.filter((p) => p.capabilities.supportsResume === true)
      .map((p) => p.meta.id)
      .sort();
    const daemon = Object.values(daemonProviders)
      .filter((p) => p.capabilities.supportsResume === true)
      .map((p) => p.id)
      .sort();
    expect(front).toEqual(["claude", "codex", "gemini"]);
    expect(daemon).toEqual(front);
  });
});
